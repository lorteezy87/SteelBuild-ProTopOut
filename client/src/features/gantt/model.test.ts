import { describe, expect, it } from "vitest";
import {
  ancestorIds,
  barGeometry,
  dependencyPath,
  durationThrough,
  finishFor,
  nextWorkDay,
  rulerSegments,
  taskTree,
  timelineRange,
  type GanttTask,
  type WorkCalendar,
} from "./model";

const calendar: WorkCalendar = {
  hoursPerDay: 8,
  workDays: [1, 2, 3, 4, 5],
  holidays: [{ date: "2026-11-11", name: "Veterans Day" }],
};
function task(
  id: number,
  parentId: number | null = null,
  sortOrder = id
): GanttTask {
  return {
    id,
    parentId,
    sortOrder,
    isSummary: false,
    startDate: "2026-11-02",
    finishDate: "2026-11-06",
    kind: "task",
  } as GanttTask;
}

describe("Gantt day and work-calendar geometry", () => {
  it("snaps weekend and holiday starts forward", () => {
    expect(nextWorkDay("2026-11-07", calendar)).toBe("2026-11-09");
    expect(nextWorkDay("2026-11-11", calendar)).toBe("2026-11-12");
  });
  it("keeps resize duration in working days", () => {
    expect(durationThrough("2026-11-06", "2026-11-12", calendar)).toBe(4);
    expect(finishFor("2026-11-06", 4, calendar)).toBe("2026-11-12");
    expect(durationThrough("2026-11-06", "2026-11-01", calendar)).toBe(1);
  });
  it("uses inclusive task finish pixels and centers milestone diamonds", () => {
    expect(barGeometry("2026-11-02", "2026-11-02", "2026-11-02", 36)).toEqual({
      x: 0,
      width: 36,
      startX: 0,
      finishX: 36,
    });
    expect(
      barGeometry("2026-11-02", "2026-11-02", "2026-11-02", 36, true)
    ).toEqual({ x: 11, width: 14, startX: 11, finishX: 25 });
  });
  it.each(["FS", "SS", "FF", "SF"])(
    "anchors %s on the correct bar sides",
    type => {
      const from = { x: 20, width: 80, startX: 20, finishX: 100 };
      const to = { x: 180, width: 80, startX: 180, finishX: 260 };
      const path = dependencyPath(type, from, 17, to, 55).path;
      expect(path.startsWith(`M ${type[0] === "F" ? 100 : 20} 17 `)).toBe(true);
      expect(path.endsWith(`H ${type[1] === "F" ? 260 : 180}`)).toBe(true);
      expect(path).not.toContain(" L ");
    }
  );
  it("includes active baseline and today in the timeline range", () => {
    const range = timelineRange(
      [task(1)],
      [{ taskId: 1, startDate: "2026-10-01", finishDate: "2026-10-15" }],
      "2026-11-05"
    );
    expect(range.first <= "2026-10-01").toBe(true);
    expect(range.last > "2026-11-06").toBe(true);
  });
  it("generates only viewport-near ruler segments", () => {
    expect(
      rulerSegments("2026-01-01", 2000, "day", 800, 840).length
    ).toBeLessThan(100);
    const months = rulerSegments("2026-01-01", 800, "month", 300, 400);
    expect(months.length).toBeLessThan(10);
    expect(months.every(m => m.length > 0)).toBe(true);
  });
});

describe("Gantt WBS tree", () => {
  it("orders siblings and keeps children under their parent", () => {
    const tasks = [task(3, 1), task(2, null, 20), task(1, null, 10)];
    expect(
      taskTree(tasks, new Set()).map(r => [r.task.id, r.depth, r.summary])
    ).toEqual([
      [1, 0, true],
      [3, 1, false],
      [2, 0, false],
    ]);
  });
  it("collapses descendants and expands a deep-linked path", () => {
    const tasks = [task(1), task(2, 1), task(3, 2)];
    expect(taskTree(tasks, new Set([1])).map(r => r.task.id)).toEqual([1]);
    expect(ancestorIds(tasks, 3)).toEqual([2, 1]);
  });
});
