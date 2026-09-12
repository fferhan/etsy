/**
 * Testlerde kullanilan sahte Etsy / Pinterest / Anthropic sunucusu.
 * Gercek API'lere hic istek atmadan komutlarin uctan uca calistigini dogrular.
 */
import http from "node:http";

export function createMockServer({ listingCount = 3 } = {}) {
  const state = {
    updates: [],
    pins: [],
    messageRequests: [],
  };

  const listings = Array.from({ length: listingCount }, (_, index) => ({
    listing_id: 1000 + index,
    title: `Handmade Ceramic Mug, ceramic mug, mug gift, pottery mug, coffee mug ${index}`,
    description: "Kisa aciklama.",
    tags: ["ceramic mug", "pottery"],
    materials: ["ceramic"],
    taxonomy_id: 1,
    who_made: "i_did",
    when_made: "made_to_order",
    last_modified_timestamp: 1700000000 + index,
    url: `https://www.etsy.com/listing/${1000 + index}`,
    images: [{ url_fullxfull: `https://img.example/${1000 + index}.jpg` }],
  }));

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const url = new URL(req.url, "http://localhost");
      const send = (status, payload) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      // --- Etsy ---
      if (url.pathname.match(/^\/etsy\/shops\/\d+\/listings$/) && req.method === "GET") {
        const offset = Number(url.searchParams.get("offset") ?? 0);
        return send(200, { count: listings.length, results: listings.slice(offset, offset + 100) });
      }
      if (url.pathname.match(/^\/etsy\/shops\/\d+\/listings\/\d+\/properties$/)) {
        return send(200, { results: [{ property_name: "Ana renk", values: ["Beyaz"] }] });
      }
      if (url.pathname.match(/^\/etsy\/shops\/\d+\/listings\/\d+$/) && req.method === "PATCH") {
        const listingId = url.pathname.split("/").pop();
        state.updates.push({ listingId, body: Object.fromEntries(new URLSearchParams(body)) });
        return send(200, { listing_id: Number(listingId) });
      }

      // --- Pinterest ---
      if (url.pathname === "/pinterest/pins" && req.method === "POST") {
        const parsed = JSON.parse(body);
        state.pins.push(parsed);
        return send(201, { id: `pin_${state.pins.length}` });
      }
      if (url.pathname === "/pinterest/boards") {
        return send(200, { items: [{ id: "board_1", name: "Etsy" }] });
      }

      // --- Anthropic ---
      if (url.pathname === "/v1/messages" && req.method === "POST") {
        const parsed = JSON.parse(body);
        state.messageRequests.push(parsed);
        const output = {
          title: "Ceramic Coffee Mug Handmade Stoneware Gift",
          description: `Ceramic coffee mug, el yapimi stoneware. ${"Detayli aciklama metni. ".repeat(60)}`,
          primary_keyword: "ceramic coffee mug",
          title_changed: true,
          description_changed: true,
          missing_attributes: [{ name: "Kapasite", suggested_value: "", reason: "Metinde belirtilmemis." }],
          tag_notes: ["13 slotun 2'si dolu."],
          changes: ["Baslikta tekrar eden 'mug' kelimeleri temizlendi."],
          risk_notes: [],
        };
        return send(200, {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: parsed.model,
          content: [{ type: "text", text: JSON.stringify(output) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: 100,
            output_tokens: 200,
            cache_read_input_tokens: 50,
            cache_creation_input_tokens: 0,
          },
        });
      }

      send(404, { error: `mock: bilinmeyen yol ${req.method} ${url.pathname}` });
    });
  });

  return {
    state,
    listings,
    async start() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address();
      return {
        etsy: `http://127.0.0.1:${port}/etsy`,
        pinterest: `http://127.0.0.1:${port}/pinterest`,
        anthropic: `http://127.0.0.1:${port}`,
      };
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
