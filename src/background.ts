import {
  RunSettings,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  nowInActiveWindow,
  randInt,
} from "./shared/config";
import {
  ToBackground,
  BackgroundResponse,
  BotStatus,
  Severity,
  RunPhase,
  ToContent,
  ContentResponse,
  ContentOkLinks,
  ContentOkData,
  ContentOkSeverity,
  ExtractionData,
} from "./shared/messages";
import { saveLead, leadExists, getAllLeads, recordRun } from "./shared/store";
import { toCsv } from "./shared/csv";
import { sleep } from "./shared/humanize";

type Stage = "search" | "collect" | "visit" | "extract" | "done";

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
  stage: Stage;
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
  stage: "search",
};

let state: PersistState = { ...DEFAULT_STATE };
let controlledTabId: number | undefined;
let reqCounter = 0;
let pumping = false;

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
    state = { ...DEFAULT_STATE, ...prev, processed: prev.processed ?? [], stage: prev.stage ?? "search" };
    if (prev.dayKey && prev.dayKey !== todayKey()) {
      state.pagesToday = 0;
      state.dayKey = todayKey();
    }
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

function notify(msg: string): void {
  void chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "FB Page Scraper",
    message: msg,
  });
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

function setPhase(p: RunPhase): void {
  state.phase = p;
  persist();
}

function setAction(msg: string): void {
  state.lastAction = msg;
  persist();
}

async function getSettings(): Promise<RunSettings> {
  const res = await chrome.storage.local.get([SETTINGS_KEY]);
  if (!res[SETTINGS_KEY]) return DEFAULT_SETTINGS;
  const s = res[SETTINGS_KEY] as RunSettings;
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    antiDetection: { ...DEFAULT_SETTINGS.antiDetection, ...s.antiDetection },
  };
}

async function controlledTab(): Promise<number> {
  if (controlledTabId) {
    try {
      const t = await chrome.tabs.get(controlledTabId);
      if (t.id) return controlledTabId;
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
      await sleep(1200);
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
    await sleep(1500);
    try {
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch {
      return undefined;
    }
  }
}

function isLinks(r: ContentResponse | undefined): r is ContentOkLinks {
  return !!r && r.ok === true && "links" in r;
}
function isData(r: ContentResponse | undefined): r is ContentOkData {
  return !!r && r.ok === true && "data" in r;
}
function isSeverity(r: ContentResponse | undefined): r is ContentOkSeverity {
  return !!r && r.ok === true && "severity" in r;
}

async function detectStep(tabId: number): Promise<Severity> {
  for (let i = 0; i < 8; i++) {
    const resp = await sendToTab(tabId, { action: "DETECT", requestId: reqId() });
    if (isSeverity(resp)) return resp.severity;
    await sleep(2500);
  }
  return 0;
}

async function extractStep(tabId: number): Promise<ExtractionData | undefined> {
  for (let i = 0; i < 8; i++) {
    const resp = await sendToTab(tabId, { action: "EXTRACT", requestId: reqId() });
    if (isData(resp)) return resp.data;
    await sleep(2500);
  }
  return undefined;
}

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

async function paceUntil(ms: number): Promise<void> {
  let remaining = ms;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 20000);
    await sleep(chunk);
    remaining -= chunk;
  }
}

function enterCooldown(sev: Severity): void {
  void getSettings().then((cfg) => {
    const ad = cfg.antiDetection;
    const hours =
      sev >= 3 ? ad.cooldownSevereH : sev === 2 ? ad.cooldownModerateH : ad.cooldownMildH;
    state.cooldownUntil = Date.now() + hours * 3600000;
    state.cooldownSeverity = sev;
    if (sev >= 2) state.currentCap = Math.max(10, Math.round(state.currentCap * 0.5));
    state.stage = "done";
    setPhase("cooldown");
    badge("STOP");
    title("FB Scraper: cooldown " + ["", "mild", "moderate", "severe"][sev]);
  });
}

