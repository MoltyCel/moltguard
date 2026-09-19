-- 2026-09-19_skill_audits.sql
-- Free audit verdicts, kept against the canonical skill hash so /skill/vet-free
-- can answer for exactly those bytes without a second GitHub fetch.
--
-- Apply by hand:
--   psql -h localhost -U moltstack -d moltstack \
--        -f migrations/2026-09-19_skill_audits.sql
--
-- ensureAuditCacheTable() in src/services/skill.ts creates the same table on
-- first use, so a deploy does not depend on this file having been run. It is
-- here so the schema is versioned next to the code that needs it (#25).

CREATE TABLE IF NOT EXISTS skill_audits (
    skill_hash      TEXT PRIMARY KEY,
    skill_name      TEXT,
    skill_version   TEXT,
    github_url      TEXT,
    profile         TEXT NOT NULL,
    score           INTEGER NOT NULL,
    passed          BOOLEAN NOT NULL,
    findings        JSONB NOT NULL DEFAULT '[]'::jsonb,
    auditor_version TEXT NOT NULL,
    audited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skill_audits_audited_at ON skill_audits (audited_at DESC);
