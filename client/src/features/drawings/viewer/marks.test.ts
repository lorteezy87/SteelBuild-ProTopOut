// Markup geometry: stored points are cleaned, shapes reshape by their points or box, measurements read in feet.
import { describe, expect, it } from "vitest";
import { cloudArcs, handles, markAt, mayChange, measureText, polyArea, reshape, toFrac, type P2 } from "./marks";

describe("markups", () => {
  it("points are stored as clamped, rounded fractions of the page", () => {
    expect(
      toFrac(
        [
          [-10, 2000],
          [Number.NaN, 5],
          [123.456789, 500],
        ],
        1000,
        1000
      )
    ).toEqual([
      [0, 1],
      [0.12346, 0.5],
    ]);
  });
  it("long pen strokes are thinned but keep their last point", () => {
    const pts: P2[] = Array.from({ length: 1001 }, (_, i) => [i, i]);
    const f = toFrac(pts, 1000, 1000, 400);
    expect(f.length).toBeLessThanOrEqual(401);
    expect(f[f.length - 1]).toEqual([1, 1]);
  });
  it("two-point shapes reshape by their points, the rest by their box", () => {
    expect(
      handles("arrow", [
        [0, 0],
        [10, 10],
      ])
    ).toEqual([
      [0, 0],
      [10, 10],
    ]);
    expect(handles("text", [[5, 5]])).toEqual([]);
    expect(
      handles("pen", [
        [0, 0],
        [10, 0],
        [10, 20],
      ]).length
    ).toBe(4);
    expect(
      reshape(
        "arrow",
        [
          [0, 0],
          [10, 10],
        ],
        "h",
        1,
        5,
        -5
      )
    ).toEqual([
      [0, 0],
      [15, 5],
    ]);
    expect(
      reshape(
        "pen",
        [
          [0, 0],
          [10, 10],
        ],
        "move",
        -1,
        2,
        3
      )
    ).toEqual([
      [2, 3],
      [12, 13],
    ]);
    // dragging the bottom-right corner of a pen stroke's box doubles it about the top-left corner
    expect(
      reshape(
        "pen",
        [
          [0, 0],
          [5, 10],
          [10, 10],
        ],
        "h",
        2,
        10,
        10
      )
    ).toEqual([
      [0, 0],
      [10, 20],
      [20, 20],
    ]);
  });
  it("measurements read in feet and square feet at the page's scale", () => {
    expect(
      measureText(
        "length",
        [
          [0, 0],
          [30, 40],
        ],
        0.5
      )
    ).toBe("25'-0\"");
    expect(
      measureText(
        "length",
        [
          [0, 0],
          [30, 40],
        ],
        null
      )
    ).toBe("set the scale");
    expect(
      polyArea([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ])
    ).toBe(100);
    expect(
      measureText(
        "area",
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        2
      )
    ).toBe("400 sq ft");
    expect(
      measureText(
        "count",
        [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
        null
      )
    ).toBe("Count: 3");
  });
  it("clouds close around their box", () => {
    const a = cloudArcs(0, 0, 100, 50, 1000, 1000);
    expect(a[a.length - 1]).toMatchObject({ x: 0, y: 0 });
    expect(a.every(q => q.r > 0)).toBe(true);
  });
  it("the topmost markup under the pointer is picked", () => {
    const ms = [
      {
        id: 1,
        kind: "rect",
        points: [
          [0.1, 0.1],
          [0.5, 0.5],
        ] as [number, number][],
      },
      {
        id: 2,
        kind: "rect",
        points: [
          [0.2, 0.2],
          [0.3, 0.3],
        ] as [number, number][],
      },
    ];
    expect(markAt(ms, [250, 250], 1000, 1000, 2)?.id).toBe(2);
    expect(markAt(ms, [450, 450], 1000, 1000, 2)?.id).toBe(1);
    expect(markAt(ms, [900, 900], 1000, 1000, 2)).toBeNull();
    // text is hit on its words, not just its anchor point
    const t = [{ id: 3, kind: "text", note: "VERIFY IN FIELD", points: [[0.1, 0.5]] as [number, number][] }];
    expect(markAt(t, [150, 497], 1000, 1000, 1)?.id).toBe(3);
  });
  it("only the author or an editor changes a markup", () => {
    expect(mayChange({ createdBy: 4 }, 4, true, false)).toBe(true);
    expect(mayChange({ createdBy: 5 }, 4, true, false)).toBe(false);
    expect(mayChange({ createdBy: 5 }, 4, true, true)).toBe(true);
    expect(mayChange({ createdBy: 4 }, 4, false, true)).toBe(false);
  });
});
