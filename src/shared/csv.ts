import { ExtractionData } from "./messages";

const HEADERS = [
  "page_url",
  "page_name",
  "category",
  "phone",
  "email",
  "website",
  "city",
  "country",
  "address",
  "scraped_at",
];

function esc(cell: unknown): string {
  const s = String(cell ?? "");
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(rows: ExtractionData[]): string {
  const lines = [HEADERS.map(esc).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.pageUrl,
        r.pageName,
        r.category,
        r.phone,
        r.email,
        r.website,
        r.city,
        r.country,
        r.address,
        r.scrapedAt,
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\r\n");
}