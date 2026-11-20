// The framing reader and the line-work extraction it reads from (ported from SteelBuild test/model-v55.test.js).
// Synthetic drawings only.
import { describe, expect, it } from "vitest";
import { PDFGEO } from "../drawings/pdf";
import { fromFrame, H, HIDDEN, seg, sheet, txt, W, FT } from "./fixtures";
import { READER_VERSION, read } from "./reader";

describe("reader", () => {
  it("scale from the dimensions, grids by their bubbles, beams and joists with lengths and ends", () => {
    const g = sheet(),
      out = read({ w: W, h: H, ...g }, 1);
    expect(out.v).toBe(4);
    expect(READER_VERSION).toBe(4);
    expect(out.scale.ptPerFt).toBe(9); // three dimension strings agree on 9 units a foot: 1/8" = 1'-0"
    expect(out.grids.map(x => x.name).sort()).toEqual(["A_01", "A_02", "A_A", "A_B"]);
    const beams = out.members.filter(m => m.kind === "beam"),
      joists = out.members.filter(m => m.kind === "joist");
    expect(beams.map(b => b.label).sort()).toEqual(["W21X44", "W24X55"]);
    const b = beams.find(x => x.label === "W24X55")!;
    expect(b.lenFt).toBe(30); // 270 units at 9 a foot
    expect(b.liftLb).toBe(1650); // 55 lb/ft × 30 ft
    expect(b.ends[0]).toContain("A_01");
    expect(b.ends[1]).toContain("A_02");
    expect(joists.length).toBe(3);
    joists.forEach(j => {
      expect(j.label).toBe("T12");
      expect(j.lenFt).toBe(40); // trimmed at the beams: 360 units, not the 380 drawn
    });
    expect(joists[0].ends.flat().some(e => /W24X55|W21X44/.test(e))).toBe(true);
  });

  it("a stacked piece mark and size at an angle, a column callout, a leader callout and a joist by others", () => {
    const g = sheet();
    // a beam at −84° with "B1201" over "W18X40"; its line just below the size
    const size = txt("W18X40", 1300, 1200, 10, -84),
      mark = { ...txt("B1201", 0, 0, 10, -84) };
    const [mx, my] = fromFrame(size, 0, -12);
    mark.x = mx;
    mark.y = my;
    const [ax, ay] = fromFrame(size, -120, 4),
      [bx, by] = fromFrame(size, 240, 4);
    g.text.push(size, mark);
    g.segs.push(seg(ax, ay, bx, by, 1.2));
    // a column callout: C1101 over HSS6X6X — a column, not the beam beside it
    g.text.push(txt("HSS6X6X", 900, 1000, 10), txt("C1101", 900, 988, 10));
    g.segs.push(seg(850, 1004, 1050, 1004, 1.2));
    // "W16X26" with a leader from its end to the middle of a vertical beam
    const lab = txt("W16X26", 1500, 1500, 10),
      ex = 1500 + lab.w + 2,
      ey = 1500 - 5;
    g.text.push(lab);
    g.segs.push(seg(ex, ey, 1640, 1600, 0.4), seg(1640, 1450, 1640, 1810, 1.7));
    // "26K" beside an evenly dashed line: a joist by others, shown for reference
    g.text.push(txt("26K", 2100, 1100, 10));
    g.segs.push(seg(2000, 1103, 2400, 1103, 0.5, 1, HIDDEN));
    const out = read({ w: W, h: H, ...g }, 1);
    const st = out.members.find(m => m.mark === "B1201")!;
    expect(st).toBeTruthy();
    expect(st.label).toBe("W18X40");
    expect(st.dir).toBe("A-84.0");
    expect(Math.abs(st.lenFt! - 40)).toBeLessThan(0.01);
    expect(out.columns.map(c => c.mark)).toEqual(["C1101"]);
    expect(out.members.some(m => m.label === "HSS6X6X")).toBe(false);
    const ld = out.members.find(m => m.label === "W16X26")!;
    expect(ld && ld.via === "leader" && ld.dir === "V" && ld.lenFt === 40).toBe(true);
    expect(out.unplaced.some(u => u.label === "26K" && /by others/.test(u.note || ""))).toBe(true);
    expect(out.members.some(m => m.label === "26K")).toBe(false);
  });

  it("the same marks drawn again at other lengths far across the sheet are a detail, set aside", () => {
    const g = sheet();
    // the plan: B1300 W12X26 20 ft and B1301 W12X26 25 ft; a detail 1,800 units away draws both again at other lengths
    const put = (mark: string, x: number, y: number, ft: number) => {
      g.text.push(txt(mark, x, y - 12, 10), txt("W12X26", x, y, 10));
      g.segs.push(seg(x - 20, y + 3, x - 20 + ft * FT, y + 3, 1.2));
    };
    put("B1300", 900, 600, 20);
    put("B1301", 900, 700, 25);
    put("B1300", 2600, 1700, 32);
    put("B1301", 2600, 1800, 36);
    const out = read({ w: W, h: H, ...g }, 1);
    const kept = out.members.filter(m => /^B130/.test(m.mark || ""));
    expect(kept.map(m => m.mark + " " + m.lenFt).sort()).toEqual(["B1300 20", "B1301 25"]);
    expect(out.otherViews.map(o => o.mark).sort()).toEqual(["B1300", "B1301"]);
  });

  it("a bare page, a scan (no text) and a free-text markup are read without inventing pieces", () => {
    expect(read({ w: W, h: H, text: [], segs: [] }, 1).members.length).toBe(0);
    const g = sheet();
    g.text.push(txt("W24x76 - ____ lbs", 1200, 300, 17));
    g.segs.push(seg(1150, 304, 1600, 304, 1.7));
    // a size followed by free text is someone's note, not a label
    expect(read({ w: W, h: H, ...g }, 1).members.some(m => m.label === "W24X76")).toBe(false);
  });

  it("a page without dimension strings has no scale: no lengths, and nothing breaks", () => {
    const g = sheet();
    const out = read({ w: W, h: H, text: g.text.filter(t => !/'-/.test(t.s)), segs: g.segs }, 2);
    expect(out.page).toBe(2);
    expect(out.scale.ptPerFt).toBe(null);
    expect(out.members.length).toBeGreaterThan(0);
    expect(out.members.every(m => m.lenFt == null && m.len == null)).toBe(true);
  });
});

// ---------- line work from pdf.js operator lists (PDFGEO lives in features/drawings/pdf.ts; the reader reads its output) ----------
const OPS = {
  setLineWidth: 2,
  setDash: 6,
  setGState: 9,
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  beginAnnotation: 80,
  endAnnotation: 81,
  constructPath: 91,
};
const VT = [1, 0, 0, -1, 0, 1000]; // the viewport at scale 1 of a page 1000 high: y flips
describe("line work", () => {
  it("pdf.js 4 paths, rectangles, transforms, dashes, the current point across paths; annotations left out", () => {
    const fn: number[] = [],
      args: unknown[] = [],
      op = (f: number, a: unknown) => {
        fn.push(f);
        args.push(a);
      };
    op(OPS.setLineWidth, [2]);
    op(OPS.constructPath, [[OPS.moveTo, OPS.lineTo, OPS.curveTo, OPS.lineTo], [0, 0, 100, 0, 1, 1, 2, 2, 150, 50, 150, 100], null]);
    op(OPS.constructPath, [[OPS.lineTo], [200, 100], null]); // carries on from (150, 100)
    op(OPS.constructPath, [[OPS.closePath], [], null]); // back to where the path started, (0, 0)
    op(OPS.save, null);
    op(OPS.transform, [2, 0, 0, 2, 10, 10]);
    op(OPS.setDash, [[8, 3, 2, 3], 0]);
    op(OPS.constructPath, [[OPS.rectangle], [0, 0, 5, 10], null]);
    op(OPS.restore, null);
    op(OPS.beginAnnotation, ["a1"]);
    op(OPS.constructPath, [[OPS.moveTo, OPS.lineTo], [0, 0, 999, 999], null]);
    op(OPS.endAnnotation, null);
    const S = PDFGEO.lines(fn, args, OPS, VT);
    expect(S.slice(0, 4)).toEqual([
      [0, 1000, 100, 1000, 2, 0, ""],
      [150, 950, 150, 900, 2, 0, ""],
      [150, 900, 200, 900, 2, 0, ""],
      [200, 900, 0, 1000, 2, 0, ""],
    ]);
    expect(S.length).toBe(8); // the rectangle is its four sides; the annotation's line is not drawing
    expect(S[4]).toEqual([10, 990, 20, 990, 4, 1, "16,6,4,6"]); // a transform scales the line, its width and its dash pattern
    expect(S.some(g => g[2] === 999 || g[3] === 1)).toBe(false);
  });
  it("the pdf.js 5 packed path format reads the same, and text items come out in page units", () => {
    const S = PDFGEO.lines([91], [[0, [new Float32Array([0, 10, 20, 1, 110, 20, 4])], null]], OPS, VT);
    expect(S).toEqual([
      [10, 980, 110, 980, 1, 0, ""],
      [110, 980, 10, 980, 1, 0, ""],
    ]);
    const T = PDFGEO.text(
      [
        { str: "W24X55", transform: [9, 0, 0, 9, 100, 600], width: 34.5 },
        { str: "  ", transform: [9, 0, 0, 9, 0, 0], width: 1 },
        { str: "T12", transform: [0, 10, -10, 0, 300, 500], width: 18 },
      ],
      VT
    );
    expect(T).toEqual([
      { s: "W24X55", x: 100, y: 400, h: 9, rot: 0, w: 34.5 },
      { s: "T12", x: 300, y: 500, h: 10, rot: -90, w: 18 },
    ]);
  });
});
