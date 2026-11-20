import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RecordDrawer, ConfirmButton } from "@/components/brand/Controls";
import { Panel, Loading, ErrorState, EmptyState } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { ACCESS_TYPES } from "@shared/domain";
import { trpc } from "@/lib/trpc";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { errMsg, fmtMoney } from "@/lib/format";
import {
  DraftFields,
  SaveBar,
  text,
  nullableText,
  nullableNumber,
  flag,
  toDraft,
  type Draft,
  type EditorField,
} from "./Editor";
type Person = RouterOutputs["admin"]["users"]["list"][number];
const empty: Draft = {
  name: "",
  email: "",
  accessType: "team_member",
  isAdmin: false,
  title: "",
  phone: "",
  supervisorId: null,
  jobRoleId: null,
  costRate: null,
  billRate: null,
  calendarId: null,
  isActive: true,
};
export default function Users() {
  const q = trpc.admin.users.list.useQuery();
  const { ref, userName, jobRoleName } = useRefData();
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<Person | null | undefined>();
  const [draft, setDraft] = useState<Draft>(empty);
  const [search, setSearch] = useState("");
  const success = async () => {
    await Promise.all([
      utils.admin.users.list.invalidate(),
      utils.ref.all.invalidate(),
    ]);
    toast.success("Person saved");
    setSelected(undefined);
  };
  const create = trpc.admin.users.create.useMutation({
    onSuccess: success,
    onError: e => toast.error(errMsg(e)),
  });
  const update = trpc.admin.users.update.useMutation({
    onSuccess: success,
    onError: e => toast.error(errMsg(e)),
  });
  const open = (p: Person | null) => {
    setSelected(p);
    setDraft(
      p
        ? { ...empty, ...toDraft(p), isAdmin: p.role === "admin" }
        : { ...empty }
    );
  };
  const fields: EditorField[] = [
    { key: "name", label: "Name", required: true },
    {
      key: "email",
      label: "Email",
      type: "email",
      help: "Pre-registered people link to this record by email on first login. Passive people cannot sign in.",
    },
    {
      key: "accessType",
      label: "Access type",
      type: "select",
      options: ACCESS_TYPES,
    },
    { key: "isAdmin", label: "Organization admin", type: "check" },
    { key: "title", label: "Title" },
    { key: "phone", label: "Phone" },
    {
      key: "jobRoleId",
      label: "Job role",
      type: "select",
      nullable: true,
      options: (ref?.jobRoles ?? []).map(r => ({
        value: String(r.id),
        label: r.name,
      })),
    },
    {
      key: "supervisorId",
      label: "Supervisor",
      type: "select",
      nullable: true,
      options: (ref?.users ?? [])
        .filter(u => u.id !== selected?.id)
        .map(u => ({ value: String(u.id), label: u.name ?? `User ${u.id}` })),
    },
    {
      key: "costRate",
      label: "Cost rate / hr",
      type: "number",
      help: "Blank inherits the job-role rate.",
    },
    {
      key: "billRate",
      label: "Bill rate / hr",
      type: "number",
      help: "Blank inherits the job-role rate.",
    },
    {
      key: "calendarId",
      label: "Work calendar",
      type: "select",
      nullable: true,
      options: (ref?.calendars ?? []).map(c => ({
        value: String(c.id),
        label: c.name,
      })),
    },
    { key: "isActive", label: "Active", type: "check" },
  ];
  const save = () => {
    const input = {
      name: text(draft, "name").trim(),
      email: nullableText(draft, "email"),
      accessType: text(draft, "accessType"),
      isAdmin: flag(draft, "isAdmin"),
      title: nullableText(draft, "title"),
      phone: nullableText(draft, "phone"),
      supervisorId: nullableNumber(draft, "supervisorId"),
      jobRoleId: nullableNumber(draft, "jobRoleId"),
      costRate: nullableNumber(draft, "costRate"),
      billRate: nullableNumber(draft, "billRate"),
      calendarId: nullableNumber(draft, "calendarId"),
      isActive: flag(draft, "isActive"),
    };
    if (!input.name) {
      toast.error("Enter a name");
      return;
    }
    if (!selected && !input.email && input.accessType !== "passive") {
      toast.error("Enter an email for pre-registration");
      return;
    }
    if (selected) update.mutate({ ...input, id: selected.id });
    else create.mutate(input);
  };
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const rows = (q.data ?? []).filter(p =>
    `${p.name} ${p.email}`.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          className="max-w-sm bg-[var(--tp-paper)]"
          placeholder="Find person by name or email"
          aria-label="Find person"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Button size="sm" onClick={() => open(null)}>
          Pre-register person
        </Button>
      </div>
      <p className="text-muted-foreground">
        Create a person before their first login to set access, rates and
        supervisor. Deactivate to stop sign-in without removing job history.
      </p>
      <Panel title={`${rows.length} people`}>
        <div className="overflow-x-auto">
          <table className="tp-table">
            <thead>
              <tr>
                {[
                  "Name",
                  "Email",
                  "Access",
                  "Admin",
                  "Job role",
                  "Supervisor",
                  "Cost / hr",
                  "Bill / hr",
                  "Status",
                ].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr
                  key={p.id}
                  className="cursor-pointer"
                  onClick={() => open(p)}
                >
                  <td>
                    <button className="font-medium text-left">
                      {p.name ?? "Unnamed"}
                    </button>
                    {p.pending && (
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        Pre-registered
                      </span>
                    )}
                  </td>
                  <td>{p.email ?? "—"}</td>
                  <td>
                    {ACCESS_TYPES[p.accessType as keyof typeof ACCESS_TYPES] ??
                      p.accessType}
                  </td>
                  <td>{p.role === "admin" ? "Yes" : "No"}</td>
                  <td>{jobRoleName(p.jobRoleId)}</td>
                  <td>{userName(p.supervisorId)}</td>
                  <td className="num">
                    {p.costRate == null
                      ? "Inherited"
                      : fmtMoney(p.costRate, { cents: true })}
                  </td>
                  <td className="num">
                    {p.billRate == null
                      ? "Inherited"
                      : fmtMoney(p.billRate, { cents: true })}
                  </td>
                  <td>
                    <Pill tone={p.isActive ? "green" : "gray"}>
                      {p.isActive ? "Active" : "Inactive"}
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <EmptyState
            title="No people found"
            body="Adjust the search or pre-register a person."
          />
        )}
      </Panel>
      <RecordDrawer
        open={selected !== undefined}
        onOpenChange={v => {
          if (!v) setSelected(undefined);
        }}
        eyebrow="People & access"
        title={selected?.name ?? "Pre-register person"}
        actions={
          selected &&
          selected.isActive && (
            <ConfirmButton
              title="Deactivate this person?"
              body="Sign-in will stop. Job records and recorded time remain."
              destructive
              disabled={selected.id === ref?.me.id || update.isPending}
              onConfirm={() =>
                update.mutate({ id: selected.id, isActive: false })
              }
            >
              Deactivate
            </ConfirmButton>
          )
        }
        footer={
          <SaveBar
            pending={create.isPending || update.isPending}
            onSave={save}
            onCancel={() => setSelected(undefined)}
          />
        }
      >
        <DraftFields fields={fields} draft={draft} onChange={setDraft} />
      </RecordDrawer>
    </div>
  );
}
