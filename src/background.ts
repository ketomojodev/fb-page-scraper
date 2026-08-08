import { RunSettings, DEFAULT_SETTINGS, SETTINGS_KEY, nowInActiveWindow, randInt, jitter } from "./shared/config";
import { ToBackground, BackgroundResponse, BotStatus, Severity, RunPhase, ToContent, ContentResponse, ContentOkLinks, ContentOkData, ContentOkSeverity, ExtractionData } from "./shared/messages";
import { saveLead, leadExists, getAllLeads, recordRun } from "./shared/store";
import { toCsv } from "./shared/csv";
import { sleep } from "./shared/humanize";

interface PersistState {
  phase: RunPhase;
  running: boolean;
  pagesToday: number;
  pagesThisRun: number;
  dayKey: string;
  queue: string[];
  keywordIdx: number;
  keywords: string[];
  locations: string[];
  errors: string[];
  lastAction: string | null;
  nextAt: number;
  cooldownUntil: number;
  cooldownSeverity: Severity;
  currentCap: number;
  runId: string | null;
  startedAt: number;
  processed: string[];
}

const DEFAULT_STATE: PersistState = {
  phase: "idle",
  running: false,
  pagesToday: 0,
  pagesThisRun: 0,
  dayKey: "",
  queue: [],
  keywordIdx: 0,
  keywords: [],
  locations: [],
  errors: [],
  lastAction: null,
  nextAt: 0,
  cooldownUntil: 0,
  cooldownSeverity: 0,
  currentCap: 125,
  runId: null,
  startedAt: 0,
  processed: [],
};

let state: PersistState = { ...DEFAULT_STATE, processed: [] as string[] };
let controlledTabId: number | undefined;
let reqCounter = 0;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function reqId(): string {
  return "r" + Date.now().toString(36) + "_" + (reqCounter++).toString(36);
}

async function hydrate(): Promise<void> {
  const res = await chrome.storage.local.get(["botState"]);
  if (res.botState) {
    const prev = res.botState as PersistState;
    state = { ...DEFAULT_STATE, ...prev, processed: prev.processed ?? [] };
    if (prev.dayKey && prev.dayKey !== todayKey()) state.pagesToday = 0;
  }
}

function persist(): void {
  void chrome.storage.local.set({ botState: state });
}

function badge(text: string): void {
  void chrome.action.setBadgeText({ text });
}

function title(t: string): void {
  void chrome.action.setTitle({ title: t });
}

function notify(tag: string): void {
  void chrome.notifications.create({ type: "basic", iconUrl: "icons/icon128.png", title: "FB Page Scraper", message: tag });
}

function buildStatus(): BotStatus {
  return {
    phase: state.phase,
    running: state.running,
    keyword: state.keywordIdx < state.keywords.length ? state.keywords[state.keywordIdx] : null,
    pagesToday: state.pagesToday,
    pagesThisRun: state.pagesThisRun,
    errors: state.errors.slice(-5),
    lastAction: state.lastAction,
    nextAt: state.nextAt || null,
    cooldownUntil: state.cooldownUntil || null,
    severity: state.cooldownSeverity,
    queueSize: state.queue.length,
    cap: state.currentCap,
  };
}

chrome.runtime.onMessage.addListener((msg: ToBackground, _sender, send: (r: BackgroundResponse) => void) => {
  void (async () => {
    switch (msg.action) {
      case "START": {
        const started = await startRun();
        send({ ok: true, started });
        break;
      }
      case "STOP": {
        stopRun();
        send({ ok: true, started: false });
        break;
      }
      case "STATUS": {
        send({ ok: true, status: buildStatus() });
        break;
      }
      case "EXPORT": {
        const count = await exportCsv();
        send({ ok: true, exported: true, count });
        break;
      }
      case "SET_SETTINGS": {
        await chrome.storage.local.set({ [SETTINGS_KEY]: msg.settings });
        send({ ok: true, started: false });
        break;
      }
      case "EXTRACT_RESULT": {
        await handleExtractResult(msg.data);
        send({ ok: true, started: false });
        break;
      }
      case "COLLECT_LINKS_RESULT": {
        handleCollectedLinks(msg.links);
        send({ ok: true, started: false });
        break;
      }
      case "DETECT_RESULT": {
        if (msg.severity > 0) enterCooldown(msg.severity);
        send({ ok: true, started: false });
        break;
      }
      default: {
        send({ ok: false, error: "unhandled" });
      }
    }
  })();
  return true;
});

