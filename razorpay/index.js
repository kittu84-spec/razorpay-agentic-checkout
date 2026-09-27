require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const OpenAI = require('openai');
const catalog = require('./catalog');

const app = express();
app.use(cors());
app.use(express.json());

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Groq speaks the same "language" as OpenAI's API, so we use the OpenAI
// library but point it at Groq's servers instead, using our Groq key.
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

app.get('/', (req, res) => {
  res.send('Backend is running');
});

// ---- Existing routes (unchanged) ----

app.post('/create-order', async (req, res) => {
  try {
    const { amount } = req.body;
    const order = await razorpay.orders.create({
      amount: amount * 100,
      currency: 'INR',
      receipt: 'receipt_' + Date.now(),
    });
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong creating the order' });
  }
});

app.post('/verify-payment', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');
  const isValid = expectedSignature === razorpay_signature;
  if (isValid) {
    res.json({ status: 'success', message: 'Payment verified' });
  } else {
    res.status(400).json({ status: 'failed', message: 'Payment verification failed' });
  }
});

// ---- Agent layer ----

let cart = []; // simple shared cart — fine for a solo demo, not multi-user safe
const auditLog = [];

function logAction(action, details) {
  auditLog.push({ time: new Date().toISOString(), action, details });
}

const CONFIRM_THRESHOLD = 2000; // orders above this need explicit user confirmation

// OpenAI-style tool definitions (Groq uses this exact format)
const tools = [
  {
    type: 'function',
    function: {
      name: 'search_catalog',
      description: 'Search the product catalog by name or category keyword.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search term, e.g. "fertilizer" or "urea"' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_to_cart',
      description: 'Add a product to the cart by its id and quantity.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string' },
          quantity: { type: 'number' },
        },
        required: ['product_id', 'quantity'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'view_cart',
      description: 'View the current cart contents and total.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkout',
      description:
        'Create a Razorpay order for the current cart total. If the total is above the confirmation threshold, this requires confirm:true, which should only be passed after the user has explicitly agreed to that exact total.',
      parameters: {
        type: 'object',
        properties: {
          confirm: { type: 'boolean', description: 'Set true only after the user has explicitly confirmed the order.' },
        },
      },
    },
  },
];

function calcTotal() {
  return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

async function runTool(name, input) {
  if (name === 'search_catalog') {
    const q = input.query.toLowerCase();
    const results = catalog.filter(
      (p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
    );
    logAction('search_catalog', { query: input.query, resultsCount: results.length });
    return results;
  }

  if (name === 'add_to_cart') {
    const product = catalog.find((p) => p.id === input.product_id);
    if (!product) return { error: 'Product not found' };

    const existing = cart.find((item) => item.id === product.id);
    if (existing) {
      existing.quantity += input.quantity;
    } else {
      cart.push({ ...product, quantity: input.quantity });
    }
    logAction('add_to_cart', { product: product.name, quantity: input.quantity });
    return { cart, total: calcTotal() };
  }

  if (name === 'view_cart') {
    return { cart, total: calcTotal() };
  }

  if (name === 'checkout') {
    const total = calcTotal();
    if (total === 0) return { error: 'Cart is empty' };

    if (total > CONFIRM_THRESHOLD && !input.confirm) {
      logAction('checkout_blocked_needs_confirmation', { total });
      return {
        requires_confirmation: true,
        total,
        message: `This order totals ₹${total}, which is above the ₹${CONFIRM_THRESHOLD} auto-approval limit. Ask the user to explicitly confirm before proceeding.`,
      };
    }

    const order = await razorpay.orders.create({
      amount: total * 100,
      currency: 'INR',
      receipt: 'receipt_' + Date.now(),
    });

    logAction('checkout_order_created', { total, orderId: order.id });
    cart = [];
    return { order, total };
  }

  return { error: 'Unknown tool' };
}

app.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body;

    let messages = history && history.length
      ? [...history, { role: 'user', content: message }]
      : [
          {
            role: 'system',
            content:
  'You are a helpful shopping assistant for an agri-products store. Use the tools to search products, manage the cart, and check out. Always clearly tell the user what you are doing and the amounts involved before checkout. Never call checkout with confirm:true unless the user has explicitly agreed to a specific total you told them. IMPORTANT: only call add_to_cart ONCE per distinct item the user asks to add. Never repeat a tool call you have already made in this same conversation turn — trust the result you already received.',
          },
          { role: 'user', content: message },
        ];

    let finalReply = '';
    let lastToolResult = null;

    while (true) {
      const response = await groq.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages,
        tools,
      });

      const choice = response.choices[0];
      const toolCalls = choice.message.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        finalReply = choice.message.content;
        messages.push({ role: 'assistant', content: finalReply });
        break;
      }

      messages.push(choice.message);

      for (const call of toolCalls) {
        const args = JSON.parse(call.function.arguments);
        const result = await runTool(call.function.name, args);
        lastToolResult = { name: call.function.name, result };

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    res.json({ reply: finalReply, history: messages, lastToolResult });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong talking to the agent' });
  }
});

app.get('/audit', (req, res) => {
  res.json(auditLog);
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});