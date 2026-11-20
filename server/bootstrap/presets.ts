import type { FieldOption, WfAppConfig } from "../../drizzle/schema";
import type { Privilege } from "@shared/domain";

/* ------------------------------------------------------------------ */
/* Security roles                                                      */
/* ------------------------------------------------------------------ */

const PM_PRIVS: Privilege[] = [
  "project.view",
  "project.edit",
  "project.financials",
  "project.manage_team",
  "task.edit",
  "task.progress",
  "baseline.manage",
  "delivery.edit",
  "dailyreport.create",
  "dailyreport.approve",
  "log.view",
  "log.create",
  "log.edit",
  "log.transition",
  "time.approve",
  "expense.approve",
  "document.upload",
  "comment.create",
];

export const ROLE_PRESETS: { key: string; name: string; description: string; grant: Privilege[]; deny?: Privilege[] }[] = [
  {
    key: "project_manager",
    name: "Project Manager",
    description: "Full control of the job: schedule, team, financials, logs, approvals. Auto-applied to the job PM.",
    grant: PM_PRIVS,
  },
  {
    key: "superintendent",
    name: "Superintendent",
    description: "Field lead: schedule edits, progress, deliveries, daily reports (create + approve), all logs.",
    grant: [
      "project.view",
      "task.edit",
      "task.progress",
      "delivery.edit",
      "dailyreport.create",
      "dailyreport.approve",
      "log.view",
      "log.create",
      "log.edit",
      "log.transition",
      "document.upload",
      "comment.create",
    ],
  },
  {
    key: "foreman",
    name: "Foreman",
    description: "Crew lead: progress updates, deliveries, daily reports, field logs.",
    grant: [
      "project.view",
      "task.progress",
      "delivery.edit",
      "dailyreport.create",
      "log.view",
      "log.create",
      "log.edit",
      "document.upload",
      "comment.create",
    ],
  },
  {
    key: "accounting",
    name: "Accounting",
    description: "Financials, time and expense approval, invoicing.",
    grant: ["project.view", "project.financials", "time.approve", "expense.approve", "log.view", "comment.create"],
  },
  {
    key: "viewer",
    name: "Job Viewer",
    description: "Read-only access to the job and its logs. Financials hidden.",
    grant: ["project.view", "log.view", "comment.create"],
    deny: ["project.financials"],
  },
  {
    key: "estimator",
    name: "Estimator",
    description: "Bid pipeline, job creation, reports. Assign globally.",
    grant: ["project.create", "bid.manage", "report.create", "resource.view"],
  },
  {
    key: "operations",
    name: "Operations Manager",
    description: "Portfolio-wide PM rights. Assign globally or per workspace.",
    grant: [...PM_PRIVS, "project.create", "report.create", "resource.view", "bid.manage"],
  },
  {
    key: "assignee",
    name: "Task Assignee (auto)",
    description: "Auto-applied to anyone assigned to a task on the job.",
    grant: ["project.view", "task.progress", "log.view", "log.create", "comment.create"],
  },
];

/* ------------------------------------------------------------------ */
/* Codes, roles, calendars                                             */
/* ------------------------------------------------------------------ */

export const JOB_ROLE_PRESETS = [
  { name: "Project Manager", costRate: 68, billRate: 115 },
  { name: "Superintendent", costRate: 60, billRate: 98 },
  { name: "Foreman", costRate: 54, billRate: 90 },
  { name: "Journeyman Ironworker", costRate: 47, billRate: 80 },
  { name: "Apprentice Ironworker", costRate: 31, billRate: 58 },
  { name: "Crane Operator", costRate: 56, billRate: 95 },
  { name: "Welder", costRate: 49, billRate: 84 },
  { name: "Oiler", costRate: 40, billRate: 66 },
];

