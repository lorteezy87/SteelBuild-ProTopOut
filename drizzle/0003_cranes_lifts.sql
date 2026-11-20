CREATE TABLE `crane_models` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`maxCapacityLb` double,
	`chart` json NOT NULL,
	`chartNote` varchar(500),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crane_models_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crane_setups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`craneModelId` int NOT NULL,
	`equipmentId` int,
	`name` varchar(120) NOT NULL,
	`sheetId` int,
	`page` int NOT NULL DEFAULT 1,
	`grid1` varchar(16),
	`grid2` varchar(16),
	`offsetXFt` double NOT NULL DEFAULT 0,
	`offsetYFt` double NOT NULL DEFAULT 0,
	`boomFt` double,
	`counterweight` varchar(120),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crane_setups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lift_picks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`setupId` int NOT NULL,
	`sequenceTaskId` int,
	`mark` varchar(32) NOT NULL,
	`description` varchar(200),
	`pieceLb` double,
	`riggingLb` double,
	`radiusFt` double,
	`radiusSource` varchar(8) NOT NULL DEFAULT 'entered',
	`sheetId` int,
	`page` int,
	`pieceKey` varchar(64),
	`signoffs` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lift_picks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `cs_project` ON `crane_setups` (`projectId`);--> statement-breakpoint
CREATE INDEX `lp_project` ON `lift_picks` (`projectId`);--> statement-breakpoint
CREATE INDEX `lp_setup` ON `lift_picks` (`setupId`);