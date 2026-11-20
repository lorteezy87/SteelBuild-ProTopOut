import { EmptyState } from "@/components/brand/Layout";
import { LogsWorkspace } from "@/features/logs/LogsWorkspace";
import { useJob } from "./JobContext";

export default function Logs() {
  const { projectId, params, can } = useJob();
  if (!can("log.view"))
    return (
      <EmptyState
        title="Job logs restricted."
        body="You need log viewing privileges on this job."
      />
    );
  return (
    <LogsWorkspace
      projectId={projectId}
      appKey={params.a}
      itemId={params.b}
      canCreate={can("log.create")}
    />
  );
}
