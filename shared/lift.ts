/**
 * Crane & lift planning rules. Capacity comes from the PM's load chart for the setup (radius → capacity rows);
 * the check never interpolates or extrapolates: it reads the next longer radius, and a radius off the chart is blocked.
 */

export type ChartRow = { radiusFt: number; capacityLb: number };
export const LIFT_CRITICAL_PCT = 75;
export const LIFT_BLOCKED_PCT = 100;
export const LIFT_STATUS_LABELS = { ok: "OK", critical: "Critical lift", blocked: "Blocked", unknown: "Unknown" } as const;
export type LiftStatus = keyof typeof LIFT_STATUS_LABELS;

const NUM = /^\d+(?:\.\d+)?$/;

/** "radius capacity" per line (space, comma or tab); capacity may end in k (×1000); # comments and blank lines skipped. */
export function parseChart(text: string): { rows: ChartRow[]; errors: string[] } {
  const rows: (ChartRow & { line: number })[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const t = raw.replace(/#.*/, "").trim();
    if (!t) return;
    const parts = t.split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 2) return void errors.push(`line ${line}: expected "radius capacity"`);
    const [r, c] = parts;
    const kilo = /k$/i.test(c);
    const cNum = kilo ? c.slice(0, -1) : c;
    if (!NUM.test(r) || !NUM.test(cNum)) return void errors.push(`line ${line}: "${t}" is not two numbers`);
    const radiusFt = Number(r);
    const capacityLb = Number(cNum) * (kilo ? 1000 : 1);
    if (!(radiusFt > 0) || !(capacityLb > 0)) return void errors.push(`line ${line}: radius and capacity must be above zero`);
    const dup = rows.find(x => x.radiusFt === radiusFt);
    if (dup) return void errors.push(`line ${line}: radius ${radiusFt} ft repeats line ${dup.line}`);
    rows.push({ radiusFt, capacityLb, line });
  });
  rows.sort((a, b) => a.radiusFt - b.radiusFt);
  return { rows: rows.map(({ radiusFt, capacityLb }) => ({ radiusFt, capacityLb })), errors };
}

