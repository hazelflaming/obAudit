import { Precision, TIME_TICK_STEPS, formatTime, getPrecisionForStep } from "./timeUtils";
import uPlot from "uplot";

const TIME_AXIS_LINE_GAP = 1.5;

const GUTTER = 6;

const TIME_LABEL_MIN_WIDTH: Record<Precision, number> = {
  hm: 56,
  s: 78,
  ms: 112,
  us: 112,
  ns: 112,
};

const timeTickStyle = { show: true, size: 6, width: 1, stroke: "#aaa" };

function withAxisFont<T>(u: uPlot, fn: (ctx: CanvasRenderingContext2D) => T): T {
  const { ctx } = u;
  ctx.save();
  ctx.font = (u.axes[0].font as any)[0] as string;
  const result = fn(ctx);
  ctx.restore();
  return result;
}

function measureLines(ctx: CanvasRenderingContext2D, text: string): number {
  return Math.max(...text.split("\n").map(l => ctx.measureText(l).width));
}

export function getPriceDigits(step: number): number {
  const normalized = step.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  const dot = normalized.indexOf(".");
  return dot === -1 ? 0 : normalized.length - dot - 1;
}

function formatPriceLabel(value: number, digits: number): string {
  return value
    .toFixed(digits)
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "");
}

export function formatPrice(value: number, minPriceStep: number): string {
  if (!Number.isFinite(value) || !(minPriceStep > 0)) {
    return formatPriceLabel(value, getPriceDigits(minPriceStep));
  }

  const units = Math.round(value / minPriceStep);
  const snapped = units * minPriceStep;
  return formatPriceLabel(snapped, getPriceDigits(minPriceStep));
}

function nicePriceTickUnits(roughUnits: number): number {
  if (!Number.isFinite(roughUnits) || roughUnits <= 1) return 1;
  const decade = 10 ** Math.floor(Math.log10(roughUnits));
  const scaled = roughUnits / decade;
  if (scaled <= 2) return 2 * decade;
  if (scaled <= 5) return 5 * decade;
  return scaled <= 1 ? decade : 10 * decade;
}

export function makePriceAxis(minPriceStep: number, label?: string): uPlot.Axis {
  const digits = getPriceDigits(minPriceStep);

  return {
    ...(label !== undefined ? { label } : {}),
    scale: "y",
    splits: (u: uPlot): number[] => {
      const min = u.scales.y.min ?? 0;
      const max = u.scales.y.max ?? 0;
      const span = max - min;
      if (!(span > 0) || !(minPriceStep > 0)) return [];

      const maxTicks  = Math.max(2, Math.floor((u.bbox.height / devicePixelRatio) / 36));
      const tickUnits = nicePriceTickUnits((span / maxTicks) / minPriceStep);
      const epsilon   = minPriceStep * 1e-6;
      const first     = Math.ceil((min - epsilon) / minPriceStep / tickUnits) * tickUnits;
      const last      = Math.floor((max + epsilon) / minPriceStep / tickUnits) * tickUnits;

      const ticks: number[] = [];
      for (let tick = first; tick <= last; tick += tickUnits) ticks.push(tick * minPriceStep);
      return ticks;
    },
    values: (_u, vals) => vals.map(v => (v == null ? "" : formatPriceLabel(v, digits))),
  };
}

export function makeTimeAxis(
  spanSec:  number,
  originNs: bigint,
  label?:   string | null,
): { axis: uPlot.Axis; drawAxes: (u: uPlot) => void } {
  const { valuesCallback, formatTickEdge, getLastTicks, getEdgeLabelWidth, setTickStep } =
    makeTimeAxisValues(spanSec, originNs);

  return {
    axis: {
      ...(label != null ? { label } : {}),
      lineGap: 1,
      splits: makeTimeAxisSplits(spanSec, originNs, getEdgeLabelWidth, setTickStep),
      values: valuesCallback,
      ticks:  timeTickStyle,
    },
    drawAxes: createDrawAxesHook(getLastTicks, formatTickEdge),
  };
}

export function makeTimeAxisValues(spanSec: number, originNs: bigint) {
  let lastTicks: number[] = [];
  let lastTickStep = getDefaultTimeTickStep(spanSec);

  const setTickStep = (tickStep: number) => {
    lastTickStep = tickStep > 0 ? tickStep : lastTickStep;
  };

  const getPrecision = (): Precision => getPrecisionForStep(lastTickStep);

  const formatTickEdge = (u: uPlot, t: number) =>
    formatTime(originNs, t, getPrecision(), true, true);

  const valuesCallback = (_u: uPlot, ticks: number[]): string[] => {
    lastTicks = ticks;
    const precision = getPrecision();

    return ticks.map((t, i) =>
      i === 0 || i === ticks.length - 1 ? "" : formatTime(originNs, t, precision, false)
    );
  };

  const getEdgeLabelWidth = (u: uPlot): { left: number; right: number } => {
    if (!lastTicks.length) return { left: 0, right: 0 };
    return withAxisFont(u, ctx => ({
      left:  measureLines(ctx, formatTickEdge(u, lastTicks[0])) / devicePixelRatio,
      right: measureLines(ctx, formatTickEdge(u, lastTicks[lastTicks.length - 1])) / devicePixelRatio,
    }));
  };

  return { valuesCallback, formatTickEdge, getLastTicks: () => lastTicks, getEdgeLabelWidth, setTickStep };
}

