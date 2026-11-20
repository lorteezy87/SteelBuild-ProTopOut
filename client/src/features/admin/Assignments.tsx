import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  SimpleSelect,
  ConfirmButton,
  UserSelect,
} from "@/components/ks/Controls";
import {
  Panel,
  Field,
  Loading,
  ErrorState,
  EmptyState,
} from "@/components/ks/Layout";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { errMsg } from "@/lib/format";
export default function Assignments() {
  const q = trpc.admin.assignments.list.useQuery();
  const roles = trpc.admin.roles.list.useQuery();
  const jobs = trpc.projects.list.useQuery();
  const { ref, userName } = useRefData();
  const utils = trpc.useUtils();
  const [userId, setUser] = useState<number | null>(null);
  const [roleId, setRole] = useState<string | null>(null);
  const [scope, setScope] = useState<"global" | "workspace" | "project">(
    "workspace"
  );
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const success = async () => {
    await Promise.all([
      utils.admin.assignments.list.invalidate(),
      utils.admin.users.list.invalidate(),
      utils.ref.all.invalidate(),
    ]);
  };
  const add = trpc.admin.assignments.add.useMutation({
    onSuccess: () => {
      void success();
      toast.success("Role assigned");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const remove = trpc.admin.assignments.remove.useMutation({
    onSuccess: success,
    onError: e => toast.error(errMsg(e)),
  });
  if (q.isLoading || roles.isLoading || jobs.isLoading) return <Loading />;
  if (q.error || roles.error || jobs.error)
    return <ErrorState error={q.error ?? roles.error ?? jobs.error} />;
  const rows = (q.data ?? []).filter(
    a => filter === "all" || a.scopeType === filter
  );
  const scopeName = (type: string, id: number | null) =>
    type === "global"
      ? "All jobs & global privileges"
      : type === "workspace"
        ? (ref?.workspaces.find(w => w.id === id)?.name ?? `Workspace ${id}`)
        : (jobs.data?.find(j => j.id === id)?.name ?? `Job ${id}`);
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Workspace assignments cover jobs in that workspace. Job assignments are
        limited to one job. Global assignments apply across jobs; deny still
        wins.
      </p>
      <Panel title="Assign a role" bodyClassName="p-4">
        <div className="grid gap-3 lg:grid-cols-4">
          <Field label="Person">
            <UserSelect value={userId} onChange={setUser} includePassive />
          </Field>
          <Field label="Security role">
            <SimpleSelect
              value={roleId}
              onChange={setRole}
              options={(roles.data ?? []).map(r => ({
                value: String(r.id),
                label: r.name,
              }))}
            />
          </Field>
          <Field label="Scope">
            <SimpleSelect
              value={scope}
              onChange={v => {
                setScope((v ?? "workspace") as typeof scope);
                setScopeId(null);
              }}
              options={{
                global: "Global",
                workspace: "Workspace",
                project: "Job",
              }}
            />
          </Field>
          {scope !== "global" && (
            <Field label={scope === "workspace" ? "Workspace" : "Job"}>
              <SimpleSelect
                value={scopeId}
                onChange={setScopeId}
                options={
                  scope === "workspace"
                    ? (ref?.workspaces ?? []).map(w => ({
                        value: String(w.id),
                        label: w.name,
                      }))
                    : (jobs.data ?? []).map(j => ({
                        value: String(j.id),
                        label: `${j.code ?? ""} ${j.name}`,
                      }))
                }
              />
            </Field>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            size="sm"
            disabled={
              !userId ||
              !roleId ||
              (scope !== "global" && !scopeId) ||
              add.isPending
            }
            onClick={() =>
              userId &&
              roleId &&
              add.mutate({
                userId,
                roleId: Number(roleId),
                scopeType: scope,
                scopeId: scope === "global" ? null : Number(scopeId),
              })
            }
          >
            Assign role
          </Button>
        </div>
      </Panel>
      <Panel
        title={`${rows.length} assignments`}
        actions={
          <SimpleSelect
            size="sm"
            value={filter}
            onChange={v => setFilter(v ?? "all")}
            options={{
              all: "All scopes",
              global: "Global",
              workspace: "Workspace",
              project: "Job",
            }}
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="ks-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Scope</th>
                <th>Workspace / job</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.id}>
                  <td>{userName(a.userId)}</td>
                  <td>
                    {roles.data?.find(r => r.id === a.roleId)?.name ??
                      `Role ${a.roleId}`}
                  </td>
                  <td>{a.scopeType === "project" ? "Job" : a.scopeType}</td>
                  <td>{scopeName(a.scopeType, a.scopeId)}</td>
                  <td className="right">
                    <ConfirmButton
                      title="Remove role assignment?"
                      destructive
                      disabled={remove.isPending}
                      onConfirm={() => remove.mutate({ id: a.id })}
                    >
                      Remove
                    </ConfirmButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <EmptyState
            title="No role assignments"
            body="Choose a person, role and scope above."
          />
        )}
      </Panel>
    </div>
  );
}
