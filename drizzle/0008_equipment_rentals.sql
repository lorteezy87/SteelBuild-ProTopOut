CREATE TABLE `equipment_rentals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`equipmentId` int,
	`description` varchar(200) NOT NULL,
	`vendorCompanyId` int,
	`vendorName` varchar(120),
	`poNumber` varchar(64),
	`onRentDate` date NOT NULL,
	`offRentDate` date,
	`plannedOffRentDate` date,
	`callOffNoticeDays` int NOT NULL DEFAULT 1,
	`calledOffOn` date,
	`callOffConfirmation` varchar(64),
	`dayRate` double,
	`weekRate` double,
	`monthRate` double,
	`deliveryCharge` double,
	`pickupCharge` double,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `equipment_rentals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `rent_project` ON `equipment_rentals` (`projectId`);