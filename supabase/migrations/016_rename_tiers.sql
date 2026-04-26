-- Rename tiers: pro → plus, pro_plus → pro. Add trial as a formal tier value.

-- 1. Rename existing paid tier values
UPDATE subscriptions SET tier = 'pro'  WHERE tier = 'pro_plus';
UPDATE subscriptions SET tier = 'plus' WHERE tier = 'pro';

-- 2. Set trial tier for users currently in trial status
UPDATE subscriptions SET tier = 'trial' WHERE status = 'trial';

-- 3. Update column default
ALTER TABLE subscriptions ALTER COLUMN tier SET DEFAULT 'basic';

-- 4. Enforce valid values going forward
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_tier_check
  CHECK (tier IN ('trial', 'basic', 'plus', 'pro'));
