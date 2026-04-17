import { getNBins } from "../utils/miscUtils";
import type { AggregateLevelsData, BinsData, OrderBookDataMessage, OrderbookState, OrderbookLoadMessage } from "./types";

function toBinsData(midpoints: number[], rawBins: number[][]): BinsData {
  return {
    prices: new Float64Array(midpoints),
    bins: rawBins.map(row => new Float64Array(row)),
  };
}

function toAggregateLevelsData(
  levelsPerSide:      number,
  timeBinCount:       number,
  bidPrices:          number[],
  bidQtys:            number[],
  bidParticipantQtys: number[],
  askPrices:          number[],
  askQtys:            number[],
  askParticipantQtys: number[],
): AggregateLevelsData {
  return {
    levelsPerSide,
    timeBinCount,
    bidPrices: new Float64Array(bidPrices),
    bidQtys: new Float64Array(bidQtys),
    bidParticipantQtys: new Float64Array(bidParticipantQtys),
    askPrices: new Float64Array(askPrices),
    askQtys: new Float64Array(askQtys),
    askParticipantQtys: new Float64Array(askParticipantQtys),
  };
}

function clampRequestedBins(viewportSpan: number, minStep: number, requestedBins: number): number {
  const visibleTicks = Math.max(1, Math.ceil(viewportSpan / minStep));
  return Math.min(visibleTicks, Math.max(1, requestedBins));
}

function expandRange(min: number, max: number, overscanRatio: number): { min: number; max: number } {
  const span = Math.max(0, max - min);
  const pad = span * Math.max(0, overscanRatio);
  return { min: min - pad, max: max + pad };
}

function scaleRequestedBins(baseBins: number, expandedSpan: number, visibleSpan: number): number {
  if (visibleSpan <= 0) return Math.max(1, baseBins);
  return Math.max(1, Math.ceil(baseBins * (expandedSpan / visibleSpan)));
}

function collectBuffers(state: OrderbookState): Transferable[] {
  const transfer: Transferable[] = [state.binsA!.prices.buffer];
  for (const row of state.binsA!.bins) transfer.push(row.buffer);
  if (state.binsB) {
    for (const row of state.binsB.bins) transfer.push(row.buffer);
    transfer.push(state.binsB.prices.buffer);
  }
  if (state.aggregate) {
    transfer.push(
      state.aggregate.bidPrices.buffer,
      state.aggregate.bidQtys.buffer,
      state.aggregate.bidParticipantQtys.buffer,
      state.aggregate.askPrices.buffer,
      state.aggregate.askQtys.buffer,
      state.aggregate.askParticipantQtys.buffer,
    );
  }
  return transfer;
}

let activeRequestId = 0;
let activeFetch: AbortController | null = null;

self.onmessage = async (e: MessageEvent<OrderbookLoadMessage>) => {
  if (e.data?.type !== "load") return;

  const requestId = ++activeRequestId;
  activeFetch?.abort();
  const fetchController = new AbortController();
  activeFetch = fetchController;

  const cfg = e.data.config;

  const tMin  = e.data.tMin ?? cfg.tMin;
  const tMax  = e.data.tMax ?? cfg.tMax;
  const pMin  = e.data.pMin ?? cfg.pMin;
  const pMax  = e.data.pMax ?? cfg.pMax;
  const overscanRatio = Math.max(0, cfg.viewportOverscanRatio);
  const expandedTime = expandRange(tMin, tMax, overscanRatio);
  const expandedPrice = expandRange(pMin, pMax, overscanRatio);
  const visibleNBins = getNBins(e.data.width, cfg.timeBinPx);
  const visiblePBins = getNBins(e.data.height, cfg.priceBinPx);
  const nBins = clampRequestedBins(
    expandedTime.max - expandedTime.min,
    cfg.minTimeStep,
    scaleRequestedBins(visibleNBins, expandedTime.max - expandedTime.min, tMax - tMin),
  );
  const pBins = clampRequestedBins(
    expandedPrice.max - expandedPrice.min,
    cfg.minPriceStep,
    scaleRequestedBins(visiblePBins, expandedPrice.max - expandedPrice.min, pMax - pMin),
  );

  const request = new Request(new URL(cfg.dataUrl.replace(/\/+$/, "")), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      t_min: expandedTime.min,
      t_max: expandedTime.max,
      n_bins: nBins,
      p_min: expandedPrice.min,
      p_max: expandedPrice.max,
      p_bins: pBins,
      agg_p_min: cfg.pMin,
      agg_p_max: cfg.pMax,
      visible_price_bins: cfg.bestNBins,
      min_price_step: cfg.minPriceStep,
      min_time_step: cfg.minTimeStep,
      quantity_opacity_percentile: cfg.quantityOpacityPercentile,
    }),
    signal: fetchController.signal,
  });
  
  try {
    const data = await fetch(request).then(r => r.json());
    if (requestId !== activeRequestId) return;

    const pStep = (data.p_max - data.p_min) / data.actual_p_bins;
    const midpoints = data.prices as number[];
    const binsA = toBinsData(midpoints, data.mbins_a);
    const binsB = data.mbins_b ? toBinsData(midpoints, data.mbins_b) : null;
    const aggregate =
      data.agg_levels_per_side > 0
        ? toAggregateLevelsData(
            data.agg_levels_per_side,
            data.actual_t_bins,
            data.agg_bid_prices,
            data.agg_bid_qtys,
            data.agg_bid_participant_qtys,
            data.agg_ask_prices,
            data.agg_ask_qtys,
            data.agg_ask_participant_qtys,
          )
        : null;

    const state: OrderbookState = {
      tMin:        data.t_min,
      tMax:        data.t_max,
      pMin:        data.p_min,
      pMax:        data.p_max,
      pBucketSize: pStep,
      tBucketSize: (data.t_max - data.t_min) / data.actual_t_bins,
      aggregatePriceStep: cfg.minPriceStep,
      maxQuantity: data.max_quantity || 1,
      binsA,
      binsB,
      aggregate,
    };

    self.postMessage(
      { type: "data", state } satisfies OrderBookDataMessage,
      { transfer: collectBuffers(state) },
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    throw err;
  } finally {
    if (activeFetch === fetchController) {
      activeFetch = null;
    }
  }
};
