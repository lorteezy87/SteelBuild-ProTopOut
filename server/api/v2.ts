import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import express, { type Request, type Response, type Router } from "express";
import { parseApiFilter, applyFilters, sortRows, type Filter } from "@shared/filters";
import { apiTokens, companies, dailyReports, users, wfApps, type User } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import { db } from "../db";
import { appRouter } from "../routers";
import { hashToken } from "../routers/integration";
import { effectivePrivileges } from "../security/access";
import { hasJobModuleAccess, loadSecurity } from "../security/guard";
import { ensureBootstrap } from "../bootstrap";
import { orgToday } from "../services/calendars";
import { loadMaskedRows } from "../services/reports";

type UserAccessType = Parameters<typeof hasJobModuleAccess>[0]["accessType"];

export const PAGE_SIZE = 250;
export const HOURLY_LIMIT = 600;

type Authed = { user: User; tokenId: number };

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function authenticate(req: Request, res: Response): Promise<Authed> {
  const header = req.header("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) throw new ApiError(401, "unauthorized", "Send Authorization: Bearer <token>");
  const d = await db();
  const [tok] = await d.select().from(apiTokens).where(eq(apiTokens.tokenHash, hashToken(m[1]))).limit(1);
  if (!tok) throw new ApiError(401, "unauthorized", "Invalid API token");
  const [user] = await d.select().from(users).where(eq(users.id, tok.userId)).limit(1);
  if (!user || !user.isActive || user.accessType === "passive") throw new ApiError(403, "forbidden", "Token owner is not active");

  // Fixed one-hour window per token.
  const now = new Date();
  const fresh = !tok.windowStart || now.getTime() - new Date(tok.windowStart).getTime() >= 3_600_000;
  const count = fresh ? 1 : tok.windowCount + 1;
  const windowStart = fresh ? now : new Date(tok.windowStart!);
  res.setHeader("X-SteelBuild-Api-Usage", `${Math.min(count, HOURLY_LIMIT)}/${HOURLY_LIMIT}`);
  if (count > HOURLY_LIMIT) {
    const reset = Math.ceil((windowStart.getTime() + 3_600_000 - now.getTime()) / 1000);
    res.setHeader("Retry-After", String(reset));
    throw new ApiError(429, "rate_limited", `Rate limit of ${HOURLY_LIMIT} calls per hour exceeded`);
  }
  await d.update(apiTokens).set({ windowStart, windowCount: count, lastUsedAt: now }).where(eq(apiTokens.id, tok.id));
  // Apply the same tier boundary to every REST method, including jobs writes.
  const moduleResources = ["jobs", "tasks", "timeEntries", "expenses", "deliveries", "dailyReports"];
  if (moduleResources.includes(req.params.entity) && !hasJobModuleAccess({ isAdmin: user.role === "admin", accessType: user.accessType as UserAccessType })) {
    throw new ApiError(403, "forbidden", "Your access type only includes Logs and Timesheets");
  }
  return { user, tokenId: tok.id };
}

function ctxFor(req: Request, res: Response, user: User): TrpcContext {
  return { req, res, user, quiet: String(req.query.notifications ?? "").toLowerCase() === "false" } as TrpcContext;
}

function strip(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!k.startsWith("_")) out[k] = v;
  return out;
}

function pickFields(row: Record<string, unknown>, fields: string[] | null) {
  if (!fields) return row;
  const out: Record<string, unknown> = { id: row.id };
  for (const f of fields) if (f in row) out[f] = row[f];
  return out;
}

function parseSort(v: unknown): { field: string; dir: "asc" | "desc" }[] {
  if (typeof v !== "string" || !v.trim()) return [];
  // "a,b/desc" → sort by a then b, descending
  const [list, dir] = v.split("/");
  return list
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(field => ({ field, dir: dir?.toLowerCase() === "desc" ? "desc" : "asc" }));
}

function parseFilter(v: unknown): Filter[] {
  if (v == null || v === "") return [];
  try {
    return parseApiFilter(JSON.parse(String(v)));
  } catch {
    throw new ApiError(400, "bad_filter", "filter must be a JSON object, e.g. {\"state\":\"active\"}");
  }
}

