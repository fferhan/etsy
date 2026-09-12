/**
 * Deger almayan bayraklar. Bunlar bir sonraki argumani yutmaz, boylece
 * "apply.js --yes listings.json" gibi kullanimlar yanlis ayristirilmaz.
 */
const BOOLEAN_FLAGS = new Set([
  "yes",
  "force",
  "save",
  "boards",
  "whoami",
  "optimized",
  "no-merge",
  "only-flagged",
  "with-properties",
  "title-only",
  "description-only",
]);

/**
 * Bagimliliksiz, kucuk argv ayristirici.
 * Destekledigi bicimler: --key=value, --key value, --flag
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (!token.startsWith("-")) {
      args._.push(token);
      continue;
    }

    const raw = token.replace(/^--?/, "");
    const eq = raw.indexOf("=");

    if (eq !== -1) {
      args[raw.slice(0, eq)] = raw.slice(eq + 1);
      continue;
    }

    const next = argv[i + 1];
    if (!BOOLEAN_FLAGS.has(raw) && next !== undefined && !next.startsWith("-")) {
      args[raw] = next;
      i += 1;
    } else {
      args[raw] = true;
    }
  }

  return args;
}

export function asNumber(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function asList(value) {
  if (value === undefined || value === true) return [];
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Komutlarin ortak hata cikisi: yigin izi degil, okunabilir mesaj. */
export function runMain(main) {
  main().catch((error) => {
    console.error(`\nHATA: ${error.message}`);
    if (process.env.DEBUG) console.error(error);
    process.exitCode = 1;
  });
}
