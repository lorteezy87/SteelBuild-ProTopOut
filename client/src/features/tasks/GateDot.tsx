import { GATE_STATUS_LABELS, type GateStatus } from "@shared/gate";

const TONE: Record<GateStatus, string> = {
  ready: "bg-[var(--tp-green)]",
  not_ready: "bg-[var(--tp-amber)]",
  unknown: "bg-[var(--tp-muted)]",
};

/** Ready-to-erect status of a sequence: green ready, amber not ready, grey unknown. */
export function GateDot({ status }: { status: GateStatus | undefined }) {
  if (!status) return null;
  return <span role="img" aria-label={GATE_STATUS_LABELS[status]} title={GATE_STATUS_LABELS[status]} className={`inline-block size-2 shrink-0 rounded-full ${TONE[status]}`} />;
}
