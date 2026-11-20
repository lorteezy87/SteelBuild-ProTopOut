import { useState } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/brand/Controls";
import { Panel, Loading, ErrorState } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { trpc } from "@/lib/trpc";
import { errMsg } from "@/lib/format";
export default function Demo() {
  const q = trpc.admin.demoStatus.useQuery();
  const utils = trpc.useUtils();
  const [result, setResult] = useState("");
  const demo = trpc.admin.loadDemo.useMutation({
    onSuccess: () => {
      void utils.invalidate();
      toast.success("Demo data loaded");
      setResult(
        "Demo data is ready. Open the portfolio to inspect the three Phoenix-area jobs."
      );
    },
    onError: e => toast.error(errMsg(e)),
  });
  const recompute = trpc.admin.recomputeAll.useMutation({
    onSuccess: r => {
      void utils.invalidate();
      toast.success(`Recomputed ${r.projects} jobs`);
      setResult(
        `Recomputed ${r.projects} jobs. Schedules, cost projections and health are current.`
      );
    },
    onError: e => toast.error(errMsg(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <div className="space-y-5">
      <Panel
        title="Demo data · explicit load only"
        actions={
          <Pill tone={q.data?.loaded ? "green" : "gray"}>
            {q.data?.loaded ? "Loaded" : "Not loaded"}
          </Pill>
        }
        bodyClassName="space-y-4 p-5"
      >
        <p className="font-semibold">
          Adds three Phoenix-area structural-steel erection jobs.
        </p>
        <p className="max-w-2xl text-muted-foreground">
          K-12 campus, university stairs & miscellaneous steel, and an
          industrial shade structure. Includes users, companies, erection
          sequences, workflow logs, fabricator deliveries and daily field
          reports. Fabrication is by others. This writes shared organization
          data; it is never automatic.
        </p>
        <ConfirmButton
          title="Load demo data?"
          body="This adds sample jobs and operational records to the organization. Do not use this in a live production portfolio."
          confirmLabel="Load demo data"
          disabled={q.data?.loaded || demo.isPending || recompute.isPending}
          onConfirm={() => demo.mutate()}
        >
          {demo.isPending ? "Loading demo…" : "Load demo data"}
        </ConfirmButton>
        {q.data?.loaded && (
          <p className="text-xs text-muted-foreground">
            Demo data was already loaded. The loader is one-time and will not
            duplicate jobs.
          </p>
        )}
      </Panel>
      <Panel title="Recompute all jobs" bodyClassName="space-y-4 p-5">
        <p className="max-w-2xl text-muted-foreground">
          Rebuild schedules, projections, financial actuals and job health for
          every job after changes to rates, calendars or configuration.
        </p>
        <ConfirmButton
          title="Recompute every job?"
          body="This recalculates every job in the portfolio and may take a moment."
          confirmLabel="Recompute all jobs"
          disabled={recompute.isPending || demo.isPending}
          onConfirm={() => recompute.mutate()}
        >
          {recompute.isPending ? "Recomputing…" : "Recompute all jobs"}
        </ConfirmButton>
      </Panel>
      {result && (
        <p
          className="border border-[var(--tp-rule)] bg-[var(--tp-paper)] p-4"
          role="status"
        >
          {result}
        </p>
      )}
    </div>
  );
}
