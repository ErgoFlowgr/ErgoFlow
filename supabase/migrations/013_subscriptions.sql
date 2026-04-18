-- Subscription / license table
-- Run this in the Supabase SQL editor or via `supabase db push`

CREATE TABLE IF NOT EXISTS subscriptions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  status                  TEXT        NOT NULL DEFAULT 'trial', -- trial | active | expired | cancelled
  trial_end               TIMESTAMPTZ NOT NULL,
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscription"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscription"
  ON subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Allow service role (Edge Functions) to update subscriptions via Stripe webhook
-- No UPDATE policy for regular users — only the webhook can change status.
