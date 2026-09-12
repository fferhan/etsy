#!/usr/bin/env node
/**
 * pin_remaining.js - Henuz pinlenmemis listingleri paylasir.
 *
 * pinterest_post.js ile ayni isi yapar, farki: data/pinned.json'da kayitli olan
 * hicbir listinge dokunmaz. Gunluk/parcali paylasim icin bunu kullanin -
 * bir seferde limit kadar paylasir, kaldigi yerden devam eder.
 *
 *   node pin_remaining.js                 # kac tane kaldigini goster
 *   node pin_remaining.js --yes --limit 20
 *   node pin_remaining.js --yes --optimized
 */
import { parseArgs, runMain } from "./lib/cli.js";
import { runPinJob } from "./pinterest_post.js";

runMain(async () => {
  const args = parseArgs();
  // --id burada anlamsiz: bu komut tanimi geregi "kalanlar" uzerinde calisiyor.
  delete args.id;
  return runPinJob(args, { onlyRemaining: true });
});
