import { config } from "./config.js";

/**
 * Etsy 2025-2026 algoritma kurallari.
 *
 * Bu metin Claude'a SISTEM PROMPTU olarak, degismeyen bir on-ek halinde gonderilir
 * (prompt cache'e alinir). Kendi SEO dokumaniniz varsa ETSY_RULES_FILE ortam
 * degiskeniyle bu metnin yerine kendi dosyanizi koyabilirsiniz.
 */
export const ETSY_RULES = `Sen Etsy SEO uzmanisin. Etsy'nin 2025-2026 arama algoritmasina gore
listing metinlerini yeniden yaziyorsun.

BASLIK KURALLARI
- Baslik ${config.limits.maxTitleLength} karakterin altinda olmali.
- Dogal dille yazilmali; virgul/tire ile ayrilmis anahtar kelime yigini OLMAMALI.
- En onemli urun ifadesi ilk ${config.limits.leadKeywordWindow} karaktere girmeli
  (ideali ilk 30-40 karakter araligi).
- Ayni kelime baslikta tekrar etmemeli (cogul/tekil varyantlar dahil).
- Alici gibi ara: insanlarin gercekten aradigi ifadeleri kullan, katalog jargonu degil.
- ALL CAPS, asiri emoji ve alakasiz "trend" kelimeler kullanma.

ACIKLAMA KURALLARI
- Aciklama en az ${config.limits.minDescriptionLength} karakter olmali.
- Birincil anahtar kelime ilk ${config.limits.metaDescriptionWindow} karakterde gecmeli
  (bu bolum arama motorlarinda meta description olarak kullaniliyor).
- Yapi: acilis kancasi -> urun detaylari -> olculer/malzeme -> kullanim/hediye senaryolari
  -> kargo ve isleme suresi -> bakim talimatlari -> magazaya davet.
- Kisa paragraflar ve madde isaretleri kullan; tek blok metin yazma.
- Anahtar kelimeleri cumle icinde dogal sekilde gecir; listeleme yapma.
- Gercek olmayan iddia (sertifika, odul, garanti, "en cok satan") UYDURMA.

ATTRIBUTE KURALLARI
- Attribute'lar Etsy filtrelerini besliyor; eksik attribute gorunurluk kaybi demek.
- Eksik ya da yanlis gorunen attribute'lari tespit et ve sebebiyle birlikte listele.
- Attribute degerlerini UYDURMA; yalnizca listing metninden kesin cikarilabilenleri oner.

TAG KURALLARI - COK ONEMLI
- TAG YAZMA. Tag'ler eRank/Marmalead gibi araclarla arama hacmi ve rekabet
  analizi gerektiriyor; bu veri sende yok.
- Tag alanina dair tek yapman gereken: mevcut tag'lerde bariz sorun varsa
  (bos slot, baslikla birebir tekrar, 20 karakteri asan tag) bunu NOT olarak bildir.

GENEL
- Cikti dili girdi listinginin diliyle AYNI olmali.
- Mevcut metin zaten kurallara uyuyorsa degistirme; degisiklik onermeyi zorlama.
- Urun hakkinda bilmedigin bir seyi uydurmaktansa mevcut ifadeyi koru.`;

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

function words(text) {
  return text
    .toLocaleLowerCase("tr")
    .split(WORD_SPLIT)
    .filter((word) => word.length > 2);
}

/** Basit tekil/cogul normalizasyonu - "mug" ile "mugs" ayni sayilsin diye. */
function stem(word) {
  return word.replace(/(lari|leri|lar|ler|es|s)$/u, "");
}

/**
 * Bir listingi kurallara gore denetler ve ihlalleri dondurur.
 * Claude'un ciktisini da ayni fonksiyonla dogruluyoruz: model kurala uymayan
 * bir baslik uretirse bunu sessizce gecirmiyoruz.
 */
export function auditListing({ title = "", description = "", tags = [] }) {
  const issues = [];
  const { maxTitleLength, minDescriptionLength, leadKeywordWindow, metaDescriptionWindow } =
    config.limits;

  if (title.length > maxTitleLength) {
    issues.push({
      field: "title",
      code: "title_too_long",
      message: `Baslik ${title.length} karakter, sinir ${maxTitleLength}.`,
    });
  }

  const stems = words(title).map(stem);
  const seen = new Set();
  const repeated = new Set();
  for (const word of stems) {
    if (seen.has(word)) repeated.add(word);
    seen.add(word);
  }
  if (repeated.size > 0) {
    issues.push({
      field: "title",
      code: "title_repeated_words",
      message: `Baslikta tekrar eden kelime(ler): ${[...repeated].join(", ")}.`,
    });
  }

  const separators = (title.match(/[,|]/g) ?? []).length;
  if (separators >= 4) {
    issues.push({
      field: "title",
      code: "title_keyword_spam",
      message: `Baslikta ${separators} ayirici var - anahtar kelime yigini gorunumu.`,
    });
  }

  if (title.length > 0 && title.slice(0, leadKeywordWindow).trim().split(WORD_SPLIT).length < 2) {
    issues.push({
      field: "title",
      code: "title_weak_lead",
      message: `Ilk ${leadKeywordWindow} karakterde anlamli bir urun ifadesi yok.`,
    });
  }

  const plain = description.replace(/\s+/g, " ").trim();
  if (plain.length < minDescriptionLength) {
    issues.push({
      field: "description",
      code: "description_too_short",
      message: `Aciklama ${plain.length} karakter, hedef ${minDescriptionLength}+.`,
    });
  }

  // Baslikta gecen ana ifadenin aciklamanin ilk 160 karakterinde de gecmesi bekleniyor.
  const leadWords = words(title.slice(0, leadKeywordWindow)).map(stem);
  const metaWords = new Set(words(plain.slice(0, metaDescriptionWindow)).map(stem));
  const hit = leadWords.some((word) => metaWords.has(word));
  if (leadWords.length > 0 && !hit) {
    issues.push({
      field: "description",
      code: "description_missing_primary_keyword",
      message: `Birincil anahtar kelime aciklamanin ilk ${metaDescriptionWindow} karakterinde gecmiyor.`,
    });
  }

  // Tag'leri yazmiyoruz ama durumlarini raporluyoruz.
  if (tags.length < 13) {
    issues.push({
      field: "tags",
      code: "tags_incomplete",
      severity: "manual",
      message: `${tags.length}/13 tag dolu. Kalan slotlari SEO arastirmasiyla siz doldurun.`,
    });
  }
  const titleStems = new Set(stems);
  const duplicateTags = tags.filter((tag) =>
    words(tag).map(stem).every((word) => titleStems.has(word)),
  );
  if (duplicateTags.length > 0) {
    issues.push({
      field: "tags",
      code: "tags_duplicate_title",
      severity: "manual",
      message: `Baslikla birebir ortusen tag(ler): ${duplicateTags.join(", ")}.`,
    });
  }

  return issues;
}

/** Denetimi tek satirlik ozet halinde verir. */
export function summarizeIssues(issues) {
  if (issues.length === 0) return "kural ihlali yok";
  return issues.map((issue) => issue.code).join(", ");
}
