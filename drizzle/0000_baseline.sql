CREATE TABLE `activities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int,
	`entityType` varchar(32) NOT NULL,
	`entityId` int NOT NULL,
	`userId` int,
	`action` varchar(32) NOT NULL,
	`summary` varchar(500) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `baselines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`name` varchar(128) NOT NULL,
	`plannedStart` date,
	`plannedFinish` date,
	`budget` double NOT NULL DEFAULT 0,
	`taskData` json NOT NULL,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `baselines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `calendar_exceptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`calendarId` int NOT NULL,
	`date` date NOT NULL,
	`name` varchar(128),
	`isWorking` boolean NOT NULL DEFAULT false,
	CONSTRAINT `calendar_exceptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `calendars` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`workDays` json NOT NULL,
	`hoursPerDay` double NOT NULL DEFAULT 8,
	`isDefault` boolean NOT NULL DEFAULT false,
	CONSTRAINT `calendars_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `checklist_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`text` varchar(500) NOT NULL,
	`done` boolean NOT NULL DEFAULT false,
	`sortOrder` int NOT NULL DEFAULT 0,
	CONSTRAINT `checklist_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(200) NOT NULL,
	`type` varchar(32) NOT NULL DEFAULT 'other',
	`phone` varchar(64),
	`email` varchar(320),
	`address` text,
	`notes` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `companies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`companyId` int NOT NULL,
	`name` varchar(200) NOT NULL,
	`title` varchar(128),
	`email` varchar(320),
	`phone` varchar(64),
	CONSTRAINT `contacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `custom_field_defs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityType` varchar(64) NOT NULL,
	`key` varchar(64) NOT NULL,
	`label` varchar(128) NOT NULL,
	`fieldType` varchar(16) NOT NULL,
	`options` json,
	`formula` text,
	`required` boolean NOT NULL DEFAULT false,
	`isFinancial` boolean NOT NULL DEFAULT false,
	`rollup` varchar(8) NOT NULL DEFAULT 'none',
	`colorRules` json,
	`projectType` varchar(64),
	`helpText` varchar(500),
	`showInList` boolean NOT NULL DEFAULT false,
	`sortOrder` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	CONSTRAINT `custom_field_defs_id` PRIMARY KEY(`id`),
	CONSTRAINT `cfd_uq` UNIQUE(`entityType`,`key`)
);
--> statement-breakpoint
CREATE TABLE `custom_field_values` (
	`id` int AUTO_INCREMENT NOT NULL,
	`defId` int NOT NULL,
	`entityType` varchar(64) NOT NULL,
	`entityId` int NOT NULL,
	`value` json,
	`numValue` double,
	`textValue` varchar(500),
	CONSTRAINT `custom_field_values_id` PRIMARY KEY(`id`),
	CONSTRAINT `cfv_uq` UNIQUE(`defId`,`entityId`)
);
--> statement-breakpoint
CREATE TABLE `daily_report_crew` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reportId` int NOT NULL,
	`userId` int,
	`workerName` varchar(200),
	`jobRoleId` int,
	`taskId` int,
	`stHours` double NOT NULL DEFAULT 0,
	`otHours` double NOT NULL DEFAULT 0,
	CONSTRAINT `daily_report_crew_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `daily_report_equipment` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reportId` int NOT NULL,
	`equipmentId` int NOT NULL,
	`operatingHours` double NOT NULL DEFAULT 0,
	`standbyHours` double NOT NULL DEFAULT 0,
	`cost` double NOT NULL DEFAULT 0,
	CONSTRAINT `daily_report_equipment_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `daily_report_progress` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reportId` int NOT NULL,
	`projectId` int NOT NULL,
	`taskId` int NOT NULL,
	`reportDate` date NOT NULL,
	`tons` double NOT NULL DEFAULT 0,
	`pieces` int NOT NULL DEFAULT 0,
	`note` varchar(500),
	`posted` boolean NOT NULL DEFAULT false,
	CONSTRAINT `daily_report_progress_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `daily_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`reportDate` date NOT NULL,
	`foremanId` int,
	`weather` varchar(128),
	`temperature` varchar(32),
	`workPerformed` text,
	`safetyNotes` text,
	`delayNotes` text,
	`status` varchar(16) NOT NULL DEFAULT 'draft',
	`approvedBy` int,
	`approvedAt` timestamp,
	`rejectReason` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `daily_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dashboards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(200) NOT NULL,
	`ownerId` int NOT NULL,
	`isShared` boolean NOT NULL DEFAULT false,
	`widgets` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dashboards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`sequenceTaskId` int,
	`loadNumber` varchar(32) NOT NULL,
	`description` varchar(500),
	`fabricatorCompanyId` int,
	`needDate` date,
	`promisedDate` date,
	`shippedDate` date,
	`receivedDate` date,
	`tons` double NOT NULL DEFAULT 0,
	`pieces` int NOT NULL DEFAULT 0,
	`ticketNumber` varchar(64),
	`status` varchar(16) NOT NULL DEFAULT 'scheduled',
	`shortageNotes` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `document_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`documentId` int NOT NULL,
	`revision` varchar(16) NOT NULL,
	`fileKey` varchar(500) NOT NULL,
	`url` varchar(1000) NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`size` int NOT NULL DEFAULT 0,
	`mimeType` varchar(128),
	`notes` varchar(500),
	`uploadedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `document_versions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`entityType` varchar(32),
	`entityId` int,
	`name` varchar(255) NOT NULL,
	`category` varchar(32) NOT NULL DEFAULT 'other',
	`sheetNumber` varchar(64),
	`currentRevision` varchar(16),
	`isDeleted` boolean NOT NULL DEFAULT false,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `drawing_marks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`sheetId` int NOT NULL,
	`rev` int NOT NULL,
	`page` int NOT NULL DEFAULT 1,
	`kind` varchar(16) NOT NULL,
	`points` json NOT NULL,
	`color` varchar(16) NOT NULL DEFAULT '#E8590C',
	`note` varchar(500),
	`label` varchar(12),
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `drawing_marks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `drawing_revisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sheetId` int NOT NULL,
	`number` int NOT NULL,
	`state` varchar(12) NOT NULL DEFAULT 'draft',
	`notes` varchar(500),
	`fileKey` varchar(500),
	`url` varchar(1000),
	`fileName` varchar(255),
	`size` int,
	`mimeType` varchar(128),
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`checkedBy` int,
	`checkedAt` timestamp,
	`issuedBy` int,
	`issuedAt` date,
	`previewKey` varchar(500),
	`previewUrl` varchar(1000),
	`description` varchar(600),
	`revDate` date,
	`source` varchar(300),
	`readVia` varchar(8),
	CONSTRAINT `drawing_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `drev_sheet_number` UNIQUE(`sheetId`,`number`)
);
--> statement-breakpoint
CREATE TABLE `drawing_scales` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sheetId` int NOT NULL,
	`rev` int NOT NULL,
	`page` int NOT NULL DEFAULT 1,
	`feetPerWidth` double NOT NULL,
	`label` varchar(60),
	`createdBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `drawing_scales_id` PRIMARY KEY(`id`),
	CONSTRAINT `dsc_sheet_rev_page` UNIQUE(`sheetId`,`rev`,`page`)
);
--> statement-breakpoint
CREATE TABLE `drawing_set_issues` (
	`id` int AUTO_INCREMENT NOT NULL,
	`setId` int NOT NULL,
	`projectId` int NOT NULL,
	`number` int NOT NULL,
	`purpose` varchar(32) NOT NULL,
	`issueDate` date NOT NULL,
	`note` varchar(1000),
	`sheets` json NOT NULL,
	`skipped` json NOT NULL,
	`issuedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `drawing_set_issues_id` PRIMARY KEY(`id`),
	CONSTRAINT `dsi_set_number` UNIQUE(`setId`,`number`)
);
--> statement-breakpoint
CREATE TABLE `drawing_sets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`number` varchar(32) NOT NULL,
	`name` varchar(255) NOT NULL,
	`kind` varchar(16) NOT NULL DEFAULT 'erection',
	`description` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `drawing_sets_id` PRIMARY KEY(`id`),
	CONSTRAINT `dset_project_number` UNIQUE(`projectId`,`number`)
);
--> statement-breakpoint
CREATE TABLE `drawing_sheets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`setId` int,
	`sheetNumber` varchar(64) NOT NULL,
	`sheetKey` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`sequenceTaskId` int,
	`status` varchar(8) NOT NULL DEFAULT 'DET',
	`holdFrom` varchar(8),
	`holdReason` varchar(500),
	`holdRfiId` int,
	`ballInCourt` varchar(32) NOT NULL DEFAULT 'Detailer',
	`sentDate` date,
	`returnedDate` date,
	`currentRev` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `drawing_sheets_id` PRIMARY KEY(`id`),
	CONSTRAINT `dsh_project_key` UNIQUE(`projectId`,`sheetKey`)
);
--> statement-breakpoint
CREATE TABLE `drawing_title_blocks` (
	`projectId` int NOT NULL,
	`boxes` json NOT NULL,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `drawing_title_blocks_projectId` PRIMARY KEY(`projectId`)
);
--> statement-breakpoint
CREATE TABLE `equipment` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(200) NOT NULL,
	`type` varchar(32) NOT NULL DEFAULT 'crane',
	`capacity` varchar(64),
	`ownership` varchar(16) NOT NULL DEFAULT 'rented',
	`vendorCompanyId` int,
	`hourlyRate` double NOT NULL DEFAULT 0,
	`standbyRate` double NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	CONSTRAINT `equipment_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `expense_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`billable` boolean NOT NULL DEFAULT true,
	`costable` boolean NOT NULL DEFAULT true,
	`isActive` boolean NOT NULL DEFAULT true,
	CONSTRAINT `expense_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`expenseCodeId` int,
	`expenseDate` date NOT NULL,
	`description` varchar(500),
	`vendor` varchar(200),
	`amount` double NOT NULL,
	`billable` boolean NOT NULL DEFAULT true,
	`costable` boolean NOT NULL DEFAULT true,
	`state` varchar(16) NOT NULL DEFAULT 'saved',
	`receiptUrl` varchar(1000),
	`approvedBy` int,
	`approvedAt` timestamp,
	`rejectReason` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `expenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`costRate` double NOT NULL DEFAULT 0,
	`billRate` double NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	CONSTRAINT `job_roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `local_credentials` (
	`userId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `local_credentials_userId` PRIMARY KEY(`userId`),
	CONSTRAINT `local_credentials_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `model_jobs` (
	`projectId` int NOT NULL,
	`data` json NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `model_jobs_projectId` PRIMARY KEY(`projectId`)
);
--> statement-breakpoint
CREATE TABLE `model_reads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`sheetId` int NOT NULL,
	`rev` int NOT NULL,
	`page` int NOT NULL DEFAULT 1,
	`readerVersion` int NOT NULL DEFAULT 0,
	`data` json NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`readBy` int,
	`readAt` timestamp NOT NULL DEFAULT (now()),
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `model_reads_id` PRIMARY KEY(`id`),
	CONSTRAINT `mrd_sheet_rev_page` UNIQUE(`sheetId`,`rev`,`page`)
);
--> statement-breakpoint
CREATE TABLE `project_companies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`companyId` int NOT NULL,
	`role` varchar(32) NOT NULL,
	CONSTRAINT `project_companies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`snapDate` date NOT NULL,
	`percentComplete` double NOT NULL DEFAULT 0,
	`plannedValue` double NOT NULL DEFAULT 0,
	`earnedValue` double NOT NULL DEFAULT 0,
	`actualCost` double NOT NULL DEFAULT 0,
	`erectedTons` double NOT NULL DEFAULT 0,
	`plannedTons` double NOT NULL DEFAULT 0,
	CONSTRAINT `project_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `snap_uq` UNIQUE(`projectId`,`snapDate`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(32),
	`name` varchar(255) NOT NULL,
	`description` text,
	`state` varchar(16) NOT NULL DEFAULT 'draft',
	`projectType` varchar(64),
	`priority` varchar(16) NOT NULL DEFAULT 'normal',
	`managerId` int,
	`calendarId` int,
	`startDate` date,
	`deadline` date,
	`plannedStart` date,
	`plannedFinish` date,
	`contractType` varchar(16) NOT NULL DEFAULT 'lump_sum',
	`contractValue` double NOT NULL DEFAULT 0,
	`budget` double NOT NULL DEFAULT 0,
	`totalTons` double NOT NULL DEFAULT 0,
	`totalPieces` int NOT NULL DEFAULT 0,
	`retainagePct` double NOT NULL DEFAULT 10,
	`noticeHours` int NOT NULL DEFAULT 72,
	`siteAddress` text,
	`progressMethod` varchar(16) NOT NULL DEFAULT 'tonnage',
	`percentComplete` double NOT NULL DEFAULT 0,
	`projectedFinish` date,
	`projectedCost` double,
	`scheduleHealth` varchar(16) NOT NULL DEFAULT 'not_active',
	`costHealth` varchar(16) NOT NULL DEFAULT 'not_active',
	`plannedValue` double NOT NULL DEFAULT 0,
	`earnedValue` double NOT NULL DEFAULT 0,
	`actualCost` double NOT NULL DEFAULT 0,
	`lastForecastAt` timestamp,
	`activeBaselineId` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `report_stars` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reportId` int NOT NULL,
	`userId` int NOT NULL,
	CONSTRAINT `report_stars_id` PRIMARY KEY(`id`),
	CONSTRAINT `rs_uq` UNIQUE(`reportId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(200) NOT NULL,
	`description` text,
	`config` json NOT NULL,
	`ownerId` int NOT NULL,
	`isShared` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(64) NOT NULL,
	`value` json,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `task_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`userId` int,
	`jobRoleId` int,
	`equipmentId` int,
	`allocationPct` double NOT NULL DEFAULT 100,
	CONSTRAINT `task_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`predecessorId` int NOT NULL,
	`successorId` int NOT NULL,
	`type` varchar(2) NOT NULL DEFAULT 'FS',
	`lagDays` double NOT NULL DEFAULT 0,
	CONSTRAINT `task_dependencies_id` PRIMARY KEY(`id`),
	CONSTRAINT `dep_uq` UNIQUE(`predecessorId`,`successorId`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`parentId` int,
	`sortOrder` int NOT NULL DEFAULT 0,
	`wbs` varchar(64),
	`name` varchar(255) NOT NULL,
	`description` text,
	`kind` varchar(16) NOT NULL DEFAULT 'task',
	`isSummary` boolean NOT NULL DEFAULT false,
	`status` varchar(16) NOT NULL DEFAULT 'not_started',
	`priority` varchar(16) NOT NULL DEFAULT 'normal',
	`schedulingMode` varchar(8) NOT NULL DEFAULT 'auto',
	`constraintType` varchar(8) NOT NULL DEFAULT 'asap',
	`constraintDate` date,
	`startDate` date,
	`finishDate` date,
	`durationDays` double NOT NULL DEFAULT 1,
	`effortHours` double NOT NULL DEFAULT 0,
	`percentComplete` double NOT NULL DEFAULT 0,
	`actualStart` date,
	`actualFinish` date,
	`budgetCost` double NOT NULL DEFAULT 0,
	`location` varchar(128),
	`plannedTons` double NOT NULL DEFAULT 0,
	`plannedPieces` int NOT NULL DEFAULT 0,
	`erectedTons` double NOT NULL DEFAULT 0,
	`erectedPieces` int NOT NULL DEFAULT 0,
	`totalFloat` double,
	`isCritical` boolean NOT NULL DEFAULT false,
	`constraintViolated` boolean NOT NULL DEFAULT false,
	`projectedFinish` date,
	`scheduleHealth` varchar(16) NOT NULL DEFAULT 'future',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `time_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`billable` boolean NOT NULL DEFAULT true,
	`multiplier` double NOT NULL DEFAULT 1,
	`isActive` boolean NOT NULL DEFAULT true,
	CONSTRAINT `time_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int NOT NULL,
	`taskId` int,
	`wfItemId` int,
	`timeCodeId` int,
	`entryDate` date NOT NULL,
	`hours` double NOT NULL,
	`notes` varchar(500),
	`state` varchar(16) NOT NULL DEFAULT 'saved',
	`source` varchar(16) NOT NULL DEFAULT 'timesheet',
	`sourceId` int,
	`costAmount` double NOT NULL DEFAULT 0,
	`billAmount` double NOT NULL DEFAULT 0,
	`approvedBy` int,
	`approvals` json,
	`approvedAt` timestamp,
	`rejectReason` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `time_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`accessType` varchar(32) NOT NULL DEFAULT 'team_member',
	`title` varchar(128),
	`phone` varchar(64),
	`supervisorId` int,
	`jobRoleId` int,
	`costRate` double,
	`billRate` double,
	`calendarId` int,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE TABLE `wf_apps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(48) NOT NULL,
	`name` varchar(128) NOT NULL,
	`pluralName` varchar(128) NOT NULL,
	`description` text,
	`numberPrefix` varchar(12) NOT NULL,
	`color` varchar(16) NOT NULL DEFAULT '#E8590C',
	`icon` varchar(32) NOT NULL DEFAULT 'file-text',
	`scope` varchar(16) NOT NULL DEFAULT 'project',
	`allowTimeLogging` boolean NOT NULL DEFAULT false,
	`scoreFormula` text,
	`dueDateLabel` varchar(64) NOT NULL DEFAULT 'Due Date',
	`config` json,
	`sortOrder` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wf_apps_id` PRIMARY KEY(`id`),
	CONSTRAINT `wf_apps_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `wf_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`itemId` int NOT NULL,
	`fromStateId` int,
	`toStateId` int,
	`userId` int,
	`comment` text,
	`isAuto` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wf_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wf_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`appId` int NOT NULL,
	`projectId` int,
	`number` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`stateId` int NOT NULL,
	`priority` varchar(16) NOT NULL DEFAULT 'normal',
	`assigneeId` int,
	`requestorId` int,
	`responsibleParty` varchar(32),
	`ballInCourt` varchar(16) NOT NULL DEFAULT 'us',
	`dueDate` date,
	`stateEnteredAt` timestamp NOT NULL DEFAULT (now()),
	`slaDueAt` timestamp,
	`slaAtRiskAt` timestamp,
	`slaStatus` varchar(16) NOT NULL DEFAULT 'ok',
	`costImpact` double NOT NULL DEFAULT 0,
	`scheduleImpactDays` double NOT NULL DEFAULT 0,
	`linkedTaskId` int,
	`linkedDeliveryId` int,
	`score` double,
	`closedAt` timestamp,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wf_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wf_sla_policies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`appId` int NOT NULL,
	`stateId` int NOT NULL,
	`priority` varchar(16),
	`source` varchar(16) NOT NULL DEFAULT 'fixed',
	`hours` double NOT NULL DEFAULT 24,
	`action` varchar(16) NOT NULL DEFAULT 'mark_delayed',
	`toStateId` int,
	`atRiskPct` double NOT NULL DEFAULT 75,
	CONSTRAINT `wf_sla_policies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wf_states` (
	`id` int AUTO_INCREMENT NOT NULL,
	`appId` int NOT NULL,
	`name` varchar(64) NOT NULL,
	`category` varchar(8) NOT NULL DEFAULT 'active',
	`color` varchar(16) NOT NULL DEFAULT '#6B7280',
	`sortOrder` int NOT NULL DEFAULT 0,
	CONSTRAINT `wf_states_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wf_transitions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`appId` int NOT NULL,
	`fromStateId` int NOT NULL,
	`toStateId` int NOT NULL,
	`name` varchar(64) NOT NULL,
	`userAllowed` boolean NOT NULL DEFAULT true,
	CONSTRAINT `wf_transitions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `act_project` ON `activities` (`projectId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `bl_project` ON `baselines` (`projectId`);--> statement-breakpoint
CREATE INDEX `cal_exc_cal` ON `calendar_exceptions` (`calendarId`);--> statement-breakpoint
CREATE INDEX `cl_task` ON `checklist_items` (`taskId`);--> statement-breakpoint
CREATE INDEX `contacts_company` ON `contacts` (`companyId`);--> statement-breakpoint
CREATE INDEX `cfv_entity` ON `custom_field_values` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `drc_report` ON `daily_report_crew` (`reportId`);--> statement-breakpoint
CREATE INDEX `dre_report` ON `daily_report_equipment` (`reportId`);--> statement-breakpoint
CREATE INDEX `drp_report` ON `daily_report_progress` (`reportId`);--> statement-breakpoint
CREATE INDEX `drp_task` ON `daily_report_progress` (`taskId`);--> statement-breakpoint
CREATE INDEX `dr_project` ON `daily_reports` (`projectId`,`reportDate`);--> statement-breakpoint
CREATE INDEX `del_project` ON `deliveries` (`projectId`);--> statement-breakpoint
CREATE INDEX `dv_doc` ON `document_versions` (`documentId`);--> statement-breakpoint
CREATE INDEX `doc_project` ON `documents` (`projectId`);--> statement-breakpoint
CREATE INDEX `dmk_sheet` ON `drawing_marks` (`sheetId`,`rev`);--> statement-breakpoint
CREATE INDEX `dsh_set` ON `drawing_sheets` (`setId`);--> statement-breakpoint
CREATE INDEX `exp_project` ON `expenses` (`projectId`);--> statement-breakpoint
CREATE INDEX `exp_user` ON `expenses` (`userId`);--> statement-breakpoint
CREATE INDEX `mrd_project` ON `model_reads` (`projectId`);--> statement-breakpoint
CREATE INDEX `pc_project` ON `project_companies` (`projectId`);--> statement-breakpoint
CREATE INDEX `ta_task` ON `task_assignments` (`taskId`);--> statement-breakpoint
CREATE INDEX `ta_user` ON `task_assignments` (`userId`);--> statement-breakpoint
CREATE INDEX `dep_succ` ON `task_dependencies` (`successorId`);--> statement-breakpoint
CREATE INDEX `tasks_project` ON `tasks` (`projectId`);--> statement-breakpoint
CREATE INDEX `tasks_parent` ON `tasks` (`parentId`);--> statement-breakpoint
CREATE INDEX `te_user_date` ON `time_entries` (`userId`,`entryDate`);--> statement-breakpoint
CREATE INDEX `te_project` ON `time_entries` (`projectId`);--> statement-breakpoint
CREATE INDEX `wfe_item` ON `wf_events` (`itemId`);--> statement-breakpoint
CREATE INDEX `wfi_app_project` ON `wf_items` (`appId`,`projectId`);--> statement-breakpoint
CREATE INDEX `wfi_assignee` ON `wf_items` (`assigneeId`);--> statement-breakpoint
CREATE INDEX `wfp_app` ON `wf_sla_policies` (`appId`);--> statement-breakpoint
CREATE INDEX `wfs_app` ON `wf_states` (`appId`);--> statement-breakpoint
CREATE INDEX `wft_app` ON `wf_transitions` (`appId`);