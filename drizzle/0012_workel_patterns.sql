CREATE TABLE `job_tabs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`key` varchar(32) NOT NULL,
	`label` varchar(64),
	`position` int NOT NULL,
	`hidden` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `job_tabs_id` PRIMARY KEY(`id`),
	CONSTRAINT `job_tabs_project_key` UNIQUE(`projectId`,`key`)
);
--> statement-breakpoint
CREATE TABLE `user_view_prefs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`scope` varchar(64) NOT NULL,
	`scopeId` varchar(64) NOT NULL DEFAULT '',
	`value` json NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_view_prefs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uvp_user_scope` UNIQUE(`userId`,`scope`,`scopeId`)
);
--> statement-breakpoint
-- Added nullable first so existing jobs can be given an id before NOT NULL is enforced.
ALTER TABLE `projects` ADD `publicId` varchar(12);--> statement-breakpoint
-- Backfill: 8 random characters from the alphabet in shared/jobUrl.ts (RAND() is evaluated per row and per call).
UPDATE `projects` SET `publicId` = CONCAT(
	SUBSTRING('23456789bcdfghjkmnpqrstvwxyz', FLOOR(1 + RAND() * 28), 1),
	SUBSTRING('23456789bcdfghjkmnpqrstvwxyz', FLOOR(1 + RAND() * 28), 1),
	SUBSTRING('23456789bcdfghjkmnpqrstvwxyz', FLOOR(1 + RAND() * 28), 1),
	SUBSTRING('23456789bcdfghjkmnpqrstvwxyz', FLOOR(1 + RAND() * 28), 1),
	SUBSTRING('23456789bcdfghjkmnpqrstvwxyz', FLOOR(1 + RAND() * 28), 1),
	SUBSTRING('23456789bcdfghjkmnpqrstvwxyz', FLOOR(1 + RAND() * 28), 1),
	SUBSTRING('23456789bcdfghjkmnpqrstvwxyz', FLOOR(1 + RAND() * 28), 1),
	SUBSTRING('23456789bcdfghjkmnpqrstvwxyz', FLOOR(1 + RAND() * 28), 1)
) WHERE `publicId` IS NULL;--> statement-breakpoint
ALTER TABLE `projects` MODIFY `publicId` varchar(12) NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_public_id` UNIQUE(`publicId`);