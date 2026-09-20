let products = [
  { id: '01', name: 'EXPLICIT Core Tee', category: 'T-Shirts', price: 58, sizes: ['S', 'M', 'L', 'XL'], image: 'tee-1.jpeg', description: 'Heavyweight oversized cotton tee with the EXPLICIT chest mark and NO FILTER back graphic.', featured: true, newest: 6 },
  { id: '02', name: 'E-Monogram Tee', category: 'T-Shirts', price: 62, sizes: ['S', 'M', 'L', 'XL'], image: 'tee-2.jpeg', description: 'Bone-toned heavyweight tee with a geometric E mark and minimal EXPLICIT back type.', featured: true, newest: 5 },
  { id: '03', name: 'Statement Tee', category: 'T-Shirts', price: 68, sizes: ['S', 'M', 'L', 'XL'], image: 'tee-3.jpeg', description: 'Washed black heavyweight tee stamped with MAKE IT EXPLICIT.', featured: true, newest: 4 },
  { id: '04', name: 'Core Hoodie', category: 'T-Shirts', price: 128, sizes: ['S', 'M', 'L', 'XL'], image: 'tee-4.jpeg', description: 'Oversized heavyweight hoodie with small chest embroidery and a tonal E monogram.', featured: true, newest: 3 },
  { id: '05', name: 'Signature Sweatpant', category: 'Bottoms', price: 112, sizes: ['S', 'M', 'L', 'XL'], image: 'tee-5.jpeg', description: 'Relaxed straight-leg heavyweight sweatpant with an EXPLICIT woven label.', featured: true, newest: 2 },
  { id: '06', name: 'Core Cap', category: 'Accessories', price: 48, sizes: ['OS'], image: 'tee-6.jpeg', description: 'Six-panel cap finished with the geometric E monogram.', featured: true, newest: 1 },
  { id: '07', name: 'E-Monogram Tee / Back', category: 'T-Shirts', price: 62, sizes: ['S', 'M', 'L', 'XL'], image: 'tee-2.jpeg', description: 'The reverse view of the E-Monogram Tee.', newest: 0 },
  { id: '08', name: 'Core Tee / Back', category: 'T-Shirts', price: 58, sizes: ['S', 'M', 'L', 'XL'], image: 'tee-1.jpeg', description: 'The reverse view of the EXPLICIT Core Tee.', newest: -1 }
];

const CART_STORAGE_KEY = 'explicit-cart';
const CART_OWNER_STORAGE_KEY = 'explicit-cart-owner';
const storedCart = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
})();
const state = { route: 'home', selectedProduct: null, selectedSize: null, cart: storedCart, addresses: [], selectedAddressId: null };
let currentUser = null;
let catalogState = 'loading'; // 'loading' until the remote catalog is ready or falls back to local
const $ = (id) => document.getElementById(id);
const money = (value) => `$${value.toLocaleString('en-US')}`;

function saveCart() {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
}

function findCartLineByVariant(variantId) {
  return state.cart.find((item) => String(item.variantId) === String(variantId));
}

function productLineFromVariant(variantId, quantity) {
  for (const product of products) {
    const variant = product.variants?.find((item) => String(item.id) === String(variantId));
    if (!variant) continue;
    return { ...product, productId: String(product.id), variantId: String(variant.id), size: variant.value, color: variant.color, price: variant.price, stock: variant.stock, key: `${product.id}-${variant.id}`, quantity: Math.min(quantity, variant.stock) };
  }
  return null;
}

// Serialized cart sync: every fire-and-forget call (add to bag, quantity change,
// remove, checkout) joins this queue so overlapping delete->insert cycles can
// never interleave and leave the Supabase cart half-written.
let cartSyncQueue = Promise.resolve();

// Resolves to null when the bag reached Supabase, or a short reason string
// describing why it could not — surfaced on checkout instead of being swallowed.
function syncCartToSupabase() {
  if (!currentUser || !window.supabaseStore) return Promise.resolve(null);
  const run = cartSyncQueue.then(() => pushCartToSupabase());
  cartSyncQueue = run.catch(() => 'unknown sync failure');
  return run;
}

