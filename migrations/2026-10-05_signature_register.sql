-- 2026-10-05_signature_register.sql
-- Every signature this service produces gets a row, and a signature that cannot
-- be recorded is not produced.
--
-- Apply by hand:
--   psql -h localhost -U moltstack -d moltstack \
--        -f migrations/2026-10-05_signature_register.sql
--
-- ensureRegisterTable() in src/services/signatureRegister.ts creates the same
-- table on first use, so a deploy does not depend on this file having run.
--
-- This one departs from the rule in README.md that a missing migration should
-- cost a degraded field and never a row. Here an unavailable register costs the
-- signature: on 2026-10-05 this service had issued 28 signed authorization
-- attestations it could not enumerate, let alone revoke, because nothing wrote
-- them down. A signature nobody can account for is worse than a request that
-- fails.
--
-- No plaintext body. The digest is enough to recognise a signature somebody
-- presents, and the body may carry a subject's data we have no reason to keep.

CREATE TABLE IF NOT EXISTS signature_register (
    body_digest     TEXT PRIMARY KEY,          -- sha256 of the signed payload, hex
    subject_did     TEXT NOT NULL,
    scopes          TEXT[] NOT NULL DEFAULT '{}',
    route           TEXT NOT NULL,
    valid_from      TIMESTAMPTZ NOT NULL,
    valid_until     TIMESTAMPTZ,               -- null: the artefact carries no expiry
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    caller_ip       TEXT,
    revoked_at      TIMESTAMPTZ,
    revoked_reason  TEXT
);

CREATE INDEX IF NOT EXISTS signature_register_subject_idx
    ON signature_register (subject_did, issued_at DESC);
CREATE INDEX IF NOT EXISTS signature_register_route_idx
    ON signature_register (route, issued_at DESC);
-- Answering "what is still live" without scanning the table.
CREATE INDEX IF NOT EXISTS signature_register_live_idx
    ON signature_register (valid_until)
    WHERE revoked_at IS NULL;
