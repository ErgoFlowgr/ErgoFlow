-- 026_ai_usage_limits.sql
-- Backend AI Helper usage ledger and fair-use counters.
-- Counts user-facing AI helper requests in the claude-proxy Edge Function.

CREATE TABLE IF NOT EXISTS public.ai_usage_monthly (
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period        TEXT        NOT NULL, -- YYYY-MM, UTC billing/usage month
  action_count  INTEGER     NOT NULL DEFAULT 0 CHECK (action_count >= 0),
  input_tokens  INTEGER     NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER     NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  last_model    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period)
);

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period        TEXT        NOT NULL,
  event_type    TEXT        NOT NULL DEFAULT 'claude_proxy',
  model         TEXT,
  input_chars   INTEGER     NOT NULL DEFAULT 0 CHECK (input_chars >= 0),
  output_chars  INTEGER     NOT NULL DEFAULT 0 CHECK (output_chars >= 0),
  input_tokens  INTEGER     NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER     NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  request_id    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_usage_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own monthly AI usage" ON public.ai_usage_monthly;
CREATE POLICY "Users can read own monthly AI usage"
  ON public.ai_usage_monthly FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own AI usage events" ON public.ai_usage_events;
CREATE POLICY "Users can read own AI usage events"
  ON public.ai_usage_events FOR SELECT
  USING (auth.uid() = user_id);

-- Clients can read their own usage. Writes are service-role only via Edge Functions.
GRANT SELECT ON public.ai_usage_monthly TO authenticated;
GRANT SELECT ON public.ai_usage_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_usage_monthly TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_usage_events TO service_role;

CREATE INDEX IF NOT EXISTS ai_usage_events_user_period_idx
  ON public.ai_usage_events (user_id, period, created_at DESC);

CREATE OR REPLACE FUNCTION public.consume_ai_action(
  p_user_id UUID,
  p_period TEXT,
  p_limit INTEGER
)
RETURNS TABLE(allowed BOOLEAN, action_count INTEGER, action_limit INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_user_id IS NULL OR p_period IS NULL OR p_limit <= 0 THEN
    RETURN QUERY SELECT false, 0, GREATEST(p_limit, 0);
    RETURN;
  END IF;

  INSERT INTO public.ai_usage_monthly (user_id, period, action_count)
  VALUES (p_user_id, p_period, 1)
  ON CONFLICT (user_id, period)
  DO UPDATE SET
    action_count = public.ai_usage_monthly.action_count + 1,
    updated_at   = now()
  WHERE public.ai_usage_monthly.action_count < p_limit
  RETURNING public.ai_usage_monthly.action_count INTO v_count;

  IF v_count IS NULL THEN
    SELECT m.action_count INTO v_count
    FROM public.ai_usage_monthly m
    WHERE m.user_id = p_user_id AND m.period = p_period;

    RETURN QUERY SELECT false, COALESCE(v_count, 0), p_limit;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_count, p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_action(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_ai_action(UUID, TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.add_ai_usage_tokens(
  p_user_id UUID,
  p_period TEXT,
  p_input_tokens INTEGER,
  p_output_tokens INTEGER,
  p_model TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_period IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.ai_usage_monthly (
    user_id,
    period,
    action_count,
    input_tokens,
    output_tokens,
    last_model
  )
  VALUES (
    p_user_id,
    p_period,
    0,
    GREATEST(COALESCE(p_input_tokens, 0), 0),
    GREATEST(COALESCE(p_output_tokens, 0), 0),
    p_model
  )
  ON CONFLICT (user_id, period)
  DO UPDATE SET
    input_tokens  = public.ai_usage_monthly.input_tokens + GREATEST(COALESCE(p_input_tokens, 0), 0),
    output_tokens = public.ai_usage_monthly.output_tokens + GREATEST(COALESCE(p_output_tokens, 0), 0),
    last_model    = COALESCE(p_model, public.ai_usage_monthly.last_model),
    updated_at    = now();
END;
$$;

REVOKE ALL ON FUNCTION public.add_ai_usage_tokens(UUID, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_ai_usage_tokens(UUID, TEXT, INTEGER, INTEGER, TEXT) TO service_role;