async function finishRun(): Promise<void> {
  state.running = false;
  state.phase = "done";
  if (state.runId) {
    void recordRun({
      runId: state.runId,
      startedAt: new Date(state.startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      pages: state.pagesThisRun,
      errors: state.errors.length,
    });
  }
  persist();
  badge("DONE");
}

async function exportCsv(): Promise<number> {
  const leads = await getAllLeads();
  const csv = toCsv(leads);
  const blobUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const filename =
    "fb-leads-" + todayKey() + (state.runId ? "-" + state.runId.replace("run-", "") : "") + ".csv";
  try {
    await chrome.downloads.download({ url: blobUrl, filename, saveAs: true });
  } catch {
    void chrome.downloads.download({ url: blobUrl, filename });
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  }
  return leads.length;
}

async function startRun(): Promise<void> {
  if (state.running) return;
  const settings = await getSettings();
  const keywords = settings.keywords.map((k) => k.trim()).filter(Boolean);
  if (keywords.length === 0) {
    notify("Add at least one keyword in Settings before starting.");
    setPhase("stopped");
    setAction("no keywords configured");
    return;
  }
  state = {
    ...DEFAULT_STATE,
    processed: [],
    running: true,
    phase: "preparing",
    dayKey: todayKey(),
    keywords,
    locations: settings.locations.map((l) => l.trim()).filter(Boolean),
    currentCap: Math.min(settings.maxPagesPerRun, settings.antiDetection.pagesPerDay),
    startedAt: Date.now(),
    runId: "run-" + Date.now(),
    stage: "search",
  };
  persist();
  badge("ON");
  title("FB Scraper: running");
  console.log("[fb-scraper] run started", keywords, "cap", state.currentCap);
  void ensurePumpAlarm();
  void pump();
}

function stopRun(): void {
  state.running = false;
  state.phase = "stopped";
  persist();
  badge("");
  title("FB Scraper");
  void chrome.alarms.clear("scraper-pump");
  void chrome.alarms.clear("scraper-alive");
}

async function ensurePumpAlarm(): Promise<void> {
  await chrome.alarms.clear("scraper-pump");
  await chrome.alarms.clear("scraper-alive");
  await chrome.alarms.create("scraper-pump", { periodInMinutes: 0.5 });
}

chrome.runtime.onMessage.addListener((msg: ToBackground, _sender, send: (r: BackgroundResponse) => void) => {
  void (async () => {
    await hydration;
    switch (msg.action) {
      case "START": {
        await startRun();
        send({ ok: true, started: state.running });
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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "scraper-pump") void pump();
});

async function pump(): Promise<void> {
  await hydration;
  if (!state.running) {
    void chrome.alarms.clear("scraper-pump");
    void chrome.alarms.clear("scraper-alive");
    return;
  }
  if (pumping) return;
  pumping = true;
  if (!state.running) {
    pumping = false;
    return;
  }
  try {
    if (state.nextAt && state.nextAt > Date.now()) {
      setAction("pacing " + Math.round((state.nextAt - Date.now()) / 1000) + "s");
      state.phase = "waiting";
      await paceUntil(state.nextAt - Date.now());
    }
    await oneStep();
  } catch (e) {
    state.errors.push(String(e));
    state.errors = state.errors.slice(-20);
    persist();
  } finally {
    pumping = false;
  }
  scheduleNext();
}

function scheduleNext(): void {
  if (!state.running) return;
  const base = Date.now();
  const target = Math.max(base + 2000, state.nextAt && state.nextAt > base ? state.nextAt : base + randInt(15000, 30000));
  void chrome.alarms.create("scraper-pump", { when: target });
  void chrome.alarms.create("scraper-alive", { when: Date.now() + randInt(20000, 45000) });
}

async function oneStep(): Promise<void> {
  if (!state.running) {
    stopRun();
    return;
  }
  if (state.cooldownUntil > Date.now()) {
    state.phase = "cooldown";
    state.lastAction = "cooldown until " + new Date(state.cooldownUntil).toLocaleString();
    persist();
    return;
  }

  const settings = await getSettings();
  if (settings.respectActiveHours && !nowInActiveWindow(settings.antiDetection.activeHours)) {
    state.phase = "paused";
    state.lastAction = "outside active hours";
    persist();
    await chrome.alarms.create("scraper-pump", { when: Date.now() + 60000 });
    return;
  }

  if (state.pagesToday >= state.currentCap) {
    setAction("daily cap reached");
    await finishRun();
    void exportCsv();
    notify("Daily cap reached. CSV exported.");
    return;
  }

  if (state.phase === "preparing") {
    const t = await controlledTab();
    const warm = Math.max(8, Math.round(settings.antiDetection.warmupMin * 60));
    void sendToTab(t, { action: "WARM", seconds: warm, requestId: reqId() });
    state.phase = "warmup";
    state.nextAt = Date.now() + warm * 1000 + randInt(2000, 8000);
    setAction("warming up " + warm + "s before first search");
    persist();
    return;
  }

  if (state.phase === "warmup") {
    state.phase = "searching";
    state.stage = "search";
    state.nextAt = Date.now() + randInt(3000, 9000);
    setAction("warm-up complete - starting first search");
    persist();
    return;
  }

  if (state.stage === "search") {
    await beginSearch();
    return;
  }

  if (state.stage === "visit" || state.stage === "extract") {
    await runVisit();
    return;
  }

  if (state.stage === "done") {
    await finishRun();
    void exportCsv();
    notify("Run finished. CSV exported.");
  }
}

async function beginSearch(): Promise<void> {
  state.stage = "collect";
  if (state.keywordIdx >= state.keywords.length) {
    state.stage = "done";
    setPhase("done");
    return;
  }
  const settings = await getSettings();
  const kw = state.keywords[state.keywordIdx];
  const loc = state.locations.length ? state.locations[0] : "";
  const q = loc ? `${kw} ${loc}` : kw;
  setAction("searching: " + q);
  setPhase("searching");
  state.nextAt = 0;

  const t = await controlledTab();
  const url = "https://www.facebook.com/search/pages?q=" + encodeURIComponent(q);
  await navigateTab(t, url);
  await sleep(randInt(1500, 4000));
  const resp = await chrome.tabs.sendMessage(t, { action: "COLLECT_LINKS", requestId: reqId() }).catch(() => undefined);
  const links: string[] = isLinks(resp) ? resp.links : [];
  state.keywordIdx += 1;
  state.nextAt = Date.now() + (settings.antiDetection.searchDelayMin + Math.random() * (settings.antiDetection.searchDelayMax - settings.antiDetection.searchDelayMin)) * 1000;
  if (links.length) {
    handleCollectedLinks(links);
    setPhase("extracting");
    state.stage = "visit";
  } else {
    setAction("no results for " + kw);
    state.stage = "search";
    persist();
  }
}

async function runVisit(): Promise<void> {
  if (state.queue.length === 0) {
    state.stage = "search";
    setPhase("searching");
    persist();
    return;
  }
  const settings = await getSettings();
  const url = state.queue.shift()!;
  setAction("visiting " + url);
  const t = await controlledTab();
  await navigateTab(t, url);
  await sleep(randInt(2500, 6000));
  const sev = await detectStep(t);
  if (sev > 0) {
    enterCooldown(sev);
    return;
  }
  const data = await extractStep(t);
  if (!data) {
    state.errors.push("extract failed: " + url);
    state.errors = state.errors.slice(-20);
    persist();
    return;
  }
  await handleExtractResult(data);
  state.stage = "visit";
  state.nextAt = Date.now() + (settings.antiDetection.pageDelayMin + Math.random() * (settings.antiDetection.pageDelayMax - settings.antiDetection.pageDelayMin)) * 1000;
  persist();
}

const hydration = hydrate();
void chrome.alarms.create("scraper-alive", { when: Date.now() + 60000 });