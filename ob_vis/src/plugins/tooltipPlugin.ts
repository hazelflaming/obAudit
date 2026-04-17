import uPlot from "uplot";
import { GRAPH_STYLE } from "../config";
import { formatPrice } from "../utils/axisUtils";
import { formatTime, getPrecisionValue } from "../utils/timeUtils";

export function tooltipPlugin(
  originNs: bigint,
  minPriceStep: number,
  getExternalTime?: () => number | null,
  getExternalPrice?: () => number | null,
): uPlot.Plugin {
  let tooltip: HTMLDivElement;
  let timeLine: HTMLDivElement;
  let priceLine: HTMLDivElement;
  let hovered = false;

  function updateTooltip(u: uPlot): void {
    if (!tooltip) return;

    const externalTime = getExternalTime?.() ?? null;
    const externalPrice = getExternalPrice?.() ?? null;
    const left = u.cursor.left ?? -1;
    const mainTime = hovered && left >= 0 ? u.posToVal(left, "x") : null;
    const top = u.cursor.top ?? -1;
    const mainPrice = hovered && top >= 0 ? u.posToVal(top, "y") : null;
    const usingExternalTime = externalTime != null;
    const usingExternalPrice = externalPrice != null;
    const rawTime = usingExternalTime ? externalTime : mainTime;
    const price = usingExternalPrice
      ? externalPrice
      : mainPrice;

    if (rawTime == null && price == null) {
      tooltip.style.display = "none";
      return;
    }

    tooltip.style.display = "block";
    if (rawTime != null) {
      const min = u.scales.x.min ?? 0;
      const max = u.scales.x.max ?? rawTime;
      const precision = getPrecisionValue(max - min);
      const time = formatTime(originNs, rawTime, precision, true);
      timeLine.style.display = "block";
      timeLine.textContent = time;
    } else {
      timeLine.style.display = "none";
      timeLine.textContent = "";
    }

    if (price != null) {
      priceLine.style.display = "block";
      priceLine.textContent = `Price: ${formatPrice(price, minPriceStep)}`;
    } else {
      priceLine.style.display = "none";
      priceLine.textContent = "";
    }
  }

  return {
    hooks: {
      ready: (u: uPlot) => {
        tooltip = document.createElement("div");
        tooltip.style.cssText = `
          position: absolute; pointer-events: none;
          background: ${GRAPH_STYLE.tooltipBackground}; color: ${GRAPH_STYLE.tooltipText};
          padding: 4px 8px; border-radius: 4px;
          font-size: 12px; line-height: 1.4;
          top: 8px; right: 8px; display: none;
        `;
        timeLine = document.createElement("div");
        timeLine.style.whiteSpace = "pre-line";
        priceLine = document.createElement("div");
        tooltip.append(timeLine, priceLine);
        u.over.appendChild(tooltip);

        u.over.addEventListener("mouseenter", () => {
          hovered = true;
          updateTooltip(u);
        });
        u.over.addEventListener("mouseleave", () => {
          hovered = false;
          updateTooltip(u);
        });
      },
      setCursor: updateTooltip,
      draw: updateTooltip,
    },
  };
}
