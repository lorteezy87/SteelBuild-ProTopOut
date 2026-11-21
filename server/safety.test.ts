import { describe, expect, it } from "vitest";
import { jhaProblems, missingFields, normalizeAttendees } from "@shared/safety";
import { APP_PRESETS } from "./bootstrap/presets";

describe("JHA / AHA", () => {
  it("a JHA needs an activity, steps with hazards and controls, and a competent person", () => {
    expect(jhaProblems({ title: " ", steps: [], competentPerson: null })).toEqual([
      "Enter the activity",
      "Add at least one step",
      "Name the competent person",
    ]);
    const steps = [
      { step: "Rig beam", hazards: "Pinch points", controls: "Tag lines" },
      { step: "Land beam", hazards: "Fall", controls: " " },
    ];
    expect(jhaProblems({ title: "Set joists", steps, competentPerson: "J. Ruiz" })).toEqual(["Step 2 needs hazards and controls"]);
    expect(jhaProblems({ title: "Set joists", steps: [steps[0]], competentPerson: "J. Ruiz" })).toEqual([]);
  });
});

describe("attendees", () => {
  it("attendees are trimmed and de-duplicated", () => {
    expect(
      normalizeAttendees([
        { userId: 3, name: "A" },
        { userId: 3, name: "A again" },
        { userId: null, name: " Joe " },
        { userId: null, name: "joe" },
        { userId: null, name: "  " },
      ])
    ).toEqual([
      { userId: 3, name: "A" },
      { userId: null, name: "Joe" },
    ]);
  });
});

describe("incident fields on existing installs", () => {
  it("ensureAppFields adds only missing fields", () => {
    const safety = APP_PRESETS.find(p => p.key === "safety")!;
    expect(missingFields(["observation_type", "location"], safety.fields).map(f => f.key)).toEqual([
      "corrective_action",
      "injured_person",
      "treatment",
      "osha_recordable",
      "days_away",
      "reported_to_gc_on",
    ]);
    expect(missingFields(safety.fields.map(f => f.key), safety.fields)).toEqual([]);
  });
});
