#!/usr/bin/env node
/**
 * optimize.js - Tek bir listingi optimize eder ve sonucu ekranda gosterir.
 *
 * Toplu ise gecmeden once bir listingle deneyip ciktiyi gormek icin.
 *
 *   node optimize.js --id 1234567890
 *   node optimize.js --index 0
 *   node optimize.js --id 1234567890 --save    # sonucu optimized.json'a ekle
 */
import { parseArgs, asNumber, runMain } from "./lib/cli.js";
import { requireConfig } from "./lib/config.js";
import { optimizeListing } from "./lib/claude.js";
import { fetchListingProperties } from "./lib/etsy.js";
import { readJson, writeJson, paths } from "./lib/store.js";
import { log } from "./lib/log.js";

function findListing(listings, args) {
  if (args.id) {
    const match = listings.find((listing) => String(listing.listing_id) === String(args.id));
    if (!match) throw new Error(`Listing ${args.id} ${paths.listings} icinde yok.`);
    return match;
  }
  const index = asNumber(args.index, 0);
  if (!listings[index]) throw new Error(`Index ${index} icin listing yok (toplam ${listings.length}).`);
  return listings[index];
}

function printBlock(label, text, limit) {
  const suffix = limit ? log.dim(` (${text.length} karakter, sinir ${limit})`) : log.dim(` (${text.length} karakter)`);
  log.plain(`\n${log.bold(label)}${suffix}`);
  log.plain(text);
}

async function main() {
  requireConfig(["etsyRead", "claude"]);
  const args = parseArgs();

  const data = await readJson(paths.listings);
  if (!data) throw new Error(`${paths.listings} yok. Once: node scrape.js`);

  const listing = findListing(data.listings, args);
  log.step(`Optimize ediliyor: ${listing.listing_id} - ${(listing.title ?? "").slice(0, 60)}`);

  const properties = listing.properties ?? (await fetchListingProperties(listing.listing_id));
  const result = await optimizeListing(listing, { properties });
  const optimized = result.optimized;

  printBlock("ESKI BASLIK", result.original.title);
  printBlock("YENI BASLIK", optimized.title);
  printBlock("ESKI ACIKLAMA", `${result.original.description.slice(0, 400)}...`);
  printBlock("YENI ACIKLAMA", optimized.description);

  log.plain(`\n${log.bold("BIRINCIL ANAHTAR KELIME")}: ${optimized.primary_keyword}`);

  if (optimized.changes.length > 0) {
    log.plain(`\n${log.bold("DEGISIKLIKLER")}`);
    for (const change of optimized.changes) log.plain(`  - ${change}`);
  }

  if (optimized.missing_attributes.length > 0) {
    log.plain(`\n${log.bold("EKSIK ATTRIBUTE'LAR")}`);
    for (const attribute of optimized.missing_attributes) {
      const value = attribute.suggested_value ? ` -> ${attribute.suggested_value}` : "";
      log.plain(`  - ${attribute.name}${value}  ${log.dim(attribute.reason)}`);
    }
  }

  if (optimized.tag_notes.length > 0) {
    log.plain(`\n${log.bold("TAG NOTLARI")} ${log.dim("(tag'leri siz yazacaksiniz)")}`);
    for (const note of optimized.tag_notes) log.plain(`  - ${note}`);
  }

  if (optimized.risk_notes.length > 0) {
    log.plain(`\n${log.bold("KONTROL EDILMESI GEREKENLER")}`);
    for (const note of optimized.risk_notes) log.plain(`  - ${note}`);
  }

  if (result.issues_after.length > 0) {
    log.plain("");
    log.warn("Yeni metinde hala kural ihlali var:");
    for (const issue of result.issues_after) log.plain(`  - ${issue.message}`);
  }

  log.plain(
    `\n${log.dim(
      `token: ${result.usage.input_tokens} girdi / ${result.usage.output_tokens} cikti, ` +
        `cache okuma: ${result.usage.cache_read_input_tokens ?? 0}`,
    )}`,
  );

  if (args.save) {
    const store = (await readJson(paths.optimized, { results: [] })) ?? { results: [] };
    store.results = store.results.filter((item) => item.listing_id !== result.listing_id);
    store.results.push(result);
    store.updated_at = new Date().toISOString();
    const file = await writeJson(paths.optimized, store);
    log.ok(`Sonuc kaydedildi: ${file}`);
  } else {
    log.info("Kaydetmek icin --save ekleyin. Tumu icin: node optimize_all.js");
  }
}

runMain(main);
