#!/usr/bin/env node
/**
 * scrape_csv.js - Etsy'nin kendi CSV export'undan listing verisi okur.
 *
 * API anahtari beklerken (ya da hic alamayacaksaniz) scrape.js'in yerine gecer.
 * Cikti ayni: data/listings.json. Zincirin geri kalani - optimize_all.js,
 * optimizasyon plani, denetci - hic degismeden calisir.
 *
 * CSV'yi nereden alacaksiniz:
 *   Shop Manager > Settings > Options > Download Data
 *   > "Currently for Sale Listings" > Download CSV
 *   (Masaustu tarayici gerekiyor, mobil uygulamada bu sekme yok.)
 *
 *   node scrape_csv.js ~/Downloads/EtsyListingsDownload.csv
 *   node scrape_csv.js ~/Downloads/EtsyListingsDownload.csv --shop-url https://www.etsy.com/shop/IinspirationalI
 */
import fs from "node:fs/promises";
import { parseArgs, runMain } from "./lib/cli.js";
import { parseCsvRecords } from "./lib/csv.js";
import { auditListing, summarizeIssues } from "./lib/rules.js";
import { writeJson, paths } from "./lib/store.js";
import { log } from "./lib/log.js";

/** Etsy sutun adlarini zaman zaman degistiriyor; her alan icin aday listesi tutuyoruz. */
const COLUMNS = {
  title: ["TITLE"],
  description: ["DESCRIPTION"],
  price: ["PRICE"],
  currency: ["CURRENCY_CODE", "CURRENCY CODE"],
  quantity: ["QUANTITY"],
  tags: ["TAGS"],
  materials: ["MATERIALS"],
  sku: ["SKU"],
};

function pick(record, candidates) {
  for (const key of candidates) {
    if (record[key] !== undefined && record[key] !== "") return record[key];
  }
  return "";
}

function splitList(value) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function collectImages(record) {
  const images = [];
  for (let index = 1; index <= 10; index += 1) {
    const url = record[`IMAGE${index}`] ?? record[`IMAGE ${index}`] ?? "";
    if (url) images.push({ url_fullxfull: url });
  }
  return images;
}

function slugify(title) {
  return title
    .toLocaleLowerCase("tr")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Etsy'nin listing CSV'sinde listing_id sutunu YOK. Bu yuzden kararli bir
 * yerel anahtar uretiyoruz: once SKU, yoksa basliktan slug. "csv:" oneki
 * apply.js'in bu kayitlari Etsy'ye yazmaya calismasini engelliyor - gercek
 * listing_id olmadan guncelleme yapilamaz.
 */
function makeKey(record, title, position) {
  const sku = pick(record, COLUMNS.sku);
  if (sku) return `csv:sku-${sku}`;
  const slug = slugify(title);
  return slug ? `csv:${slug}` : `csv:row-${position + 1}`;
}

async function main() {
  const args = parseArgs();
  const file = args._[0] ?? args.file ?? args.input;

  if (!file || file === true) {
    throw new Error(
      "CSV dosyasi belirtilmedi.\n" +
        "  node scrape_csv.js ~/Downloads/EtsyListingsDownload.csv\n\n" +
        "CSV'yi indirmek icin: Shop Manager > Settings > Options > Download Data\n" +
        '  > "Currently for Sale Listings" > Download CSV',
    );
  }

  let text;
  try {
    text = await fs.readFile(String(file), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Dosya bulunamadi: ${file}`);
    throw error;
  }

  const { headers, records } = parseCsvRecords(text);

  if (!headers.includes("TITLE")) {
    throw new Error(
      `Bu CSV bir Etsy listing export'una benzemiyor (TITLE sutunu yok).\n` +
        `Bulunan sutunlar: ${headers.join(", ") || "(bos)"}\n` +
        `"Currently for Sale Listings" CSV'sini indirdiginizden emin olun - ` +
        `"Sold Orders" CSV'si farkli bir dosya.`,
    );
  }

  const shopUrl = typeof args["shop-url"] === "string" ? args["shop-url"].replace(/\/+$/, "") : null;

  const listings = records.map((record, position) => {
    const title = pick(record, COLUMNS.title);
    const description = pick(record, COLUMNS.description);
    const tags = splitList(pick(record, COLUMNS.tags));

    return {
      listing_id: makeKey(record, title, position),
      source: "csv",
      title,
      description,
      tags,
      materials: splitList(pick(record, COLUMNS.materials)),
      sku: pick(record, COLUMNS.sku) || null,
      price: pick(record, COLUMNS.price) || null,
      currency_code: pick(record, COLUMNS.currency) || null,
      quantity: pick(record, COLUMNS.quantity) || null,
      images: collectImages(record),
      // CSV'de listing URL'si yok; pin linki icin magaza sayfasina dusuyoruz.
      url: shopUrl,
      audit: auditListing({ title, description, tags }),
    };
  });

  const flagged = listings.filter((listing) => listing.audit.length > 0);
  const withoutImages = listings.filter((listing) => listing.images.length === 0);

  await writeJson(paths.listings, {
    source: "csv",
    source_file: String(file),
    fetched_at: new Date().toISOString(),
    count: listings.length,
    listings,
  });

  log.ok(`${listings.length} listing okundu: ${paths.listings}`);
  log.info(`${flagged.length} listingde kural ihlali var.`);

  for (const listing of flagged.slice(0, 5)) {
    log.plain(`  ${(listing.title ?? "").slice(0, 45).padEnd(45)} ${log.dim(summarizeIssues(listing.audit))}`);
  }
  if (flagged.length > 5) log.plain(log.dim(`  ... ve ${flagged.length - 5} listing daha`));

  log.plain("");
  log.warn("CSV kaynakli veride listing_id yok. Bunun iki sonucu var:");
  log.plain("  - apply.js bu kayitlari Etsy'ye YAZAMAZ (API onayi gerekiyor).");
  log.plain("    Optimize edilmis metinleri plandan elle yapistiracaksiniz.");
  if (!shopUrl) {
    log.plain("  - Pin linkleri bos kalir. --shop-url ile magaza adresinizi verin.");
  }
  if (withoutImages.length > 0) {
    log.plain(`  - ${withoutImages.length} listingde gorsel URL'si yok, pinlenemez.`);
  }

  log.plain("");
  log.info("Sonraki adim: node optimize_all.js");
}

runMain(main);
