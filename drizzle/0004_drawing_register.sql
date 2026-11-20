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
	CONSTRAINT `drawing_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `drev_sheet_number` UNIQUE(`sheetId`,`number`)
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
CREATE INDEX `dsh_set` ON `drawing_sheets` (`setId`);