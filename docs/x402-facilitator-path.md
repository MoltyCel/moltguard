# x402 settlement: the gasless facilitator path

Status: **design note, not implemented.** Opened as the follow-up to
[#16](https://github.com/MoltyCel/moltguard/pull/16), which made settled payments
bookable but did not change how they are settled.

## What runs today

The payer sends the USDC transfer themselves and pays the Base gas. `verifyPayment`
reads the resulting transaction, sums the `Transfer` logs that credit `MOLTGUARD_WALLET`,
and accepts the receipt when the total covers the price. Nothing else participates.

Verified end to end on 2026-09-14: tx `0x7c42d2a5…353f8c23` (block 51307226) moved
0.05 USDC from `0xd8f5…6C38` to `0x3802…38F5`; the same call returned 402 before and
200 after.

Two consequences follow from that design:

- **The caller needs a funded wallet on Base** — USDC *and* ETH. An agent holding only
  USDC cannot pay us. During the self-test this was the actual blocker: the test wallet
  had 1 USDC and no ETH, and could not move a cent until gas arrived separately.
- **Two round trips before the first byte of data.** Sign and broadcast, wait for
  inclusion, then call again with the receipt. On Base that is seconds, not minutes,
  but it is still a settlement the caller has to babysit.

## What `x402.json` currently promises

`/.well-known/x402.json` advertises `"facilitator": "https://x402.org/facilitator"`, and
`FACILITATOR_URL` is read into `CONFIG.facilitatorUrl` in `src/config.ts`.

**That value is never used.** `grep -rn facilitatorUrl src/` returns the assignment and
nothing else. We advertise a settlement service we do not call, which is worse than
advertising nothing: a conforming client may route its payment through the facilitator
and then find no corresponding transfer on our side.

## What the facilitator path would change

USDC on Base implements EIP-3009. The payer signs a `transferWithAuthorization` message
off-chain — no gas, no broadcast, no wallet funded with ETH — and hands the signature to
the resource server in the `PAYMENT-SIGNATURE` header. The facilitator submits it and
pays the gas.

For the caller this collapses to one request. For us it means accepting a signed
authorization instead of a transaction hash, which is a different trust model: a
signature is a promise, a settled transfer is a fact. The verifier would have to submit
or confirm settlement before serving the response, or accept the counterparty risk
knowingly.

## Work this needs

1. Parse an EIP-3009 authorization out of the payment header alongside the existing
   `txHash` shape, and keep both accepted — the current path stays valid for callers
   who already hold ETH.
2. Validate the authorization locally before spending a facilitator call: correct
   `to`, `value` at least the price, `validAfter`/`validBefore` in range, and the
   `nonce` unused.
3. Submit through the facilitator, then confirm the resulting transaction with the same
   `usdcPaidTo` check that guards the current path. The response must not be served on
   the signature alone.
4. Extend replay defence. `x402_receipts` is keyed on `tx_hash`; an authorization has a
   32-byte nonce instead, and both need to be single-use.
5. Decide what happens when the facilitator is unreachable. Failing the request is
   honest; queuing it is not, because the caller is waiting for data.

## Decide before building

Whether we want the counterparty risk at all. The current path makes the caller prove
payment before we spend compute, which for a trust-and-governance product is a defensible
default rather than an accident. The facilitator path trades that for reach: agents that
hold stablecoins but no gas token can pay us at all.

Until it is built, `x402.json` should stop naming a facilitator.