async function pushCartToSupabase() {
  // Only the remote catalog carries real product_variants ids. Lines built from
  // the pre-load hardcoded catalog would violate the cart_items.variant_id
  // foreign key — and because saveUserCart deletes all rows first, that failed
  // insert would leave the Supabase cart EMPTY while the bag UI still shows
  // items (-> place_order later fails with "Your cart is empty.").
  if (catalogState !== 'remote') return 'the store catalog is in offline fallback mode';
  // Drop any line the current catalog cannot resolve (e.g. a stale id saved by
  // an older cart format): it could never be ordered, and one bad variant_id
  // fails the entire insert batch.
  const items = [];
  for (const item of state.cart) {
    if (item.quantity <= 0) continue;
    const resolved = productLineFromVariant(item.variantId, item.quantity);
    if (resolved) items.push({ ...item, quantity: resolved.quantity, stock: resolved.stock });
  }
  if (items.length !== state.cart.length) {
    state.cart = items;
    saveCart();
    renderCart();
  }
  try {
    await window.supabaseStore.saveUserCart(currentUser, items);
    localStorage.setItem(CART_OWNER_STORAGE_KEY, currentUser.id);
    return null;
  } catch (error) {
    console.error('Unable to save cart to Supabase.', error);
    return error.message || 'unknown database error';
  }
}

const hydratedUserIds = new Set();

async function hydrateUserCart(user, options = {}) {
  const sync = options.sync !== false;
  if (!user || !window.supabaseStore || hydratedUserIds.has(user.id)) return;
  try {
    const remoteItems = await window.supabaseStore.getUserCart(user);
    hydratedUserIds.add(user.id);
    currentUser = user;
    const sameOwner = localStorage.getItem(CART_OWNER_STORAGE_KEY) === user.id;
    const merged = new Map();
    for (const localItem of state.cart) {
      // With the real catalog in memory, rebuild each local line through it:
      // stale ids from an older cart format resolve to nothing and get dropped
      // here instead of failing the cart_items insert later. With the local
      // fallback catalog there are no variants to resolve against, so keep the
      // line as-is (that path never syncs back).
      const line = catalogState === 'remote'
        ? productLineFromVariant(localItem.variantId, localItem.quantity)
        : { ...localItem };
      if (line) merged.set(String(line.variantId), line);
    }
    remoteItems.forEach((remoteItem) => {
      const remoteLine = productLineFromVariant(remoteItem.variant_id, Number(remoteItem.quantity));
      if (!remoteLine) return;
      const localLine = merged.get(String(remoteLine.variantId));
      if (localLine) {
        // The Supabase cart is the source of truth for the same user returning,
        // while a guest cart from a previous session is merged into it.
        const quantity = sameOwner ? remoteLine.quantity : Math.min(localLine.stock, localLine.quantity + remoteLine.quantity);
        merged.set(String(remoteLine.variantId), { ...localLine, ...remoteLine, quantity });
      } else merged.set(String(remoteLine.variantId), remoteLine);
    });
    state.cart = Array.from(merged.values()).filter((item) => item.quantity > 0);
    saveCart();
    renderCart();
    if (sync) await syncCartToSupabase();
  } catch (error) {
    console.error('Unable to load cart from Supabase.', error);
  }
}

function productCard(product) {
  return `<article class="product-card"><button class="product-link" data-product="${product.id}"><div class="product-image">${product.featured ? '<span class="product-badge mono">New</span>' : ''}<img src="${product.image}" alt="${product.name}" loading="lazy"></div><div class="product-meta"><div><p class="product-name">${product.name}</p><span class="product-category mono">${product.category}</span></div><span class="price">${money(product.price)}</span></div></button></article>`;
}

function renderFeatured() {
  const featuredProducts = products.filter((product) => product.featured);
  const displayProducts = featuredProducts.length ? featuredProducts : products.slice(0, 4);
  $('featuredGrid').innerHTML = displayProducts.map(productCard).join('');
}

