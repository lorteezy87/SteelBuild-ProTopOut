/**
 * Shared domain constants used by both client and server.
 */

/* ------------------------------------------------------------------ */
/* Privileges                                                          */
/* ------------------------------------------------------------------ */

export const PROJECT_PRIVILEGES = {
  "project.view": "View job",
  "project.edit": "Edit job details & schedule settings",
  "project.delete": "Delete job",
  "project.financials": "View & edit job financials",
  "project.manage_team": "Manage job team & roles",
  "task.edit": "Create / edit / delete tasks & dependencies",
  "task.progress": "Update task progress",
  "baseline.manage": "Save & activate baselines",
  "delivery.edit": "Edit fabricator deliveries",
  "dailyreport.create": "Create daily field reports",
  "dailyreport.approve": "Approve daily field reports",
  "log.view": "View logs (RFIs, submittals, COs, notices...)",
  "log.create": "Create log items",
  "log.edit": "Edit log items",
  "log.transition": "Move log items through workflow",
  "time.approve": "Approve time entries",
  "expense.approve": "Approve expenses",
  "document.upload": "Upload documents & revisions",
  "comment.create": "Comment",
} as const;

export const GLOBAL_PRIVILEGES = {
  "project.create": "Create jobs",
  "bid.manage": "Manage bid pipeline",
  "report.create": "Create & share reports",
  "resource.view": "View resource workload",
} as const;

export type ProjectPrivilege = keyof typeof PROJECT_PRIVILEGES;
export type GlobalPrivilege = keyof typeof GLOBAL_PRIVILEGES;
export type Privilege = ProjectPrivilege | GlobalPrivilege;

export const ALL_PRIVILEGES = { ...PROJECT_PRIVILEGES, ...GLOBAL_PRIVILEGES };

/* ------------------------------------------------------------------ */
/* Access types (license tiers)                                        */
/* ------------------------------------------------------------------ */

export const ACCESS_TYPES = {
  full: "Full",
  team_member: "Team Member",
  timesheet: "Timesheet Only",
  app_only: "Logs Only",
  passive: "Passive (no login)",
} as const;
export type AccessType = keyof typeof ACCESS_TYPES;

/** Maximum privileges each access type can ever receive, regardless of roles. */
export const ACCESS_TYPE_CAPS: Record<AccessType, Privilege[] | "all"> = {
  full: "all",
  team_member: [
    "project.view",
    "task.progress",
    "delivery.edit",
    "dailyreport.create",
    "log.view",
    "log.create",
    "log.edit",
    "log.transition",
    "document.upload",
    "comment.create",
    "resource.view",
  ],
  timesheet: [],
  app_only: ["project.view", "log.view", "log.create", "log.edit", "log.transition", "comment.create"],
  passive: [],
};

/* ------------------------------------------------------------------ */
/* Steel domain vocab                                                  */
/* ------------------------------------------------------------------ */

export const COMPANY_TYPES = {
  gc: "General Contractor",
  fabricator: "Fabricator",
  detailer: "Detailer",
  eor: "Engineer of Record",
  architect: "Architect",
  owner: "Owner",
  crane_rental: "Crane Rental",
  supplier: "Supplier",
  other: "Other",
} as const;

export const PROJECT_COMPANY_ROLES = {
  gc: "GC",
  fabricator: "Fabricator",
  detailer: "Detailer",
  eor: "EOR",
  architect: "Architect",
  owner: "Owner",
} as const;

export const RESPONSIBLE_PARTIES = {
  erector: "Erector",
  fabricator: "Fabricator",
  detailer: "Detailer",
  gc: "GC",
  eor: "EOR",
  architect: "Architect",
  owner: "Owner",
  other: "Other",
} as const;

export const PROJECT_STATES = {
  draft: "Draft",
  active: "Active",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
} as const;

export const CONTRACT_TYPES = { lump_sum: "Lump Sum", unit_price: "Unit Price", tm: "T&M" } as const;

export const PROGRESS_METHODS = {
  tonnage: "Tonnage (tons erected)",
  pieces: "Pieces erected",
  duration: "Duration-weighted",
  effort: "Effort-weighted",
} as const;

export const TASK_KINDS = { task: "Task", milestone: "Milestone", sequence: "Erection Sequence" } as const;
export const TASK_STATUSES = {
  not_started: "Not Started",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
} as const;
export const PRIORITIES = { low: "Low", normal: "Normal", high: "High", critical: "Critical" } as const;
export const CONSTRAINT_TYPES = {
  asap: "As Soon As Possible",
  snet: "Start No Earlier Than",
  fnlt: "Finish No Later Than",
  mso: "Must Start On",
  mfo: "Must Finish On",
} as const;
export const DEP_TYPES = { FS: "Finish → Start", SS: "Start → Start", FF: "Finish → Finish", SF: "Start → Finish" } as const;

export const DELIVERY_STATUSES = {
  scheduled: "Scheduled",
  shipped: "Shipped",
  received: "Received",
  received_short: "Received Short",
  damaged: "Damaged",
} as const;

export const EQUIPMENT_TYPES = {
  crane: "Crane",
  lift: "Aerial Lift",
  welder: "Welder",
  forklift: "Forklift / Telehandler",
  compressor: "Compressor",
  other: "Other",
} as const;

export const DOCUMENT_CATEGORIES = {
  contract_drawings: "Contract Drawings",
  erection_drawings: "Erection Drawings",
  shop_drawings: "Shop Drawings",
  specifications: "Specifications",
  delivery_tickets: "Delivery Tickets",
  ab_survey: "AB Survey",
  photos: "Photos",
  correspondence: "Correspondence",
  other: "Other",
} as const;

export const SCHEDULE_HEALTH = {
  delayed: "Delayed",
  at_risk: "At Risk",
  on_track: "On Track",
  blocked: "Blocked",
  future: "Future",
  done: "Done",
  not_active: "Not Active",
} as const;

export const COST_HEALTH = {
  overbudget: "Overbudget",
  at_risk: "At Risk",
  on_track: "On Track",
  not_active: "Not Active",
} as const;

export const FIELD_TYPES = {
  text: "Text",
  richtext: "Long Text",
  number: "Number",
  decimal: "Decimal",
  currency: "Currency",
  date: "Date",
  boolean: "Yes / No",
  select: "Single Select",
  multiselect: "Multi Select",
  user: "User",
  formula: "Formula",
} as const;
export type FieldType = keyof typeof FIELD_TYPES;

export const WEBHOOK_ENTITIES = ["project", "task", "timeEntry", "expense", "logItem", "delivery", "dailyReport"] as const;
export const WEBHOOK_ACTIONS = ["add", "update", "delete"] as const;
