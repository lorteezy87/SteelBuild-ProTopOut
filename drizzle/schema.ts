import {
  boolean,
  date,
  double,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const id = () => int("id").autoincrement().primaryKey();
const createdAt = () => timestamp("createdAt").defaultNow().notNull();
const updatedAt = () => timestamp("updatedAt").defaultNow().onUpdateNow().notNull();
const day = (name: string) => date(name, { mode: "string" });

/* ------------------------------------------------------------------ */
/* Users & organization                                                */
/* ------------------------------------------------------------------ */

export const users = mysqlTable("users", {
  id: id(),
  /** Manus OAuth openId; pre-created users get a "local:" placeholder until first sign-in. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  accessType: varchar("accessType", { length: 32 }).default("team_member").notNull(),
  title: varchar("title", { length: 128 }),
  phone: varchar("phone", { length: 64 }),
  supervisorId: int("supervisorId"),
  jobRoleId: int("jobRoleId"),
  costRate: double("costRate"),
  billRate: double("billRate"),
  calendarId: int("calendarId"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: json("value"),
  updatedAt: updatedAt(),
});

export const workspaces = mysqlTable("workspaces", {
  id: id(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  createdAt: createdAt(),
});

export const jobRoles = mysqlTable("job_roles", {
  id: id(),
  name: varchar("name", { length: 128 }).notNull(),
  costRate: double("costRate").default(0).notNull(),
  billRate: double("billRate").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
});

export const calendars = mysqlTable("calendars", {
  id: id(),
  name: varchar("name", { length: 128 }).notNull(),
  /** ISO weekday numbers that are working days: 1 = Monday ... 7 = Sunday. */
  workDays: json("workDays").$type<number[]>().notNull(),
  hoursPerDay: double("hoursPerDay").default(8).notNull(),
  isDefault: boolean("isDefault").default(false).notNull(),
});

export const calendarExceptions = mysqlTable(
  "calendar_exceptions",
  {
    id: id(),
    calendarId: int("calendarId").notNull(),
    date: day("date").notNull(),
    name: varchar("name", { length: 128 }),
    isWorking: boolean("isWorking").default(false).notNull(),
  },
  t => [index("cal_exc_cal").on(t.calendarId)]
);

export const companies = mysqlTable("companies", {
  id: id(),
  name: varchar("name", { length: 200 }).notNull(),
  /** gc | fabricator | detailer | eor | architect | owner | crane_rental | supplier | other */
  type: varchar("type", { length: 32 }).default("other").notNull(),
  phone: varchar("phone", { length: 64 }),
  email: varchar("email", { length: 320 }),
  address: text("address"),
  notes: text("notes"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: createdAt(),
});

export const contacts = mysqlTable(
  "contacts",
  {
    id: id(),
    companyId: int("companyId").notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    title: varchar("title", { length: 128 }),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 64 }),
  },
  t => [index("contacts_company").on(t.companyId)]
);

export const equipment = mysqlTable("equipment", {
  id: id(),
  name: varchar("name", { length: 200 }).notNull(),
  /** crane | lift | welder | forklift | compressor | other */
  type: varchar("type", { length: 32 }).default("crane").notNull(),
  capacity: varchar("capacity", { length: 64 }),
  ownership: varchar("ownership", { length: 16 }).default("rented").notNull(),
  vendorCompanyId: int("vendorCompanyId"),
  hourlyRate: double("hourlyRate").default(0).notNull(),
  standbyRate: double("standbyRate").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
});

/* ------------------------------------------------------------------ */
/* Security                                                            */
/* ------------------------------------------------------------------ */