function filteredProducts() {
  const query = $('searchInput').value.trim().toLowerCase();
  const category = $('categoryFilter').value;
  const price = $('priceFilter').value;
  const sort = $('sortFilter').value;
  let result = products.filter((product) => {
    const matchesQuery = !query || `${product.name} ${product.category}`.toLowerCase().includes(query);
    const matchesCategory = category === 'All' || product.category === category;
    const matchesPrice = price === 'All' || product.price < Number(price);
    return matchesQuery && matchesCategory && matchesPrice;
  });
  if (sort === 'newest') result.sort((a, b) => b.newest - a.newest);
  if (sort === 'low') result.sort((a, b) => a.price - b.price);
  if (sort === 'high') result.sort((a, b) => b.price - a.price);
  return result;
}

function renderShop() {
  const result = filteredProducts();
  $('shopGrid').innerHTML = result.map(productCard).join('');
  $('resultsNote').textContent = `${result.length} ${result.length === 1 ? 'piece' : 'pieces'}`;
  $('emptyState').classList.toggle('visible', result.length === 0);
}

function getVariant(product, size) {
  const variant = product.variants?.find((item) => item.value === size && item.stock > 0);
  if (variant) return variant;
  // With Supabase as the source of truth, only real product_variants ids may enter the
  // cart so cart_items.variant_id is always a valid variant.
  return product.variants?.find((item) => item.value === size) || null;
}

function renderDetail() {
  const product = products.find((item) => item.id === state.selectedProduct);
  if (!product) return;
  const images = product.images?.length ? product.images : [product.image];
  const gallery = images.map((src, index) => `<button class="detail-thumb${index === 0 ? ' selected' : ''}" data-detail-image="${index}"><img src="${src}" alt="${product.name} view ${index + 1}"></button>`).join('');
  const color = product.color ? `<p class="mono" style="color: var(--muted); margin-bottom: 1rem;">${product.color}</p>` : '';
  const sizeButtons = (product.sizes || []).map((size) => `<button class="size-button" data-size="${size}">${size}</button>`).join('');
  $('detailContent').innerHTML = `<button class="back-link mono" data-route="shop">← Back to shop</button><div class="detail-layout"><div class="detail-gallery"><div class="detail-image"><img id="detailMainImage" src="${images[0]}" alt="${product.name}"></div>${images.length > 1 ? `<div class="detail-thumbs">${gallery}</div>` : ''}</div><div class="detail-info"><span class="mono">${product.category}</span><h2>${product.name}</h2><p class="detail-price">${money(product.price)}</p>${color}<p class="detail-description">${product.description}</p><div class="option-label"><span class="mono">Select size</span><button class="size-guide">Size guide ↗</button></div><div class="size-list">${sizeButtons}</div><p class="notice" id="sizeNotice">${sizeButtons ? '' : 'Sold out'}</p><button class="button" id="addButton" disabled>Add to bag <span>↗</span></button></div></div>`;
}

function renderCart() {
  const count = state.cart.reduce((total, item) => total + item.quantity, 0);
  const subtotal = state.cart.reduce((total, item) => total + item.price * item.quantity, 0);
  $('cartCount').textContent = count;
  $('cartItemLabel').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  $('cartEmpty').classList.toggle('visible', state.cart.length === 0);
  $('cartLayout').style.display = state.cart.length ? 'grid' : 'none';
  $('subtotal').textContent = money(subtotal);
  $('total').textContent = money(subtotal);
  $('cartLines').innerHTML = state.cart.map((item) => `<article class="cart-line"><img src="${item.image}" alt="${item.name}"><div><h3>${item.name}</h3><p>${item.category} / ${item.color || 'Standard'} / Size ${item.size}</p><div class="quantity"><button data-quantity="${item.key}" data-change="-1" aria-label="Decrease quantity">−</button><span>${item.quantity}</span><button data-quantity="${item.key}" data-change="1" aria-label="Increase quantity"${item.quantity >= item.stock ? ' disabled' : ''}>+</button></div></div><div class="line-total"><span class="price">${money(item.price * item.quantity)}</span><br><button class="remove mono" data-remove="${item.key}">Remove</button></div></article>`).join('');
}

