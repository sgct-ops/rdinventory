CREATE TABLE "fabric_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"kind" text DEFAULT 'SJ' NOT NULL,
	"pair_group_id" text,
	"cw_fabric_code" text,
	"vendor" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fabric_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "po_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"po_id" text NOT NULL,
	"fabric_item_id" text NOT NULL,
	"expected_g" integer NOT NULL,
	"expected_rolls" integer,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"po_number" text NOT NULL,
	"vendor" text,
	"expected_date" date,
	"source" text DEFAULT 'MANUAL' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_po_number_unique" UNIQUE("po_number")
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"po_id" text,
	"po_number" text NOT NULL,
	"invoice_no" text NOT NULL,
	"challan" text,
	"date" date NOT NULL,
	"location_id" text NOT NULL,
	"rolls" integer NOT NULL,
	"kg_g" integer NOT NULL,
	"received_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "to_picks" (
	"id" text PRIMARY KEY NOT NULL,
	"to_id" text NOT NULL,
	"roll_id" text NOT NULL,
	"item_row" integer NOT NULL,
	"kg_g" integer NOT NULL,
	"cut" boolean DEFAULT false NOT NULL,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fabric_items" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "rolls" ADD COLUMN "invoice_no" text;--> statement-breakpoint
ALTER TABLE "rolls" ADD COLUMN "receipt_id" text;--> statement-breakpoint
ALTER TABLE "rolls" ADD COLUMN "taken_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rolls" ADD COLUMN "taken_out_by" text;--> statement-breakpoint
ALTER TABLE "rolls" ADD COLUMN "taken_out_purpose" text;--> statement-breakpoint
ALTER TABLE "rolls" ADD COLUMN "taken_out_for" text;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD COLUMN "status" text DEFAULT 'POSTED' NOT NULL;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD COLUMN "planned_by" text;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD COLUMN "planned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "receive_location_id" text;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_fabric_item_id_fabric_items_id_fk" FOREIGN KEY ("fabric_item_id") REFERENCES "public"."fabric_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "to_picks" ADD CONSTRAINT "to_picks_to_id_transfer_orders_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."transfer_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "to_picks" ADD CONSTRAINT "to_picks_roll_id_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "poline_uq" ON "po_lines" USING btree ("po_id","fabric_item_id");--> statement-breakpoint
CREATE INDEX "receipt_po_idx" ON "receipts" USING btree ("po_number");--> statement-breakpoint
CREATE INDEX "receipt_inv_idx" ON "receipts" USING btree ("invoice_no");--> statement-breakpoint
CREATE UNIQUE INDEX "topick_uq" ON "to_picks" USING btree ("to_id","roll_id");--> statement-breakpoint
CREATE INDEX "fabric_group_idx" ON "fabric_items" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "roll_invoice_idx" ON "rolls" USING btree ("invoice_no");--> statement-breakpoint
CREATE INDEX "to_status_idx" ON "transfer_orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "fabric_group_colour_uq" ON "fabric_items" USING btree ("group_id", upper("colour")) WHERE "group_id" IS NOT NULL;