import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { GATE_ITEMS, GATE_KEYS, formatGateRefusal, derivedGate, gateStatus, isManualGateKey, startsSequence, type GateItemState, type GateKey, type GateStatus } from "@shared/gate";
import { deliveries, drawingSheets, sequenceGateItems, tasks, wfApps, wfItems, wfStates } from "../../drizzle/schema";
import { db } from "../db";

export type GateItemView = { key: GateKey; label: string; state: GateItemState; note: string | null; derived: boolean; detail: string | null };
export type GateView = { taskId: number; items: GateItemView[]; status: GateStatus };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Full gate for each sequence: manual items as stored (missing → open), derived items from loads, sheets and RFIs. */
export async function gatesFor(taskIds: number[]): Promise<Map<number, GateView>> {
  const out = new Map<number, GateView>();
  if (!taskIds.length) return out;
  const d = await db();
  const [seqs, manual, loads, sheets, rfis] = await Promise.all([
    d.select({ id: tasks.id, plannedTons: tasks.plannedTons }).from(tasks).where(inArray(tasks.id, taskIds)),
    d.select().from(sequenceGateItems).where(inArray(sequenceGateItems.taskId, taskIds)),
    d
      .select({ taskId: deliveries.sequenceTaskId, tons: deliveries.tons, receivedDate: deliveries.receivedDate })
      .from(deliveries)
      .where(inArray(deliveries.sequenceTaskId, taskIds)),
    d.select({ taskId: drawingSheets.sequenceTaskId, status: drawingSheets.status }).from(drawingSheets).where(inArray(drawingSheets.sequenceTaskId, taskIds)),
    d
      .select({ taskId: wfItems.linkedTaskId })
      .from(wfItems)
      .innerJoin(wfApps, eq(wfApps.id, wfItems.appId))
      .innerJoin(wfStates, eq(wfStates.id, wfItems.stateId))
      .where(and(eq(wfApps.key, "rfi"), inArray(wfItems.linkedTaskId, taskIds), isNotNull(wfItems.linkedTaskId), ne(wfStates.category, "end"))),
  ]);
  for (const s of seqs) {
    const myLoads = loads.filter(l => l.taskId === s.id);
    const receivedTons = myLoads.length ? r2(myLoads.filter(l => l.receivedDate).reduce((a, l) => a + l.tons, 0)) : null;
    const mySheets = sheets.filter(x => x.taskId === s.id);
    const openRfiCount = rfis.filter(x => x.taskId === s.id).length;
    const der = derivedGate({ plannedTons: s.plannedTons, receivedTons, sheets: mySheets, openRfiCount });
    const detail: Record<keyof typeof der, string> = {
      steel_on_site: receivedTons == null ? "No loads logged for this sequence" : s.plannedTons > 0 ? `${receivedTons} of ${r2(s.plannedTons)} t received` : `${receivedTons} t received; no planned tons`,
      drawings_released: mySheets.length ? `${mySheets.filter(x => x.status === "REL").length} of ${mySheets.length} sheets released` : "No sheets tied to this sequence",
      open_rfis: openRfiCount ? `${openRfiCount} open RFI${openRfiCount === 1 ? "" : "s"}` : "None open",
    };
    const items: GateItemView[] = GATE_KEYS.map(key => {
      if (isManualGateKey(key)) {
        const m = manual.find(x => x.taskId === s.id && x.itemKey === key);
        const st = m?.state;
        const state: GateItemState = st === "met" || st === "na" ? st : "open";
        return { key, label: GATE_ITEMS[key], state, note: m?.note ?? null, derived: false, detail: null };
      }
      const k = key as keyof typeof der;
      return { key, label: GATE_ITEMS[key], state: der[k], note: null, derived: true, detail: detail[k] };
    });
    out.set(s.id, { taskId: s.id, items, status: gateStatus(Object.fromEntries(items.map(i => [i.key, i.state])) as Record<GateKey, GateItemState>) });
  }
  return out;
}

export async function gateStatusFor(taskIds: number[]): Promise<Map<number, GateStatus>> {
  const g = await gatesFor(taskIds);
  return new Map(Array.from(g, ([id, v]) => [id, v.status]));
}

/** "Anchor bolt survey accepted, Steel on site (unknown)" — the items keeping a gate from ready. */
export function openItemsText(v: GateView): string {
  return v.items
    .filter(i => i.state === "open" || i.state === "unknown")
    .map(i => (i.state === "unknown" ? `${i.label} (unknown)` : i.label))
    .join(", ");
}

/**
 * Starting a sequence whose gate isn't ready needs a reason. Throws when the reason is missing;
 * otherwise records the override and returns. A call that doesn't start the sequence is a no-op.
 */
export async function guardSequenceStart(
  t: { id: number; kind: string; name: string; status: string },
  after: { status?: string },
  reason: string | undefined,
  record: (taskId: number, reason: string) => Promise<void>,
): Promise<void> {
  if (t.kind !== "sequence" || !startsSequence(t, after)) return;
  const g = (await gatesFor([t.id])).get(t.id);
  if (!g || g.status === "ready") return;
  const why = (reason ?? "").trim();
  if (!why) gateRefusal([{ name: t.name, open: openItemsText(g) }]);
  await record(t.id, why);
}

/** One refusal naming every sequence still blocked by its gate (see formatGateRefusal). */
export function gateRefusal(list: { name: string; open: string; taskId?: number }[]): never {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: formatGateRefusal({
      items: list.map(l => ({ taskId: l.taskId ?? 0, name: l.name })),
      text: `Ready-to-erect gate is open for ${list.map(l => `${l.name}: ${l.open}`).join("; ")}. Give a reason to start anyway.`,
    }),
  });
}
