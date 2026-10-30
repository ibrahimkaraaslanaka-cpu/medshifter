(() => {
  if (sessionStorage.getItem('medshifter_admin_token')) location.replace('./');
  const form = document.getElementById('login-form');
  const errorBox = document.getElementById('login-error');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    errorBox.hidden = true;
    try {
      const values = new FormData(form);
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: String(values.get('username')).trim(), password: String(values.get('password')) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Giriş başarısız');
      sessionStorage.setItem('medshifter_admin_token', data.token);
      sessionStorage.setItem('medshifter_admin', JSON.stringify(data.admin));
      location.replace('./');
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally { button.disabled = false; }
  });
})();
