import { describe, expect, it } from "vitest";
import { JOB_SLUG_MAX, PUBLIC_ID_ALPHABET, PUBLIC_ID_LENGTH, isPublicId, jobPath, legacyJobId, newPublicId, slugify } from "@shared/jobUrl";

describe("public ids", () => {
  it("are 8 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const id = newPublicId();
      expect(id).toHaveLength(PUBLIC_ID_LENGTH);
      expect(isPublicId(id)).toBe(true);
    }
  });
  it("the alphabet has no vowels and no look-alike characters", () => {
    expect(PUBLIC_ID_ALPHABET).not.toMatch(/[aeiou01l]/);
    expect(new Set(PUBLIC_ID_ALPHABET).size).toBe(PUBLIC_ID_ALPHABET.length);
  });
  it("do not repeat across a realistic number of jobs", () => {
    const ids = new Set(Array.from({ length: 5000 }, newPublicId));
    expect(ids.size).toBe(5000);
  });
  it("isPublicId rejects numeric ids, wrong lengths and foreign characters", () => {
    for (const s of ["42", "", "k7mq2xb", "k7mq2xbdd", "K7MQ2XBD", "k7mq2xba", "k7mq-xbd", null, undefined]) expect(isPublicId(s)).toBe(false);
  });
});

describe("slugify", () => {
  it("makes a readable lowercase slug", () => {
    expect(slugify("The Catalina — Phase 2 (UofA)")).toBe("the-catalina-phase-2-uofa");
    expect(slugify("  Madison Rose Ln.  ")).toBe("madison-rose-ln");
    expect(slugify("Shade & Canopy #26-007")).toBe("shade-and-canopy-26-007");
  });
  it("strips accents instead of dropping the letter", () => {
    expect(slugify("Café Señorita")).toBe("cafe-senorita");
  });
  it("never returns an empty slug", () => {
    for (const s of ["", "   ", "###", null, undefined, "日本語"]) expect(slugify(s)).toBe("job");
  });
  it("caps the length without leaving a trailing dash", () => {
    const s = slugify("word ".repeat(40));
    expect(s.length).toBeLessThanOrEqual(JOB_SLUG_MAX);
    expect(s).not.toMatch(/-$/);
  });
});

describe("jobPath", () => {
  const job = { publicId: "k7mq2xbd", name: "The Catalina" };
  it("job root and overview are the same URL", () => {
    expect(jobPath(job)).toBe("/j/k7mq2xbd/the-catalina");
    expect(jobPath(job, "overview")).toBe("/j/k7mq2xbd/the-catalina");
  });
  it("appends the tab and sub-segments", () => {
    expect(jobPath(job, "deliveries")).toBe("/j/k7mq2xbd/the-catalina/deliveries");
    expect(jobPath(job, "daily", 31)).toBe("/j/k7mq2xbd/the-catalina/daily/31");
    expect(jobPath(job, "logs", "rfi", 12)).toBe("/j/k7mq2xbd/the-catalina/logs/rfi/12");
  });
  it("drops a second sub-segment that has no first", () => {
    expect(jobPath(job, "logs", null, 12)).toBe("/j/k7mq2xbd/the-catalina/logs");
  });
  it("encodes sub-segments", () => {
    expect(jobPath(job, "logs", "a b")).toBe("/j/k7mq2xbd/the-catalina/logs/a%20b");
  });
  it("a job with no usable name still gets a valid path", () => {
    expect(jobPath({ publicId: "k7mq2xbd", name: null }, "qc")).toBe("/j/k7mq2xbd/job/qc");
  });
});

describe("legacyJobId", () => {
  it("reads a positive integer segment", () => {
    expect(legacyJobId("42")).toBe(42);
  });
  it("rejects everything else", () => {
    for (const s of ["0", "-1", "042", "4.2", "abc", "42abc", "", null, undefined, "99999999999999999999"]) expect(legacyJobId(s)).toBeNull();
  });
});
