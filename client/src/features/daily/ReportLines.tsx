import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NumberInput,
  SimpleSelect,
  UserSelect,
} from "@/components/brand/Controls";
import { Panel } from "@/components/brand/Layout";
import { fmtPct } from "@/lib/format";
import { useRefData, type RouterOutputs } from "@/lib/ref";

export type CrewLine = {
  userId: number;
  jobRoleId: number | null;
  taskId: number | null;
  stHours: number;
  otHours: number;
};
export type EquipmentLine = {
  equipmentId: number;
  operatingHours: number;
  standbyHours: number;
};
export type ProgressLine = {
  taskId: number;
  tons: number;
  pieces: number;
  note: string | null;
};
type Task = RouterOutputs["tasks"]["list"]["tasks"][number];

function Remove({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="size-7"
      onClick={onClick}
      aria-label="Remove line"
    >
      <X className="size-3.5" />
    </Button>
  );
}

export function ReportLines({
  crew,
  equipment,
  progress,
  tasks,
  editable,
  posted,
  onCrew,
  onEquipment,
  onProgress,
}: {
  crew: CrewLine[];
  equipment: EquipmentLine[];
  progress: ProgressLine[];
  tasks: Task[];
  editable: boolean;
  posted: boolean;
  onCrew: (lines: CrewLine[]) => void;
  onEquipment: (lines: EquipmentLine[]) => void;
  onProgress: (lines: ProgressLine[]) => void;
}) {
  const { ref } = useRefData();
  const taskOptions = tasks
    .filter(t => !t.isSummary)
    .map(t => ({ value: String(t.id), label: `${t.wbs} · ${t.name}` }));
  const setCrew = (i: number, patch: Partial<CrewLine>) =>
    onCrew(crew.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const setEquipment = (i: number, patch: Partial<EquipmentLine>) =>
    onEquipment(equipment.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const setProgress = (i: number, patch: Partial<ProgressLine>) =>
    onProgress(progress.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-4">
      <Panel
        title="Crew · straight time / overtime"
        actions={
          editable && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onCrew([
                  ...crew,
                  {
                    userId: 0,
                    jobRoleId: null,
                    taskId: null,
                    stHours: 8,
                    otHours: 0,
                  },
                ])
              }
            >
              <Plus className="size-3.5" />
              Crew line
            </Button>
          )
        }
      >
        <fieldset disabled={!editable} className="overflow-x-auto">
          <table className="tp-table min-w-[660px]">
            <thead>
              <tr>
                <th>Person</th>
                <th>Craft / role</th>
                <th>ST hours</th>
                <th>OT hours</th>
                <th>Task / sequence</th>
                {editable && <th />}
              </tr>
            </thead>
            <tbody>
              {crew.map((line, i) => (
                <tr key={i}>
                  <td className="min-w-44">
                    <UserSelect
                      value={line.userId || null}
                      allowNone={false}
                      onChange={v =>
                        setCrew(i, {
                          userId: v ?? 0,
                          jobRoleId:
                            ref?.users.find(u => u.id === v)?.jobRoleId ??
                            line.jobRoleId,
                        })
                      }
                    />
                  </td>
                  <td className="min-w-40">
                    <SimpleSelect
                      value={line.jobRoleId ? String(line.jobRoleId) : null}
                      allowNone
                      onChange={v =>
                        setCrew(i, { jobRoleId: v ? Number(v) : null })
                      }
                      options={(ref?.jobRoles ?? []).map(r => ({
                        value: String(r.id),
                        label: r.name,
                      }))}
                    />
                  </td>
                  <td>
                    <NumberInput
                      min={0}
                      step="0.25"
                      value={line.stHours}
                      onChange={v => setCrew(i, { stHours: v ?? 0 })}
                      className="w-20"
                    />
                  </td>
                  <td>
                    <NumberInput
                      min={0}
                      step="0.25"
                      value={line.otHours}
                      onChange={v => setCrew(i, { otHours: v ?? 0 })}
                      className="w-20"
                    />
                  </td>
                  <td className="min-w-44">
                    <SimpleSelect
                      value={line.taskId ? String(line.taskId) : null}
                      allowNone
                      options={taskOptions}
                      onChange={v =>
                        setCrew(i, { taskId: v ? Number(v) : null })
                      }
                    />
                  </td>
                  {editable && (
                    <td>
                      <Remove
                        onClick={() => onCrew(crew.filter((_, n) => n !== i))}
                      />
                    </td>
                  )}
                </tr>
              ))}
              {!crew.length && (
                <tr>
                  <td colSpan={6} className="text-muted-foreground">
                    No crew lines. Add each person's ST and OT hours.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </fieldset>
      </Panel>
      <Panel
        title="Equipment · operating / standby"
        actions={
          editable && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onEquipment([
                  ...equipment,
                  { equipmentId: 0, operatingHours: 8, standbyHours: 0 },
                ])
              }
            >
              <Plus className="size-3.5" />
              Equipment line
            </Button>
          )
        }
      >
        <fieldset disabled={!editable} className="overflow-x-auto">
          <table className="tp-table">
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Operating hours</th>
                <th>Standby hours</th>
                {editable && <th />}
              </tr>
            </thead>
            <tbody>
              {equipment.map((line, i) => (
                <tr key={i}>
                  <td className="min-w-52">
                    <SimpleSelect
                      value={line.equipmentId ? String(line.equipmentId) : null}
                      options={(ref?.equipment ?? []).map(e => ({
                        value: String(e.id),
                        label: e.name,
                      }))}
                      onChange={v =>
                        setEquipment(i, { equipmentId: v ? Number(v) : 0 })
                      }
                    />
                  </td>
                  <td>
                    <NumberInput
                      min={0}
                      step="0.25"
                      value={line.operatingHours}
                      onChange={v =>
                        setEquipment(i, { operatingHours: v ?? 0 })
                      }
                    />
                  </td>
                  <td>
                    <NumberInput
                      min={0}
                      step="0.25"
                      value={line.standbyHours}
                      onChange={v => setEquipment(i, { standbyHours: v ?? 0 })}
                    />
                  </td>
                  {editable && (
                    <td>
                      <Remove
                        onClick={() =>
                          onEquipment(equipment.filter((_, n) => n !== i))
                        }
                      />
                    </td>
                  )}
                </tr>
              ))}
              {!equipment.length && (
                <tr>
                  <td colSpan={4} className="text-muted-foreground">
                    No equipment lines.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </fieldset>
        <p className="border-t border-[var(--tp-rule)] px-3 py-2 text-xs text-muted-foreground">
          Equipment cost is posted at approval. Equipment-to-task allocation is
          not supported on daily reports.
        </p>
      </Panel>
      <Panel
        title="Erection progress"
        actions={
          editable && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onProgress([
                  ...progress,
                  { taskId: 0, tons: 0, pieces: 0, note: null },
                ])
              }
            >
              <Plus className="size-3.5" />
              Progress line
            </Button>
          )
        }
      >
        <fieldset disabled={!editable} className="overflow-x-auto">
          <table className="tp-table min-w-[660px]">
            <thead>
              <tr>
                <th>Sequence</th>
                <th>Pieces set</th>
                <th>Tons erected</th>
                <th>% complete*</th>
                <th>Field note</th>
                {editable && <th />}
              </tr>
            </thead>
            <tbody>
              {progress.map((line, i) => {
                const task = tasks.find(t => t.id === line.taskId);
                const addedTons = posted
                  ? 0
                  : progress
                      .filter(p => p.taskId === line.taskId)
                      .reduce((s, p) => s + p.tons, 0);
                const addedPieces = posted
                  ? 0
                  : progress
                      .filter(p => p.taskId === line.taskId)
                      .reduce((s, p) => s + p.pieces, 0);
                const pct = task
                  ? task.plannedTons > 0
                    ? ((task.erectedTons + addedTons) / task.plannedTons) * 100
                    : task.plannedPieces > 0
                      ? ((task.erectedPieces + addedPieces) /
                          task.plannedPieces) *
                        100
                      : task.percentComplete
                  : null;
                return (
                  <tr key={i}>
                    <td className="min-w-56">
                      <SimpleSelect
                        value={line.taskId ? String(line.taskId) : null}
                        options={tasks
                          .filter(t => t.kind === "sequence" && !t.isSummary)
                          .map(t => ({
                            value: String(t.id),
                            label: `${t.wbs} · ${t.name}`,
                          }))}
                        onChange={v =>
                          setProgress(i, { taskId: v ? Number(v) : 0 })
                        }
                      />
                    </td>
                    <td>
                      <NumberInput
                        min={0}
                        step={1}
                        value={line.pieces}
                        onChange={v => setProgress(i, { pieces: v ?? 0 })}
                        className="w-24"
                      />
                    </td>
                    <td>
                      <NumberInput
                        min={0}
                        step="0.01"
                        value={line.tons}
                        onChange={v => setProgress(i, { tons: v ?? 0 })}
                        className="w-24"
                      />
                    </td>
                    <td className="num">
                      {fmtPct(pct === null ? null : Math.min(100, pct), 1)}
                    </td>
                    <td>
                      <Input
                        value={line.note ?? ""}
                        maxLength={500}
                        onChange={e =>
                          setProgress(i, { note: e.target.value || null })
                        }
                      />
                    </td>
                    {editable && (
                      <td>
                        <Remove
                          onClick={() =>
                            onProgress(progress.filter((_, n) => n !== i))
                          }
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
              {!progress.length && (
                <tr>
                  <td colSpan={6} className="text-muted-foreground">
                    No progress recorded. Add the tons and pieces erected by
                    sequence.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </fieldset>
        <p className="border-t border-[var(--tp-rule)] px-3 py-2 text-xs text-muted-foreground">
          * Cumulative tonnage % (pieces when no planned tons), including this
          report. Preview only until approved.
        </p>
      </Panel>
    </div>
  );
}
