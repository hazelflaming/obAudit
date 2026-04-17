import type { Config } from "../config";
import type { OrderbookState, OrderBookDataMessage } from "./types";

export class OrderbookFetcher {
  private worker: Worker | null = null;

  constructor(
    private config: Config,
    private obState: OrderbookState,
    private getPlotSize: () => { width: number; height: number },
    private onData: () => void,
  ) {}

  private createWorker(): Worker {
    const worker = new Worker(
      new URL("./OrderBook.worker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (e: MessageEvent<OrderBookDataMessage>) => {
      if (e.data?.type !== "data") return;
      const incoming = e.data.state;
      this.obState.tMin               = incoming.tMin;
      this.obState.tMax               = incoming.tMax;
      this.obState.pMin               = incoming.pMin;
      this.obState.pMax               = incoming.pMax;
      this.obState.pBucketSize        = incoming.pBucketSize;
      this.obState.tBucketSize        = incoming.tBucketSize;
      this.obState.aggregatePriceStep = incoming.aggregatePriceStep;
      this.obState.maxQuantity        = incoming.maxQuantity;
      this.obState.binsA              = incoming.binsA;
      this.obState.binsB              = incoming.binsB;
      this.obState.aggregate          = incoming.aggregate;
      this.onData();
    };

    worker.onerror = (err) => console.error("order book worker error:", err);

    return worker;
  }

  private coversViewport(tMin: number, tMax: number, pMin: number, pMax: number): boolean {
    if (!this.obState.binsA) return false;

    const timeTol = Math.max(this.obState.tBucketSize, Number.EPSILON);
    const priceTol = Math.max(this.obState.pBucketSize, Number.EPSILON);

    return (
      tMin >= this.obState.tMin - timeTol &&
      tMax <= this.obState.tMax + timeTol &&
      pMin >= this.obState.pMin - priceTol &&
      pMax <= this.obState.pMax + priceTol
    );
  }

  fetch(
    tMin: number,
    tMax: number,
    pMin: number,
    pMax: number,
    allowReuse = false,
  ): void {
    if (allowReuse && this.coversViewport(tMin, tMax, pMin, pMax)) return;

    this.worker ??= this.createWorker();

    const { width, height } = this.getPlotSize();
    this.worker.postMessage({
      type: "load",
      config: this.config,
      width:  width  * devicePixelRatio,
      height: height * devicePixelRatio,
      tMin, tMax, pMin, pMax,
    });
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
