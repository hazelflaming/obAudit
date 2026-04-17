import uPlot from "uplot";
import { getHeatmapOpacityBucket, getHeatmapPaletteRow, getHeatmapParticipationBucket } from "../config";
import { makePriceAxis, makeTimeAxis } from "../utils/axisUtils";
import { axisTicks, blankAxis, hiddenYSeries, resetSelect, withClip, xySync } from "../utils/uplotUtils";
import { tooltipPlugin } from "./tooltipPlugin";
import type { BinsData, OrderbookState, Viewport } from "../orderbook/types";

interface HeatmapDrawCache {
  binsA: BinsData;
  binsB: BinsData | null;
  dataTMin: number;
  dataTMax: number;
  dataPMin: number;
  dataPMax: number;
  pBucketSize: number;
  maxQuantity: number;
  bitmap: HTMLCanvasElement;
}

function renderHeatmapBitmap(
  state: OrderbookState,
  binsA: BinsData,
  binsB: BinsData | null,
  timeBinCount: number,
  priceBinCount: number,
): HTMLCanvasElement {
  const bitmap = document.createElement("canvas");
  bitmap.width = timeBinCount;
  bitmap.height = priceBinCount;

  const bitmapCtx = bitmap.getContext("2d");
  if (!bitmapCtx) {
    throw new Error("Failed to create heatmap bitmap context");
  }

  const image = bitmapCtx.createImageData(timeBinCount, priceBinCount);
  const pixels = image.data;
  const invMaxQty = 1 / state.maxQuantity;

  for (let priceIdx = 0; priceIdx < priceBinCount; priceIdx++) {
    const quantities = binsA.bins[priceIdx];
    const participantQuantities = binsB?.bins[priceIdx];
    const rowOffset = (priceBinCount - 1 - priceIdx) * timeBinCount * 4;

    for (let timeIdx = 0; timeIdx < timeBinCount; timeIdx++) {
      const quantity = quantities[timeIdx];
      if (quantity === 0) continue;

      const opacityBucket = getHeatmapOpacityBucket(Math.abs(quantity), invMaxQty);
      const participationBucket = getHeatmapParticipationBucket(quantity, participantQuantities?.[timeIdx]);
      const palette = getHeatmapPaletteRow(quantity > 0 ? "bid" : "ask", participationBucket);
      const paletteOffset = opacityBucket * 4;
      const pixelOffset = rowOffset + timeIdx * 4;

      pixels[pixelOffset] = palette[paletteOffset];
      pixels[pixelOffset + 1] = palette[paletteOffset + 1];
      pixels[pixelOffset + 2] = palette[paletteOffset + 2];
      pixels[pixelOffset + 3] = palette[paletteOffset + 3];
    }
  }

  bitmapCtx.putImageData(image, 0, 0);

  return bitmap;
}

function buildHeatmapDrawCache(
  state: OrderbookState,
  binsA: BinsData,
  binsB: BinsData | null,
  timeBinCount: number,
  priceBinCount: number,
): HeatmapDrawCache {
  return {
    binsA,
    binsB,
    dataTMin: state.tMin,
    dataTMax: state.tMax,
    dataPMin: state.pMin,
    dataPMax: state.pMax,
    pBucketSize: state.pBucketSize,
    maxQuantity: state.maxQuantity,
    bitmap: renderHeatmapBitmap(state, binsA, binsB, timeBinCount, priceBinCount),
  };
}

function canReuseHeatmapBitmap(
  cache: HeatmapDrawCache | null,
  state: OrderbookState,
  binsA: BinsData,
  binsB: BinsData | null,
): cache is HeatmapDrawCache {
  if (!cache) return false;

  return (
    cache.binsA === binsA &&
    cache.binsB === binsB &&
    cache.dataTMin === state.tMin &&
    cache.dataTMax === state.tMax &&
    cache.dataPMin === state.pMin &&
    cache.dataPMax === state.pMax &&
    cache.pBucketSize === state.pBucketSize &&
    cache.maxQuantity === state.maxQuantity
  );
}

