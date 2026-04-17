import uPlot from "uplot";
import { GRAPH_STYLE, getSnapshotFill } from "../config";
import type { OrderbookState, SnapshotSlice, Viewport } from "../orderbook/types";
import { makePriceAxis } from "../utils/axisUtils";
import { axisTicks, axisQtyValues, hiddenYSeries, resetSelect, withClip, xySync } from "../utils/uplotUtils";

export function makeSnapshotOpts(
  el: HTMLElement,
  syncKey:  string,
  state: OrderbookState,
  viewport: Viewport,
  slice: SnapshotSlice,
  onPriceSelect?: (pMin: number, pMax: number) => void,
  onPriceReset?: () => void,
  onHoverPriceChange?: (price: number | null) => void,
): uPlot.Options {
  return {
    width:  el.clientWidth,
    height: el.clientHeight,
    scales: {
      x: { time: false, auto: false, min: 0, max: Math.max(slice.maxQty, 1) },
      y: { auto: false, min: viewport.pMin, max: viewport.pMax, range: (_u, min, max) => [min, max], },
    },
    axes: [
      {
        values: axisQtyValues,
        ticks:  axisTicks(4),
      },
      {
        ...makePriceAxis(state.aggregatePriceStep),
        ticks:  axisTicks(6),
      },
    ],
    cursor: {
      y: true, x: false,
      sync: xySync(syncKey),
      drag: { x: false, y: true, setScale: false },
    },
    legend: { show: false },
    hooks: {
      setSelect: [(u: uPlot) => {
        if (!onPriceSelect || u.select.height <= 0) return;
        const pMax = u.posToVal(u.select.top, "y");
        const pMin = u.posToVal(u.select.top + u.select.height, "y");
        resetSelect(u);
        onPriceSelect(pMin, pMax);
      }],
      ready: [(u: uPlot) => u.over.ondblclick = () => onPriceReset?.()],
    },
    series: [{}, hiddenYSeries()],
    plugins: [snapshotPlugin(state, slice, onHoverPriceChange)],
  };
}

const MARKET_BID = getSnapshotFill("bid", false);
const MARKET_ASK = getSnapshotFill("ask", false);
const PARTICIPANT_BID = getSnapshotFill("bid", true);
const PARTICIPANT_ASK = getSnapshotFill("ask", true);

export function snapshotPlugin(
  state: OrderbookState,
  slice: SnapshotSlice,
  onHoverPriceChange?: (price: number | null) => void,
) {
  let hovered = false;

  function publishHoverPrice(u: uPlot): void {
    if (!hovered) {
      onHoverPriceChange?.(null);
      return;
    }

    const top = u.cursor.top ?? -1;
    if (top < 0) {
      onHoverPriceChange?.(null);
      return;
    }

    onHoverPriceChange?.(u.posToVal(top, "y"));
  }

  return {
    hooks: {
      ready: (u: uPlot) => {
        u.over.addEventListener("mouseenter", () => {
          hovered = true;
          publishHoverPrice(u);
        });
        u.over.addEventListener("mouseleave", () => {
          hovered = false;
          publishHoverPrice(u);
        });
      },
      setCursor: publishHoverPrice,
      destroy: () => onHoverPriceChange?.(null),
      draw: (u: uPlot) => {
        publishHoverPrice(u);
        withClip(u, (ctx) => {
          const dpr = devicePixelRatio;

          if (slice.entries.length === 0) {
            ctx.fillStyle    = GRAPH_STYLE.snapshotEmptyStateText;
            ctx.font         = `${11 * dpr}px monospace`;
            ctx.textAlign    = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
              "no data",
              u.bbox.left + u.bbox.width / 2,
              u.bbox.top  + u.bbox.height / 2,
            );
            return;
          }

          const xOrigin = u.valToPos(0, "x", true);

          slice.entries.forEach(({ price, qtyA, qtyB }) => {
            const yTop = u.valToPos(price + state.pBucketSize * 0.5, "y", true);
            const yBot = u.valToPos(price - state.pBucketSize * 0.5, "y", true);
            const yPos = Math.round(Math.min(yTop, yBot));
            const rowH = Math.max(1, Math.round(Math.max(yTop, yBot)) - yPos);

            const absQty = Math.abs(qtyA);
            const xEnd   = u.valToPos(absQty, "x", true);
            const barX   = Math.round(Math.min(xOrigin, xEnd));
            const barEnd = Math.round(Math.max(xOrigin, xEnd));
            const barW   = Math.max(1, barEnd - barX);

            ctx.fillStyle = qtyA > 0 ? MARKET_BID : MARKET_ASK;
            ctx.fillRect(barX, yPos, barW, rowH);

            const absPart = Math.min(Math.abs(qtyB), absQty);
            if (absPart > 0) {
              const xPart   = u.valToPos(absPart, "x", true);
              const partEnd = Math.round(Math.max(xOrigin, xPart));
              const partW   = Math.min(Math.max(0, partEnd - barX), barW);
              if (partW > 0) {
                ctx.fillStyle = qtyA > 0 ? PARTICIPANT_BID : PARTICIPANT_ASK;
                ctx.fillRect(barX, yPos, partW, rowH);
              }
            }
          });

          const lx = u.bbox.left + u.bbox.width - 4 * dpr;
          const ly = u.bbox.top  + 4 * dpr;
          const lh = 13 * dpr;

          ctx.font         = `${9 * dpr}px monospace`;
          ctx.textBaseline = "top";
          ctx.textAlign = "right";
          ctx.fillStyle    = MARKET_BID;
          ctx.fillText("Market Bid \u25a0", lx, ly + lh * 2);
          ctx.fillStyle    = MARKET_ASK;
          ctx.fillText("Market Ask \u25a0", lx, ly);
          ctx.fillStyle    = PARTICIPANT_BID;
          ctx.fillText("Participant Bid \u25a0", lx, ly + lh * 3);
          ctx.fillStyle    = PARTICIPANT_ASK;
          ctx.fillText("Participant Ask \u25a0", lx, ly + lh);
        });
      },
    },
  };
}
