import { rgba } from "./utils/miscUtils";

export interface Config {
  dataUrl: string;
  originNs: bigint;
  tMin: number;
  tMax: number;
  pMin: number;
  pMax: number;
  priceBinPx: number;
  timeBinPx: number;
  viewportOverscanRatio: number;
  minPriceStep: number;
  minTimeStep: number;
  bestNBins: number;
  quantityOpacityPercentile: number;
}

export interface GraphOpacityConfig {
  heatmap: {
    quantityFractionPower: number;
  };
  snapshot: {
    fill: number;
  };
  aggregate: {
    emphasis: number;
    marketMuted: number;
    participantBidMuted: number;
    participantAskMuted: number;
  };
}

export interface GraphStyleConfig {
  palette: GraphColorPalette;
  opacity: GraphOpacityConfig;
  snapshotEmptyStateText: string;
  tooltipBackground: string;
  aggregateTooltipBackground: string;
  tooltipText: string;
  timeCursorStroke: string;
}

export type RgbColor = readonly [number, number, number];
export type BookSide = "bid" | "ask";

export interface GraphColorPalette {
  marketBid: RgbColor;
  marketAsk: RgbColor;
  participantBid: RgbColor;
  participantAsk: RgbColor;
}

export const GRAPH_STYLE: GraphStyleConfig = {
  palette: {
    marketBid: [0, 200, 80],
    marketAsk: [255, 60, 60],
    participantBid: [0, 220, 255],
    participantAsk: [255, 50, 255],
  },
  opacity: {
    heatmap: {
      quantityFractionPower: 5 / 8,
    },
    snapshot: {
      fill: 0.75,
    },
    aggregate: {
      emphasis: 0.75,
      marketMuted: 0.30,
      participantBidMuted: 0.50,
      participantAskMuted: 0.30,
    },
  },
  snapshotEmptyStateText: "#444",
  tooltipBackground: "rgba(0,0,0,0.75)",
  aggregateTooltipBackground: "rgba(0,0,0,0.78)",
  tooltipText: "white",
  timeCursorStroke: "#607D8B",
};

const MIN_OPACITY = 0.2;
const HEATMAP_OPACITY_BUCKETS = 256;
const HEATMAP_PARTICIPATION_BUCKETS = 32;
const LAST_HEATMAP_OPACITY_BUCKET = HEATMAP_OPACITY_BUCKETS - 1;
const LAST_HEATMAP_PARTICIPATION_BUCKET = HEATMAP_PARTICIPATION_BUCKETS - 1;

type HeatmapPalette2D = Uint8ClampedArray[];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function buildHeatmapPalette2D(
  rgb0: RgbColor,
  rgb1: RgbColor,
): HeatmapPalette2D {
  const out = new Array<Uint8ClampedArray>(HEATMAP_PARTICIPATION_BUCKETS);

  for (let p = 0; p < HEATMAP_PARTICIPATION_BUCKETS; p++) {
    const tCol = p / LAST_HEATMAP_PARTICIPATION_BUCKET;
    const r = Math.round(lerp(rgb0[0], rgb1[0], tCol));
    const g = Math.round(lerp(rgb0[1], rgb1[1], tCol));
    const b = Math.round(lerp(rgb0[2], rgb1[2], tCol));
    const row = new Uint8ClampedArray(HEATMAP_OPACITY_BUCKETS * 4);

    for (let o = 0; o < HEATMAP_OPACITY_BUCKETS; o++) {
      const f = o / LAST_HEATMAP_OPACITY_BUCKET;
      const opacity = lerp(
        MIN_OPACITY,
        1,
        f ** GRAPH_STYLE.opacity.heatmap.quantityFractionPower,
      );
      const offset = o * 4;
      row[offset] = r;
      row[offset + 1] = g;
      row[offset + 2] = b;
      row[offset + 3] = Math.round(opacity * 255);
    }

    out[p] = row;
  }

  return out;
}