// --- Checkout ---

function addressCardHtml(address) {
  const selected = String(address.id) === String(state.selectedAddressId) ? ' selected' : '';
  const line2 = [address.city, address.region, address.country].filter(Boolean).join(', ');
  return `<button type="button" class="address-card${selected}" data-address="${address.id}"><h4>${address.full_name}${address.is_default ? ' · Default' : ''}</h4><p>${address.address_line}<br>${line2}<br>${address.phone}</p></button>`;
}

function checkoutLineHtml(item) {
  return `<article class="cart-line"><img src="${item.image}" alt="${item.name}"><div><h3>${item.name}</h3><p>${item.category} / ${item.color || 'Standard'} / Size ${item.size} × ${item.quantity}</p></div><div class="line-total"><span class="price">${money(item.price * item.quantity)}</span></div></article>`;
}

function renderCheckoutSummary() {
  const subtotalEl = $('checkoutSubtotal');
  const totalEl = $('checkoutTotal');
  if (!subtotalEl || !totalEl) return;
  const subtotal = state.cart.reduce((total, item) => total + item.price * item.quantity, 0);
  subtotalEl.textContent = money(subtotal);
  totalEl.textContent = money(subtotal);
  const placeOrderButton = $('placeOrderButton');
  if (placeOrderButton) placeOrderButton.disabled = !state.selectedAddressId || state.cart.length === 0;
}

async function renderCheckout() {
  if (!currentUser) {
    window.location.href = 'login.html';
    return;
  }
  if (!state.cart.length) {
    navigate('cart');
    return;
  }

  $('checkoutContent').innerHTML = `
    <button class="back-link mono" data-route="cart">← Back to bag</button>
    <div class="checkout-head"><div><p class="eyebrow mono">Checkout</p><h2>Delivery details.</h2></div><p>Enter where NO FILTER 001 should ship. Payment is not collected yet.</p></div>
    <div class="cart-layout">
      <div>
        <p class="checkout-section-title">Delivery address</p>
        <div class="address-list" id="addressList"><p class="address-empty">Loading your addresses…</p></div>
        <button class="button secondary" id="toggleAddressForm" type="button">+ Add new address</button>
        <form class="checkout-form" id="addressForm" novalidate style="display:none;">
          <div class="checkout-field"><label for="addr-name">Full name</label><input id="addr-name" name="full_name" type="text" autocomplete="name" required></div>
          <div class="checkout-field"><label for="addr-phone">Phone</label><input id="addr-phone" name="phone" type="tel" autocomplete="tel" required></div>
          <div class="checkout-field"><label for="addr-address">Address</label><input id="addr-address" name="address_line" type="text" autocomplete="street-address" required></div>
          <div class="checkout-field"><label for="addr-city">City</label><input id="addr-city" name="city" type="text" autocomplete="address-level2" required></div>
          <div class="checkout-field"><label for="addr-region">Region</label><input id="addr-region" name="region" type="text" autocomplete="address-level1"></div>
          <p class="notice" id="addressError" role="alert" aria-live="polite"></p>
          <button class="button" type="submit">Save address</button>
        </form>
        <div class="checkout-items">
          <p class="checkout-section-title">Order items</p>
          <div id="checkoutLines">${state.cart.map(checkoutLineHtml).join('')}</div>
        </div>
      </div>
      <aside class="summary">
        <h3>Summary</h3>
        <div class="summary-row"><span>Subtotal</span><span id="checkoutSubtotal">$0</span></div>
        <div class="summary-row"><span>Shipping</span><span>Free</span></div>
        <div class="summary-row total"><span>Total</span><span id="checkoutTotal">$0</span></div>
        <button class="button" id="placeOrderButton" disabled>Place order ↗</button>
        <p class="notice" id="checkoutNotice"></p>
      </aside>
    </div>`;

  renderCheckoutSummary();

  try {
    state.addresses = await window.supabaseStore.listAddresses(currentUser);
    if (!state.selectedAddressId) {
      const preferred = state.addresses.find((address) => address.is_default) || state.addresses[0];
      state.selectedAddressId = preferred ? preferred.id : null;
    }
    renderAddressList();
  } catch (error) {
    $('addressList').innerHTML = `<p class="address-empty">Couldn't load saved addresses.</p>`;
    console.error('Unable to load addresses.', error);
  }
}

