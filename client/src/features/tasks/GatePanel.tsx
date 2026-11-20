import { toast } from "sonner";
import { GATE_STATE_LABELS, GATE_STATUS_LABELS, isManualGateKey, type GateItemState } from "@shared/gate";
import { Panel } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { Input } from "@/components/ui/input";
import { errMsg } from "@/lib/format";
import { trpc } from "@/lib/trpc";

const tone = (s: GateItemState): "green" | "amber" | "gray" => (s === "met" || s === "na" ? "green" : s === "open" ? "amber" : "gray");

/** Ready-to-erect checklist for a sequence: four items the PM marks, three the app reads from loads, sheets and RFIs. */
export function GatePanel({ taskId, editable }: { taskId: number; editable: boolean }) {
  const q = trpc.gates.get.useQuery({ taskId });
  const utils = trpc.useUtils();
  const set = trpc.gates.set.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.gates.get.invalidate({ taskId }), utils.gates.forProject.invalidate(), utils.today.summary.invalidate()]);
    },
    onError: e => toast.error(errMsg(e)),
  });
  const g = q.data;
  return (
    <Panel
      title="Ready-to-erect gate"
      actions={g && <Pill tone={g.status === "ready" ? "green" : g.status === "not_ready" ? "amber" : "gray"}>{GATE_STATUS_LABELS[g.status]}</Pill>}
      bodyClassName="p-0"
    >
      {!g ? (
        <div className="p-3 text-sm text-muted-foreground">{q.error ? errMsg(q.error) : "Loading gate…"}</div>
      ) : (
        <ul className="divide-y divide-[var(--tp-rule-soft)]">
          {g.items.map(i => (
            <li key={i.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-48 flex-1 text-sm">{i.label}</span>
              {i.derived || !isManualGateKey(i.key) ? (
                <>
                  <span className="text-xs text-muted-foreground">{i.detail}</span>
                  <Pill tone={tone(i.state)}>{GATE_STATE_LABELS[i.state]}</Pill>
                </>
              ) : (
                <>
                  <Input
                    className="h-8 w-56"
                    placeholder="Note (survey #, test date…)"
                    maxLength={500}
                    defaultValue={i.note ?? ""}
                    disabled={!editable}
                    onBlur={e => {
                      const note = e.target.value.trim() || null;
                      const key = i.key;
                      if (note !== (i.note ?? null) && isManualGateKey(key)) set.mutate({ taskId, key, state: i.state === "unknown" ? "open" : i.state, note });
                    }}
                  />
                  <div className="flex overflow-hidden rounded-md border border-[var(--tp-rule)]" role="group" aria-label={`${i.label} state`}>
                    {(["met", "open", "na"] as const).map(st => (
                      <button
                        key={st}
                        type="button"
                        disabled={!editable || set.isPending}
                        aria-pressed={i.state === st}
                        className={`px-2 py-1 text-xs ${i.state === st ? "bg-[var(--tp-accent-ink)] text-white" : "hover:bg-[var(--tp-gray-soft)]"}`}
                        onClick={() => {
                          const key = i.key;
                          if (isManualGateKey(key)) set.mutate({ taskId, key, state: st, note: i.note });
                        }}
                      >
                        {GATE_STATE_LABELS[st]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
