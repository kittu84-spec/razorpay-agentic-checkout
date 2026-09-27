import { useState, useRef, useEffect } from 'react';

function App() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Hi! I can help you find agri-products, add them to your cart, and check out. What are you looking for today?" },
  ]);
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [cart, setCart] = useState({ items: [], total: 0 });
  const [showAudit, setShowAudit] = useState(false);
  const [auditLog, setAuditLog] = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const openRazorpayCheckout = (order) => {
    const options = {
      key: 'rzp_test_TXFJdryiwz1yfm', // your public Key ID
      amount: order.amount,
      currency: order.currency,
      name: 'Agri Store Agent',
      description: 'Order via chat agent',
      order_id: order.id,
      handler: async function (response) {
        const verifyRes = await fetch('http://localhost:5000/verify-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(response),
        });
        const verifyData = await verifyRes.json();
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: verifyData.status === 'success' ? '✅ Payment verified! Your order is confirmed.' : '⚠️ Payment verification failed.' },
        ]);
        setCart({ items: [], total: 0 });
      },
      modal: {
        // Runs if the user closes the popup without completing payment
        ondismiss: function () {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: '⚠️ Payment was not completed — the checkout window was closed. Your cart is still saved. Would you like to try again, or make any changes first?' },
          ]);
        },
      },
      theme: { color: '#2e7d32' },
    };

    const rzp = new window.Razorpay(options);

    // Runs if Razorpay itself reports a genuine payment failure (declined card, etc.)
    rzp.on('payment.failed', function (response) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `❌ Payment failed: ${response.error.description || 'the payment could not be processed'}. Your cart is still saved (₹${order.amount / 100}) — you can try again whenever you're ready.`,
        },
      ]);
    });

    rzp.open();
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    const userMessage = input;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const res = await fetch('http://localhost:5000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, history }),
      });
      const data = await res.json();

      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
      setHistory(data.history);

      if (data.lastToolResult) {
        const { name, result } = data.lastToolResult;
        if ((name === 'add_to_cart' || name === 'view_cart') && result.cart) {
          setCart({ items: result.cart, total: result.total });
        }
        if (name === 'checkout' && result.order) {
          openRazorpayCheckout(result.order);
        }
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Something went wrong reaching the agent.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') sendMessage();
  };

  const openAudit = async () => {
    try {
      const res = await fetch('http://localhost:5000/audit');
      const data = await res.json();
      setAuditLog(data);
      setShowAudit(true);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif', position: 'relative' }}>
      {/* Chat panel */}
      <div style={{ flex: 2, display: 'flex', flexDirection: 'column', borderRight: '1px solid #ddd' }}>
        <div style={{ padding: '16px', background: '#2e7d32', color: 'white', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Agri Store Agent</span>
          <button
            onClick={openAudit}
            style={{ padding: '6px 12px', fontSize: '13px', cursor: 'pointer', background: 'white', color: '#2e7d32', border: 'none', borderRadius: '6px' }}
          >
            View Audit Log
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {messages.map((m, i) => (
            <div key={i} style={{ textAlign: m.role === 'user' ? 'right' : 'left', margin: '8px 0' }}>
              <span
                style={{
                  display: 'inline-block',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  background: m.role === 'user' ? '#2e7d32' : '#f0f0f0',
                  color: m.role === 'user' ? 'white' : 'black',
                  maxWidth: '80%',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.content}
              </span>
            </div>
          ))}
          {loading && <div style={{ color: '#888' }}>Agent is thinking...</div>}
          <div ref={bottomRef} />
        </div>
        <div style={{ display: 'flex', padding: '12px', borderTop: '1px solid #ddd' }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about products, add to cart, or check out..."
            style={{ flex: 1, padding: '10px', fontSize: '14px' }}
          />
          <button onClick={sendMessage} disabled={loading} style={{ padding: '10px 20px', marginLeft: '8px' }}>
            Send
          </button>
        </div>
      </div>

      {/* Cart panel */}
      <div style={{ flex: 1, padding: '16px' }}>
        <h3>Cart</h3>
        {cart.items.length === 0 ? (
          <p style={{ color: '#888' }}>Empty</p>
        ) : (
          <>
            {cart.items.map((item) => (
              <div key={item.id} style={{ marginBottom: '8px' }}>
                {item.name} × {item.quantity} — ₹{item.price * item.quantity}
              </div>
            ))}
            <hr />
            <strong>Total: ₹{cart.total}</strong>
          </>
        )}
      </div>

      {/* Audit trail modal */}
      {showAudit && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 10,
          }}
          onClick={() => setShowAudit(false)}
        >
          <div
            style={{
              background: 'white',
              padding: '24px',
              borderRadius: '10px',
              width: '600px',
              maxHeight: '80vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>Audit Log</h3>
              <button onClick={() => setShowAudit(false)} style={{ cursor: 'pointer' }}>
                Close
              </button>
            </div>
            {auditLog.length === 0 ? (
              <p style={{ color: '#888' }}>No actions logged yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
                    <th style={{ padding: '6px' }}>Time</th>
                    <th style={{ padding: '6px' }}>Action</th>
                    <th style={{ padding: '6px' }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map((entry, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '6px', whiteSpace: 'nowrap' }}>{new Date(entry.time).toLocaleTimeString()}</td>
                      <td style={{ padding: '6px' }}>{entry.action}</td>
                      <td style={{ padding: '6px' }}>{JSON.stringify(entry.details)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;