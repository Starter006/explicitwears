function showMessage(message, isSuccess = false) {
  const messageElement = document.querySelector('.auth-error');
  if (!messageElement) return;
  messageElement.textContent = message;
  messageElement.classList.toggle('success', isSuccess);
}

function setSubmitting(form, isSubmitting) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = isSubmitting;
  button.setAttribute('aria-busy', String(isSubmitting));
}

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.querySelector('.auth-form');
  if (!form || !window.supabaseStore) return;

  const params = new URLSearchParams(window.location.search);
  if (params.get('signup') === 'success') showMessage('Account created. Log in to continue.', true);
  if (params.get('reset') === 'success') showMessage('Password updated. Log in with your new password.', true);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('');
    setSubmitting(form, true);

    try {
      const formData = new FormData(form);
      const email = String(formData.get('email') || '').trim();
      const password = String(formData.get('password') || '');

      if (form.id === 'signupForm') {
        const fullName = String(formData.get('name') || '').trim();
        const confirmPassword = String(formData.get('confirm-password') || '');
        if (password !== confirmPassword) throw new Error('Passwords do not match.');
        if (password.length < 6) throw new Error('Password must be at least 6 characters.');
        const { data, error } = await window.supabaseStore.signUp(email, password, fullName);
        if (error) throw error;
        // Email confirmation enabled: no session is returned until the shopper
        // verifies the code we just emailed them. Confirmation disabled: a
        // session comes back immediately and the flow stays exactly as before.
        if (!data.session) {
          window.location.href = `verify.html?email=${encodeURIComponent(email)}`;
          return;
        }
        window.location.href = 'login.html?signup=success';
        return;
      }

      const { error } = await window.supabaseStore.signIn(email, password);
      if (error) throw error;
      window.location.href = 'index.html';
    } catch (error) {
      showMessage(error.message || 'Something went wrong. Please try again.');
      setSubmitting(form, false);
    }
  });
});
