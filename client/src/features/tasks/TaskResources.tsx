import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  NumberInput,
  SimpleSelect,
  UserSelect,
} from "@/components/brand/Controls";
import { Field, Panel } from "@/components/brand/Layout";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { errMsg } from "@/lib/format";

type Detail = RouterOutputs["tasks"]["get"];
type Assignment = {
  userId: number | null;
  jobRoleId: number | null;
  equipmentId: number | null;
  allocationPct: number;
};
export function TaskResources({
  data,
  changed,
}: {
  data: Detail;
  changed: () => Promise<void>;
}) {
  const { ref, userName, jobRoleName, equipmentName } = useRefData();
  const canEdit = data.privileges.includes("task.edit");
  const [assignments, setAssignments] = useState<Assignment[]>(
    data.assignments
  );
  useEffect(() => setAssignments(data.assignments), [data.assignments]);
  const save = trpc.tasks.setAssignments.useMutation({
    onSuccess: async () => {
      toast.success("Assignments updated.");
      await changed();
    },
    onError: e => toast.error(errMsg(e)),
  });
  const update = (index: number, patch: Partial<Assignment>) =>
    setAssignments(a =>
      a.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  return (
    <Panel
      title="Resource assignments"
      actions={
        canEdit && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setAssignments(a => [
                ...a,
                {
                  userId: null,
                  jobRoleId: null,
                  equipmentId: null,
                  allocationPct: 100,
                },
              ])
            }
          >
            <Plus className="size-3.5" />
            Resource
          </Button>
        )
      }
      bodyClassName="space-y-3 p-3"
    >
      {!assignments.length && (
        <p className="text-[12px] text-muted-foreground">
          No resources assigned. Add a person, job-role demand or equipment.
        </p>
      )}
      {assignments.map((a, i) => (
        <div
          key={i}
          className="grid items-end gap-2 border-b border-[var(--tp-rule)] pb-3 sm:grid-cols-[1fr_1fr_84px_32px]"
        >
          <Field label="Person">
            {canEdit ? (
              <UserSelect
                value={a.userId}
                onChange={v => update(i, { userId: v })}
                includePassive
              />
            ) : (
              userName(a.userId)
            )}
          </Field>
          <div className="space-y-2">
            <Field label="Job role">
              {canEdit ? (
                <SimpleSelect
                  value={a.jobRoleId ? String(a.jobRoleId) : null}
                  onChange={v => update(i, { jobRoleId: v ? Number(v) : null })}
                  options={(ref?.jobRoles ?? []).map(r => ({
                    value: String(r.id),
                    label: r.name,
                  }))}
                  allowNone
                  size="sm"
                />
              ) : (
                jobRoleName(a.jobRoleId)
              )}
            </Field>
            <Field label="Equipment">
              {canEdit ? (
                <SimpleSelect
                  value={a.equipmentId ? String(a.equipmentId) : null}
                  onChange={v =>
                    update(i, { equipmentId: v ? Number(v) : null })
                  }
                  options={(ref?.equipment ?? []).map(e => ({
                    value: String(e.id),
                    label: e.name,
                  }))}
                  allowNone
                  size="sm"
                />
              ) : (
                equipmentName(a.equipmentId)
              )}
            </Field>
          </div>
          <Field label="Allocation %">
            <NumberInput
              value={a.allocationPct}
              onChange={v => update(i, { allocationPct: v ?? 100 })}
              min={1}
              disabled={!canEdit}
            />
          </Field>
          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove resource"
              onClick={() =>
                setAssignments(rows => rows.filter((_, idx) => idx !== i))
              }
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      ))}
      {canEdit && (
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={
              save.isPending ||
              assignments.some(
                a =>
                  (!a.userId && !a.jobRoleId && !a.equipmentId) ||
                  a.allocationPct < 1 ||
                  a.allocationPct > 400
              )
            }
            onClick={() => save.mutate({ taskId: data.task.id, assignments })}
          >
            Save assignments
          </Button>
        </div>
      )}
    </Panel>
  );
}
export function TaskChecklist({
  data,
  changed,
}: {
  data: Detail;
  changed: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const canProgress = data.privileges.includes("task.progress");
  const add = trpc.tasks.addChecklist.useMutation({
    onSuccess: async () => {
      setText("");
      await changed();
    },
    onError: e => toast.error(errMsg(e)),
  });
  const toggle = trpc.tasks.toggleChecklist.useMutation({
    onSuccess: changed,
    onError: e => toast.error(errMsg(e)),
  });
  const remove = trpc.tasks.removeChecklist.useMutation({
    onSuccess: changed,
    onError: e => toast.error(errMsg(e)),
  });
  return (
    <Panel
      title={`Checklist · ${data.checklist.filter(c => c.done).length}/${data.checklist.length}`}
      bodyClassName="space-y-2 p-3"
    >
      {!data.checklist.length && (
        <p className="text-[12px] text-muted-foreground">No checklist items.</p>
      )}
      {data.checklist.map(c => (
        <div key={c.id} className="flex items-center gap-2">
          <Checkbox
            aria-label={`Complete ${c.text}`}
            checked={c.done}
            disabled={!canProgress || toggle.isPending}
            onCheckedChange={done =>
              toggle.mutate({ id: c.id, done: done === true })
            }
          />
          <span
            className={`flex-1 ${c.done ? "text-muted-foreground line-through" : ""}`}
          >
            {c.text}
          </span>
          {canProgress && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove checklist item"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ id: c.id })}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      ))}
      {canProgress && (
        <div className="flex gap-2 pt-2">
          <Input
            aria-label="New checklist item"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Add a field check…"
            maxLength={500}
            onKeyDown={e =>
              e.key === "Enter" &&
              text.trim() &&
              add.mutate({ taskId: data.task.id, text: text.trim() })
            }
          />
          <Button
            size="sm"
            disabled={!text.trim() || add.isPending}
            onClick={() =>
              add.mutate({ taskId: data.task.id, text: text.trim() })
            }
          >
            Add
          </Button>
        </div>
      )}
    </Panel>
  );
}
