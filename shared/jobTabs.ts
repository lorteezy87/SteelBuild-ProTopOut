/**
 * Job tab registry.
 *
 * Every module a job can show is declared once here. A job renders the defaults until
 * someone customizes it; after that its rows in `job_tabs` decide the order, the labels
 * and which tabs are tucked away. The registry stays the source of truth for what exists:
 * a stored row for a tab that no longer exists is ignored, and a tab added to the product
 * later shows up on customized jobs too.
 */

export type JobTabDef = {
  key: string;
  label: string;
  /** Shown only to users who can see the job's financials. */
  fin?: boolean;
  /** Always visible and always reachable; cannot be hidden. */
  locked?: boolean;
};

export const JOB_TAB_DEFS: readonly JobTabDef[] = [
  { key: "overview", label: "Overview", locked: true },
  { key: "schedule", label: "Schedule" },
  { key: "tasks", label: "Sequences & Tasks" },
  { key: "board", label: "Board" },
  { key: "deliveries", label: "Deliveries" },
  { key: "daily", label: "Daily Reports" },
  { key: "tickets", label: "T&M Tickets" },
  { key: "logs", label: "Logs" },
  { key: "drawings", label: "Drawings" },
  { key: "model", label: "Model" },
  { key: "lifts", label: "Cranes & Lifts" },
  { key: "qc", label: "QC" },
  { key: "safety", label: "Safety" },
  { key: "rentals", label: "Rentals" },
  { key: "photos", label: "Photos" },
  { key: "financials", label: "Financials", fin: true },
  { key: "documents", label: "Documents" },
  { key: "baselines", label: "Baselines" },
  { key: "activity", label: "Activity" },
] as const;

export const JOB_TAB_KEYS: readonly string[] = JOB_TAB_DEFS.map(t => t.key);
export const JOB_TAB_LABEL_MAX = 40;

const DEF_BY_KEY = new Map(JOB_TAB_DEFS.map(t => [t.key, t]));
export const isJobTabKey = (key: string): boolean => DEF_BY_KEY.has(key);

/** A stored customization row (subset of the job_tabs table). */
export type JobTabRow = { key: string; label: string | null; position: number; hidden: boolean };

export type ResolvedJobTab = {
  key: string;
  /** Label to show: the custom one when set, else the default. */
  label: string;
  defaultLabel: string;
  hidden: boolean;
  fin: boolean;
  locked: boolean;
};

/**
 * Merge a job's stored rows over the registry.
 * Order: stored rows by position, then any registry tab the job has no row for, in registry order.
 */
export function resolveJobTabs(rows: readonly JobTabRow[]): ResolvedJobTab[] {
  const seen = new Set<string>();
  const out: ResolvedJobTab[] = [];
  const push = (def: JobTabDef, row?: JobTabRow) => {
    seen.add(def.key);
    const custom = row?.label?.trim();
    out.push({
      key: def.key,
      label: custom || def.label,
      defaultLabel: def.label,
      hidden: def.locked ? false : !!row?.hidden,
      fin: !!def.fin,
      locked: !!def.locked,
    });
  };
  for (const row of [...rows].sort((a, b) => a.position - b.position)) {
    const def = DEF_BY_KEY.get(row.key);
    if (!def || seen.has(row.key)) continue;
    push(def, row);
  }
  for (const def of JOB_TAB_DEFS) if (!seen.has(def.key)) push(def);
  return out;
}

export type JobTabSaveItem = { key: string; label?: string | null; hidden?: boolean };

/**
 * Turn a client's ordered list into rows to store. Returns an error string when the
 * request is malformed, so the router can reject it with a clear message.
 */
export function normalizeJobTabSave(items: readonly JobTabSaveItem[]): { rows: JobTabRow[] } | { error: string } {
  const seen = new Set<string>();
  const rows: JobTabRow[] = [];
  for (const it of items) {
    const def = DEF_BY_KEY.get(it.key);
    if (!def) return { error: `Unknown tab: ${it.key}` };
    if (seen.has(it.key)) return { error: `Tab listed twice: ${it.key}` };
    seen.add(it.key);
    const label = (it.label ?? "").trim();
    if (label.length > JOB_TAB_LABEL_MAX) return { error: `Tab name is too long (max ${JOB_TAB_LABEL_MAX} characters): ${def.label}` };
    if (def.locked && it.hidden) return { error: `${def.label} cannot be hidden` };
    rows.push({
      key: def.key,
      // Storing the default label would freeze it; keep null so a future rename of the default flows through.
      label: label && label !== def.label ? label : null,
      position: rows.length,
      hidden: !!it.hidden,
    });
  }
  // Tabs the client left out keep their registry order after the listed ones.
  for (const def of JOB_TAB_DEFS) if (!seen.has(def.key)) rows.push({ key: def.key, label: null, position: rows.length, hidden: false });
  return { rows };
}

/** True when the stored rows describe exactly the defaults, so nothing needs storing. */
export function isDefaultJobTabs(rows: readonly JobTabRow[]): boolean {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  if (sorted.length !== JOB_TAB_DEFS.length) return false;
  return sorted.every((r, i) => r.key === JOB_TAB_DEFS[i].key && !r.label && !r.hidden);
}
