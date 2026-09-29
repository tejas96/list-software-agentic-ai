/**
 * Board ordering uses floating-point ranks. Moving a card between two
 * neighbours takes the midpoint, so only the moved row is written.
 * When the gap becomes too small, the column is re-spaced (see needsRebalance).
 */
export const RANK_STEP = 1024;
export const MIN_RANK_GAP = 1e-6;

export function rankBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return RANK_STEP;
  if (before === null) return (after as number) - RANK_STEP;
  if (after === null) return before + RANK_STEP;
  return (before + after) / 2;
}

export function needsRebalance(before: number | null, after: number | null): boolean {
  return before !== null && after !== null && Math.abs(after - before) < MIN_RANK_GAP;
}
