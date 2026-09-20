function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function setBlockMessage(form, message, isSuccess = false) {
  const element = form.querySelector('.profile-message');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('success', isSuccess);
}

function setBusy(form, isBusy) {
  form.querySelectorAll('button[type="submit"]').forEach((button) => { button.disabled = isBusy; });
}

let profileUser = null;
let profileCustomer = null;
let profileAddresses = [];

// ---------- Account block ----------

function renderAccount() {
  const block = document.getElementById('accountBlock');
  const customer = profileCustomer;
  block.innerHTML = `
    <p class="checkout-section-title">Account details</p>
    <form class="auth-form" id="profileForm" novalidate>
      <div class="auth-field">
        <label for="profile-name">Full name</label>
        <input id="profile-name" name="full_name" type="text" autocomplete="name" value="${escapeHtml(customer.full_name || '')}">
      </div>
      <div class="auth-field">
        <label for="profile-email">Email (login address)</label>
        <input id="profile-email" type="email" value="${escapeHtml(customer.email || '')}" disabled>
      </div>
      <div class="auth-field">
        <label for="profile-phone">Phone number</label>
        <input id="profile-phone" name="phone" type="tel" autocomplete="tel" value="${escapeHtml(customer.phone || '')}">
      </div>
      <p class="auth-error profile-message" role="alert" aria-live="polite"></p>
      <button class="button" type="submit">Save changes <span>↗</span></button>
    </form>
    <details class="profile-details">
      <summary class="auth-forgot">Change email address</summary>
      <form class="auth-form" id="emailForm" novalidate>
        <div class="auth-field">
          <label for="new-email">New email</label>
          <input id="new-email" name="email" type="email" autocomplete="email" required>
        </div>
        <p class="auth-error profile-message" role="alert" aria-live="polite"></p>
        <button class="button secondary" type="submit">Send confirmation email</button>
        <p class="mono profile-hint">A confirmation link goes to the new address. The email above only changes after you confirm it — your login keeps working in the meantime.</p>
      </form>
    </details>`;

  const form = document.getElementById('profileForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBlockMessage(form, '');
    const data = new FormData(form);
    const fullName = String(data.get('full_name') || '').trim();
    const phone = String(data.get('phone') || '').trim();
    if (!fullName) { setBlockMessage(form, 'Please enter your full name.'); return; }
    setBusy(form, true);
    try {
      profileCustomer = await window.supabaseStore.updateCustomerProfile(profileUser, { full_name: fullName, phone: phone || null });
      setBlockMessage(form, '✓ Profile saved.', true);
    } catch (err) {
      setBlockMessage(form, err.message || 'Could not save your profile. Please try again.');
    } finally {
      setBusy(form, false);
    }
  });

  const emailForm = document.getElementById('emailForm');
  emailForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBlockMessage(emailForm, '');
    const email = String(new FormData(emailForm).get('email') || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setBlockMessage(emailForm, 'Enter a valid email address.'); return; }
    if (email.toLowerCase() === String(profileCustomer.email || '').toLowerCase()) { setBlockMessage(emailForm, 'That is already your email address.'); return; }
    setBusy(emailForm, true);
    try {
      const { error } = await window.supabaseStore.updateUserEmail(email);
      if (error) throw error;
      setBlockMessage(emailForm, '✓ Confirmation email sent. Check the new inbox (and spam) and click the link to finish.', true);
      emailForm.reset();
    } catch (err) {
      const message = err?.message || '';
      setBlockMessage(emailForm, /rate|too many/i.test(message)
        ? 'Too many attempts — wait a few minutes and try again.'
        : (message || 'Could not start the email change. Please try again.'));
    } finally {
      setBusy(emailForm, false);
    }
  });
}
// ---------- Addresses block ----------

function addressCardHtml(address) {
  return `<button type="button" class="address-card" data-address-id="${address.id}">
    <h4>${escapeHtml(address.full_name)}${address.is_default ? ' · Default' : ''}</h4>
    <p>${escapeHtml(address.address_line)}<br>${escapeHtml([address.city, address.region].filter(Boolean).join(', '))}<br>${escapeHtml(address.phone)}</p>
  </button>`;
}

