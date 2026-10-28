CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`kind` text NOT NULL,
	`before_snapshot_id` text,
	`after_snapshot_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`before_snapshot_id`) REFERENCES `price_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`after_snapshot_id`) REFERENCES `price_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "alerts_kind_check" CHECK("alerts"."kind" in ('price_drop', 'back_in_stock', 'new_cheapest'))
);
--> statement-breakpoint
CREATE INDEX `alerts_read_at_created_at_idx` ON `alerts` (`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `fx_tables` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`base` text NOT NULL,
	`rates_json` text NOT NULL,
	`fetched_on` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `listings` (
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
	CONSTRAINT "listings_status_check" CHECK("listings"."status" in ('active', 'stale', 'gone')),
	CONSTRAINT "listings_origin_check" CHECK("listings"."origin" in ('manual', 'matched'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listings_url_unique` ON `listings` (`url`);--> statement-breakpoint
CREATE INDEX `listings_product_id_idx` ON `listings` (`product_id`);--> statement-breakpoint
CREATE INDEX `listings_plugin_id_status_idx` ON `listings` (`plugin_id`,`status`);--> statement-breakpoint
CREATE TABLE `match_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`similarity` real NOT NULL,
	`llm_verdict` text NOT NULL,
	`llm_reason` text,
	`status` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "match_candidates_llm_verdict_check" CHECK("match_candidates"."llm_verdict" in ('same', 'variant', 'different', 'unjudged')),
	CONSTRAINT "match_candidates_status_check" CHECK("match_candidates"."status" in ('pending', 'accepted', 'rejected')),
	CONSTRAINT "match_candidates_llm_reason_check" CHECK(("match_candidates"."llm_verdict" = 'unjudged') = ("match_candidates"."llm_reason" is null))
);
--> statement-breakpoint
CREATE INDEX `match_candidates_status_idx` ON `match_candidates` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `match_candidates_product_id_url_unique` ON `match_candidates` (`product_id`,`url`);--> statement-breakpoint
CREATE TABLE `plugin_health` (
	`plugin_id` text PRIMARY KEY NOT NULL,
	`consecutive_blocks` integer NOT NULL,
	`backoff_until` integer
);
--> statement-breakpoint
CREATE TABLE `price_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`ship_to` text NOT NULL,
	`item_amount_minor` integer NOT NULL,
	`item_currency` text NOT NULL,
	`shipping_kind` text NOT NULL,
	`shipping_amount_minor` integer,
	`shipping_currency` text,
	`in_stock` integer NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "price_snapshots_shipping_kind_check" CHECK("price_snapshots"."shipping_kind" in ('known', 'unknown')),
	CONSTRAINT "price_snapshots_shipping_check" CHECK(("price_snapshots"."shipping_kind" = 'unknown') = ("price_snapshots"."shipping_amount_minor" is null) and ("price_snapshots"."shipping_kind" = 'unknown') = ("price_snapshots"."shipping_currency" is null))
);
--> statement-breakpoint
CREATE INDEX `price_snapshots_listing_id_observed_at_idx` ON `price_snapshots` (`listing_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	`cheapest_listing_id` text,
	FOREIGN KEY (`cheapest_listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `scan_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`outcome` text NOT NULL,
	`error_kind` text,
	CONSTRAINT "scan_runs_outcome_check" CHECK("scan_runs"."outcome" in ('ok', 'failed', 'blocked')),
	CONSTRAINT "scan_runs_error_kind_check" CHECK("scan_runs"."error_kind" in ('not_found', 'blocked', 'parse_failed', 'timeout', 'network', 'unsupported_ship_to')),
	CONSTRAINT "scan_runs_error_kind_null_check" CHECK(("scan_runs"."outcome" = 'ok') = ("scan_runs"."error_kind" is null))
);
--> statement-breakpoint
CREATE INDEX `scan_runs_plugin_id_started_at_idx` ON `scan_runs` (`plugin_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`display_currency` text NOT NULL,
	`ship_to_country` text NOT NULL,
	`duty_free_amount_minor` integer NOT NULL,
	`duty_free_currency` text NOT NULL,
	`vat_basis_points` integer NOT NULL,
	`threshold_basis` text NOT NULL,
	`scan_interval_hours` integer NOT NULL,
	`price_drop_min_basis_points` integer NOT NULL,
	CONSTRAINT "settings_singleton_check" CHECK("settings"."id" = 1),
	CONSTRAINT "settings_threshold_basis_check" CHECK("settings"."threshold_basis" in ('item', 'item_and_shipping'))
);
--> statement-breakpoint
CREATE TABLE `verdict_cache` (
	`source_url` text NOT NULL,
	`candidate_url` text NOT NULL,
	`verdict` text NOT NULL,
	`reason` text NOT NULL,
	`judged_at` integer NOT NULL,
	PRIMARY KEY(`source_url`, `candidate_url`),
	CONSTRAINT "verdict_cache_verdict_check" CHECK("verdict_cache"."verdict" in ('same', 'variant', 'different'))
);
