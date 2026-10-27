ALTER TABLE `media` ADD `role` text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE `media` ADD `derived_from` text;