async function handleExtractResult(data: ExtractionData): Promise<void> {
  const exists = await leadExists(data.pageUrl);
  if (!exists) await saveLead(data);
  if (!state.processed.includes(data.pageUrl)) state.processed.push(data.pageUrl);
  state.pagesToday += 1;
  state.pagesThisRun += 1;
  state.lastAction = "saved " + data.pageUrl;
  persist();
}

function handleCollectedLinks(links: string[]): void {
  const fresh = links.filter((l) => !state.processed.includes(l) && !state.queue.includes(l));
  state.queue.push(...fresh);
  state.lastAction = `queued ${fresh.length} links`;
  persist();
}

async function startRun(): Promise<boolean> {
  if (state.running) return false;
  const settings = await getSettings();
  const keywords = settings.keywords.map((k) => k.trim()).filter(Boolean);
  if (keywords.length === 0) {
    notify("Add at least one keyword in Settings before starting.");
    return false;
  }
  state = {
    ...DEFAULT_STATE,
    processed: [],
    running: true,
    phase: "warmup",
    dayKey: todayKey(),
    pagesToday: 0,
    keywords,
    locations: settings.locations.map((l) => l.trim()).filter(Boolean),
    currentCap: Math.min(settings.maxPagesPerRun, settings.antiDetection.pagesPerDay),
    startedAt: Date.now(),
    runId: "run-" + Date.now(),
  };
  persist();
  badge("ON");
  title("FB Scraper: warming up");
  void ensureControlledTab();
  void createAlarm();
  return true;
}

async function createAlarm(): Promise<void> {
  await chrome.alarms.clear("scraper-pump");
  await chrome.alarms.create("scraper-pump", { periodInMinutes: 0.2 });
}

function stopRun(): void {
  state.running = false;
  state.phase = "stopped";
  persist();
  badge("");
  title("FB Scraper");
  void chrome.alarms.clear("scraper-pump");
}

async function getSettings(): Promise<RunSettings> {
  const res = await chrome.storage.local.get([SETTINGS_KEY]);
  if (!res[SETTINGS_KEY]) return DEFAULT_SETTINGS;
  const s = res[SETTINGS_KEY] as RunSettings;
  return { ...DEFAULT_SETTINGS, ...s, antiDetection: { ...DEFAULT_SETTINGS.antiDetection, ...s.antiDetection } };
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "scraper-pump" || alarm.name === "scraper-alive") void pump();
});

async function pump(): Promise<void> {
  if (!state.running) {
    void chrome.alarms.clear("scraper-pump");
    void chrome.alarms.clear("scraper-alive");
    return;
  }
  try {
    await oneStep();
  } catch (e) {
    state.errors.push(String(e));
    state.errors = state.errors.slice(-20);
    persist();
  }
  await chrome.alarms.create("scraper-alive", { when: Date.now() + randInt(20000, 45000) });
}

async function oneStep(): Promise<void> {
  if (state.cooldownUntil > Date.now()) {
    state.phase = "cooldown";
    persist();
    return;
  }
  const settings = await getSettings();
  const ad = settings.antiDetection;
  if (!nowInActiveWindow(ad.activeHours)) {
    state.phase = "paused";
    persist();
    return;
  }
  if (state.pagesToday >= state.currentCap) {
    state.phase = "done";
    finishRun();
    void exportCsv();
    notify(`Daily cap reached (${state.pagesToday}). CSV exported.`);
    return;
  }

  if (state.phase === "warmup") {
    state.lastAction = "warming up session";
    const t = await controlledTab();
    await sendToTab(t, { action: "WARM", seconds: Math.max(8, Math.round(ad.warmupMin * 60)), requestId: reqId() });
    state.phase = "searching";
    persist();
    return;
  }

  if (state.queue.length === 0) {
    await nextSearch();
    return;
  }

  await visitNextPage();
}

async function nextSearch(): Promise<void> {
  const settings = await getSettings();
  if (state.keywordIdx >= state.keywords.length) {
    state.phase = "done";
    finishRun();
    void exportCsv();
    notify("All keywords processed. CSV exported.");
    return;
  }
  const kw = state.keywords[state.keywordIdx];
  const loc = state.locations.length ? state.locations[0] : "";
  const q = loc ? `${kw} ${loc}` : kw;
  state.lastAction = "search: " + q;
  state.phase = "searching";
  persist();

  await holdDelay(settings.antiDetection.searchDelayMin, settings.antiDetection.searchDelayMax);

  const t = await controlledTab();
  const url = "https://www.facebook.com/search/pages?q=" + encodeURIComponent(q);
  await navigateTab(t, url);
  await sleep(randInt(2500, 6000));
  const resp = await sendToTab(t, { action: "COLLECT_LINKS", requestId: reqId() });
  const links: string[] = resp && isLinks(resp) ? resp.links : [];
  state.keywordIdx += 1;
  if (links.length) {
    handleCollectedLinks(links);
  } else {
    state.errors.push(`no links for "${kw}"`);
    state.errors = state.errors.slice(-20);
    persist();
  }
}

