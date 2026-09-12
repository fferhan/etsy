import "dotenv/config";
import path from "node:path";

function num(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  etsy: {
    apiKey: process.env.ETSY_API_KEY ?? "",
    accessToken: process.env.ETSY_ACCESS_TOKEN ?? "",
    shopId: process.env.ETSY_SHOP_ID ?? "",
    baseUrl: process.env.ETSY_BASE_URL || "https://openapi.etsy.com/v3/application",
  },
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    model: process.env.CLAUDE_MODEL || "claude-opus-5",
  },
  pinterest: {
    accessToken: process.env.PINTEREST_ACCESS_TOKEN ?? "",
    boardId: process.env.PINTEREST_BOARD_ID ?? "",
    baseUrl: process.env.PINTEREST_BASE_URL || "https://api.pinterest.com/v5",
  },
  dataDir: path.resolve(process.env.DATA_DIR || "./data"),
  limits: {
    maxTitleLength: num(process.env.MAX_TITLE_LENGTH, 70),
    minDescriptionLength: num(process.env.MIN_DESCRIPTION_LENGTH, 1000),
    // Tweet'teki kural: en onemli urun ifadesi ilk 30-40 karaktere girmeli.
    leadKeywordWindow: 40,
    // Aciklamanin ilk 160 karakteri Etsy'nin meta description'i olarak kullaniliyor.
    metaDescriptionWindow: 160,
  },
};

/**
 * Calistirilan komut icin gerekli kimlik bilgilerini dogrular.
 * Eksik olan her degiskeni tek seferde bildirir; teker teker hata verip
 * kullaniciyi surekli yeniden calistirmaya zorlamaz.
 *
 * @param {Array<"etsyRead"|"etsyWrite"|"claude"|"pinterest">} needs
 */
export function requireConfig(needs) {
  const missing = [];

  for (const need of needs) {
    if (need === "etsyRead") {
      if (!config.etsy.apiKey) missing.push("ETSY_API_KEY");
      if (!config.etsy.shopId) missing.push("ETSY_SHOP_ID");
    }
    if (need === "etsyWrite") {
      if (!config.etsy.apiKey) missing.push("ETSY_API_KEY");
      if (!config.etsy.shopId) missing.push("ETSY_SHOP_ID");
      if (!config.etsy.accessToken) missing.push("ETSY_ACCESS_TOKEN (listings_w scope)");
    }
    if (need === "claude" && !config.claude.apiKey) missing.push("ANTHROPIC_API_KEY");
    if (need === "pinterest") {
      if (!config.pinterest.accessToken) missing.push("PINTEREST_ACCESS_TOKEN");
      if (!config.pinterest.boardId) missing.push("PINTEREST_BOARD_ID");
    }
  }

  const unique = [...new Set(missing)];
  if (unique.length > 0) {
    throw new Error(
      `Eksik ortam degiskeni: ${unique.join(", ")}\n` +
        ".env.example dosyasini .env olarak kopyalayip doldurun.",
    );
  }
}
