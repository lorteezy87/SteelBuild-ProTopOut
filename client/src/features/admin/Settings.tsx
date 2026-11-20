import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateInput, NumberInput, SimpleSelect } from "@/components/brand/Controls";
import { Panel, Field, Loading } from "@/components/brand/Layout";
import { useRefData, type RefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { errMsg } from "@/lib/format";
export default function Settings() {
  const { ref } = useRefData();
  if (!ref) return <Loading />;
  return <SettingsForm initial={ref} />;
}
function SettingsForm({ initial }: { initial: RefData }) {
  const [org, setOrg] = useState(initial.org);
  const [types, setTypes] = useState(initial.projectTypes.join("\n"));
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
    </div>
  );
}