async function visitNextPage(): Promise<void> {
  const settings = await getSettings();
  const url = state.queue.shift()!;
  await holdDelay(settings.antiDetection.pageDelayMin, settings.antiDetection.pageDelayMax);
  const t = await controlledTab();
  await navigateTab(t, url);
  await sleep(randInt(1500, 4000));
  const sev = await sendDetect(t);
  if (sev > 0) {
    enterCooldown(sev);
    return;
  }
  const resp = await sendToTab(t, { action: "EXTRACT", requestId: reqId() });
  if (!resp || !isData(resp)) {
    state.errors.push("extract failed: " + url);
    state.errors = state.errors.slice(-20);
    persist();
    return;
  }
  await handleExtractResult(resp.data);
}

async function sendDetect(tabId: number): Promise<Severity> {
  const resp = await sendToTab(tabId, { action: "DETECT", requestId: reqId() });
  return resp && isSeverity(resp) ? resp.severity : 0;
}

function isLinks(r: ContentResponse): r is ContentOkLinks {
  return r.ok === true && "links" in r;
}
function isData(r: ContentResponse): r is ContentOkData {
  return r.ok === true && "data" in r;
}
function isSeverity(r: ContentResponse): r is ContentOkSeverity {
  return r.ok === true && "severity" in r;
}

async function holdDelay(minS: number, maxS: number): Promise<void> {
  const base = (minS + Math.random() * (maxS - minS)) * 1000;
  const ms = Math.round(base * jitter(0.1));
  state.lastAction = "pacing " + Math.round(ms / 1000) + "s";
  state.nextAt = Date.now() + ms;
  persist();
  await sleep(ms);
  state.nextAt = 0;
}

function enterCooldown(sev: Severity): void {
  void getSettings().then((cfg) => {
    const ad = cfg.antiDetection;
    const hours = sev >= 3 ? ad.cooldownSevereH : sev === 2 ? ad.cooldownModerateH : ad.cooldownMildH;
    state.cooldownUntil = Date.now() + hours * 3600000;
    state.cooldownSeverity = sev;
    if (sev >= 2) state.currentCap = Math.max(10, Math.round(state.currentCap * 0.5));
    state.phase = "cooldown";
    persist();
    badge("STOP");
    title("FB Scraper: cooldown " + ["", "mild", "moderate", "severe"][sev]);
  });
}

function finishRun(): void {
  state.running = false;
  if (state.runId) {
    void recordRun({ runId: state.runId, startedAt: new Date(state.startedAt).toISOString(), finishedAt: new Date().toISOString(), pages: state.pagesThisRun, errors: state.errors.length });
  }
  badge("DONE");
}

async function exportCsv(): Promise<number> {
  const leads = await getAllLeads();
  const csv = toCsv(leads);
  const blobUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const filename = "fb-leads-" + todayKey() + (state.runId ? "-" + state.runId.replace("run-", "") : "") + ".csv";
  try {
    await chrome.downloads.download({ url: blobUrl, filename, saveAs: true });
  } catch {
    void chrome.downloads.download({ url: blobUrl, filename });
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  }
  return leads.length;
}

async function ensureControlledTab(): Promise<number> {
  return controlledTab();
}

async function controlledTab(): Promise<number> {
  if (controlledTabId) {
    try {
      await chrome.tabs.get(controlledTabId);
      return controlledTabId;
    } catch {
      controlledTabId = undefined;
    }
  }
  const tab = await chrome.tabs.create({ url: "https://www.facebook.com/", active: false });
  if (!tab.id) throw new Error("tab has no id");
  controlledTabId = tab.id;
  return controlledTabId;
}

async function navigateTab(tabId: number, url: string): Promise<void> {
  for (let i = 0; i < 3; i++) {
    try {
      await chrome.tabs.update(tabId, { url });
      return;
    } catch {
      await sleep(1500);
    }
  }
  state.errors.push("nav failed: " + url);
  state.errors = state.errors.slice(-20);
  persist();
}

async function sendToTab(tabId: number, msg: ToContent): Promise<ContentResponse | undefined> {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    await sleep(1200);
    try {
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch {
      return undefined;
    }
  }
}

void hydrate();
void chrome.alarms.create("scraper-alive", { when: Date.now() + 60000 });