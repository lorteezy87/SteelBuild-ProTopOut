import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ConfirmButton,
  RecordDrawer,
  SimpleSelect,
  UserSelect,
} from "@/components/brand/Controls";
import {
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Panel,
} from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { errMsg } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { useJob } from "./JobContext";

export default function Team() {
  const { projectId, can, refetch } = useJob();
  const { userName, user, jobRoleName } = useRefData();
  const utils = trpc.useUtils();
  const q = trpc.projects.team.useQuery({ projectId });
  const roles = trpc.admin.roles.list.useQuery(undefined, {
    enabled: can("project.manage_team"),
  });
  const [adding, setAdding] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const changed = async () => {
    await utils.projects.team.invalidate({ projectId });
    await utils.projects.get.invalidate({ id: projectId });
    refetch();
  };
  const add = trpc.projects.addTeam.useMutation({
    onSuccess: () => {
      void changed();
      toast.success("Job role assigned.");
      setAdding(false);
      setUserId(null);
      setRoleId(null);
    },
    onError: e => toast.error(errMsg(e)),
  });
  const remove = trpc.projects.removeTeam.useMutation({
    onSuccess: () => {
      void changed();
      toast.success("Role removed.");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const people = new Set<number>();
  if (q.data?.managerId) people.add(q.data.managerId);
  for (const a of q.data?.assignments ?? []) people.add(a.userId);
  for (const a of q.data?.assignees ?? []) if (a.userId) people.add(a.userId);
  return (
    <div className="p-5">
      <Panel
        title="Job team"
        actions={
          can("project.manage_team") && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" />
              Assign job role
            </Button>
          )
        }
      >
        <div className="border-b border-[var(--tp-rule)] px-4 py-3 text-[12px] text-muted-foreground">
          Security roles below apply to this job. Project Manager and Assignee
          access is automatic; workspace and global roles remain in effect. Deny
          wins.
        </div>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : !people.size ? (
          <EmptyState
            title="No job team"
            body="Assign a project manager, task resources or a job security role."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Craft / job role</th>
                  <th>Automatic job access</th>
                  <th>Job security roles</th>
                </tr>
              </thead>
              <tbody>
                {[...people].map(id => (
                  <tr key={id}>
                    <td className="font-semibold">
                      {userName(id)}
                      <div className="text-[11px] font-normal text-muted-foreground">
                        {user(id)?.email}
                      </div>
                    </td>
                    <td>{jobRoleName(user(id)?.jobRoleId)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {q.data?.managerId === id && (
                          <Pill tone="orange">Project Manager</Pill>
                        )}
                        {q.data?.assignees.some(a => a.userId === id) && (
                          <Pill tone="blue">Task Assignee</Pill>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        {q.data?.assignments
                          .filter(a => a.userId === id)
                          .map(a => (
                            <div key={a.id} className="flex items-center gap-1">
                              <Pill>{a.roleName}</Pill>
                              {can("project.manage_team") && (
                                <ConfirmButton
                                  size="icon"
                                  variant="ghost"
                                  destructive
                                  title={`Remove ${a.roleName} from ${userName(id)}?`}
                                  body="Only this job-scoped role is removed. Automatic and inherited access remains."
                                  onConfirm={() =>
                                    remove.mutate({
                                      projectId,
                                      assignmentId: a.id,
                                    })
                                  }
                                  disabled={remove.isPending}
                                >
                                  <Trash2 className="size-3.5" />
                                </ConfirmButton>
                              )}
                            </div>
                          ))}
                        {!q.data?.assignments.some(a => a.userId === id) && (
                          <span className="text-muted-foreground">
                            Automatic / inherited only
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {adding && (
        <RecordDrawer
          open
          onOpenChange={o => !o && setAdding(false)}
          title="Assign job security role"
          eyebrow="Job team"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button
                disabled={!userId || !roleId || add.isPending}
                onClick={() =>
                  userId &&
                  roleId &&
                  add.mutate({ projectId, userId, roleId: Number(roleId) })
                }
              >
                Assign role
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <Field label="Person">
              <UserSelect value={userId} onChange={setUserId} includePassive />
            </Field>
            <Field label="Security role">
              <SimpleSelect
                value={roleId}
                onChange={setRoleId}
                options={(roles.data ?? []).map(r => ({
                  value: String(r.id),
                  label: r.name,
                }))}
              />
            </Field>
            {roles.error && <ErrorState error={roles.error} />}
            <p className="text-[12px] text-muted-foreground">
              Craft / job role comes from the person's resource record. This
              assignment controls permissions on this job only.
            </p>
          </div>
        </RecordDrawer>
      )}
    </div>
  );
}
