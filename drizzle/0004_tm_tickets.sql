CREATE TABLE `tm_ticket_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ticketId` int NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`kind` varchar(16) NOT NULL,
	`description` varchar(300) NOT NULL,
	`qty` double NOT NULL DEFAULT 0,
	`unit` varchar(16) NOT NULL DEFAULT 'hr',
	`rate` double NOT NULL DEFAULT 0,
	`otQty` double,
	`otRate` double,
	CONSTRAINT `tm_ticket_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tm_tickets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`number` int NOT NULL,
	`ticketDate` date NOT NULL,
	`description` text,
	`coItemId` int,
	`dailyReportId` int,
	`status` varchar(8) NOT NULL DEFAULT 'draft',
	`markup` json NOT NULL,
	`signedName` varchar(120),
	`signedTitle` varchar(120),
	`signedAt` timestamp,
	`signatureKey` varchar(255),
	`voidReason` varchar(500),
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tm_tickets_id` PRIMARY KEY(`id`),
	CONSTRAINT `tmt_project_number` UNIQUE(`projectId`,`number`)
);
--> statement-breakpoint
CREATE INDEX `tml_ticket` ON `tm_ticket_lines` (`ticketId`);