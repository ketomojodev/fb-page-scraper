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

function render(status: BotStatus): void {
  const pill = $<HTMLSpanElement>("[data-status]");
  pill.textContent = status.phase;
  pill.className = "pill " + status.phase;
  $("[data-today]").textContent = String(status.pagesToday);
  $("[data-run]").textContent = String(status.pagesThisRun);
  $("[data-queue]").textContent = String(status.queueSize);
  const last = $<HTMLDivElement>("[data-last]");
  if (status.cooldownUntil) {
    last.textContent = `Cooldown until ${new Date(status.cooldownUntil).toLocaleTimeString()}. Cap now ${status.cap}/day.`;
  } else if (status.lastAction) {
    last.textContent = "Last: " + status.lastAction;
  } else {
    last.textContent = "No run yet";
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
    if (!document.hidden) void refresh();
  }, 4000);
});