CREATE TABLE `stores` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text,
	`credentials` text,
	`webhook_secret` text,
	`currency` text DEFAULT 'BDT' NOT NULL,
	`status` text NOT NULL,
	`last_sync_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stores_shop_id_unique` ON `stores` (`shop_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`size` text,
	`color` text,
	`price_poisha` integer NOT NULL,
	`stock` integer DEFAULT 0,
	`reserved` integer DEFAULT 0 NOT NULL,
	`external_id` text,
	`sku` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "variants_stock_check" CHECK("__new_variants"."stock" >= 0 and "__new_variants"."reserved" >= 0 and "__new_variants"."reserved" <= "__new_variants"."stock")
);
--> statement-breakpoint
INSERT INTO `__new_variants`("id", "product_id", "size", "color", "price_poisha", "stock", "reserved", "external_id", "sku") SELECT "id", "product_id", "size", "color", "price_poisha", "stock", "reserved", NULL, NULL FROM `variants`;--> statement-breakpoint
DROP TABLE `variants`;--> statement-breakpoint
ALTER TABLE `__new_variants` RENAME TO `variants`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `variants_product_idx` ON `variants` (`product_id`);--> statement-breakpoint
CREATE INDEX `variants_external_idx` ON `variants` (`external_id`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `meta` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `store_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `external_number` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `admin_url` text;--> statement-breakpoint
ALTER TABLE `products` ADD `image_url` text;--> statement-breakpoint
ALTER TABLE `products` ADD `store_id` text;--> statement-breakpoint
ALTER TABLE `products` ADD `external_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `products_external_idx` ON `products` (`store_id`,`external_id`);--> statement-breakpoint
ALTER TABLE `shops` ADD `public_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `shops_public_key_unique` ON `shops` (`public_key`);--> statement-breakpoint
UPDATE `shops` SET `public_key` = lower(hex(randomblob(12))) WHERE `public_key` IS NULL;
