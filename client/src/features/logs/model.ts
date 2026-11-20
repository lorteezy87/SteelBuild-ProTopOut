import type { BallInCourt } from "@shared/ballInCourt";
import { trpc } from "@/lib/trpc";
import type { RouterOutputs } from "@/lib/ref";

export type LogItem = RouterOutputs["wf"]["list"]["items"][number];
export type LogDetail = RouterOutputs["wf"]["get"];
export type LogDraft = {
  title: string;
  description: string | null;
  priority: string;
  assigneeId: number | null;
  responsibleParty: string | null;
  ballInCourt: BallInCourt;
  dueDate: string | null;
  linkedTaskId: number | null;
  linkedDeliveryId: number | null;
  customFields: Record<string, unknown>;
};
export function newLogDraft(): LogDraft {
  return {
    title: "",
    description: null,
    priority: "normal",
    assigneeId: null,
    responsibleParty: "erector",
    ballInCourt: "us",
    dueDate: null,
    linkedTaskId: null,
    linkedDeliveryId: null,
    customFields: {},
  };
}
export function useLogsInvalidate() {
  const utils = trpc.useUtils();
  return async (projectId?: number | null) => {
    await Promise.all([
      utils.wf.list.invalidate(),
      utils.wf.get.invalidate(),
      utils.wf.summary.invalidate(),
      utils.dashboard.portfolio.invalidate(),
      utils.projects.list.invalidate(),
      ...(projectId
        ? [
            utils.projects.get.invalidate({ id: projectId }),
            utils.financials.summary.invalidate({ projectId }),
          ]
        : []),
    ]);
  };
}
