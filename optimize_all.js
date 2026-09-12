#!/usr/bin/env node
/**
 * optimize_all.js - Tum listingleri toplu optimize eder ve bir optimizasyon plani cikarir.
 *
 * Yarim kalan is devam ettirilebilir: daha once optimize edilmis listingler
 * varsayilan olarak atlanir (--force ile yeniden islenir).
 *
 *   node optimize_all.js
 *   node optimize_all.js --concurrency 5
 *   node optimize_all.js --limit 10 --only-flagged
 *   node optimize_all.js --input new-listings.json
 *   node optimize_all.js --force
 */
import { parseArgs, asNumber, runMain } from "./lib/cli.js";
import { requireConfig, config } from "./lib/config.js";
import { optimizeListing, mapWithConcurrency } from "./lib/claude.js";
import { readJson, writeJson, writeText, paths } from "./lib/store.js";
import { log, progress } from "./lib/log.js";

function buildPlan(results, failures) {
  const lines = [];
  const now = new Date().toISOString();

  lines.push("# Etsy Optimizasyon Plani");
  lines.push("");
  lines.push(`Olusturulma: ${now}`);
  lines.push(`Model: ${config.claude.model}`);
  lines.push(`Islenen listing: ${results.length}${failures.length ? ` (${failures.length} hata)` : ""}`);
  lines.push("");
  lines.push("> Tag'ler bu planda bilerek yer almiyor. Tag yazimi eRank / Marmalead gibi");
  lines.push("> araclarla arama hacmi ve rekabet analizi gerektiriyor - bu is sizde.");
  lines.push("");

  const titleFixes = results.filter((result) => result.optimized.title_changed);
  const descFixes = results.filter((result) => result.optimized.description_changed);
  const attrGaps = results.filter((result) => result.optimized.missing_attributes.length > 0);
  const stillBroken = results.filter((result) => result.issues_after.length > 0);

  lines.push("## Ozet");
  lines.push("");
  lines.push(`| Konu | Listing sayisi |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Baslik degisti | ${titleFixes.length} |`);
  lines.push(`| Aciklama degisti | ${descFixes.length} |`);
  lines.push(`| Eksik attribute var | ${attrGaps.length} |`);
  lines.push(`| Optimizasyondan sonra hala kural ihlali | ${stillBroken.length} |`);
  lines.push("");

  if (stillBroken.length > 0) {
    lines.push("## Elle kontrol gerekenler");
    lines.push("");
    for (const result of stillBroken) {
      lines.push(`### ${result.listing_id}`);
      lines.push("");
      for (const issue of result.issues_after) lines.push(`- ${issue.message}`);
      lines.push("");
    }
  }

  if (attrGaps.length > 0) {
    lines.push("## Eksik attribute'lar");
    lines.push("");
    for (const result of attrGaps) {
      lines.push(`### ${result.listing_id} - ${result.optimized.title.slice(0, 60)}`);
      lines.push("");
      for (const attribute of result.optimized.missing_attributes) {
        const value = attribute.suggested_value ? ` \`${attribute.suggested_value}\`` : " _(deger onerilmedi)_";
        lines.push(`- **${attribute.name}**:${value} - ${attribute.reason}`);
      }
      lines.push("");
    }
  }

  const tagNotes = results.filter((result) => result.optimized.tag_notes.length > 0);
  if (tagNotes.length > 0) {
    lines.push("## Tag notlari (sizin isiniz)");
    lines.push("");
    for (const result of tagNotes) {
      lines.push(`### ${result.listing_id}`);
      lines.push("");
      for (const note of result.optimized.tag_notes) lines.push(`- ${note}`);
      lines.push("");
    }
  }

  lines.push("## Listing bazinda degisiklikler");
  lines.push("");
  for (const result of results) {
    lines.push(`### ${result.listing_id}`);
    lines.push("");
    lines.push(`- **Eski baslik** (${result.original.title.length}): ${result.original.title}`);
    lines.push(`- **Yeni baslik** (${result.optimized.title.length}): ${result.optimized.title}`);
    lines.push(`- **Birincil anahtar kelime**: ${result.optimized.primary_keyword}`);
    lines.push(
      `- **Aciklama**: ${result.original.description.length} -> ${result.optimized.description.length} karakter`,
    );
    for (const change of result.optimized.changes) lines.push(`  - ${change}`);
    for (const note of result.optimized.risk_notes) lines.push(`  - KONTROL: ${note}`);
    lines.push("");
  }

  if (failures.length > 0) {
    lines.push("## Hatalar");
    lines.push("");
    for (const failure of failures) {
      lines.push(`- ${failure.listing_id}: ${failure.error}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  requireConfig(["claude"]);
  const args = parseArgs();

  const input = typeof args.input === "string" ? args.input : paths.listings;
  const data = await readJson(input);
  if (!data) throw new Error(`${input} yok. Once: node scrape.js`);

  let listings = data.listings ?? [];

  if (args["only-flagged"]) {
    listings = listings.filter((listing) => (listing.audit?.length ?? 0) > 0);
    log.info(`Sadece kural ihlali olan ${listings.length} listing islenecek.`);
  }

  const store = (await readJson(paths.optimized, { results: [] })) ?? { results: [] };
  const done = new Map(store.results.map((result) => [String(result.listing_id), result]));

  if (!args.force) {
    const before = listings.length;
    listings = listings.filter((listing) => !done.has(String(listing.listing_id)));
    const skipped = before - listings.length;
    if (skipped > 0) log.info(`${skipped} listing daha once optimize edilmis, atlandi (--force ile yeniden isleyin).`);
  }

  const limit = asNumber(args.limit, Infinity);
  if (Number.isFinite(limit)) listings = listings.slice(0, limit);

  if (listings.length === 0) {
    log.ok("Islenecek listing yok.");
    return;
  }

  const concurrency = asNumber(args.concurrency, 3);
  log.step(`${listings.length} listing optimize ediliyor (es zamanlilik: ${concurrency})...`);

  const failures = [];
  let completed = 0;
  const totals = { input: 0, output: 0, cacheRead: 0 };

  const settled = await mapWithConcurrency(listings, concurrency, async (listing) => {
    try {
      const result = await optimizeListing(listing, { properties: listing.properties ?? [] });
      totals.input += result.usage.input_tokens ?? 0;
      totals.output += result.usage.output_tokens ?? 0;
      totals.cacheRead += result.usage.cache_read_input_tokens ?? 0;
      return result;
    } catch (error) {
      // Tek bir listing hatasi tum isi durdurmasin; plan sonunda raporlaniyor.
      failures.push({ listing_id: listing.listing_id, error: error.message });
      return null;
    } finally {
      completed += 1;
      progress(completed, listings.length, String(listing.listing_id));
    }
  });

  const fresh = settled.filter(Boolean);
  for (const result of fresh) done.set(String(result.listing_id), result);

  const allResults = [...done.values()];
  store.results = allResults;
  store.updated_at = new Date().toISOString();
  const optimizedFile = await writeJson(paths.optimized, store);

  const planFile = await writeText(paths.plan, buildPlan(allResults, failures));

  log.ok(`${fresh.length} listing optimize edildi, ${failures.length} hata.`);
  log.ok(`Sonuclar: ${optimizedFile}`);
  log.ok(`Plan: ${planFile}`);
  log.info(
    log.dim(
      `token toplami: ${totals.input} girdi / ${totals.output} cikti, cache okuma: ${totals.cacheRead}`,
    ),
  );

  if (failures.length > 0) {
    log.warn("Hata alan listingler:");
    for (const failure of failures.slice(0, 10)) {
      log.plain(`  ${failure.listing_id}: ${failure.error}`);
    }
  }

  log.info("Sonraki adim: node apply.js  (once kuru calisma, --yes ile gercek yazma)");
}

runMain(main);