const HEATMAP_PALETTES = {
  bid: buildHeatmapPalette2D(GRAPH_STYLE.palette.marketBid, GRAPH_STYLE.palette.participantBid),
  ask: buildHeatmapPalette2D(GRAPH_STYLE.palette.marketAsk, GRAPH_STYLE.palette.participantAsk),
} as const;

const SNAPSHOT_FILLS = {
  bid: {
    market: rgba(GRAPH_STYLE.palette.marketBid, GRAPH_STYLE.opacity.snapshot.fill),
    participant: rgba(GRAPH_STYLE.palette.participantBid, GRAPH_STYLE.opacity.snapshot.fill),
  },
  ask: {
    market: rgba(GRAPH_STYLE.palette.marketAsk, GRAPH_STYLE.opacity.snapshot.fill),
    participant: rgba(GRAPH_STYLE.palette.participantAsk, GRAPH_STYLE.opacity.snapshot.fill),
  },
} as const;

const AGGREGATE_FILLS = {
  bid: {
    market: [
      rgba(GRAPH_STYLE.palette.marketBid, GRAPH_STYLE.opacity.aggregate.emphasis),
      rgba(GRAPH_STYLE.palette.marketBid, GRAPH_STYLE.opacity.aggregate.marketMuted),
    ],
    participant: [
      rgba(GRAPH_STYLE.palette.participantBid, GRAPH_STYLE.opacity.aggregate.emphasis),
      rgba(GRAPH_STYLE.palette.participantBid, GRAPH_STYLE.opacity.aggregate.participantBidMuted),
    ],
  },
  ask: {
    market: [
      rgba(GRAPH_STYLE.palette.marketAsk, GRAPH_STYLE.opacity.aggregate.emphasis),
      rgba(GRAPH_STYLE.palette.marketAsk, GRAPH_STYLE.opacity.aggregate.marketMuted),
    ],
    participant: [
      rgba(GRAPH_STYLE.palette.participantAsk, GRAPH_STYLE.opacity.aggregate.emphasis),
      rgba(GRAPH_STYLE.palette.participantAsk, GRAPH_STYLE.opacity.aggregate.participantAskMuted),
    ],
  },
} as const;

export function getHeatmapOpacityBucket(absQty: number, invMaxQty: number): number {
  const fraction = absQty * invMaxQty;
  return fraction >= 1 ? LAST_HEATMAP_OPACITY_BUCKET : (fraction * HEATMAP_OPACITY_BUCKETS) | 0;
}

export function getHeatmapParticipationBucket(q: number, qb: number | undefined): number {
  if (qb == null || qb === 0 || (qb > 0) !== (q > 0)) return 0;

  const absQty = Math.abs(q);
  const absParticipantQty = Math.abs(qb);
  const participation = Math.min(1, absParticipantQty / absQty);

  return (participation * LAST_HEATMAP_PARTICIPATION_BUCKET + 0.5) | 0;
}

export function getHeatmapPaletteRow(
  side: BookSide,
  participationBucket: number,
): Uint8ClampedArray {
  const clampedBucket = Math.max(0, Math.min(LAST_HEATMAP_PARTICIPATION_BUCKET, participationBucket));
  return HEATMAP_PALETTES[side][clampedBucket];
}

export function getSnapshotFill(side: BookSide, participant: boolean): string {
  return participant ? SNAPSHOT_FILLS[side].participant : SNAPSHOT_FILLS[side].market;
}

export function getAggregateLevelFill(
  side: BookSide,
  participant: boolean,
  phase: number,
): string {
  const fills = participant ? AGGREGATE_FILLS[side].participant : AGGREGATE_FILLS[side].market;
  return fills[phase & 1];
}

export const APP_CONFIG: Config = {
  dataUrl: "http://127.0.0.1:3001/heatmap",
  originNs: 1726012800000000000n,
  tMin: 14400,
  tMax: 72000,
  pMin: 0,
  pMax: 2,
  priceBinPx: 1,
  timeBinPx: 2,
  viewportOverscanRatio: .2,
  minPriceStep: 0.01,
  minTimeStep: 1e-9,
  bestNBins: 5,
  quantityOpacityPercentile: 0.998,
};
