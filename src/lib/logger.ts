/**
 * Tiny ring-buffer logger for the full deposit/trade/withdraw lifecycle.
 * Persists last 200 events to localStorage for debugging.
 */
const KEY = "flash.events";
const MAX = 200;

export type FlowName = "deposit" | "trade" | "withdraw";
export interface FlowEvent {
  ts: number;
  flow: FlowName;
  step: string;
  status: "info" | "ok" | "error";
  id?: string;
  txHash?: string;
  error?: string;
  meta?: Record<string, unknown>;
}

function read(): FlowEvent[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as FlowEvent[];
  } catch {
    return [];
  }
}

function write(events: FlowEvent[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(events.slice(-MAX)));
  } catch {
    /* quota exceeded — drop oldest by halving */
    try {
      localStorage.setItem(KEY, JSON.stringify(events.slice(-MAX / 2)));
    } catch { /* ignore */ }
  }
}

export function logEvent(e: Omit<FlowEvent, "ts">) {
  const event: FlowEvent = { ts: Date.now(), ...e };
  // eslint-disable-next-line no-console
  console.info(`[${event.flow}.${event.step}]`, event.status, event.id ?? "", event.error ?? event.meta ?? "");
  write([...read(), event]);
}

export function getEvents(flow?: FlowName, id?: string): FlowEvent[] {
  const all = read();
  return all.filter((e) => (!flow || e.flow === flow) && (!id || e.id === id));
}

export function clearEvents() {
  if (typeof window !== "undefined") localStorage.removeItem(KEY);
}