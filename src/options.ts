import { RunSettings, DEFAULT_SETTINGS, SETTINGS_KEY } from "./shared/config";
import { BackgroundResponse, BotStatus } from "./shared/messages";

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

function statusLine(kind: "success" | "warn" | "error", msg: string): void {
  const line = $("[data-statusline]") as HTMLElement;
  line.hidden = false;
  line.className = "status-line " + kind;
  ($("[data-statusmsg]") as HTMLElement).textContent = msg;
  if (kind === "success") setTimeout(() => (line.hidden = true), 4000);
}

function parseActiveHours(raw: string): [number, number][] {
  const out: [number, number][] = [];
  for (const seg of raw.split(",")) {
    const m = seg.trim().match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
    if (m) {
      const a = parseFloat(m[1]);
      const b = parseFloat(m[2]);
      if (a >= 0 && b <= 24 && a < b) out.push([a, b]);
    }
  }
  return out.length ? out : DEFAULT_SETTINGS.antiDetection.activeHours;
}

function loadIntoForm(s: RunSettings): void {
  const ad = s.antiDetection;
  (document.querySelector("[data-statusline]") as HTMLElement).hidden = true;
  ($("#keywords") as HTMLTextAreaElement).value = s.keywords.join("\n");
  ($("#locations") as HTMLInputElement).value = s.locations.join(", ");
  ($("#maxPagesPerRun") as HTMLInputElement).value = String(s.maxPagesPerRun);
  ($("#pagesPerDay") as HTMLInputElement).value = String(ad.pagesPerDay);
  ($("#pageDelayMin") as HTMLInputElement).value = String(ad.pageDelayMin);
  ($("#pageDelayMax") as HTMLInputElement).value = String(ad.pageDelayMax);
  ($("#searchDelayMin") as HTMLInputElement).value = String(ad.searchDelayMin);
  ($("#searchDelayMax") as HTMLInputElement).value = String(ad.searchDelayMax);
  ($("#warmupMin") as HTMLInputElement).value = String(ad.warmupMin);
  ($("#pagesPerHour") as HTMLInputElement).value = String(ad.pagesPerHour);
  ($("#activeHours") as HTMLInputElement).value = ad.activeHours.map(([a, b]) => `${a}-${b}`).join(", ");
  ($("#cooldownMildH") as HTMLInputElement).value = String(ad.cooldownMildH);
  ($("#cooldownModerateH") as HTMLInputElement).value = String(ad.cooldownModerateH);
  ($("#cooldownSevereH") as HTMLInputElement).value = String(ad.cooldownSevereH);
  ($("#licenseKey") as HTMLInputElement).value = s.licenseKey;
}

function numValue(id: string): number {
  const el = document.getElementById(id) as HTMLInputElement;
  if (!el) return 1;
  const v = parseFloat(el.value);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

function readFromForm(): RunSettings {
  const keywords = ($("#keywords") as HTMLTextAreaElement).value
    .split("\n")
    .map((k) => k.trim())
    .filter(Boolean);
  const locations = ($("#locations") as HTMLInputElement).value
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  const pageDelayMin = numValue("pageDelayMin");
  const pageDelayMax = Math.max(pageDelayMin, numValue("pageDelayMax"));
  const searchDelayMin = numValue("searchDelayMin");
  const searchDelayMax = Math.max(searchDelayMin, numValue("searchDelayMax"));
  return {
    keywords,
    locations,
    enabled: true,
    maxPagesPerRun: numValue("maxPagesPerRun"),
    licenseKey: ($("#licenseKey") as HTMLInputElement).value.trim(),
    antiDetection: {
      pageDelayMin,
      pageDelayMax,
      searchDelayMin,
      searchDelayMax,
      pagesPerDay: numValue("pagesPerDay"),
      pagesPerHour: numValue("pagesPerHour"),
      warmupMin: numValue("warmupMin"),
      activeHours: parseActiveHours(($("#activeHours") as HTMLInputElement).value),
      cooldownMildH: numValue("cooldownMildH"),
      cooldownModerateH: numValue("cooldownModerateH"),
      cooldownSevereH: numValue("cooldownSevereH"),
      rampStartPct: DEFAULT_SETTINGS.antiDetection.rampStartPct,
      rampStepPct: DEFAULT_SETTINGS.antiDetection.rampStepPct,
    },
  };
}

function validate(): boolean {
  const kw = $("#keywords") as HTMLTextAreaElement;
  const errorEl = $("[data-error='keywords']") as HTMLElement;
  const has = kw.value.split("\n").map((k) => k.trim()).filter(Boolean).length > 0;
  kw.classList.toggle("invalid", !has);
  errorEl.textContent = has ? "" : "Add at least one keyword.";
  return has;
}

($("[data-save]") as HTMLButtonElement).addEventListener("click", async (e) => {
  e.preventDefault();
  if (!validate()) {
    statusLine("error", "Fix the validation errors below.");
    return;
  }
  const s = readFromForm();
  await chrome.storage.local.set({ [SETTINGS_KEY]: s });
  statusLine("success", "Settings saved.");
});

($("[data-reset]") as HTMLButtonElement).addEventListener("click", async (e) => {
  e.preventDefault();
  await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  loadIntoForm(DEFAULT_SETTINGS);
  statusLine("warn", "Reset to recommended defaults.");
});

($("#keywords") as HTMLTextAreaElement).addEventListener("input", () => validate());

void (async () => {
  const res = await chrome.storage.local.get([SETTINGS_KEY]);
  const s = (res[SETTINGS_KEY] as RunSettings) ?? DEFAULT_SETTINGS;
  loadIntoForm({ ...DEFAULT_SETTINGS, ...s });
  try {
    const status = (await chrome.runtime.sendMessage({ action: "STATUS" })) as BackgroundResponse & { status?: BotStatus };
    if (status.ok && status.status && status.status.running) {
      statusLine("warn", `Bot is ${status.status.phase}. Saving applies on the next run.`);
    }
  } catch {
    /* SW cold */
  }
})();