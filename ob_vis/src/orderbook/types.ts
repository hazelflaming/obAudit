import type { Config } from "../config";

export interface BinsData {
  prices: Float64Array; // if aggregated, prices represents the midpoint of aggregation
  bins:   Float64Array[]; // flattened to bins[p_idx][t_idx], signed for buy/sell
}

export interface AggregateLevelsData {
  levelsPerSide:      number; // n best bid/asks
  timeBinCount:       number;
  bidPrices:          Float64Array; // flattened to bidprices[t_idx * levelsPerSide + level_idx]
  bidQtys:            Float64Array;
  bidParticipantQtys: Float64Array;
  askPrices:          Float64Array;
  askQtys:            Float64Array;
  askParticipantQtys: Float64Array;
}

export interface OrderbookState {
  /* min/max is _data_ min/max, not viewport */
  tMin:               number;
  tMax:               number;
  pMin:               number;
  pMax:               number;
  pBucketSize:        number;
  tBucketSize:        number;
  aggregatePriceStep: number;
  maxQuantity:        number; // opacity saturation quantity across A/B, typically a nonzero-percentile |quantity|
  binsA:              BinsData | null;
  binsB:              BinsData | null;
  aggregate:          AggregateLevelsData | null;
}

export interface SnapshotSlice {
  entries: {
    price:          number;
    qtyA:           number;
    qtyB:           number;
  }[];
  maxQty: number;
}

export interface Viewport {
  tMin: number;
  tMax: number;
  pMin: number;
  pMax: number;
}

export interface OrderBookDataMessage {
  type: "data";
  state: OrderbookState;
}

export interface OrderbookLoadMessage {
  type: "load";
  config: Config;
  width: number;
  height: number;
  tMin?: number;
  tMax?: number;
  pMin?: number;
  pMax?: number;
}
