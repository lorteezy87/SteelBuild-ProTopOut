import { BALL_IN_COURT_LABELS, isBallInCourt } from "@shared/ballInCourt";
import { CfValue, type CfDef } from "@/components/brand/CustomFields";
import { PriorityBadge, SlaBadge, StateChip } from "@/components/brand/Status";
import { diffDays, fmtDateShort, toDay } from "@/lib/format";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { RESPONSIBLE_PARTIES } from "@shared/domain";
import type { LogItem } from "./model";

export function LogTable({
  items,
  states,
  defs,
  showJob,
  selectedId,
  onSelect,
}: {
  items: LogItem[];
  states: RouterOutputs["wf"]["list"]["states"];
  defs: CfDef[];
  showJob: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const { today } = useRefData();
  const listDefs = defs.filter(d => d.showInList);
  return (
    <div className="overflow-x-auto">
      <table className="tp-table whitespace-nowrap">
        <thead>
          <tr>
            <th>Number</th>
            {showJob && <th>Job</th>}
            <th>Title</th>
            <th>State</th>
            <th>Priority</th>
            <th>Assignee</th>
            <th>Ball in court</th>
            <th>Responsible party</th>
            <th>Due / SLA</th>
            <th className="right">Age days</th>
            {listDefs.map(d => (
              <th key={d.key}>{d.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const state = states.find(s => s.id === item.stateId);
            const ageEnd = item.closedAt ? toDay(item.closedAt) : today;
            return (
              <tr
                key={item.id}
                className={
                  item.id === selectedId ? "is-selected" : "cursor-pointer"
                }
                onClick={() => onSelect(item.id)}
              >
                <td
                  className={`num font-medium ${item.slaStatus === "delayed" && state?.category !== "end" ? "hazard" : ""}`}
                >
                  <button
                    className="text-[var(--tp-accent-ink)]"
                    onClick={() => onSelect(item.id)}
                  >
                    {item.label}
                  </button>
                </td>
                {showJob && (
                  <td>
                    <span className="num font-medium">{item.projectCode}</span>
                    <div
                      className="max-w-52 truncate text-xs text-muted-foreground"
                      title={item.projectName ?? ""}
                    >
                      {item.projectName}
                    </div>
                  </td>
                )}
                <td className="max-w-80 truncate" title={item.title}>
                  {item.title}
                </td>
                <td>
                  <StateChip
                    name={state?.name ?? "—"}
                    color={state?.color}
                    category={state?.category}
                  />
                </td>
                <td>
                  <PriorityBadge value={item.priority} />
                </td>
                <td>{item.assigneeName ?? "Unassigned"}</td>
                <td>{isBallInCourt(item.ballInCourt) ? BALL_IN_COURT_LABELS[item.ballInCourt] : "—"}</td>
                <td>
                  {item.responsibleParty
                    ? (RESPONSIBLE_PARTIES[
                        item.responsibleParty as keyof typeof RESPONSIBLE_PARTIES
                      ] ?? item.responsibleParty)
                    : "—"}
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <span className="num">{fmtDateShort(item.dueDate)}</span>
                    {item.slaDueAt && state?.category !== "end" && (
                      <SlaBadge value={item.slaStatus} />
                    )}
                  </div>
                </td>
                <td className="right num">
                  {Math.max(0, diffDays(toDay(item.createdAt), ageEnd))}
                </td>
                {listDefs.map(d => (
                  <td key={d.key} className="max-w-56 truncate">
                    <CfValue def={d} value={item.customFields[d.key]} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
