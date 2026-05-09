-- Add AI trial tracking to subscriptions
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS ai_trial_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_trial_used  BOOLEAN NOT NULL DEFAULT false;
