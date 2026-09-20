function showMessage(message, isSuccess = false) {
  const messageElement = document.querySelector('.auth-error');
  if (!messageElement) return;
  messageElement.textContent = message;
  messageElement.classList.toggle('success', isSuccess);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function getEmailFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const email = String(params.get('email') || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function setSubmitting(form, isSubmitting) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = isSubmitting;
  button.setAttribute('aria-busy', String(isSubmitting));
}

function showVerifiedState(email) {
  const form = document.getElementById('verifyForm');
  form.style.display = 'none';
  document.querySelector('.auth-form-intro').innerHTML =
    `<span class="verify-success">✓ Email verified${email ? ` for ${escapeHtml(email)}` : ''}.</span> Your account is active — you can log in now.`;
  const switchEl = document.createElement('p');
  switchEl.className = 'auth-switch';
  switchEl.innerHTML = '<a href="login.html">Continue to login</a>';
  form.parentElement.appendChild(switchEl);
}

async function init() {
  if (!window.supabaseStore) return;
  const email = getEmailFromUrl();
  if (!email) { window.location.href = 'signup.html'; return; }
  document.getElementById('verifyEmail').textContent = email;

  const form = document.getElementById('verifyForm');
  const resendButton = document.getElementById('resendButton');

  // If the shopper already has a session (clicked the emailed magic link, or
  // confirmation is off), skip straight to the success state.
  const { data: sessionData } = await window.supabaseStore.getSession();
  if (sessionData?.session) { showVerifiedState(email); return; }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('');
    const code = String(new FormData(form).get('code') || '').trim();
    if (!/^\d{6}$/.test(code)) { showMessage('Enter the 6-digit code from your email.'); return; }
    setSubmitting(form, true);
    try {
      const { error } = await window.supabaseStore.verifySignupEmail(email, code);
      if (error) throw error;
      showVerifiedState(email);
      // The OTP confirmation signs the shopper in; drop the session so the
      // next login starts fresh and stays predictable.
      await window.supabaseStore.signOut();
    } catch (err) {
      showMessage(err.message || 'That code didn\u2019t work. Check it and try again.');
      setSubmitting(form, false);
    }
  });

  resendButton.addEventListener('click', async () => {
    showMessage('');
    resendButton.disabled = true;
    try {
      const { error } = await window.supabaseStore.resendSignupCode(email);
      if (error) throw error;
      showMessage('New code sent. Check your inbox (and spam folder).', true);
    } catch (err) {
      showMessage(err.message || 'Could not resend the code right now. Try again in a minute.');
    } finally {
      setTimeout(() => { resendButton.disabled = false; }, 30000);
    }
  });
}

document.addEventListener('DOMContentLoaded', init);