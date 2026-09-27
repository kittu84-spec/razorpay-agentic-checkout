# Agentic Checkout Agent (Razorpay AI Buildathon — Track 01)

A conversational AI shopping agent that lets a customer search products, build a cart, and check out entirely through chat — with every money action logged, bounded, and gated before it touches Razorpay.

## What it does

Instead of clicking through a traditional storefront, the user just talks to the agent:

> "what fertilizers do you have under 1000 rupees"
> "add 2 bags of urea to my cart"
> "yes go ahead"

The agent searches a product catalog, manages the cart, and creates a real Razorpay order — all through tool-use, not hardcoded button logic.

## Why this fits Track 01 (AI Growth & Agentic Commerce)

- **Conversational checkout agent**: a natural-language interface replaces manual cart/checkout UI
- **Explainable**: every agent action is narrated back to the user in plain language before money moves
- **Bounded & gated**: orders above ₹2,000 require explicit user confirmation before the agent is allowed to create a Razorpay order — the agent cannot silently charge a large amount
- **Auditable**: every tool call (search, add to cart, checkout, blocked-for-confirmation) is logged with a timestamp and viewable in-app via "View Audit Log"
- **Handles failure gracefully**: a declined/failed payment is caught and explained to the user in the chat, with the cart preserved — not a silent crash

## Architecture
React (Vite) chat UI ──► Express backend ──► Groq (LLM, tool-use)
│
├──► Razorpay Test Mode (order + signature verification)
└──► In-memory audit log

- **Frontend**: React chat interface with a live cart panel and an audit log viewer
- **Backend**: Node/Express — owns all secrets, enforces the ₹2,000 confirmation gate, verifies Razorpay payment signatures server-side
- **Agent**: Groq (`openai/gpt-oss-120b`) using tool-use/function-calling for `search_catalog`, `add_to_cart`, `view_cart`, and `checkout`
- **Payments**: Razorpay Test Mode — no real transactions

## Tech stack

- React + Vite
- Node.js + Express
- Groq API (OpenAI-compatible SDK)
- Razorpay Node SDK (Test Mode)

## Running it locally

### Backend
cd razorpay
npm install

create a .env file with:
RAZORPAY_KEY_ID=your_test_key_id
RAZORPAY_KEY_SECRET=your_test_key_secret
GROQ_API_KEY=your_groq_key

node index.js
Runs on `http://localhost:5000`

### Frontend
cd checkout-frontend
npm install
npm run dev
Runs on `http://localhost:5173`

Both servers need to run at the same time.

## Demo

[Add your demo video link here once recorded]

## Notes

- This is a test-mode prototype — no real payments are processed.
- The product catalog is a small hardcoded set of agri-products, chosen because it reflects a real merchant use case (taking a family agri-business online).
- Groq's free tier was used for the LLM layer to keep the project accessible without requiring paid API credits.

3. Save it, then push it to GitHub with these three commands:

git add README.md
git commit -m "Add README"
git push
