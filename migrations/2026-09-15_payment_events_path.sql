-- payment_events.path — which rail settled a payment.
--
-- REQUIRES THE postgres ROLE. payment_events is owned by postgres and the
-- application role moltstack may not ALTER it:
--
--   moltstack=> ALTER TABLE payment_events ADD COLUMN path TEXT;
--   ERROR:  must be owner of table payment_events
--
-- Apply as:
--   sudo -u postgres psql -d moltstack \
--     -f migrations/2026-09-15_payment_events_path.sql
--
-- The column records HOW the money arrived, not what was bought:
--
--   'transfer'  the payer broadcast the USDC transfer and paid the Base gas
--   'eip3009'   the payer signed a transferWithAuthorization and a facilitator
--               submitted it
--
-- The endpoint is already in x402_receipts.path; what payment_events could not
-- answer was which of the two rails settled.
--
-- Until this runs, moltguard src/services/x402-verify.ts writes the row without
-- the column: the insert is attempted with `path` and a 42703
-- (undefined_column) falls back to the older shape, because dropping a real
-- payment over a reporting field would be the worse outcome. The fallback is
-- remembered for the process lifetime, so the cost is one failed statement per
-- restart, and it disappears once this is applied.
--
-- Rows written before this migration keep path NULL. The rail is still
-- recoverable for them: a tx_hash present in x402_authorizations was settled
-- through EIP-3009, anything else was a direct transfer.

ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS path TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_events_path ON payment_events (path);

-- No new grant is needed: INSERT and UPDATE on the table are already held by
-- the application role, and a new column inherits them.
