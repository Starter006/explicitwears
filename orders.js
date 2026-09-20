function money(value) {
  return `$${Number(value || 0).toLocaleString('en-US')}`;
}

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusClass(status) {
  const map = { pending: 'is-pending', processing: 'is-pending', shipped: 'is-shipped', delivered: 'is-delivered', cancelled: 'is-cancelled' };
  return map[String(status || '').toLowerCase()] || 'is-pending';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function orderRowHtml(order) {
  return `<a class="order-row" href="orders.html?id=${encodeURIComponent(order.id)}">
    <div><span class="order-number">${escapeHtml(order.order_number)}</span><span class="order-date mono">${formatDate(order.created_at)}</span></div>
    <div class="order-row-right"><span class="order-status ${statusClass(order.status)}">${escapeHtml(order.status || 'pending')}</span><span class="order-date mono">Payment: ${escapeHtml(order.payment_status || 'pending')}</span><span class="order-total">${money(order.total)}</span></div>
  </a>`;
}

function renderList(orders) {
  const state = document.getElementById('ordersState');
  if (!orders.length) {
    state.innerHTML = `<h2 class="orders-empty-title">No orders yet.</h2><p class="auth-form-intro">When you place an order it will appear here.</p><a class="button" href="index.html">Start shopping <span>↗</span></a>`;
    return;
  }
  state.innerHTML = `<h2 class="orders-heading">Order history</h2><div class="order-list">${orders.map(orderRowHtml).join('')}</div>`;
}

function renderDetail(order) {
  const items = order.items.map((item) => `<div class="order-line">
      <div><p class="order-line-name">${escapeHtml(item.product_name)}</p><p class="order-line-meta mono">${escapeHtml([item.color, item.size].filter(Boolean).join(' / '))} × ${item.quantity}</p></div>
      <span class="order-line-price">${money(item.price * item.quantity)}</span>
    </div>`).join('');
  const address = [order.shipping_name, order.shipping_address, order.shipping_city, order.shipping_phone].filter(Boolean);
  document.getElementById('ordersState').innerHTML = `
    <button class="back-link mono" id="backToOrders">← All orders</button>
    <h2 class="orders-heading">${escapeHtml(order.order_number)}</h2>
    <p class="order-meta-line"><span class="order-status ${statusClass(order.status)}">${escapeHtml(order.status || 'pending')}</span><span class="order-date mono">Placed ${formatDate(order.created_at)}</span><span class="order-date mono">Payment: ${escapeHtml(order.payment_status || 'pending')}</span></p>
    <div class="order-items-block">
      <p class="checkout-section-title">Items</p>
      ${items}
      <div class="order-total-row"><span>Total</span><span>${money(order.total)}</span></div>
    </div>
    ${address.length ? `<div class="order-items-block"><p class="checkout-section-title">Delivery</p><p class="order-address">${address.map(escapeHtml).join('<br>')}</p></div>` : ''}`;
  document.getElementById('backToOrders').addEventListener('click', () => { window.location.href = 'orders.html'; });
}

async function init() {
  if (!window.supabaseStore) return;
  const { data, error } = await window.supabaseStore.getSession();
  if (error || !data?.session) { window.location.href = 'login.html'; return; }
  const user = data.session.user;

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('id');

  try {
    if (orderId) {
      const order = await window.supabaseStore.getOrder(user, orderId);
      if (!order) throw new Error('Order not found.');
      document.title = `${order.order_number} | EXPLICIT`;
      renderDetail(order);
    } else {
      const orders = await window.supabaseStore.getUserOrders(user);
      renderList(orders);
    }
  } catch (err) {
    document.getElementById('ordersState').innerHTML = `<p class="auth-error" role="alert">${escapeHtml(err.message || 'Could not load your orders.')}</p><a class="button secondary" href="orders.html">Try again</a>`;
  }
}

document.addEventListener('DOMContentLoaded', init);