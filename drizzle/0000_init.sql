CREATE TYPE "public"."adj_reason" AS ENUM('REWEIGHED', 'DAMAGED', 'WASTAGE_NOT_ON_TO', 'FOUND', 'LOST', 'SPOT_CHECK_CORRECTION', 'OPENING_STOCK_CORRECTION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."adj_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."location_type" AS ENUM('STORAGE', 'FACTORY', 'PRODUCTION', 'VENDOR', 'OFFICE');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMIN', 'INVENTORY', 'MERCHANDISER', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."roll_status" AS ENUM('AWAITING_LABEL', 'IN_STOCK', 'FINISHED');--> statement-breakpoint
CREATE TYPE "public"."to_type" AS ENUM('TRANSFER', 'CONSUMPTION');--> statement-breakpoint
CREATE TABLE "adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"roll_id" text NOT NULL,
	"kg_change_g" integer NOT NULL,
	"reason" "adj_reason" NOT NULL,
	"note" text,
	"photo_url" text,
	"status" "adj_status" NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"roll_before_g" integer,
	"roll_after_g" integer,
	"reversal_of_id" text,
	CONSTRAINT "adjustments_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "audit" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_email" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"roll_serials" text,
	"kg_before_g" integer,
	"kg_after_g" integer,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "backups" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"fabric_item_id" text NOT NULL,
	"fabric_po" text NOT NULL,
	"seq" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batches_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "carbonwork_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"file_date" date NOT NULL,
	"file_name" text NOT NULL,
	"ledger_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"rows_checked" integer NOT NULL,
	"rows_flagged" integer NOT NULL,
	"kg_gap_g" integer NOT NULL,
	"rolls_weighed" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"results" jsonb NOT NULL,
	"to_match" jsonb,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"name" text PRIMARY KEY NOT NULL,
	"value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fabric_items" (
	"id" text PRIMARY KEY NOT NULL,
	"zoho_item_id" text,
	"sku" text,
	"item_name" text NOT NULL,
	"group_name" text,
	"cw_fabric_code" text,
	"colour" text,
	"fabric_no" text,
	"unit" text DEFAULT 'kg' NOT NULL,
	"vendor" text,
	"hex" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fabric_items_zoho_item_id_unique" UNIQUE("zoho_item_id"),
	CONSTRAINT "fabric_items_fabric_no_unique" UNIQUE("fabric_no")
);
--> statement-breakpoint
CREATE TABLE "health_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issues" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "location_type" NOT NULL,
	"address" text,
	"zoho_location_id" text,
	"contact" text,
	"carbonwork_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_code_unique" UNIQUE("code"),
	CONSTRAINT "locations_name_unique" UNIQUE("name"),
	CONSTRAINT "locations_zoho_location_id_unique" UNIQUE("zoho_location_id")
);
--> statement-breakpoint
CREATE TABLE "order_links" (
	"id" text PRIMARY KEY NOT NULL,
	"to_id" text NOT NULL,
	"piece_index" integer NOT NULL,
	"roll_serials" text NOT NULL,
	"style_po" text NOT NULL,
	"order_number" text NOT NULL,
	"item_row" integer DEFAULT 1 NOT NULL,
	"fabric_no" text,
	"colour" text,
	"kg_per_piece_g" integer,
	"reversed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rack_counts" (
	"id" text PRIMARY KEY NOT NULL,
	"rack_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"by" text NOT NULL,
	"expected" integer DEFAULT 0 NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	"gaps" integer DEFAULT 0 NOT NULL,
	"note" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "rack_moves" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"roll_id" text NOT NULL,
	"serial" text NOT NULL,
	"from_label" text NOT NULL,
	"to_label" text NOT NULL,
	"via" text NOT NULL,
	"ref" text,
	"by" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "racks" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"location_id" text NOT NULL,
	"room" text NOT NULL,
	"building" text NOT NULL,
	"capacity" integer DEFAULT 48 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_counted_at" timestamp with time zone,
	"last_count_gaps" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "racks_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "rolls" (
	"id" text PRIMARY KEY NOT NULL,
	"serial" text NOT NULL,
	"batch_id" text NOT NULL,
	"fabric_item_id" text NOT NULL,
	"fabric_po" text NOT NULL,
	"registered_date" date NOT NULL,
	"registered_location_id" text NOT NULL,
	"weighed_g" integer NOT NULL,
	"weighed_by" text NOT NULL,
	"registered_by" text,
	"challan" text,
	"notes" text,
	"split_from_id" text,
	"split_g" integer DEFAULT 0 NOT NULL,
	"last_movement" text,
	"label_printed_at" timestamp with time zone,
	"label_printed_by" text,
	"label_activated_at" timestamp with time zone,
	"current_location_id" text NOT NULL,
	"consumed_g" integer DEFAULT 0 NOT NULL,
	"adjusted_g" integer DEFAULT 0 NOT NULL,
	"remaining_g" integer NOT NULL,
	"status" "roll_status" DEFAULT 'AWAITING_LABEL' NOT NULL,
	"rack_id" text,
	"rack_since" timestamp with time zone,
	"last_rack_id" text,
	"off_rack_reason" text,
	"off_rack_ref" text,
	"off_rack_at" timestamp with time zone,
	"missing_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rolls_serial_unique" UNIQUE("serial")
);
--> statement-breakpoint
CREATE TABLE "serial_registry" (
	"serial" text PRIMARY KEY NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fabric_no" text,
	"how" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spot_weighs" (
	"id" text PRIMARY KEY NOT NULL,
	"check_id" text NOT NULL,
	"roll_id" text NOT NULL,
	"sheet_g" integer NOT NULL,
	"weighed_g" integer,
	"weighed_at" timestamp with time zone,
	"weighed_by" text
);
--> statement-breakpoint
CREATE TABLE "to_items" (
	"id" text PRIMARY KEY NOT NULL,
	"to_id" text NOT NULL,
	"row_no" integer NOT NULL,
	"fabric_item_id" text NOT NULL,
	"kg_g" integer NOT NULL,
	"waste_g" integer DEFAULT 0 NOT NULL,
	"pieces" integer,
	"pick" text DEFAULT 'FIFO' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "to_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"to_id" text NOT NULL,
	"roll_id" text NOT NULL,
	"batch_code" text NOT NULL,
	"fabric_no" text NOT NULL,
	"kg_g" integer NOT NULL,
	"waste_g" integer DEFAULT 0 NOT NULL,
	"source_before_g" integer NOT NULL,
	"source_after_g" integer NOT NULL,
	"dest_before_g" integer NOT NULL,
	"dest_after_g" integer NOT NULL,
	"roll_before_g" integer NOT NULL,
	"roll_after_g" integer NOT NULL,
	"item_row" integer DEFAULT 1 NOT NULL,
	"cut_from_serial" text,
	"rack_code" text
);
--> statement-breakpoint
CREATE TABLE "transfer_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"to_number" text NOT NULL,
	"type" "to_type" NOT NULL,
	"date" date NOT NULL,
	"reason" text,
	"source_location_id" text NOT NULL,
	"dest_location_id" text NOT NULL,
	"dest_address" text,
	"style_po" text,
	"mo_number" text,
	"tax_invoice_no" text,
	"attachments_url" text,
	"pieces_made" integer,
	"posted_by" text NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entered_in_zoho" boolean DEFAULT false NOT NULL,
	"entered_in_zoho_at" timestamp with time zone,
	"entered_in_zoho_by" text,
	"is_reversal" boolean DEFAULT false NOT NULL,
	"reversal_of_id" text,
	"reversal_reason" text,
	CONSTRAINT "transfer_orders_to_number_unique" UNIQUE("to_number"),
	CONSTRAINT "transfer_orders_reversal_of_id_unique" UNIQUE("reversal_of_id")
);
--> statement-breakpoint
CREATE TABLE "user_locations" (
	"user_id" text NOT NULL,
	"location_id" text NOT NULL,
	CONSTRAINT "user_locations_user_id_location_id_pk" PRIMARY KEY("user_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "role" DEFAULT 'VIEWER' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"all_locations" boolean DEFAULT false NOT NULL,
	"all_style_pos" boolean DEFAULT false NOT NULL,
	"style_po_prefixes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_roll_id_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_fabric_item_id_fabric_items_id_fk" FOREIGN KEY ("fabric_item_id") REFERENCES "public"."fabric_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_links" ADD CONSTRAINT "order_links_to_id_transfer_orders_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."transfer_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rack_counts" ADD CONSTRAINT "rack_counts_rack_id_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."racks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rack_moves" ADD CONSTRAINT "rack_moves_roll_id_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "racks" ADD CONSTRAINT "racks_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_fabric_item_id_fabric_items_id_fk" FOREIGN KEY ("fabric_item_id") REFERENCES "public"."fabric_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_registered_location_id_locations_id_fk" FOREIGN KEY ("registered_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_current_location_id_locations_id_fk" FOREIGN KEY ("current_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_weighs" ADD CONSTRAINT "spot_weighs_check_id_carbonwork_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."carbonwork_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_weighs" ADD CONSTRAINT "spot_weighs_roll_id_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "to_items" ADD CONSTRAINT "to_items_to_id_transfer_orders_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."transfer_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "to_items" ADD CONSTRAINT "to_items_fabric_item_id_fabric_items_id_fk" FOREIGN KEY ("fabric_item_id") REFERENCES "public"."fabric_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "to_lines" ADD CONSTRAINT "to_lines_to_id_transfer_orders_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."transfer_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "to_lines" ADD CONSTRAINT "to_lines_roll_id_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD CONSTRAINT "transfer_orders_source_location_id_locations_id_fk" FOREIGN KEY ("source_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD CONSTRAINT "transfer_orders_dest_location_id_locations_id_fk" FOREIGN KEY ("dest_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adj_status_idx" ON "adjustments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_uq" ON "drafts" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "fabric_cw_idx" ON "fabric_items" USING btree ("cw_fabric_code","colour");--> statement-breakpoint
CREATE INDEX "order_no_idx" ON "order_links" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "rackmove_at_idx" ON "rack_moves" USING btree ("at");--> statement-breakpoint
CREATE INDEX "rackmove_roll_idx" ON "rack_moves" USING btree ("roll_id");--> statement-breakpoint
CREATE INDEX "roll_rack_idx" ON "rolls" USING btree ("rack_id");--> statement-breakpoint
CREATE INDEX "roll_loc_idx" ON "rolls" USING btree ("current_location_id","status");--> statement-breakpoint
CREATE INDEX "roll_fabric_idx" ON "rolls" USING btree ("fabric_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spot_uq" ON "spot_weighs" USING btree ("check_id","roll_id");--> statement-breakpoint
CREATE UNIQUE INDEX "toitem_uq" ON "to_items" USING btree ("to_id","row_no");--> statement-breakpoint
CREATE UNIQUE INDEX "toline_uq" ON "to_lines" USING btree ("to_id","roll_id");--> statement-breakpoint
CREATE INDEX "toline_roll_idx" ON "to_lines" USING btree ("roll_id");--> statement-breakpoint
CREATE INDEX "to_date_idx" ON "transfer_orders" USING btree ("date");--> statement-breakpoint
CREATE INDEX "to_style_idx" ON "transfer_orders" USING btree ("style_po");