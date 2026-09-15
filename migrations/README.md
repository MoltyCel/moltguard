# migrations

SQL that MoltGuard's own code depends on, versioned next to the code that
depends on it.

MoltGuard writes to the shared `moltstack` database rather than owning one, so a
migration here is not applied automatically and there is no runner. Each file
states in its header what it needs and how to apply it.

**Ownership matters more than usual.** Some tables in that database are owned by
the `postgres` role and the application role `moltstack` may not `ALTER` them:

```
moltstack=> ALTER TABLE payment_events ADD COLUMN path TEXT;
ERROR:  must be owner of table payment_events
```

There is no NOPASSWD route to the `postgres` role on the host, so those
migrations are applied by hand:

```
sudo -u postgres psql -d moltstack -f migrations/<file>.sql
```

Tables MoltGuard creates itself — `x402_receipts`, `x402_authorizations` — are
created on demand by `src/services/x402-verify.ts` with `CREATE TABLE IF NOT
EXISTS` and need nothing here.

**Write code that survives an unapplied migration.** `recordPaymentEvent`
attempts the insert with `path` and falls back to the older shape on a `42703`
(undefined_column), because dropping a real payment over a reporting field is
the worse outcome. A migration that has not run yet should cost a degraded
field, never a lost row.

## Applied

| File | Applied | What |
|---|---|---|
| `2026-09-15_payment_events_path.sql` | 2026-09-15 | `payment_events.path` — which rail settled a payment (`transfer` or `eip3009`) |
