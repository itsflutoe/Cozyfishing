export function normalizeMovement(x: number, y: number) {
  const magnitude = Math.hypot(x, y);
  if (magnitude === 0) return { x: 0, y: 0 };
  return { x: x / magnitude, y: y / magnitude };
}