function renderAddressList() {
  const list = $('addressList');
  if (!list) return;
  list.innerHTML = state.addresses.length
    ? state.addresses.map(addressCardHtml).join('')
    : `<p class="address-empty">No saved addresses yet. Add one below.</p>`;
  renderCheckoutSummary();
}

async function submitAddressForm(form) {
  const errorEl = $('addressError');
  errorEl.textContent = '';
  const formData = new FormData(form);
  const address = {
    full_name: String(formData.get('full_name') || '').trim(),
    phone: String(formData.get('phone') || '').trim(),
    address_line: String(formData.get('address_line') || '').trim(),
    city: String(formData.get('city') || '').trim(),
    region: String(formData.get('region') || '').trim() || null,
    is_default: state.addresses.length === 0
  };
  if (!address.full_name || !address.phone || !address.address_line || !address.city) {
    errorEl.textContent = 'Please fill in name, phone, address and city.';
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const created = await window.supabaseStore.createAddress(currentUser, address);
    state.addresses.unshift(created);
    state.selectedAddressId = created.id;
    form.reset();
    form.style.display = 'none';
    renderAddressList();
  } catch (error) {
    errorEl.textContent = error.message || 'Could not save that address.';
  } finally {
    button.disabled = false;
  }
}

async function placeOrder() {
  const notice = $('checkoutNotice');
  const button = $('placeOrderButton');
  const address = state.addresses.find((item) => String(item.id) === String(state.selectedAddressId));
  if (!address) {
    notice.textContent = 'Select a delivery address first.';
    return;
  }
  notice.textContent = '';
  button.disabled = true;
  button.textContent = 'Placing order…';
  try {
    // place_order reads the cart stored in the DATABASE, not this page's bag.
    // Push the bag up first (the sync is serialized), then — if the sync did
    // not land — verify what the order function would actually read, so the
    // REAL failure (e.g. an RLS policy error) shows instead of a vague
    // "Your cart is empty." from the database.
    const syncError = await syncCartToSupabase();
    if (!state.cart.length) {
      notice.textContent = 'Your bag is empty. Add items before placing an order.';
      button.disabled = false;
      button.textContent = 'Place order ↗';
      return;
    }
    if (syncError) {
      let savedItems = null;
      try {
        savedItems = await window.supabaseStore.getUserCart(currentUser);
      } catch (verifyError) {
        console.error('Unable to verify your saved cart.', verifyError);
      }
      if (!savedItems || !savedItems.length) {
        notice.textContent = `Your bag could not be saved to your account: ${syncError}. The full error is in the browser console (F12).`;
        button.disabled = false;
        button.textContent = 'Place order ↗';
        return;
      }
      // The database cart still holds previously saved items — order those.
    }
    const order = await window.supabaseStore.placeOrder(address);
    state.cart = [];
    saveCart();
    renderCart();
    $('checkoutContent').innerHTML = `
      <div class="checkout-confirmation">
        <p class="eyebrow mono">Order placed</p>
        <h2>Thank you.</h2>
        <p>Order <strong>${order.order_number}</strong> is confirmed for <strong>${money(Number(order.total))}</strong>.</p>
        <p>We'll be in touch about payment and delivery. This is a demo checkout, so no payment has been collected yet.</p>
        <p><a class="order-confirmation-link" href="orders.html">View this order in My Orders ↗</a></p>
        <button class="button" data-route="shop">Continue shopping ↗</button>
      </div>`;
  } catch (error) {
    const message = error.message || '';
    // The RPC's own wording is technically true but confusing when the bag on
    // screen has items — explain what actually happened instead.
    notice.textContent = /cart is empty/i.test(message)
      ? 'Your bag could not be saved to your account, so there was nothing to order. Refresh this page and re-add your items if it keeps happening.'
      : (message || 'Something went wrong placing your order.');
    button.disabled = false;
    button.textContent = 'Place order ↗';
  }
}

