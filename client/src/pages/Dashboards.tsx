import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Plus, LayoutDashboard, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useRefData } from "@/lib/ref";
import { errMsg, fmtDateTime } from "@/lib/format";
import {
  PageHeader,
  Panel,
  Field,
  Loading,
  ErrorState,
  EmptyState,
} from "@/components/ks/Layout";
import { ConfirmButton, RecordDrawer } from "@/components/ks/Controls";
import { Pill } from "@/components/ks/Status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export default function Dashboards() {
  const { isAdmin } = useRefData();
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const q = trpc.reports.dashboards.useQuery();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [search, setSearch] = useState("");
  const create = trpc.reports.saveDashboard.useMutation({
    onSuccess: async r => {
      await utils.reports.dashboards.invalidate();
      setOpen(false);
      toast.success("Dashboard created");
      navigate(`/dashboards/${r.id}`);
    },
    onError: e => toast.error(errMsg(e)),
  });
  const remove = trpc.reports.removeDashboard.useMutation({
    onSuccess: () => {
      void utils.reports.dashboards.invalidate();
      toast.success("Dashboard deleted");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const rows = (q.data ?? []).filter(b =>
    `${b.name} ${b.ownerName ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  return (
    <div>
      <PageHeader
        eyebrow="Reporting / control rooms"
        title="Dashboards"
        subtitle="Arrange up to 10 saved reports into a shared operational view."
        actions={
          <>
            <Link href="/reports">
              <Button size="sm" variant="outline">
                Report library
              </Button>
            </Link>
            <Button
              size="sm"
              onClick={() => {
                setName("");
                setShared(false);
                setOpen(true);
              }}
            >
              <Plus className="size-3.5" />
              New dashboard
            </Button>
          </>
        }
      />
      <div className="space-y-4 p-5">
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Find dashboard…"
          aria-label="Search dashboards"
          className="w-72 bg-[var(--ks-paper)]"
        />
        <Panel>
          {q.isLoading ? (
            <Loading />
          ) : q.error ? (
            <ErrorState error={q.error} />
          ) : !rows.length ? (
            <EmptyState
              icon={<LayoutDashboard className="size-6" />}
              title="No dashboards in this view"
              body="Create a dashboard, then add saved report widgets."
            />
          ) : (
            <div className="overflow-auto">
              <table className="ks-table">
                <thead>
                  <tr>
                    <th>Dashboard</th>
                    <th>Owner</th>
                    <th>Visibility</th>
                    <th className="text-right">Widgets</th>
                    <th>Updated</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(b => (
                    <tr key={b.id}>
                      <td>
                        <Link
                          href={`/dashboards/${b.id}`}
                          className="font-semibold hover:underline"
                        >
                          {b.name}
                        </Link>
                        {b.mine && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            Mine
                          </span>
                        )}
                      </td>
                      <td>{b.ownerName ?? "—"}</td>
                      <td>
                        <Pill>{b.isShared ? "Shared" : "Private"}</Pill>
                      </td>
                      <td className="right num">{b.widgets.length} / 10</td>
                      <td className="num text-xs">
                        {fmtDateTime(b.updatedAt)}
                      </td>
                      <td className="right">
                        <div className="flex justify-end gap-1">
                          <Link href={`/dashboards/${b.id}`}>
                            <Button size="sm" variant="outline">
                              Open
                            </Button>
                          </Link>
                          {(b.mine || isAdmin) && (
                            <ConfirmButton
                              title={`Delete ${b.name}?`}
                              body="Saved reports will not be deleted."
                              destructive
                              confirmLabel="Delete"
                              disabled={remove.isPending}
                              onConfirm={() => remove.mutate({ id: b.id })}
                            >
                              <Trash2 className="size-3.5" />
                            </ConfirmButton>
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
      </div>
      <RecordDrawer
        open={open}
        onOpenChange={setOpen}
        eyebrow="Dashboard / new"
        title="Create dashboard"
        width={480}
        footer={
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!name.trim() || create.isPending}
              onClick={() =>
                create.mutate({
                  name: name.trim(),
                  isShared: shared,
                  widgets: [],
                })
              }
            >
              {create.isPending ? "Creating…" : "Create dashboard"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={200}
              autoFocus
              className="bg-[var(--ks-paper)]"
            />
          </Field>
          <label className="flex items-center gap-2">
            <Checkbox checked={shared} onCheckedChange={v => setShared(!!v)} />
            Shared with other users
          </label>
          <p className="text-xs text-muted-foreground">
            Viewers see only the reports and job data their privileges allow.
          </p>
        </div>
      </RecordDrawer>
    </div>
  );
}
