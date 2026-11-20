export type ApiResource = {
  key: string;
  label: string;
  description: string;
  columns: string;
  create?: {
    required: string;
    optional: string;
    example: Record<string, unknown>;
    permission: string;
  };
  patch?: {
    fields: string;
    example: Record<string, unknown>;
    permission: string;
  };
  delete?: string;
  note?: string;
};
export const API_RESOURCES: ApiResource[] = [
  {
    key: "jobs",
    label: "Jobs",
    description:
      "Visible jobs, with portfolio-style schedule, cost and tonnage columns. The REST resource is jobs, not projects.",
    columns:
      "id, code, name, state, projectType, priority, managerName, workspaceName, gcName, fabricatorName, startDate, deadline, plannedFinish, projectedFinish, percentComplete, scheduleHealth, costHealth, contractType, contractValue, budget, actualCost, projectedCost, plannedValue, earnedValue, totalTons, erectedTons, totalPieces, cf_<key>",
    create: {
      required: "name (1–255 characters)",
      optional:
        "code, description, workspaceId, state, projectType, priority, managerId, calendarId, startDate, deadline, contractType, contractValue, budget, totalTons, totalPieces, retainagePct, noticeHours, siteAddress, progressMethod, customFields, template (blank|erection, default erection), sequenceCount (1–40, default 4), companies [{companyId, role}], fromBidItemId",
      example: {
        name: "Phoenix erection job",
        code: "PHX-401",
        state: "draft",
        progressMethod: "tonnage",
        template: "blank",
      },
      permission: "project.create",
    },
    patch: {
      fields:
        "Same job fields as create except template, sequenceCount, companies and fromBidItemId. name is optional for PATCH; the URL supplies id. Company-link replacement is not exposed in REST v2.",
      example: { deadline: "2026-12-18", state: "active" },
      permission: "project.edit; financial fields require project.financials",
    },
    note: "GET returns names for manager, workspace and linked companies, rather than every ID accepted by writes. DELETE jobs is not implemented. State: draft|active|on_hold|completed|cancelled. Contract: lump_sum|unit_price|tm. Progress: tonnage|pieces|duration|effort.",
  },
  {
    key: "tasks",
    label: "Tasks & erection sequences",
    description:
      "Tasks across jobs visible to the token owner. Use projectId in the JSON filter to select one job.",
    columns:
      "id, projectId, projectCode, projectName, wbs, name, kind, status, priority, assignees, location, startDate, finishDate, actualStart, actualFinish, projectedFinish, durationDays, effortHours, percentComplete, scheduleHealth, isCritical, totalFloat, plannedTons, erectedTons, plannedPieces, erectedPieces, budgetCost, cf_<key>",
    create: {
      required: "projectId (positive integer), name (1–255 characters)",
      optional:
        "parentId, afterId, kind (task|milestone|sequence, default task), durationDays (0–2000), startDate, plannedTons, plannedPieces, location",
      example: {
        projectId: 1,
        name: "East wing steel",
        kind: "sequence",
        plannedTons: 75,
        durationDays: 5,
        location: "Grid A–D / Level 2",
      },
      permission: "task.edit",
    },
    patch: {
      fields:
        "name, description, kind, priority, schedulingMode (auto|manual), constraintType (asap|snet|fnlt|mso|mfo), constraintDate, startDate, finishDate, durationDays, effortHours, budgetCost, location, plannedTons, plannedPieces, status, percentComplete, actualStart, actualFinish, erectedTons, erectedPieces, customFields",
      example: { percentComplete: 40, status: "in_progress" },
      permission:
        "task.edit for task details; task.progress for progress fields; financial values require project.financials",
    },
    delete:
      "task.edit. Deletes the task subtree and associated records; use carefully.",
    note: "Status: not_started|in_progress|blocked|done. GET kind may be summary. Assignment, dependency, checklist and reorder endpoints are not exposed by REST v2. customFields can be set with PATCH, not task POST.",
  },
  {
    key: "timeEntries",
    label: "Time entries",
    description:
      "Read-only. Includes the owner's entries plus entries on visible jobs where the owner can approve time or view financials.",
    columns:
      "id, entryDate, userName, jobRole, projectCode, projectName, taskName, timeCode, hours, state, source, costAmount, billAmount, notes",
    note: "POST, PATCH and DELETE are not implemented. Use the timesheet and approval screens to enter and approve time. This projection uses display names and does not return projectId, taskId or userId.",
  },
  {
    key: "expenses",
    label: "Expenses",
    description:
      "Read-only. Includes the owner's expenses plus expenses on visible jobs where the owner can approve expenses or view financials.",
    columns:
      "id, expenseDate, userName, projectCode, projectName, expenseCode, vendor, description, amount, billable, state",
    note: "POST, PATCH and DELETE are not implemented. Receipt uploads, expense lines and approval actions are not exposed in this API.",
  },
  {
    key: "logItems",
    label: "Workflow log items",
    description:
      "RFIs, submittals, COs, notices and other workflow items. Add ?app=rfi to read one app; omitting app reads all accessible apps.",
    columns:
      "id, label, title, projectCode, projectName, state, stateCategory, priority, assigneeName, responsibleParty, dueDate, createdDate, ageDays, slaStatus, costImpact, scheduleImpactDays, score, cf_<key>, app",
    create: {
      required: "appKey, title (1–255 characters); projectId for a per-job app",
      optional:
        "projectId (omit/null for global apps), description, priority, assigneeId, responsibleParty, dueDate, linkedTaskId, linkedDeliveryId, customFields",
      example: {
        appKey: "rfi",
        projectId: 1,
        title: "Confirm beam-seat elevation",
        responsibleParty: "eor",
        priority: "high",
        dueDate: "2026-11-20",
      },
      permission: "log.create on the job; bid.manage for global apps",
    },
    patch: {
      fields:
        "title, description, priority, assigneeId, responsibleParty, dueDate, linkedTaskId, linkedDeliveryId, customFields",
      example: {
        title: "Confirm beam-seat elevation — revised",
        priority: "critical",
      },
      permission: "log.edit on the job; bid.manage for global apps",
    },
    delete: "log.edit on the job; bid.manage for global apps.",
    note: "Use appKey in POST JSON, but app in the GET query. Unknown app keys return 404. state/stateId cannot be changed through PATCH; workflow transitions and bid conversion are not exposed in REST v2. Responsible party: erector|fabricator|detailer|gc|eor|architect|owner|other.",
  },
  {
    key: "deliveries",
    label: "Fabricator deliveries",
    description:
      "Load status and delivery risk across visible jobs. Fabrication is by others.",
    columns:
      "id, projectCode, projectName, loadNumber, sequence, fabricator, needDate, promisedDate, shippedDate, receivedDate, tons, pieces, ticketNumber, status, risk",
    create: {
      required: "projectId, loadNumber (1–32 characters)",
      optional:
        "sequenceTaskId, description, fabricatorCompanyId, needDate, promisedDate, shippedDate, receivedDate, tons, pieces, ticketNumber, status, shortageNotes",
      example: {
        projectId: 1,
        loadNumber: "LOAD-017",
        needDate: "2026-11-19",
        promisedDate: "2026-11-18",
        tons: 22,
        pieces: 64,
      },
      permission: "delivery.edit",
    },
    patch: {
      fields:
        "Same delivery fields as POST; the existing record supplies omitted required fields. projectId is inferred from the record when omitted.",
      example: { receivedDate: "2026-11-18", ticketNumber: "DT-017" },
      permission: "delivery.edit",
    },
    delete: "delivery.edit.",
    note: "Status: scheduled|shipped|received|received_short|damaged. On create, needDate can default from sequence start minus org lead work days; fabricator can default from job links. Date changes can automatically advance status to shipped/received. Delay-notice creation is not a REST endpoint.",
  },
  {
    key: "dailyReports",
    label: "Daily field reports",
    description:
      "Read-only report headers for visible jobs. Crew, equipment and progress line sub-resources are not included.",
    columns:
      "id, projectId, reportDate, foremanId, weather, temperature, workPerformed, safetyNotes, delayNotes, status, approvedBy, approvedAt, rejectReason, createdBy, createdAt, updatedAt",
    note: "POST, PATCH, DELETE and submit/approve/reject actions are not implemented. Status: draft|submitted|approved|rejected.",
  },
  {
    key: "users",
    label: "People",
    description:
      "Read-only people directory. Requires Full access or organization admin access.",
    columns:
      "id, name, email, title, accessType, isAdmin, jobRoleId, supervisorId, isActive; costRate and billRate are included only for organization admins",
    note: "POST, PATCH and DELETE are not implemented. Access type keys: full|team_member|timesheet|app_only|passive. Private OAuth identifiers and token hashes are never returned by this resource.",
  },
  {
    key: "companies",
    label: "Companies",
    description:
      "Read-only organization company records; contacts are not expanded.",
    columns:
      "id, name, type, phone, email, address, notes, isActive, createdAt",
    note: "POST, PATCH and DELETE are not implemented. Type: gc|fabricator|detailer|eor|architect|owner|crane_rental|supplier|other.",
  },
];
