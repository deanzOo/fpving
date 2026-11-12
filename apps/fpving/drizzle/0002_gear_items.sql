CREATE TABLE `gear_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`quantity` integer NOT NULL,
	`created_at` integer NOT NULL,
	`catalog_plugin_id` text,
	`catalog_key` text,
	`specs_json` text NOT NULL,
	CONSTRAINT "gear_items_kind_check" CHECK("gear_items"."kind" in ('radio', 'goggles', 'quad', 'battery', 'charger', 'tool')),
	CONSTRAINT "gear_items_quantity_check" CHECK("gear_items"."quantity" >= 1),
	CONSTRAINT "gear_items_catalog_ref_check" CHECK(("gear_items"."catalog_plugin_id" is null) = ("gear_items"."catalog_key" is null))
);
--> statement-breakpoint
CREATE INDEX `gear_items_kind_name_idx` ON `gear_items` (`kind`,`name`);