function navigate(route) {
  state.route = route;
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  $(`${route}View`).classList.add('active');
  if (route === 'shop') renderShop();
  if (route === 'detail') renderDetail();
  if (route === 'cart') renderCart();
  if (route === 'checkout') renderCheckout();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('mainNav').classList.remove('open');
}

function addToCart() {
  const product = products.find((item) => item.id === state.selectedProduct);
  if (!state.selectedSize || !product) return;
  const productId = String(product.id);
  const variant = getVariant(product, state.selectedSize);
  if (!variant || variant.stock <= 0) return;
  const variantId = String(variant.id);
  const key = `${productId}-${variantId}`;
  const existing = state.cart.find((item) => item.key === key);
  if (existing) {
    if (existing.quantity >= existing.stock) return;
    existing.quantity += 1;
  } else state.cart.push({ ...product, productId, variantId, size: variant.value, color: variant.color, price: variant.price, stock: variant.stock, key, quantity: 1 });
  saveCart();
  renderCart();
  syncCartToSupabase();
  navigate('cart');
}

document.addEventListener('click', (event) => {
  const routeButton = event.target.closest('[data-route]');
  const categoryButton = event.target.closest('[data-category]');
  const productButton = event.target.closest('[data-product]');
  const sizeButton = event.target.closest('[data-size]');
  const quantityButton = event.target.closest('[data-quantity]');
  const removeButton = event.target.closest('[data-remove]');
  const detailImageButton = event.target.closest('[data-detail-image]');
  const addressCard = event.target.closest('[data-address]');
  if (routeButton) navigate(routeButton.dataset.route);
  if (categoryButton) { $('categoryFilter').value = categoryButton.dataset.category; navigate('shop'); }
  if (productButton) { state.selectedProduct = productButton.dataset.product; state.selectedSize = null; navigate('detail'); }
  if (detailImageButton) { const product = products.find((item) => item.id === state.selectedProduct); const image = product?.images?.[Number(detailImageButton.dataset.detailImage)]; if (image) { $('detailMainImage').src = image; document.querySelectorAll('.detail-thumb').forEach((button) => button.classList.toggle('selected', button === detailImageButton)); } }
  if (sizeButton) { const product = products.find((item) => item.id === state.selectedProduct); const variant = product ? getVariant(product, sizeButton.dataset.size) : null; state.selectedSize = sizeButton.dataset.size; state.selectedVariant = variant; document.querySelectorAll('.size-button').forEach((button) => button.classList.toggle('selected', button === sizeButton)); $('addButton').disabled = !variant || variant.stock <= 0; $('sizeNotice').textContent = variant?.stock > 0 ? '' : 'Sold out'; }
  if (event.target.id === 'addButton') addToCart();
  if (quantityButton) { const item = state.cart.find((entry) => entry.key === quantityButton.dataset.quantity); if (item) item.quantity = Math.min(item.stock, Math.max(0, item.quantity + Number(quantityButton.dataset.change))); state.cart = state.cart.filter((entry) => entry.quantity > 0); saveCart(); renderCart(); syncCartToSupabase(); }
  if (removeButton) { state.cart = state.cart.filter((entry) => entry.key !== removeButton.dataset.remove); saveCart(); renderCart(); syncCartToSupabase(); }
  if (event.target.id === 'clearFilters') { $('searchInput').value = ''; $('categoryFilter').value = 'All'; $('priceFilter').value = 'All'; $('sortFilter').value = 'featured'; renderShop(); }
  if (event.target.id === 'checkoutButton') {
    if (!currentUser) { window.location.href = 'login.html'; return; }
    if (!state.cart.length) return;
    navigate('checkout');
  }
  if (addressCard) { state.selectedAddressId = addressCard.dataset.address; renderAddressList(); }
  if (event.target.id === 'toggleAddressForm') { const form = $('addressForm'); form.style.display = form.style.display === 'none' ? 'grid' : 'none'; }
  if (event.target.id === 'placeOrderButton') placeOrder();
});

