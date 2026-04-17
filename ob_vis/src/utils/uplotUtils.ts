import uPlot from "uplot";

const blankValues = (_u: uPlot, vals: number[]) => vals.map(() => "");

export function axisTicks(size: number) {
  return { show: true, size, width: 1, stroke: "#aaa" };
}

export function hiddenYSeries() {
  return { stroke: "transparent", scale: "y" };
}

export function blankAxis(side = 1, scale = "y"): uPlot.Axis {
  return { scale, side, grid: { show: false }, values: blankValues, size: 6 };
}

export function resetSelect(u: uPlot): void {
  u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
}

export function xySync(
  key: string,
  filters?: { pub?: (type: string) => boolean },
) {
  return {
    key,
    scales: ["x", "y"] as [string | null, string | null],
    ...(filters ? { filters } : {}),
  };
}

export function axisQtyValues(_u: uPlot, vals: (number | null)[]): string[] {
  return vals.map(v => {
    if (v == null) return "";
    if (v === 0) return "0";
    const abs = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    if (abs >= 1e9) return `${sign}${+(abs / 1e9).toPrecision(3)}G`;
    if (abs >= 1e6) return `${sign}${+(abs / 1e6).toPrecision(3)}M`;
    if (abs >= 1e3) return `${sign}${+(abs / 1e3).toPrecision(3)}k`;
    return `${sign}${abs}`;
  });
}

export function withClip(u: uPlot, draw: (ctx: CanvasRenderingContext2D) => void): void {
  const { ctx, bbox } = u;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
  ctx.clip();
  draw(ctx);
  ctx.restore();
}
