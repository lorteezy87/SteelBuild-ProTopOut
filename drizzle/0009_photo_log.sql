CREATE TABLE `photo_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`documentId` int NOT NULL,
	`entityType` varchar(32) NOT NULL,
	`entityId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `photo_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `pl_doc_entity` UNIQUE(`documentId`,`entityType`,`entityId`)
);
--> statement-breakpoint
ALTER TABLE `documents` ADD `caption` varchar(500);--> statement-breakpoint
ALTER TABLE `documents` ADD `takenOn` date;--> statement-breakpoint
ALTER TABLE `documents` ADD `sequenceTaskId` int;--> statement-breakpoint
CREATE INDEX `pl_entity` ON `photo_links` (`entityType`,`entityId`);