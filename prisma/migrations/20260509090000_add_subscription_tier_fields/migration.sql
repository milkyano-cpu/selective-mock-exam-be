ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "stripe_price_id" TEXT,
  ADD COLUMN IF NOT EXISTS "stripe_product_id" TEXT,
  ADD COLUMN IF NOT EXISTS "tier" "Tier" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_stripe_subscription_id_key"
  ON "subscriptions"("stripe_subscription_id");

CREATE INDEX IF NOT EXISTS "subscriptions_stripe_customer_id_idx"
  ON "subscriptions"("stripe_customer_id");
