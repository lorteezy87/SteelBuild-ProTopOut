ALTER TABLE `time_entries` ADD `approvals` json;
--> statement-breakpoint
UPDATE `time_entries` SET `approvals` = '[]' WHERE `approvals` IS NULL;
