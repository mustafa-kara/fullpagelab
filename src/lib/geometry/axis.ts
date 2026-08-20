export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function positive(value: number, fallback = 1): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function axisStarts(contentSize: number, tileSize: number, maxCount = Number.POSITIVE_INFINITY): number[] {
  const safeContent = positive(contentSize);
  const safeTile = positive(tileSize);
  const naturalCount = Math.max(1, Math.ceil(safeContent / safeTile));
  const count = Number.isFinite(maxCount) ? Math.min(naturalCount, Math.max(1, Math.floor(maxCount))) : naturalCount;
  return Array.from({ length: count }, (_, index) => index * safeTile);
}