/** Capacity at the first chart radius ≥ the pick radius; null when the radius is inside the shortest or past the longest row. */
export function capacityAt(rows: ChartRow[], radiusFt: number): number | null {
  const sorted = [...rows].sort((a, b) => a.radiusFt - b.radiusFt);
  if (!sorted.length || radiusFt < sorted[0].radiusFt - 1e-9) return null;
  const row = sorted.find(r => r.radiusFt >= radiusFt - 1e-9);
  return row ? row.capacityLb : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export type LiftCheck = { status: LiftStatus; totalLb: number | null; capacityLb: number | null; pct: number | null; reason: string };

export function liftCheck(p: { pieceLb: number | null; riggingLb: number | null; radiusFt: number | null }, rows: ChartRow[]): LiftCheck {
  if (p.pieceLb == null) return { status: "unknown", totalLb: null, capacityLb: null, pct: null, reason: "Enter weight" };
  if (p.radiusFt == null) return { status: "unknown", totalLb: null, capacityLb: null, pct: null, reason: "Enter radius" };
  const totalLb = p.pieceLb + (p.riggingLb ?? 0);
  const note = p.riggingLb == null ? " (rigging not entered)" : "";
  const capacityLb = capacityAt(rows, p.radiusFt);
  if (capacityLb == null) return { status: "blocked", totalLb, capacityLb: null, pct: null, reason: "Radius outside chart" };
  // Thresholds compare the exact ratio; only the displayed percent is rounded (72,001 lb on 72,000 lb is over, not "100.0 %").
  const raw = (totalLb / capacityLb) * 100;
  const pct = round1(raw);
  if (raw > LIFT_BLOCKED_PCT) return { status: "blocked", totalLb, capacityLb, pct, reason: `Over chart capacity${note}` };
  if (raw >= LIFT_CRITICAL_PCT) return { status: "critical", totalLb, capacityLb, pct, reason: `Critical lift${note}` };
  return { status: "ok", totalLb, capacityLb, pct, reason: `Within chart${note}` };
}

type Line4 = [number, number, number, number];

/** Intersection of two named grid lines (drawn as segments, extended to full lines); null when missing or parallel. */
export function gridPoint(grids: { n: string; a: Line4 }[], g1: string, g2: string): { x: number; y: number } | null {
  const norm = (s: string) => s.trim().toUpperCase();
  const a = grids.find(g => norm(g.n) === norm(g1));
  const b = grids.find(g => norm(g.n) === norm(g2));
  if (!a || !b || a === b) return null;
  const [x1, y1, x2, y2] = a.a;
  const [x3, y3, x4, y4] = b.a;
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

/** Plan radius (ft) from the crane's center (grid point + offset in ft) to the piece midpoint; null without a scale. */
export function pieceRadiusFt(setupPt: { x: number; y: number }, offsetFt: { x: number; y: number }, piece: { a: Line4 }, ppf: number): number | null {
  if (!(ppf > 0)) return null;
  const cx = setupPt.x + offsetFt.x * ppf;
  const cy = setupPt.y + offsetFt.y * ppf;
  const [x1, y1, x2, y2] = piece.a;
  return round1(Math.hypot((x1 + x2) / 2 - cx, (y1 + y2) / 2 - cy) / ppf);
}

/* ---------- lift plan document ---------- */

export const LIFT_SIGNOFFS = [
  { key: "supervisor", label: "Lift supervisor" },
  { key: "operator", label: "Crane operator" },
  { key: "rigger", label: "Rigger" },
  { key: "signal", label: "Signal person" },
] as const;

const NOT = "Not entered";
const lbText = (n: number | null | undefined) => (n == null ? NOT : `${Math.round(n).toLocaleString("en-US")} lb`);
const ftText = (n: number | null | undefined) => (n == null ? NOT : `${n.toFixed(1)} ft`);

function locationText(s: { grid1: string | null; grid2: string | null; offsetXFt: number; offsetYFt: number }): string {
  if (!s.grid1 || !s.grid2) return NOT;
  const parts = [`${s.grid1}/${s.grid2}`];
  if (s.offsetXFt) parts.push(`${Math.abs(s.offsetXFt)} ft ${s.offsetXFt > 0 ? "E" : "W"}`);
  if (s.offsetYFt) parts.push(`${Math.abs(s.offsetYFt)} ft ${s.offsetYFt > 0 ? "S" : "N"}`);
  return parts.join(" + ");
}

/** Rows of the printed lift plan. Unknowns read "Not entered" — never 0. */
export function liftPlanFields(
  pick: { mark: string; description: string | null; pieceLb: number | null; riggingLb: number | null; radiusFt: number | null; radiusSource: string },
  setup: { name: string; grid1: string | null; grid2: string | null; offsetXFt: number; offsetYFt: number; boomFt: number | null; counterweight: string | null },
  model: { name: string } | null,
  check: LiftCheck,
): { label: string; value: string }[] {
  const radius = pick.radiusFt == null ? NOT : `${ftText(pick.radiusFt)} (${pick.radiusSource === "model" ? "from model — confirm in field" : "entered"})`;
  const status =
    check.pct == null ? `${LIFT_STATUS_LABELS[check.status]} — ${check.reason}` : `${LIFT_STATUS_LABELS[check.status]} — ${check.pct.toFixed(1)} % of chart`;
  return [
    { label: "Crane", value: model?.name ?? NOT },
    { label: "Setup", value: setup.name },
    { label: "Setup location", value: locationText(setup) },
    { label: "Boom", value: ftText(setup.boomFt) },
    { label: "Counterweight", value: setup.counterweight?.trim() || NOT },
    { label: "Piece mark", value: pick.mark + (pick.description ? ` — ${pick.description}` : "") },
    { label: "Piece weight", value: lbText(pick.pieceLb) },
    { label: "Rigging weight", value: lbText(pick.riggingLb) },
    { label: "Total load", value: check.totalLb == null ? NOT : lbText(check.totalLb) },
    { label: "Radius", value: radius },
    { label: "Chart capacity at radius", value: check.capacityLb == null ? (pick.radiusFt == null ? NOT : "Outside chart") : lbText(check.capacityLb) },
    { label: "% of chart", value: check.pct == null ? "—" : `${check.pct.toFixed(1)} %` },
    { label: "Status", value: status },
  ];
}
