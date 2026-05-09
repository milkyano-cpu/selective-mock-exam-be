CREATE TABLE IF NOT EXISTS "billing_invoices" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "stripe_invoice_id" TEXT NOT NULL,
  "stripe_customer_id" TEXT NOT NULL,
  "stripe_subscription_id" TEXT,
  "invoice_number" TEXT,
  "status" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "amount_due" INTEGER NOT NULL DEFAULT 0,
  "amount_paid" INTEGER NOT NULL DEFAULT 0,
  "hosted_invoice_url" TEXT,
  "stripe_invoice_pdf_url" TEXT,
  "minio_object_key" TEXT,
  "period_start" TIMESTAMP(3),
  "period_end" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_invoices_stripe_invoice_id_key"
  ON "billing_invoices"("stripe_invoice_id");

CREATE INDEX IF NOT EXISTS "billing_invoices_user_id_created_at_idx"
  ON "billing_invoices"("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "billing_invoices_stripe_customer_id_idx"
  ON "billing_invoices"("stripe_customer_id");

CREATE INDEX IF NOT EXISTS "billing_invoices_stripe_subscription_id_idx"
  ON "billing_invoices"("stripe_subscription_id");

CREATE INDEX IF NOT EXISTS "billing_invoices_status_idx"
  ON "billing_invoices"("status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'billing_invoices_user_id_fkey'
  ) THEN
    ALTER TABLE "billing_invoices"
      ADD CONSTRAINT "billing_invoices_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
