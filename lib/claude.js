import fs from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "./config.js";
import { ETSY_RULES, auditListing } from "./rules.js";
import { log } from "./log.js";

let client;
function getClient() {
  if (!client) {
    client = new Anthropic({
      apiKey: config.claude.apiKey,
      // Testlerde sahte sunucuya yonlendirmek icin; uretimde bos birakilir.
      baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
      // SDK 429/5xx ve baglanti hatalarini kendisi yeniden deniyor.
      maxRetries: 4,
      timeout: 10 * 60 * 1000,
    });
  }
  return client;
}

let cachedRules;
/** Kendi SEO dokumaniniz varsa ETSY_RULES_FILE ile varsayilan kurallarin yerine gecer. */
export async function loadRules() {
  if (cachedRules) return cachedRules;
  const file = process.env.ETSY_RULES_FILE;
  if (file) {
    cachedRules = await fs.readFile(file, "utf8");
    log.info(`SEO kurallari ${file} dosyasindan yuklendi`);
  } else {
    cachedRules = ETSY_RULES;
  }
  return cachedRules;
}

const OptimizationSchema = z.object({
  title: z.string().describe("Yeniden yazilmis baslik. Degisiklik gerekmiyorsa mevcut baslik."),
  description: z
    .string()
    .describe("Yeniden yazilmis aciklama. Degisiklik gerekmiyorsa mevcut aciklama."),
  primary_keyword: z.string().describe("Bu listing icin secilen birincil anahtar kelime ifadesi."),
  title_changed: z.boolean(),
  description_changed: z.boolean(),
  missing_attributes: z
    .array(
      z.object({
        name: z.string().describe("Eksik attribute adi, orn. 'Ana renk'."),
        suggested_value: z
          .string()
          .describe("Listing metninden kesin cikarilabiliyorsa deger, yoksa bos string."),
        reason: z.string(),
      }),
    )
    .describe("Uydurma deger yok; yalnizca metinden dogrulanabilenler."),
  tag_notes: z
    .array(z.string())
    .describe("Tag'lerle ilgili gozlemler. TAG ONERME - sadece sorunlari bildir."),
  changes: z.array(z.string()).describe("Yapilan degisikliklerin kisa listesi."),
  risk_notes: z.array(z.string()).describe("Emin olunamayan noktalar, insan kontrolu gerekenler."),
});

function buildListingBrief(listing, properties = []) {
  const tags = listing.tags ?? [];
  const attributes = properties.map((property) => ({
    name: property.property_name,
    values: property.values,
  }));

  return JSON.stringify(
    {
      listing_id: listing.listing_id,
      title: listing.title,
      description: listing.description,
      tags,
      materials: listing.materials ?? [],
      taxonomy_id: listing.taxonomy_id,
      price: listing.price,
      who_made: listing.who_made,
      when_made: listing.when_made,
      current_attributes: attributes,
    },
    null,
    2,
  );
}

/**
 * Tek bir listingi optimize eder.
 *
 * Prompt cache notu: sistem promptu (kurallar) her istekte birebir ayni - bu sayede
 * ilk cagridan sonraki her listing kurallari cache'ten okuyor. Degisken olan tek sey
 * user mesajindaki listing verisi, yani cache prefix'i hic bozulmuyor.
 */
export async function optimizeListing(listing, { properties = [], model = config.claude.model } = {}) {
  const rules = await loadRules();

  const response = await getClient().messages.parse({
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: rules,
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ],
    messages: [
      {
        role: "user",
        content:
          "Asagidaki Etsy listingini yukaridaki kurallara gore optimize et.\n" +
          "Tag URETME. Attribute degerlerini uydurma.\n\n" +
          buildListingBrief(listing, properties),
      },
    ],
    output_config: { format: zodOutputFormat(OptimizationSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      `Model bu listingi isleyemedi (${response.stop_details?.category ?? "refusal"}): ` +
        `${listing.listing_id}`,
    );
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error(`Listing ${listing.listing_id} icin yapisal cikti ayristirilamadi.`);
  }

  // Modelin ciktisini da ayni denetciden geciriyoruz: kurala uymayan oneri
  // sessizce ilerlemesin, planda gorunsun.
  const issuesBefore = auditListing({
    title: listing.title ?? "",
    description: listing.description ?? "",
    tags: listing.tags ?? [],
  });
  const issuesAfter = auditListing({
    title: parsed.title,
    description: parsed.description,
    tags: listing.tags ?? [],
  });

  return {
    listing_id: listing.listing_id,
    original: {
      title: listing.title ?? "",
      description: listing.description ?? "",
    },
    optimized: parsed,
    issues_before: issuesBefore,
    issues_after: issuesAfter,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
    },
    model,
    optimized_at: new Date().toISOString(),
  };
}

/** Sinirli es zamanlilikla calisan basit havuz. Etsy/Anthropic limitlerini zorlamamak icin. */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
