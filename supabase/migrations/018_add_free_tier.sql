-- Add 'free' as a valid tier and make it the default for new accounts.
-- Existing subscription rows are NOT modified.

-- 1. Drop the existing tier check constraint
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_tier_check;

-- 2. Re-add the constraint with 'free' included
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_tier_check
  CHECK (tier IN ('free', 'trial', 'basic', 'plus', 'pro'));

-- 3. Change the column default so new rows land on 'free'
ALTER TABLE subscriptions ALTER COLUMN tier SET DEFAULT 'free';
