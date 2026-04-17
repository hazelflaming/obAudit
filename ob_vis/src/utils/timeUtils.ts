export type Precision = "hm" | "s" | "ms" | "us" | "ns";

const PRECISION_RANK: Record<Precision, number> = { hm: 0, s: 1, ms: 2, us: 3, ns: 4 };

export const TIME_TICK_STEPS = [
  1e-9, 2e-9, 5e-9,
  1e-8, 2e-8, 5e-8,
  1e-7, 2e-7, 5e-7,
  1e-6, 2e-6, 5e-6,
  1e-5, 2e-5, 5e-5,
  1e-4, 2e-4, 5e-4,
  1e-3, 2e-3, 5e-3,
  1e-2, 2e-2, 5e-2,
  1e-1, 2e-1, 5e-1,
  1, 2, 5, 10, 15, 30,
  60, 120, 300, 600, 900, 1800,
  3600, 7200, 10800, 14400, 21600, 43200,
  86400,
] as const;

export const PRECISION_TICK_WIDTH: Record<Precision, number> = {
  hm: 60,
  s:  1,
  ms: 1e-3,
  us: 1e-6,
  ns: 1e-9,
};

export function getPrecisionValue(span: number): Precision {
  const intervals: [number, Precision][] = [
    [600, "hm"], [10, "s"], [1, "ms"], [.001, "us"],
  ];
  return intervals.find(([tspan]) => span > tspan)?.[1] ?? "ns";
}

export function getPrecisionForStep(stepSec: number): Precision {
  if (stepSec >= PRECISION_TICK_WIDTH.hm) return "hm";
  if (stepSec >= PRECISION_TICK_WIDTH.s)  return "s";
  if (stepSec >= PRECISION_TICK_WIDTH.ms) return "ms";
  if (stepSec >= PRECISION_TICK_WIDTH.us) return "us";
  return "ns";
}

export function formatTime(originNs: bigint, offsetSec: number, precision: Precision = "ns", full = true, showDate = false): string {
  const totalNs = BigInt(Math.round(offsetSec * 1e9));
  const absNs   = originNs + totalNs;
  const absMs   = Number(absNs / 1_000_000n);
  const subMs   = Number(absNs % 1_000_000n);
  const us      = Math.floor(subMs / 1_000);
  const ns      = subMs % 1_000;
  const d       = new Date(absMs);
  const pad     = (n: number, w = 2) => String(n).padStart(w, "0");
  const hour12  = String(d.getUTCHours() % 12 || 12);
  const rank    = PRECISION_RANK[precision];
  const baseTime = `${hour12}:${pad(d.getUTCMinutes())}`
    + (rank >= PRECISION_RANK.s ? `:${pad(d.getUTCSeconds())}` : "");
  const msFraction = rank >= PRECISION_RANK.ms
    ? `.${pad(d.getUTCMilliseconds(), 3)}`
    : "";
  const compactTime = `${baseTime}${msFraction}`;
  const meridiem = d.getUTCHours() < 12 ? "AM" : "PM";
  const extraPrecision = precision === "us"
    ? `${pad(us, 3)}µs`
    : precision === "ns"
      ? `${pad(us, 3)}µs ${pad(ns, 3)}ns`
      : "";

  if (!full) {
    switch (precision) {
      case "hm": return `${baseTime} ${meridiem}`;
      case "s":
      case "ms":
        return compactTime;
      case "us":
      case "ns":
        return `${extraPrecision}\n${compactTime}`;
    }
  }

  const date = `${d.getUTCMonth()+1}/${pad(d.getUTCDate())}/${pad(d.getUTCFullYear())}`;
  const lines = [
    ...(extraPrecision ? [extraPrecision] : []),
    `${compactTime} ${meridiem}`,
    ...(showDate ? [date] : []),
  ];

  return lines.join("\n");
}
