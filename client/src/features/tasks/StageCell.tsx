import { STAGE_KEYS, STAGE_SHORT, stageColumns, stageWarnings, type StageQty } from "@shared/stages";
import { fmtTons } from "@/lib/format";

/** Tons by erection stage for a sequence row: Set · Plumbed · Bolted · Final / planned, with an amber note when a later stage runs ahead. */
export function StageCell({ t }: { t: StageQty & { plannedTons: number } }) {
  const warn = stageWarnings(t);
  return (
    <div className="space-y-0.5">
      <div className="num whitespace-nowrap text-xs">
        {STAGE_KEYS.map((s, i) => (
          <span key={s}>
            {i > 0 && <span className="text-[var(--tp-muted)]"> · </span>}
            <span className="text-[var(--tp-muted)]">{STAGE_SHORT[s]} </span>
            {fmtTons(t[stageColumns(s).tons])}
          </span>
        ))}
        <span className="text-[var(--tp-muted)]"> / {fmtTons(t.plannedTons)}</span>
      </div>
      {warn.map(w => (
        <div key={w} className="text-xs text-amber-700 dark:text-amber-400">
          {w}
        </div>
      ))}
    </div>
  );
}
