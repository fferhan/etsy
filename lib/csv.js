/**
 * RFC 4180 uyumlu, bagimliliksiz CSV ayristirici.
 *
 * Etsy'nin listing CSV'sinde aciklamalar tirnak icinde ve satir sonu, virgul,
 * cift tirnak barindiriyor. Basit bir split(",") bu dosyayi bozar, o yuzden
 * alan alan ayristiriyoruz.
 */
export function parseCsv(text) {
  // BOM'u at: Excel'den gecmis dosyalarda ilk sutun adi bozuk okunuyor.
  const input = text.replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          // Kacis dizisi: "" -> tek tirnak
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      index += 1;
      continue;
    }

    if (char === "\r" || char === "\n") {
      // CRLF tek satir sonu sayilir.
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  // Dosya satir sonuyla bitmiyorsa son alan/satir aciktadir.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
}

/**
 * Ilk satiri baslik kabul edip her satiri nesneye cevirir.
 * Sutun adlari buyuk harfe normalize edilir: Etsy zaman zaman "Title" ile
 * "TITLE" arasinda gidip geliyor.
 */
export function parseCsvRecords(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0].map((header) => header.trim().toUpperCase());
  const records = rows.slice(1).map((row) => {
    const record = {};
    headers.forEach((header, position) => {
      record[header] = (row[position] ?? "").trim();
    });
    return record;
  });

  return { headers, records };
}
