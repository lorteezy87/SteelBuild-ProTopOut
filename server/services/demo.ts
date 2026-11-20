import { and, asc, eq, inArray } from "drizzle-orm";
import {
  companies,
  contacts,
  deliveries,
  equipment,
  expenseCodes,
  expenses,
  jobRoles,
  projectCompanies,
  projects,
  tasks,
  users,
  wfApps,
  wfItems,
  wfStates,
  dashboards,
  reports,
  type ReportConfig,
  type User,
} from "../../drizzle/schema";
import { createCallerFactory } from "../_core/trpc";
import type { TrpcContext } from "../_core/context";
import { db } from "../db";
import { getSetting, setSetting } from "../bootstrap";
import { addCalendarDays } from "../engine/calendar";
import { getCalendar, orgToday } from "./calendars";
import { recomputeProject } from "./recompute";
import { applyErectionTemplate } from "./templates";
import { createItem, refreshItem, transitionItem } from "./wf";

/**
 * Explicit admin action only — never runs automatically. Creates three
 * Phoenix-area erection jobs (fab by others) with sequences, deliveries,
 * approved daily reports, logs and a sample dashboard.
 */
export async function loadDemoData(userId: number) {
  if (await getSetting<boolean>("demo_loaded", false)) {
    return { ok: false as const, message: "Demo data is already loaded." };
  }
  const d = await db();
  const [admin] = await d.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!admin) throw new Error("User not found");
  const ctx = { req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], user: admin as User, quiet: true } as TrpcContext & { user: User };
  const today = await orgToday();
  const cal = await getCalendar(null);
  /** n work days after today (n >= 0) */
  const wd = (n: number) => cal.addWorkDays(cal.nextWorkDay(today), n);
  /** n work days before today */
  const workDaysBack = (n: number) => {
    let cur = today;
    let left = Math.abs(n);
    while (left > 0) {
      cur = addCalendarDays(cur, -1);
      if (cal.isWorkDay(cur)) left--;
    }
    return cur;
  };

  /* ---------------- Companies, contacts, equipment, crew ---------------- */
  const co = async (name: string, type: string, extra: Partial<typeof companies.$inferInsert> = {}) =>
    (await d.insert(companies).values({ name, type, ...extra }).$returningId())[0].id;
  const gc1 = await co("Desert Ridge Builders", "gc", { phone: "(602) 555-0141", address: "Phoenix, AZ" });
  const gc2 = await co("Camelback Construction Group", "gc", { phone: "(480) 555-0177", address: "Tempe, AZ" });
  const fab1 = await co("Valley Steel Fabricators", "fabricator", { phone: "(623) 555-0110", address: "Glendale, AZ" });
  const fab2 = await co("Canyon Iron Works", "fabricator", { phone: "(480) 555-0192", address: "Mesa, AZ" });
  const det = await co("Mesa Detailing Group", "detailer");
  const eor = await co("Copper State Structural Engineers", "eor");
  const arch = await co("Sonoran Studio Architects", "architect");
  const crane = await co("Saguaro Crane Rental", "crane_rental", { phone: "(602) 555-0123" });
  await d.insert(contacts).values([
    { companyId: gc1, name: "Karen Whitley", title: "Project Manager", email: "kwhitley@example.com", phone: "(602) 555-0142" },
    { companyId: gc1, name: "Bo Jennings", title: "Superintendent", email: "bjennings@example.com" },
    { companyId: gc2, name: "Priya Raman", title: "Senior PM", email: "praman@example.com" },
    { companyId: fab1, name: "Hector Ruiz", title: "Shipping Coordinator", email: "hruiz@example.com", phone: "(623) 555-0111" },
    { companyId: fab2, name: "Amy Locke", title: "Project Manager", email: "alocke@example.com" },
    { companyId: det, name: "Sam Tran", title: "Lead Detailer", email: "stran@example.com" },
  ]);
  const eq1 = (await d.insert(equipment).values({ name: "65-ton RT crane (Grove RT765E)", type: "crane", capacity: "65 ton", ownership: "rented", vendorCompanyId: crane, hourlyRate: 185, standbyRate: 95 }).$returningId())[0].id;
  const eq2 = (await d.insert(equipment).values({ name: "60' boom lift", type: "lift", capacity: "60 ft", ownership: "owned", hourlyRate: 35, standbyRate: 0 }).$returningId())[0].id;
  const eq3 = (await d.insert(equipment).values({ name: "Engine-drive welder #2", type: "welder", ownership: "owned", hourlyRate: 18, standbyRate: 0 }).$returningId())[0].id;
  const eq4 = (await d.insert(equipment).values({ name: "10K telehandler", type: "forklift", capacity: "10,000 lb", ownership: "rented", vendorCompanyId: crane, hourlyRate: 45, standbyRate: 20 }).$returningId())[0].id;

  const roles = await d.select().from(jobRoles);
  const roleId = (name: string) => roles.find(r => r.name === name)?.id ?? null;
  const person = async (name: string, role: string, title: string) =>
    (
      await d
        .insert(users)
        .values({ openId: `local:demo-${name.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}`, name, accessType: "passive", jobRoleId: roleId(role), title, loginMethod: null })
        .$returningId()
    )[0].id;
  const foreman = await person("Ray Delgado", "Foreman", "Foreman");
  const jw1 = await person("Luis Ortega", "Journeyman Ironworker", "Journeyman");
  const jw2 = await person("Marcus Hale", "Journeyman Ironworker", "Journeyman");
  const appr = await person("Tyler Briggs", "Apprentice", "Apprentice");
  const op = await person("Mike Salas", "Crane Operator", "Operator");
  const welder = await person("Dan Whitfield", "Welder", "Certified Welder");
  const foreman2 = await person("Jesse Navarro", "Foreman", "Foreman");
  const crewA = [foreman, jw1, jw2, appr, op, welder];
  const crewB = [foreman2, jw1, appr, welder];

  /* ---------------- Jobs ---------------- */
  const createJob = async (v: {
    code: string;
    name: string;
    projectType: string;
    start: string;
    deadline: string;
    contractValue: number;
    budget: number;
    totalTons: number;
    totalPieces: number;
    siteAddress: string;
    gc: number;
    fab: number;
    seqs: { name: string; location: string; days: number; tons: number; pieces: number }[];
    description: string;
  }) => {
    const [{ id }] = await d
      .insert(projects)
      .values({
        code: v.code,
        name: v.name,
        description: v.description,
        projectType: v.projectType,
        state: "active",
        priority: "normal",
        managerId: admin.id,
        startDate: v.start,
        deadline: v.deadline,
        contractType: "lump_sum",
        contractValue: v.contractValue,
        budget: v.budget,
        totalTons: v.totalTons,
        totalPieces: v.totalPieces,
        retainagePct: 10,
        noticeHours: 72,
        siteAddress: v.siteAddress,
        progressMethod: "tonnage",
        createdBy: admin.id,
      })
      .$returningId();
    await d.insert(projectCompanies).values([
      { projectId: id, companyId: v.gc, role: "gc" },
      { projectId: id, companyId: v.fab, role: "fabricator" },
      { projectId: id, companyId: det, role: "detailer" },
      { projectId: id, companyId: eor, role: "eor" },
      { projectId: id, companyId: arch, role: "architect" },
    ]);
    await applyErectionTemplate(id, { sequenceCount: v.seqs.length, totalTons: v.totalTons, totalPieces: v.totalPieces, userId: admin.id });
    const seqRows = await d
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, id), eq(tasks.kind, "sequence")))
      .orderBy(asc(tasks.sortOrder));
    for (let i = 0; i < seqRows.length; i++) {
      const s = v.seqs[i];
      await d
        .update(tasks)
        .set({ name: s.name, location: s.location, durationDays: s.days, plannedTons: s.tons, plannedPieces: s.pieces, effortHours: s.days * 6 * 8 })
        .where(eq(tasks.id, seqRows[i].id));
    }
    await recomputeProject(id);
    return { id, seqIds: seqRows.map(s => s.id) };
  };

  const j1 = await createJob({
    code: "26-101",
    name: "Mesquite Ridge Elementary — Classroom Wing",
    projectType: "K-12",
    description: "Two-story classroom wing, steel frame with moment frames at Grid 1 and 9. Fab by Valley Steel. Erector scope: structural steel, joists & deck by others.",
    start: workDaysBack(24),
    deadline: wd(40),
    contractValue: 418000,
    budget: 336000,
    totalTons: 310,
    totalPieces: 1450,
    siteAddress: "W. Mesquite Ridge Rd, Glendale, AZ",
    gc: gc1,
    fab: fab1,
    seqs: [
      { name: "Seq 1 — Grids 1–3 / L1–Roof", location: "Grids 1–3", days: 7, tons: 82, pieces: 380 },
      { name: "Seq 2 — Grids 3–6 / L1–Roof", location: "Grids 3–6", days: 7, tons: 88, pieces: 410 },
      { name: "Seq 3 — Grids 6–9 / L1–Roof", location: "Grids 6–9", days: 7, tons: 84, pieces: 390 },
      { name: "Seq 4 — Canopies & stair 1", location: "Canopy / Stair 1", days: 5, tons: 56, pieces: 270 },
    ],
  });
  const j2 = await createJob({
    code: "26-102",
    name: "ASU Polytechnic — Stair Towers & Misc. Steel",
    projectType: "University",
    description: "Two exterior egress stair towers plus misc. steel (lintels, ladders, rails). Fab by Canyon Iron Works.",
    start: workDaysBack(12),
    deadline: wd(30),
    contractValue: 196000,
    budget: 152000,
    totalTons: 96,
    totalPieces: 820,
    siteAddress: "Innovation Way, Mesa, AZ",
    gc: gc2,
    fab: fab2,
    seqs: [
      { name: "Stair Tower 1 (North)", location: "North tower", days: 8, tons: 38, pieces: 300 },
      { name: "Stair Tower 2 (South)", location: "South tower", days: 8, tons: 38, pieces: 300 },
      { name: "Misc. — lintels, ladders, rails", location: "Bldg perimeter", days: 6, tons: 20, pieces: 220 },
    ],
  });
  const j3 = await createJob({
    code: "26-103",
    name: "Goodyear Logistics Park — Shade Structures",
    projectType: "Shade Structure",
    description: "Cantilevered employee-parking shade structures, 3 rows. Columns on drilled piers (AB survey required).",
    start: wd(6),
    deadline: wd(32),
    contractValue: 98000,
    budget: 76000,
    totalTons: 64,
    totalPieces: 210,
    siteAddress: "S. Cotton Ln, Goodyear, AZ",
    gc: gc1,
    fab: fab1,
    seqs: [
      { name: "Row A — columns & cantilevers", location: "Row A", days: 4, tons: 22, pieces: 72 },
      { name: "Row B — columns & cantilevers", location: "Row B", days: 4, tons: 22, pieces: 72 },
      { name: "Row C — columns & cantilevers", location: "Row C", days: 4, tons: 20, pieces: 66 },
    ],
  });

  /* ---------------- Baselines (before progress) ---------------- */
  const { baselinesRouter } = await import("../routers/baselines");
  const bl = createCallerFactory(baselinesRouter)(ctx);
  for (const j of [j1, j2, j3]) await bl.create({ projectId: j.id, name: "Original Baseline", setActive: true });

  /* ---------------- Past work: pre-con done, sequences in progress ---------------- */
  const markPastDone = async (projectId: number) => {
    const rows = await d.select().from(tasks).where(eq(tasks.projectId, projectId));
    for (const t of rows) {
      if (t.isSummary || t.kind === "sequence" || !t.finishDate || t.finishDate >= today) continue;
      await d
        .update(tasks)
        .set({ status: "done", percentComplete: 100, actualStart: t.startDate, actualFinish: t.finishDate })
        .where(eq(tasks.id, t.id));
    }
  };
  await markPastDone(j1.id);
  await markPastDone(j2.id);
  await recomputeProject(j1.id);
  await recomputeProject(j2.id);

  /* ---------------- Daily reports (approved → time, equipment, progress) ---------------- */
  const { dailyReportsRouter } = await import("../routers/dailyReports");
  const dr = createCallerFactory(dailyReportsRouter)(ctx);
  const weather = ["Clear, 88°F", "Sunny, 94°F", "Clear, 101°F — heat plan in effect", "Partly cloudy, 86°F", "Wind gusts 25 mph AM"];
  const runReports = async (job: { id: number; seqIds: number[] }, crew: number[], fm: number, plan: { seqIdx: number; tons: number; pieces: number; standby?: number; note?: string }[], startBack: number) => {
    for (let i = 0; i < plan.length; i++) {
      const date = workDaysBack(startBack - i);
      if (date >= today) break;
      const p = plan[i];
      const seqId = job.seqIds[p.seqIdx];
      const standby = p.standby ?? 0;
      const { id } = await dr.save({
        projectId: job.id,
        reportDate: date,
        foremanId: fm,
        weather: weather[i % weather.length],
        temperature: null,
        workPerformed: p.tons > 0 ? `Set and bolted steel on ${p.note ?? "sequence"}. ${p.pieces} pcs set.` : "Crew on standby — see delay notes.",
        safetyNotes: "Morning tailgate held. 100% tie-off above 6'. Rigging inspected.",
        delayNotes: standby > 0 ? `Crane on standby ${standby} h waiting on material.` : null,
        crew: crew.map(u => ({ userId: u, taskId: seqId, stHours: 8, otHours: u === fm && i % 3 === 0 ? 1 : 0 })),
        equipment: [
          { equipmentId: eq1, operatingHours: Math.max(0, 8 - standby), standbyHours: standby },
          { equipmentId: eq2, operatingHours: 6, standbyHours: 0 },
          ...(i % 2 === 0 ? [{ equipmentId: eq3, operatingHours: 4, standbyHours: 0 }] : []),
        ],
        progress: p.tons > 0 ? [{ taskId: seqId, tons: p.tons, pieces: p.pieces, note: null }] : [],
      });
      await dr.finalize({ id });
    }
  };
  // Job 1: seq 1 done, seq 2 underway and a bit behind (late loads).
  await runReports(
    j1,
    crewA,
    foreman,
    [
      { seqIdx: 0, tons: 11, pieces: 52, note: "Seq 1 columns" },
      { seqIdx: 0, tons: 12.5, pieces: 58, note: "Seq 1 L2 beams" },
      { seqIdx: 0, tons: 12, pieces: 55, note: "Seq 1 L2 beams" },
      { seqIdx: 0, tons: 11.5, pieces: 54, note: "Seq 1 roof beams" },
      { seqIdx: 0, tons: 12, pieces: 56, note: "Seq 1 roof beams" },
      { seqIdx: 0, tons: 11, pieces: 53, note: "Seq 1 moment frame" },
      { seqIdx: 0, tons: 12, pieces: 52, note: "Seq 1 bracing" },
      { seqIdx: 1, tons: 8, pieces: 36, note: "Seq 2 columns" },
      { seqIdx: 1, tons: 0, pieces: 0, standby: 5 },
      { seqIdx: 1, tons: 7.5, pieces: 34, note: "Seq 2 L2 beams", standby: 2 },
    ],
    10
  );
  // Job 2: stair tower 1 underway.
  await runReports(
    j2,
    crewB,
    foreman2,
    [
      { seqIdx: 0, tons: 4.5, pieces: 34, note: "North tower columns" },
      { seqIdx: 0, tons: 5, pieces: 40, note: "North tower stringers" },
      { seqIdx: 0, tons: 4, pieces: 36, note: "North tower landings" },
    ],
    3
  );

  /* ---------------- Expenses (approved) ---------------- */
  const codes = await d.select().from(expenseCodes);
  const codeId = (name: string) => codes.find(c => c.name === name)?.id ?? null;
  const exp = (projectId: number, back: number, code: string, vendor: string, description: string, amount: number, billable = true) => ({
    projectId,
    userId: admin.id,
    expenseCodeId: codeId(code),
    expenseDate: workDaysBack(back),
    vendor,
    description,
    amount,
    billable,
    costable: true,
    state: "recorded",
    approvedBy: admin.id,
    approvedAt: new Date(),
  });
  await d.insert(expenses).values([
    exp(j1.id, 11, "Crane Rental", "Saguaro Crane Rental", "65T RT mobilization / demob (one way)", 4800),
    exp(j1.id, 10, "Bolts & Consumables", "Fastenal — Glendale", "A325 bolts, DTIs, drift pins", 1860),
    exp(j1.id, 6, "Welding Supplies", "Airgas — Phoenix", "E71T-8 wire, gas, grinding discs", 940),
    exp(j1.id, 5, "Fuel", "Pilot", "Crane & welder fuel", 612),
    exp(j1.id, 3, "Per Diem", "Crew", "Per diem — 6 men × 5 days", 1500, false),
    exp(j2.id, 3, "Equipment Rental", "Sunbelt Rentals", "Boom lift — 1 week", 1150),
    exp(j2.id, 2, "Bolts & Consumables", "Fastenal — Mesa", "Stair bolts & anchors", 480),
  ]);

  /* ---------------- Deliveries ---------------- */
  const seqTask = async (id: number) => (await d.select().from(tasks).where(eq(tasks.id, id)).limit(1))[0];
  const load = async (
    projectId: number,
    seqId: number,
    n: string,
    fab: number,
    opts: { promisedShift?: number; received?: "on_time" | "late" | "short"; tons: number; pieces: number; ticket?: string }
  ) => {
    const s = await seqTask(seqId);
    const pCal = await getCalendar(null);
    const need = s.startDate ? pCal.addWorkDays(s.startDate, -2) : today;
    const promised = addCalendarDays(need, opts.promisedShift ?? -1);
    let receivedDate: string | null = null;
    let status = "scheduled";
    let shippedDate: string | null = null;
    if (opts.received) {
      receivedDate = opts.received === "late" ? addCalendarDays(need, 2) : addCalendarDays(need, -1);
      if (receivedDate > today) receivedDate = today;
      shippedDate = addCalendarDays(receivedDate, -1);
      status = opts.received === "short" ? "received_short" : "received";
    }
    const [{ id }] = await d
      .insert(deliveries)
      .values({
        projectId,
        sequenceTaskId: seqId,
        loadNumber: n,
        description: `${s.name} — load ${n}`,
        fabricatorCompanyId: fab,
        needDate: need,
        promisedDate: promised,
        shippedDate,
        receivedDate,
        tons: opts.tons,
        pieces: opts.pieces,
        ticketNumber: opts.ticket ?? (opts.received ? `VS-${4400 + Number(n.replace(/\D/g, "") || 1)}` : null),
        status,
        shortageNotes: opts.received === "short" ? "6 pcs short: B-214, B-215, B-216 (beams) and 3 clip angles. Fabricator confirmed ship next truck." : null,
        createdBy: admin.id,
      })
      .$returningId();
    return id;
  };
  await load(j1.id, j1.seqIds[0], "1-1", fab1, { received: "on_time", tons: 28, pieces: 130 });
  await load(j1.id, j1.seqIds[0], "1-2", fab1, { received: "on_time", tons: 27, pieces: 125 });
  await load(j1.id, j1.seqIds[0], "1-3", fab1, { received: "on_time", tons: 27, pieces: 125 });
  await load(j1.id, j1.seqIds[1], "2-1", fab1, { received: "late", tons: 30, pieces: 140 });
  const shortLoad = await load(j1.id, j1.seqIds[1], "2-2", fab1, { received: "short", tons: 29, pieces: 135 });
  await load(j1.id, j1.seqIds[1], "2-3", fab1, { promisedShift: 1, tons: 29, pieces: 135 });
  await load(j1.id, j1.seqIds[2], "3-1", fab1, { promisedShift: 3, tons: 42, pieces: 195 });
  await load(j1.id, j1.seqIds[2], "3-2", fab1, { tons: 42, pieces: 195 });
  await load(j1.id, j1.seqIds[3], "4-1", fab1, { tons: 56, pieces: 270 });
  await load(j2.id, j2.seqIds[0], "N-1", fab2, { received: "on_time", tons: 19, pieces: 150, ticket: "CIW-2201" });
  await load(j2.id, j2.seqIds[0], "N-2", fab2, { received: "on_time", tons: 19, pieces: 150, ticket: "CIW-2207" });
  await load(j2.id, j2.seqIds[1], "S-1", fab2, { promisedShift: 2, tons: 38, pieces: 300 });
  await load(j2.id, j2.seqIds[2], "M-1", fab2, { tons: 20, pieces: 220 });
  await load(j3.id, j3.seqIds[0], "A-1", fab1, { tons: 22, pieces: 72 });
  await load(j3.id, j3.seqIds[1], "B-1", fab1, { tons: 22, pieces: 72 });
  await load(j3.id, j3.seqIds[2], "C-1", fab1, { promisedShift: 1, tons: 20, pieces: 66 });

  /* ---------------- Logs ---------------- */
  const apps = await d.select().from(wfApps);
  const appId = (key: string) => apps.find(a => a.key === key)!.id;
  const states = await d.select().from(wfStates).where(inArray(wfStates.appId, apps.map(a => a.id)));
  const stateId = (key: string, name: string) => states.find(s => s.appId === appId(key) && s.name === name)!.id;
  const backdate = async (id: number, daysAgo: number) => {
    const t = new Date(Date.now() - daysAgo * 86_400_000);
    await d.update(wfItems).set({ createdAt: t, stateEnteredAt: t }).where(eq(wfItems.id, id));
  };
  const log = async (
    key: string,
    projectId: number | null,
    title: string,
    o: { fields?: Record<string, unknown>; daysAgo?: number; moveTo?: string[]; due?: string | null; party?: string; priority?: string; desc?: string; taskId?: number; deliveryId?: number }
  ) => {
    const { id } = await createItem(ctx, {
      appId: appId(key),
      projectId,
      title,
      description: o.desc ?? null,
      priority: o.priority ?? "normal",
      assigneeId: admin.id,
      responsibleParty: o.party ?? null,
      dueDate: o.due ?? null,
      linkedTaskId: o.taskId ?? null,
      linkedDeliveryId: o.deliveryId ?? null,
      customFields: o.fields,
      canFinancial: true,
    });
    if (o.daysAgo) await backdate(id, o.daysAgo);
    for (const s of o.moveTo ?? []) await transitionItem(ctx, id, { toStateId: stateId(key, s), auto: false, comment: null });
    if (o.daysAgo && o.moveTo?.length) await backdate(id, o.daysAgo);
    await refreshItem(id);
    return id;
  };

  await log("rfi", j1.id, "Beam elevation conflict at Grid C/4 — S-301 vs A-501", {
    daysAgo: 6,
    moveTo: ["Submitted"],
    due: wd(2),
    party: "eor",
    priority: "high",
    taskId: j1.seqIds[1],
    fields: {
      to_party: "Karen Whitley (GC) / Copper State SE",
      reference: "S-301 Det. 4/S-501; A-501 Sect. B",
      question: "TOS at Grid C/4 shown as 114'-6\" on S-301 but A-501 section shows 115'-0\" to suit window head. Confirm governing elevation before Seq 2 L2 beams are set.",
      proposed_solution: "Hold S-301 elevation 114'-6\"; architect to adjust head detail.",
      affected_area: "Seq 2, Grids 3–6 L2",
      days_at_risk: 2,
      cost_impact: "tbd",
    },
  });
  await log("rfi", j1.id, "Missing embed plate detail at canopy connection", {
    daysAgo: 14,
    moveTo: ["Submitted", "Answered"],
    due: workDaysBack(5),
    party: "architect",
    fields: {
      to_party: "Sonoran Studio Architects",
      reference: "S-401 Det. 7",
      question: "Embed plate EP-3 referenced at canopy beam connection, no detail provided.",
      answer: "Use EP-2 per S-402 Det. 3 with (4) 3/4\" headed studs.",
      answered_by: "Sonoran Studio",
      days_at_risk: 0,
      cost_impact: "no",
    },
  });
  await log("rfi", j1.id, "Stair 1 stringer-to-landing connection — bolted vs welded", {
    daysAgo: 1,
    party: "eor",
    fields: { reference: "S-601 Det. 2", question: "Detail shows welded, shop drawings show bolted clip. Confirm acceptable.", days_at_risk: 0 },
  });
  await log("rfi", j2.id, "North tower guardrail post spacing exceeds 4'-0\"", {
    daysAgo: 4,
    moveTo: ["Submitted"],
    due: wd(1),
    party: "architect",
    fields: { reference: "A-701 / S-702", question: "Post spacing at landing L3 dimensions to 4'-6\" o.c.; confirm acceptable or add post.", days_at_risk: 1, cost_impact: "yes" },
  });

  await log("submittal", j1.id, "Erection drawings E1–E12 & erection sequence", {
    daysAgo: 30,
    moveTo: ["Submitted", "Approved"],
    fields: { spec_section: "05 12 00", submittal_type: "erection_drawings", revision: "1" },
  });
  await log("submittal", j1.id, "Crane lift plan — 65T RT, critical picks at moment frames", {
    daysAgo: 5,
    moveTo: ["Submitted"],
    due: wd(3),
    fields: { spec_section: "01 35 00", submittal_type: "crane_lift_plan", revision: "0", submitted_to: "Desert Ridge Builders" },
  });
  await log("submittal", j3.id, "Site-specific erection plan & AB survey procedure", {
    daysAgo: 2,
    fields: { spec_section: "05 12 00", submittal_type: "erection_plan", revision: "0" },
  });

  await log("co", j1.id, "Added lintel angles at Wing B openings (ASI-04)", {
    daysAgo: 8,
    moveTo: ["Pricing", "Submitted"],
    party: "architect",
    fields: { co_type: "lump_sum", gc_co_number: "PCO-011", reason: "ASI-04 added L6x4 lintels at 14 openings, not in bid documents.", amount_requested: 18450, schedule_days: 1 },
  });
  await log("co", j1.id, "T&M — field drilling at misaligned embeds, Grid 1", {
    daysAgo: 12,
    moveTo: ["Submitted", "Approved"],
    party: "gc",
    fields: { co_type: "tm", gc_co_number: "PCO-008", reason: "Embeds by concrete sub out of tolerance; field-drilled 22 holes.", amount_requested: 6820, amount_approved: 6200, schedule_days: 0 },
  });
  await log("co", j2.id, "Additional ladder at roof hatch", {
    daysAgo: 1,
    party: "owner",
    fields: { co_type: "lump_sum", reason: "Owner-requested ladder and safety post at roof hatch.", amount_requested: 3950 },
  });

  await log("delay", j1.id, "Seq 2 loads late from fabricator — crew & crane standby", {
    daysAgo: 2,
    party: "fabricator",
    priority: "high",
    deliveryId: shortLoad,
    fields: {
      event_date: workDaysBack(2),
      event_time: "06:30",
      location: "Seq 2, Grids 3–6",
      cause: "late_delivery",
      crew_size: 6,
      crew_hours_lost: 30,
      crane_standby_hours: 5,
      labor_rate: 68,
      crane_rate: 95,
      schedule_days: 1,
      affected_sequences: "Seq 2, Seq 3",
      direction_requested: "Request GC direction: hold crew on standby (T&M) or demobilize until load 2-3 arrives.",
    },
  });
  await log("backcharge", j1.id, "Mis-punched beam connections B-14, B-22", {
    daysAgo: 7,
    moveTo: ["Submitted"],
    party: "fabricator",
    fields: { cause: "fab_error", piece_marks: "B-14, B-22 (Seq 1)", labor_hours: 14, labor_cost: 952, equipment_cost: 380, material_cost: 120 },
  });
  await log("delivery_issue", j1.id, "Load 2-2 short 6 pcs", {
    daysAgo: 3,
    moveTo: ["Fabricator Notified"],
    party: "fabricator",
    deliveryId: shortLoad,
    fields: { load_number: "2-2", issue_type: "short", piece_marks: "B-214, B-215, B-216, 3 clips", pieces_affected: 6 },
  });
  await log("safety", j1.id, "Unprotected leading edge at L2 deck opening", {
    daysAgo: 1,
    priority: "critical",
    fields: { observation_type: "hazard", location: "L2, Grid 2/B", corrective_action: "Install cable rail; re-brief crew at tailgate." },
  });
  await log("risk", j1.id, "Fabricator capacity — Seq 3/4 shipping slip", {
    daysAgo: 4,
    moveTo: ["Mitigating"],
    fields: { probability: 4, impact: 4, mitigation: "Weekly shipping call with Valley Steel; pre-stage Seq 4 canopy steel early." },
  });

  await log("bid", null, "Chandler USD — Gymnasium Addition", {
    daysAgo: 6,
    moveTo: ["Estimating"],
    due: wd(8),
    fields: { gc_name: "Desert Ridge Builders", project_type: "K-12", location: "Chandler, AZ", est_tons: 145, est_value: 318000, est_margin_pct: 18, win_probability: 45, strategic_fit: 4, risk_rating: 2 },
  });
  await log("bid", null, "Sky Harbor — Terminal 3 Canopy Retrofit", {
    daysAgo: 20,
    moveTo: ["Estimating", "Bid Submitted"],
    due: workDaysBack(3),
    fields: { gc_name: "Camelback Construction Group", project_type: "Commercial", location: "Phoenix, AZ", est_tons: 88, est_value: 264000, est_margin_pct: 22, win_probability: 35, strategic_fit: 3, risk_rating: 4 },
  });
  await log("bid", null, "Tempe Industrial — Pipe Rack Phase 2", {
    daysAgo: 25,
    moveTo: ["Estimating", "Bid Submitted", "Awarded"],
    fields: { gc_name: "Camelback Construction Group", project_type: "Industrial", location: "Tempe, AZ", est_tons: 120, est_value: 296000, est_margin_pct: 20, win_probability: 100, strategic_fit: 5, risk_rating: 2 },
  });

  for (const j of [j1, j2, j3]) await recomputeProject(j.id);

  /* ---------------- Sample reports & dashboard ---------------- */
  const rep = async (name: string, config: ReportConfig) =>
    (await d.insert(reports).values({ name, config, ownerId: admin.id, isShared: true }).$returningId())[0].id;
  const r1 = await rep("Open RFIs by Job", {
    source: "logs",
    appKey: "rfi",
    columns: ["label", "title", "projectCode", "state", "dueDate", "ageDays", "slaStatus"],
    filters: [{ field: "stateCategory", op: "ne", value: "end" }],
    groupBy: "projectCode",
    output: "bar",
    metric: { agg: "count" },
  });
  const r2 = await rep("Tons Erected — Cumulative", {
    source: "progress",
    columns: ["reportDate", "projectCode", "sequence", "tons"],
    filters: [],
    groupBy: "reportDate",
    output: "line",
    metric: { field: "tons", agg: "sum" },
    dateBucket: "day",
    cumulative: true,
  });
  const r3 = await rep("Late / At-Risk Loads", {
    source: "deliveries",
    columns: ["projectCode", "loadNumber", "sequence", "fabricator", "needDate", "promisedDate", "receivedDate", "tons", "status", "risk"],
    filters: [{ field: "risk", op: "in", value: ["late", "at_risk"] }],
    sort: [{ field: "needDate", dir: "asc" }],
    output: "table",
  });
  const r4 = await rep("Crew Hours by Job — This Week", {
    source: "time",
    columns: ["entryDate", "userName", "projectCode", "hours"],
    filters: [{ field: "entryDate", op: "range", value: "this_week" }],
    groupBy: "projectCode",
    output: "pie",
    metric: { field: "hours", agg: "sum" },
  });
  await d.insert(dashboards).values({
    name: "PM Weekly",
    ownerId: admin.id,
    isShared: true,
    widgets: [
      { reportId: r2, size: "lg" },
      { reportId: r1, size: "md" },
      { reportId: r4, size: "md" },
      { reportId: r3, size: "lg" },
    ],
  });

  await setSetting("demo_loaded", true);
  return { ok: true as const, message: "Loaded 3 demo jobs with sequences, deliveries, daily reports, logs and a PM Weekly dashboard.", projectIds: [j1.id, j2.id, j3.id] };
}
