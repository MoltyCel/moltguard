/**
 * MT Shopping Demo Agent
 *
 * A minimal autonomous shopping agent that:
 * 1. Requests a BuyerAgentCredential from MolTrust
 * 2. Browses a merchant catalog
 * 3. Selects an item matching criteria
 * 4. Checks out with VC verification via MoltGuard
 */

const MOLTGUARD_BASE = process.env.MOLTGUARD_URL || 'https://api.moltrust.ch/guard';
const MERCHANT_BASE = process.env.MERCHANT_URL || 'http://localhost:3001';
const AGENT_DID = process.env.AGENT_DID || 'did:base:0x380238347e58435f40B4da1F1A045A271D5838F5';
const HUMAN_DID = process.env.HUMAN_DID || 'did:base:0xHumanPrincipal789';

function ts(): string {
  return new Date().toISOString();
}

async function runShoppingAgent() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║         MT Shopping — Demo Agent             ║');
  console.log('║   Autonomous Purchase with Trust Verification║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // Step 1: Request Buyer Agent VC
  console.log(`[${ts()}] [Step 1] Requesting BuyerAgentCredential...`);
  console.log(`  Agent DID:  ${AGENT_DID}`);
  console.log(`  Human DID:  ${HUMAN_DID}`);
  console.log(`  Spend Limit: 300 USDC`);
  console.log(`  Categories:  electronics`);
  console.log(`  Valid:        7 days\n`);

  const vcResp = await fetch(`${MOLTGUARD_BASE}/vc/buyer-agent/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentDID: AGENT_DID,
      humanDID: HUMAN_DID,
      spendLimit: 300,
      currency: 'USDC',
      validDays: 7,
      categories: ['electronics'],
      trustLevel: 'verified',
    }),
  });

  if (!vcResp.ok) {
    console.error(`  FAILED: ${vcResp.status} ${await vcResp.text()}`);
    process.exit(1);
  }

  const vc = await vcResp.json();
  console.log(`  ✓ VC issued successfully`);
  console.log(`  VC Type:    ${vc.type.join(', ')}`);
  console.log(`  Issuer:     ${vc.issuer.id}`);
  console.log(`  Expires:    ${vc.expirationDate}`);
  console.log(`  JWS:        ${vc.proof.jws.slice(0, 40)}...`);
  console.log();

  // Step 2: Browse merchant catalog
  console.log(`[${ts()}] [Step 2] Browsing merchant catalog...`);
  console.log(`  Merchant:  ${MERCHANT_BASE}`);
  console.log(`  Filter:    category=electronics, maxPrice=300\n`);

  const catalogResp = await fetch(
    `${MERCHANT_BASE}/merchant/catalog?category=electronics&maxPrice=300`
  );
  const catalog = await catalogResp.json();

  console.log(`  Found ${catalog.total} items:`);
  for (const item of catalog.items) {
    console.log(`    [${item.id}] ${item.name} — ${item.price} ${item.currency}`);
  }
  console.log();

  // Step 3: Select cheapest item matching "headphones" or "airpods"
  console.log(`[${ts()}] [Step 3] Selecting best match for "headphones"...`);
  const matches = catalog.items.filter((i: any) =>
    i.name.toLowerCase().includes('headphone') ||
    i.name.toLowerCase().includes('airpods') ||
    i.name.toLowerCase().includes('buds')
  );

  if (matches.length === 0) {
    console.error('  No matching items found!');
    process.exit(1);
  }

  const selected = matches.sort((a: any, b: any) => a.price - b.price)[0];
  console.log(`  ✓ Selected: ${selected.name} @ ${selected.price} ${selected.currency}`);
  console.log();

  // Step 4: Checkout
  console.log(`[${ts()}] [Step 4] Initiating checkout...`);
  console.log(`  Item:     ${selected.name} (${selected.id})`);
  console.log(`  Amount:   ${selected.price} ${selected.currency}`);
  console.log(`  Agent:    ${AGENT_DID}`);
  console.log(`  VC:       BuyerAgentCredential (spend limit: 300 USDC)\n`);

  const checkoutResp = await fetch(`${MERCHANT_BASE}/merchant/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentDID: AGENT_DID,
      vc,
      itemId: selected.id,
      amount: selected.price,
      currency: selected.currency,
    }),
  });

  const result = await checkoutResp.json();

  // Step 5: Display results
  console.log(`[${ts()}] [Step 5] Order result:`);
  console.log(`  Status:      ${result.result}`);

  if (result.result === 'approved') {
    console.log(`  Order ID:    ${result.order.orderId}`);
    console.log(`  Item:        ${result.order.item}`);
    console.log(`  Amount:      ${result.order.amount} ${result.order.currency}`);
    console.log(`  Guard Score: ${result.receipt.guardScore}/100`);
    console.log(`  Receipt ID:  ${result.receipt.receiptId}`);
    if (result.receipt.onChainTx) {
      console.log(`  On-chain TX: ${result.receipt.onChainTx}`);
    }
  } else if (result.result === 'review') {
    console.log(`  Reason:      ${result.reason}`);
    console.log(`  Guard Score: ${result.receipt?.guardScore}/100`);
    console.log(`  → Merchant may approve manually`);
  } else {
    console.log(`  Reason:      ${result.reason || result.receipt?.reason}`);
    console.log(`  Guard Score: ${result.receipt?.guardScore || 'N/A'}`);
  }

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║         Demo Complete                        ║');
  console.log('╚══════════════════════════════════════════════╝');
}

runShoppingAgent().catch((err) => {
  console.error('\nAgent error:', err);
  process.exit(1);
});
