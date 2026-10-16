-- Which 402s carried a registration invite (job G3).
--
-- From 1.4.0 a 402 answered on `attestation_missing` carries
-- moltrustGate.invite, naming the gate operator as referrer, when
-- MOLTRUST_GATE_OPERATOR_DID is set. The daily count of those 402s is read
-- from this column. The row is written after the response is decided, so a
-- request that paid or used a hackathon key is never counted as invited.
--
-- gate_decisions is owned by the application role, so this needs no sudo:
--
--   psql "$DATABASE_URL" -f migrations/2026-10-16_gate_decisions_invited.sql
--
-- Nothing is backfilled. Rows before the deploy of 1.4.0 read false, which
-- is what they were: no 402 before it carried an invite.
--
-- The writer falls back to the older row shape on 42703 (undefined_column),
-- so the deploy does not depend on this having run first.

ALTER TABLE gate_decisions ADD COLUMN IF NOT EXISTS invited boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN gate_decisions.invited IS
  'The 402 answering this request carried moltrustGate.invite. '
  'false on every row before 2026-10-16 and on every request that did not end in a 402.';
