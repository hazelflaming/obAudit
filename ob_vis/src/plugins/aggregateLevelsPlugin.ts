import uPlot from "uplot";
import { GRAPH_STYLE, getAggregateLevelFill } from "../config";
import { getPriceDigits, makeTimeAxis } from "../utils/axisUtils";
import type { OrderbookState, Viewport } from "../orderbook/types";
import { axisTicks, axisQtyValues, blankAxis, hiddenYSeries, resetSelect, withClip, xySync } from "../utils/uplotUtils";
const CLICK_THRESHOLD = 3;

interface VisibleLevel {
  price: number;
  qty: number;
  participantQty: number;
}

interface VisibleLevelsAtTime {
  bids: VisibleLevel[];
  asks: VisibleLevel[];
}

function getVisibleLevelsAtTime(state: OrderbookState, tIdx: number): VisibleLevelsAtTime {
  const aggregate = state.aggregate;
  if (!aggregate || aggregate.levelsPerSide <= 0) return { bids: [], asks: [] };

  const { levelsPerSide } = aggregate;
  const bids: VisibleLevel[] = [];
  const asks: VisibleLevel[] = [];

  for (let levelIdx = 0; levelIdx < levelsPerSide; levelIdx++) {
    const flatIdx = tIdx * levelsPerSide + levelIdx;
    const qty = aggregate.bidQtys[flatIdx];
    if (qty <= 0) continue;
    bids.push({
      price: aggregate.bidPrices[flatIdx],
      qty,
      participantQty: aggregate.bidParticipantQtys[flatIdx],
    });
  }

  for (let levelIdx = 0; levelIdx < levelsPerSide; levelIdx++) {
    const flatIdx = tIdx * levelsPerSide + levelIdx;
    const qty = aggregate.askQtys[flatIdx];
    if (qty <= 0) continue;
    asks.push({
      price: aggregate.askPrices[flatIdx],
      qty,
      participantQty: aggregate.askParticipantQtys[flatIdx],
    });
  }

  return { bids, asks };
}

function clampTimeIndex(state: OrderbookState, rawTime: number): number | null {
  const nT = state.aggregate?.timeBinCount ?? 0;
  if (nT === 0) return null;

  const span = state.tMax - state.tMin;
  if (span <= 0) return 0;

  const idx = Math.floor((rawTime - state.tMin) / span * nT);
  return Math.max(0, Math.min(nT - 1, idx));
}

function formatPriceList(levels: VisibleLevel[], digits: number): string {
  if (levels.length === 0) return "--";
  return levels.map(level => level.price.toFixed(digits)).join(", ");
}

export function makeAggregateLevelsOpts(
  el:                 HTMLElement,
  state:              OrderbookState,
  viewport:           Viewport,
  syncKey:            string,
  originNs:           bigint,
  onXZoom:            (tMin: number, tMax: number) => void,
  onXReset:           () => void,
  onTimeClick:        ((tVal: number) => void) | undefined,
  getPinnedTime:      (() => number | null) | undefined,
  onHoverTimeChange:  ((tVal: number | null) => void) | undefined,
  extraPlugins:       uPlot.Plugin[] = [],
): uPlot.Options {
  const timeAxis = makeTimeAxis(viewport.tMax - viewport.tMin, originNs, "Time");

  return {
    width:  el.clientWidth,
    height: el.clientHeight,
    scales: {
      x: { time: false, min: viewport.tMin, max: viewport.tMax },
      y: { auto: false, min: -1, max: 1 },     // bounds set from Main.ts after each fetch
    },
    axes: [
      timeAxis.axis,
      {
        scale:  "y",
        label:  "Size",
        side:   3,
        values: axisQtyValues,
        ticks:  axisTicks(6),
      },
      blankAxis(),
    ],
    cursor: {
      x: true, y: false,
      sync: xySync(syncKey),
      drag: { x: true, y: false, setScale: false },
    },
    legend: { show: false },
    series: [{}, hiddenYSeries()],
    plugins: [aggregateLevelsPlugin(state, onTimeClick, getPinnedTime, onHoverTimeChange), ...extraPlugins],
    hooks: {
      setSelect: [(u: uPlot) => {
        if (u.select.width <= 0) return;
        const xMin = u.posToVal(u.select.left, "x");
        const xMax = u.posToVal(u.select.left + u.select.width, "x");
        resetSelect(u);
        onXZoom(xMin, xMax);
      }],
      ready:    [(u: uPlot) => u.over.ondblclick = () => onXReset()],
      drawAxes: [timeAxis.drawAxes],
    },
  };
}

