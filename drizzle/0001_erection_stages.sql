ALTER TABLE `daily_report_progress` ADD `stage` varchar(16) DEFAULT 'set' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `progressStage` varchar(16) DEFAULT 'set' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `plumbedTons` double DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `plumbedPieces` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `boltedTons` double DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `boltedPieces` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `finalTons` double DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `finalPieces` int DEFAULT 0 NOT NULL;