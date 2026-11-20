CREATE TABLE `sequence_gate_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`itemKey` varchar(32) NOT NULL,
	`state` varchar(8) NOT NULL DEFAULT 'open',
	`note` varchar(500),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sequence_gate_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `sgi_task_item` UNIQUE(`taskId`,`itemKey`)
);
--> statement-breakpoint
CREATE TABLE `sequence_gate_overrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`reason` varchar(500) NOT NULL,
	`source` varchar(16) NOT NULL,
	`sourceId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sequence_gate_overrides_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `sgo_task` ON `sequence_gate_overrides` (`taskId`);