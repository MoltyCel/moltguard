-- gate_decisions keeps the reason and threw away the sentence behind it.
--
-- `reason` is one of ten enum-ish strings, so every failure to verify a
-- presented attestation -- malformed, wrong algorithm, unknown key id, bad
-- signature, wrong payload version, expired -- arrives as the single value
-- `attestation_invalid`. The sentence that says which one exists already:
-- moltrust-gate.ts:349 passes `(err as Error).message` into `deny()`, and it
-- reaches the response. It was never stored.
--
-- That cost an answer on 2026-10-05. A registered agent of ours
-- (did:moltrust:cad78d76790d4a40) polled /api/agent/score for its own bound
-- wallet every 30 minutes, presenting an attestation that the gate rejected
-- every time, and the reason why is not recoverable from the row. The same
-- gap means a governance-shaped payload -- which the gate names exactly
-- ("payload version undefined is not a gate attestation") -- can only be
-- counted inside the lump of all rejections, never as its own number.
--
-- Nothing is backfilled. The rows already written have no sentence to recover.
--
-- Not a payload dump: the stored text is the verifier's own message, capped at
-- 200 characters in the writer. Two caller-controlled values can appear inside
-- it, `payload.v` and `payload.valid_until`, which is what the cap is for.

ALTER TABLE gate_decisions ADD COLUMN IF NOT EXISTS detail text;

COMMENT ON COLUMN gate_decisions.detail IS
  'Verifier message behind `reason`, capped at 200 chars by the writer. '
  'NULL on an allow and on rows written before 2026-10-06.';
