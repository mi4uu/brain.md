export function boundaryIndex(centers: number[], pos: number): number {
  let b = 0;
  for (const c of centers) if (c < pos) b++;
  return b;
}

export function moveTarget(from: number, boundary: number): number {
  return boundary > from ? boundary - 1 : boundary;
}
