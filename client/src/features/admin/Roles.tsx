import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  RecordDrawer,
  ConfirmButton,
  SimpleSelect,
} from "@/components/ks/Controls";
import { Field, Panel, Loading, ErrorState } from "@/components/ks/Layout";
import {
  PROJECT_PRIVILEGES,
  GLOBAL_PRIVILEGES,
  ACCESS_TYPES,
  ACCESS_TYPE_CAPS,
} from "@shared/domain";
import { trpc } from "@/lib/trpc";
import type { RouterOutputs } from "@/lib/ref";
import { errMsg } from "@/lib/format";
import { SaveBar } from "./Editor";
type Role = RouterOutputs["admin"]["roles"]["list"][number];
export default function Roles() {
  const q = trpc.admin.roles.list.useQuery();
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<Role | null | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const success = async () => {
    await Promise.all([
      utils.admin.roles.list.invalidate(),
      utils.ref.all.invalidate(),
    ]);
  };
  const save = trpc.admin.roles.upsert.useMutation({
    onSuccess: success,
    onError: e => toast.error(errMsg(e)),
  });
  const remove = trpc.admin.roles.remove.useMutation({
    onSuccess: () => {
      setSelected(undefined);
      void success();
      toast.success("Role removed");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const open = (r: Role | null) => {
    setSelected(r);
    setName(r?.name ?? "");
    setDescription(r?.description ?? "");
  };
  const edit = (r: Role, p: string, effect: string | null) =>
    save.mutate({
      id: r.id,
      name: r.name,
      description: r.description,
      grants: [
        ...r.grants.filter(x => x !== p),
        ...(effect === "grant" ? [p] : []),
      ],
      denies: [
        ...r.denies.filter(x => x !== p),
        ...(effect === "deny" ? [p] : []),
      ],
    });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const roles = q.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-4">
        <p className="max-w-2xl text-muted-foreground">
          Roles combine across global, workspace and job assignments.{" "}
          <strong className="text-foreground">Deny wins</strong> over every
          grant. View job is required for project privileges. Admins bypass the
          matrix.
        </p>
        <Button size="sm" onClick={() => open(null)}>
          New role
        </Button>
      </div>
      <Panel title="Privilege matrix · changes save immediately">
        <div className="overflow-x-auto">
          <table className="ks-table">
            <thead>
              <tr>
                <th className="min-w-72">Privilege</th>
                {roles.map(r => (
                  <th key={r.id} className="min-w-36">
                    <button
                      className="text-left hover:text-[var(--ks-accent-ink)]"
                      onClick={() => open(r)}
                    >
                      {r.name}
                    </button>
                    {r.isSystem && (
                      <div className="text-[9px] font-normal">System role</div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries({
                Project: PROJECT_PRIVILEGES,
                Global: GLOBAL_PRIVILEGES,
              }).map(([group, privileges]) => (
                <RoleGroup
                  key={group}
                  group={group}
                  privileges={privileges}
                  roles={roles}
                  pending={save.isPending}
                  onEdit={edit}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <details className="ks-panel p-4">
        <summary className="cursor-pointer font-medium">
          Access-type caps limit what any role can give
        </summary>
        <p className="my-3 text-muted-foreground">
          Granting a privilege outside a person's access cap has no effect.
          Timesheet-only and Passive have no project/global grants; their
          own-entry behavior is separate. Admin access is an explicit bypass.
        </p>
        <table className="ks-table">
          <thead>
            <tr>
              <th>Access type</th>
              <th>Maximum privileges</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(ACCESS_TYPES).map(([key, label]) => {
              const cap = ACCESS_TYPE_CAPS[key as keyof typeof ACCESS_TYPES];
              return (
                <tr key={key}>
                  <td>{label}</td>
                  <td className="font-mono text-xs">
                    {cap === "all" ? "All" : cap.join(", ") || "None"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
      <RecordDrawer
        open={selected !== undefined}
        onOpenChange={v => {
          if (!v) setSelected(undefined);
        }}
        title={selected ? "Edit security role" : "New security role"}
        eyebrow="Security"
        actions={
          selected &&
          !selected.isSystem && (
            <ConfirmButton
              title="Delete role and its assignments?"
              destructive
              onConfirm={() => remove.mutate({ id: selected.id })}
            >
              Delete role
            </ConfirmButton>
          )
        }
        footer={
          <SaveBar
            pending={save.isPending}
            disabled={!name.trim()}
            onCancel={() => setSelected(undefined)}
            onSave={() =>
              save.mutate(
                {
                  id: selected?.id,
                  name,
                  description: description || null,
                  grants: selected?.grants ?? [],
                  denies: selected?.denies ?? [],
                },
                {
                  onSuccess: () => {
                    setSelected(undefined);
                    toast.success("Role saved");
                  },
                }
              )
            }
          />
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <Input value={name} onChange={e => setName(e.target.value)} />
          </Field>
          <Field label="Description">
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </Field>
          <p className="text-muted-foreground">
            Save the role, then set its grants and denies in the matrix. System
            roles can be renamed and edited, but not deleted.
          </p>
        </div>
      </RecordDrawer>
    </div>
  );
}
function RoleGroup({
  group,
  privileges,
  roles,
  pending,
  onEdit,
}: {
  group: string;
  privileges: Record<string, string>;
  roles: Role[];
  pending: boolean;
  onEdit: (r: Role, p: string, effect: string | null) => void;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={roles.length + 1}
          className="label-caps bg-[var(--ks-bone)]"
        >
          {group}
        </td>
      </tr>
      {Object.entries(privileges).map(([p, description]) => (
        <tr key={p}>
          <td>
            <div>{description}</div>
            <code className="text-[10px] text-muted-foreground">{p}</code>
          </td>
          {roles.map(r => (
            <td key={r.id}>
              <SimpleSelect
                size="sm"
                value={
                  r.denies.includes(p)
                    ? "deny"
                    : r.grants.includes(p)
                      ? "grant"
                      : "unset"
                }
                disabled={pending}
                onChange={v => onEdit(r, p, v)}
                options={{ unset: "— Not set —", grant: "Grant", deny: "Deny" }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
