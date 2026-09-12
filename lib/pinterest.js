import { config } from "./config.js";
import { log } from "./log.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

async function request(pathname, { method = "GET", body } = {}) {
  const url = `${config.pinterest.baseUrl}${pathname}`;
  const headers = {
    Authorization: `Bearer ${config.pinterest.accessToken}`,
    "Content-Type": "application/json",
  };

  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (attempt === maxAttempts) throw new Error(`Pinterest baglanti hatasi: ${error.message}`);
      await sleep(2 ** attempt * 500);
      continue;
    }

    if (response.ok) return response.json();

    const text = await response.text();

    if (RETRYABLE.has(response.status) && attempt < maxAttempts) {
      const waitMs = response.status === 429 ? 60_000 : 2 ** attempt * 500;
      log.warn(`Pinterest ${response.status} - ${Math.round(waitMs / 1000)}sn bekleniyor`);
      await sleep(waitMs);
      continue;
    }

    throw new Error(`Pinterest ${response.status} ${method} ${pathname}: ${text}`);
  }

  throw new Error(`Pinterest istegi ${maxAttempts} denemede tamamlanamadi: ${pathname}`);
}

export async function listBoards() {
  const result = await request("/boards?page_size=100");
  return result?.items ?? [];
}

/**
 * Tek bir pin olusturur.
 * @param {{title: string, description: string, link: string, imageUrl: string, boardId?: string}} pin
 */
export async function createPin({ title, description, link, imageUrl, boardId }) {
  return request("/pins", {
    method: "POST",
    body: {
      board_id: boardId || config.pinterest.boardId,
      title: title.slice(0, 100),
      description: description.slice(0, 800),
      link,
      media_source: { source_type: "image_url", url: imageUrl },
    },
  });
}

/**
 * Listingden pin metni uretir. Pinterest basligi 100, aciklamasi 800 karakterle sinirli.
 * Aciklamanin ilk cumleleri aliniyor; markdown/HTML temizleniyor.
 */
export function pinContentFromListing(listing) {
  const title = (listing.title ?? "").slice(0, 100);
  const plain = (listing.description ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { title, description: plain.slice(0, 480) };
}
