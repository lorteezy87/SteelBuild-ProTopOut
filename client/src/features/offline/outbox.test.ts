import { describe, expect, it } from "vitest";
import { classifyError, drain, enqueue, memoryStore, resolveConflict, type OutboxItem, type SendError } from "./outbox";

const daily = (clientKey: string, input: Record<string, unknown>, o: Partial<OutboxItem> = {}): Omit<OutboxItem, "status" | "error" | "attempts" | "createdAt"> & { createdAt?: number } => ({
  id: `daily:${clientKey}`,
  kind: "dailySave",
  clientKey,
  dependsOn: null,
  projectId: 1,
  label: "Daily report 2026-11-21",
  input,
  ...o,
});
const photo = (clientKey: string, dependsOn: string | null, createdAt: number) => ({
  id: `photo:${clientKey}`,
  kind: "photoUpload" as const,
  clientKey,
  dependsOn,
  projectId: 1,
  label: "IMG_1.jpg",
  input: { name: "IMG_1.jpg", entityType: "dailyReport" },
  createdAt,
});
const put = (s: ReturnType<typeof memoryStore>, i: OutboxItem) => s.update(i.id, () => i);
const err = (kind: SendError["kind"], message = kind): SendError => ({ kind, message });

describe("enqueue", () => {
  it("a second save of the same report replaces the first, keeping its order and base version", async () => {
    const s = memoryStore();
    await enqueue(s, { ...daily("k1", { workPerformed: "a", baseRev: "rev-a" }), createdAt: 1 });
    await enqueue(s, { ...daily("k1", { workPerformed: "b", baseRev: "rev-b" }), createdAt: 5 });
    const all = await s.all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ createdAt: 1, status: "pending", input: { workPerformed: "b", baseRev: "rev-a" } });
  });
  it("editing an item in conflict keeps it in conflict", async () => {
    const s = memoryStore();
    await enqueue(s, { ...daily("k1", { workPerformed: "a" }), createdAt: 1 });
    await put(s, { ...(await s.all())[0], status: "conflict", error: "changed" });
    await enqueue(s, { ...daily("k1", { workPerformed: "b" }), createdAt: 2 });
    expect((await s.all())[0]).toMatchObject({ status: "conflict", input: { workPerformed: "b" } });
  });
});

describe("drain", () => {
  it("sends in order, maps the new report's id and attaches its queued photo to it", async () => {
    const s = memoryStore();
    await enqueue(s, { ...daily("r1", { workPerformed: "x" }), createdAt: 1 });
    await enqueue(s, photo("p1", "r1", 2));
    const sent: [string, number | undefined][] = [];
    const res = await drain(s, async (item, parentId) => {
      sent.push([item.id, parentId]);
      return { id: item.kind === "dailySave" ? 77 : 900 };
    });
    expect(sent).toEqual([["daily:r1", undefined], ["photo:p1", 77]]);
    expect(res).toMatchObject({ sent: 2, stopped: false });
    expect(await s.all()).toEqual([]);
    expect(await s.getMap("r1")).toMatchObject({ id: 77 });
  });
  it("a photo waits while its report can't be sent", async () => {
    const s = memoryStore();
    await enqueue(s, { ...daily("r1", {}), createdAt: 1 });
    await put(s, { ...(await s.all())[0], status: "conflict" });
    await enqueue(s, photo("p1", "r1", 2));
    const calls: string[] = [];
    await drain(s, async item => {
      calls.push(item.id);
      return { id: 1 };
    });
    expect(calls).toEqual([]);
    expect((await s.all()).map(i => i.status).sort()).toEqual(["conflict", "pending"]);
  });
  it("a photo whose report was discarded fails with a reason instead of vanishing", async () => {
    const s = memoryStore();
    await enqueue(s, photo("p1", "gone", 2));
    await drain(s, async () => ({ id: 1 }));
    expect((await s.all())[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/discarded/) });
  });
  it("a network error stops the run and keeps everything pending", async () => {
    const s = memoryStore();
    await enqueue(s, { ...daily("a", {}), createdAt: 1 });
    await enqueue(s, { ...daily("b", {}), createdAt: 2 });
    let n = 0;
    const res = await drain(s, async () => {
      n++;
      throw err("network");
    });
    expect(n).toBe(1);
    expect(res.stopped).toBe(true);
    expect((await s.all()).map(i => [i.status, i.attempts])).toEqual([
      ["pending", 1],
      ["pending", 0],
    ]);
  });
  it("an expired session stops the run without marking anything failed", async () => {
    const s = memoryStore();
    await enqueue(s, { ...daily("a", {}), createdAt: 1 });
    const res = await drain(s, async () => {
      throw err("auth");
    });
    expect(res).toMatchObject({ stopped: true, needsSignIn: true });
    expect((await s.all())[0].status).toBe("pending");
  });
  it("a conflict or a refusal is kept for the PM to decide, and the rest still sync", async () => {
    const s = memoryStore();
    await enqueue(s, { ...daily("a", {}), createdAt: 1 });
    await enqueue(s, { ...daily("b", {}), createdAt: 2 });
    await enqueue(s, { ...daily("c", {}), createdAt: 3 });
    await drain(s, async item => {
      if (item.clientKey === "a") throw err("conflict", "Changed on another device");
      if (item.clientKey === "b") throw err("error", "Only draft reports can be edited");
      return { id: 3 };
    });
    expect((await s.all()).map(i => [i.clientKey, i.status, i.error])).toEqual([
      ["a", "conflict", "Changed on another device"],
      ["b", "failed", "Only draft reports can be edited"],
    ]);
  });
});

