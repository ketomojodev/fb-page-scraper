const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL_RE = /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?:\/[^\s"<>()]*)?/g;
const BLOCKED_HOSTS = [
  "facebook.com",
  "m.facebook.com",
  "www.facebook.com",
  "web.facebook.com",
  "mbasic.facebook.com",
  "instagram.com",
  "youtube.com",
  "about.me",
  "maps.google.com",
  "google.com",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "whatsapp.com",
  "wa.me",
];

export interface ContactScan {
  phones: string[];
  emails: string[];
  websites: string[];
  city: string;
  country: string;
  address: string;
}

export function scanText(text: string): ContactScan {
  const phones: string[] = [];
  const emails: string[] = [];
  const websites: string[] = [];

  for (const m of text.matchAll(PHONE_RE)) {
    const v = m[1].trim();
    if (v.length >= 7 && !phones.includes(v)) phones.push(v);
  }
  for (const m of text.matchAll(EMAIL_RE)) {
    const v = m[0].toLowerCase();
    if (!emails.includes(v)) emails.push(v);
  }
  for (const m of text.matchAll(URL_RE)) {
    let v = m[0].trim();
    if (v.length < 6 || !v.includes(".")) continue;
    try {
      const withProto = /^https?:\/\//i.test(v) ? v : "https://" + v;
      const u = new URL(withProto);
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      if (BLOCKED_HOSTS.includes(host)) continue;
      const domain = host;
      if (domain.split(".").length >= 2 && !websites.includes(domain)) websites.push(domain);
    } catch {
      continue;
    }
  }

  return {
    phones: phones.slice(0, 5),
    emails: emails.slice(0, 5),
    websites: websites.slice(0, 3),
    city: detectCity(text),
    country: detectCountry(text),
    address: detectAddress(text),
  };
}

function detectCity(text: string): string {
  const lower = text.toLowerCase();
  const markers = ["city:", "location:", "based in ", "living in "];
  for (const mk of markers) {
    const idx = lower.indexOf(mk);
    if (idx >= 0) {
      const seg = text.slice(idx + mk.length, idx + mk.length + 40).trim();
      const clean = seg.split(/[\n;|]/)[0].trim();
      if (clean && clean.length < 40 && !/:/.test(clean)) return clean;
    }
  }
  return "";
}

function detectCountry(text: string): string {
  const known = [
    "United States", "USA", "United Kingdom", "UK", "Canada", "Australia", "Germany",
    "France", "Spain", "Italy", "Netherlands", "Sweden", "Norway", "UAE", "India",
    "Brazil", "Mexico", "Ireland", "Singapore", "New Zealand", "South Africa",
  ];
  const lower = text.toLowerCase();
  for (const c of known) {
    if (lower.includes(c.toLowerCase())) return c;
  }
  return "";
}

function detectAddress(text: string): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf("address");
  if (idx >= 0) {
    const seg = text.slice(idx + 7, idx + 100).replace(/[:：]/g, "").trim();
    const clean = seg.split(/[\n;|]/)[0].trim();
    if (clean.length > 3 && clean.length < 80) return clean;
  }
  return "";
}