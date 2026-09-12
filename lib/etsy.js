import { config } from "./config.js";
import { log } from "./log.js";

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Etsy Open API v3 istegi. 429/5xx durumlarinda ustel geri cekilme ile yeniden dener,
 * Retry-After basligi varsa ona uyar.
 */
async function request(pathname, { method = "GET", query, body, auth = "key" } = {}) {
  const url = new URL(`${config.etsy.baseUrl}${pathname}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const headers = { "x-api-key": config.etsy.apiKey };
  if (auth === "oauth") {
    if (!config.etsy.accessToken) {
      throw new Error(`${pathname} icin ETSY_ACCESS_TOKEN gerekli (OAuth2).`);
    }
    headers.Authorization = `Bearer ${config.etsy.accessToken}`;
  } else if (config.etsy.accessToken) {
    // Token varsa okuma isteklerinde de gonderiyoruz: draft/inactive listingler
    // yalnizca yetkili istekte donuyor.
    headers.Authorization = `Bearer ${config.etsy.accessToken}`;
  }

  let payload;
  if (body) {
    // Etsy v3 yazma uclari form-urlencoded bekliyor, JSON degil.
    payload = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined || value === null) continue;
      payload.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { method, headers, body: payload });
    } catch (error) {
      if (attempt === maxAttempts) throw new Error(`Etsy baglanti hatasi: ${error.message}`);
      await sleep(2 ** attempt * 500);
      continue;
    }

    if (response.ok) {
      return response.status === 204 ? null : response.json();
    }

    const text = await response.text();

    if (RETRYABLE.has(response.status) && attempt < maxAttempts) {
      const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
      const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 2 ** attempt * 500;
      log.warn(`Etsy ${response.status} - ${Math.round(waitMs / 1000)}sn sonra tekrar denenecek`);
      await sleep(waitMs);
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Etsy yetki hatasi (${response.status}) ${pathname}: ${text}\n` +
          "ETSY_ACCESS_TOKEN suresi dolmus ya da gerekli scope (listings_r / listings_w) yok olabilir.",
      );
    }

    throw new Error(`Etsy ${response.status} ${method} ${pathname}: ${text}`);
  }

  throw new Error(`Etsy istegi ${maxAttempts} denemede tamamlanamadi: ${pathname}`);
}

/** Token sahibini ve magazalarini dondurur. ETSY_SHOP_ID'yi bulmak icin. */
export async function getMe() {
  return request("/users/me", { auth: "oauth" });
}

export async function getShop(shopId = config.etsy.shopId) {
  return request(`/shops/${shopId}`);
}

/**
 * Magazanin tum listinglerini sayfa sayfa ceker.
 * @param {{state?: string, limit?: number, includes?: string[]}} options
 */
export async function fetchAllListings({ state = "active", limit = Infinity, includes = ["Images"] } = {}) {
  const shopId = config.etsy.shopId;
  const pageSize = 100;
  const listings = [];
  let offset = 0;

  for (;;) {
    const page = await request(`/shops/${shopId}/listings`, {
      auth: "oauth",
      query: {
        state,
        limit: Math.min(pageSize, limit - listings.length),
        offset,
        includes: includes.join(","),
      },
    });

    const results = page?.results ?? [];
    listings.push(...results);

    const total = page?.count ?? listings.length;
    log.info(`${listings.length}/${total} listing cekildi`);

    if (results.length < pageSize || listings.length >= Math.min(limit, total)) break;
    offset += pageSize;
  }

  return listings;
}

/** Bir listingin attribute (ozellik) degerleri. Eksik attribute tespiti icin sart. */
export async function fetchListingProperties(listingId, shopId = config.etsy.shopId) {
  try {
    const result = await request(`/shops/${shopId}/listings/${listingId}/properties`, {
      auth: "oauth",
    });
    return result?.results ?? [];
  } catch (error) {
    // Attribute ucunu desteklemeyen kategoriler 404 donuyor; bu olumcul degil.
    log.warn(`Listing ${listingId} attribute'lari alinamadi: ${error.message}`);
    return [];
  }
}

/**
 * Listing gunceller. Yalnizca verilen alanlar gonderilir (PATCH semantigi).
 * Not: tag'ler bilerek desteklenmiyor - tag yazimi SEO arastirmasi gerektiriyor
 * ve bu arac tag'lere dokunmuyor.
 */
export async function updateListing(listingId, fields, shopId = config.etsy.shopId) {
  const allowed = ["title", "description", "materials", "who_made", "when_made", "taxonomy_id"];
  const body = {};
  for (const key of allowed) {
    if (fields[key] !== undefined) body[key] = fields[key];
  }

  if (Object.keys(body).length === 0) {
    throw new Error(`Listing ${listingId} icin guncellenecek alan yok.`);
  }

  return request(`/shops/${shopId}/listings/${listingId}`, {
    method: "PATCH",
    auth: "oauth",
    body,
  });
}

/**
 * Listing'in Etsy uzerindeki herkese acik URL'si.
 * CSV kaynakli kayitlarda gercek listing_id olmadigi icin URL uydurulamaz;
 * o durumda scrape_csv.js --shop-url ile verilen magaza adresi kullanilir.
 */
export function listingUrl(listing) {
  if (listing.url) return listing.url;
  if (/^\d+$/.test(String(listing.listing_id))) {
    return `https://www.etsy.com/listing/${listing.listing_id}`;
  }
  return null;
}

/** Listing'in birincil gorsel URL'si (Pinterest pin'i icin). */
export function primaryImageUrl(listing) {
  const images = listing.images ?? listing.Images ?? [];
  const first = images[0];
  if (!first) return null;
  return first.url_fullxfull || first.url_570xN || first.url_680x540 || null;
}
