ALTER TABLE `daily_reports` ADD `clientKey` varchar(36);--> statement-breakpoint
ALTER TABLE `daily_reports` ADD `saveRev` varchar(36);--> statement-breakpoint
ALTER TABLE `documents` ADD `clientKey` varchar(36);--> statement-breakpoint
ALTER TABLE `daily_reports` ADD CONSTRAINT `dr_client_key` UNIQUE(`clientKey`);--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `doc_client_key` UNIQUE(`clientKey`);