const SOURCE_FOR: Record<string, "jobs" | "tasks" | "time" | "expenses" | "logs" | "deliveries"> = {
  jobs: "jobs",
  tasks: "tasks",
  timeEntries: "time",
  expenses: "expenses",
  logItems: "logs",
  deliveries: "deliveries",
};

async function listRows(entity: string, req: Request, a: Authed): Promise<Record<string, unknown>[]> {
  const today = await orgToday();
  const s = await loadSecurity(a.user);
  if (SOURCE_FOR[entity]) {
    if (entity === "logItems") {
      const d = await db();
      const appKey = typeof req.query.app === "string" ? req.query.app : null;
      const apps = appKey ? await d.select().from(wfApps).where(eq(wfApps.key, appKey)) : await d.select().from(wfApps);
      if (appKey && !apps.length) throw new ApiError(404, "not_found", `Unknown log type '${appKey}'`);
      const out: Record<string, unknown>[] = [];
      for (const app of apps) {
        const rows = await loadMaskedRows(s, "logs", app.key, today);
        for (const r of rows) out.push({ ...r, app: app.key });
      }
      return out.map(r => ({ ...r }));
    }
    return loadMaskedRows(s, SOURCE_FOR[entity], undefined, today);
  }
  const d = await db();
  if (entity === "users") {
    if (a.user.accessType !== "full" && a.user.role !== "admin") throw new ApiError(403, "forbidden", "Full access required");
    const rows = await d.select().from(users);
    const admin = a.user.role === "admin";
    return rows.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      title: u.title,
      accessType: u.accessType,
      isAdmin: u.role === "admin",
      jobRoleId: u.jobRoleId,
      supervisorId: u.supervisorId,
      isActive: u.isActive,
      ...(admin ? { costRate: u.costRate, billRate: u.billRate } : {}),
    }));
  }
  if (entity === "companies") {
    const rows = await d.select().from(companies);
    return rows.map(c => ({ ...c }));
  }
  if (entity === "dailyReports") {
    const visible: number[] = [];
    s.projectWorkspace.forEach((_w, pid) => {
      if (effectivePrivileges(s, pid).has("project.view")) visible.push(pid);
    });
    if (!visible.length) return [];
    const rows = await d.select().from(dailyReports).where(inArray(dailyReports.projectId, visible));
    return rows.map(r => ({ ...r }));
  }
  throw new ApiError(404, "not_found", `Unknown resource '${entity}'`);
}

function send(res: Response, status: number, body: unknown) {
  res.status(status).json(body);
}

function handleError(res: Response, e: unknown) {
  if (e instanceof ApiError) return send(res, e.status, { error: { code: e.code, message: e.message } });
  if (e instanceof TRPCError) {
    const status = getHTTPStatusCodeFromError(e);
    let message = e.message;
    try {
      const parsed = JSON.parse(e.message);
      if (Array.isArray(parsed)) message = parsed.map((x: { path?: string[]; message?: string }) => `${(x.path ?? []).join(".")}: ${x.message}`).join("; ");
    } catch {
      /* plain message */
    }
    return send(res, status, { error: { code: e.code.toLowerCase(), message } });
  }
  console.error("[api] unexpected", e);
  return send(res, 500, { error: { code: "internal", message: "Unexpected server error" } });
}

const num = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, "bad_id", "id must be a positive integer");
  return n;
};

