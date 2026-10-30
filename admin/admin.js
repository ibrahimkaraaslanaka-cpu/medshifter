(() => {
  const token = sessionStorage.getItem('medshifter_admin_token');
  if (!token) { location.replace('./login.html'); return; }

  const view = document.getElementById('view');
  const notice = document.getElementById('notice');
  const dialog = document.getElementById('detail-dialog');
  const dialogBody = document.getElementById('dialog-body');
  const titles = { overview: 'Genel bakış', users: 'Hesaplar', calendars: 'Takvimler', orders: 'Siparişler', coupons: 'Kuponlar', settings: 'Site ayarları', admins: 'Yöneticiler' };
  const months = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const state = { page: 'overview', usersPage: 1, calendarsPage: 1, ordersPage: 1, admin: null };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const fmt = value => value ? new Date(value).toLocaleString('tr-TR') : '—';
  const month = value => months[Number(value)] || '—';
  const isSuper = () => state.admin?.role === 'superadmin';
  const badge = (value, kind = '') => `<span class="badge ${kind}">${esc(value)}</span>`;
  const empty = (cols, text) => `<tr><td colspan="${cols}" class="muted">${esc(text)}</td></tr>`;

  function message(text, error = false) {
    notice.textContent = text;
    notice.className = error ? 'error' : '';
    notice.hidden = !text;
  }
  function logout() {
    sessionStorage.removeItem('medshifter_admin_token');
    sessionStorage.removeItem('medshifter_admin');
    location.replace('./login.html');
  }
  async function api(path, options = {}) {
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers }
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { logout(); throw new Error('Oturum sona erdi'); }
    if (!response.ok) throw new Error(data.error || `İstek başarısız (${response.status})`);
    return data;
  }
  function openDialog(title, html) {
    document.getElementById('dialog-title').textContent = title;
    dialogBody.innerHTML = `<div class="dialog-content">${html}</div>`;
    if (!dialog.open) dialog.showModal();
  }
  const closeDialog = () => dialog.close();
  function pagination(kind, page, totalPages, total) {
    const pages = Math.max(1, totalPages || 1);
    return `<div class="pagination"><span>${page} / ${pages} · ${total} kayıt</span><div class="actions"><button class="button small" data-action="page" data-kind="${kind}" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>← Önceki</button><button class="button small" data-action="page" data-kind="${kind}" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Sonraki →</button></div></div>`;
  }
  async function setView(name) {
    if (!titles[name]) return;
    state.page = name;
    document.getElementById('view-title').textContent = titles[name];
    document.querySelectorAll('#navigation button').forEach(button => button.classList.toggle('active', button.dataset.view === name));
    view.innerHTML = '<p class="muted">Yükleniyor…</p>';
    try { await render[name](); } catch (error) { view.innerHTML = `<div class="panel error">${esc(error.message)}</div>`; }
  }

  const render = {
    async overview() {
      const data = await api('/admin/dashboard');
      const s = data.stats;
      view.innerHTML = `<div class="grid">
        <div class="card"><small>Toplam hesap</small><strong>${esc(s.totalUsers)}</strong></div>
        <div class="card"><small>Toplam takvim</small><strong>${esc(s.totalCalendars)}</strong></div>
        <div class="card"><small>Bu ay kayıt</small><strong>${esc(s.usersThisMonth)}</strong></div>
        <div class="card"><small>Bu ay oluşturulan takvim</small><strong>${esc(s.calendarsThisMonth)}</strong></div>
      </div><div class="panel"><h2>Plan dağılımı</h2><div class="grid">
        ${['FREE', 'INDIVIDUAL', 'BUSINESS'].map(plan => `<div class="card"><small>${plan}</small><strong>${esc(data.planDistribution[plan] || 0)}</strong></div>`).join('')}
      </div></div><div class="panel"><h2>Son kayıtlar</h2><div class="table-wrap"><table><thead><tr><th>Kullanıcı</th><th>Plan</th><th>Kayıt</th></tr></thead><tbody>
        ${(data.recentUsers || []).map(user => `<tr><td><strong>${esc(user.name || 'İsimsiz')}</strong><small>${esc(user.email)}</small></td><td>${badge(user.plan)}</td><td>${fmt(user.created_at)}</td></tr>`).join('') || empty(3, 'Henüz kayıt yok')}
      </tbody></table></div></div>`;
    },
    async users() {
      const query = new URLSearchParams({ page: state.usersPage, search: state.userSearch || '', plan: state.userPlan || '' });
      const data = await api(`/admin/users?${query}`);
      view.innerHTML = `<div class="panel"><div class="toolbar"><div class="toolbar-left"><input id="user-search" placeholder="E-posta veya isim ara" value="${esc(state.userSearch || '')}" aria-label="Kullanıcı ara"><select id="user-plan" aria-label="Plan filtresi"><option value="">Tüm planlar</option>${['FREE', 'INDIVIDUAL', 'BUSINESS'].map(plan => `<option ${state.userPlan === plan ? 'selected' : ''}>${plan}</option>`).join('')}</select><button class="button" data-action="search-users">Ara</button></div><button class="button primary" data-action="new-user">+ Hesap oluştur</button></div>
      <div class="table-wrap"><table><thead><tr><th>Kullanıcı</th><th>Plan</th><th>Takvim kullanımı</th><th>Kayıt</th><th></th></tr></thead><tbody>
      ${(data.users || []).map(user => `<tr><td><strong>${esc(user.name || 'İsimsiz')}</strong><small>${esc(user.email)}</small></td><td>${badge(user.plan)}</td><td>${esc(user.calendars_used_this_month || 0)}</td><td>${fmt(user.created_at)}</td><td><button class="button small" data-action="user-detail" data-id="${esc(user.id)}">Ayrıntı</button></td></tr>`).join('') || empty(5, 'Kullanıcı bulunamadı')}
      </tbody></table></div>${pagination('users', data.pagination.page, data.pagination.totalPages, data.pagination.total)}</div>`;
    },
    async calendars() {
      const data = await api(`/admin/calendars?page=${state.calendarsPage}`);
      view.innerHTML = `<div class="panel"><div class="panel-head"><div><h2>Oluşturulan takvimler</h2><p class="hint">Takvimi açarak nöbetleri inceleyebilir, JSON yedeğini alabilir ve başlığını düzenleyebilirsiniz.</p></div></div><div class="table-wrap"><table><thead><tr><th>Başlık</th><th>Sahibi</th><th>Dönem</th><th>Oluşturulma</th><th></th></tr></thead><tbody>
        ${(data.calendars || []).map(cal => `<tr><td><strong>${esc(cal.title)}</strong></td><td>${esc(cal.user?.name || cal.user?.email || '—')}<small>${esc(cal.user?.email || '')}</small></td><td>${month(cal.month)} ${esc(cal.year)}</td><td>${fmt(cal.created_at)}</td><td><button class="button small" data-action="calendar-detail" data-id="${esc(cal.id)}">Aç</button></td></tr>`).join('') || empty(5, 'Takvim bulunamadı')}
      </tbody></table></div>${pagination('calendars', data.pagination.page, data.pagination.totalPages, data.pagination.total)}</div>`;
    },
    async orders() {
      const data = await api(`/admin/orders?page=${state.ordersPage}&status=${encodeURIComponent(state.orderStatus || '')}`);
      view.innerHTML = `<div class="panel"><div class="toolbar"><div class="toolbar-left"><select id="order-status" aria-label="Sipariş durumu"><option value="">Tüm durumlar</option>${['awaiting_payment', 'pending', 'completed', 'failed', 'cancelled'].map(value => `<option value="${value}" ${state.orderStatus === value ? 'selected' : ''}>${value}</option>`).join('')}</select><button class="button" data-action="filter-orders">Filtrele</button></div></div><div class="table-wrap"><table><thead><tr><th>Kullanıcı</th><th>Plan</th><th>Tutar</th><th>Durum</th><th>Tarih</th><th></th></tr></thead><tbody>
      ${(data.orders || []).map(order => `<tr><td>${esc(order.user?.email || '—')}</td><td>${esc(order.plan)} / ${esc(order.billing_period)}</td><td>${esc(order.final_amount ?? order.amount ?? '—')} ${esc(order.currency || '')}</td><td>${badge(order.status, order.status === 'pending' ? 'warning' : '')}</td><td>${fmt(order.created_at)}</td><td><button class="button small" data-action="order-status" data-id="${esc(order.id)}" data-status="${esc(order.status)}">Durum</button></td></tr>`).join('') || empty(6, 'Sipariş bulunamadı')}
      </tbody></table></div>${pagination('orders', data.pagination.page, data.pagination.totalPages, data.pagination.total)}</div>`;
    },
    async coupons() {
      const data = await api('/admin/coupons');
      view.innerHTML = `<div class="panel"><div class="panel-head"><h2>İndirim kuponları</h2><button class="button primary" data-action="new-coupon">+ Kupon oluştur</button></div><div class="table-wrap"><table><thead><tr><th>Kod</th><th>İndirim</th><th>Kullanım</th><th>Durum</th><th></th></tr></thead><tbody>
      ${(data.coupons || []).map(coupon => `<tr><td><strong>${esc(coupon.code)}</strong></td><td>%${esc(coupon.discount_percent)}</td><td>${esc(coupon.current_uses || 0)} / ${coupon.max_uses ? esc(coupon.max_uses) : '∞'}</td><td>${badge(coupon.is_active ? 'Aktif' : 'Pasif', coupon.is_active ? '' : 'muted')}</td><td><button class="button small" data-action="toggle-coupon" data-id="${esc(coupon.id)}" data-active="${coupon.is_active}">${coupon.is_active ? 'Durdur' : 'Etkinleştir'}</button></td></tr>`).join('') || empty(5, 'Kupon bulunamadı')}
      </tbody></table></div></div>`;
    },
    async settings() {
      const { settings } = await api('/admin/site-settings');
      const priceInputs = ['INDIVIDUAL', 'BUSINESS'].map(plan => `<h3 class="section-label">${plan} fiyatları · aylık birim fiyat</h3><div class="fields four">${['monthly', 'yearly'].flatMap(period => ['TRY', 'USD'].map(currency => `<label>${period === 'monthly' ? 'Aylık' : 'Yıllık'} / ${currency}<input type="number" min="0.01" max="1000000" step="0.01" data-price="${plan}.${period}.${currency}" value="${esc(settings.prices[plan][period][currency])}" ${isSuper() ? '' : 'disabled'} required></label>`)).join('')}</div>`).join('');
      const limitInputs = ['FREE', 'INDIVIDUAL', 'BUSINESS'].map(plan => `<h3 class="section-label">${plan} limitleri</h3><div class="fields four">${[['calendarsPerMonth', 'Takvim'], ['conditionsLimit', 'Koşul'], ['peopleLimit', 'Personel'], ['versionsPerMonth', 'Versiyon']].map(([field, label]) => `<label>${label}<input type="number" min="0" max="10000" step="1" data-limit="${plan}.${field}" value="${esc(settings.limits[plan][field])}" ${isSuper() ? '' : 'disabled'} required></label>`).join('')}</div>`).join('');
      view.innerHTML = `<form id="settings-form" class="panel stack"><div><h2>Site yapılandırması</h2><p class="hint">Kaydedilen değişiklikler sunucu yeniden başlatılmadan fiyat ve plan limitlerine uygulanır. Fiyatlar ödeme API’siyle aynı kaynaktan okunur.</p></div><div class="fields"><label>Site adı<input name="siteName" maxlength="80" value="${esc(settings.siteName)}" ${isSuper() ? '' : 'disabled'} required></label><label>Destek e-postası<input name="supportEmail" type="email" value="${esc(settings.supportEmail)}" ${isSuper() ? '' : 'disabled'} required></label></div><div class="fields"><label>Duyuru metni<textarea name="announcementText" maxlength="300" ${isSuper() ? '' : 'disabled'}>${esc(settings.announcement.text)}</textarea></label><label>Duyuru durumu<select name="announcementEnabled" ${isSuper() ? '' : 'disabled'}><option value="false" ${settings.announcement.enabled ? '' : 'selected'}>Kapalı</option><option value="true" ${settings.announcement.enabled ? 'selected' : ''}>Açık</option></select></label></div><hr class="divider">${priceInputs}<hr class="divider">${limitInputs}${isSuper() ? '<div class="dialog-actions"><button class="button primary" type="submit">Değişiklikleri kaydet</button></div>' : '<p class="hint">Düzenleme için superadmin yetkisi gerekli.</p>'}</form>`;
      document.getElementById('settings-form').addEventListener('submit', saveSettings);
    },
    async admins() {
      if (!isSuper()) throw new Error('Bu bölüm için superadmin yetkisi gerekli');
      const data = await api('/admin/admins');
      view.innerHTML = `<div class="panel"><div class="panel-head"><h2>Yönetici erişimi</h2><button class="button primary" data-action="new-admin">+ Yönetici ekle</button></div><div class="table-wrap"><table><thead><tr><th>Kullanıcı</th><th>Rol</th><th>Son giriş</th><th></th></tr></thead><tbody>
      ${(data.admins || []).map(admin => `<tr><td><strong>${esc(admin.name || admin.username)}</strong><small>${esc(admin.username)}</small></td><td>${badge(admin.role)}</td><td>${fmt(admin.last_login_at)}</td><td>${admin.id === state.admin.id ? 'Siz' : `<button class="button small danger" data-action="delete-admin" data-id="${esc(admin.id)}">Kaldır</button>`}</td></tr>`).join('') || empty(4, 'Yönetici bulunamadı')}
      </tbody></table></div></div>`;
    }
  };

  async function userDetail(id) {
    const { user } = await api(`/admin/users/${encodeURIComponent(id)}`);
    openDialog('Hesap ayrıntısı', `<div class="stack"><div><h3>${esc(user.name || 'İsimsiz')}</h3><p class="muted">${esc(user.email)} · ${badge(user.plan)}</p></div><div class="grid"><div class="card"><small>Takvim kullanımı</small><strong>${esc(user.calendars_used_this_month || 0)}</strong></div><div class="card"><small>Kaydetme</small><strong>${esc(user.saves_used_this_month || 0)}</strong></div></div><div class="fields"><label>Plan<select id="detail-plan">${['FREE', 'INDIVIDUAL', 'BUSINESS'].map(plan => `<option ${user.plan === plan ? 'selected' : ''}>${plan}</option>`).join('')}</select></label><label>Plan bitişi<input id="detail-expiry" type="date" value="${esc(user.plan_expires_at?.slice(0, 10) || '')}"></label></div><div class="actions"><button class="button primary" data-action="save-plan" data-id="${esc(user.id)}">Planı kaydet</button>${isSuper() ? `<button class="button" data-action="reset-usage" data-id="${esc(user.id)}">Kullanımı sıfırla</button>` : ''}</div><h3 class="section-label">Takvimler (${user.calendars?.length || 0})</h3><div class="table-wrap"><table><tbody>${(user.calendars || []).map(cal => `<tr><td>${esc(cal.title)}</td><td>${month(cal.month)} ${esc(cal.year)}</td><td><button class="button small" data-action="calendar-detail" data-id="${esc(cal.id)}">Aç</button></td></tr>`).join('') || empty(3, 'Takvim yok')}</tbody></table></div></div>`);
  }
  async function calendarDetail(id) {
    const { calendar: cal } = await api(`/admin/calendars/${encodeURIComponent(id)}`);
    state.selectedCalendar = cal;
    const areas = Array.isArray(cal.work_areas) ? cal.work_areas : [];
    const people = Array.isArray(cal.people) ? cal.people.filter(person => typeof person === 'string') : [];
    const rows = (Array.isArray(cal.schedule) ? cal.schedule : []).map((day, dayIndex) => `<tr><td>${esc(day.date || day.dayName || '—')}</td>${areas.map(area => {
      const current = day[`workArea${area.id}`] || '';
      const options = current && !people.includes(current) ? ['', current, ...people] : ['', ...people];
      return `<td><select data-day-index="${dayIndex}" data-area-id="${esc(area.id)}" data-original="${esc(current)}" aria-label="${esc(area.name)} · ${esc(day.date || day.dayName || dayIndex + 1)}">${options.map(person => `<option value="${esc(person)}" ${person === current ? 'selected' : ''}>${esc(person || '—')}</option>`).join('')}</select></td>`;
    }).join('')}</tr>`).join('');
    openDialog('Takvim ayrıntısı', `<div class="stack"><div><h3>${esc(cal.title)}</h3><p class="muted">${esc(cal.user?.name || cal.user?.email || '—')} · ${month(cal.month)} ${esc(cal.year)} · ${fmt(cal.created_at)}</p></div><p class="hint">${people.length} personel · ${areas.length} çalışma alanı · ${Array.isArray(cal.schedule) ? cal.schedule.length : 0} gün</p><div class="actions"><button class="button" data-action="download-calendar">JSON yedeğini indir</button><button class="button" data-action="rename-calendar" data-id="${esc(cal.id)}">Başlığı değiştir</button>${isSuper() ? `<button class="button danger" data-action="delete-calendar" data-id="${esc(cal.id)}">Takvimi sil</button>` : ''}</div><p class="hint">Nöbetleri aşağıdan değiştirebilirsiniz. Atama koşulları otomatik yeniden hesaplanmaz; kaydetmeden önce kontrol edin.</p><div class="table-wrap"><table><thead><tr><th>Gün</th>${areas.map(area => `<th>${esc(area.name)}</th>`).join('')}</tr></thead><tbody>${rows || empty(areas.length + 1, 'Nöbet verisi yok')}</tbody></table></div>${rows ? `<div class="dialog-actions"><button class="button primary" data-action="save-assignments" data-id="${esc(cal.id)}">Nöbetleri kaydet</button></div>` : ''}</div>`);
  }
  async function saveSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const settings = { siteName: values.get('siteName'), supportEmail: values.get('supportEmail'), announcement: { enabled: values.get('announcementEnabled') === 'true', text: values.get('announcementText') }, prices: {}, limits: {} };
    form.querySelectorAll('[data-price]').forEach(input => { const [plan, period, currency] = input.dataset.price.split('.'); ((settings.prices[plan] ||= {})[period] ||= {})[currency] = Number(input.value); });
    form.querySelectorAll('[data-limit]').forEach(input => { const [plan, field] = input.dataset.limit.split('.'); (settings.limits[plan] ||= {})[field] = Number(input.value); });
    try { await api('/admin/site-settings', { method: 'PUT', body: JSON.stringify(settings) }); message('Site ayarları kaydedildi.'); } catch (error) { message(error.message, true); }
  }
  async function action(button) {
    const id = button.dataset.id;
    switch (button.dataset.action) {
      case 'page': state[`${button.dataset.kind}Page`] = Number(button.dataset.page); return setView(button.dataset.kind);
      case 'search-users': state.userSearch = document.getElementById('user-search').value; state.userPlan = document.getElementById('user-plan').value; state.usersPage = 1; return setView('users');
      case 'filter-orders': state.orderStatus = document.getElementById('order-status').value; state.ordersPage = 1; return setView('orders');
      case 'user-detail': return userDetail(id);
      case 'calendar-detail': return calendarDetail(id);
      case 'save-plan': {
        const plan = document.getElementById('detail-plan').value;
        const expiresAt = document.getElementById('detail-expiry').value || null;
        await api(`/admin/users/${encodeURIComponent(id)}/plan`, { method: 'PUT', body: JSON.stringify({ plan, expiresAt }) });
        closeDialog(); message('Plan güncellendi.'); return setView('users');
      }
      case 'reset-usage': if (confirm('Bu hesabın aylık kullanım sayaçları sıfırlansın mı?')) { await api(`/admin/users/${encodeURIComponent(id)}/reset-usage`, { method: 'POST' }); closeDialog(); message('Kullanım sayaçları sıfırlandı.'); return setView('users'); } return;
      case 'download-calendar': {
        const cal = state.selectedCalendar; if (!cal) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(cal, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = `medshifter-${cal.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
      }
      case 'save-assignments': {
        const assignments = [...dialogBody.querySelectorAll('[data-day-index][data-area-id]')]
          .filter(input => input.value !== input.dataset.original)
          .map(input => ({ dayIndex: Number(input.dataset.dayIndex), areaId: input.dataset.areaId, person: input.value }));
        if (!assignments.length) { message('Değişiklik yok.'); return; }
        await api(`/admin/calendars/${encodeURIComponent(id)}/assignments`, { method: 'PATCH', body: JSON.stringify({ assignments }) });
        message('Nöbet atamaları kaydedildi.'); return calendarDetail(id);
      }
      case 'rename-calendar': {
        const title = prompt('Yeni takvim başlığı:', state.selectedCalendar?.title || ''); if (title === null) return;
        await api(`/admin/calendars/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) });
        closeDialog(); message('Takvim başlığı güncellendi.'); return setView('calendars');
      }
      case 'delete-calendar': {
        const title = state.selectedCalendar?.title;
        if (prompt(`Takvimi kalıcı silmek için başlığını yazın: ${title}`) !== title) return;
        await api(`/admin/calendars/${encodeURIComponent(id)}`, { method: 'DELETE' });
        closeDialog(); message('Takvim silindi.'); return setView('calendars');
      }
      case 'toggle-coupon': await api(`/admin/coupons/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ is_active: button.dataset.active !== 'true' }) }); return setView('coupons');
      case 'order-status': {
        const status = prompt('Yeni durum: awaiting_payment, pending, completed, failed, cancelled', button.dataset.status);
        if (!status || status === button.dataset.status) return;
        if (!['awaiting_payment', 'pending', 'completed', 'failed', 'cancelled'].includes(status)) throw new Error('Geçersiz sipariş durumu');
        if (!confirm('Sipariş durumunu değiştirmek plan erişimini etkileyebilir. Devam edilsin mi?')) return;
        await api(`/admin/orders/${encodeURIComponent(id)}/status`, { method: 'PUT', body: JSON.stringify({ status }) }); return setView('orders');
      }
      case 'delete-admin': if (confirm('Bu yönetici erişimi kaldırılsın mı?')) { await api(`/admin/admins/${encodeURIComponent(id)}`, { method: 'DELETE' }); return setView('admins'); } return;
      case 'new-user': return openDialog('Hesap oluştur', `<form id="new-user-form" class="stack"><div class="fields"><label>E-posta<input name="email" type="email" required></label><label>Ad<input name="name"></label></div><div class="fields"><label>Geçici şifre<input name="password" type="password" minlength="8" required></label><label>Plan<select name="plan"><option>FREE</option><option>INDIVIDUAL</option><option>BUSINESS</option></select></label></div><div class="dialog-actions"><button class="button primary">Oluştur</button></div></form>`);
      case 'new-coupon': return openDialog('Kupon oluştur', `<form id="new-coupon-form" class="stack"><div class="fields"><label>Kod<input name="code" required></label><label>İndirim yüzdesi<input name="discount_percent" type="number" min="1" max="100" required></label></div><div class="fields"><label>Azami kullanım (0 = sınırsız)<input name="max_uses" type="number" min="0" value="0"></label><label>Son geçerlilik<input name="valid_until" type="date"></label></div><div class="dialog-actions"><button class="button primary">Oluştur</button></div></form>`);
      case 'new-admin': return openDialog('Yönetici ekle', `<form id="new-admin-form" class="stack"><div class="fields"><label>Kullanıcı adı<input name="username" required></label><label>Ad<input name="name"></label></div><div class="fields"><label>Şifre<input name="password" type="password" minlength="8" required></label><label>Rol<select name="role"><option value="admin">Admin</option><option value="superadmin">Superadmin</option></select></label></div><div class="dialog-actions"><button class="button primary">Oluştur</button></div></form>`);
    }
  }
  async function submitDialog(form) {
    const values = Object.fromEntries(new FormData(form));
    let path;
    if (form.id === 'new-user-form') path = '/admin/users';
    else if (form.id === 'new-coupon-form') { path = '/admin/coupons'; values.discount_percent = Number(values.discount_percent); values.max_uses = Number(values.max_uses || 0); values.applicable_plans = ['INDIVIDUAL', 'BUSINESS']; }
    else if (form.id === 'new-admin-form') path = '/admin/admins';
    else return;
    await api(path, { method: 'POST', body: JSON.stringify(values) });
    closeDialog(); message('Kayıt oluşturuldu.'); return setView(form.id === 'new-user-form' ? 'users' : form.id === 'new-coupon-form' ? 'coupons' : 'admins');
  }

  document.getElementById('navigation').addEventListener('click', event => { const button = event.target.closest('[data-view]'); if (button) setView(button.dataset.view); });
  document.getElementById('logout').addEventListener('click', logout);
  document.getElementById('dialog-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
  document.addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (button) action(button).catch(error => message(error.message, true)); });
  dialog.addEventListener('submit', event => { event.preventDefault(); submitDialog(event.target).catch(error => message(error.message, true)); });
  api('/admin/me').then(({ admin }) => {
    state.admin = admin;
    document.getElementById('admin-identity').textContent = `${admin.name || admin.username} · ${admin.role}`;
    document.querySelectorAll('[data-superadmin]').forEach(element => { element.hidden = !isSuper(); });
    document.getElementById('connection').textContent = 'Bağlı';
    setView('overview');
  }).catch(error => {
    document.getElementById('connection').textContent = 'Bağlantı hatası';
    document.getElementById('connection').classList.add('offline');
    message(error.message, true);
  });
})();
