-- The audit trail is append-only: reject any UPDATE or DELETE on activities.
CREATE OR REPLACE FUNCTION lsa_reject_activity_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activities is append-only (attempted %)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER activities_append_only
  BEFORE UPDATE OR DELETE ON activities
  FOR EACH ROW EXECUTE FUNCTION lsa_reject_activity_change();
--> statement-breakpoint
CREATE TRIGGER activities_no_truncate
  BEFORE TRUNCATE ON activities
  FOR EACH STATEMENT EXECUTE FUNCTION lsa_reject_activity_change();
--> statement-breakpoint
-- Self references added here so drizzle's table definitions stay simple.
ALTER TABLE tickets ADD CONSTRAINT tickets_parent_fk FOREIGN KEY (parent_id) REFERENCES tickets(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE tickets ADD CONSTRAINT tickets_duplicate_fk FOREIGN KEY (duplicate_of_id) REFERENCES tickets(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE tickets ADD CONSTRAINT tickets_active_run_fk FOREIGN KEY (active_run_id) REFERENCES runs(id) ON DELETE SET NULL;
--> statement-breakpoint
-- At most one pending gate per run.
CREATE UNIQUE INDEX gates_one_pending_per_run ON gates (run_id) WHERE status = 'pending';
--> statement-breakpoint
-- At most one active run per ticket.
CREATE UNIQUE INDEX runs_one_active_per_ticket ON runs (ticket_id) WHERE status IN ('queued','running','awaiting_approval','paused','blocked');
