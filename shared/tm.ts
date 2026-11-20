/** T&M / extra-work tickets: labor, equipment and material lines the GC super signs on screen. */

export const TM_LINE_KINDS = { labor: "Labor", equipment: "Equipment", material: "Material" } as const;
export type TmKind = keyof typeof TM_LINE_KINDS;
export const TM_KIND_KEYS = Object.keys(TM_LINE_KINDS) as TmKind[];
export const TM_STATUSES = { draft: "Draft", signed: "Signed", void: "Void" } as const;
export type TmStatus = keyof typeof TM_STATUSES;

export type TmLine = { kind: TmKind; description: string; qty: number; unit: string; rate: number; otQty?: number | null; otRate?: number | null };
export type Markup = Record<TmKind, number>;
export const DEFAULT_MARKUP: Markup = { labor: 0, equipment: 0, material: 0 };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const lineAmount = (l: TmLine) => round2(l.qty * l.rate + (l.otQty ?? 0) * (l.otRate ?? 0));

export function ticketTotals(lines: TmLine[], markupPct: Markup): { byKind: Record<TmKind, { subtotal: number; markup: number; total: number }>; grandTotal: number } {
  const byKind = {} as Record<TmKind, { subtotal: number; markup: number; total: number }>;
  for (const k of TM_KIND_KEYS) {
    const subtotal = round2(lines.filter(l => l.kind === k).reduce((s, l) => s + lineAmount(l), 0));
    const markup = round2((subtotal * (markupPct[k] ?? 0)) / 100);
    byKind[k] = { subtotal, markup, total: round2(subtotal + markup) };
  }
  return { byKind, grandTotal: round2(TM_KIND_KEYS.reduce((s, k) => s + byKind[k].total, 0)) };
}

/** Prefill from a finalized daily report: one labor line per worker (ST + OT), equipment operating and standby lines. */
export function linesFromDailyReport(r: {
  crew: { name: string; classification: string | null; stHours: number; otHours: number; billRate: number; otMultiplier: number }[];
  equipment: { name: string; operatingHours: number; standbyHours: number; hourlyRate: number; standbyRate: number }[];
}): TmLine[] {
  const out: TmLine[] = [];
  for (const c of r.crew) {
    if (!(c.stHours > 0) && !(c.otHours > 0)) continue;
    out.push({
      kind: "labor",
      description: c.classification ? `${c.name} — ${c.classification}` : c.name,
      qty: c.stHours,
      unit: "hr",
      rate: c.billRate,
      otQty: c.otHours,
      otRate: round2(c.billRate * c.otMultiplier),
    });
  }
  for (const e of r.equipment) {
    if (e.operatingHours > 0) out.push({ kind: "equipment", description: e.name, qty: e.operatingHours, unit: "hr", rate: e.hourlyRate });
    if (e.standbyHours > 0) out.push({ kind: "equipment", description: `${e.name} — standby`, qty: e.standbyHours, unit: "hr", rate: e.standbyRate });
  }
  return out;
}

export function assertTicketEditable(status: string): void {
  if (status === "signed") throw new Error("Signed tickets can't be changed — void and reissue");
  if (status === "void") throw new Error("Void tickets can't be changed");
}

export const ticketLabel = (n: number) => `T&M-${String(n).padStart(3, "0")}`;

/** Lines with hours or quantity but no rate: an unknown price must not be signed as $0. */
export function unpricedLines(lines: TmLine[]): string[] {
  return lines.filter(l => (l.qty > 0 && !(l.rate > 0)) || ((l.otQty ?? 0) > 0 && !((l.otRate ?? 0) > 0))).map(l => l.description);
}
