import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateInput, NumberInput, SimpleSelect } from "@/components/ks/Controls";
import { Panel, Field, Loading, ErrorState } from "@/components/ks/Layout";
import { useRefData, type RefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { errMsg } from "@/lib/format";
export default function Settings() {
  const { ref } = useRefData();
  const auto = trpc.admin.settings.autoRoles.useQuery();
  const roles = trpc.admin.roles.list.useQuery();
  if (!ref || auto.isLoading || roles.isLoading) return <Loading />;
  if (auto.error || roles.error)
    return <ErrorState error={auto.error ?? roles.error} />;
  return (
    <SettingsForm
      initial={ref}
      auto={auto.data ?? { pm: "", assignee: "" }}
      roles={roles.data ?? []}
    />
  );
}
function SettingsForm({
  initial,
  auto,
  roles,
}: {
  initial: RefData;
  auto: { pm: string; assignee: string };
  roles: { key: string; name: string }[];
}) {
  const [org, setOrg] = useState(initial.org);
  const [types, setTypes] = useState(initial.projectTypes.join("\n"));
  const [autoRoles, setAuto] = useState(auto);
  const utils = trpc.useUtils();
  const save = trpc.admin.settings.update.useMutation({
    onSuccess: () => {
      void utils.ref.all.invalidate();
      void utils.time.week.invalidate();
      void utils.time.approvals.invalidate();
      toast.success("Organization settings saved");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const saveAuto = trpc.admin.settings.updateAutoRoles.useMutation({
    onSuccess: () => {
      void utils.admin.settings.autoRoles.invalidate();
      void utils.ref.all.invalidate();
      toast.success("Automatic roles saved");
    },
    onError: e => toast.error(errMsg(e)),
  });
  return (
    <div className="space-y-5">
      <Panel title="Organization" bodyClassName="p-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Organization name">
            <Input
              value={org.name}
              onChange={e => setOrg({ ...org, name: e.target.value })}
            />
          </Field>
          <Field label="Timezone (IANA)">
            <Input
              className="font-mono"
              value={org.timezone}
              onChange={e => setOrg({ ...org, timezone: e.target.value })}
              placeholder="America/Phoenix"
            />
          </Field>
          <Field label="Delivery lead work days (0–30)">
            <NumberInput
              min={0}
              step={1}
              value={org.deliveryLeadDays}
              onChange={v => setOrg({ ...org, deliveryLeadDays: v ?? 0 })}
            />
          </Field>
          <Field label="Currency">
            <Input
              className="font-mono"
              value={org.currency}
              onChange={e =>
                setOrg({ ...org, currency: e.target.value.toUpperCase() })
              }
            />
          </Field>
          <Field label="Time locked through">
            <DateInput
              value={org.timeLockedThrough ?? null}
              onChange={day =>
                setOrg({ ...org, timeLockedThrough: day || null })
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Time on or before this date is read-only. Invoicing remains
              available. Clear to unlock.
            </p>
          </Field>
          <Field label="Job types · one per line" className="sm:col-span-2">
            <Textarea
              rows={5}
              value={types}
              onChange={e => setTypes(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={
              save.isPending || !org.name.trim() || !org.timezone.trim()
            }
            onClick={() =>
              save.mutate({
                org,
                projectTypes: [
                  ...new Set(
                    types
                      .split("\n")
                      .map(t => t.trim())
                      .filter(Boolean)
                  ),
                ],
              })
            }
          >
            Save organization
          </Button>
        </div>
      </Panel>
      <Panel title="Automatic security roles" bodyClassName="p-4 space-y-4">
        <p className="text-muted-foreground">
          The job PM and task assignees automatically receive these roles on
          their jobs. Explicit denies and access-type caps still apply. None
          disables that automatic role.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Job project manager">
            <SimpleSelect
              allowNone
              value={autoRoles.pm || null}
              options={roles.map(r => ({ value: r.key, label: r.name }))}
              onChange={v => setAuto({ ...autoRoles, pm: v ?? "" })}
            />
          </Field>
          <Field label="Task assignee">
            <SimpleSelect
              allowNone
              value={autoRoles.assignee || null}
              options={roles.map(r => ({ value: r.key, label: r.name }))}
              onChange={v => setAuto({ ...autoRoles, assignee: v ?? "" })}
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={saveAuto.isPending}
            onClick={() => saveAuto.mutate(autoRoles)}
          >
            Save automatic roles
          </Button>
        </div>
      </Panel>
    </div>
  );
}
