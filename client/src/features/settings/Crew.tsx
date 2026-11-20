import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RecordDrawer, ConfirmButton } from "@/components/brand/Controls";
import { Panel, Loading, ErrorState, EmptyState } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { trpc } from "@/lib/trpc";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { errMsg, fmtMoney } from "@/lib/format";
import { DraftFields, SaveBar, text, nullableText, nullableNumber, flag, toDraft, type Draft, type EditorField } from "@/features/admin/Editor";

type CrewMember = RouterOutputs["admin"]["users"]["list"][number];
const empty: Draft = { name: "", title: "", phone: "", jobRoleId: null, costRate: null, billRate: null, calendarId: null, isActive: true };

/** Crew roster: ironworkers, operators and others who appear on daily reports and assignments. None of them sign in. */
export default function Crew() {
  const q = trpc.admin.users.list.useQuery();
  const { ref, jobRoleName } = useRefData();
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<CrewMember | null | undefined>();
  const [draft, setDraft] = useState<Draft>(empty);
  const [search, setSearch] = useState("");
  const success = async () => {
    await Promise.all([utils.admin.users.list.invalidate(), utils.ref.all.invalidate()]);
    toast.success("Crew member saved");
    setSelected(undefined);
  };
  const create = trpc.admin.users.create.useMutation({ onSuccess: success, onError: e => toast.error(errMsg(e)) });
  const update = trpc.admin.users.update.useMutation({ onSuccess: success, onError: e => toast.error(errMsg(e)) });
  const open = (p: CrewMember | null) => {
    setSelected(p);
    setDraft(p ? { ...empty, ...toDraft(p) } : { ...empty });
  };
  const fields: EditorField[] = [
    { key: "name", label: "Name", required: true },
    {
      key: "jobRoleId",
      label: "Classification",
      type: "select",
      nullable: true,
      options: (ref?.jobRoles ?? []).map(r => ({ value: String(r.id), label: r.name })),
    },
    { key: "title", label: "Title / notes" },
    { key: "phone", label: "Phone" },
    { key: "costRate", label: "Cost rate / hr", type: "number", help: "Blank uses the classification rate." },
    { key: "billRate", label: "Bill rate / hr", type: "number", help: "Blank uses the classification rate." },
    {
      key: "calendarId",
      label: "Work calendar",
      type: "select",
      nullable: true,
      options: (ref?.calendars ?? []).map(c => ({ value: String(c.id), label: c.name })),
    },
    { key: "isActive", label: "Active", type: "check" },
  ];
  const save = () => {
    const input = {
      name: text(draft, "name").trim(),
      title: nullableText(draft, "title"),
      phone: nullableText(draft, "phone"),
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
    if (selected) update.mutate({ ...input, id: selected.id });
    else create.mutate(input);
  };
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const rows = (q.data ?? []).filter(p => `${p.name ?? ""} ${jobRoleName(p.jobRoleId)}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          className="max-w-sm bg-[var(--tp-paper)]"
          placeholder="Find by name or classification"
          aria-label="Find crew member"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Button size="sm" onClick={() => open(null)}>
          Add crew member
        </Button>
      </div>
      <p className="text-muted-foreground">
        Crew members appear on daily reports, assignments and hours. Labor cost uses the classification rate unless a
        personal rate is set. Deactivate to hide someone without losing job history.
      </p>
      <Panel title={`${rows.length} crew`}>
        <div className="overflow-x-auto">
          <table className="tp-table">
            <thead>
              <tr>
                {["Name", "Classification", "Phone", "Cost / hr", "Bill / hr", "Status"].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id} className="cursor-pointer" onClick={() => open(p)}>
                  <td>
                    <button className="text-left font-medium">{p.name ?? "Unnamed"}</button>
                  </td>
                  <td>{jobRoleName(p.jobRoleId)}</td>
                  <td>{p.phone ?? "—"}</td>
                  <td className="num">{p.costRate == null ? "Classification" : fmtMoney(p.costRate, { cents: true })}</td>
                  <td className="num">{p.billRate == null ? "Classification" : fmtMoney(p.billRate, { cents: true })}</td>
                  <td>
                    <Pill tone={p.isActive ? "green" : "gray"}>{p.isActive ? "Active" : "Inactive"}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <EmptyState title="No crew yet" body="Add the foremen, ironworkers and operators you put on jobs." />}
      </Panel>
      <RecordDrawer
        open={selected !== undefined}
        onOpenChange={v => {
          if (!v) setSelected(undefined);
        }}
        eyebrow="Crew"
        title={selected?.name ?? "Add crew member"}
        actions={
          selected &&
          selected.isActive && (
            <ConfirmButton
              title="Deactivate this crew member?"
              body="They drop out of pickers. Daily reports and recorded hours remain."
              destructive
              disabled={update.isPending}
              onConfirm={() => update.mutate({ id: selected.id, isActive: false })}
            >
              Deactivate
            </ConfirmButton>
          )
        }
        footer={<SaveBar pending={create.isPending || update.isPending} onSave={save} onCancel={() => setSelected(undefined)} />}
      >
        <DraftFields fields={fields} draft={draft} onChange={setDraft} />
      </RecordDrawer>
    </div>
  );
}
