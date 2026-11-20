import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { LIFT_STATUS_LABELS, type LiftStatus } from "@shared/lift";
import { Pill } from "@/components/brand/Status";
import { Input } from "@/components/ui/input";
import { errMsg, fmtNum } from "@/lib/format";
import type { RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import type { Setup } from "./SetupForm";

export type Pick = RouterOutputs["cranes"]["picks"]["list"][number];
const TONE: Record<LiftStatus, "green" | "amber" | "red" | "gray"> = { ok: "green", critical: "amber", blocked: "red", unknown: "gray" };
const lbs = (n: number | null | undefined) => (n == null ? "—" : fmtNum(n, 0));

/** A number cell that saves on blur; empty means "not entered" (null), never 0. */
function NumCell({ value, onCommit, disabled, label }: { value: number | null; onCommit: (v: number | null) => void; disabled?: boolean; label: string }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      className="num h-8 w-24 text-right"
      value={v}
      disabled={disabled}
      placeholder="—"
      onChange={e => setV(e.target.value)}
      onBlur={() => {
        const t = v.trim();
        const n = t === "" ? null : Number(t.replace(/,/g, ""));
        if (n != null && (!Number.isFinite(n) || n < 0)) {
          toast.error(`${label}: enter a number`);
          return setV(value == null ? "" : String(value));
        }
        if (n !== value) onCommit(n);
      }}
    />
  );
}

export function PickTable({ projectId, picks, setups, seqName, editable }: { projectId: number; picks: Pick[]; setups: Setup[]; seqName: (id: number | null) => string; editable: boolean }) {
  const utils = trpc.useUtils();
  const opts = { onSuccess: () => utils.cranes.picks.list.invalidate({ projectId }), onError: (e: unknown) => toast.error(errMsg(e)) };
  const update = trpc.cranes.picks.update.useMutation(opts);
  const remove = trpc.cranes.picks.remove.useMutation(opts);
  const setupName = (id: number) => setups.find(s => s.id === id)?.name ?? "—";
  return (
    <div className="overflow-x-auto">
      <table className="tp-table min-w-[1000px]">
        <thead>
          <tr>
            <th>Mark</th>
            <th>Setup</th>
            <th>Sequence</th>
            <th className="right">Piece (lb)</th>
            <th className="right">Rigging (lb)</th>
            <th className="right">Radius (ft)</th>
            <th className="right">Capacity (lb)</th>
            <th className="right">% chart</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {picks.map(p => (
            <tr key={p.id}>
              <td className="num font-medium">{p.mark}</td>
              <td>{setupName(p.setupId)}</td>
              <td>{seqName(p.sequenceTaskId)}</td>
              <td className="right"><NumCell key={`w${p.id}-${p.pieceLb}`} label={`Piece weight ${p.mark}`} value={p.pieceLb} disabled={!editable} onCommit={v => update.mutate({ id: p.id, pieceLb: v })} /></td>
              <td className="right"><NumCell key={`r${p.id}-${p.riggingLb}`} label={`Rigging weight ${p.mark}`} value={p.riggingLb} disabled={!editable} onCommit={v => update.mutate({ id: p.id, riggingLb: v })} /></td>
              <td className="right">
                <div className="flex items-center justify-end gap-1">
                  {p.radiusSource === "model" && p.radiusFt != null && <span className="text-[10px] uppercase text-[var(--tp-muted)]" title="Measured from the framing sheet — confirm in the field">model</span>}
                  <NumCell key={`d${p.id}-${p.radiusFt}`} label={`Radius ${p.mark}`} value={p.radiusFt} disabled={!editable} onCommit={v => update.mutate({ id: p.id, radiusFt: v })} />
                </div>
              </td>
              <td className="right num">{lbs(p.check.capacityLb)}</td>
              <td className="right num">{p.check.pct == null ? "—" : `${fmtNum(p.check.pct, 1)} %`}</td>
              <td>
                <Pill tone={TONE[p.check.status]}>{LIFT_STATUS_LABELS[p.check.status]}</Pill>
                <div className="text-[11px] text-[var(--tp-muted)]">{p.check.reason}</div>
              </td>
              <td className="whitespace-nowrap">
                <a className="text-xs text-[var(--tp-accent-ink)] hover:underline" href={`/print/lift/${p.id}`} target="_blank" rel="noreferrer">
                  {p.check.status === "critical" ? "Critical lift plan" : "Lift plan"}
                </a>
                {editable && (
                  <button type="button" aria-label={`Delete pick ${p.mark}`} className="ml-2 align-middle text-[var(--tp-muted)] hover:text-[var(--tp-red-strong)]" onClick={() => remove.mutate({ id: p.id })}>
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
