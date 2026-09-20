function setFormMessage(form, message, isSuccess = false) {
  const element = form.querySelector('.auth-error');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('success', isSuccess);
}

function setSubmitting(form, isSubmitting) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = isSubmitting;
  button.setAttribute('aria-busy', String(isSubmitting));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const resetState = { finished: false };

function showForm(which) {
  document.getElementById('codeForm').style.display = which === 'codeForm' ? '' : 'none';
  document.getElementById('passwordForm').style.display = which === 'passwordForm' ? '' : 'none';
  document.getElementById('resetSuccess').style.display = which === 'success' ? '' : 'none';
  const intro = document.getElementById('resetIntro');
  if (which === 'codeForm') intro.textContent = 'Open the link from the reset email, or enter its 6-digit code below.';
  if (which === 'passwordForm') intro.textContent = 'You are verified — choose a new password (6+ characters).';
  if (which === 'success') intro.textContent = 'All set. Log in with your new password from now on.';
}

async function init() {
  if (!window.supabaseStore) return;
  const codeForm = document.getElementById('codeForm');
  const passwordForm = document.getElementById('passwordForm');

  if (window.location.protocol === 'file:') {
    showForm('codeForm');
    setFormMessage(codeForm, 'Supabase Auth redirects cannot reach file:// pages. Serve the site over http (e.g. VS Code Live Server) and open the reset link.');
    setSubmitting(codeForm, true);
    return;
  }

  // Prefill the address from the forgot page (kept in sessionStorage, never in
  // the URL, so nothing sensitive leaks through links or browser history).
  try {
    const email = sessionStorage.getItem('explicit-reset-email') || '';
    sessionStorage.removeItem('explicit-reset-email');
    if (email) document.getElementById('reset-email').value = email;
  } catch { /* storage unavailable — fine */ }

  // A session may already exist here: the emailed link just landed (recovery
  // session, picked up below), or the shopper is already signed in.
  try {
    const { data } = await window.supabaseStore.getSession();
    if (data?.session) showForm('passwordForm');
  } catch { /* fall through to the code form */ }
  if (passwordForm.style.display === 'none' && codeForm.style.display === 'none') showForm('codeForm');

  // The emailed link lands here with tokens in the URL; the Supabase client
  // consumes them right after load and fires PASSWORD_RECOVERY.
  window.supabaseStore.onAuthEvent((event) => {
    if (resetState.finished) return;
    if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') showForm('passwordForm');
  });

  codeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormMessage(codeForm, '');
    const data = new FormData(codeForm);
    const email = String(data.get('email') || '').trim();
    const code = String(data.get('code') || '').trim();
    if (!isValidEmail(email)) { setFormMessage(codeForm, 'Enter your registered email address.'); return; }
    if (!/^\d{6}$/.test(code)) { setFormMessage(codeForm, 'Enter the 6-digit code from the reset email.'); return; }
    setSubmitting(codeForm, true);
    try {
      const { error } = await window.supabaseStore.verifyRecoveryCode(email, code);
      if (error) throw error;
      showForm('passwordForm');
    } catch (err) {
      const message = err?.message || '';
      setFormMessage(codeForm, /expired/i.test(message)
        ? 'That code expired. Request a new reset email and use the newest one.'
        : 'That code didn\u2019t work. Check it and try again, or request a new email.');
      setSubmitting(codeForm, false);
    }
  });

  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormMessage(passwordForm, '');
    const data = new FormData(passwordForm);
    const password = String(data.get('password') || '');
    const confirm = String(data.get('confirm-password') || '');
    if (password.length < 6) { setFormMessage(passwordForm, 'Passwords must be at least 6 characters.'); return; }
    if (password !== confirm) { setFormMessage(passwordForm, 'The two passwords do not match.'); return; }
    setSubmitting(passwordForm, true);
    try {
      const { error } = await window.supabaseStore.updatePassword(password);
      if (error) throw error;
      resetState.finished = true;
      showForm('success');
      // Clear the recovery session so the next login starts fresh — same
      // behaviour as the signup email verification.
      await window.supabaseStore.signOut();
    } catch (err) {
      const message = err?.message || '';
      setFormMessage(passwordForm, /expired|invalid claim/i.test(message)
        ? 'Your reset session expired. Request a new reset email and use its link or code.'
        : (message || 'Could not update the password. Please try again.'));
      setSubmitting(passwordForm, false);
    }
  });
}

document.addEventListener('DOMContentLoaded', init);