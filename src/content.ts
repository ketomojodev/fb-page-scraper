import { Severity, ToContent, ContentResponse, ExtractionData } from "./shared/messages";
import { canonicalizeFacebookUrl, extractHandle, extractPageId, normalizeWebsite } from "./shared/normalize";
import { scanText } from "./shared/scanner";
import { fluentScroll, wanderToCenter, sleep, humanDelay } from "./shared/humanize";

function getMeta(prop: string): string {
  const m = document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
  return m ? m.getAttribute("content") || "" : "";
}

function visibleText(): string {
  const el = document.querySelector("[role=main], main, [data-pagelet]");
  if (el && el.textContent) return el.textContent.slice(0, 30000);
  return document.body ? document.body.innerText.slice(0, 30000) : "";
}

function detectBlock(): Severity {
  const bd = document.body ? document.body.innerText.toLowerCase() : "";
  const id = document.body ? document.body.id : "";
  const markers: { sev: Severity; pat: RegExp }[] = [
    { sev: 3, pat: /confirm.*(your identity|it's really you)|login.*account|temporarily locked/ },
    { sev: 3, pat: /your account.*disabled|your account.*suspended/ },
    { sev: 2, pat: /unusual activity|suspicious activity|how do you want to continue/ },
    { sev: 2, pat: /we think you.*are a.*bot|automated behavior|automated you/ },
    { sev: 1, pat: /verify.*captcha|prove you'?re human|type the (characters|letters)|imgcaptcha/ },
    { sev: 1, pat: /security check/ },
  ];
  let max: Severity = 0;
  for (const mk of markers) {
    if (mk.pat.test(bd) || mk.pat.test(id)) max = Math.max(max, mk.sev) as Severity;
  }
  return max;
}

function findTextNear(label: string): string {
  const lower = label.toLowerCase();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = w.nextNode();
  while (node) {
    const el = node as HTMLElement;
    const aria = el.getAttribute ? el.getAttribute("aria-label") || "" : "";
    if (aria.toLowerCase().includes(lower) && aria.length > lower.length + 2) {
      return aria.trim().slice(0, 140);
    }
    const span = el.querySelector ? el.querySelector("span") : null;
    if (span && span.textContent && span.textContent.trim().toLowerCase() === lower) {
      const parent = span.parentElement;
      if (parent) {
        const t = parent.textContent || "";
        const idx = t.indexOf(lower);
        if (idx >= 0) return t.slice(idx + lower.length).trim().slice(0, 140);
      }
    }
    node = w.nextNode();
  }
  return "";
}

function extractData(): ExtractionData {
  const ogUrl = getMeta("og:url");
  const canonical = canonicalizeFacebookUrl(ogUrl || location.href);
  const title = (getMeta("og:title") || document.title || "").replace(/\s*\|\s*Facebook.*$/i, "").trim();
  const desc = getMeta("og:description") || "";
  const text = visibleText();
  const scan = scanText(text);
  const phone = scan.phones[0] || extractTel();
  const email = scan.emails[0] || extractMailto();
  const website = normalizeWebsite(scan.websites[0] || extractWebsiteLink());
  const address = scan.address || findTextNear("Address") || findTextNear("Location") || findAddressFromMaps();
  const city = scan.city || "";
  const country = scan.country || "";

  return {
    pageUrl: canonical,
    pageName: title || canonical,
    category: inferCategory(desc, title),
    phone,
    email,
    website,
    city,
    country,
    address,
    id: extractPageId(canonical),
    handle: extractHandle(canonical),
    scrapedAt: new Date().toISOString(),
  };
}

function inferCategory(desc: string, title: string): string {
  const catRe = /(Business|Local service|[A-Z][a-z]+ service|Brand|Product|Outlet|Restaurant|Beauty|Health|Sports|Education|Community|Media|Shopping|Organization)/;
  const m = desc.match(catRe) || title.match(catRe);
  return m ? m[1] : "";
}

function extractTel(): string {
  const a = document.querySelector('a[href^="tel:"]');
  return a ? (a as HTMLAnchorElement).href.replace("tel:", "") : "";
}

function extractMailto(): string {
  const a = document.querySelector('a[href^="mailto:"]');
  return a ? (a as HTMLAnchorElement).href.replace("mailto:", "") : "";
}

function extractWebsiteLink(): string {
  for (const a of Array.from(document.querySelectorAll('a[href^="http"]')) as HTMLAnchorElement[]) {
    try {
      const host = new URL(a.href).hostname.replace(/^www\./, "");
      if (/(facebook|instagram|youtube|linkedin|twitter|x\.com|tiktok|messenger)\./.test(host)) continue;
      if (host.includes("facebook.com")) continue;
      return a.href;
    } catch {
      continue;
    }
  }
  return "";
}

function findAddressFromMaps(): string {
  for (const a of Array.from(document.querySelectorAll('a[href*="maps"], a[href*="goo.gl/maps"]')) as HTMLAnchorElement[]) {
    const t = (a.textContent || "").trim();
    if (t && t.length > 3) return t.slice(0, 140);
  }
  return "";
}

function collectPageLinks(): string[] {
  const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
  const seen = new Set<string>();
  const out: string[] = [];
  const cur = canonicalizeFacebookUrl(location.href);
  for (const a of anchors) {
    const href = a.href;
    if (!href || href === cur) continue;
    if (!/^https?:\/\/.*facebook\.com\//i.test(href)) continue;
    if (/facebook\.com\/(login|home\.php|groups|watch|events|menu|messages|search|profile\.php|friends|saved|stories|reels|marketplace|shorts)/.test(href)) continue;
    const norm = canonicalizeFacebookUrl(href);
    if (!norm || norm === cur) continue;
    const handle = extractHandle(norm);
    if (!handle || /^(home\.php|watch|music|menu)$/i.test(handle)) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= 60) break;
  }
  return out;
}

chrome.runtime.onMessage.addListener((msg: ToContent, _sender, sendResp) => {
  const requestId = (msg as { requestId: string }).requestId;
  void (async () => {
    await sleep(humanDelay(300, 1400));
    let resp: ContentResponse;
    if (msg.action === "EXTRACT") {
      resp = { requestId, ok: true, data: extractData() };
    } else if (msg.action === "COLLECT_LINKS") {
      resp = { requestId, ok: true, links: collectPageLinks() };
    } else if (msg.action === "DETECT") {
      resp = { requestId, ok: true, severity: detectBlock() };
    } else if (msg.action === "WARM") {
      await warmUp(msg.seconds);
      resp = { requestId, ok: true, done: true };
    } else if (msg.action === "SCROLL") {
      await doScroll();
      resp = { requestId, ok: true, done: true };
    } else {
      resp = { requestId, ok: false, error: "unknown action" };
    }
    sendResp(resp);
  })();
  return true;
});

async function warmUp(seconds: number): Promise<void> {
  const cycles = Math.max(1, Math.round(seconds / 3));
  for (let i = 0; i < cycles; i++) {
    await wanderToCenter();
    const scroller = document.scrollingElement || document.body;
    await fluentScroll(scroller);
    await sleep(humanDelay(900, 2200));
    if (Math.random() < 0.4) {
      await wanderToCenter();
      await sleep(humanDelay(400, 1000));
    }
  }
}

async function doScroll(): Promise<void> {
  const scroller = document.scrollingElement || document.body;
  for (let i = 0; i < 3; i++) {
    await fluentScroll(scroller);
    await sleep(humanDelay(300, 900));
  }
}