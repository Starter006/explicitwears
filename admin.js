function money(value) {
  return `$${Number(value || 0).toLocaleString('en-US')}`;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusClass(status) {
  const map = { pending: 'is-pending', processing: 'is-pending', shipped: 'is-shipped', delivered: 'is-delivered', cancelled: 'is-cancelled' };
  return map[String(status || '').toLowerCase()] || 'is-pending';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

const STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];

let cachedOrders = [];
let adminNotice = '';
const adminData = { lowStock: [], products: [] };

function parseVariantString(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((entry) => {
      const [size, stock = '0'] = entry.split(':');
      const normalizedSize = String(size || 'OS').trim() || 'OS';
      return {
        size: normalizedSize,
        stock_quantity: Number(stock) || 0
      };
    });
}

function productPreviewText(product) {
  const variants = Array.isArray(product?.variants) && product.variants.length
    ? product.variants.map((variant) => `${variant.value || variant.size || 'OS'}: ${variant.stock ?? variant.stock_quantity ?? 0}`).join(', ')
    : 'OS: 0';
  return `${product?.name || 'Untitled product'} • ${product?.category || 'Collection'} • ${money(product?.price || 0)} • ${variants}`;
}

function ordersTableHtml(orders) {
  if (!orders.length) return '<p class="auth-form-intro">No orders yet.</p>';
  return `<div class="order-list">${orders.map((order) => `
    <div class="order-row admin-order-row" data-order="${order.id}">
      <div>
        <span class="order-number">${escapeHtml(order.order_number)}</span>
        <span class="order-date mono">${formatDate(order.created_at)} — ${escapeHtml(order.shipping_name || '')}</span>
      </div>
      <div class="order-row-right">
        <span class="order-total">${money(order.total)}</span>
        <span class="order-status ${statusClass(order.status)}">${escapeHtml(order.status || 'pending')}</span>
        <span class="order-date mono">Payment: ${escapeHtml(order.payment_status || 'pending')}</span>
        <select class="filter-control admin-status-select" data-order="${order.id}" aria-label="Order status">
          ${STATUSES.map((s) => `<option value="${s}"${s === order.status ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
        <button class="button secondary admin-items-button" data-order="${order.id}">Items</button>
      </div>
    </div>`).join('')}</div>`;
}

function itemsHtml(items) {
  if (!items.length) return '<p class="auth-form-intro">No items on this order.</p>';
  return items.map((item) => `<div class="order-line">
    <div><p class="order-line-name">${escapeHtml(item.product_name)}</p><p class="order-line-meta mono">${escapeHtml([item.color, item.size].filter(Boolean).join(' / '))} × ${item.quantity}</p></div>
    <span class="order-line-price">${money(item.subtotal ?? item.price * item.quantity)}</span>
  </div>`).join('');
}

function productsTableHtml(products) {
  if (!products.length) return '<p class="auth-form-intro">No products yet.</p>';
  const rows = products.map((product) => {
    const variantSummary = (product.variants || []).length
      ? product.variants.map((variant) => `${variant.value || variant.size || 'OS'}: ${variant.stock ?? variant.stock_quantity ?? 0}`).join(', ')
      : 'OS: 0';
    return `<div class="order-row admin-product-row">
      <div>
        <span class="order-number">${escapeHtml(product.name)}</span>
        <span class="order-date mono">${escapeHtml(product.category)} • ${escapeHtml(product.status)} • ${escapeHtml(variantSummary)}</span>
      </div>
      <div class="order-row-right">
        <span class="order-total">${money(product.price)}</span>
        <button type="button" class="button secondary admin-product-edit" data-product-id="${product.id}">Edit</button>
        <button type="button" class="button secondary admin-product-delete" data-product-id="${product.id}">Delete</button>
      </div>
    </div>`;
  });
  return `<div class="order-list">${rows.join('')}</div>`;
}

function productFormHtml(product = null) {
  const currentName = product?.name || '';
  const currentCategory = product?.category || 'T-Shirts';
  const currentPrice = product?.price ?? '';
  const currentDescription = product?.description || '';
  const currentStatus = product?.status || 'active';
  const currentVariants = (product?.variants || []).length
    ? product.variants.map((variant) => `${variant.value || variant.size || 'OS'}:${variant.stock ?? variant.stock_quantity ?? 0}`).join(', ')
    : 'S:10, M:10, L:10';

  return `
    <form id="adminProductForm" data-product-id="${product?.id || ''}" class="checkout-form">
      <div class="checkout-field"><label for="adminProductName">Product name</label><input id="adminProductName" name="name" value="${escapeHtml(currentName)}" required></div>
      <div class="checkout-field"><label for="adminProductCategory">Category</label><input id="adminProductCategory" name="category" value="${escapeHtml(currentCategory)}" required></div>
      <div class="checkout-field"><label for="adminProductPrice">Price</label><input id="adminProductPrice" name="price" type="number" min="0" step="0.01" value="${escapeHtml(currentPrice)}" required></div>
      <div class="checkout-field"><label for="adminProductStatus">Status</label>
        <select id="adminProductStatus" name="status">
          <option value="active"${currentStatus === 'active' ? ' selected' : ''}>Active</option>
          <option value="inactive"${currentStatus === 'inactive' ? ' selected' : ''}>Inactive</option>
        </select>
      </div>
      <div class="checkout-field"><label for="adminProductSizes">Available sizes & stock</label><input id="adminProductSizes" name="sizes" value="${escapeHtml(currentVariants)}" placeholder="S:10, M:12, L:8" required></div>
      <div class="checkout-field"><label for="adminProductDescription">Description</label><textarea id="adminProductDescription" name="description" rows="4" required>${escapeHtml(currentDescription)}</textarea></div>
      <div class="checkout-field"><label for="adminProductImages">Product images</label><input id="adminProductImages" type="file" name="images" accept="image/*" multiple></div>
      <div class="order-items-block">
        <p class="checkout-section-title">Preview</p>
        <div class="order-line">
          <div>
            <p class="order-line-name" id="productPreviewName">${escapeHtml(currentName || 'Untitled product')}</p>
            <p class="order-line-meta mono" id="productPreviewMeta">${escapeHtml(`${currentCategory || 'Collection'} • ${money(currentPrice || 0)}`)}</p>
          </div>
          <span class="order-line-price" id="productPreviewStatus">${escapeHtml(currentStatus || 'active')}</span>
        </div>
        <p class="order-line-meta mono" id="productPreviewVariants">${escapeHtml(currentVariants || 'OS: 0')}</p>
        <p class="order-line-name" id="productPreviewDescription">${escapeHtml(currentDescription || 'Product description preview.')}</p>
      </div>
      <div class="order-row-right">
        <button type="button" class="button secondary" id="adminProductCancel">Cancel</button>
        <button type="submit" class="button" id="adminProductSubmit">Save product</button>
      </div>
      <p class="notice" id="productFormMessage" role="alert" aria-live="polite"></p>
    </form>`;
}

function renderAdmin() {
  const state = document.getElementById('adminState');
  const lowStockCount = adminData.lowStock.length;
  state.innerHTML = `
    <div class="admin-shell">
      <div class="order-items-block">
        <h2 class="orders-heading">Orders</h2>
        <div id="adminOrders">${ordersTableHtml(cachedOrders)}</div>
      </div>
      <div class="order-items-block">
        <p class="checkout-section-title">Low stock (≤ 5)</p>
        ${lowStockCount
          ? `<div class="order-list">${adminData.lowStock.map((v) => `<div class="order-line"><div><p class="order-line-name">${escapeHtml(v.sku || `Variant #${v.id}`)}</p><p class="order-line-meta mono">${escapeHtml(v.color || '')} / ${escapeHtml(v.size || '')}</p></div><span class="order-line-price">${v.stock_quantity} left</span></div>`).join('')}</div>`
          : '<p class="auth-form-intro">All variants are comfortably stocked.</p>'}
      </div>
      <div class="order-items-block" id="adminItemsBlock" style="display:none;">
        <p class="checkout-section-title">Order items</p>
        <div id="adminItems"></div>
      </div>
      <div class="order-items-block">
        <div class="order-row">
          <div>
            <p class="checkout-section-title">Products</p>
          </div>
          <button type="button" class="button secondary" id="adminAddProductButton">Add product</button>
        </div>
        ${adminNotice ? `<p class="notice" role="status">${escapeHtml(adminNotice)}</p>` : ''}
        <div id="adminProductFormContainer" style="display:none;"></div>
        <div id="adminProductList">${productsTableHtml(adminData.products)}</div>
      </div>
    </div>`;

  document.getElementById('adminAddProductButton').addEventListener('click', () => {
    const formContainer = document.getElementById('adminProductFormContainer');
    formContainer.innerHTML = productFormHtml();
    formContainer.style.display = 'block';
    updateProductPreview();
    formContainer.querySelector('#adminProductForm').addEventListener('input', updateProductPreview);
    formContainer.querySelector('#adminProductForm').addEventListener('submit', handleProductSave);
    document.getElementById('adminProductCancel').addEventListener('click', () => {
      formContainer.style.display = 'none';
      formContainer.innerHTML = '';
    });
  });

  document.getElementById('adminOrders').addEventListener('change', async (event) => {
    const select = event.target.closest('.admin-status-select');
    if (!select) return;
    const { error } = await window.supabaseStore.adminUpdateOrderStatus(select.dataset.order, select.value);
    if (error) { alert(error.message); return; }
    const order = cachedOrders.find((o) => o.id === select.dataset.order);
    if (order) order.status = select.value;
  });

  document.getElementById('adminOrders').addEventListener('click', (event) => {
    const button = event.target.closest('.admin-items-button');
    if (!button) return;
    button.disabled = true;
    loadItems(button.dataset.order, button);
  });

}

async function handleAdminStateClick(event) {
  const editButton = event.target.closest('.admin-product-edit');
  const deleteButton = event.target.closest('.admin-product-delete');
  if (editButton) {
    const product = adminData.products.find((item) => String(item.id) === String(editButton.dataset.productId));
    const formContainer = document.getElementById('adminProductFormContainer');
    formContainer.innerHTML = productFormHtml(product);
    formContainer.style.display = 'block';
    updateProductPreview();
    formContainer.querySelector('#adminProductForm').addEventListener('input', updateProductPreview);
    formContainer.querySelector('#adminProductForm').addEventListener('submit', handleProductSave);
    document.getElementById('adminProductCancel').addEventListener('click', () => {
      formContainer.style.display = 'none';
      formContainer.innerHTML = '';
    });
    return;
  }
  if (deleteButton) {
    const id = deleteButton.dataset.productId;
    const product = adminData.products.find((item) => String(item.id) === String(id));
    if (!product) return;
    if (!window.confirm(`Delete ${product.name}?`)) return;
    try {
      await window.supabaseStore.adminDeleteProduct(id);
      adminNotice = 'Product deleted successfully.';
      adminData.products = (await window.supabaseStore.adminListProducts()) || [];
      renderAdmin();
    } catch (error) {
      alert(error.message || 'Could not delete product.');
    }
  }
}

function updateProductPreview() {
  const form = document.getElementById('adminProductForm');
  if (!form) return;
  const formData = new FormData(form);
  const name = String(formData.get('name') || '').trim() || 'Untitled product';
  const category = String(formData.get('category') || '').trim() || 'Collection';
  const price = Number(formData.get('price') || 0);
  const status = String(formData.get('status') || 'active');
  const description = String(formData.get('description') || '').trim() || 'Product description preview.';
  const variants = parseVariantString(formData.get('sizes'));
  const previewName = document.getElementById('productPreviewName');
  const previewMeta = document.getElementById('productPreviewMeta');
  const previewStatus = document.getElementById('productPreviewStatus');
  const previewVariants = document.getElementById('productPreviewVariants');
  const previewDescription = document.getElementById('productPreviewDescription');

  previewName.textContent = name;
  previewMeta.textContent = `${category} • ${money(price)}`;
  previewStatus.textContent = status;
  previewVariants.textContent = variants.length ? variants.map((variant) => `${variant.size}: ${variant.stock_quantity}`).join(', ') : 'OS: 0';
  previewDescription.textContent = description;
}

async function handleProductSave(event) {
  event.preventDefault();
  const form = event.target.closest('#adminProductForm');
  if (!form) return;

  const message = document.getElementById('productFormMessage');
  const submitButton = form.querySelector('#adminProductSubmit');
  const formData = new FormData(form);
  const name = String(formData.get('name') || '').trim();
  const description = String(formData.get('description') || '').trim();
  const category = String(formData.get('category') || '').trim();
  const price = Number(formData.get('price') || 0);
  const status = String(formData.get('status') || 'active');
  const sizesInput = String(formData.get('sizes') || '').trim();
  const variants = parseVariantString(sizesInput);
  const files = Array.from(form.querySelector('[name="images"]').files || []);

  if (!name || !description || !category || !variants.length || price <= 0) {
    message.textContent = 'Please provide a name, description, category, valid price, and at least one size with stock.';
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Saving…';
  message.textContent = 'Saving product…';

  try {
    const productId = form.dataset.productId || null;
    await window.supabaseStore.adminSaveProduct(productId, { name, description, category, price, status, variants }, files);
    adminNotice = 'Product saved successfully.';
    adminData.products = await window.supabaseStore.adminListProducts();
    renderAdmin();
  } catch (error) {
    message.textContent = error.message || 'Could not save product.';
    submitButton.disabled = false;
    submitButton.textContent = 'Save product';
  }
}

async function loadItems(orderId, button) {
  const block = document.getElementById('adminItemsBlock');
  const container = document.getElementById('adminItems');
  try {
    const { data, error } = await window.supabaseStore.adminOrderItems(orderId);
    if (error) throw error;
    container.innerHTML = itemsHtml(data || []);
    block.style.display = 'block';
    block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    alert(err.message || 'Could not load items.');
  } finally {
    if (button) button.disabled = false;
  }
}

async function bindAdminLogout() {
  const logoutButton = document.getElementById('adminLogoutButton');
  if (!logoutButton || !window.supabaseStore) return;
  logoutButton.addEventListener('click', async (event) => {
    event.preventDefault();
    try {
      const { error } = await window.supabaseStore.signOut();
      if (!error) {
        localStorage.removeItem('explicit-cart');
        localStorage.removeItem('explicit-cart-owner');
        window.location.href = 'login.html';
        return;
      }
      alert(error.message || 'Could not log out.');
    } catch (error) {
      alert(error.message || 'Could not log out.');
    }
  });
}

async function init() {
  if (!window.supabaseStore) return;
  bindAdminLogout();
  const state = document.getElementById('adminState');
  const { data, error } = await window.supabaseStore.getSession();
  if (error || !data?.session) { window.location.href = 'login.html'; return; }

  const { data: isAdmin, error: adminError } = await window.supabaseStore.isAdmin();
  if (adminError || !isAdmin) {
    state.innerHTML = `<p class="auth-error" role="alert">Admin access required.</p><a class="button secondary" href="index.html">Back to store</a>`;
    return;
  }

  state.innerHTML = '<p class="auth-form-intro">Loading admin data…</p>';
  state.addEventListener('click', handleAdminStateClick);
  try {
    const [ordersRes, lowRes, productsRes] = await Promise.all([
      window.supabaseStore.adminListOrders(),
      window.supabaseStore.adminLowStock(),
      window.supabaseStore.adminListProducts()
    ]);
    if (ordersRes.error) throw ordersRes.error;
    if (lowRes.error) throw lowRes.error;
    if (productsRes.error) throw productsRes.error;
    cachedOrders = ordersRes.data || [];
    adminData.lowStock = lowRes.data || [];
    adminData.products = productsRes.data || [];
    renderAdmin();
  } catch (err) {
    state.innerHTML = `<p class="auth-error" role="alert">${escapeHtml(err.message || 'Failed to load admin data.')}</p>`;
    return;
  }
}

document.addEventListener('DOMContentLoaded', init);