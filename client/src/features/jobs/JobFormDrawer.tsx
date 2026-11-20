import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CompanySelect,
  DateInput,
  NumberInput,
  RecordDrawer,
  SimpleSelect,
  UserSelect,
} from "@/components/brand/Controls";
import { CfForm } from "@/components/brand/CustomFields";
import { Field } from "@/components/brand/Layout";
import { trpc } from "@/lib/trpc";
import { useRefData, type RouterOutputs } from "@/lib/ref";
import { errMsg } from "@/lib/format";
import {
  CONTRACT_TYPES,
  PRIORITIES,
  PROGRESS_METHODS,
  PROJECT_COMPANY_ROLES,
  PROJECT_STATES,
} from "@shared/domain";

type JobData = RouterOutputs["projects"]["get"];
type CompanyRole = keyof typeof PROJECT_COMPANY_ROLES;
type Draft = {
  code: string;
  name: string;
  description: string;
  projectType: string | null;
  state: string;
  priority: keyof typeof PRIORITIES;
  managerId: number | null;
  calendarId: number | null;
  startDate: string | null;
  deadline: string | null;
  contractType: string;
  contractValue: number;
  budget: number;
  totalTons: number;
  totalPieces: number;
  retainagePct: number;
  noticeHours: number;
  siteAddress: string;
  progressMethod: string;
};
function initial(data?: JobData): Draft {
  const p = data?.project;
  return {
    code: p?.code ?? "",
    name: p?.name ?? "",
    description: p?.description ?? "",
    projectType: p?.projectType ?? null,
    state: p?.state ?? "draft",
    priority: (p?.priority ?? "normal") as keyof typeof PRIORITIES,
    managerId: p?.managerId ?? null,
    calendarId: p?.calendarId ?? null,
    startDate: p?.startDate ?? null,
    deadline: p?.deadline ?? null,
    contractType: p?.contractType ?? "lump_sum",
    contractValue: p?.contractValue ?? 0,
    budget: p?.budget ?? 0,
    totalTons: p?.totalTons ?? 0,
    totalPieces: p?.totalPieces ?? 0,
    retainagePct: p?.retainagePct ?? 10,
    noticeHours: p?.noticeHours ?? 72,
    siteAddress: p?.siteAddress ?? "",
    progressMethod: p?.progressMethod ?? "tonnage",
  };
}
/** Mount only while open, so edits always start from the latest record. */
export function JobFormDrawer({
  data,
  onClose,
  onSaved,
}: {
  data?: JobData;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { ref } = useRefData();
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const [draft, setDraft] = useState<Draft>(() => initial(data));
  const [companies, setCompanies] = useState<
    Partial<Record<CompanyRole, number | null>>
  >(() =>
    Object.fromEntries((data?.companies ?? []).map(c => [c.role, c.companyId]))
  );
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(
    data?.customFields ?? {}
  );
  const [template, setTemplate] = useState("erection");
  const [sequenceCount, setSequenceCount] = useState(4);
  const [saving, setSaving] = useState(false);
  const defs = trpc.customFields.defs.useQuery({ entityType: "project" });
  const create = trpc.projects.create.useMutation();
  const update = trpc.projects.update.useMutation();
  const linksMutation = trpc.projects.setCompanies.useMutation();
  const canFinancials = !data || data.canFinancials;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft(d => ({ ...d, [key]: value }));
  const fieldDefs = [
    ...new Map(
      [...(defs.data ?? []), ...(data?.customFieldDefs ?? [])].map(def => [
        def.key,
        def,
      ])
    ).values(),
  ].filter(
    def =>
      (!def.projectType || def.projectType === draft.projectType) &&
      (canFinancials || !def.isFinancial)
  );
  async function save() {
    if (!draft.name.trim()) return toast.error("Enter a job name.");
    if (draft.startDate && draft.deadline && draft.deadline < draft.startDate)
      return toast.error("Deadline is before the start date.");
    setSaving(true);
    try {
      const { contractValue, budget, retainagePct, ...ordinary } = draft;
      const fields = {
        ...ordinary,
        name: draft.name.trim(),
        code: draft.code.trim() || null,
        description: draft.description || null,
        siteAddress: draft.siteAddress || null,
        customFields,
        ...(canFinancials ? { contractValue, budget, retainagePct } : {}),
      };
      const links = (
        Object.keys(PROJECT_COMPANY_ROLES) as CompanyRole[]
      ).flatMap(role =>
        companies[role] ? [{ role, companyId: companies[role]! }] : []
      );
      if (data) {
        await update.mutateAsync({ id: data.project.id, ...fields });
        await linksMutation.mutateAsync({ projectId: data.project.id, links });
        await Promise.all([
          utils.projects.get.invalidate({ id: data.project.id }),
          utils.tasks.list.invalidate({ projectId: data.project.id }),
        ]);
      } else {
        const result = await create.mutateAsync({
          ...fields,
          managerId: draft.managerId ?? ref?.me.id ?? null,
          companies: links,
          template: template as "erection" | "blank",
          sequenceCount,
        });
        navigate(`/jobs/${result.id}`);
      }
      await Promise.all([
        utils.projects.list.invalidate(),
        utils.dashboard.portfolio.invalidate(),
      ]);
      toast.success(data ? "Job updated." : "Job created.");
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <RecordDrawer
      open
      onOpenChange={o => !o && !saving && onClose()}
      eyebrow={data ? `Job ${data.project.code}` : "Portfolio / New job"}
      title={data ? "Edit job details" : "New erection job"}
      width={720}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            disabled={saving || !draft.name.trim()}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : data ? "Save changes" : "Create job"}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Job number">
            <Input
              value={draft.code}
              placeholder="Auto-number if blank"
              onChange={e => set("code", e.target.value)}
            />
          </Field>
          <Field label="Name *">
            <Input
              value={draft.name}
              onChange={e => set("name", e.target.value)}
            />
          </Field>
          <Field label="Job type">
            <SimpleSelect
              value={draft.projectType}
              onChange={v => set("projectType", v)}
              options={(ref?.projectTypes ?? []).map(t => ({
                value: t,
                label: t,
              }))}
              allowNone
            />
          </Field>
          <Field label="State">
            <SimpleSelect
              value={draft.state}
              onChange={v => v && set("state", v)}
              options={PROJECT_STATES}
            />
          </Field>
          <Field label="Priority">
            <SimpleSelect
              value={draft.priority}
              onChange={v => v && set("priority", v)}
              options={PRIORITIES}
            />
          </Field>
          <Field label="Project manager">
            <UserSelect
              value={draft.managerId ?? (!data ? ref?.me.id : null)}
              onChange={v => set("managerId", v)}
            />
          </Field>
          <Field label="Work calendar">
            <SimpleSelect
              value={draft.calendarId ? String(draft.calendarId) : null}
              onChange={v => set("calendarId", v ? Number(v) : null)}
              options={(ref?.calendars ?? []).map(c => ({
                value: String(c.id),
                label: c.name,
              }))}
              allowNone
              noneLabel="Default calendar"
            />
          </Field>
          <Field label="Start date">
            <DateInput
              value={draft.startDate}
              onChange={v => set("startDate", v)}
            />
          </Field>
          <Field label="Deadline">
            <DateInput
              value={draft.deadline}
              onChange={v => set("deadline", v)}
            />
          </Field>
          <Field label="Contract type">
            <SimpleSelect
              value={draft.contractType}
              onChange={v => v && set("contractType", v)}
              options={CONTRACT_TYPES}
            />
          </Field>
          {canFinancials && (
            <>
              <Field label="Contract value ($)">
                <NumberInput
                  min={0}
                  value={draft.contractValue}
                  onChange={v => set("contractValue", v ?? 0)}
                />
              </Field>
              <Field label="Cost budget ($)">
                <NumberInput
                  min={0}
                  value={draft.budget}
                  onChange={v => set("budget", v ?? 0)}
                />
              </Field>
              <Field label="Retainage (%)">
                <NumberInput
                  min={0}
                  value={draft.retainagePct}
                  onChange={v => set("retainagePct", v ?? 0)}
                />
              </Field>
            </>
          )}
          <Field label="Total planned tons">
            <NumberInput
              min={0}
              step="0.1"
              value={draft.totalTons}
              onChange={v => set("totalTons", v ?? 0)}
            />
          </Field>
          <Field label="Total planned pieces">
            <NumberInput
              min={0}
              step={1}
              value={draft.totalPieces}
              onChange={v => set("totalPieces", v ?? 0)}
            />
          </Field>
          <Field label="Progress method">
            <SimpleSelect
              value={draft.progressMethod}
              onChange={v => v && set("progressMethod", v)}
              options={PROGRESS_METHODS}
            />
          </Field>
          <Field label="Contract notice requirement (hours)">
            <NumberInput
              min={1}
              step={1}
              value={draft.noticeHours}
              onChange={v => set("noticeHours", v ?? 72)}
            />
          </Field>
          <Field label="Site address" className="sm:col-span-2">
            <Textarea
              value={draft.siteAddress}
              rows={2}
              onChange={e => set("siteAddress", e.target.value)}
            />
          </Field>
          <Field label="Scope / description" className="sm:col-span-2">
            <Textarea
              value={draft.description}
              rows={3}
              onChange={e => set("description", e.target.value)}
            />
          </Field>
        </div>
        <section>
          <h3 className="label-caps mb-3 border-b border-[var(--tp-rule)] pb-2">
            Job companies · fabrication by others
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(PROJECT_COMPANY_ROLES) as CompanyRole[]).map(role => (
              <Field key={role} label={PROJECT_COMPANY_ROLES[role]}>
                <CompanySelect
                  value={companies[role]}
                  type={role}
                  onChange={v => setCompanies(c => ({ ...c, [role]: v }))}
                />
              </Field>
            ))}
          </div>
        </section>
        {!data && (
          <section>
            <h3 className="label-caps mb-3 border-b border-[var(--tp-rule)] pb-2">
              Starter WBS
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Template">
                <SimpleSelect
                  value={template}
                  onChange={v => v && setTemplate(v)}
                  options={{
                    erection: "Steel erection — precon to demob",
                    blank: "Blank job",
                  }}
                />
              </Field>
              {template === "erection" && (
                <Field label="Erection sequences (1–40)">
                  <NumberInput
                    min={1}
                    step={1}
                    value={sequenceCount}
                    onChange={v => setSequenceCount(v ?? 4)}
                  />
                </Field>
              )}
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Pre-construction, mobilization, FS-linked erection sequences,
              punch, demob and turnover. Planned tons and pieces are split
              across sequences.
            </p>
          </section>
        )}
        {!!fieldDefs.length && (
          <section>
            <h3 className="label-caps mb-3 border-b border-[var(--tp-rule)] pb-2">
              Custom fields
            </h3>
            <CfForm
              defs={fieldDefs}
              values={customFields}
              onChange={setCustomFields}
            />
          </section>
        )}
      </div>
    </RecordDrawer>
  );
}
