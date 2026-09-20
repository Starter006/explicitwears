function showMessage(message, isSuccess = false) {
  const element = document.querySelector('.auth-error');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('success', isSuccess);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function setSubmitting(form, isSubmitting) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = isSubmitting;
  button.setAttribute('aria-busy', String(isSubmitting));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function showSentState(email) {
  const form = document.getElementById('forgotForm');
  document.getElementById('forgotIntro').innerHTML =
    `<span class="verify-success">✓ Reset email on its way.</span> If <strong>${escapeHtml(email)}</strong> is registered, a secure reset link and a 6-digit code are in the inbox now (check spam too).`;
  form.style.display = 'none';
  const actions = document.createElement('p');
  actions.className = 'auth-switch';
  actions.innerHTML = '<a href="reset.html">I have the code — reset password</a>';
  form.parentElement.appendChild(actions);
}

async function init() {
  if (!window.supabaseStore) return;
  const form = document.getElementById('forgotForm');

  if (window.location.protocol === 'file:') {
    showMessage('Supabase Auth redirects cannot reach file:// pages. Serve the site over http (e.g. VS Code Live Server) and reopen this page.');
    setSubmitting(form, true);
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('');
    const email = String(new FormData(form).get('email') || '').trim();
    if (!isValidEmail(email)) { showMessage('Enter a valid email address.'); return; }
    setSubmitting(form, true);
    try {
      const { error } = await window.supabaseStore.requestPasswordReset(email);
      if (error) throw error;
      try { sessionStorage.setItem('explicit-reset-email', email); } catch { /* fine */ }
      showSentState(email);
    } catch (err) {
      const message = err?.message || '';
      showMessage(/rate|too many/i.test(message)
        ? 'Too many reset emails were requested. Wait a few minutes and try again.'
        : (message || 'Could not send the reset email right now. Please try again.'));
      setSubmitting(form, false);
    }
  });
}

document.addEventListener('DOMContentLoaded', init);