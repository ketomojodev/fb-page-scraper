const TRACKING_PARAMS = [
  "ref",
  "rdid",
  "cft",
  "entrypoint",
  "locale",
  "_rdr",
  "fbclid",
  "ab_test_locale_id",
  "prep",
];

export function stripTrackingParams(url: string): string {
  try {
    const u = new URL(url);
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
    if (u.searchParams.get("____") || u.searchParams.has("q")) {
      u.searchParams.delete("____");
    }
    if (!u.search && u.hash) {
      u.hash = "";
    }
    return u.toString();
  } catch {
    return url;
  }
}

export function canonicalizeFacebookUrl(raw: string): string {
  let url = stripTrackingParams(raw.trim());
  const m = url.match(/^(?:https?:)?\/\/(?:www\.|m\.|mobile\.|mbasic\.)?facebook\.com\//i);
  if (url.startsWith("/pages/") || url.startsWith("/profile.php")) {
    url = "https://www.facebook.com" + url;
  } else if (!m && !/^https?:/i.test(url)) {
    url = "https://www.facebook.com/" + url.replace(/^\/+/, "");
  }
  try {
    const u = new URL(url);
    if (!/facebook\.com/i.test(u.hostname)) return url;
    const paths = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (paths[0] === "profile.php" && u.searchParams.get("id")) {
      u.pathname = "/profile.php";
      u.searchParams.set("id", u.searchParams.get("id") || "");
      u.hash = "";
      return u.toString();
    }
    if (paths[0] === "pages") {
      u.pathname = "/pages/" + paths[1];
      u.hash = "";
      return u.toString();
    }
    const handle = paths[0];
    if (handle && handle.match(/^[\w.\-]{1,50}$/)) {
      u.pathname = "/" + handle.replace(/\.$/, "");
      u.hash = "";
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

export function extractHandle(pageUrl: string): string {
  const m = pageUrl.match(/facebook\.com\/([\w.\-]+)/i);
  return m ? m[1] : "";
}

export function extractPageId(pageUrl: string): string {
  const m = pageUrl.match(/[?&]id=(\d+)/);
  if (m) return m[1];
  const m2 = pageUrl.match(/\/(\d{6,})\/?$/);
  return m2 ? m2[1] : "";
}

export function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export function normalizeWebsite(raw: string): string {
  let url = raw.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }
  return url;
}