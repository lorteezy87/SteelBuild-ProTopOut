/** Time entries and expenses: saved (editable) → recorded (locked, counts as cost) → invoiced (billed to the GC/owner). */
export const ENTRY_STATES = { saved: "Saved", recorded: "Recorded", invoiced: "Invoiced" } as const;
export type EntryState = keyof typeof ENTRY_STATES;
export const EDITABLE_STATES: EntryState[] = ["saved"];
export const COSTED_STATES: EntryState[] = ["recorded", "invoiced"];
