import { LogsWorkspace } from "@/features/logs/LogsWorkspace";

export default function LogsIndex({
  params = {},
}: {
  params?: { appKey?: string; itemId?: string };
}) {
  return <LogsWorkspace appKey={params.appKey} itemId={params.itemId} />;
}
