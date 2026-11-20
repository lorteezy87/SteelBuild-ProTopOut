import { describe, expect, it } from "vitest";
import { lookahead, weekStartOf, weeklyTons } from "@shared/lookahead";

const t = (o: object) => ({ id: 1, name: "T", kind: "task", isSummary: false, startDate: null as string | null, finishDate: null as string | null, status: "not_started", percentComplete: 0, ...o });

describe("weeks", () => {
  it("week starts on Monday", () => {
    expect(weekStartOf("2026-11-20")).toBe("2026-11-16");
    expect(weekStartOf("2026-11-16")).toBe("2026-11-16");
    expect(weekStartOf("2026-11-22")).toBe("2026-11-16");
    expect(weekStartOf("2026-11-23")).toBe("2026-11-23");
  });
});

describe("3-week look-ahead", () => {
  it("look-ahead keeps overlapping dated tasks", () => {
    const r = lookahead(
      [
        t({ id: 1, startDate: "2026-11-20", finishDate: "2026-11-24" }),
        t({ id: 2, startDate: "2026-12-14", finishDate: "2026-12-15" }),
        t({ id: 3, isSummary: true, startDate: "2026-11-23", finishDate: "2026-11-30" }),
        t({ id: 4, startDate: "2026-11-25", finishDate: null }),
        t({ id: 5, kind: "sequence", startDate: "2026-12-10", finishDate: "2026-12-20" }),
      ],
      "2026-11-23",
    );
    expect(r.weeks).toEqual([
      { start: "2026-11-23", end: "2026-11-29" },
      { start: "2026-11-30", end: "2026-12-06" },
      { start: "2026-12-07", end: "2026-12-13" },
    ]);
    expect(r.rows.map(x => x.id)).toEqual([1, 5]);
    expect(r.rows[0].days.slice(0, 3)).toEqual([true, true, false]);
    expect(r.rows[0].days).toHaveLength(21);
    expect(r.rows[1].days.filter(Boolean)).toHaveLength(4);
    expect(r.undated).toBe(1);
  });
});

describe("weekly tons", () => {
  const seqs = [{ id: 7, name: "Seq 1", plannedTons: 100, erectedTons: 40 }];
  it("week without final reports is unknown, not zero", () => {
    const r = weeklyTons(seqs, [], "2026-11-16", 0);
    expect(r.finalReportsThisWeek).toBe(0);
    expect(r.rows[0]).toMatchObject({ toDate: 40, thisWeek: null, pct: 40 });
  });
  it("this week counts only set-stage tons inside the week", () => {
    const r = weeklyTons(
      seqs,
      [
        { taskId: 7, stage: "set", reportDate: "2026-11-17", tons: 5 },
        { taskId: 7, stage: "set", reportDate: "2026-11-13", tons: 4 },
        { taskId: 7, stage: "bolted", reportDate: "2026-11-17", tons: 3 },
      ],
      "2026-11-16",
      2,
    );
    expect(r.rows[0].thisWeek).toBe(5);
  });
  it("no planned tons means percent unknown", () => {
    expect(weeklyTons([{ id: 1, name: "S", plannedTons: 0, erectedTons: 3 }], [], "2026-11-16", 1).rows[0].pct).toBeNull();
  });
});
