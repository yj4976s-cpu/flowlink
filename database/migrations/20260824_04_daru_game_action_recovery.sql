BEGIN;

CREATE TABLE IF NOT EXISTS public.daru_game_run_actions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES public.daru_game_runs(id) ON DELETE CASCADE,
    action_id UUID NOT NULL,
    action_type VARCHAR(10) NOT NULL CHECK (action_type IN ('START', 'FLIP', 'HINT', 'COMPLETE')),
    request_fingerprint VARCHAR(64) NOT NULL,
    response_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_daru_game_run_actions_run_action UNIQUE (run_id, action_id)
);

ALTER TABLE public.daru_game_run_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.daru_game_run_actions FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.daru_game_run_actions_id_seq FROM anon, authenticated;

COMMIT;
