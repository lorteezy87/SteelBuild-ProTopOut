/**
 * Report sources and their built-in columns. Custom-field columns are appended
 * at runtime as `cf_<key>`.
 */
import {
  CONTRACT_TYPES,
  COST_HEALTH,
  DELIVERY_STATUSES,
  ENTRY_STATES,
  PRIORITIES,
  PROJECT_STATES,
  RESPONSIBLE_PARTIES,
  SCHEDULE_HEALTH,
  TASK_KINDS,
  TASK_STATUSES,
} from "./domain";

export type ColType = "text" | "number" | "currency" | "date" | "enum" | "boolean" | "percent";
export type ColumnDef = {
  key: string;
  label: string;
  type: ColType;
  financial?: boolean;
  options?: Record<string, string>;
};
export type SourceKey = "jobs" | "tasks" | "time" | "expenses" | "logs" | "deliveries" | "progress";
export type SourceDef = { key: SourceKey; label: string; columns: ColumnDef[]; defaultColumns: string[] };

const c = (key: string, label: string, type: ColType, extra: Partial<ColumnDef> = {}): ColumnDef => ({ key, label, type, ...extra });

export const REPORT_SOURCES: Record<SourceKey, SourceDef> = {
  jobs: {
    key: "jobs",
    label: "Jobs",
    defaultColumns: ["code", "name", "state", "managerName", "percentComplete", "scheduleHealth", "costHealth", "deadline"],
    columns: [
      c("code", "Job #", "text"),
      c("name", "Job", "text"),
      c("state", "State", "enum", { options: PROJECT_STATES }),
      c("projectType", "Type", "text"),
      c("priority", "Priority", "enum", { options: PRIORITIES }),
      c("managerName", "PM", "text"),
      c("gcName", "GC", "text"),
      c("fabricatorName", "Fabricator", "text"),
      c("startDate", "Start", "date"),
      c("deadline", "Deadline", "date"),
      c("plannedFinish", "Planned Finish", "date"),
      c("projectedFinish", "Projected Finish", "date"),
      c("percentComplete", "% Complete", "percent"),
      c("scheduleHealth", "Schedule Health", "enum", { options: SCHEDULE_HEALTH }),
      c("costHealth", "Cost Health", "enum", { options: COST_HEALTH }),
      c("contractType", "Contract Type", "enum", { options: CONTRACT_TYPES }),
      c("contractValue", "Contract Value", "currency", { financial: true }),
      c("budget", "Cost Budget", "currency", { financial: true }),
      c("actualCost", "Actual Cost", "currency", { financial: true }),
      c("projectedCost", "Projected Cost", "currency", { financial: true }),
      c("plannedValue", "PV", "currency", { financial: true }),
      c("earnedValue", "EV", "currency", { financial: true }),
      c("totalTons", "Total Tons", "number"),
      c("erectedTons", "Erected Tons", "number"),
      c("totalPieces", "Total Pieces", "number"),
    ],
  },
  tasks: {
    key: "tasks",
    label: "Tasks & Sequences",
    defaultColumns: ["projectCode", "wbs", "name", "status", "startDate", "finishDate", "percentComplete", "scheduleHealth"],
    columns: [
      c("projectCode", "Job #", "text"),
      c("projectName", "Job", "text"),
      c("wbs", "WBS", "text"),
      c("name", "Task", "text"),
      c("kind", "Kind", "enum", { options: TASK_KINDS }),
      c("status", "Status", "enum", { options: TASK_STATUSES }),
      c("priority", "Priority", "enum", { options: PRIORITIES }),
      c("assignees", "Assigned", "text"),
      c("location", "Location", "text"),
      c("startDate", "Start", "date"),
      c("finishDate", "Finish", "date"),
      c("actualStart", "Actual Start", "date"),
      c("actualFinish", "Actual Finish", "date"),
      c("projectedFinish", "Projected Finish", "date"),
      c("durationDays", "Duration (d)", "number"),
      c("effortHours", "Effort (h)", "number"),
      c("percentComplete", "% Complete", "percent"),
      c("scheduleHealth", "Health", "enum", { options: SCHEDULE_HEALTH }),
      c("isCritical", "Critical", "boolean"),
      c("totalFloat", "Float (d)", "number"),
      c("plannedTons", "Planned Tons", "number"),
      c("erectedTons", "Erected Tons", "number"),
      c("plannedPieces", "Planned Pcs", "number"),
      c("erectedPieces", "Erected Pcs", "number"),
      c("budgetCost", "Budget", "currency", { financial: true }),
    ],
  },
  time: {
    key: "time",
    label: "Time Entries",
    defaultColumns: ["entryDate", "userName", "projectCode", "taskName", "timeCode", "hours", "state"],
    columns: [
      c("entryDate", "Date", "date"),
      c("userName", "Person", "text"),
      c("jobRole", "Job Role", "text"),
      c("projectCode", "Job #", "text"),
      c("projectName", "Job", "text"),
      c("taskName", "Task", "text"),
      c("timeCode", "Time Code", "text"),
      c("hours", "Hours", "number"),
      c("state", "State", "enum", { options: ENTRY_STATES }),
      c("source", "Source", "enum", { options: { timesheet: "Timesheet", daily_report: "Daily Report", api: "API" } }),
      c("costAmount", "Cost", "currency", { financial: true }),
      c("billAmount", "Bill", "currency", { financial: true }),
      c("notes", "Notes", "text"),
    ],
  },
  expenses: {
    key: "expenses",
    label: "Expenses",
    defaultColumns: ["expenseDate", "userName", "projectCode", "expenseCode", "vendor", "amount", "state"],
    columns: [
      c("expenseDate", "Date", "date"),
      c("userName", "Person", "text"),
      c("projectCode", "Job #", "text"),
      c("projectName", "Job", "text"),
      c("expenseCode", "Expense Code", "text"),
      c("vendor", "Vendor", "text"),
      c("description", "Description", "text"),
      c("amount", "Amount", "currency", { financial: true }),
      c("billable", "Billable", "boolean"),
      c("state", "State", "enum", { options: ENTRY_STATES }),
    ],
  },
  logs: {
    key: "logs",
    label: "Log Items",
    defaultColumns: ["label", "title", "projectCode", "state", "assigneeName", "dueDate", "ageDays", "slaStatus"],
    columns: [
      c("label", "#", "text"),
      c("title", "Title", "text"),
      c("projectCode", "Job #", "text"),
      c("projectName", "Job", "text"),
      c("state", "State", "text"),
      c("stateCategory", "Open / Closed", "enum", { options: { start: "New", active: "Open", end: "Closed" } }),
      c("priority", "Priority", "enum", { options: PRIORITIES }),
      c("assigneeName", "Assignee", "text"),
      c("responsibleParty", "Responsible Party", "enum", { options: RESPONSIBLE_PARTIES }),
      c("dueDate", "Due", "date"),
      c("createdDate", "Created", "date"),
      c("ageDays", "Age (days)", "number"),
      c("slaStatus", "SLA", "enum", { options: { ok: "On Time", at_risk: "At Risk", delayed: "Delayed" } }),
      c("costImpact", "Cost Impact", "currency", { financial: true }),
      c("scheduleImpactDays", "Schedule Impact (d)", "number"),
      c("score", "Score", "number"),
    ],
  },
  deliveries: {
    key: "deliveries",
    label: "Fabricator Deliveries",
    defaultColumns: ["projectCode", "loadNumber", "sequence", "needDate", "promisedDate", "receivedDate", "tons", "status", "risk"],
    columns: [
      c("projectCode", "Job #", "text"),
      c("projectName", "Job", "text"),
      c("loadNumber", "Load #", "text"),
      c("sequence", "Sequence", "text"),
      c("fabricator", "Fabricator", "text"),
      c("needDate", "Need On Site", "date"),
      c("promisedDate", "Promised", "date"),
      c("shippedDate", "Shipped", "date"),
      c("receivedDate", "Received", "date"),
      c("tons", "Tons", "number"),
      c("pieces", "Pieces", "number"),
      c("ticketNumber", "Ticket #", "text"),
      c("status", "Status", "enum", { options: DELIVERY_STATUSES }),
      c("risk", "Risk", "enum", { options: { ok: "OK", at_risk: "At Risk", late: "Late", received: "Received" } }),
    ],
  },
  progress: {
    key: "progress",
    label: "Daily Progress (posted)",
    defaultColumns: ["reportDate", "projectCode", "sequence", "tons", "pieces"],
    columns: [
      c("reportDate", "Date", "date"),
      c("projectCode", "Job #", "text"),
      c("projectName", "Job", "text"),
      c("sequence", "Sequence", "text"),
      c("tons", "Tons Erected", "number"),
      c("pieces", "Pieces Erected", "number"),
      c("note", "Note", "text"),
    ],
  },
};

export const REPORT_ROW_CAP = 15000;
export const DASHBOARD_WIDGET_CAP = 10;
