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
CREATE TABLE `drawing_title_blocks` (
	`projectId` int NOT NULL,
	`boxes` json NOT NULL,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `drawing_title_blocks_projectId` PRIMARY KEY(`projectId`)
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
ALTER TABLE `drawing_revisions` ADD `previewKey` varchar(500);--> statement-breakpoint
ALTER TABLE `drawing_revisions` ADD `previewUrl` varchar(1000);--> statement-breakpoint
ALTER TABLE `drawing_revisions` ADD `description` varchar(600);--> statement-breakpoint
ALTER TABLE `drawing_revisions` ADD `revDate` date;--> statement-breakpoint
ALTER TABLE `drawing_revisions` ADD `source` varchar(300);--> statement-breakpoint
ALTER TABLE `drawing_revisions` ADD `readVia` varchar(8);--> statement-breakpoint
CREATE INDEX `dmk_sheet` ON `drawing_marks` (`sheetId`,`rev`);--> statement-breakpoint
CREATE INDEX `mrd_project` ON `model_reads` (`projectId`);