export function makeTimeAxisSplits(
  spanSec:          number,
  originNs:         bigint,
  getEdgeLabelWidth: (u: uPlot) => { left: number; right: number },
  setTickStep:      (tickStep: number) => void,
) {
  return (u: uPlot): number[] => {
    const min      = u.scales.x.min ?? 0;
    const max      = u.scales.x.max ?? spanSec;
    const currSpan = max - min;
    const plotWidthPx = u.bbox.width / devicePixelRatio;
    const tickwidth = chooseTimeTickStep(currSpan, plotWidthPx);
    const precision = getPrecisionForStep(tickwidth);
    setTickStep(tickwidth);

    const ticks = buildTimeTicks(min, max, tickwidth, originNs);
    if (!ticks.length || ticks[0] > min)      ticks.unshift(min);
    if (ticks[ticks.length - 1] < max)        ticks.push(max);

    const { left: leftEdge, right: rightEdge } = getEdgeLabelWidth(u);

    return withAxisFont(u, ctx => {
      const labelHalfWidth = (t: number) =>
        measureLines(ctx, formatTime(originNs, t, precision, false)) / devicePixelRatio / 2;

      return ticks.filter((t, i) => {
        if (i === 0 || i === ticks.length - 1) return true;
        const xPx = u.valToPos(t, "x");
        const half = labelHalfWidth(t);
        return xPx - half >= leftEdge + GUTTER && xPx + half <= plotWidthPx - rightEdge - GUTTER;
      });
    });
  };
}

function getDefaultTimeTickStep(spanSec: number): number {
  return TIME_TICK_STEPS.find(step => spanSec / step <= 10) ?? TIME_TICK_STEPS[TIME_TICK_STEPS.length - 1];
}

function chooseTimeTickStep(spanSec: number, plotWidthPx: number): number {
  if (!(spanSec > 0) || !(plotWidthPx > 0)) return getDefaultTimeTickStep(spanSec);

  for (const step of TIME_TICK_STEPS) {
    const precision = getPrecisionForStep(step);
    const maxLabels = Math.max(2, Math.floor(plotWidthPx / TIME_LABEL_MIN_WIDTH[precision]));
    if (spanSec / step <= maxLabels) return step;
  }

  return TIME_TICK_STEPS[TIME_TICK_STEPS.length - 1];
}

function normalizeTickValue(value: number): number {
  return Number(value.toPrecision(15));
}

function toNs(valueSec: number): bigint {
  return BigInt(Math.round(valueSec * 1e9));
}

function floorDiv(dividend: bigint, divisor: bigint): bigint {
  const quotient = dividend / divisor;
  const remainder = dividend % divisor;
  return remainder < 0n ? quotient - 1n : quotient;
}

function ceilDiv(dividend: bigint, divisor: bigint): bigint {
  const quotient = dividend / divisor;
  const remainder = dividend % divisor;
  return remainder > 0n ? quotient + 1n : quotient;
}

function buildTimeTicks(min: number, max: number, tickStep: number, originNs: bigint): number[] {
  const stepNs = toNs(tickStep);
  if (stepNs <= 0n) return [];

  const epsilonNs = stepNs / 1_000_000n;
  const absMinNs = originNs + toNs(min) - epsilonNs;
  const absMaxNs = originNs + toNs(max) + epsilonNs;
  const first = ceilDiv(absMinNs, stepNs);
  const last = floorDiv(absMaxNs, stepNs);
  const ticks: number[] = [];

  for (let unit = first; unit <= last; unit++) {
    const offsetSec = Number(unit * stepNs - originNs) / 1e9;
    ticks.push(normalizeTickValue(offsetSec));
  }

  return ticks;
}

function createDrawAxesHook(
  getLastTicks:   () => number[],
  formatTickEdge: (u: uPlot, t: number) => string,
) {
  return (u: uPlot) => {
    const lastTicks = getLastTicks();
    if (!lastTicks.length) return;

    const pxRatio  = devicePixelRatio;
    const y = Math.round((u.axes[0] as any)._pos * pxRatio)
            + Math.round((u.axes[0].ticks as any).size * pxRatio)
            + Math.round((u.axes[0].gap as number) * pxRatio);

    withAxisFont(u, ctx => {
      ctx.fillStyle    = (typeof u.axes[0].stroke === "function"
        ? u.axes[0].stroke(u, 0)
        : u.axes[0].stroke ?? "#000") as string;
      ctx.textBaseline = "top";

      const { actualBoundingBoxAscent: asc, actualBoundingBoxDescent: desc } = ctx.measureText("M");
      const lineHeight = asc + desc;

      const fillMultiline = (text: string, x: number) => {
        let row = 0;
        text.split("\n").forEach(line => {
          if (line === "") return;
          ctx.fillText(line, x, y + row * lineHeight * TIME_AXIS_LINE_GAP);
          row += 1;
        });
      };

      ctx.textAlign = "left";
      fillMultiline(formatTickEdge(u, lastTicks[0]), u.bbox.left);

      ctx.textAlign = "right";
      fillMultiline(formatTickEdge(u, lastTicks[lastTicks.length - 1]), u.bbox.left + u.bbox.width);
    });
  };
}
