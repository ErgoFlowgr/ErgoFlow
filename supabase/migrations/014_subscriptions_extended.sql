-- Extend subscriptions table with tier, VAPI, and billing period fields

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS tier                TEXT        NOT NULL DEFAULT 'basic', -- basic | pro | pro_plus
  ADD COLUMN IF NOT EXISTS vapi_assistant_id   TEXT,
  ADD COLUMN IF NOT EXISTS vapi_phone_number   TEXT,
  ADD COLUMN IF NOT EXISTS vapi_minutes_used   INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS period_start        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS period_end          TIMESTAMPTZ;

-- Index for webhook lookups by stripe_subscription_id
CREATE INDEX IF NOT EXISTS subscriptions_stripe_sub_idx
  ON subscriptions (stripe_subscription_id);

-- Index for webhook lookups by stripe_customer_id
CREATE INDEX IF NOT EXISTS subscriptions_stripe_cust_idx
  ON subscriptions (stripe_customer_id);
