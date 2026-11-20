CREATE TABLE `qc_bolt_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`taskId` int,
	`logDate` date NOT NULL,
	`location` varchar(200) NOT NULL,
	`grade` varchar(16) NOT NULL,
	`method` varchar(24) NOT NULL,
	`lotNumber` varchar(64),
	`boltCount` int,
	`inspectorName` varchar(120),
	`result` varchar(8) NOT NULL DEFAULT 'pending',
	`notes` text,
	`punchItemId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `qc_bolt_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `qc_weld_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`taskId` int,
	`logDate` date NOT NULL,
	`location` varchar(200) NOT NULL,
	`welderUserId` int,
	`welderName` varchar(120),
	`wps` varchar(64),
	`process` varchar(8) NOT NULL,
	`weldSize` varchar(32),
	`ndt` varchar(8) NOT NULL DEFAULT 'none',
	`inspectorName` varchar(120),
	`result` varchar(8) NOT NULL DEFAULT 'pending',
	`notes` text,
	`punchItemId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `qc_weld_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `special_inspections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`taskId` int,
	`type` varchar(16) NOT NULL,
	`agency` varchar(120),
	`requestedDate` date,
	`scheduledDate` date,
	`inspectedDate` date,
	`result` varchar(12) NOT NULL DEFAULT 'requested',
	`reportNumber` varchar(64),
	`notes` text,
	`punchItemId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `special_inspections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `qcb_project_task` ON `qc_bolt_logs` (`projectId`,`taskId`);--> statement-breakpoint
CREATE INDEX `qcw_project_task` ON `qc_weld_logs` (`projectId`,`taskId`);--> statement-breakpoint
CREATE INDEX `si_project_task` ON `special_inspections` (`projectId`,`taskId`);