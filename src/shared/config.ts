export interface AntiDetectionSettings {
  pageDelayMin: number;
  pageDelayMax: number;
  searchDelayMin: number;
  searchDelayMax: number;
  pagesPerDay: number;
  pagesPerHour: number;
  warmupMin: number;
  activeHours: [number, number][];
  cooldownMildH: number;
  cooldownModerateH: number;
  cooldownSevereH: number;
  rampStartPct: number;
  rampStepPct: number;
}

export interface RunSettings {
  keywords: string[];
  locations: string[];
  enabled: boolean;
  maxPagesPerRun: number;
  respectActiveHours: boolean;
  antiDetection: AntiDetectionSettings;
  licenseKey: string;
}

export const DEFAULT_ANTI_DETECTION: AntiDetectionSettings = {
  pageDelayMin: 20,
  pageDelayMax: 45,
  searchDelayMin: 45,
  searchDelayMax: 120,
  pagesPerDay: 125,
  pagesPerHour: 10,
  warmupMin: 6,
  activeHours: [
    [0, 24],
  ],
  cooldownMildH: 12,
  cooldownModerateH: 48,
  cooldownSevereH: 72,
  rampStartPct: 20,
  rampStepPct: 15,
};

export const DEFAULT_SETTINGS: RunSettings = {
  keywords: [],
  locations: [],
  enabled: true,
  maxPagesPerRun: 125,
  respectActiveHours: false,
  antiDetection: DEFAULT_ANTI_DETECTION,
  licenseKey: "",
};

export const SETTINGS_KEY = "settings";

export function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export function jitter(k: number): number {
  const u = Math.random() || 1e-9;
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
  const logNormal = Math.exp(0.2 * z);
  const scale = 1 + Math.log1p(k) / 5;
  return k * Math.max(0.5, scale) * logNormal;
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function nowInActiveWindow(activeHours: [number, number][]): boolean {
  const d = new Date();
  const hour = d.getHours() + d.getMinutes() / 60;
  return activeHours.some(([s, e]) => hour >= s && hour < e);
}