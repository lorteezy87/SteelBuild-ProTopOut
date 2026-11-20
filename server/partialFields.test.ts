import { describe, expect, it } from "vitest";
import { z } from "zod";
import { partialFields } from "./routers/_util";

describe("partial update inputs", () => {
  it("an update that leaves a defaulted field out doesn't reset it", () => {
    const fields = { steps: z.array(z.string()).default([]), status: z.enum(["draft", "active"]).default("draft"), title: z.string() };
    const update = z.object({ id: z.number(), ...partialFields(fields) });
    expect(update.parse({ id: 1, title: "x" })).toEqual({ id: 1, title: "x" });
    expect(update.parse({ id: 1, steps: ["a"] })).toEqual({ id: 1, steps: ["a"] });
  });
});
