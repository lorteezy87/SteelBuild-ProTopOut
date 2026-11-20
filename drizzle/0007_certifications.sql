CREATE TABLE `certifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`certType` varchar(32) NOT NULL,
	`certNumber` varchar(64),
	`issuer` varchar(120),
	`issuedOn` date,
	`expiresOn` date,
	`fileKey` varchar(500),
	`fileUrl` varchar(1000),
	`fileName` varchar(255),
	`notes` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `certifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `job_roles` ADD `requiredCerts` json;--> statement-breakpoint
CREATE INDEX `cert_user` ON `certifications` (`userId`);