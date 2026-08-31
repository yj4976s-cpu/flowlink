BEGIN;

ALTER TABLE public.ai_model_deployment_events
ENABLE ROW LEVEL SECURITY;

COMMIT;
