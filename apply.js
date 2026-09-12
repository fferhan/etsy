#!/usr/bin/env node
/**
 * apply.js - Optimize edilmis baslik/aciklamalari Etsy'ye geri yazar.
 *
 * VARSAYILAN KURU CALISMADIR. Gercekten yazmak icin --yes gerekir.
 * Tag'lere ve fiyatlara hicbir kosulda dokunmaz.
 *
 *   node apply.js                       # ne yazilacagini goster (kuru calisma)
 *   node apply.js --yes                 # gercekten yaz
 *   node apply.js --yes --id 123456     # tek listing
 *   node apply.js --yes --limit 5       # ilk 5 listing
 *   node apply.js --yes --title-only    # sadece basliklari yaz
 *   node apply.js --yes --skip-broken=false  # kural ihlali kalanlari da yaz
 */
import { parseArgs, asNumber, runMain } from "./lib/cli.js";
import { requireConfig } from "./lib/config.js";
import { updateListing } from "./lib/etsy.js";
import { readJson, writeJson, paths } from "./lib/store.js";
import { log, progress } from "./lib/log.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildPayload(result, { titleOnly, descriptionOnly }) {
  const fields = {};
  const optimized = result.optimized;

  if (!descriptionOnly && optimized.title_changed && optimized.title !== result.original.title) {
    fields.title = optimized.title;
  }
  if (
    !titleOnly &&
    optimized.description_changed &&
    optimized.description !== result.original.description
  ) {
    fields.description = optimized.description;
  }

  return fields;
}

async function main() {
  const args = parseArgs();
  const live = args.yes === true || args.yes === "true";

  requireConfig(live ? ["etsyWrite"] : ["etsyRead"]);

  const store = await readJson(paths.optimized);
  if (!store?.results?.length) {
    throw new Error(`${paths.optimized} bos ya da yok. Once: node optimize_all.js`);
  }

  let results = store.results;

  if (args.id) {
    results = results.filter((result) => String(result.listing_id) === String(args.id));
    if (results.length === 0) throw new Error(`Listing ${args.id} optimize sonuclarinda yok.`);
  }

  // Optimizasyon sonrasi hala kural ihlali olan listingleri varsayilan olarak
  // yazmiyoruz - bunlar plan dosyasinda elle kontrol icin isaretli.
  const skipBroken = args["skip-broken"] !== "false" && args["skip-broken"] !== false;
  let skippedBroken = 0;
  if (skipBroken) {
    const before = results.length;
    results = results.filter((result) => {
      const blocking = (result.issues_after ?? []).filter((issue) => issue.severity !== "manual");
      return blocking.length === 0;
    });
    skippedBroken = before - results.length;
  }

  const titleOnly = args["title-only"] === true;
  const descriptionOnly = args["description-only"] === true;

  const jobs = [];
  for (const result of results) {
    const fields = buildPayload(result, { titleOnly, descriptionOnly });
    if (Object.keys(fields).length > 0) jobs.push({ result, fields });
  }

  const limit = asNumber(args.limit, Infinity);
  const queue = Number.isFinite(limit) ? jobs.slice(0, limit) : jobs;

  if (skippedBroken > 0) {
    log.warn(`${skippedBroken} listing kural ihlali nedeniyle atlandi (--skip-broken=false ile dahil edin).`);
  }

  if (queue.length === 0) {
    log.ok("Yazilacak degisiklik yok.");
    return;
  }

  log.step(`${queue.length} listing ${live ? "GUNCELLENECEK" : "guncellenirdi (kuru calisma)"}.`);
  log.plain("");

  for (const job of queue.slice(0, live ? 0 : 20)) {
    log.plain(`${log.bold(String(job.result.listing_id))}`);
    if (job.fields.title) {
      log.plain(`  baslik : ${job.result.original.title}`);
      log.plain(`         -> ${job.fields.title}`);
    }
    if (job.fields.description) {
      log.plain(
        `  aciklama: ${job.result.original.description.length} -> ${job.fields.description.length} karakter`,
      );
    }
  }
  if (!live && queue.length > 20) log.plain(log.dim(`... ve ${queue.length - 20} listing daha`));

  if (!live) {
    log.plain("");
    log.warn("Kuru calisma. Gercekten yazmak icin: node apply.js --yes");
    log.info("Tag'ler, fiyatlar ve gorseller hicbir kosulda degistirilmiyor.");
    return;
  }

  const applied = (await readJson(paths.applied, { entries: [] })) ?? { entries: [] };
  const failures = [];
  let done = 0;

  for (const job of queue) {
    try {
      await updateListing(job.result.listing_id, job.fields);
      applied.entries.push({
        listing_id: job.result.listing_id,
        fields: Object.keys(job.fields),
        previous: {
          title: job.result.original.title,
          description: job.result.original.description,
        },
        applied_at: new Date().toISOString(),
      });
    } catch (error) {
      failures.push({ listing_id: job.result.listing_id, error: error.message });
    }
    done += 1;
    progress(done, queue.length, String(job.result.listing_id));
    // Etsy yazma uclari agresif istegi hizla sinirliyor; araya nefes payi koyuyoruz.
    await sleep(400);
  }

  applied.updated_at = new Date().toISOString();
  const file = await writeJson(paths.applied, applied);

  log.ok(`${queue.length - failures.length} listing guncellendi. Kayit: ${file}`);
  log.info("Onceki metinler applied.json icinde duruyor - geri almak icin kullanabilirsiniz.");

  if (failures.length > 0) {
    log.warn(`${failures.length} listing guncellenemedi:`);
    for (const failure of failures) log.plain(`  ${failure.listing_id}: ${failure.error}`);
    process.exitCode = 1;
  }
}

runMain(main);