export function createApiV2Router(): Router {
  const r = express.Router();

  r.use(async (_req, _res, next) => {
    try {
      await ensureBootstrap();
      next();
    } catch (e) {
      next(e);
    }
  });

  r.get("/", (_req, res) =>
    send(res, 200, {
      name: "SteelBuild Pro API",
      version: 2,
      resources: ["jobs", "tasks", "timeEntries", "expenses", "logItems", "deliveries", "dailyReports", "users", "companies"],
    })
  );

  r.get("/:entity", async (req, res) => {
    try {
      const a = await authenticate(req, res);
      const today = await orgToday();
      let rows = (await listRows(req.params.entity, req, a)).map(row => row as Record<string, unknown>);
      rows = applyFilters(rows, parseFilter(req.query.filter), today);
      rows = sortRows(rows, parseSort(req.query.sort));
      const fields = typeof req.query.fields === "string" && req.query.fields.trim() ? req.query.fields.split(",").map(s => s.trim()) : null;
      const page = Math.max(1, Number(req.query.page ?? 1) || 1);
      const total = rows.length;
      const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(x => pickFields(strip(x), fields));
      const hasNext = page * PAGE_SIZE < total;
      const base = `${req.baseUrl}/${req.params.entity}`;
      const qs = new URLSearchParams(Object.entries(req.query).filter(([k]) => k !== "page").map(([k, v]) => [k, String(v)]));
      qs.set("page", String(page + 1));
      send(res, 200, { data: slice, totalRecords: total, nextPage: hasNext ? `${base}?${qs.toString()}` : null });
    } catch (e) {
      handleError(res, e);
    }
  });

  r.get("/:entity/:id", async (req, res) => {
    try {
      const a = await authenticate(req, res);
      const id = num(req.params.id);
      const rows = await listRows(req.params.entity, req, a);
      const row = rows.find(x => x.id === id);
      if (!row) throw new ApiError(404, "not_found", "Record not found or not visible to you");
      const fields = typeof req.query.fields === "string" && req.query.fields.trim() ? req.query.fields.split(",").map(s => s.trim()) : null;
      send(res, 200, { data: pickFields(strip(row), fields) });
    } catch (e) {
      handleError(res, e);
    }
  });

  r.post("/:entity", async (req, res) => {
    try {
      const a = await authenticate(req, res);
      const caller = appRouter.createCaller(ctxFor(req, res, a.user));
      const body = (req.body ?? {}) as Record<string, unknown>;
      let out: { id: number } | unknown;
      switch (req.params.entity) {
        case "jobs":
          out = await caller.projects.create(body as never);
          break;
        case "tasks":
          out = await caller.tasks.create(body as never);
          break;
        case "logItems":
          out = await caller.wf.create(body as never);
          break;
        case "deliveries":
          out = await caller.deliveries.upsert({ ...(body as object), id: undefined } as never);
          break;
        default:
          throw new ApiError(405, "method_not_allowed", `POST is not supported on ${req.params.entity}`);
      }
      send(res, 201, { data: out });
    } catch (e) {
      handleError(res, e);
    }
  });

  r.patch("/:entity/:id", async (req, res) => {
    try {
      const a = await authenticate(req, res);
      const id = num(req.params.id);
      const caller = appRouter.createCaller(ctxFor(req, res, a.user));
      const body = { ...((req.body ?? {}) as Record<string, unknown>), id };
      let out: unknown;
      switch (req.params.entity) {
        case "jobs":
          out = await caller.projects.update(body as never);
          break;
        case "tasks":
          out = await caller.tasks.update(body as never);
          break;
        case "logItems":
          out = await caller.wf.update(body as never);
          break;
        case "deliveries": {
          const d = await db();
          const existing = await caller.deliveries.list({ projectId: Number((req.body ?? {}).projectId ?? 0) || (await deliveryProject(d, id)) });
          const cur = (existing as { id: number }[]).find(x => x.id === id);
          if (!cur) throw new ApiError(404, "not_found", "Delivery not found");
          out = await caller.deliveries.upsert({ ...cur, ...body } as never);
          break;
        }
        default:
          throw new ApiError(405, "method_not_allowed", `PATCH is not supported on ${req.params.entity}`);
      }
      send(res, 200, { data: out });
    } catch (e) {
      handleError(res, e);
    }
  });

  r.delete("/:entity/:id", async (req, res) => {
    try {
      const a = await authenticate(req, res);
      const id = num(req.params.id);
      const caller = appRouter.createCaller(ctxFor(req, res, a.user));
      switch (req.params.entity) {
        case "tasks":
          await caller.tasks.delete({ id });
          break;
        case "logItems":
          await caller.wf.remove({ id });
          break;
        case "deliveries":
          await caller.deliveries.remove({ id });
          break;
        default:
          throw new ApiError(405, "method_not_allowed", `DELETE is not supported on ${req.params.entity}`);
      }
      send(res, 200, { data: { id, deleted: true } });
    } catch (e) {
      handleError(res, e);
    }
  });

  return r;
}

async function deliveryProject(d: Awaited<ReturnType<typeof db>>, id: number): Promise<number> {
  const { deliveries } = await import("../../drizzle/schema");
  const [row] = await d.select({ projectId: deliveries.projectId }).from(deliveries).where(and(eq(deliveries.id, id))).limit(1);
  if (!row) throw new ApiError(404, "not_found", "Delivery not found");
  return row.projectId;
}
