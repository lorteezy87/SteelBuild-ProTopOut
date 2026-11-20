import type { RouterOutputs } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSearch } from "wouter";

export type JobData = RouterOutputs["projects"]["get"];

export type JobParams = {
  /** Job (project) id */
  id: number;
  /** Tab key: overview | schedule | tasks | board | deliveries | daily | logs | drawings | model | financials | documents | baselines | team | activity */
  tab: string;
  /** First sub-segment, e.g. daily report id or log app key */
  a?: string;
  /** Second sub-segment, e.g. log item id */
  b?: string;
};

type Ctx = {
  projectId: number;
  params: JobParams;
  data: JobData;
  /** Effective privileges on this job (deny-wins already applied server-side). */
  can: (priv: string) => boolean;
  refetch: () => void;
};

const JobCtx = createContext<Ctx | null>(null);

export function JobProvider({ params, data, refetch, children }: { params: JobParams; data: JobData; refetch: () => void; children: ReactNode }) {
  const value = useMemo<Ctx>(() => {
    const privs = new Set(data.privileges as string[]);
    return { projectId: params.id, params, data, can: p => privs.has(p), refetch };
  }, [params, data, refetch]);
  return <JobCtx.Provider value={value}>{children}</JobCtx.Provider>;
}

/** Access the current job inside /jobs/:id/* pages. */
export function useJob(): Ctx {
  const v = useContext(JobCtx);
  if (!v) throw new Error("useJob must be used inside a job page");
  return v;
}

/** Invalidate everything that depends on a job's schedule/health after a mutation. */
export function useJobInvalidate() {
  const utils = trpc.useUtils();
  return (projectId: number) =>
    Promise.all([
      utils.projects.get.invalidate({ id: projectId }),
      utils.projects.list.invalidate(),
      utils.tasks.list.invalidate({ projectId }),
      utils.dashboard.portfolio.invalidate(),
    ]);
}

/** Read and subscribe to a query-string parameter, including query-only navigation. */
export function useSearchParam(name: string): string | null {
  const search = useSearch();
  return new URLSearchParams(search).get(name);
}
