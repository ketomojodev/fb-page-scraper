export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function humanDelay(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

export async function typeText(el: HTMLElement, text: string): Promise<void> {
  if (!("value" in el)) return;
  (el as HTMLInputElement).value = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export async function fluentScroll(el: Element | null): Promise<void> {
  if (!el) return;
  const target = el.scrollHeight - el.clientHeight;
  if (target <= 0) return;
  const steps = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < steps; i++) {
    const delta = Math.max(1, Math.round(target / steps));
    el.scrollBy({ top: delta * (0.7 + Math.random() * 0.6), behavior: "smooth" as ScrollBehavior });
    await sleep(humanDelay(450, 1200));
  }
}

export function dispatchMove(x: number, y: number): void {
  const ev = new MouseEvent("mousemove", {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    view: window,
  });
  document.dispatchEvent(ev);
}

export async function wanderToCenter(): Promise<void> {
  dispatchMove(innerWidth / 2 + (Math.random() * 200 - 100), innerHeight / 2 + (Math.random() * 160 - 80));
  await sleep(humanDelay(300, 700));
}

export function bezierPath(x0: number, y0: number, x1: number, y1: number, steps: number): [number, number][] {
  const c1x = x0 + (x1 - x0) * (0.2 + Math.random() * 0.6);
  const c1y = y0 + (y1 - y0) * (0.2 + Math.random() * 0.6);
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * x0 + 2 * mt * t * c1x + t * t * x1;
    const y = mt * mt * y0 + 2 * mt * t * c1y + t * t * y1;
    points.push([Math.round(x), Math.round(y)]);
  }
  return points;
}

export function wrapSafe(fn: () => void): void {
  try {
    fn();
  } catch {
    /* noop */
  }
}