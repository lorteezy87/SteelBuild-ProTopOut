export type FaceRange = { end: number; key: string };

/** Exclusive triangle-range ends preserve the original opaque MS.build member keys. */
export function keyAtFace(
  ranges: FaceRange[],
  faceIndex: number
): string | null {
  if (faceIndex < 0 || !Number.isInteger(faceIndex) || !ranges.length)
    return null;
  let low = 0,
    high = ranges.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (faceIndex < ranges[middle].end) high = middle;
    else low = middle + 1;
  }
  return faceIndex < ranges[low].end ? ranges[low].key : null;
}
