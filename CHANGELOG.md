# Changelog

## 1.6.0 — 2026-10-16

- A 402 now carries a `moltrustGate` block with the gate's `reason` and
  `detail` for this request.
- On `attestation_missing`, and only there, the block carries `invite`:
  `register_url`, `challenge_url`, `referrer_did`, `source` and one sentence on
  how to register for free. `referrer_did` is `MOLTRUST_GATE_OPERATOR_DID`;
  unset or not a `did:moltrust` identifier means no invite.
- `gate_decisions.invited` records whether the 402 for a request carried an
  invite (migration `2026-10-16_gate_decisions_invited.sql`). The row is now
  written once the request has left the middleware, so a paid request is never
  counted as invited.
- `/moltrust/gate-stats` reports `invited_402s` since process start.
- Version aligned: `package.json` said 1.3.0 while the service reported 1.5.0.
  Both now say 1.6.0.

Earlier changes are in the git history only.
