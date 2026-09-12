#!/usr/bin/env node
/**
 * scrape_new.js - Yalnizca yeni ya da Etsy tarafinda degismis listingleri ceker.
 *
 * Var olan data/listings.json ile karsilastirir; yeni eklenenleri ve
 * son_modified damgasi ilerlemis olanlari ayirir. Tam cekim yerine bunu
 * kullanarak 500+ listingli magazalarda API kotasini korursunuz.
 *
 *   node scrape_new.js
 *   node scrape_new.js --state draft
 *   node scrape_new.js --no-merge        # listings.json'i guncelleme, sadece farki yaz
 */
import { parseArgs, runMain } from "./lib/cli.js";
import { config, requireConfig } from "./lib/config.js";
import { fetchAllListings } from "./lib/etsy.js";
import { auditListing } from "./lib/rules.js";
import { readJson, writeJson, paths } from "./lib/store.js";
import { log } from "./lib/log.js";

function timestampOf(listing) {
  return listing.last_modified_timestamp ?? listing.updated_timestamp ?? 0;
}

async function main() {
  requireConfig(["etsyRead"]);
  const args = parseArgs();
  const state = typeof args.state === "string" ? args.state : "active";

  const existing = await readJson(paths.listings, null);
  if (!existing) {
    log.warn(`${paths.listings} yok. Once tam cekim yapiliyor (scrape.js ile ayni sonuc).`);
  }

  const known = new Map(
    (existing?.listings ?? []).map((listing) => [String(listing.listing_id), listing]),
  );

  log.step(`Etsy'den '${state}' listingler cekiliyor...`);
  const fetched = await fetchAllListings({ state });

  const added = [];
  const changed = [];

  for (const listing of fetched) {
    listing.audit = auditListing({
      title: listing.title ?? "",
      description: listing.description ?? "",
      tags: listing.tags ?? [],
    });

    const previous = known.get(String(listing.listing_id));
    if (!previous) {
      added.push(listing);
    } else if (timestampOf(listing) > timestampOf(previous)) {
      changed.push(listing);
    }
  }

  const delta = [...added, ...changed];

  await writeJson(paths.newListings, {
    shop_id: config.etsy.shopId,
    state,
    fetched_at: new Date().toISOString(),
    added_count: added.length,
    changed_count: changed.length,
    listings: delta,
  });

  if (args["no-merge"]) {
    log.info(`${paths.listings} dokunulmadi (--no-merge).`);
  } else {
    // Tam cekim sonucunu yaziyoruz: silinen listingler de boylece dusuyor.
    await writeJson(paths.listings, {
      shop_id: config.etsy.shopId,
      state,
      fetched_at: new Date().toISOString(),
      count: fetched.length,
      listings: fetched,
    });
  }

  log.ok(`${added.length} yeni, ${changed.length} degismis listing.`);
  for (const listing of delta.slice(0, 10)) {
    log.plain(`  ${listing.listing_id}  ${(listing.title ?? "").slice(0, 60)}`);
  }
  if (delta.length > 10) log.plain(log.dim(`  ... ve ${delta.length - 10} tane daha`));

  if (delta.length > 0) {
    log.info(`Sonraki adim: node optimize_all.js --input ${paths.newListings}`);
  }
}

runMain(main);
