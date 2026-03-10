import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono();

const CATALOG = [
  { id: '001', name: 'Sony WH-1000XM5', category: 'electronics', price: 289, currency: 'USDC', description: 'Premium noise-cancelling headphones' },
  { id: '002', name: 'Bose QC45', category: 'electronics', price: 279, currency: 'USDC', description: 'Comfortable noise-cancelling headphones' },
  { id: '003', name: 'Apple AirPods Pro', category: 'electronics', price: 249, currency: 'USDC', description: 'Active noise cancellation with spatial audio' },
  { id: '004', name: 'Samsung Galaxy Buds2 Pro', category: 'electronics', price: 189, currency: 'USDC', description: 'Hi-Fi audio with ANC' },
  { id: '005', name: 'Clean Code', category: 'books', price: 35, currency: 'USDC', description: 'Robert C. Martin — A handbook of agile software craftsmanship' },
];

// Catalog endpoint
app.get('/merchant/catalog', (c) => {
  const category = c.req.query('category');
  const maxPrice = c.req.query('maxPrice');
  const search = c.req.query('search')?.toLowerCase();

  let items = [...CATALOG];

  if (category) {
    items = items.filter(i => i.category === category);
  }
  if (maxPrice) {
    items = items.filter(i => i.price <= Number(maxPrice));
  }
  if (search) {
    items = items.filter(i =>
      i.name.toLowerCase().includes(search) ||
      i.description.toLowerCase().includes(search)
    );
  }

  return c.json({
    items,
    total: items.length,
    merchant: 'demo-shop.moltrust.ch',
  });
});

// Checkout — calls MoltGuard internally before fulfilling
app.post('/merchant/checkout', async (c) => {
  const { agentDID, vc, itemId, amount, currency } = await c.req.json();
  const ts = () => new Date().toISOString();

  console.log(`[${ts()}] [Merchant] Checkout request from agent: ${agentDID}`);
  console.log(`[${ts()}] [Merchant] Item: ${itemId}, Amount: ${amount} ${currency}`);

  // Verify item exists and price matches
  const item = CATALOG.find(i => i.id === itemId);
  if (!item) {
    return c.json({ result: 'rejected', reason: 'Item not found' }, 404);
  }
  if (item.price !== amount) {
    return c.json({ result: 'rejected', reason: `Price mismatch: expected ${item.price}, got ${amount}` }, 400);
  }

  // Call MoltGuard to verify agent credentials
  console.log(`[${ts()}] [Merchant] Calling MoltGuard /shopping/verify...`);
  try {
    const guardResponse = await fetch('https://api.moltrust.ch/guard/shopping/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentDID,
        vc,
        merchant: 'demo-shop.moltrust.ch',
        amount,
        currency,
      }),
    });

    const receipt = await guardResponse.json();
    console.log(`[${ts()}] [Merchant] MoltGuard result: ${receipt.result} (score: ${receipt.guardScore})`);

    if (receipt.result === 'rejected') {
      console.log(`[${ts()}] [Merchant] Order REJECTED: ${receipt.reason}`);
      return c.json({ result: 'rejected', reason: receipt.reason, receipt }, 403);
    }

    if (receipt.result === 'review') {
      console.log(`[${ts()}] [Merchant] Order needs REVIEW: ${receipt.reason}`);
      // For demo: auto-approve reviews with score > 20
      if (receipt.guardScore >= 20) {
        console.log(`[${ts()}] [Merchant] Auto-approving review (score ${receipt.guardScore} >= 20)`);
      } else {
        return c.json({ result: 'review', reason: receipt.reason, receipt }, 200);
      }
    }

    // Order approved
    const orderId = `ORD-${Date.now()}`;
    console.log(`[${ts()}] [Merchant] Order APPROVED: ${orderId}`);
    console.log(`[${ts()}] [Merchant] Item: ${item.name} @ ${item.price} ${item.currency}`);
    if (receipt.onChainTx) {
      console.log(`[${ts()}] [Merchant] On-chain TX: ${receipt.onChainTx}`);
    }

    return c.json({
      result: 'approved',
      order: {
        orderId,
        itemId: item.id,
        item: item.name,
        amount: item.price,
        currency: item.currency,
        status: 'confirmed',
      },
      receipt,
    });
  } catch (err: any) {
    console.error(`[${ts()}] [Merchant] MoltGuard error:`, err.message);
    return c.json({ result: 'error', reason: 'Trust verification service unavailable' }, 503);
  }
});

// Health check
app.get('/merchant/health', (c) => {
  return c.json({ status: 'ok', merchant: 'demo-shop.moltrust.ch', catalog: CATALOG.length });
});

const PORT = parseInt(process.env.MERCHANT_PORT || '3001');
serve({ fetch: app.fetch, port: PORT });
console.log(`\n[Mock Merchant] Running on http://localhost:${PORT}`);
console.log(`[Mock Merchant] Catalog: ${CATALOG.length} items`);
console.log(`[Mock Merchant] Endpoints:`);
console.log(`  GET  /merchant/catalog`);
console.log(`  POST /merchant/checkout`);
console.log(`  GET  /merchant/health\n`);
