/**
 * Uctan uca smoke test: sahte Etsy/Pinterest/Anthropic sunucusuna karsi
 * scrape -> optimize_all -> apply -> pin zincirini calistirir.
 *
 *   node test/run.js
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createMockServer } from "./mock-server.js";

const run = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${error.message}`);
  }
}

// --- Birim testleri ---

async function unitTests() {
  console.log("\nbirim testleri");

  const { parseArgs, asNumber, asList } = await import("../lib/cli.js");
  await test("parseArgs --key=value, --key value ve bayrak bicimlerini ayirir", () => {
    const args = parseArgs(["--id=42", "--limit", "5", "--yes", "pos"]);
    assert.equal(args.id, "42");
    assert.equal(args.limit, "5");
    assert.equal(args.yes, true);
    assert.deepEqual(args._, ["pos"]);
  });
  await test("asNumber ve asList yardimcilari", () => {
    assert.equal(asNumber("7", 0), 7);
    assert.equal(asNumber(undefined, 3), 3);
    assert.deepEqual(asList("a, b ,c"), ["a", "b", "c"]);
    assert.deepEqual(asList(true), []);
  });

  const { auditListing } = await import("../lib/rules.js");
  await test("auditListing baslikta tekrar eden kelimeyi yakalar", () => {
    const issues = auditListing({
      title: "Ceramic Mug, ceramic mugs, mug",
      description: "x".repeat(1200),
      tags: [],
    });
    const codes = issues.map((issue) => issue.code);
    assert.ok(codes.includes("title_repeated_words"), `beklenmedik: ${codes}`);
  });
  await test("auditListing kisa aciklamayi ve uzun basligi yakalar", () => {
    const issues = auditListing({ title: "x".repeat(120), description: "kisa", tags: [] });
    const codes = issues.map((issue) => issue.code);
    assert.ok(codes.includes("title_too_long"));
    assert.ok(codes.includes("description_too_short"));
  });
  await test("auditListing eksik tag slotlarini 'manual' olarak isaretler", () => {
    const issues = auditListing({ title: "Ceramic Mug", description: "x".repeat(1200), tags: ["a"] });
    const tagIssue = issues.find((issue) => issue.code === "tags_incomplete");
    assert.ok(tagIssue, "tags_incomplete bekleniyordu");
    assert.equal(tagIssue.severity, "manual");
  });
  await test("auditListing temiz bir listingde bloklayici ihlal uretmez", () => {
    const issues = auditListing({
      title: "Ceramic Coffee Mug Handmade Stoneware Gift",
      description: `Ceramic coffee mug el yapimi. ${"Detay metni. ".repeat(90)}`,
      tags: Array.from({ length: 13 }, (_, i) => `etiket ${i}`),
    });
    const blocking = issues.filter((issue) => issue.severity !== "manual");
    assert.deepEqual(blocking, [], `bloklayici ihlal: ${JSON.stringify(blocking)}`);
  });

  const { primaryImageUrl, listingUrl } = await import("../lib/etsy.js");
  await test("primaryImageUrl gorsel yoksa null doner", () => {
    assert.equal(primaryImageUrl({ images: [] }), null);
    assert.equal(primaryImageUrl({ images: [{ url_570xN: "a.jpg" }] }), "a.jpg");
  });
  await test("listingUrl url alani yoksa kurar", () => {
    assert.equal(listingUrl({ listing_id: 9 }), "https://www.etsy.com/listing/9");
  });

  const { parseCsvRecords } = await import("../lib/csv.js");
  await test("parseCsv tirnakli alan, gomulu virgul ve satir sonunu dogru okur", () => {
    const sample =
      'TITLE,DESCRIPTION,TAGS\n' +
      '"Mug, ceramic","Satir bir\nSatir iki ""tirnakli""","a,b,c"\n';
    const { headers, records } = parseCsvRecords(sample);
    assert.deepEqual(headers, ["TITLE", "DESCRIPTION", "TAGS"]);
    assert.equal(records[0].TITLE, "Mug, ceramic");
    assert.ok(records[0].DESCRIPTION.includes("\n"));
    assert.ok(records[0].DESCRIPTION.includes('"tirnakli"'));
  });

  const { selectPinnable } = await import("../pinterest_post.js");
  await test("selectPinnable gorselsiz ve pinlenmis listingleri ayirir", () => {
    const { pinnable, skipped } = selectPinnable(
      [
        { listing_id: 1, images: [{ url_fullxfull: "a.jpg" }] },
        { listing_id: 2, images: [] },
        { listing_id: 3, images: [{ url_fullxfull: "c.jpg" }] },
      ],
      new Set(["3"]),
    );
    assert.deepEqual(pinnable.map((item) => item.listing.listing_id), [1]);
    assert.deepEqual(skipped.map((item) => item.reason).sort(), [
      "daha once pinlendi",
      "gorsel URL'si yok",
    ]);
  });
  await test("selectPinnable linki olmayan CSV kaydini atlar", () => {
    const { pinnable, skipped } = selectPinnable(
      [{ listing_id: "csv:mug", images: [{ url_fullxfull: "a.jpg" }], url: null }],
      new Set(),
    );
    assert.deepEqual(pinnable, []);
    assert.equal(skipped[0].reason, "link yok (--shop-url verin)");
  });
}

// --- Uctan uca test ---

async function e2eTests() {
  console.log("\nuctan uca test (sahte API)");

  const mock = createMockServer({ listingCount: 3 });
  const urls = await mock.start();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "etsy-test-"));

  const env = {
    ...process.env,
    DATA_DIR: dataDir,
    ETSY_BASE_URL: urls.etsy,
    PINTEREST_BASE_URL: urls.pinterest,
    ANTHROPIC_BASE_URL: urls.anthropic,
    ETSY_API_KEY: "test-key",
    ETSY_ACCESS_TOKEN: "test-token",
    ETSY_SHOP_ID: "555",
    ANTHROPIC_API_KEY: "test-anthropic",
    PINTEREST_ACCESS_TOKEN: "test-pinterest",
    PINTEREST_BOARD_ID: "board_1",
    NO_COLOR: "1",
  };

  const exec = (script, args = []) => run("node", [path.join(root, script), ...args], { env, cwd: root });
  const readData = async (name) => JSON.parse(await fs.readFile(path.join(dataDir, name), "utf8"));

  try {
    await test("scrape.js listingleri ceker ve denetler", async () => {
      await exec("scrape.js");
      const data = await readData("listings.json");
      assert.equal(data.count, 3);
      assert.ok(data.listings[0].audit.length > 0, "denetim sonucu bekleniyordu");
    });

    await test("scrape_new.js ikinci calistirmada yeni listing bulmaz", async () => {
      await exec("scrape_new.js");
      const delta = await readData("new-listings.json");
      assert.equal(delta.added_count, 0);
      assert.equal(delta.changed_count, 0);
    });

    await test("optimize_all.js sonuclari ve plani yazar", async () => {
      await exec("optimize_all.js", ["--concurrency", "2"]);
      const store = await readData("optimized.json");
      assert.equal(store.results.length, 3);
      assert.ok(store.results[0].optimized.title.length <= 70);
      const plan = await fs.readFile(path.join(dataDir, "optimization-plan.md"), "utf8");
      assert.ok(plan.includes("# Etsy Optimizasyon Plani"));
      assert.ok(plan.includes("Tag'ler bu planda bilerek yer almiyor"));
    });

    await test("optimize_all.js ikinci calistirmada islenmisleri atlar", async () => {
      const before = mock.state.messageRequests.length;
      await exec("optimize_all.js");
      assert.equal(mock.state.messageRequests.length, before, "yeniden API cagrisi yapilmamaliydi");
    });

    await test("Claude istegi kurallari cache'lenebilir sistem promptu olarak gonderir", () => {
      const request = mock.state.messageRequests[0];
      assert.equal(request.model, "claude-opus-5");
      assert.equal(request.system[0].cache_control.type, "ephemeral");
      assert.ok(request.system[0].text.includes("TAG YAZMA"));
      assert.ok(request.output_config?.format, "yapisal cikti bekleniyordu");
    });

    await test("apply.js varsayilan olarak kuru calisir, Etsy'ye yazmaz", async () => {
      const { stdout, stderr } = await exec("apply.js");
      assert.equal(mock.state.updates.length, 0, "kuru calismada Etsy'ye yazilmamali");
      // Uyari console.warn ile basiliyor, yani stderr'e dusuyor.
      assert.ok(`${stdout}${stderr}`.includes("Kuru calisma"));
    });

    await test("apply.js --yes basligi ve aciklamayi yazar, tag'e dokunmaz", async () => {
      await exec("apply.js", ["--yes"]);
      assert.equal(mock.state.updates.length, 3);
      const fields = Object.keys(mock.state.updates[0].body);
      assert.deepEqual(fields.sort(), ["description", "title"]);
      const applied = await readData("applied.json");
      assert.equal(applied.entries.length, 3);
      assert.ok(applied.entries[0].previous.title, "geri alma icin eski baslik saklanmali");
    });

    await test("pinterest_post.js --yes pinleri paylasir ve kaydeder", async () => {
      await exec("pinterest_post.js", ["--yes", "--limit", "2"]);
      assert.equal(mock.state.pins.length, 2);
      assert.equal(mock.state.pins[0].board_id, "board_1");
      assert.ok(mock.state.pins[0].media_source.url.startsWith("https://img.example/"));
      const pinned = await readData("pinned.json");
      assert.equal(pinned.entries.length, 2);
    });

    await test("pin_remaining.js yalnizca kalan listingi pinler", async () => {
      await exec("pin_remaining.js", ["--yes"]);
      assert.equal(mock.state.pins.length, 3, "sadece 1 yeni pin eklenmeliydi");
      const pinned = await readData("pinned.json");
      assert.equal(pinned.entries.length, 3);
    });

    await test("pin_remaining.js tekrar calistirildiginda hicbir sey paylasmaz", async () => {
      await exec("pin_remaining.js", ["--yes"]);
      assert.equal(mock.state.pins.length, 3);
    });
    await test("scrape_csv.js Etsy CSV'sini okuyup listings.json uretir", async () => {
      const csv = [
        "TITLE,DESCRIPTION,PRICE,CURRENCY_CODE,QUANTITY,TAGS,MATERIALS,SKU,IMAGE1,IMAGE2",
        '"Handmade Ceramic Mug, ceramic mug, mug gift","Kisa aciklama, virgullu.\nIkinci satir.",24.00,USD,5,"ceramic mug,pottery","ceramic,glaze",SKU-1,https://img.example/1.jpg,https://img.example/1b.jpg',
        '"Linen Apron","Ikinci urunun aciklamasi.",30.00,USD,2,"apron,linen","linen",,https://img.example/2.jpg,',
      ].join("\n");
      const csvPath = path.join(dataDir, "EtsyListingsDownload.csv");
      await fs.writeFile(csvPath, csv, "utf8");

      await exec("scrape_csv.js", [csvPath, "--shop-url", "https://www.etsy.com/shop/Test"]);
      const data = await readData("listings.json");

      assert.equal(data.source, "csv");
      assert.equal(data.count, 2);
      // Gomulu virgul ve satir sonu dogru ayrismali
      assert.equal(data.listings[0].title, "Handmade Ceramic Mug, ceramic mug, mug gift");
      assert.ok(data.listings[0].description.includes("Ikinci satir."));
      assert.deepEqual(data.listings[0].tags, ["ceramic mug", "pottery"]);
      assert.equal(data.listings[0].images.length, 2);
      // SKU varsa anahtar ondan, yoksa basliktan slug
      assert.equal(data.listings[0].listing_id, "csv:sku-SKU-1");
      assert.equal(data.listings[1].listing_id, "csv:linen-apron");
      assert.ok(data.listings[0].audit.length > 0, "denetim calismali");
    });

    await test("optimize.js CSV yolunda Etsy anahtari olmadan calisir", async () => {
      // Regresyon: optimize.js eskiden etsyRead sart kosuyordu, bu da CSV
      // yolunu tamamen kullanilmaz yapiyordu (kullanicida Etsy anahtari yok).
      const csvOnlyEnv = { ...env };
      delete csvOnlyEnv.ETSY_API_KEY;
      delete csvOnlyEnv.ETSY_ACCESS_TOKEN;
      delete csvOnlyEnv.ETSY_SHOP_ID;

      const { stdout } = await run("node", [path.join(root, "optimize.js"), "--index", "0"], {
        env: csvOnlyEnv,
        cwd: root,
      });
      assert.ok(stdout.includes("YENI BASLIK"), "optimize ciktisi bekleniyordu");
    });

    await test("CSV kaynakli kayitlar optimize edilir ama apply.js onlari yazmaz", async () => {
      await exec("optimize_all.js", ["--force"]);
      const store = await readData("optimized.json");
      const csvResults = store.results.filter((result) =>
        String(result.listing_id).startsWith("csv:"),
      );
      assert.equal(csvResults.length, 2, "CSV kayitlari optimize edilmeliydi");

      const { stdout, stderr } = await exec("apply.js", ["--yes"]);
      // Onceki testlerden kalan sayisal listing_id'ler yeniden yazilabilir;
      // onemli olan hicbir CSV kaydinin Etsy'ye gitmemesi.
      const csvWrites = mock.state.updates.filter((update) =>
        String(update.listingId).startsWith("csv"),
      );
      assert.deepEqual(csvWrites, [], "CSV kaydi Etsy'ye yazilmamali");
      assert.ok(`${stdout}${stderr}`.includes("CSV kaynakli"));
    });
  } finally {
    await mock.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

await unitTests();
await e2eTests();

console.log(`\n${passed} gecti, ${failed} kaldi`);
process.exit(failed === 0 ? 0 : 1);
