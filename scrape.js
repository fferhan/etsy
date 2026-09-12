#!/usr/bin/env node
/**
 * scrape.js - Magazadaki tum listingleri Etsy API'sinden ceker.
 *
 *   node scrape.js                       # aktif listingler + gorseller
 *   node scrape.js --state draft         # taslaklar
 *   node scrape.js --limit 20            # ilk 20 listing
 *   node scrape.js --with-properties     # attribute'lari da cek (yavas, listing basina 1 istek)
 *   node scrape.js --whoami              # ETSY_SHOP_ID'nizi bulun
 */
import { parseArgs, asNumber, runMain } from "./lib/cli.js";
import { config, requireConfig } from "./lib/config.js";
import { fetchAllListings, fetchListingProperties, getMe, getShop } from "./lib/etsy.js";
import { auditListing, summarizeIssues } from "./lib/rules.js";
import { writeJson, paths } from "./lib/store.js";
import { log, progress } from "./lib/log.js";

async function whoami() {
  const me = await getMe();
  log.ok(`user_id: ${me.user_id}`);
  if (config.etsy.shopId) {
    const shop = await getShop();
    log.ok(`shop_id: ${shop.shop_id} (${shop.shop_name})`);
  } else {
    log.info("ETSY_SHOP_ID bos. Etsy hesabinizdaki magaza ID'sini .env dosyasina ekleyin.");
  }
}

async function main() {
  const args = parseArgs();

  if (args.whoami) {
    requireConfig(["etsyRead"]);
    return whoami();
  }

  requireConfig(["etsyRead"]);

  const state = typeof args.state === "string" ? args.state : "active";
  const limit = asNumber(args.limit, Infinity);
  const out = typeof args.out === "string" ? args.out : paths.listings;

  log.step(`Etsy'den '${state}' listingler cekiliyor...`);
  const listings = await fetchAllListings({ state, limit });

  if (args["with-properties"]) {
    log.step("Attribute'lar cekiliyor (listing basina 1 istek)...");
    for (const [index, listing] of listings.entries()) {
      listing.properties = await fetchListingProperties(listing.listing_id);
      progress(index + 1, listings.length, listing.title ?? "");
    }
  }

  // Cekerken denetimi de yapiyoruz: optimize etmeden once neyin bozuk oldugunu
  // gormek icin ayri bir komut calistirmaya gerek kalmiyor.
  let flagged = 0;
  for (const listing of listings) {
    listing.audit = auditListing({
      title: listing.title ?? "",
      description: listing.description ?? "",
      tags: listing.tags ?? [],
    });
    if (listing.audit.length > 0) flagged += 1;
  }

  const payload = {
    shop_id: config.etsy.shopId,
    state,
    fetched_at: new Date().toISOString(),
    count: listings.length,
    listings,
  };

  const file = await writeJson(out, payload);
  log.ok(`${listings.length} listing kaydedildi: ${file}`);
  log.info(`${flagged} listingde kural ihlali bulundu.`);

  for (const listing of listings.slice(0, 5)) {
    if (listing.audit.length > 0) {
      log.plain(`  ${listing.listing_id} ${log.dim(summarizeIssues(listing.audit))}`);
    }
  }
  if (flagged > 5) log.plain(log.dim(`  ... ve ${flagged - 5} listing daha`));
  log.info("Sonraki adim: node optimize_all.js");
}

runMain(main);
