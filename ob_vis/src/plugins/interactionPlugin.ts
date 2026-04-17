import uPlot from "uplot";

const PAN_THRESHOLD = 3; // px 

export interface InteractionBounds {
  tMin: number; tMax: number;
  pMin: number; pMax: number;
}

export interface InteractionCallbacks {
  zoom:   (tMin: number, tMax: number, pMin: number, pMax: number) => void;
  pan:    (tMin: number, tMax: number, pMin: number, pMax: number) => void;
  panEnd: (tMin: number, tMax: number, pMin: number, pMax: number) => void;
  click:  (tVal: number) => void;
}

export interface InteractionHandle {
  plugin:    uPlot.Plugin;
  isPanning: () => boolean;
}

export function createInteraction(
  initial:    InteractionBounds,
  cb:         InteractionCallbacks,
): InteractionHandle {
  let panning = false;
  let panRaf = 0;
  let latestDx = 0;
  let latestDy = 0;
  let panStart: {
    cx: number; cy: number;
    tMin: number; tMax: number;
    pMin: number; pMax: number;
    xPerPx: number; yPerPx: number;
  } | null = null;

  function getPannedBounds(start: NonNullable<typeof panStart>, dx: number, dy: number): InteractionBounds {
    const dt = -dx * start.xPerPx;
    const dp =  dy * start.yPerPx;

    return {
      tMin: start.tMin + dt,
      tMax: start.tMax + dt,
      pMin: start.pMin + dp,
      pMax: start.pMax + dp,
    };
  }

  function flushPanFrame(): void {
    panRaf = 0;
    if (!panStart) return;
    if (!panning && Math.hypot(latestDx, latestDy) < PAN_THRESHOLD) return;

    panning = true;
    const next = getPannedBounds(panStart, latestDx, latestDy);
    cb.pan(next.tMin, next.tMax, next.pMin, next.pMax);
  }

  const plugin: uPlot.Plugin = {
    hooks: {
      ready: (u: uPlot) => {
        u.over.ondblclick = () => cb.zoom(initial.tMin, initial.tMax, initial.pMin, initial.pMax);

        const onMove = (e: MouseEvent) => {
          if (!panStart) return;
          latestDx = e.clientX - panStart.cx;
          latestDy = e.clientY - panStart.cy;
          if (panRaf === 0) {
            panRaf = requestAnimationFrame(flushPanFrame);
          }
        };

        const onUp = (e: MouseEvent) => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup",   onUp);
          if (panRaf !== 0) {
            cancelAnimationFrame(panRaf);
            panRaf = 0;
          }

          if (panStart) {
            latestDx = e.clientX - panStart.cx;
            latestDy = e.clientY - panStart.cy;
          }

          if (panStart && (panning || Math.hypot(latestDx, latestDy) >= PAN_THRESHOLD)) {
            const next = getPannedBounds(panStart, latestDx, latestDy);
            cb.pan(next.tMin, next.tMax, next.pMin, next.pMax);
            cb.panEnd(next.tMin, next.tMax, next.pMin, next.pMax);
          } else {
            const rect = u.over.getBoundingClientRect();
            cb.click(u.posToVal(e.clientX - rect.left, "x"));
          }
          panning  = false;
          latestDx = 0;
          latestDy = 0;
          panStart = null;
        };

        u.over.addEventListener("mousedown", (e: MouseEvent) => {
          panStart = {
            cx: e.clientX, cy: e.clientY,
            tMin: u.scales.x.min!, tMax: u.scales.x.max!,
            pMin: u.scales.y.min!, pMax: u.scales.y.max!,
            xPerPx:   u.posToVal(1, "x") - u.posToVal(0, "x"),
            yPerPx: -(u.posToVal(1, "y") - u.posToVal(0, "y")),
          };
          panning = false;
          latestDx = 0;
          latestDy = 0;
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup",   onUp);
        });
      },
    },
  };

  return { plugin, isPanning: () => panning };
}