export function aggregateLevelsPlugin(
  state:              OrderbookState,
  onTimeClick?:       (tVal: number) => void,
  getPinnedTime?:     () => number | null,
  onHoverTimeChange?: (tVal: number | null) => void,
): uPlot.Plugin {
  let tooltip: HTMLDivElement | null = null;
  let hovered = false;
  let lastPublishedTime: number | null | undefined = undefined;

  const getCursorTime = (u: uPlot): number | null => {
    const left = u.cursor.left ?? -1;
    return left < 0 ? null : u.posToVal(left, "x");
  };

  const publishHoverTime = (u: uPlot): void => {
    const nextTime = getPinnedTime?.() == null && hovered ? getCursorTime(u) : null;
    if (nextTime === lastPublishedTime) return;
    lastPublishedTime = nextTime;
    onHoverTimeChange?.(nextTime);
  };

  function updateTooltip(u: uPlot): void {
    if (!tooltip) return;

    const rawTime = getPinnedTime?.() ?? getCursorTime(u);

    if (rawTime == null) {
      tooltip.style.display = "none";
      return;
    }

    const tIdx = clampTimeIndex(state, rawTime);
    if (tIdx == null) {
      tooltip.style.display = "none";
      return;
    }

    const { bids, asks } = getVisibleLevelsAtTime(state, tIdx);
    const digits = getPriceDigits(state.aggregatePriceStep);
    tooltip.style.display = "block";
    tooltip.textContent = [
      `Best asks: ${formatPriceList(asks, digits)}`,
      `Best bids: ${formatPriceList(bids, digits)}`,
    ].join("\n");
  }

  return {
    hooks: {
      ready: (u: uPlot) => {
        tooltip = document.createElement("div");
        tooltip.style.cssText = `
          position: absolute; pointer-events: none;
          background: ${GRAPH_STYLE.aggregateTooltipBackground}; color: ${GRAPH_STYLE.tooltipText};
          padding: 4px 8px; border-radius: 4px;
          font-size: 12px; line-height: 1.4;
          white-space: pre; text-align: left;
          top: 8px; right: 8px; display: none;
        `;
        u.over.appendChild(tooltip);

        u.over.addEventListener("mouseenter", () => {
          hovered = true;
          publishHoverTime(u);
        });
        u.over.addEventListener("mouseleave", () => {
          hovered = false;
          publishHoverTime(u);
        });

        if (!onTimeClick) return;

        let downX = 0;
        let downY = 0;
        u.over.addEventListener("mousedown", (e: MouseEvent) => {
          downX = e.clientX;
          downY = e.clientY;
        });
        u.over.addEventListener("mouseup", (e: MouseEvent) => {
          if (Math.hypot(e.clientX - downX, e.clientY - downY) >= CLICK_THRESHOLD) return;
          const rect = u.over.getBoundingClientRect();
          onTimeClick(u.posToVal(e.clientX - rect.left, "x"));
        });
      },
      setCursor: (u: uPlot) => {
        publishHoverTime(u);
        updateTooltip(u);
      },
      destroy: (u: uPlot) => {
        hovered = false;
        lastPublishedTime = null;
        publishHoverTime(u);
      },
      draw: (u: uPlot) => {
        updateTooltip(u);
        withClip(u, (ctx) => {
          const aggregate = state.aggregate;
          const nT = aggregate?.timeBinCount ?? 0;
          if (!aggregate || nT === 0) return;

          const loadedTMin = state.tMin;
          const loadedTMax = state.tMax;
          const viewTMin = u.scales.x.min ?? loadedTMin;
          const viewTMax = u.scales.x.max ?? loadedTMax;
          const loadedSpan = Math.max(loadedTMax - loadedTMin, Number.EPSILON);
          const startIdx = Math.max(0, Math.floor((viewTMin - loadedTMin) / loadedSpan * nT) - 1);
          const endIdx = Math.min(nT, Math.ceil((viewTMax - loadedTMin) / loadedSpan * nT) + 1);
          if (endIdx <= startIdx) return;

          const x0       = u.valToPos(state.tMin, "x", true);
          const x1       = u.valToPos(state.tMax, "x", true);
          const pxPerBin = (x1 - x0) / nT;

          const y0Px    = u.valToPos(0, "y", true);
          const yUnitPx = u.valToPos(1, "y", true) - y0Px; 


          for (let i = startIdx; i < endIdx; i++) {
            const xL = Math.round(x0 + i * pxPerBin);
            const xR = Math.round(x0 + (i + 1) * pxPerBin);
            const xW = Math.max(1, xR - xL);
            const { bids, asks } = getVisibleLevelsAtTime(state, i);

            if (bids.length > 0) {
              let cumSize = 0;
              for (let drawIdx = 0; drawIdx < bids.length; drawIdx++) {
                const level = bids[drawIdx];
                const topVal = -cumSize;
                const botVal = -(cumSize + level.qty);
                const yTop   = Math.round(y0Px + yUnitPx * topVal);
                const yBot   = Math.round(y0Px + yUnitPx * botVal);
                const yPos   = Math.min(yTop, yBot);
                const h      = Math.max(1, Math.max(yTop, yBot) - yPos);

                const phase = drawIdx & 1;
                ctx.fillStyle = getAggregateLevelFill("bid", false, phase);
                ctx.fillRect(xL, yPos, xW, h);

                if (level.participantQty > 0) {
                  const cap        = Math.min(level.participantQty, level.qty);
                  const partBotVal = topVal - cap;
                  const yPartBot   = Math.round(y0Px + yUnitPx * partBotVal);
                  const yPartTop   = yTop;
                  const yPartPos   = Math.min(yPartTop, yPartBot);
                  const hPart      = Math.max(1, Math.max(yPartTop, yPartBot) - yPartPos);
                  ctx.fillStyle    = getAggregateLevelFill("bid", true, phase);
                  ctx.fillRect(xL, yPartPos, xW, hPart);
                }

                cumSize += level.qty;
              }
            }

            if (asks.length > 0) {
              let cumSize = 0;
              for (let drawIdx = 0; drawIdx < asks.length; drawIdx++) {
                const level = asks[drawIdx];
                const botVal = cumSize;
                const topVal = cumSize + level.qty;
                const yTop   = Math.round(y0Px + yUnitPx * topVal);
                const yBot   = Math.round(y0Px + yUnitPx * botVal);
                const yPos   = Math.min(yTop, yBot);
                const h      = Math.max(1, Math.max(yTop, yBot) - yPos);

                const phase = drawIdx & 1;
                ctx.fillStyle = getAggregateLevelFill("ask", false, phase);
                ctx.fillRect(xL, yPos, xW, h);

                if (level.participantQty > 0) {
                  const cap        = Math.min(level.participantQty, level.qty);
                  const partTopVal = botVal + cap;
                  const yPartTop   = Math.round(y0Px + yUnitPx * partTopVal);
                  const yPartBot   = yBot;
                  const yPartPos   = Math.min(yPartTop, yPartBot);
                  const hPart      = Math.max(1, Math.max(yPartTop, yPartBot) - yPartPos);
                  ctx.fillStyle    = getAggregateLevelFill("ask", true, phase);
                  ctx.fillRect(xL, yPartPos, xW, hPart);
                }

                cumSize += level.qty;
              }
            }
          }
        });
      },
    },
  };
}

export function computeAggregateYBounds(
  state:            OrderbookState,
): { minY: number; maxY: number } {
  const nT = state.aggregate?.timeBinCount ?? 0;
  if (nT === 0) return { minY: -1, maxY: 1 };

  let maxBid = 0;
  let maxAsk = 0;
  for (let i = 0; i < nT; i++) {
    const { bids, asks } = getVisibleLevelsAtTime(state, i);
    const bidSum = bids.reduce((sum, level) => sum + level.qty, 0);
    const askSum = asks.reduce((sum, level) => sum + level.qty, 0);
    if (bidSum > maxBid) maxBid = bidSum;
    if (askSum > maxAsk) maxAsk = askSum;
  }

  if (maxBid === 0) maxBid = 1;
  if (maxAsk === 0) maxAsk = 1;

  return { minY: -maxBid, maxY: maxAsk };
}
