import uPlot from "uplot";
import { GRAPH_STYLE } from "../config";
import type { OrderbookState, SnapshotSlice } from "../orderbook/types";

export interface TimeCursorDeps {
  obState:          OrderbookState;
  snapshotSlice:    SnapshotSlice;
  isPanning:        () => boolean;
  onSnapshotUpdate: () => void;
}

export interface TimeCursorHandle {
  plugin:         uPlot.Plugin;
  mirrorPlugin:   uPlot.Plugin;
  onClick:        (tVal: number) => void;
  reset:          () => void;
  updatePinLine:  () => void;
  updateSnapshot: (tVal: number | null) => void;
  readonly pinnedTime: number | null;
}

export function createTimeCursor(deps: TimeCursorDeps): TimeCursorHandle {
  let pinnedTime: number | null = null;
  const plots = new Set<uPlot>();
  const cursorBars = new Map<uPlot, HTMLDivElement | null>();

  const nBins    = () => deps.obState.binsA?.bins[0]?.length ?? 0;
  const binWidth = () => {
    const n = nBins();
    return n > 0 ? (deps.obState.tMax - deps.obState.tMin) / n : 0;
  };

  function registerPlot(plot: uPlot): void {
    plots.add(plot);
    cursorBars.set(plot, plot.over.querySelector(".u-cursor-x"));
    syncCursorBars();
  }

  function unregisterPlot(plot: uPlot): void {
    plots.delete(plot);
    cursorBars.delete(plot);
  }

  function updatePinLine(): void {
    plots.forEach(plot => plot.redraw(false));
  }

  function syncCursorBars(): void {
    const hidden = pinnedTime !== null;
    cursorBars.forEach(bar => {
      if (bar) bar.style.visibility = hidden ? "hidden" : "";
    });
  }

  function drawPinLine(u: uPlot): void {
    if (pinnedTime === null) return;

    const x = u.valToPos(pinnedTime, "x", true);
    const { left, top, width, height } = u.bbox;
    const right = left + width;
    if (!Number.isFinite(x) || x < left || x > right) return;

    const lineWidth = Math.max(1, Math.round(devicePixelRatio || 1));
    const crispOffset = lineWidth % 2 === 0 ? 0 : 0.5;
    const xPx = Math.round(x) + crispOffset;

    u.ctx.save();
    u.ctx.beginPath();
    u.ctx.rect(left, top, width, height);
    u.ctx.clip();
    u.ctx.beginPath();
    u.ctx.strokeStyle = GRAPH_STYLE.timeCursorStroke;
    u.ctx.lineWidth = lineWidth;
    u.ctx.setLineDash([8 * lineWidth, 2 * lineWidth]);
    u.ctx.moveTo(xPx, top);
    u.ctx.lineTo(xPx, top + height);
    u.ctx.stroke();
    u.ctx.restore();
  }

  function updateSnapshot(tVal: number | null): void {
    const { obState, snapshotSlice } = deps;
    snapshotSlice.maxQty = obState.maxQuantity;

    if (tVal === null || !obState.binsA) {
      snapshotSlice.entries = [];
      deps.onSnapshotUpdate();
      return;
    }

    const n    = nBins();
    const frac = (tVal - obState.tMin) / (obState.tMax - obState.tMin);
    if (n === 0 || frac < 0 || frac >= 1) {
      snapshotSlice.entries = [];
      deps.onSnapshotUpdate();
      return;
    }
    const bin = Math.floor(frac * n);

    const entries: SnapshotSlice["entries"] = [];
    const binsB = obState.binsB;
    obState.binsA.prices.forEach((price, pIdx) => {
      const qtyA = obState.binsA!.bins[pIdx][bin] ?? 0;
      if (qtyA === 0) return;
      const qtyB = binsB?.bins[pIdx]?.[bin] ?? 0;
      // only count participant qty when signs match
      const participant =
        qtyB !== 0 && (qtyB > 0) === (qtyA > 0) ? qtyB : 0;
      entries.push({ price, qtyA, qtyB: participant });
    });

    snapshotSlice.entries = entries;
    deps.onSnapshotUpdate();
  }

  function onClick(tVal: number): void {
    if (pinnedTime !== null && Math.abs(tVal - pinnedTime) < binWidth()) {
      pinnedTime = null;
    } else {
      pinnedTime = tVal;
    }
    syncCursorBars();
    updatePinLine();
    updateSnapshot(pinnedTime);
  }

  function reset(): void {
    pinnedTime = null;
    syncCursorBars();
    updatePinLine();
    updateSnapshot(null);
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const n = nBins();
    if (n === 0) return;
    e.preventDefault();

    const bw = binWidth();
    if (pinnedTime === null) {
      pinnedTime = deps.obState.tMin + bw * Math.floor(n / 2);
    }

    const dir = e.key === "ArrowRight" ? 1 : -1;
    pinnedTime = Math.max(
      deps.obState.tMin,
      Math.min(deps.obState.tMax - bw * 0.5, pinnedTime + dir * bw),
    );

    syncCursorBars();
    updatePinLine();
    updateSnapshot(pinnedTime);
  };

  const plugin: uPlot.Plugin = {
    hooks: {
      ready: (u: uPlot) => {
        registerPlot(u);
        window.addEventListener("keydown", onKeyDown);
      },
      destroy: (u: uPlot) => {
        unregisterPlot(u);
        window.removeEventListener("keydown", onKeyDown);
      },
      setCursor: (u: uPlot) => {
        if (deps.isPanning() || pinnedTime !== null) return;
        const left = u.cursor.left ?? -1;
        updateSnapshot(left < 0 ? null : u.posToVal(left, "x"));
      },
      draw: drawPinLine,
    },
  };

  const mirrorPlugin: uPlot.Plugin = {
    hooks: {
      ready: registerPlot,
      destroy: unregisterPlot,
      draw: drawPinLine,
    },
  };

  return {
    plugin,
    mirrorPlugin,
    onClick,
    reset,
    updatePinLine,
    updateSnapshot,
    get pinnedTime() { return pinnedTime; },
  };
}
