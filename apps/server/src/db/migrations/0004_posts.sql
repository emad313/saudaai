CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`target` text NOT NULL,
	`media_ids` text NOT NULL,
	`text` text NOT NULL,
	`url` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `posts_shop_idx` ON `posts` (`shop_id`,`created_at`);