export const securityRoles = mysqlTable("security_roles", {
  id: id(),
  key: varchar("key", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  isSystem: boolean("isSystem").default(false).notNull(),
});

export const rolePrivileges = mysqlTable(
  "role_privileges",
  {
    id: id(),
    roleId: int("roleId").notNull(),
    privilege: varchar("privilege", { length: 64 }).notNull(),
    effect: varchar("effect", { length: 8 }).default("grant").notNull(),
  },
  t => [uniqueIndex("role_priv_uq").on(t.roleId, t.privilege)]
);

export const roleAssignments = mysqlTable(
  "role_assignments",
  {
    id: id(),
    userId: int("userId").notNull(),
    roleId: int("roleId").notNull(),
    /** global | workspace | project */
    scopeType: varchar("scopeType", { length: 16 }).notNull(),
    scopeId: int("scopeId"),
    createdAt: createdAt(),
  },
  t => [index("ra_user").on(t.userId), index("ra_scope").on(t.scopeType, t.scopeId)]
);

/* ------------------------------------------------------------------ */
/* Projects (jobs) & tasks                                             */
/* ------------------------------------------------------------------ */

export const projects = mysqlTable(
  "projects",
  {
    id: id(),
    workspaceId: int("workspaceId"),
    code: varchar("code", { length: 32 }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    state: varchar("state", { length: 16 }).default("draft").notNull(),
    projectType: varchar("projectType", { length: 64 }),
    priority: varchar("priority", { length: 16 }).default("normal").notNull(),
    managerId: int("managerId"),
    calendarId: int("calendarId"),
    startDate: day("startDate"),
    deadline: day("deadline"),
    plannedStart: day("plannedStart"),
    plannedFinish: day("plannedFinish"),
    contractType: varchar("contractType", { length: 16 }).default("lump_sum").notNull(),
    contractValue: double("contractValue").default(0).notNull(),
    budget: double("budget").default(0).notNull(),
    totalTons: double("totalTons").default(0).notNull(),
    totalPieces: int("totalPieces").default(0).notNull(),
    retainagePct: double("retainagePct").default(10).notNull(),
    noticeHours: int("noticeHours").default(72).notNull(),
    siteAddress: text("siteAddress"),
    progressMethod: varchar("progressMethod", { length: 16 }).default("tonnage").notNull(),
    percentComplete: double("percentComplete").default(0).notNull(),
    projectedFinish: day("projectedFinish"),
    projectedCost: double("projectedCost"),
    scheduleHealth: varchar("scheduleHealth", { length: 16 }).default("not_active").notNull(),
    costHealth: varchar("costHealth", { length: 16 }).default("not_active").notNull(),
    plannedValue: double("plannedValue").default(0).notNull(),
    earnedValue: double("earnedValue").default(0).notNull(),
    actualCost: double("actualCost").default(0).notNull(),
    lastForecastAt: timestamp("lastForecastAt"),
    activeBaselineId: int("activeBaselineId"),
    createdBy: int("createdBy"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index("projects_ws").on(t.workspaceId)]
);

export const projectCompanies = mysqlTable(
  "project_companies",
  {
    id: id(),
    projectId: int("projectId").notNull(),
    companyId: int("companyId").notNull(),
    /** gc | fabricator | detailer | eor | architect | owner */
    role: varchar("role", { length: 32 }).notNull(),
  },
  t => [index("pc_project").on(t.projectId)]
);

export const tasks = mysqlTable(
  "tasks",
  {
    id: id(),
    projectId: int("projectId").notNull(),
    parentId: int("parentId"),
    sortOrder: int("sortOrder").default(0).notNull(),
    wbs: varchar("wbs", { length: 64 }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    /** task | milestone | sequence */
    kind: varchar("kind", { length: 16 }).default("task").notNull(),
    isSummary: boolean("isSummary").default(false).notNull(),
    status: varchar("status", { length: 16 }).default("not_started").notNull(),
    priority: varchar("priority", { length: 16 }).default("normal").notNull(),
    schedulingMode: varchar("schedulingMode", { length: 8 }).default("auto").notNull(),
    constraintType: varchar("constraintType", { length: 8 }).default("asap").notNull(),
    constraintDate: day("constraintDate"),
    startDate: day("startDate"),
    finishDate: day("finishDate"),
    durationDays: double("durationDays").default(1).notNull(),
    effortHours: double("effortHours").default(0).notNull(),
    percentComplete: double("percentComplete").default(0).notNull(),
    actualStart: day("actualStart"),
    actualFinish: day("actualFinish"),
    budgetCost: double("budgetCost").default(0).notNull(),
    location: varchar("location", { length: 128 }),
    plannedTons: double("plannedTons").default(0).notNull(),
    plannedPieces: int("plannedPieces").default(0).notNull(),
    erectedTons: double("erectedTons").default(0).notNull(),
    erectedPieces: int("erectedPieces").default(0).notNull(),
    totalFloat: double("totalFloat"),
    isCritical: boolean("isCritical").default(false).notNull(),
    constraintViolated: boolean("constraintViolated").default(false).notNull(),
    projectedFinish: day("projectedFinish"),
    scheduleHealth: varchar("scheduleHealth", { length: 16 }).default("future").notNull(),
    createdBy: int("createdBy"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index("tasks_project").on(t.projectId), index("tasks_parent").on(t.parentId)]
);

export const taskDependencies = mysqlTable(
  "task_dependencies",
  {
    id: id(),
    predecessorId: int("predecessorId").notNull(),
    successorId: int("successorId").notNull(),
    /** FS | SS | FF | SF */
    type: varchar("type", { length: 2 }).default("FS").notNull(),
    lagDays: double("lagDays").default(0).notNull(),
  },
  t => [
    uniqueIndex("dep_uq").on(t.predecessorId, t.successorId),
    index("dep_succ").on(t.successorId),
  ]
);

export const taskAssignments = mysqlTable(
  "task_assignments",
  {
    id: id(),
    taskId: int("taskId").notNull(),
    userId: int("userId"),
    jobRoleId: int("jobRoleId"),
    equipmentId: int("equipmentId"),
    allocationPct: double("allocationPct").default(100).notNull(),
  },
  t => [index("ta_task").on(t.taskId), index("ta_user").on(t.userId)]
);

export const checklistItems = mysqlTable(
  "checklist_items",
  {
    id: id(),
    taskId: int("taskId").notNull(),
    text: varchar("text", { length: 500 }).notNull(),
    done: boolean("done").default(false).notNull(),
    sortOrder: int("sortOrder").default(0).notNull(),
  },
  t => [index("cl_task").on(t.taskId)]
);

export type BaselineTaskSnapshot = {
  taskId: number;
  name: string;
  /** Optional for older JSON snapshots. */
  kind?: string;
  isSummary?: boolean;
  startDate: string | null;
  finishDate: string | null;
  durationDays: number;
  effortHours: number;
  budgetCost: number;
  plannedTons: number;
};

export const baselines = mysqlTable(
  "baselines",
  {
    id: id(),
    projectId: int("projectId").notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    plannedStart: day("plannedStart"),
    plannedFinish: day("plannedFinish"),
    budget: double("budget").default(0).notNull(),
    taskData: json("taskData").$type<BaselineTaskSnapshot[]>().notNull(),
    createdBy: int("createdBy"),
    createdAt: createdAt(),
  },
  t => [index("bl_project").on(t.projectId)]
);

export const projectSnapshots = mysqlTable(
  "project_snapshots",
  {
    id: id(),
    projectId: int("projectId").notNull(),
    snapDate: day("snapDate").notNull(),
    percentComplete: double("percentComplete").default(0).notNull(),
    plannedValue: double("plannedValue").default(0).notNull(),
    earnedValue: double("earnedValue").default(0).notNull(),
    actualCost: double("actualCost").default(0).notNull(),
    erectedTons: double("erectedTons").default(0).notNull(),
    plannedTons: double("plannedTons").default(0).notNull(),
  },
  t => [uniqueIndex("snap_uq").on(t.projectId, t.snapDate)]
);

/* ------------------------------------------------------------------ */
/* Field: deliveries & daily reports                                   */
/* ------------------------------------------------------------------ */

export const deliveries = mysqlTable(
  "deliveries",
  {
    id: id(),
    projectId: int("projectId").notNull(),
    sequenceTaskId: int("sequenceTaskId"),
    loadNumber: varchar("loadNumber", { length: 32 }).notNull(),
    description: varchar("description", { length: 500 }),
    fabricatorCompanyId: int("fabricatorCompanyId"),
    needDate: day("needDate"),
    promisedDate: day("promisedDate"),
    shippedDate: day("shippedDate"),
    receivedDate: day("receivedDate"),
    tons: double("tons").default(0).notNull(),
    pieces: int("pieces").default(0).notNull(),
    ticketNumber: varchar("ticketNumber", { length: 64 }),
    /** scheduled | shipped | received | received_short | damaged */
    status: varchar("status", { length: 16 }).default("scheduled").notNull(),
    shortageNotes: text("shortageNotes"),
    createdBy: int("createdBy"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index("del_project").on(t.projectId)]
);

export const dailyReports = mysqlTable(
  "daily_reports",
  {
    id: id(),
    projectId: int("projectId").notNull(),
    reportDate: day("reportDate").notNull(),
    foremanId: int("foremanId"),
    weather: varchar("weather", { length: 128 }),
    temperature: varchar("temperature", { length: 32 }),
    workPerformed: text("workPerformed"),
    safetyNotes: text("safetyNotes"),
    delayNotes: text("delayNotes"),
    /** draft | submitted | approved | rejected */
    status: varchar("status", { length: 16 }).default("draft").notNull(),
    approvedBy: int("approvedBy"),
    approvedAt: timestamp("approvedAt"),
    rejectReason: text("rejectReason"),
    createdBy: int("createdBy"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index("dr_project").on(t.projectId, t.reportDate)]
);

export const dailyReportCrew = mysqlTable(
  "daily_report_crew",
  {
    id: id(),
    reportId: int("reportId").notNull(),
    userId: int("userId"),
    workerName: varchar("workerName", { length: 200 }),
    jobRoleId: int("jobRoleId"),
    taskId: int("taskId"),
    stHours: double("stHours").default(0).notNull(),
    otHours: double("otHours").default(0).notNull(),
  },
  t => [index("drc_report").on(t.reportId)]
);

export const dailyReportEquipment = mysqlTable(
  "daily_report_equipment",
  {
    id: id(),
    reportId: int("reportId").notNull(),
    equipmentId: int("equipmentId").notNull(),
    operatingHours: double("operatingHours").default(0).notNull(),
    standbyHours: double("standbyHours").default(0).notNull(),
    cost: double("cost").default(0).notNull(),
  },
  t => [index("dre_report").on(t.reportId)]
);

export const dailyReportProgress = mysqlTable(
  "daily_report_progress",
  {
    id: id(),
    reportId: int("reportId").notNull(),
    projectId: int("projectId").notNull(),
    taskId: int("taskId").notNull(),
    reportDate: day("reportDate").notNull(),
    tons: double("tons").default(0).notNull(),
    pieces: int("pieces").default(0).notNull(),
    note: varchar("note", { length: 500 }),
    posted: boolean("posted").default(false).notNull(),
  },
  t => [index("drp_report").on(t.reportId), index("drp_task").on(t.taskId)]
);

/* ------------------------------------------------------------------ */
/* Time & expenses                                                     */
/* ------------------------------------------------------------------ */

export const timeCodes = mysqlTable("time_codes", {
  id: id(),
  name: varchar("name", { length: 128 }).notNull(),
  billable: boolean("billable").default(true).notNull(),
  multiplier: double("multiplier").default(1).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
});

export const timeEntries = mysqlTable(
  "time_entries",
  {
    id: id(),
    userId: int("userId").notNull(),
    projectId: int("projectId").notNull(),
    taskId: int("taskId"),
    wfItemId: int("wfItemId"),
    timeCodeId: int("timeCodeId"),
    entryDate: day("entryDate").notNull(),
    hours: double("hours").notNull(),
    notes: varchar("notes", { length: 500 }),
    /** saved | submitted | approved | rejected | invoiced */
    state: varchar("state", { length: 16 }).default("saved").notNull(),
    /** timesheet | daily_report | api */
    source: varchar("source", { length: 16 }).default("timesheet").notNull(),
    sourceId: int("sourceId"),
    costAmount: double("costAmount").default(0).notNull(),
    billAmount: double("billAmount").default(0).notNull(),
    approvedBy: int("approvedBy"),
    /** Distinct approvers who approved the current submission. */
    approvals: json("approvals").$type<number[]>().$defaultFn(() => []),
    approvedAt: timestamp("approvedAt"),
    rejectReason: varchar("rejectReason", { length: 500 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    index("te_user_date").on(t.userId, t.entryDate),
    index("te_project").on(t.projectId),
  ]
);

export const expenseCodes = mysqlTable("expense_codes", {
  id: id(),
  name: varchar("name", { length: 128 }).notNull(),
  billable: boolean("billable").default(true).notNull(),
  costable: boolean("costable").default(true).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
});

export const expenses = mysqlTable(
  "expenses",
  {
    id: id(),
    projectId: int("projectId").notNull(),
    userId: int("userId").notNull(),
    expenseCodeId: int("expenseCodeId"),
    expenseDate: day("expenseDate").notNull(),
    description: varchar("description", { length: 500 }),
    vendor: varchar("vendor", { length: 200 }),
    amount: double("amount").notNull(),
    billable: boolean("billable").default(true).notNull(),
    costable: boolean("costable").default(true).notNull(),
    state: varchar("state", { length: 16 }).default("saved").notNull(),
    receiptUrl: varchar("receiptUrl", { length: 1000 }),
    approvedBy: int("approvedBy"),
    approvedAt: timestamp("approvedAt"),
    rejectReason: varchar("rejectReason", { length: 500 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index("exp_project").on(t.projectId), index("exp_user").on(t.userId)]
);

/* ------------------------------------------------------------------ */
/* Workflow apps (logs)                                                */
/* ------------------------------------------------------------------ */

export const wfApps = mysqlTable("wf_apps", {
  id: id(),
  key: varchar("key", { length: 48 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  pluralName: varchar("pluralName", { length: 128 }).notNull(),
  description: text("description"),
  numberPrefix: varchar("numberPrefix", { length: 12 }).notNull(),
  color: varchar("color", { length: 16 }).default("#E8590C").notNull(),
  icon: varchar("icon", { length: 32 }).default("file-text").notNull(),
  /** project = item belongs to a job; global = not tied to a job (e.g. bid pipeline) */
  scope: varchar("scope", { length: 16 }).default("project").notNull(),
  allowTimeLogging: boolean("allowTimeLogging").default(false).notNull(),
  scoreFormula: text("scoreFormula"),
  dueDateLabel: varchar("dueDateLabel", { length: 64 }).default("Due Date").notNull(),
  config: json("config").$type<WfAppConfig>(),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: createdAt(),
});

export type WfAppConfig = {
  /** Custom field key whose value is mirrored to item.costImpact. */
  costField?: string;
  /** Custom field key holding the approved amount (change orders). */
  approvedField?: string;
  /** Custom field key mirrored to item.scheduleImpactDays. */
  scheduleField?: string;
  /** State names in which "Convert to Job" is offered (bid pipeline). */
  convertStates?: string[];
  convertToStateName?: string;
};

export const wfStates = mysqlTable(
  "wf_states",
  {
    id: id(),
    appId: int("appId").notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    /** start | active | end */
    category: varchar("category", { length: 8 }).default("active").notNull(),
    color: varchar("color", { length: 16 }).default("#6B7280").notNull(),
    sortOrder: int("sortOrder").default(0).notNull(),
  },
  t => [index("wfs_app").on(t.appId)]
);

export const wfTransitions = mysqlTable(
  "wf_transitions",
  {
    id: id(),
    appId: int("appId").notNull(),
    fromStateId: int("fromStateId").notNull(),
    toStateId: int("toStateId").notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    userAllowed: boolean("userAllowed").default(true).notNull(),
  },
  t => [index("wft_app").on(t.appId)]
);

export const wfSlaPolicies = mysqlTable(
  "wf_sla_policies",
  {
    id: id(),
    appId: int("appId").notNull(),
    stateId: int("stateId").notNull(),
    /** null = any priority */
    priority: varchar("priority", { length: 16 }),
    /** fixed | project_notice | due_date */
    source: varchar("source", { length: 16 }).default("fixed").notNull(),
    hours: double("hours").default(24).notNull(),
    /** mark_delayed | transition */
    action: varchar("action", { length: 16 }).default("mark_delayed").notNull(),
    toStateId: int("toStateId"),
    atRiskPct: double("atRiskPct").default(75).notNull(),
  },
  t => [index("wfp_app").on(t.appId)]
);

export const wfItems = mysqlTable(
  "wf_items",
  {
    id: id(),
    appId: int("appId").notNull(),
    projectId: int("projectId"),
    number: int("number").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    stateId: int("stateId").notNull(),
    priority: varchar("priority", { length: 16 }).default("normal").notNull(),
    assigneeId: int("assigneeId"),
    requestorId: int("requestorId"),
    responsibleParty: varchar("responsibleParty", { length: 32 }),
    dueDate: day("dueDate"),
    stateEnteredAt: timestamp("stateEnteredAt").defaultNow().notNull(),
    slaDueAt: timestamp("slaDueAt"),
    slaAtRiskAt: timestamp("slaAtRiskAt"),
    /** ok | at_risk | delayed */
    slaStatus: varchar("slaStatus", { length: 16 }).default("ok").notNull(),
    costImpact: double("costImpact").default(0).notNull(),
    scheduleImpactDays: double("scheduleImpactDays").default(0).notNull(),
    linkedTaskId: int("linkedTaskId"),
    linkedDeliveryId: int("linkedDeliveryId"),
    score: double("score"),
    closedAt: timestamp("closedAt"),
    createdBy: int("createdBy"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index("wfi_app_project").on(t.appId, t.projectId), index("wfi_assignee").on(t.assigneeId)]
);

export const wfEvents = mysqlTable(
  "wf_events",
  {
    id: id(),
    itemId: int("itemId").notNull(),
    fromStateId: int("fromStateId"),
    toStateId: int("toStateId"),
    userId: int("userId"),
    comment: text("comment"),
    isAuto: boolean("isAuto").default(false).notNull(),
    createdAt: createdAt(),
  },
  t => [index("wfe_item").on(t.itemId)]
);

/* ------------------------------------------------------------------ */
/* Custom fields                                                       */
/* ------------------------------------------------------------------ */

export type FieldOption = { value: string; label: string; color?: string };
export type ColorRule = { op: "lt" | "lte" | "gt" | "gte" | "eq"; value: number | string; color: string };

export const customFieldDefs = mysqlTable(
  "custom_field_defs",
  {
    id: id(),
    /** project | task | user | company | app:<appKey> */
    entityType: varchar("entityType", { length: 64 }).notNull(),
    key: varchar("key", { length: 64 }).notNull(),
    label: varchar("label", { length: 128 }).notNull(),
    /** text | richtext | number | decimal | currency | date | select | multiselect | formula | boolean | user */
    fieldType: varchar("fieldType", { length: 16 }).notNull(),
    options: json("options").$type<FieldOption[]>(),
    formula: text("formula"),
    required: boolean("required").default(false).notNull(),
    isFinancial: boolean("isFinancial").default(false).notNull(),
    /** none | sum | avg | min | max (tasks only) */
    rollup: varchar("rollup", { length: 8 }).default("none").notNull(),
    colorRules: json("colorRules").$type<ColorRule[]>(),
    projectType: varchar("projectType", { length: 64 }),
    helpText: varchar("helpText", { length: 500 }),
    showInList: boolean("showInList").default(false).notNull(),
    sortOrder: int("sortOrder").default(0).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
  },
  t => [uniqueIndex("cfd_uq").on(t.entityType, t.key)]
);

export const customFieldValues = mysqlTable(
  "custom_field_values",
  {
    id: id(),
    defId: int("defId").notNull(),
    entityType: varchar("entityType", { length: 64 }).notNull(),
    entityId: int("entityId").notNull(),
    value: json("value"),
    numValue: double("numValue"),
    textValue: varchar("textValue", { length: 500 }),
  },
  t => [
    uniqueIndex("cfv_uq").on(t.defId, t.entityId),
    index("cfv_entity").on(t.entityType, t.entityId),
  ]
);

/* ------------------------------------------------------------------ */
/* Reports & dashboards                                                */
/* ------------------------------------------------------------------ */

export type ReportConfig = {
  source: string;
  appKey?: string;
  columns: string[];
  filters: { field: string; op: string; value: unknown }[];
  groupBy?: string;
  sort?: { field: string; dir: "asc" | "desc" }[];
  output: "table" | "bar" | "line" | "pie";
  metric?: { field?: string; agg: "count" | "sum" | "avg" | "min" | "max" };
  dateBucket?: "day" | "week" | "month";
  cumulative?: boolean;
  limit?: number;
};

export const reports = mysqlTable("reports", {
  id: id(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  config: json("config").$type<ReportConfig>().notNull(),
  ownerId: int("ownerId").notNull(),
  isShared: boolean("isShared").default(false).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const reportStars = mysqlTable(
  "report_stars",
  {
    id: id(),
    reportId: int("reportId").notNull(),
    userId: int("userId").notNull(),
  },
  t => [uniqueIndex("rs_uq").on(t.reportId, t.userId)]
);

export type DashboardWidget = { reportId: number; size: "sm" | "md" | "lg"; title?: string };

export const dashboards = mysqlTable("dashboards", {
  id: id(),
  name: varchar("name", { length: 200 }).notNull(),
  ownerId: int("ownerId").notNull(),
  isShared: boolean("isShared").default(false).notNull(),
  widgets: json("widgets").$type<DashboardWidget[]>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Collaboration                                                       */
/* ------------------------------------------------------------------ */

export const comments = mysqlTable(
  "comments",
  {
    id: id(),
    entityType: varchar("entityType", { length: 32 }).notNull(),
    entityId: int("entityId").notNull(),
    projectId: int("projectId"),
    userId: int("userId").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  t => [index("cm_entity").on(t.entityType, t.entityId)]
);

export const followers = mysqlTable(
  "followers",
  {
    id: id(),
    entityType: varchar("entityType", { length: 32 }).notNull(),
    entityId: int("entityId").notNull(),
    userId: int("userId").notNull(),
  },
  t => [uniqueIndex("fl_uq").on(t.entityType, t.entityId, t.userId)]
);

export const notifications = mysqlTable(
  "notifications",
  {
    id: id(),
    userId: int("userId").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body"),
    link: varchar("link", { length: 500 }),
    isRead: boolean("isRead").default(false).notNull(),
    createdAt: createdAt(),
  },
  t => [index("nt_user").on(t.userId, t.isRead)]
);

export const activities = mysqlTable(
  "activities",
  {
    id: id(),
    projectId: int("projectId"),
    entityType: varchar("entityType", { length: 32 }).notNull(),
    entityId: int("entityId").notNull(),
    userId: int("userId"),
    action: varchar("action", { length: 32 }).notNull(),
    summary: varchar("summary", { length: 500 }).notNull(),
    createdAt: createdAt(),
  },
  t => [index("act_project").on(t.projectId, t.createdAt)]
);

export const documents = mysqlTable(
  "documents",
  {
    id: id(),
    projectId: int("projectId").notNull(),
    entityType: varchar("entityType", { length: 32 }),
    entityId: int("entityId"),
    name: varchar("name", { length: 255 }).notNull(),
    category: varchar("category", { length: 32 }).default("other").notNull(),
    sheetNumber: varchar("sheetNumber", { length: 64 }),
    currentRevision: varchar("currentRevision", { length: 16 }),
    isDeleted: boolean("isDeleted").default(false).notNull(),
    createdBy: int("createdBy"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index("doc_project").on(t.projectId)]
);

export const documentVersions = mysqlTable(
  "document_versions",
  {
    id: id(),
    documentId: int("documentId").notNull(),
    revision: varchar("revision", { length: 16 }).notNull(),
    fileKey: varchar("fileKey", { length: 500 }).notNull(),
    url: varchar("url", { length: 1000 }).notNull(),
    fileName: varchar("fileName", { length: 255 }).notNull(),
    size: int("size").default(0).notNull(),
    mimeType: varchar("mimeType", { length: 128 }),
    notes: varchar("notes", { length: 500 }),
    uploadedBy: int("uploadedBy"),
    uploadedAt: createdAt(),
  },
  t => [index("dv_doc").on(t.documentId)]
);

/* ------------------------------------------------------------------ */
/* Drawing register (sets, sheets, revisions, set issues)              */
/* Rules live in shared/drawings.ts.                                   */
/* ------------------------------------------------------------------ */

export const drawingSets = mysqlTable(
  "drawing_sets",
  {
    id: id(),
    projectId: int("projectId").notNull(),
    number: varchar("number", { length: 32 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    /** erection | shop | contract | field | other */
    kind: varchar("kind", { length: 16 }).default("erection").notNull(),
    description: text("description"),
    createdBy: int("createdBy"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [uniqueIndex("dset_project_number").on(t.projectId, t.number)]
);
export type DrawingSet = typeof drawingSets.$inferSelect;

export const drawingSheets = mysqlTable(
  "drawing_sheets",
  {
    id: id(),
    projectId: int("projectId").notNull(),
    setId: int("setId"),
    sheetNumber: varchar("sheetNumber", { length: 64 }).notNull(),
    /** normSheet(sheetNumber): one sheet per number per job however its dashes and spaces are typed. */
    sheetKey: varchar("sheetKey", { length: 64 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    /** Erection sequence (task of kind "sequence") the sheet belongs to. */
    sequenceTaskId: int("sequenceTaskId"),
    /** DET | REV | RR | HOLD | REL */
    status: varchar("status", { length: 8 }).default("DET").notNull(),
    /** Status to return to when the hold is lifted. */
    holdFrom: varchar("holdFrom", { length: 8 }),
    holdReason: varchar("holdReason", { length: 500 }),
    /** RFI (log item) that keeps this sheet on hold until it is closed. */
    holdRfiId: int("holdRfiId"),
    ballInCourt: varchar("ballInCourt", { length: 32 }).default("Detailer").notNull(),
    sentDate: day("sentDate"),
    returnedDate: day("returnedDate"),
    /** Number of the issued revision (null until one is issued). */
    currentRev: int("currentRev"),
    createdBy: int("createdBy"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [uniqueIndex("dsh_project_key").on(t.projectId, t.sheetKey), index("dsh_set").on(t.setId)]
);
export type DrawingSheet = typeof drawingSheets.$inferSelect;

export const drawingRevisions = mysqlTable(
  "drawing_revisions",
  {
    id: id(),
    sheetId: int("sheetId").notNull(),
    number: int("number").notNull(),
    /** draft | checked | issued | superseded */
    state: varchar("state", { length: 12 }).default("draft").notNull(),
    notes: varchar("notes", { length: 500 }),
    fileKey: varchar("fileKey", { length: 500 }),
    url: varchar("url", { length: 1000 }),
    fileName: varchar("fileName", { length: 255 }),
    size: int("size"),
    mimeType: varchar("mimeType", { length: 128 }),
    createdBy: int("createdBy"),
    createdAt: createdAt(),
    checkedBy: int("checkedBy"),
    checkedAt: timestamp("checkedAt"),
    issuedBy: int("issuedBy"),
    issuedAt: day("issuedAt"),
    /** Page image (JPEG) shown as the preview and used when the revision has no PDF. */
    previewKey: varchar("previewKey", { length: 500 }),
    previewUrl: varchar("previewUrl", { length: 1000 }),
    /** What the revision is (from the revision block or typed), and its date on the drawing. */
    description: varchar("description", { length: 600 }),
    revDate: day("revDate"),
    /** Where it came from: "Read from Set A.pdf p3". */
    source: varchar("source", { length: 300 }),
    /** How its title block was read: pdf (the PDF's text) | ai | hand */
    readVia: varchar("readVia", { length: 8 }),
  },
  t => [uniqueIndex("drev_sheet_number").on(t.sheetId, t.number)]
);
export type DrawingRevision = typeof drawingRevisions.$inferSelect;

export const drawingSetIssues = mysqlTable(
  "drawing_set_issues",
  {
    id: id(),
    setId: int("setId").notNull(),
    projectId: int("projectId").notNull(),
    number: int("number").notNull(),
    purpose: varchar("purpose", { length: 32 }).notNull(),
    issueDate: day("issueDate").notNull(),
    note: varchar("note", { length: 1000 }),
    /** Snapshot of what went out: [{ sheetId, sheet, rev, title, status, fileUrl }] */
    sheets: json("sheets").$type<{ sheetId: number; sheet: string; rev: number; title: string; status: string; fileUrl?: string | null }[]>().notNull(),
    /** Sheets left out and why: [{ sheet, why }] */
    skipped: json("skipped").$type<{ sheet: string; why: string }[]>().notNull(),
    issuedBy: int("issuedBy"),
    createdAt: createdAt(),
  },
  t => [uniqueIndex("dsi_set_number").on(t.setId, t.number)]
);
export type DrawingSetIssue = typeof drawingSetIssues.$inferSelect;

/** The three title-block boxes (sheet no., title, revision) per job, as fractions of the page. */
export type TbRect = { x: number; y: number; w: number; h: number };
export const drawingTitleBlocks = mysqlTable("drawing_title_blocks", {
  projectId: int("projectId").primaryKey(),
  boxes: json("boxes").$type<{ sheet: TbRect; title: TbRect; rev: TbRect }>().notNull(),
  updatedBy: int("updatedBy"),
  updatedAt: updatedAt(),
});

/**
 * Markups on a sheet: one row per markup, on a revision and page. kind: note | cloud | rect | arrow | pen | text |
 * highlight | length | area | count. points: [[x, y], …] as fractions of the page (0–1).
 */
export const drawingMarks = mysqlTable(
  "drawing_marks",
  {
    id: id(),
    projectId: int("projectId").notNull(),
    sheetId: int("sheetId").notNull(),
    rev: int("rev").notNull(),
    page: int("page").default(1).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    points: json("points").$type<[number, number][]>().notNull(),
    color: varchar("color", { length: 16 }).default("#E8590C").notNull(),
    note: varchar("note", { length: 500 }),
    /** Note number shown on the drawing (N1, N2, …). */
    label: varchar("label", { length: 12 }),
    createdBy: int("createdBy"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index("dmk_sheet").on(t.sheetId, t.rev)]
);
export type DrawingMark = typeof drawingMarks.$inferSelect;

/** A page's scale: feet across the full page width (from a printed scale or a known length). */
export const drawingScales = mysqlTable(
  "drawing_scales",
  {
    id: id(),
    sheetId: int("sheetId").notNull(),
    rev: int("rev").notNull(),
    page: int("page").default(1).notNull(),
    feetPerWidth: double("feetPerWidth").notNull(),
    label: varchar("label", { length: 60 }),
    createdBy: int("createdBy"),
    updatedAt: updatedAt(),
  },
  t => [uniqueIndex("dsc_sheet_rev_page").on(t.sheetId, t.rev, t.page)]
);

/**
 * Framing read from a sheet revision page (the model reader): pieces, grids, columns, labels it couldn't place,
 * level and top of steel. data holds the read as the reader and review produce it (validated on save).
 */
export const modelReads = mysqlTable(
  "model_reads",
  {
    id: id(),
    projectId: int("projectId").notNull(),
    sheetId: int("sheetId").notNull(),
    rev: int("rev").notNull(),
    page: int("page").default(1).notNull(),
    readerVersion: int("readerVersion").default(0).notNull(),
    data: json("data").$type<Record<string, unknown>>().notNull(),
    /** Bumped on every save; a save that names an older version is refused (two reviewers at once). */
    version: int("version").default(1).notNull(),
    readBy: int("readBy"),
    readAt: timestamp("readAt").defaultNow().notNull(),
    updatedBy: int("updatedBy"),
    updatedAt: updatedAt(),
  },
  t => [uniqueIndex("mrd_sheet_rev_page").on(t.sheetId, t.rev, t.page), index("mrd_project").on(t.projectId)]
);
export type ModelRead = typeof modelReads.$inferSelect;

/** Per-job model settings: lift allowance %, base elevation, joist weights, levels. */
export const modelJobs = mysqlTable("model_jobs", {
  projectId: int("projectId").primaryKey(),
  data: json("data").$type<Record<string, unknown>>().notNull(),
  version: int("version").default(1).notNull(),
  updatedBy: int("updatedBy"),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Integration                                                         */
/* ------------------------------------------------------------------ */

export const apiTokens = mysqlTable(
  "api_tokens",
  {
    id: id(),
    userId: int("userId").notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
    last4: varchar("last4", { length: 8 }).notNull(),
    windowStart: timestamp("windowStart"),
    windowCount: int("windowCount").default(0).notNull(),
    lastUsedAt: timestamp("lastUsedAt"),
    createdAt: createdAt(),
  },
  t => [index("tok_user").on(t.userId)]
);

export const webhooks = mysqlTable("webhooks", {
  id: id(),
  name: varchar("name", { length: 128 }).notNull(),
  url: varchar("url", { length: 1000 }).notNull(),
  secret: varchar("secret", { length: 128 }).notNull(),
  events: json("events").$type<string[]>().notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: int("createdBy"),
  createdAt: createdAt(),
});

export const webhookDeliveries = mysqlTable(
  "webhook_deliveries",
  {
    id: id(),
    webhookId: int("webhookId").notNull(),
    deliveryId: varchar("deliveryId", { length: 64 }).notNull(),
    event: varchar("event", { length: 64 }).notNull(),
    payload: json("payload").notNull(),
    /** pending | success | failed */
    status: varchar("status", { length: 16 }).default("pending").notNull(),
    attempts: int("attempts").default(0).notNull(),
    responseCode: int("responseCode"),
    responseBody: varchar("responseBody", { length: 1000 }),
    nextAttemptAt: timestamp("nextAttemptAt"),
    createdAt: createdAt(),
  },
  t => [index("wd_hook").on(t.webhookId), index("wd_status").on(t.status, t.nextAttemptAt)]
);

/* ------------------------------------------------------------------ */
/* Local email + password sign-in (self-hosted deployments)            */
/* ------------------------------------------------------------------ */

export const localCredentials = mysqlTable("local_credentials", {
  userId: int("userId").primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
