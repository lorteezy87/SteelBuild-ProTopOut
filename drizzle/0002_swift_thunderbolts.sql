ALTER TABLE `wf_apps` ADD `dueDateLabel` varchar(64) DEFAULT 'Due Date' NOT NULL;--> statement-breakpoint
ALTER TABLE `wf_apps` ADD `config` json;