describe("a save made while the previous one is being sent", () => {
  it("is kept and sent next, as an edit of the report the first send created", async () => {
    const s = memoryStore();
    await enqueue(s, { ...daily("r1", { workPerformed: "first", saveRev: "s1", clientKey: "r1" }), createdAt: 1 });
    const sent: Record<string, unknown>[] = [];
    await drain(s, async item => {
      sent.push(item.input as Record<string, unknown>);
      if (sent.length === 1) await enqueue(s, { ...daily("r1", { workPerformed: "second", saveRev: "s2", clientKey: "r1" }), createdAt: 9 });
      return { id: 77 };
    });
    // the second edit was not lost: it is waiting (or already sent) as an edit of report 77 built on the first send
    const left = await s.all();
    const second = left[0]?.input ?? sent[1];
    expect(second).toMatchObject({ workPerformed: "second", id: 77, baseRev: "s1" });
    expect(second).not.toHaveProperty("clientKey");
  });
  it("a status change during sending never overwrites the newer input", async () => {
    const s = memoryStore();
    await enqueue(s, { ...daily("a", { workPerformed: "first", saveRev: "s1" }), createdAt: 1 });
    await drain(s, async () => {
      await enqueue(s, { ...daily("a", { workPerformed: "second", saveRev: "s2" }), createdAt: 2 });
      throw err("network");
    });
    expect((await s.all())[0]).toMatchObject({ status: "pending", input: { workPerformed: "second" } });
  });
});

describe("resolveConflict", () => {
  it("keep mine resends without the base version; discard removes only that item", async () => {
    const s = memoryStore();
    await enqueue(s, { ...daily("a", { baseRev: "rev-a" }), createdAt: 1 });
    await put(s, { ...(await s.all())[0], status: "conflict", error: "x" });
    await resolveConflict(s, "daily:a", "keep");
    const [i] = await s.all();
    expect(i).toMatchObject({ status: "pending", error: null });
    expect((i.input as Record<string, unknown>).baseRev).toBeUndefined();
    await enqueue(s, { ...daily("b", {}), createdAt: 2 });
    await resolveConflict(s, "daily:a", "discard");
    expect((await s.all()).map(x => x.clientKey)).toEqual(["b"]);
  });
});

describe("classifyError", () => {
  it("reads tRPC error codes; no code means the request never got an answer", () => {
    expect(classifyError({ data: { code: "CONFLICT" }, message: "Changed" })).toEqual({ kind: "conflict", message: "Changed" });
    expect(classifyError({ data: { code: "UNAUTHORIZED" }, message: "Please login (10001)" }).kind).toBe("auth");
    expect(classifyError({ data: { code: "BAD_REQUEST" }, message: "Only draft reports can be edited" }).kind).toBe("error");
    expect(classifyError({ message: "Failed to fetch" }).kind).toBe("network");
    expect(classifyError(new TypeError("Load failed")).kind).toBe("network");
  });
});
