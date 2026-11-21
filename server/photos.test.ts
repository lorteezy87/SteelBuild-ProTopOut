import { describe, expect, it } from "vitest";
import { groupByDay, isPhoto, photoDay, photosForRecord } from "@shared/photos";

describe("photo log", () => {
  it("recognizes photos by type or extension", () => {
    expect(isPhoto("image/jpeg", "x")).toBe(true);
    expect(isPhoto(null, "IMG_1.HEIC")).toBe(true);
    expect(isPhoto("application/octet-stream", "site.webp")).toBe(true);
    expect(isPhoto("application/pdf", "a.pdf")).toBe(false);
  });
  it("a photo with no taken date uses the upload day, marked estimated", () => {
    expect(photoDay({ takenOn: null, uploadedDay: "2026-11-19" })).toEqual({ day: "2026-11-19", estimated: true });
    expect(photoDay({ takenOn: "2026-11-17", uploadedDay: "2026-11-19" })).toEqual({ day: "2026-11-17", estimated: false });
  });
  it("groups photos by day, newest first", () => {
    const g = groupByDay([
      { id: 1, takenOn: "2026-11-17", uploadedDay: "2026-11-19" },
      { id: 2, takenOn: null, uploadedDay: "2026-11-19" },
      { id: 3, takenOn: "2026-11-17", uploadedDay: "2026-11-18" },
    ]);
    expect(g.map(x => [x.day, x.photos.map(p => p.id)])).toEqual([
      ["2026-11-19", [2]],
      ["2026-11-17", [1, 3]],
    ]);
    expect(g[0].photos[0].estimated).toBe(true);
  });
  it("record photos are owned plus linked, no duplicates", () => {
    expect(photosForRecord([1, 2], [2, 3])).toEqual([1, 2, 3]);
  });
});
