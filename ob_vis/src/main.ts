import uPlot from "uplot";

import { APP_CONFIG } from "./config";
import { makeHeatmapOpts } from "./plugins/heatmapPlugin";
import { makeSnapshotOpts } from "./plugins/snapshotPlugin";
import { makeAggregateLevelsOpts, computeAggregateYBounds } from "./plugins/aggregateLevelsPlugin";
import { createInteraction } from "./plugins/interactionPlugin";
import { createTimeCursor } from "./plugins/timeCursorPlugin";
import { OrderbookFetcher } from "./orderbook/OrderbookFetcher";
import type { OrderbookState, SnapshotSlice, Viewport } from "./orderbook/types";

const SYNC_KEY = "ob";

function instantiatePlots() {
  const cfg = APP_CONFIG;

  const setScale = (u: uPlot, scale: "x" | "y", min: number, max: number) => {
    const current = u.scales[scale];
    if (current.min === min && current.max === max) return;
    u.setScale(scale, { min, max });
  };

  const el1 = document.getElementById("plot1")!;
  const el2 = document.getElementById("plot2")!;
  const el3 = document.getElementById("plot3")!;

  const viewport: Viewport = {
    tMin: cfg.tMin, tMax: cfg.tMax,
    pMin: cfg.pMin, pMax: cfg.pMax,
  };

  const obState: OrderbookState = {
    tMin: cfg.tMin, tMax: cfg.tMax,
    pMin: cfg.pMin, pMax: cfg.pMax,
    pBucketSize: (cfg.pMax - cfg.pMin) / cfg.priceBinPx,
    aggregatePriceStep: cfg.minPriceStep,
    tBucketSize: 1,
    maxQuantity: 1,
    binsA: null, binsB: null,
    aggregate: null,
  };

  const snapshotSlice: SnapshotSlice = { entries: [], maxQty: 1 };
  let aggregateHoverTime: number | null = null;
  let snapshotHoverPrice: number | null = null;

  // u1.batch coalesces its two setScale calls into one redraw
  function setViewport(tMin: number, tMax: number, pMin: number, pMax: number) {
    Object.assign(viewport, { tMin, tMax, pMin, pMax });
    u1.batch(() => {
      setScale(u1, "x", tMin, tMax);
      setScale(u1, "y", pMin, pMax);
    });
    setScale(u2, "x", tMin, tMax);
    setScale(u3, "y", pMin, pMax);
  }

  function onZoom(tMin: number, tMax: number, pMin: number, pMax: number) {
    setViewport(tMin, tMax, pMin, pMax);
    const pinned = cursor.pinnedTime;
    if (pinned != null && (pinned < tMin || pinned >= tMax)) {
      cursor.reset();
    }
    fetcher.fetch(tMin, tMax, pMin, pMax);
  }

  const interaction = createInteraction(
    { tMin: cfg.tMin, tMax: cfg.tMax, pMin: cfg.pMin, pMax: cfg.pMax },
    {
      zoom:   onZoom,
      pan:    setViewport,
      panEnd: (t, T, p, P) => fetcher.fetch(t, T, p, P, true),
      click:  (tVal) => cursor.onClick(tVal),
    },
  );

  const cursor = createTimeCursor({
    obState,
    snapshotSlice,
    isPanning:        () => interaction.isPanning(),
    onSnapshotUpdate: () => u3.redraw(),
  });

  // Plots are declared bottom-to-top because earlier plots reference later ones.
  const u3 = new uPlot(
    makeSnapshotOpts(
      el3,
      SYNC_KEY,
      obState,
      viewport,
      snapshotSlice,
      (pMin, pMax) => onZoom(viewport.tMin, viewport.tMax, pMin, pMax),
      () => onZoom(viewport.tMin, viewport.tMax, cfg.pMin, cfg.pMax),
      (price) => {
        if (snapshotHoverPrice === price) return;
        snapshotHoverPrice = price;
        u1.redraw(false);
      },
    ),
    [[], []], el3,
  );

  const u2 = new uPlot(
    makeAggregateLevelsOpts(
      el2, obState, viewport, SYNC_KEY, cfg.originNs,
      (tMin, tMax) => onZoom(tMin, tMax, viewport.pMin, viewport.pMax),
      () => onZoom(cfg.tMin, cfg.tMax, viewport.pMin, viewport.pMax),
      (tVal) => cursor.onClick(tVal),
      () => cursor.pinnedTime,
      (tVal) => {
        if (aggregateHoverTime === tVal) return;
        aggregateHoverTime = tVal;
        u1.redraw(false);
      },
      [cursor.mirrorPlugin],
    ),
    [[], []], el2,
  );

  const u1 = new uPlot(
    makeHeatmapOpts(
      el1, obState, viewport, SYNC_KEY, cfg.originNs,
      () => cursor.pinnedTime ?? aggregateHoverTime,
      () => snapshotHoverPrice,
      [interaction.plugin, cursor.plugin],
    ),
    [[cfg.tMin, cfg.tMax], [null, null]], el1,
  );

  const fetcher = new OrderbookFetcher(
    cfg,
    obState,
    () => ({ width: el1.clientWidth, height: el1.clientHeight }),
    () => {
      cursor.updateSnapshot(cursor.pinnedTime);
      setScale(u3, "x", 0, snapshotSlice.maxQty || 1);
      const { minY, maxY } = computeAggregateYBounds(obState);
      setScale(u2, "y", minY, maxY);
      u1.redraw();
    },
  );

  fetcher.fetch(cfg.tMin, cfg.tMax, cfg.pMin, cfg.pMax);

  const ro = new ResizeObserver(() => {
    for (const [plot, host] of [[u1, el1], [u2, el2], [u3, el3]] as const) {
      plot.setSize({ width: host.clientWidth, height: host.clientHeight });
    }
  });
  [el1, el2, el3].forEach(el => ro.observe(el));
}

document.readyState === "loading"
  ? document.addEventListener("DOMContentLoaded", instantiatePlots)
  : instantiatePlots();
