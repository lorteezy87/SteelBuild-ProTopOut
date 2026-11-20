CREATE TABLE `jhas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`taskId` int,
	`title` varchar(200) NOT NULL,
	`status` varchar(12) NOT NULL DEFAULT 'draft',
	`steps` json NOT NULL,
	`ppe` json NOT NULL,
	`competentPerson` varchar(120),
	`reviewedOn` date,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `jhas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pre_task_plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`planDate` date NOT NULL,
	`foremanId` int,
	`taskId` int,
	`jhaId` int,
	`workDescription` text,
	`steps` json NOT NULL,
	`ppe` json NOT NULL,
	`attendees` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pre_task_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `toolbox_talks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`talkDate` date NOT NULL,
	`topic` varchar(200) NOT NULL,
	`presenter` varchar(120),
	`notes` text,
	`attendees` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `toolbox_talks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `jha_project` ON `jhas` (`projectId`);--> statement-breakpoint
CREATE INDEX `ptp_project` ON `pre_task_plans` (`projectId`,`planDate`);--> statement-breakpoint
CREATE INDEX `tbt_project` ON `toolbox_talks` (`projectId`,`talkDate`);