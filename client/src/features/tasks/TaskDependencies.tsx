import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput, SimpleSelect } from "@/components/brand/Controls";
import { Field, Panel } from "@/components/brand/Layout";
import { trpc } from "@/lib/trpc";
import type { RouterOutputs } from "@/lib/ref";
import { errMsg } from "@/lib/format";
import { DEP_TYPES } from "@shared/domain";

type Detail = RouterOutputs["tasks"]["get"];
type Dependency = Detail["predecessors"][number];
function DependencyRow({
  link,
  direction,
  projectId,
  editable,
  changed,
}: {
  link: Dependency;
  direction: "predecessor" | "successor";
  projectId: number;
  editable: boolean;
  changed: () => Promise<void>;
}) {
  const targetJob = trpc.projects.get.useQuery(
    { id: link.projectId ?? 0 },
    { enabled: !link.restricted && direction === "successor" && link.projectId !== projectId }
  );
  const canEdit =
    direction === "predecessor" || link.projectId === projectId
      ? editable
      : !!targetJob.data?.privileges.includes("task.edit");
  const update = trpc.tasks.updateDependency.useMutation({
    onSuccess: changed,
    onError: e => toast.error(errMsg(e)),
  });
  const remove = trpc.tasks.removeDependency.useMutation({
    onSuccess: changed,
    onError: e => toast.error(errMsg(e)),
  });
  const [lag, setLag] = useState(link.dep.lagDays);
  const id =
    direction === "predecessor" ? link.dep.predecessorId : link.dep.successorId;
  return (
    <tr>
      <td>
        {link.restricted ? (
          <span className="text-muted-foreground">Restricted external task</span>
        ) : (
          <Link
            href={`/jobs/${link.projectId}/tasks?task=${id}`}
            className="hover:text-[var(--tp-accent-ink)]"
          >
            <span className="num mr-2 text-muted-foreground">{link.wbs}</span>
            {link.name}
          </Link>
        )}
        {!link.restricted && link.projectId !== projectId && (
          <div className="text-[11px] text-muted-foreground">
            Job #{link.projectId}
          </div>
        )}
      </td>
      <td className="w-32">
        <SimpleSelect
          value={link.dep.type}
          onChange={v =>
            v &&
            update.mutate({
              id: link.dep.id,
              type: v,
              lagDays: link.dep.lagDays,
            })
          }
          options={DEP_TYPES}
          disabled={!canEdit || update.isPending}
          size="sm"
        />
      </td>
      <td className="w-20">
        <Input
          aria-label="Dependency lag days"
          type="number"
          step="0.5"
          min={-365}
          max={365}
          className="num h-8"
          value={lag}
          disabled={!canEdit || update.isPending}
          onChange={e => setLag(Number(e.target.value))}
          onBlur={() =>
            lag !== link.dep.lagDays &&
            update.mutate({
              id: link.dep.id,
              type: link.dep.type,
              lagDays: lag,
            })
          }
        />
      </td>
      <td>
        {canEdit && (
          <Button
            aria-label="Remove dependency"
            size="icon"
            variant="ghost"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ id: link.dep.id })}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </td>
    </tr>
  );
}
export function TaskDependencies({
  data,
  changed,
}: {
  data: Detail;
  changed: () => Promise<void>;
}) {
  const [direction, setDirection] = useState("predecessor");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [type, setType] = useState("FS");
  const [lag, setLag] = useState(0);
  const [adding, setAdding] = useState(false);
  const canEdit = data.privileges.includes("task.edit");
  const results = trpc.tasks.search.useQuery(
    { q: search, leavesOnly: true },
    { enabled: adding }
  );
  const target = results.data?.find(t => t.id === Number(selected));
  const targetJob = trpc.projects.get.useQuery(
    { id: target?.projectId ?? 0 },
    {
      enabled:
        direction === "successor" &&
        !!target &&
        target.projectId !== data.task.projectId,
    }
  );
  const allowed =
    direction === "predecessor" || target?.projectId === data.task.projectId
      ? canEdit
      : !!targetJob.data?.privileges.includes("task.edit");
  const add = trpc.tasks.addDependency.useMutation({
    onSuccess: async () => {
      setSelected(null);
      setAdding(false);
      await changed();
    },
    onError: e => toast.error(errMsg(e)),
  });
  return (
    <Panel
      title="Schedule links"
      actions={
        canEdit &&
        !data.isSummary && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAdding(v => !v)}
          >
            <Plus className="size-3.5" />
            Link task
          </Button>
        )
      }
    >
      {(["predecessor", "successor"] as const).map(dir => {
        const rows =
          dir === "predecessor" ? data.predecessors : data.successors;
        return (
          <section key={dir}>
            <h4 className="label-caps border-b border-[var(--tp-rule)] px-3 py-2">
              {dir === "predecessor" ? "Predecessors" : "Successors"}
            </h4>
            {!rows.length ? (
              <p className="p-3 text-[12px] text-muted-foreground">
                No {dir}s.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tp-table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Type</th>
                      <th>Lag (d)</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(link => (
                      <DependencyRow
                        key={`${link.dep.id}:${link.dep.type}:${link.dep.lagDays}`}
                        link={link}
                        direction={dir}
                        projectId={data.task.projectId}
                        editable={canEdit}
                        changed={changed}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      {data.isSummary && (
        <p className="p-3 text-[12px] text-muted-foreground">
          Link detail tasks, not summary rows.
        </p>
      )}
      {adding && (
        <div className="space-y-3 border-t border-[var(--tp-rule)] p-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Link direction">
              <SimpleSelect
                value={direction}
                onChange={v => v && setDirection(v)}
                options={{
                  predecessor: "Add predecessor",
                  successor: "Add successor",
                }}
              />
            </Field>
            <Field label="Search all visible jobs">
              <Input
                value={search}
                onChange={e => {
                  setSearch(e.target.value);
                  setSelected(null);
                }}
                placeholder="Task name or job #"
              />
            </Field>
            <Field label="Task" className="col-span-2">
              <SimpleSelect
                value={selected}
                onChange={setSelected}
                options={(results.data ?? [])
                  .filter(t => t.id !== data.task.id)
                  .map(t => ({
                    value: String(t.id),
                    label: `${t.projectCode ?? t.projectName} · ${t.wbs} ${t.name}`,
                  }))}
              />
            </Field>
            <Field label="Dependency type">
              <SimpleSelect
                value={type}
                onChange={v => v && setType(v)}
                options={DEP_TYPES}
              />
            </Field>
            <Field label="Lag / lead (work days)">
              <NumberInput
                value={lag}
                onChange={v => setLag(v ?? 0)}
                step="0.5"
                min={-365}
              />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!target || !allowed || add.isPending}
              onClick={() =>
                target &&
                add.mutate({
                  predecessorId:
                    direction === "predecessor" ? target.id : data.task.id,
                  successorId:
                    direction === "successor" ? target.id : data.task.id,
                  type,
                  lagDays: lag,
                })
              }
            >
              Add link
            </Button>
          </div>
          {target && !allowed && (
            <p className="text-[12px] text-muted-foreground">
              Task-edit privilege is required on the successor's job.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
