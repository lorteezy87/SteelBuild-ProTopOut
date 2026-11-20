/** Safety: JHA/AHA, pre-task plans and toolbox talks. Pure rules; the router stores. */

export type JhaStep = { step: string; hazards: string; controls: string };
export type Attendee = { userId: number | null; name: string };

export const JHA_STATUSES = { draft: "Draft", active: "Active", archived: "Archived" } as const;
export type JhaStatus = keyof typeof JHA_STATUSES;

export const PPE_ITEMS = {
  hard_hat: "Hard hat",
  safety_glasses: "Safety glasses",
  hi_vis: "Hi-vis vest",
  gloves: "Gloves",
  boots: "Safety-toe boots",
  harness: "Harness",
  srl: "SRL / lanyard",
  face_shield: "Face shield / welding hood",
  hearing: "Hearing protection",
  respirator: "Respirator",
} as const;
export const PPE_KEYS = Object.keys(PPE_ITEMS) as (keyof typeof PPE_ITEMS)[];

const blank = (s: string | null | undefined) => !s || !s.trim();

/** What stops a JHA from going active. Empty means it is complete. */
export function jhaProblems(j: { title: string; steps: JhaStep[]; competentPerson: string | null }): string[] {
  const out: string[] = [];
  if (blank(j.title)) out.push("Enter the activity");
  if (!j.steps.length) out.push("Add at least one step");
  j.steps.forEach((s, i) => {
    if (blank(s.hazards) || blank(s.controls)) out.push(`Step ${i + 1} needs hazards and controls`);
  });
  if (blank(j.competentPerson)) out.push("Name the competent person");
  return out;
}

/** Trim names, drop blanks, and keep each person once (by crew id, else by name). */
export function normalizeAttendees(list: Attendee[]): Attendee[] {
  const seen = new Set<string>();
  const out: Attendee[] = [];
  for (const a of list) {
    const name = a.name.trim();
    if (!name) continue;
    const key = a.userId != null ? `u:${a.userId}` : `n:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ userId: a.userId, name });
  }
  return out;
}

/** Preset fields an existing install doesn't have yet. Never touches the ones it has. */
export function missingFields<T extends { key: string }>(existingKeys: string[], preset: T[]): T[] {
  const have = new Set(existingKeys);
  return preset.filter(f => !have.has(f.key));
}
