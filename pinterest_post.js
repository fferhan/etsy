#!/usr/bin/env node
/**
 * pinterest_post.js - Listingler icin Pinterest pin'i olusturur.
 *
 * VARSAYILAN KURU CALISMADIR. Gercekten paylasmak icin --yes gerekir.
 * Paylasilan her listing data/pinned.json'a yazilir, boylece ayni urun
 * iki kez pinlenmez (pin_remaining.js bu kaydi kullanir).
 *
 *   node pinterest_post.js                    # ne paylasilacagini goster
 *   node pinterest_post.js --yes --limit 10   # ilk 10 listingi paylas
 *   node pinterest_post.js --yes --id 123456  # tek listing
 *   node pinterest_post.js --boards           # board ID'lerinizi listele
 *   node pinterest_post.js --yes --optimized  # optimize edilmis metinleri kullan
 */
import { pathToFileURL } from "node:url";
import { parseArgs, asNumber, runMain } from "./lib/cli.js";
import { config, requireConfig } from "./lib/config.js";
import { listingUrl, primaryImageUrl } from "./lib/etsy.js";
import { createPin, listBoards, pinContentFromListing } from "./lib/pinterest.js";
import { readJson, writeJson, paths } from "./lib/store.js";
import { log, progress } from "./lib/log.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Optimize edilmis metin varsa onu, yoksa Etsy'deki mevcut metni kullanir. */
export function resolveContent(listing, optimizedStore, useOptimized) {
  if (useOptimized && optimizedStore) {
    const match = optimizedStore.results.find(
      (result) => String(result.listing_id) === String(listing.listing_id),
    );
    if (match) {
      return pinContentFromListing({
        title: match.optimized.title,
        description: match.optimized.description,
      });
    }
  }
  return pinContentFromListing(listing);
}

/** Pin'lenebilir listingleri secer; gorseli olmayanlari sebebiyle ayirir. */
export function selectPinnable(listings, pinnedIds) {
  const pinnable = [];
  const skipped = [];

  for (const listing of listings) {
    if (pinnedIds.has(String(listing.listing_id))) {
      skipped.push({ listing_id: listing.listing_id, reason: "daha once pinlendi" });
      continue;
    }
    const imageUrl = primaryImageUrl(listing);
    if (!imageUrl) {
      skipped.push({ listing_id: listing.listing_id, reason: "gorsel URL'si yok" });
      continue;
    }
    // Pinterest pin'i linksiz ise urune trafik getirmez; linki olmayani pinlemiyoruz.
    const link = listingUrl(listing);
    if (!link) {
      skipped.push({ listing_id: listing.listing_id, reason: "link yok (--shop-url verin)" });
      continue;
    }
    pinnable.push({ listing, imageUrl, link });
  }

  return { pinnable, skipped };
}

export async function runPinJob(args, { onlyRemaining = false } = {}) {
  const live = args.yes === true || args.yes === "true";
  requireConfig(["pinterest"]);

  if (args.boards) {
    const boards = await listBoards();
    log.ok(`${boards.length} board bulundu:`);
    for (const board of boards) log.plain(`  ${board.id}  ${board.name}`);
    return;
  }

  const data = await readJson(paths.listings);
  if (!data?.listings?.length) throw new Error(`${paths.listings} yok. Once: node scrape.js`);

  const pinnedStore = (await readJson(paths.pinned, { entries: [] })) ?? { entries: [] };
  const pinnedIds = new Set(pinnedStore.entries.map((entry) => String(entry.listing_id)));

  let listings = data.listings;
  if (args.id) {
    listings = listings.filter((listing) => String(listing.listing_id) === String(args.id));
    if (listings.length === 0) throw new Error(`Listing ${args.id} bulunamadi.`);
  }

  // pinterest_post.js --id ile tek bir urunu yeniden pinlemeye izin veriyoruz;
  // pin_remaining.js ise her zaman kalanlarla calisiyor.
  const effectivePinned = onlyRemaining || !args.id ? pinnedIds : new Set();
  const { pinnable, skipped } = selectPinnable(listings, effectivePinned);

  const limit = asNumber(args.limit, Infinity);
  const queue = Number.isFinite(limit) ? pinnable.slice(0, limit) : pinnable;

  const missingImages = skipped.filter((item) => item.reason === "gorsel URL'si yok");
  if (missingImages.length > 0) {
    log.warn(`${missingImages.length} listing gorseli olmadigi icin atlandi.`);
  }
  if (onlyRemaining) {
    log.info(`${pinnedIds.size} listing daha once pinlenmis, ${pinnable.length} tanesi kaldi.`);
  }

  if (queue.length === 0) {
    log.ok("Paylasilacak pin yok.");
    return;
  }

  const optimizedStore = args.optimized ? await readJson(paths.optimized) : null;
  const boardId = typeof args.board === "string" ? args.board : config.pinterest.boardId;

  log.step(`${queue.length} pin ${live ? "PAYLASILACAK" : "paylasilirdi (kuru calisma)"}.`);

  if (!live) {
    for (const { listing, imageUrl, link } of queue.slice(0, 10)) {
      const content = resolveContent(listing, optimizedStore, Boolean(args.optimized));
      log.plain(`\n${log.bold(String(listing.listing_id))}`);
      log.plain(`  baslik : ${content.title}`);
      log.plain(`  link   : ${link}`);
      log.plain(`  gorsel : ${log.dim(imageUrl)}`);
    }
    if (queue.length > 10) log.plain(log.dim(`\n... ve ${queue.length - 10} pin daha`));
    log.plain("");
    log.warn("Kuru calisma. Gercekten paylasmak icin --yes ekleyin.");
    return;
  }

  const failures = [];
  let done = 0;

  for (const { listing, imageUrl, link } of queue) {
    const content = resolveContent(listing, optimizedStore, Boolean(args.optimized));
    try {
      const pin = await createPin({
        title: content.title,
        description: content.description,
        link,
        imageUrl,
        boardId,
      });
      pinnedStore.entries.push({
        listing_id: listing.listing_id,
        pin_id: pin.id,
        board_id: boardId,
        pinned_at: new Date().toISOString(),
      });
    } catch (error) {
      failures.push({ listing_id: listing.listing_id, error: error.message });
    }
    done += 1;
    progress(done, queue.length, String(listing.listing_id));
    // Pinterest saatlik pin limiti uyguluyor; araya bekleme koyuyoruz.
    await sleep(1500);
    // Her pinden sonra kaydediyoruz: is yarida kalirsa ayni urun tekrar pinlenmesin.
    pinnedStore.updated_at = new Date().toISOString();
    await writeJson(paths.pinned, pinnedStore);
  }

  log.ok(`${queue.length - failures.length} pin paylasildi. Kayit: ${paths.pinned}`);

  if (failures.length > 0) {
    log.warn(`${failures.length} pin paylasilamadi:`);
    for (const failure of failures) log.plain(`  ${failure.listing_id}: ${failure.error}`);
    process.exitCode = 1;
  }
}

// pin_remaining.js bu dosyayi import ediyor; sadece dogrudan calistirildiginda is yap.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMain(async () => runPinJob(parseArgs()));
}
