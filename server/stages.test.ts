import { describe, expect, it } from "vitest";
import { stageColumns, stagePercent, stageWarnings, STAGE_KEYS, type StageQty } from "@shared/stages";
import { progressByTask } from "@shared/dailyPosting";
import { productionSeries } from "@shared/production";

const qty = (o: Partial<StageQty> = {}): StageQty => ({
  erectedTons: 0, plumbedTons: 0, boltedTons: 0, finalTons: 0,
  erectedPieces: 0, plumbedPieces: 0, boltedPieces: 0, finalPieces: 0, ...o,
});

describe("erection stages", () => {
  it("are set, plumbed, bolted, final in order", () => {
    expect(STAGE_KEYS).toEqual(["set", "plumbed", "bolted", "final"]);
  });
  it("set maps to the existing erected columns", () => {
    expect(stageColumns("set")).toEqual({ tons: "erectedTons", pieces: "erectedPieces" });
    expect(stageColumns("bolted").tons).toBe("boltedTons");
  });
  it("stage percent uses the chosen stage", () => {
    expect(stagePercent({ ...qty({ boltedTons: 40 }), plannedTons: 100, plannedPieces: 0 }, "bolted", "tonnage")).toBe(40);
    expect(stagePercent({ ...qty({ boltedTons: 40 }), plannedTons: 0, plannedPieces: 0 }, "bolted", "tonnage")).toBeNull();
    expect(stagePercent({ ...qty({ finalPieces: 5 }), plannedTons: 0, plannedPieces: 20 }, "final", "pieces")).toBe(25);
  });
  it("later stage above earlier stage warns", () => {
    expect(stageWarnings(qty({ erectedTons: 10, plumbedTons: 12 }))).toEqual(["Plumbed 12 t exceeds Set 10 t"]);
    expect(stageWarnings(qty({ erectedTons: 10, plumbedTons: 10 }))).toEqual([]);
  });
  it("progress groups by task and stage", () => {
    const m = progressByTask([
      { taskId: 5, stage: "set", tons: 3, pieces: 4 },
      { taskId: 5, tons: 1, pieces: 1 },
      { taskId: 5, stage: "bolted", tons: 2, pieces: 2 },
    ]);
    expect([...m.keys()].sort()).toEqual(["5:bolted", "5:set"]);
    expect(m.get("5:set")).toEqual({ taskId: 5, stage: "set", tons: 4, pieces: 5 });
    expect(m.get("5:bolted")).toEqual({ taskId: 5, stage: "bolted", tons: 2, pieces: 2 });
  });
  it("production by foreman per day", () => {
    const s = productionSeries(
      [
        { reportDate: "2026-11-02", foremanId: 7, tons: 5, pieces: 10 },
        { reportDate: "2026-11-02", foremanId: null, tons: 2, pieces: 3 },
        { reportDate: "2026-11-01", foremanId: 7, tons: 1, pieces: 1 },
      ],
      { tonsPerDay: 6, piecesPerDay: null },
    );
    expect(s.days.map(d => d.date)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(s.days[1]).toMatchObject({ tons: 7, pieces: 13 });
    expect(s.days[1].byForeman["7"].tons).toBe(5);
    expect(s.days[1].byForeman["none"].tons).toBe(2);
    expect(s.plan).toEqual({ tonsPerDay: 6, piecesPerDay: null });
  });
});

import { sequencePercent } from "@shared/stages";
import { plannedRateByDay } from "@shared/production";
describe("review fixes: stages and production plan", () => {
  it("a done sequence stays at 100 % whatever stage drives progress", () => {
    const t = { ...qty({ erectedTons: 100, boltedTons: 40 }), plannedTons: 100, plannedPieces: 0 };
    expect(sequencePercent({ ...t, status: "done" }, "bolted", "tonnage")).toBe(100);
    expect(sequencePercent({ ...t, status: "in_progress" }, "bolted", "tonnage")).toBe(40);
    expect(sequencePercent({ ...t, plannedTons: 0, status: "in_progress" }, "bolted", "tonnage")).toBeNull();
  });
  it("planned rate per day counts only sequences active that day", () => {
    const seqs = [
      { plannedTons: 100, plannedPieces: 0, durationDays: 5, startDate: "2026-11-02", finishDate: "2026-11-06" },
      { plannedTons: 100, plannedPieces: 0, durationDays: 5, startDate: "2026-11-09", finishDate: "2026-11-13" },
      { plannedTons: 50, plannedPieces: 0, durationDays: 5, startDate: null, finishDate: null },
    ];
    const r = plannedRateByDay(seqs, ["2026-11-03", "2026-11-09", "2026-11-20"]);
    expect(r).toEqual({ "2026-11-03": 20, "2026-11-09": 20, "2026-11-20": 0 });
  });
});
