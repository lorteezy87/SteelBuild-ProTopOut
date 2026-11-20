// Sheet viewer rules: callout links, detail location, printed scales and field dimensions.
// Ported from SteelBuild test/viewer.test.js.
import { describe, expect, it } from "vitest";
import { feet, find, locate, parseFeet, scales, searchLines, lines, sheetLinks, textBoxes, type Box, type SheetIndex } from "./callouts";

// A text item as the viewer makes it: x, y top-left, w by characters, h = font size
const B = (s: string, x: number, y: number, h = 14): Box => ({ s, x, y, w: s.length * h * 0.55, h, rot: false });
// a detail bubble: id centred over the sheet number
const bubble = (det: string, sh: string, cx: number, cy: number) => [B(det, cx - det.length * 5.5, cy - 24, 20), B(sh, cx - sh.length * 3.9, cy + 6, 14)];
const index: SheetIndex<string> = new Map(
  ["S-101", "S-201", "S-301", "S-501", "1001"].map(s => [s.toLowerCase().replace(/[\s-]+/g, ""), { sid: "id-" + s, sheet: s }])
);

describe("callouts", () => {
  it("bubbles, written callouts and sheet references link to sheets in the register", () => {
    const boxes = [
      ...bubble("5", "S-501", 1100, 470),
      ...bubble("3", "S-301", 1820, 790),
      B("SEE DETAIL 2/S-501 FOR ANCHOR BOLT PROJECTION", 900, 1166, 16),
      B("REFER TO S-201 FOR FRAMING ABOVE", 900, 1201, 16),
      B("2. SEE S-201 AND S-301.", 2240, 370, 12),
      B("S-101", 2192, 1570, 48),
    ];
    const L = find(boxes, index, "S-101");
    const got = L.map(l => [l.kind, l.detail, l.sheet]);
    expect(got.filter(g => g[0] === "bubble")).toEqual([
      ["bubble", "5", "S-501"],
      ["bubble", "3", "S-301"],
    ]);
    expect(got.some(g => g[0] === "callout" && g[1] === "2" && g[2] === "S-501")).toBe(true); // DETAIL 2/S-501
    expect(got.some(g => g[1] === "" && g[2] === "S-201")).toBe(true); // REFER TO S-201
    expect(got.some(g => g[2] === "S-301" && g[1] === "")).toBe(true); // a sheet number in a note
    expect(L.some(l => l.sheet === "S-101")).toBe(false); // the sheet's own title block number is not a link
    const c = L.find(l => l.detail === "2")!;
    // the link covers the callout text, not the whole note
    expect(c.x > 900 && c.x < 1000 && c.w > 40 && c.w < 160).toBe(true);
    expect(c.text).toBe("DETAIL 2/S-501");
    expect(L.filter(l => l.detail === "5").length).toBe(1); // one link per callout
  });

  it("no links to sheets outside the register, and dimensions are not sheet numbers", () => {
    const boxes = [
      B("SEE 4/S-999", 100, 100),
      B('1/2" PL', 100, 140),
      B("3/4", 100, 180),
      B("W14X90 @ 1001", 100, 220),
      ...bubble("7", "A-501", 400, 400),
      B("12/1001", 100, 260),
    ];
    const L = find(boxes, index, "S-101");
    expect(L.map(l => l.text)).toEqual(["12/1001"]); // only the explicit callout to shop sheet 1001
  });

  it("text split across items on one line still links", () => {
    const boxes = [B("SEE DETAIL ", 100, 100), B("5", 100 + 11 * 7.7, 100), B("/", 100 + 12 * 7.7, 100), B("S-501", 100 + 13 * 7.7, 100)];
    const L = find(boxes, index, "S-101");
    expect(L.length).toBe(1);
    expect(L[0].detail).toBe("5");
    expect(L[0].sheet).toBe("S-501");
  });

  it("rotated text is not read for links", () => {
    expect(find([{ ...B("SEE S-201", 100, 100), rot: true }], index, "S-101")).toEqual([]);
  });

  it("a detail's own title bubble is not a link to itself", () => {
    const boxes = [...bubble("5", "S-501", 2000, 500), B("TYPICAL BASE PLATE DETAIL", 2060, 485, 22), B("SEE 2/S-201", 100, 100)];
    const all = find(boxes, index, "S-501");
    expect(all.some(l => l.same && l.detail === "5")).toBe(true);
    const L = sheetLinks(boxes, index, "S-501");
    expect(L.map(l => l.sheet)).toEqual(["S-201"]);
  });
});

