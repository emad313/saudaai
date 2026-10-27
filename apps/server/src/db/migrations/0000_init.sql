CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`actor` text NOT NULL,
	`step` integer NOT NULL,
	`tool` text NOT NULL,
	`args` text,
	`result` text,
	`decision` text NOT NULL,
	`latency_ms` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_shop_idx` ON `activity_log` (`shop_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_turn_idx` ON `activity_log` (`turn_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`channel` text NOT NULL,
	`external_user_id` text NOT NULL,
	`customer_id` text,
	`profile_name` text,
	`last_inbound_at` integer NOT NULL,
	`paused_until` integer,
	`failures` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_user_idx` ON `conversations` (`shop_id`,`channel`,`external_user_id`);--> statement-breakpoint
CREATE TABLE `customer_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`channel` text NOT NULL,
	`external_user_id` text NOT NULL,
	`profile_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identities_user_idx` ON `customer_identities` (`channel`,`external_user_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`address` text,
	`area` text,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_phone_idx` ON `customers` (`shop_id`,`phone`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`amount_poisha` integer NOT NULL,
	`category` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `login_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`mime` text NOT NULL,
	`path` text NOT NULL,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_sha256_unique` ON `media` (`sha256`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`external_message_id` text,
	`role` text NOT NULL,
	`kind` text NOT NULL,
	`text` text,
	`transcript` text,
	`media_id` text,
	`delivery_status` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_external_idx` ON `messages` (`conversation_id`,`external_message_id`);--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `model_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`purpose` text NOT NULL,
	`cache_key` text,
	`cache_hit` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`input_units` integer,
	`output_units` integer,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_price_poisha` integer NOT NULL,
	`line_total_poisha` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_lines_qty_check" CHECK("order_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE INDEX `order_lines_order_idx` ON `order_lines` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`number` integer NOT NULL,
	`customer_id` text NOT NULL,
	`conversation_id` text,
	`status` text NOT NULL,
	`payment_method` text NOT NULL,
	`payment_status` text NOT NULL,
	`delivery_area` text NOT NULL,
	`delivery_address` text,
	`delivery_poisha` integer NOT NULL,
	`subtotal_poisha` integer NOT NULL,
	`total_poisha` integer NOT NULL,
	`paid_poisha` integer DEFAULT 0 NOT NULL,
	`note` text,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_number_idx` ON `orders` (`shop_id`,`number`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`shop_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`amount_poisha` integer NOT NULL,
	`method` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pending_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`conversation_id` text,
	`tool` text NOT NULL,
	`args` text NOT NULL,
	`preview` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`telegram_message_id` text,
	`expires_at` integer NOT NULL,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pending_shop_idx` ON `pending_actions` (`shop_id`,`status`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`name` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`category` text NOT NULL,
	`attributes` text DEFAULT '{}' NOT NULL,
	`base_price_poisha` integer NOT NULL,
	`status` text NOT NULL,
	`image_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`image_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `products_shop_idx` ON `products` (`shop_id`,`status`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shops` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`owner_name` text NOT NULL,
	`area` text NOT NULL,
	`language` text DEFAULT 'bn' NOT NULL,
	`delivery_rules` text NOT NULL,
	`payment_methods` text NOT NULL,
	`bkash_number` text,
	`auto` text DEFAULT '{}' NOT NULL,
	`feed_muted` integer DEFAULT false NOT NULL,
	`telegram_chat_id` text,
	`link_code` text NOT NULL,
	`order_seq` integer DEFAULT 1000 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shops_slug_unique` ON `shops` (`slug`);--> statement-breakpoint
CREATE TABLE `variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`size` text,
	`color` text,
	`price_poisha` integer NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "variants_stock_check" CHECK("variants"."stock" >= 0 and "variants"."reserved" >= 0 and "variants"."reserved" <= "variants"."stock")
);
--> statement-breakpoint
CREATE INDEX `variants_product_idx` ON `variants` (`product_id`);