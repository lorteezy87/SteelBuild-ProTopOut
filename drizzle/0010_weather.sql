CREATE TABLE `weather_days` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`day` date NOT NULL,
	`source` varchar(16) NOT NULL,
	`summary` json NOT NULL,
	`fetchedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `weather_days_id` PRIMARY KEY(`id`),
	CONSTRAINT `wd_project_day` UNIQUE(`projectId`,`day`)
);
--> statement-breakpoint
ALTER TABLE `daily_reports` ADD `weatherDelay` varchar(8);--> statement-breakpoint
ALTER TABLE `projects` ADD `latitude` double;--> statement-breakpoint
ALTER TABLE `projects` ADD `longitude` double;--> statement-breakpoint
ALTER TABLE `projects` ADD `weatherDaysAllowed` int;--> statement-breakpoint
ALTER TABLE `projects` ADD `nwsTimeZone` varchar(64);--> statement-breakpoint
ALTER TABLE `projects` ADD `nwsStation` varchar(16);--> statement-breakpoint
ALTER TABLE `projects` ADD `nwsHourlyUrl` text;