export const TIME_CODE_PRESETS = [
  { name: "Regular", billable: true, multiplier: 1 },
  { name: "Overtime", billable: true, multiplier: 1.5 },
  { name: "Standby / Delay", billable: true, multiplier: 1 },
  { name: "T&M Extra Work", billable: true, multiplier: 1 },
  { name: "Travel", billable: false, multiplier: 1 },
  { name: "Yard / Shop", billable: false, multiplier: 1 },
];

export const EXPENSE_CODE_PRESETS = [
  { name: "Crane Rental", billable: true, costable: true },
  { name: "Equipment Rental", billable: true, costable: true },
  { name: "Fuel", billable: true, costable: true },
  { name: "Bolts & Consumables", billable: true, costable: true },
  { name: "Welding Supplies", billable: true, costable: true },
  { name: "Per Diem", billable: false, costable: true },
  { name: "Mileage", billable: false, costable: true },
  { name: "Freight", billable: true, costable: true },
  { name: "Permits", billable: true, costable: true },
];

export const PROJECT_TYPE_PRESETS = [
  "K-12",
  "University",
  "Industrial",
  "Shade Structure",
  "Commercial",
  "Healthcare",
  "Stairs & Misc. Steel",
];

/* ------------------------------------------------------------------ */
/* Workflow logs                                                       */
/* ------------------------------------------------------------------ */

export type FieldPreset = {
  key: string;
  label: string;
  fieldType: string;
  options?: FieldOption[];
  formula?: string;
  isFinancial?: boolean;
  required?: boolean;
  showInList?: boolean;
  helpText?: string;
};

export type AppPreset = {
  key: string;
  name: string;
  pluralName: string;
  numberPrefix: string;
  description: string;
  color: string;
  icon: string;
  scope: "project" | "global";
  dueDateLabel: string;
  allowTimeLogging?: boolean;
  scoreFormula?: string;
  config?: WfAppConfig;
  states: { name: string; category: "start" | "active" | "end"; color: string }[];
  transitions: { from: string; to: string; name: string }[];
  sla?: {
    state: string;
    source: "fixed" | "project_notice" | "due_date";
    hours?: number;
    action?: "mark_delayed" | "transition";
    to?: string;
    priority?: string;
  }[];
  fields: FieldPreset[];
};

const opts = (pairs: [string, string, string?][]): FieldOption[] =>
  pairs.map(([value, label, color]) => ({ value, label, ...(color ? { color } : {}) }));

const C = {
  gray: "#6B7280",
  blue: "#2563EB",
  amber: "#D97706",
  green: "#16A34A",
  red: "#DC2626",
  violet: "#7C3AED",
  slate: "#334155",
  orange: "#E8590C",
};

