import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { useMemo } from "react";

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RefData = RouterOutputs["ref"]["all"];

/**
 * Reference data for pickers and labels (users, companies, codes, apps, org…).
 * Cached for 60 s; invalidate with utils.ref.all.invalidate() after admin edits.
 */
export function useRefData() {
  const q = trpc.ref.all.useQuery(undefined, { staleTime: 60_000, refetchOnWindowFocus: false });
  const helpers = useMemo(() => {
    const d = q.data;
    const userMap = new Map((d?.users ?? []).map(u => [u.id, u]));
    const companyMap = new Map((d?.companies ?? []).map(c => [c.id, c]));
    const appMap = new Map((d?.apps ?? []).map(a => [a.key, a]));
    const appById = new Map((d?.apps ?? []).map(a => [a.id, a]));
    const roleMap = new Map((d?.jobRoles ?? []).map(r => [r.id, r]));
    const equipMap = new Map((d?.equipment ?? []).map(e => [e.id, e]));
    return {
      userName: (id: number | null | undefined) => (id ? userMap.get(id)?.name ?? `User ${id}` : "—"),
      user: (id: number | null | undefined) => (id ? userMap.get(id) : undefined),
      companyName: (id: number | null | undefined) => (id ? companyMap.get(id)?.name ?? "—" : "—"),
      company: (id: number | null | undefined) => (id ? companyMap.get(id) : undefined),
      app: (key: string) => appMap.get(key),
      appById: (id: number) => appById.get(id),
      jobRoleName: (id: number | null | undefined) => (id ? roleMap.get(id)?.name ?? "—" : "—"),
      equipmentName: (id: number | null | undefined) => (id ? equipMap.get(id)?.name ?? "—" : "—"),
      canGlobal: (p: string) => !!d && (d.me.isAdmin || d.me.globalPrivs.includes(p as never)),
      isAdmin: !!d?.me.isAdmin,
      today: d?.today ?? new Date().toISOString().slice(0, 10),
    };
  }, [q.data]);
  return { ...q, ref: q.data, ...helpers };
}