describe("detail location", () => {
  it("finds the titled bubble on the target sheet, not callouts to other sheets", () => {
    const boxes = [
      ...bubble("2", "S-501", 400, 1200),
      B("ANCHOR BOLT PROJECTION", 460, 1185, 22),
      ...bubble("5", "S-501", 2000, 500),
      B("TYPICAL BASE PLATE DETAIL", 2060, 485, 22),
      ...bubble("5", "S-301", 900, 900),
      B("5", 50, 50, 10),
    ];
    const at = locate(boxes, "5", "S-501");
    expect(at && at.sure).toBe(true);
    expect(Math.abs(at!.x + at!.w / 2 - 2000) < 30 && Math.abs(at!.y + at!.h / 2 - 486) < 40).toBe(true);
    expect(locate(boxes, "9", "S-501")).toBeNull(); // an absent detail is not guessed
    expect(locate([B("5", 50, 50, 10)], "5", "S-501")).toBeNull(); // a stray 5 is not a detail title
  });
});

describe("printed scales and field dimensions", () => {
  it("reads printed scales as feet per page unit", () => {
    const sc = scales([B('SCALE: 1/8" = 1\'-0"', 0, 0), B('SCALE: 1 1/2" = 1\'-0"', 0, 40), B("1\" = 10'", 0, 80), B('SCALE: 1/8" = 1\'-0"', 0, 120)]);
    expect(sc.map(s => [s.label, +(s.fpu * 72).toFixed(4)])).toEqual([
      ['1/8" = 1\'-0"', 8],
      ['1 1/2" = 1\'-0"', 0.6667],
      ["1\" = 10'", 10],
    ]);
  });
  it("writes feet as field dimensions", () => {
    expect(feet(12.5)).toBe("12'-6\"");
    expect(feet(20 + 1 / 24)).toBe("20'-0 1/2\"");
    expect(feet(0.99999)).toBe("1'-0\"");
    expect(feet(3 + 5 / 192)).toBe("3'-0 5/16\"");
    expect(feet(-2.25)).toBe("-2'-3\"");
    expect(feet(Infinity)).toBe("—");
  });
  it("parses typed lengths", () => {
    expect(parseFeet("20'")).toBe(20);
    expect(parseFeet("12'-6\"")).toBe(12.5);
    expect(parseFeet("12' 6 1/2\"")).toBe(12 + 6.5 / 12);
    expect(parseFeet('6"')).toBe(0.5);
    expect(parseFeet("12.5")).toBe(12.5);
    expect(Number.isNaN(parseFeet("abc"))).toBe(true);
    expect(Number.isNaN(parseFeet(""))).toBe(true);
  });
});

describe("text", () => {
  it("search finds every occurrence across joined items", () => {
    const ls = lines([B("ANCHOR ", 100, 100), B("BOLT", 100 + 7 * 7.7, 100), B("anchor bolt", 100, 200)]);
    const hits = searchLines(ls, "anchor bolt");
    expect(hits.length).toBe(2);
    expect(hits[0].area.x).toBeCloseTo(100, 0);
  });
  it("pdf.js items become page boxes (y down) and rotated items are marked", () => {
    // a viewport for a 792-high page at scale 1: flip y
    const vp = { transform: [1, 0, 0, -1, 0, 792], scale: 1 };
    const [a, b] = textBoxes(
      [
        { str: "S-201", transform: [10, 0, 0, 10, 100, 700], width: 30 },
        { str: "UP", transform: [0, 10, -10, 0, 50, 50], width: 12 },
        { str: "  ", transform: [10, 0, 0, 10, 0, 0], width: 5 },
      ],
      vp
    );
    expect(a).toMatchObject({ s: "S-201", x: 100, w: 30, h: 10, rot: false });
    expect(a.y).toBeCloseTo(82, 5);
    expect(b.rot).toBe(true);
  });
});