function renderAddresses() {
  const block = document.getElementById('addressesBlock');
  const list = profileAddresses.length
    ? profileAddresses.map(addressCardHtml).join('')
    : '<p class="auth-form-intro">No saved addresses yet. Add one below — checkout reuses them.</p>';
  block.innerHTML = `
    <p class="checkout-section-title">Delivery addresses</p>
    <div class="address-list">${list}</div>
    <details class="profile-details">
      <summary class="auth-forgot">+ Add a new address</summary>
      <form class="auth-form" id="addressForm" novalidate>
        <div class="auth-field"><label for="addr-name">Full name</label><input id="addr-name" name="full_name" type="text" autocomplete="name" required></div>
        <div class="auth-field"><label for="addr-phone">Phone</label><input id="addr-phone" name="phone" type="tel" autocomplete="tel" required></div>
        <div class="auth-field"><label for="addr-address">Address</label><input id="addr-address" name="address_line" type="text" autocomplete="street-address" required></div>
        <div class="auth-field"><label for="addr-city">City</label><input id="addr-city" name="city" type="text" autocomplete="address-level2" required></div>
        <div class="auth-field"><label for="addr-region">Region</label><input id="addr-region" name="region" type="text" autocomplete="address-level1"></div>
        <p class="auth-error profile-message" role="alert" aria-live="polite"></p>
        <button class="button secondary" type="submit">Save address</button>
      </form>
    </details>`;

  const form = document.getElementById('addressForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBlockMessage(form, '');
    const data = new FormData(form);
    const address = {
      full_name: String(data.get('full_name') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      address_line: String(data.get('address_line') || '').trim(),
      city: String(data.get('city') || '').trim(),
      region: String(data.get('region') || '').trim() || null,
      is_default: profileAddresses.length === 0
    };
    if (!address.full_name || !address.phone || !address.address_line || !address.city) {
      setBlockMessage(form, 'Please fill in name, phone, address and city.');
      return;
    }
    setBusy(form, true);
    try {
      const created = await window.supabaseStore.createAddress(profileUser, address);
      profileAddresses.unshift(created);
      renderAddresses();
    } catch (err) {
      setBlockMessage(form, err.message || 'Could not save that address.');
      setBusy(form, false);
    }
  });
}
// ---------- Password block ----------

function renderPasswordBlock() {
  const block = document.getElementById('passwordBlock');
  block.innerHTML = `
    <p class="checkout-section-title">Change password</p>
    <form class="auth-form" id="passwordForm" novalidate>
      <div class="auth-field"><label for="current-password">Current password</label><input id="current-password" name="current" type="password" autocomplete="current-password" required></div>
      <div class="auth-field"><label for="new-password">New password</label><input id="new-password" name="password" type="password" autocomplete="new-password" minlength="6" required></div>
      <div class="auth-field"><label for="confirm-password">Confirm new password</label><input id="confirm-password" name="confirm" type="password" autocomplete="new-password" minlength="6" required></div>
      <p class="auth-error profile-message" role="alert" aria-live="polite"></p>
      <button class="button" type="submit">Update password <span>↗</span></button>
    </form>`;

  const form = document.getElementById('passwordForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBlockMessage(form, '');
    const data = new FormData(form);
    const current = String(data.get('current') || '');
    const password = String(data.get('password') || '');
    const confirm = String(data.get('confirm') || '');
    if (password.length < 6) { setBlockMessage(form, 'The new password must be at least 6 characters.'); return; }
    if (password !== confirm) { setBlockMessage(form, 'The two new passwords do not match.'); return; }
    setBusy(form, true);
    try {
      // Verify the current password first (prevents drive-by changes on an
      // unattended session), then update. Signing out afterwards invalidates
      // the refreshed session — the user logs in with the new password.
      const { error: checkError } = await window.supabaseStore.signIn(profileUser.email, current);
      if (checkError) { setBlockMessage(form, 'Your current password is not correct.'); setBusy(form, false); return; }
      const { error } = await window.supabaseStore.updatePassword(password);
      if (error) throw error;
      setBlockMessage(form, '✓ Password updated. Redirecting you to login…', true);
      form.reset();
      setTimeout(async () => {
        await window.supabaseStore.signOut();
        window.location.href = 'login.html?reset=success';
      }, 1600);
    } catch (err) {
      setBlockMessage(form, err.message || 'Could not update the password. Please try again.');
      setBusy(form, false);
    }
  });
}
// ---------- Boot ----------

async function init() {
  if (!window.supabaseStore) return;
  const state = document.getElementById('profileState');
  const { data, error } = await window.supabaseStore.getSession();
  if (error || !data?.session) { window.location.href = 'login.html'; return; }
  profileUser = data.session.user;

  try {
    profileCustomer = await window.supabaseStore.getCustomer(profileUser);
    if (!profileCustomer) {
      // Same lazy-creation path the cart uses — never a dead end.
      profileCustomer = await window.supabaseStore.getOrCreateCustomer(profileUser);
    }
    profileAddresses = await window.supabaseStore.listAddresses(profileUser);
  } catch (err) {
    state.innerHTML = `<p class="auth-form-intro">Could not load your profile: ${escapeHtml(err.message || 'unknown error')}</p><a class="button secondary" href="index.html">Back to the collection</a>`;
    return;
  }

  state.innerHTML = `
    <div id="accountBlock" class="profile-block"></div>
    <div id="addressesBlock" class="profile-block"></div>
    <div id="passwordBlock" class="profile-block"></div>`;

  renderAccount();
  renderAddresses();
  renderPasswordBlock();
}

document.addEventListener('DOMContentLoaded', init);


