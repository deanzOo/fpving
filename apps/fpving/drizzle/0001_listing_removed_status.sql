PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`origin` text NOT NULL,
	`added_at` integer NOT NULL,
	`failure_streak` integer NOT NULL,
	`not_found_streak` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "listings_status_check" CHECK("__new_listings"."status" in ('active', 'stale', 'gone', 'removed')),
	CONSTRAINT "listings_origin_check" CHECK("__new_listings"."origin" in ('manual', 'matched'))
);
--> statement-breakpoint
INSERT INTO `__new_listings`("id", "product_id", "plugin_id", "url", "title", "status", "origin", "added_at", "failure_streak", "not_found_streak") SELECT "id", "product_id", "plugin_id", "url", "title", "status", "origin", "added_at", "failure_streak", "not_found_streak" FROM `listings`;--> statement-breakpoint
DROP TABLE `listings`;--> statement-breakpoint
ALTER TABLE `__new_listings` RENAME TO `listings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `listings_url_unique` ON `listings` (`url`);--> statement-breakpoint
CREATE INDEX `listings_product_id_idx` ON `listings` (`product_id`);--> statement-breakpoint
CREATE INDEX `listings_plugin_id_status_idx` ON `listings` (`plugin_id`,`status`);