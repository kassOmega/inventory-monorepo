-- StockRequest: client-generated idempotency key so an offline/queued request
-- can be replayed safely without creating a duplicate. Purely additive
-- (nullable column + unique index), so it is safe to deploy and to leave in
-- place on rollback.

ALTER TABLE "StockRequest" ADD COLUMN IF NOT EXISTS "clientRef" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "StockRequest_tenantId_clientRef_key"
  ON "StockRequest" ("tenantId", "clientRef");