function drawHeatmapBitmap(
  ctx: CanvasRenderingContext2D,
  u: uPlot,
  cache: HeatmapDrawCache,
): void {
  const scaleXMin = u.scales.x.min ?? cache.dataTMin;
  const scaleXMax = u.scales.x.max ?? cache.dataTMax;
  const scaleYMin = u.scales.y.min ?? cache.dataPMin;
  const scaleYMax = u.scales.y.max ?? cache.dataPMax;
  const dataTSpan = Math.max(cache.dataTMax - cache.dataTMin, Number.EPSILON);
  const dataPSpan = Math.max(cache.dataPMax - cache.dataPMin, Number.EPSILON);
  const rawSrcX = (scaleXMin - cache.dataTMin) / dataTSpan * cache.bitmap.width;
  const rawSrcY = (cache.dataPMax - scaleYMax) / dataPSpan * cache.bitmap.height;
  const rawSrcWidth = (scaleXMax - scaleXMin) / dataTSpan * cache.bitmap.width;
  const rawSrcHeight = (scaleYMax - scaleYMin) / dataPSpan * cache.bitmap.height;
  if (!(rawSrcWidth > 0) || !(rawSrcHeight > 0)) return;

  const rawSrcX2 = rawSrcX + rawSrcWidth;
  const rawSrcY2 = rawSrcY + rawSrcHeight;
  const srcX = Math.max(0, rawSrcX);
  const srcY = Math.max(0, rawSrcY);
  const srcX2 = Math.min(cache.bitmap.width, rawSrcX2);
  const srcY2 = Math.min(cache.bitmap.height, rawSrcY2);
  const srcWidth = srcX2 - srcX;
  const srcHeight = srcY2 - srcY;

  if (!(srcWidth > 0) || !(srcHeight > 0)) return;

  const destScaleX = u.bbox.width / rawSrcWidth;
  const destScaleY = u.bbox.height / rawSrcHeight;
  const destX = u.bbox.left + (srcX - rawSrcX) * destScaleX;
  const destY = u.bbox.top + (srcY - rawSrcY) * destScaleY;
  const destWidth = srcWidth * destScaleX;
  const destHeight = srcHeight * destScaleY;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    cache.bitmap,
    srcX,
    srcY,
    srcWidth,
    srcHeight,
    destX,
    destY,
    destWidth,
    destHeight,
  );
  ctx.restore();
}

function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  u: uPlot,
  state: OrderbookState,
  cache: { current: HeatmapDrawCache | null },
): void {
  const binsA = state.binsA;
  const timeBinCount = binsA?.bins[0]?.length ?? 0;
  const priceBinCount = binsA?.prices.length ?? 0;
  if (!binsA || timeBinCount === 0 || priceBinCount === 0) {
    cache.current = null;
    return;
  }

  const binsB = state.binsB;
  if (!canReuseHeatmapBitmap(cache.current, state, binsA, binsB)) {
    cache.current = buildHeatmapDrawCache(state, binsA, binsB, timeBinCount, priceBinCount);
  }

  drawHeatmapBitmap(ctx, u, cache.current);
}

export function makeHeatmapOpts(
  el: HTMLElement,
  state: OrderbookState,
  viewport: Viewport,
  syncKey: string,
  originNs: bigint,
  getExternalTime?: () => number | null,
  getExternalPrice?: () => number | null,
  extraPlugins: uPlot.Plugin[] = [],
): uPlot.Options {
  const timeAxis = makeTimeAxis(viewport.tMax - viewport.tMin, originNs);
  const yAxis: uPlot.Axis = {
    ...makePriceAxis(state.aggregatePriceStep, "Price"),
    ticks: axisTicks(6),
  };

  return {
    width: el.clientWidth,
    height: el.clientHeight,
    scales: {
      x: { time: false, min: viewport.tMin, max: viewport.tMax },
      y: { auto: false, min: viewport.pMin, max: viewport.pMax },
    },
    axes: [
      timeAxis.axis,
      { ...yAxis, side: 3 },
      { ...blankAxis(), ...yAxis, side: 1, label: undefined },
    ],
    cursor: {
      x: true,
      y: true,
      sync: xySync(syncKey, { pub: (t: string) => t === "mousemove" || t === "mouseleave" }),
      drag: { x: false, y: false, setScale: false },
    },
    legend: { show: false },
    series: [{}, hiddenYSeries()],
    plugins: [
      heatmapPlugin(state),
      tooltipPlugin(originNs, state.aggregatePriceStep, getExternalTime, getExternalPrice),
      ...extraPlugins,
    ],
    hooks: {
      setSelect: [(u: uPlot) => {
        if (u.select.width <= 0 && u.select.height <= 0) return;
        resetSelect(u);
      }],
      drawAxes: [timeAxis.drawAxes],
    },
  };
}

export function heatmapPlugin(state: OrderbookState): uPlot.Plugin {
  const cache: { current: HeatmapDrawCache | null } = { current: null };

  return {
    hooks: {
      draw: (u: uPlot) => {
        withClip(u, (ctx) => drawHeatmap(ctx, u, state, cache));
      },
    },
  };
}
