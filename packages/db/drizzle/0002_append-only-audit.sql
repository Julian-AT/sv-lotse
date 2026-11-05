CREATE FUNCTION public.reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_event_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.audit_event
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_event_mutation();
