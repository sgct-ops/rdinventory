CREATE INDEX "adj_roll_idx" ON "adjustments" USING btree ("roll_id");--> statement-breakpoint
CREATE INDEX "order_to_idx" ON "order_links" USING btree ("to_id");--> statement-breakpoint
CREATE INDEX "roll_batch_idx" ON "rolls" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "roll_created_idx" ON "rolls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "to_posted_idx" ON "transfer_orders" USING btree ("posted_at");