document.addEventListener('submit', (event) => {
  if (event.target.id === 'addressForm') {
    event.preventDefault();
    submitAddressForm(event.target);
  }
});

['searchInput', 'categoryFilter', 'priceFilter', 'sortFilter'].forEach((id) => $(id).addEventListener('input', renderShop));
$('headerSearch').addEventListener('click', () => { navigate('shop'); $('searchInput').focus(); });
$('menuToggle').addEventListener('click', () => $('mainNav').classList.toggle('open'));

async function setupAuthAction() {
  const authAction = $('authAction');
  if (!authAction || !window.supabaseStore) return;
  const { data, error } = await window.supabaseStore.getSession();
  if (error) return;
  currentUser = data.session?.user || null;
  // Hydrate only once the catalog load has settled. If it is still loading, loadRemoteProducts
  // will hydrate when it finishes (currentUser is already set by then). hydrateUserCart guards
  // against running twice, and only syncs when the real catalog (with real variant ids) is in memory.
  if (currentUser && catalogState !== 'loading') hydrateUserCart(currentUser, { sync: catalogState === 'remote' });
  if (data.session) {
    authAction.textContent = 'Logout';
    authAction.href = '#logout';
    const headerTools = document.querySelector('.header-tools');
    if (headerTools && !document.getElementById('ordersLink')) {
      const ordersLink = document.createElement('a');
      ordersLink.id = 'ordersLink';
      ordersLink.className = 'header-action';
      ordersLink.href = 'orders.html';
      ordersLink.textContent = 'Orders';
      headerTools.insertBefore(ordersLink, authAction);
    }
    if (headerTools && !document.getElementById('profileLink')) {
      const profileLink = document.createElement('a');
      profileLink.id = 'profileLink';
      profileLink.className = 'header-action';
      profileLink.href = 'profile.html';
      profileLink.textContent = 'Profile';
      headerTools.insertBefore(profileLink, authAction);
    }
    // Admin link — visibility only; the dashboard itself re-checks isAdmin()
    // server-side, so hiding/showing this link is not the security boundary.
    if (headerTools && !document.getElementById('adminLink')) {
      const { data: isAdmin } = await window.supabaseStore.isAdmin();
      if (isAdmin) {
        const adminLink = document.createElement('a');
        adminLink.id = 'adminLink';
        adminLink.className = 'header-action';
        adminLink.href = 'admin.html';
        adminLink.textContent = 'Admin';
        headerTools.insertBefore(adminLink, authAction);
      }
    }
    authAction.addEventListener('click', async (event) => {
      event.preventDefault();
      const result = await window.supabaseStore.signOut();
      if (!result.error) {
        // The cart is already saved in Supabase, so the local copy is cleared to keep
        // the next login loading the saved Supabase cart without doubling quantities.
        localStorage.removeItem(CART_OWNER_STORAGE_KEY);
        localStorage.removeItem(CART_STORAGE_KEY);
        window.location.reload();
      }
    });
  }
}

renderFeatured();
renderCart();
setupAuthAction();

async function loadRemoteProducts() {
  if (!window.supabaseStore) return;
  try {
    const remoteProducts = await window.supabaseStore.getProducts();
    if (!remoteProducts.length) throw new Error('No products returned from Supabase.');
    products = remoteProducts;
    catalogState = 'remote';
    renderFeatured();
    if (state.route === 'shop') renderShop();
    if (state.route === 'detail') renderDetail();
    // Hydrate only after the real catalog is in memory so remote variant ids resolve;
    // syncing the merged cart back keeps Supabase authoritative.
    if (currentUser) await hydrateUserCart(currentUser);
  } catch (error) {
    console.error('Unable to load products from Supabase. Using local catalog.', error);
    catalogState = 'local';
    // Still load the saved cart, but without syncing back: the local fallback catalog has
    // no real variant ids, so a sync here could wipe the user's saved Supabase cart.
    if (currentUser) await hydrateUserCart(currentUser, { sync: false });
  }
}

loadRemoteProducts();