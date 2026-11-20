import { describe, expect, it } from "vitest";
import { keyAtFace } from "./picking";

describe("merged steel picking", () => {
  it("preserves opaque piece and column keys across exclusive face boundaries", () => {
    const ranges = [
      { end: 24, key: "read:0:1/p1" },
      { end: 80, key: "read:0:1/p2" },
      { end: 100, key: "c:C1@0,0@14" },
    ];
    expect(
      [0, 23, 24, 79, 80, 99].map(face => keyAtFace(ranges, face))
    ).toEqual([
      "read:0:1/p1",
      "read:0:1/p1",
      "read:0:1/p2",
      "read:0:1/p2",
      "c:C1@0,0@14",
      "c:C1@0,0@14",
    ]);
  });
  it("clears selection for empty, out-of-range and invalid ray hits", () => {
    expect(keyAtFace([], 0)).toBeNull();
    for (const face of [-1, 24, NaN, Infinity, 0.5])
      expect(keyAtFace([{ end: 24, key: "p1" }], face)).toBeNull();
  });
  it("maps thousands of members without scanning each face or changing piece keys", () => {
    const ranges = Array.from({ length: 10000 }, (_, i) => ({
      end: (i + 1) * 200,
      key: `piece/${i}`,
    }));
    expect(keyAtFace(ranges, 1999999)).toBe("piece/9999");
    expect(keyAtFace(ranges, 960000)).toBe("piece/4800");
  });
});
