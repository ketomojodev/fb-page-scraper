import { RunSettings } from "./config";

export type Severity = 0 | 1 | 2 | 3;

export interface ExtractionData {
  pageUrl: string;
  pageName: string;
  category: string;
  phone: string;
  email: string;
  website: string;
  city: string;
  country: string;
  address: string;
  id: string;
  handle: string;
  scrapedAt: string;
}

export type RunPhase =
  | "idle"
  | "preparing"
  | "warmup"
  | "searching"
  | "extracting"
  | "cooldown"
  | "paused"
  | "done"
  | "stopped";

export interface BotStatus {
  phase: RunPhase;
  running: boolean;
  keyword: string | null;
  pagesToday: number;
  pagesThisRun: number;
  errors: string[];
  lastAction: string | null;
  nextAt: number | null;
  cooldownUntil: number | null;
  severity: Severity;
  queueSize: number;
  cap: number;
}

export type ToBackground =
  | { action: "START" }
  | { action: "STOP" }
  | { action: "STATUS" }
  | { action: "EXPORT" }
  | { action: "SET_SETTINGS"; settings: RunSettings }
  | { action: "EXTRACT_RESULT"; data: ExtractionData; tabUrl: string }
  | { action: "COLLECT_LINKS_RESULT"; links: string[]; tabUrl: string }
  | { action: "DETECT_RESULT"; severity: Severity; tabUrl: string }
  | { action: "WARM_DONE"; tabUrl: string }
  | { action: "SCROLL_DONE"; tabUrl: string };

export type ToContent =
  | { action: "EXTRACT"; requestId: string }
  | { action: "COLLECT_LINKS"; requestId: string }
  | { action: "DETECT"; requestId: string }
  | { action: "WARM"; seconds: number; requestId: string }
  | { action: "SCROLL"; requestId: string };

export interface ContentOkData {
  requestId: string;
  ok: true;
  data: ExtractionData;
}
export interface ContentOkLinks {
  requestId: string;
  ok: true;
  links: string[];
}
export interface ContentOkSeverity {
  requestId: string;
  ok: true;
  severity: Severity;
}
export interface ContentOkDone {
  requestId: string;
  ok: true;
  done: true;
}
export interface ContentError {
  requestId: string;
  ok: false;
  error: string;
}

export type ContentResponse = ContentOkData | ContentOkLinks | ContentOkSeverity | ContentOkDone | ContentError;

export interface StatusOk {
  ok: true;
  status: BotStatus;
}
export interface StartedOk {
  ok: true;
  started: boolean;
}
export interface ExportedOk {
  ok: true;
  exported: boolean;
  count: number;
}
export interface RespondError {
  ok: false;
  error: string;
}

export type BackgroundResponse = StatusOk | StartedOk | ExportedOk | RespondError;

export type CastR<T> = T;