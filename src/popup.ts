import { BackgroundResponse, BotStatus } from "./shared/messages";

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

function toast(msg: string): void {
  const el = $<HTMLDivElement>("[data-toast]");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}

async function send<T extends BackgroundResponse>(msg: unknown): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

const PHASE_LABELS: Record<string, string> = {
  idle: "Idle",
  preparing: "Preparing",
  warmup: "Warming up",
  searching: "Searching",
  extracting: "Extracting",
  waiting: "Waiting",
  cooldown: "Cooling down",
  paused: "Paused",
  done: "Done",
  stopped: "Stopped",
};

let lastStatus: BotStatus | null = null;

function render(status: BotStatus): void {
  lastStatus = status;
  const pill = $<HTMLSpanElement>("[data-status]");
  pill.textContent = PHASE_LABELS[status.phase] ?? status.phase;
  pill.className = "pill " + status.phase;
  $("[data-today]").textContent = String(status.pagesToday);
  $("[data-run]").textContent = String(status.pagesThisRun);
  $("[data-queue]").textContent = String(status.queueSize);
  const start = $<HTMLButtonElement>("[data-start]");
  start.disabled = status.running;
  $("[data-stop]").setAttribute("aria-disabled", String(!status.running));
  const last = $<HTMLDivElement>("[data-last]");
  if (status.cooldownUntil) {
    last.textContent = `Cooldown until ${new Date(status.cooldownUntil).toLocaleTimeString()}. Cap now ${status.cap}/day.`;
  } else if (status.lastAction) {
    last.textContent = "Last: " + status.lastAction;
  } else {
    last.textContent = "No run yet";
  }
  updateCountdown();
}

function updateCountdown(): void {
  const label = $<HTMLSpanElement>("[data-countdown-label]");
  const timer = $<HTMLSpanElement>("[data-countdown]");
  const s = lastStatus;
  if (!s) return;
  const pending = s.nextAt && s.nextAt > Date.now();
  const counting = pending && (s.phase === "warmup" || s.phase === "waiting");
  if (counting && s.nextAt) {
    label.textContent = PHASE_LABELS[s.phase] ?? s.phase;
    const secs = Math.max(0, Math.ceil((s.nextAt - Date.now()) / 1000));
    timer.textContent = secs + "s";
    timer.hidden = false;
  } else {
    label.textContent = "";
    timer.textContent = "";
    timer.hidden = true;
  }
}

async function refresh(): Promise<void> {
  const res = await send<BackgroundResponse>({ action: "STATUS" });
  if (res.ok && "status" in res) render(res.status);
}

$("[data-start]").addEventListener("click", async () => {
  const res = await send<BackgroundResponse>({ action: "START" });
  if (res.ok && "started" in res) {
    toast(res.started ? "Run started" : "Already running");
  } else if (!res.ok) {
    toast(res.error ?? "Failed to start");
  }
  await refresh();
});

$("[data-stop]").addEventListener("click", async () => {
  const res = await send<BackgroundResponse>({ action: "STOP" });
  if (res.ok && "started" in res) toast("Run stopped");
  await refresh();
});

$("[data-export]").addEventListener("click", async () => {
  const res = await send<BackgroundResponse>({ action: "EXPORT" });
  if (res.ok && "count" in res) toast(`Exported ${res.count} rows`);
  else if (!res.ok) toast(res.error ?? "Export failed");
});

$("#open-settings").addEventListener("click", (e) => {
  e.preventDefault();
  void chrome.runtime.openOptionsPage();
});

document.addEventListener("DOMContentLoaded", () => {
  void refresh();
  setInterval(() => {
    if (lastStatus) updateCountdown();
  }, 1000);
  setInterval(() => {
    if (!document.hidden) void refresh();
  }, 4000);
});