export const APP_PRESETS: AppPreset[] = [
  {
    key: "rfi",
    name: "RFI",
    pluralName: "RFIs",
    numberPrefix: "RFI",
    description: "Requests for information to the GC, architect or EOR. One issue per RFI; always reference sheets/details and state schedule impact.",
    color: C.blue,
    icon: "help-circle",
    scope: "project",
    dueDateLabel: "Required Response Date",
    states: [
      { name: "Draft", category: "start", color: C.gray },
      { name: "Submitted", category: "active", color: C.blue },
      { name: "Answered", category: "active", color: C.violet },
      { name: "Closed", category: "end", color: C.green },
      { name: "Void", category: "end", color: C.slate },
    ],
    transitions: [
      { from: "Draft", to: "Submitted", name: "Submit" },
      { from: "Submitted", to: "Answered", name: "Record Answer" },
      { from: "Answered", to: "Closed", name: "Close" },
      { from: "Answered", to: "Submitted", name: "Follow-up" },
      { from: "Draft", to: "Void", name: "Void" },
      { from: "Submitted", to: "Void", name: "Void" },
    ],
    sla: [{ state: "Submitted", source: "due_date" }],
    fields: [
      { key: "to_party", label: "To (GC PM / Architect / EOR)", fieldType: "text", showInList: true },
      { key: "reference", label: "Reference (Sheet / Detail / Spec)", fieldType: "text", showInList: true, required: true },
      { key: "question", label: "Question", fieldType: "richtext", required: true, helpText: "Clear description of the conflict or missing information. One issue per RFI." },
      { key: "proposed_solution", label: "Proposed Solution", fieldType: "richtext" },
      { key: "affected_area", label: "Schedule Impact — Sequence / Area", fieldType: "text" },
      { key: "days_at_risk", label: "Schedule Impact — Days at Risk", fieldType: "number" },
      { key: "cost_impact", label: "Potential Cost Impact", fieldType: "select", options: opts([["yes", "Yes", C.red], ["no", "No", C.green], ["tbd", "TBD", C.amber]]) },
      { key: "attachments_ref", label: "Attachments (markups, photos, shop dwg excerpts)", fieldType: "text" },
      { key: "answer", label: "Response", fieldType: "richtext" },
      { key: "answered_by", label: "Answered By", fieldType: "text" },
    ],
    config: { scheduleField: "days_at_risk" },
  },
  {
    key: "submittal",
    name: "Submittal",
    pluralName: "Submittals",
    numberPrefix: "SUB",
    description: "Erector submittals: erection drawings, means & methods, lift plans, welding procedures, certifications.",
    color: C.violet,
    icon: "stamp",
    scope: "project",
    dueDateLabel: "Response Due",
    states: [
      { name: "Preparing", category: "start", color: C.gray },
      { name: "Submitted", category: "active", color: C.blue },
      { name: "Approved", category: "active", color: C.green },
      { name: "Approved as Noted", category: "active", color: "#65A30D" },
      { name: "Revise & Resubmit", category: "active", color: C.amber },
      { name: "Rejected", category: "active", color: C.red },
      { name: "Closed", category: "end", color: C.slate },
    ],
    transitions: [
      { from: "Preparing", to: "Submitted", name: "Submit" },
      { from: "Submitted", to: "Approved", name: "Approved" },
      { from: "Submitted", to: "Approved as Noted", name: "Approved as Noted" },
      { from: "Submitted", to: "Revise & Resubmit", name: "Revise & Resubmit" },
      { from: "Submitted", to: "Rejected", name: "Rejected" },
      { from: "Revise & Resubmit", to: "Submitted", name: "Resubmit" },
      { from: "Rejected", to: "Preparing", name: "Rework" },
      { from: "Approved", to: "Closed", name: "Close" },
      { from: "Approved as Noted", to: "Closed", name: "Close" },
    ],
    sla: [{ state: "Submitted", source: "fixed", hours: 240 }],
    fields: [
      { key: "spec_section", label: "Spec Section", fieldType: "text", showInList: true },
      {
        key: "submittal_type",
        label: "Type",
        fieldType: "select",
        showInList: true,
        options: opts([
          ["erection_drawings", "Erection Drawings"],
          ["means_methods", "Means & Methods"],
          ["erection_plan", "Erection Plan / Sequence"],
          ["crane_lift_plan", "Crane Lift Plan"],
          ["welding_procedures", "Welding Procedures (WPS)"],
          ["certifications", "Certifications (AWS / Rigging)"],
          ["safety_plan", "Site Safety Plan"],
          ["other", "Other"],
        ]),
      },
      { key: "revision", label: "Revision", fieldType: "text", showInList: true },
      { key: "submitted_to", label: "Submitted To", fieldType: "text" },
      { key: "reviewer_comments", label: "Reviewer Comments", fieldType: "richtext" },
    ],
  },
  {
    key: "co",
    name: "Change Order",
    pluralName: "Change Orders",
    numberPrefix: "CO",
    description: "Change orders and T&M tickets. Notice must go out within the contract notice window.",
    color: C.orange,
    icon: "file-diff",
    scope: "project",
    dueDateLabel: "Pricing Due",
    states: [
      { name: "Identified", category: "start", color: C.gray },
      { name: "Pricing", category: "active", color: C.amber },
      { name: "Submitted", category: "active", color: C.blue },
      { name: "Approved", category: "active", color: C.green },
      { name: "Rejected", category: "end", color: C.red },
      { name: "Billed", category: "end", color: C.slate },
    ],
    transitions: [
      { from: "Identified", to: "Pricing", name: "Start Pricing" },
      { from: "Identified", to: "Submitted", name: "Submit" },
      { from: "Pricing", to: "Submitted", name: "Submit" },
      { from: "Submitted", to: "Approved", name: "Approved" },
      { from: "Submitted", to: "Rejected", name: "Rejected" },
      { from: "Submitted", to: "Pricing", name: "Revise" },
      { from: "Approved", to: "Billed", name: "Billed" },
    ],
    sla: [
      { state: "Identified", source: "project_notice" },
      { state: "Pricing", source: "project_notice" },
    ],
    fields: [
      { key: "co_type", label: "CO Type", fieldType: "select", showInList: true, options: opts([["tm", "T&M"], ["lump_sum", "Lump Sum"], ["unit", "Unit Price"]]) },
      { key: "gc_co_number", label: "GC CO / PCO #", fieldType: "text", showInList: true },
      { key: "reason", label: "Reason / Scope", fieldType: "richtext", required: true },
      { key: "amount_requested", label: "Amount Requested", fieldType: "currency", isFinancial: true, showInList: true },
      { key: "amount_approved", label: "Amount Approved", fieldType: "currency", isFinancial: true, showInList: true },
      { key: "schedule_days", label: "Schedule Days", fieldType: "number" },
    ],
    config: { costField: "amount_requested", approvedField: "amount_approved", scheduleField: "schedule_days" },
  },
  {
    key: "delay",
    name: "Delay Notice",
    pluralName: "Delay Notices",
    numberPrefix: "DN",
    description: "Delay / standby documentation. Goes Delayed when the contract notice window is exceeded.",
    color: C.red,
    icon: "alarm-clock",
    scope: "project",
    dueDateLabel: "Notice Deadline",
    states: [
      { name: "Identified", category: "start", color: C.amber },
      { name: "Notice Sent", category: "active", color: C.blue },
      { name: "Acknowledged", category: "active", color: C.violet },
      { name: "Disputed", category: "active", color: C.red },
      { name: "Resolved", category: "end", color: C.green },
    ],
    transitions: [
      { from: "Identified", to: "Notice Sent", name: "Send Notice" },
      { from: "Notice Sent", to: "Acknowledged", name: "Acknowledged" },
      { from: "Notice Sent", to: "Disputed", name: "Disputed" },
      { from: "Acknowledged", to: "Resolved", name: "Resolve" },
      { from: "Acknowledged", to: "Disputed", name: "Disputed" },
      { from: "Disputed", to: "Resolved", name: "Resolve" },
    ],
    sla: [{ state: "Identified", source: "project_notice" }],
    fields: [
      { key: "event_date", label: "Event Date", fieldType: "date", required: true, showInList: true },
      { key: "event_time", label: "Event Time", fieldType: "text" },
      { key: "notified_party", label: "Notified (name / company / method)", fieldType: "text" },
      { key: "location", label: "Location (grid / level / area)", fieldType: "text", showInList: true },
      {
        key: "cause",
        label: "Cause",
        fieldType: "select",
        showInList: true,
        required: true,
        options: opts([
          ["late_delivery", "Late Delivery", C.red],
          ["fab_error", "Fabrication Error", C.red],
          ["ab_tolerance", "AB Out of Tolerance", C.amber],
          ["access_not_ready", "Access Not Ready", C.amber],
          ["design_conflict", "Design Conflict", C.violet],
          ["weather", "Weather", C.blue],
          ["other", "Other", C.gray],
        ]),
      },
      { key: "crew_size", label: "Crew Size", fieldType: "number" },
      { key: "crew_hours_lost", label: "Crew Hours Lost", fieldType: "decimal" },
      { key: "crane_standby_hours", label: "Crane Standby Hours", fieldType: "decimal" },
      { key: "labor_rate", label: "Blended Labor Rate ($/hr)", fieldType: "currency", isFinancial: true },
      { key: "crane_rate", label: "Crane Standby Rate ($/hr)", fieldType: "currency", isFinancial: true },
      {
        key: "est_cost",
        label: "Estimated Cost Impact",
        fieldType: "formula",
        formula: "roundTo(me.crew_hours_lost * me.labor_rate + me.crane_standby_hours * me.crane_rate, 2)",
        isFinancial: true,
        showInList: true,
      },
      { key: "schedule_days", label: "Schedule Impact (days)", fieldType: "number" },
      { key: "affected_sequences", label: "Affected Sequences", fieldType: "text" },
      { key: "references", label: "Photos / Docs (delivery tickets, survey, RFIs)", fieldType: "text" },
      { key: "direction_requested", label: "Request for Direction / T&M or CO Approval", fieldType: "richtext" },
    ],
    config: { costField: "est_cost", scheduleField: "schedule_days" },
  },
  {
    key: "backcharge",
    name: "Backcharge",
    pluralName: "Backcharges",
    numberPrefix: "BC",
    description: "Costs caused by others (fab errors, detailing errors, missing material, field fixes) to recover.",
    color: "#B45309",
    icon: "receipt",
    scope: "project",
    dueDateLabel: "Submit By",
    states: [
      { name: "Documenting", category: "start", color: C.gray },
      { name: "Submitted", category: "active", color: C.blue },
      { name: "Accepted", category: "active", color: C.green },
      { name: "Disputed", category: "active", color: C.red },
      { name: "Recovered", category: "end", color: C.slate },
      { name: "Withdrawn", category: "end", color: C.gray },
    ],
    transitions: [
      { from: "Documenting", to: "Submitted", name: "Submit" },
      { from: "Submitted", to: "Accepted", name: "Accepted" },
      { from: "Submitted", to: "Disputed", name: "Disputed" },
      { from: "Disputed", to: "Accepted", name: "Accepted" },
      { from: "Accepted", to: "Recovered", name: "Recovered" },
      { from: "Documenting", to: "Withdrawn", name: "Withdraw" },
      { from: "Disputed", to: "Withdrawn", name: "Withdraw" },
    ],
    sla: [{ state: "Documenting", source: "project_notice" }],
    fields: [
      {
        key: "cause",
        label: "Cause",
        fieldType: "select",
        showInList: true,
        options: opts([
          ["fab_error", "Fabrication Error"],
          ["detailing_error", "Detailing Error"],
          ["missing_material", "Missing Material"],
          ["field_fix", "Field Fix"],
          ["other", "Other"],
        ]),
      },
      { key: "piece_marks", label: "Piece Marks / Location", fieldType: "text", showInList: true },
      { key: "labor_hours", label: "Labor Hours", fieldType: "decimal" },
      { key: "labor_cost", label: "Labor $", fieldType: "currency", isFinancial: true },
      { key: "equipment_cost", label: "Equipment $", fieldType: "currency", isFinancial: true },
      { key: "material_cost", label: "Material $", fieldType: "currency", isFinancial: true },
      { key: "total", label: "Total", fieldType: "formula", formula: "me.labor_cost + me.equipment_cost + me.material_cost", isFinancial: true, showInList: true },
      { key: "recovered_amount", label: "Recovered $", fieldType: "currency", isFinancial: true },
    ],
    config: { costField: "total", approvedField: "recovered_amount" },
  },
  {
    key: "delivery_issue",
    name: "Delivery Issue",
    pluralName: "Delivery Issues",
    numberPrefix: "DI",
    description: "Short, damaged, wrong or out-of-sequence loads from the fabricator.",
    color: "#0E7490",
    icon: "truck",
    scope: "project",
    dueDateLabel: "Fabricator Response Due",
    states: [
      { name: "Reported", category: "start", color: C.amber },
      { name: "Fabricator Notified", category: "active", color: C.blue },
      { name: "Resolved", category: "end", color: C.green },
    ],
    transitions: [
      { from: "Reported", to: "Fabricator Notified", name: "Notify Fabricator" },
      { from: "Fabricator Notified", to: "Resolved", name: "Resolve" },
      { from: "Reported", to: "Resolved", name: "Resolve" },
    ],
    sla: [{ state: "Reported", source: "fixed", hours: 24 }],
    fields: [
      { key: "load_number", label: "Load #", fieldType: "text", showInList: true },
      {
        key: "issue_type",
        label: "Issue",
        fieldType: "select",
        showInList: true,
        options: opts([
          ["short", "Short"],
          ["damaged", "Damaged"],
          ["wrong_piece", "Wrong Piece"],
          ["late", "Late"],
          ["out_of_sequence", "Out of Sequence"],
        ]),
      },
      { key: "piece_marks", label: "Piece Marks", fieldType: "text" },
      { key: "pieces_affected", label: "Pieces Affected", fieldType: "number", showInList: true },
    ],
  },
  {
    key: "safety",
    name: "Safety Observation",
    pluralName: "Safety Observations",
    numberPrefix: "SAF",
    description: "Hazards, near misses, incidents and good catches.",
    color: "#CA8A04",
    icon: "hard-hat",
    scope: "project",
    dueDateLabel: "Correct By",
    states: [
      { name: "Open", category: "start", color: C.amber },
      { name: "Corrected", category: "active", color: C.blue },
      { name: "Closed", category: "end", color: C.green },
    ],
    transitions: [
      { from: "Open", to: "Corrected", name: "Corrected" },
      { from: "Corrected", to: "Closed", name: "Close" },
      { from: "Corrected", to: "Open", name: "Re-open" },
    ],
    sla: [{ state: "Open", source: "fixed", hours: 24, priority: "critical" }],
    fields: [
      {
        key: "observation_type",
        label: "Type",
        fieldType: "select",
        showInList: true,
        options: opts([["hazard", "Hazard"], ["near_miss", "Near Miss"], ["incident", "Incident"], ["good_catch", "Good Catch"]]),
      },
      { key: "location", label: "Location", fieldType: "text", showInList: true },
      { key: "corrective_action", label: "Corrective Action", fieldType: "richtext" },
      { key: "injured_person", label: "Injured Person (incidents)", fieldType: "text" },
      {
        key: "treatment",
        label: "Treatment",
        fieldType: "select",
        options: opts([["none", "None"], ["first_aid", "First Aid"], ["medical", "Medical Treatment"], ["lost_time", "Lost Time"]]),
      },
      { key: "osha_recordable", label: "OSHA Recordable", fieldType: "select", showInList: true, options: opts([["yes", "Yes", C.red], ["no", "No", C.green], ["tbd", "TBD", C.amber]]) },
      { key: "days_away", label: "Days Away From Work", fieldType: "number" },
      { key: "reported_to_gc_on", label: "Reported to GC On", fieldType: "date" },
    ],
  },
  {
    key: "punch",
    name: "Punch Item",
    pluralName: "Punch List",
    numberPrefix: "PL",
    description: "Punch list items for the erector's scope.",
    color: C.slate,
    icon: "list-checks",
    scope: "project",
    dueDateLabel: "Due",
    states: [
      { name: "Open", category: "start", color: C.amber },
      { name: "Ready for Review", category: "active", color: C.blue },
      { name: "Closed", category: "end", color: C.green },
    ],
    transitions: [
      { from: "Open", to: "Ready for Review", name: "Ready for Review" },
      { from: "Ready for Review", to: "Closed", name: "Close" },
      { from: "Ready for Review", to: "Open", name: "Reject" },
    ],
    fields: [
      { key: "location", label: "Location (grid / level)", fieldType: "text", showInList: true },
      {
        key: "punch_scope",
        label: "Scope",
        fieldType: "select",
        showInList: true,
        options: opts([["erector", "Erector"], ["fabricator", "Fabricator"], ["other_trade", "Other Trade"]]),
      },
    ],
  },
  {
    key: "risk",
    name: "Risk",
    pluralName: "Risks",
    numberPrefix: "RSK",
    description: "Job risks with probability × impact exposure.",
    color: "#9333EA",
    icon: "shield-alert",
    scope: "project",
    dueDateLabel: "Review By",
    states: [
      { name: "Identified", category: "start", color: C.amber },
      { name: "Mitigating", category: "active", color: C.blue },
      { name: "Closed", category: "end", color: C.green },
    ],
    transitions: [
      { from: "Identified", to: "Mitigating", name: "Mitigate" },
      { from: "Mitigating", to: "Closed", name: "Close" },
      { from: "Identified", to: "Closed", name: "Close" },
    ],
    fields: [
      { key: "probability", label: "Probability (1–5)", fieldType: "number", showInList: true },
      { key: "impact", label: "Impact (1–5)", fieldType: "number", showInList: true },
      { key: "exposure", label: "Exposure", fieldType: "formula", formula: "me.probability * me.impact", showInList: true },
      { key: "mitigation", label: "Mitigation Plan", fieldType: "richtext" },
    ],
  },
  {
    key: "bid",
    name: "Bid",
    pluralName: "Bid Pipeline",
    numberPrefix: "BID",
    description: "Opportunity intake. Weighted score ranks bids; convert awarded bids to jobs.",
    color: "#0F766E",
    icon: "target",
    scope: "global",
    dueDateLabel: "Bid Due",
    scoreFormula:
      "roundTo(me.win_probability * 0.4 + me.strategic_fit * 6 + (5 - me.risk_rating) * 4 + min(me.est_margin_pct, 30) * 0.5, 1)",
    states: [
      { name: "Lead", category: "start", color: C.gray },
      { name: "Estimating", category: "active", color: C.amber },
      { name: "Bid Submitted", category: "active", color: C.blue },
      { name: "Awarded", category: "active", color: C.green },
      { name: "Converted", category: "end", color: C.slate },
      { name: "Lost", category: "end", color: C.red },
      { name: "No Bid", category: "end", color: C.gray },
    ],
    transitions: [
      { from: "Lead", to: "Estimating", name: "Estimate" },
      { from: "Lead", to: "No Bid", name: "No Bid" },
      { from: "Estimating", to: "Bid Submitted", name: "Submit Bid" },
      { from: "Estimating", to: "No Bid", name: "No Bid" },
      { from: "Bid Submitted", to: "Awarded", name: "Awarded" },
      { from: "Bid Submitted", to: "Lost", name: "Lost" },
    ],
    config: { convertStates: ["Awarded"], convertToStateName: "Converted", costField: "est_value" },
    fields: [
      { key: "gc_name", label: "GC", fieldType: "text", showInList: true },
      {
        key: "project_type",
        label: "Job Type",
        fieldType: "select",
        showInList: true,
        options: PROJECT_TYPE_PRESETS.map(p => ({ value: p, label: p })),
      },
      { key: "location", label: "Location", fieldType: "text" },
      { key: "est_tons", label: "Est. Tons", fieldType: "decimal", showInList: true },
      { key: "est_value", label: "Est. Contract Value", fieldType: "currency", isFinancial: true, showInList: true },
      { key: "est_margin_pct", label: "Est. Margin %", fieldType: "decimal", isFinancial: true },
      { key: "win_probability", label: "Win Probability %", fieldType: "number" },
      { key: "strategic_fit", label: "Strategic Fit (1–5)", fieldType: "number" },
      { key: "risk_rating", label: "Risk (1–5)", fieldType: "number" },
      { key: "scope_notes", label: "Scope / Exclusions Notes", fieldType: "richtext" },
    ],
  },
];
