interface Path {
  points: Point[];
  closed: boolean;
  curved: boolean;
}
interface Point {
  x: number;
  y: number;
}
const commandLengths: Record<number, number> = { 0: 2, 1: 2, 2: 6, 3: 4 };
/** PDF.js 6 packs DrawOPS (move=0, line=1, cubic=2, quadratic=3, close=4). */
export function readPaths(
  data: readonly number[],
): { points: Point[]; closed: boolean; curved: boolean }[] {
  const result: { points: Point[]; closed: boolean; curved: boolean }[] = [];
  let path = { points: [] as Point[], closed: false, curved: false };
  for (let i = 0; i < data.length; ) {
    const op = data[i++];
    if (op === 4) {
      path.closed = true;
      continue;
    }
    if (op === 0) {
      finishPath(result, path);
      path = { points: [], closed: false, curved: false };
    }
    const length = commandLengths[op ?? -1] ?? 0;
    if (length === 0 || i + length > data.length) break;
    if (op === 2 || op === 3) path.curved = true;
    const x = data[i + length - 2],
      y = data[i + length - 1];
    path.points.push({ x: x ?? 0, y: y ?? 0 });
    i += length;
  }
  finishPath(result, path);
  return result;
}

function finishPath(result: Path[], path: Path): void {
  if (path.points.length) result.push(path);
}
