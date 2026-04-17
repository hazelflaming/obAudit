export function getNBins(len: number, nppb: number): number {
  return Math.floor(len / nppb);
}

export function rgba(rgb: readonly [number, number, number], a: number): string {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}
