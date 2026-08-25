(function (global) {
  'use strict';

  var mounted = false;

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function operationId() {
    return global.crypto && typeof global.crypto.randomUUID === 'function'
      ? global.crypto.randomUUID()
      : 'ref-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function dateInput(date) {
    var value = date instanceof Date ? date : new Date(date);
    return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : '';
  }

  function formatDate(value, withTime) {
    if (!value) return '—';
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return new Intl.DateTimeFormat('ru-RU', withTime
      ? { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }
      : { dateStyle: 'short', timeZone: 'Europe/Moscow' }).format(date);
  }

  function money(value) {
    if (!Number.isFinite(Number(value))) return '—';
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 })
      .format(Number(value) / 100);
  }

  function ensureStyles() {
    if (document.getElementById('phab-referral-links-style')) return;
    var style = document.createElement('style');
    style.id = 'phab-referral-links-style';
    style.textContent =
      '.phab-ref-page{height:100%;overflow:auto;padding:24px 18px 100px;background:#f7f7f9;color:#330020}' +
      '.phab-ref-shell{max-width:1220px;margin:0 auto;display:flex;flex-direction:column;gap:16px}' +
      '.phab-ref-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.phab-ref-head h2{margin:0;font-size:25px}.phab-ref-head p{margin:6px 0 0;color:#756571;font-size:13px}' +
      '.phab-ref-actions{display:flex;gap:8px;flex-wrap:wrap}.phab-ref-btn{border:0;border-radius:11px;padding:11px 14px;background:#65003f;color:#fff;font:800 12px inherit;cursor:pointer}.phab-ref-btn.secondary{background:#fff;color:#330020;border:1px solid rgba(51,0,32,.17)}.phab-ref-btn:disabled{opacity:.45;cursor:default}' +
      '.phab-ref-card{background:#fff;border:1px solid rgba(51,0,32,.12);border-radius:17px;box-shadow:0 8px 24px rgba(51,0,32,.05)}' +
      '.phab-ref-filter{display:flex;align-items:end;gap:12px;padding:14px;flex-wrap:wrap}.phab-ref-field{display:flex;flex-direction:column;gap:6px;min-width:150px;color:#6f5e69;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.phab-ref-field.grow{flex:1;min-width:240px}.phab-ref-field input,.phab-ref-field select{min-height:42px;width:100%;padding:9px 11px;border:1px solid rgba(51,0,32,.18);border-radius:10px;background:#fff;color:#330020;font:13px inherit;text-transform:none;letter-spacing:0}' +
      '.phab-ref-grid{display:grid;grid-template-columns:minmax(320px,.8fr) minmax(0,1.4fr);gap:14px;align-items:start}.phab-ref-list{padding:10px;display:flex;flex-direction:column;gap:8px}.phab-ref-link{width:100%;padding:13px;border:1px solid rgba(51,0,32,.12);border-radius:13px;background:#fff;color:#330020;text-align:left;cursor:pointer}.phab-ref-link.active,.phab-ref-link:hover{border-color:#65003f;background:#fff8fc}.phab-ref-link-top{display:flex;justify-content:space-between;gap:10px}.phab-ref-link strong{font-size:13px}.phab-ref-meta{margin-top:5px;color:#776873;font-size:11px;line-height:1.45}.phab-ref-mini{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:11px}.phab-ref-mini span{padding:7px;border-radius:9px;background:#f6f2f5;font-size:9px;text-transform:uppercase;color:#796a74}.phab-ref-mini b{display:block;margin-top:3px;color:#330020;font-size:14px}' +
      '.phab-ref-badge{display:inline-flex;align-items:center;padding:5px 8px;border-radius:999px;background:#eef8f0;color:#286334;font-size:9px;font-weight:900}.phab-ref-badge.PAUSED{background:#fff3d8;color:#815b00}.phab-ref-badge.ARCHIVED{background:#efedf0;color:#695e66}' +
      '.phab-ref-detail{padding:18px}.phab-ref-detail-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.phab-ref-detail h3{margin:0;font-size:18px}.phab-ref-public{display:flex;gap:7px;margin:13px 0}.phab-ref-public input{min-width:0;flex:1;padding:9px 10px;border:1px solid rgba(51,0,32,.14);border-radius:9px;color:#655861;background:#faf9fa}' +
      '.phab-ref-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin:15px 0}.phab-ref-kpi{padding:11px;border-radius:12px;background:#f7f4f6}.phab-ref-kpi span{display:block;color:#7b6b76;font-size:9px;text-transform:uppercase;line-height:1.25}.phab-ref-kpi b{display:block;margin-top:5px;font-size:19px}' +
      '.phab-ref-subhead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:20px 0 9px}.phab-ref-subhead h4{margin:0;font-size:13px}.phab-ref-table-wrap{overflow:auto;border:1px solid rgba(51,0,32,.1);border-radius:11px}.phab-ref-table{width:100%;border-collapse:collapse;font-size:11px}.phab-ref-table th,.phab-ref-table td{padding:9px 10px;border-bottom:1px solid rgba(51,0,32,.08);text-align:left;white-space:nowrap}.phab-ref-table th{position:sticky;top:0;background:#f8f5f7;color:#756671;font-size:9px;text-transform:uppercase}.phab-ref-table tr:last-child td{border-bottom:0}.phab-ref-state{font-weight:900}.phab-ref-state.PAID{color:#26713b}.phab-ref-state.CHECKOUT_NOT_PAID{color:#a25a00}.phab-ref-state.OPEN_ONLY{color:#786a73}' +
      '.phab-ref-empty,.phab-ref-message{padding:28px;text-align:center;color:#766771;font-size:12px}.phab-ref-message.error{color:#a31a39;background:#fff2f4;border-radius:12px}' +
      '.phab-ref-modal{position:fixed;z-index:10000;inset:0;display:grid;place-items:center;padding:18px;background:rgba(30,0,19,.48)}.phab-ref-modal-card{width:min(720px,100%);max-height:calc(100dvh - 36px);overflow:auto;padding:20px;border-radius:18px;background:#fff}.phab-ref-modal-card h3{margin:0 0 16px}.phab-ref-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}.phab-ref-wide{grid-column:1/-1}.phab-ref-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}' +
      '@media(max-width:1050px){.phab-ref-grid{grid-template-columns:1fr}.phab-ref-kpis{grid-template-columns:repeat(3,1fr)}}' +
      '@media(max-width:640px){.phab-ref-page{padding:16px 9px 90px}.phab-ref-head{flex-direction:column}.phab-ref-kpis{grid-template-columns:repeat(2,1fr)}.phab-ref-form{grid-template-columns:1fr}.phab-ref-wide{grid-column:auto}.phab-ref-filter{align-items:stretch}.phab-ref-field{min-width:calc(50% - 6px)}.phab-ref-field.grow{min-width:100%}}';
    document.head.appendChild(style);
  }

  function createApi(config) {
    var base = String(config.apiBaseUrl || '').replace(/\/+$/, '');
    function headers(extra) {
      var result = Object.assign({
        Accept: 'application/json',
        'x-user-id': String(config.userId || ''),
        'x-user-roles': Array.isArray(config.roles) ? config.roles.join(',') : '',
        'x-station-ids': Array.isArray(config.stationIds) ? config.stationIds.join(',') : ''
      }, extra || {});
      var token = String(config.authToken || '');
      if (!token && !config.cookieAuthOnly) {
        try { token = String(global.localStorage.getItem('phab_admin_token') || ''); } catch (_error) {}
      }
      if (token) result.Authorization = 'Bearer ' + token;
      return result;
    }
    async function request(path, options) {
      var response = await fetch(base + path, Object.assign({ credentials: 'same-origin' }, options || {}));
      if (!response.ok) {
        var payload = await response.json().catch(function () { return null; });
        var message = payload && payload.message;
        if (message && typeof message === 'object') message = message.message;
        if (Array.isArray(message)) message = message.join('; ');
        throw new Error(message || 'ЦУП API: HTTP ' + response.status);
      }
      return response;
    }
    return {
      list: async function (from, to) {
        return (await request('/v1/admin/referral-links?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to), { headers: headers() })).json();
      },
      analytics: async function (id, from, to) {
        return (await request('/v1/admin/referral-links/' + encodeURIComponent(id) + '/analytics?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to), { headers: headers() })).json();
      },
      create: async function (body) {
        return (await request('/v1/admin/referral-links', {
          method: 'POST', headers: headers({ 'Content-Type': 'application/json', 'Idempotency-Key': operationId() }), body: JSON.stringify(body)
        })).json();
      },
      update: async function (id, body) {
        return (await request('/v1/admin/referral-links/' + encodeURIComponent(id), {
          method: 'PATCH', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body)
        })).json();
      },
      exportUrl: function (id, from, to) {
        return base + '/v1/admin/referral-links/' + encodeURIComponent(id) + '/export.csv?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
      },
      download: async function (id, from, to) {
        var response = await request('/v1/admin/referral-links/' + encodeURIComponent(id) + '/export.csv?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to), { headers: headers() });
        var blob = await response.blob();
        var url = URL.createObjectURL(blob);
        var anchor = document.createElement('a');
        anchor.href = url; anchor.download = 'referral-link-' + id + '.csv'; anchor.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      }
    };
  }

  function mount() {
    if (mounted) return;
    var config = global.__PHAB_ADMIN_CONFIG__ || {};
    if (config.referralLinksAdminEnabled !== true) return;
    var permissions = Array.isArray(config.permissions) ? config.permissions : [];
    function can(permission) { return permissions.indexOf('*') >= 0 || permissions.indexOf(permission) >= 0; }
    if (Object.prototype.hasOwnProperty.call(config, 'permissions') && !can('subscriptions:analytics:read')) return;
    var canWrite = !Object.prototype.hasOwnProperty.call(config, 'permissions') || can('subscriptions:release:write');
    var canExport = !Object.prototype.hasOwnProperty.call(config, 'permissions') || can('subscriptions:analytics:export');
    var root = document.querySelector(config.mountSelector || '#phab-admin-root');
    var tabs = root && root.querySelector('.phab-admin-tabs');
    var content = root && root.querySelector('.phab-admin-content');
    var mobileSelect = root && root.querySelector('.phab-admin-mobile-tab-select');
    if (!root || !tabs || !content || !mobileSelect) { global.setTimeout(mount, 50); return; }
    mounted = true;
    ensureStyles();

    var api = createApi(config);
    var now = new Date();
    var fromDate = new Date(now.getTime() - 29 * 86400000);
    var state = { from: dateInput(fromDate), to: dateInput(now), items: [], selectedId: '', detail: null, loading: false, error: '', query: '' };

    var tab = document.createElement('button');
    tab.type = 'button'; tab.className = 'phab-admin-tab'; tab.textContent = 'Реферальные ссылки';
    tabs.appendChild(tab);
    var option = document.createElement('option');
    option.value = 'referral-links'; option.textContent = 'Реферальные ссылки'; mobileSelect.appendChild(option);
    var section = document.createElement('div'); section.className = 'phab-admin-hidden'; content.appendChild(section);

    function visible(value) { section.className = value ? 'phab-ref-page' : 'phab-admin-hidden'; tab.classList.toggle('phab-admin-tab-active', value); }
    function activate() { mobileSelect.value = 'referral-links'; mobileSelect.dispatchEvent(new Event('change', { bubbles: true })); visible(true); if (!state.items.length) void load(); }
    tabs.addEventListener('click', function (event) { if (event.target !== tab) visible(false); });
    mobileSelect.addEventListener('change', function () { var active = mobileSelect.value === 'referral-links'; visible(active); if (active && !state.items.length) void load(); });
    tab.addEventListener('click', activate);

    function filteredItems() {
      var query = state.query.trim().toLowerCase();
      return !query ? state.items : state.items.filter(function (item) {
        return [item.campaignName, item.recipientName, item.targetUrl, item.legacyAttributionKey].join(' ').toLowerCase().indexOf(query) >= 0;
      });
    }

    function render() {
      var items = filteredItems();
      section.innerHTML = '<div class="phab-ref-shell">' +
        '<div class="phab-ref-head"><div><h2>Реферальные ссылки</h2><p>Выдача ссылок, ежедневная воронка и покупки по каждой кампании.</p></div><div class="phab-ref-actions">' + (canWrite ? '<button class="phab-ref-btn" data-action="create">+ Новая ссылка</button>' : '') + '</div></div>' +
        '<div class="phab-ref-card phab-ref-filter"><label class="phab-ref-field"><span>С</span><input type="date" data-field="from" value="' + escapeHtml(state.from) + '"></label><label class="phab-ref-field"><span>По</span><input type="date" data-field="to" value="' + escapeHtml(state.to) + '"></label><label class="phab-ref-field grow"><span>Поиск</span><input data-field="query" value="' + escapeHtml(state.query) + '" placeholder="Кому выдали, кампания или страница"></label><button class="phab-ref-btn secondary" data-action="refresh">Обновить</button></div>' +
        (state.error ? '<div class="phab-ref-message error">' + escapeHtml(state.error) + '</div>' : '') +
        (state.loading ? '<div class="phab-ref-card phab-ref-message">Загружаем статистику…</div>' :
          '<div class="phab-ref-grid"><div class="phab-ref-card phab-ref-list">' +
          (items.length ? items.map(renderListItem).join('') : '<div class="phab-ref-empty">Ссылок за этот период пока нет.</div>') +
          '</div><div class="phab-ref-card phab-ref-detail">' + renderDetail() + '</div></div>') +
        '</div>';
      bind();
    }

    function renderListItem(item) {
      var t = item.totals || {};
      return '<button class="phab-ref-link ' + (item.linkId === state.selectedId ? 'active' : '') + '" data-select="' + escapeHtml(item.linkId) + '"><div class="phab-ref-link-top"><strong>' + escapeHtml(item.recipientName) + '</strong><span class="phab-ref-badge ' + escapeHtml(item.status) + '">' + escapeHtml(item.status) + '</span></div><div class="phab-ref-meta">' + escapeHtml(item.campaignName) + '<br>' + formatDate(item.validFrom, false) + ' — ' + formatDate(item.validTo, false) + '</div><div class="phab-ref-mini"><span>Открытия<b>' + Number(t.opens || 0) + '</b></span><span>К покупке<b>' + Number(t.checkoutStarts || 0) + '</b></span><span>Купили<b>' + Number(t.paidPurchases || 0) + '</b></span></div></button>';
    }

    function renderDetail() {
      var detail = state.detail;
      if (!state.selectedId) return '<div class="phab-ref-empty">Выберите ссылку слева, чтобы увидеть статистику и покупателей.</div>';
      if (!detail) return '<div class="phab-ref-empty">Загружаем детали…</div>';
      var link = detail.link; var totals = detail.totals || {};
      return '<div class="phab-ref-detail-head"><div><h3>' + escapeHtml(link.campaignName) + '</h3><div class="phab-ref-meta">Выдана: <b>' + escapeHtml(link.recipientName) + '</b> · цель: ' + escapeHtml(link.targetUrl) + '</div></div><div class="phab-ref-actions">' + (canWrite ? '<button class="phab-ref-btn secondary" data-action="toggle">' + (link.status === 'ACTIVE' ? 'Приостановить' : 'Активировать') + '</button>' : '') + (canExport ? '<button class="phab-ref-btn" data-action="export">Выгрузить CSV</button>' : '') + '</div></div>' +
        '<div class="phab-ref-public"><input readonly value="' + escapeHtml(link.publicUrl) + '"><button class="phab-ref-btn secondary" data-action="copy">Копировать</button></div>' +
        '<div class="phab-ref-kpis">' + kpi('Открытия', totals.opens) + kpi('Уникальные визиты', totals.uniqueVisits) + kpi('Перешли к покупке', totals.checkoutStarts) + kpi('Купили', totals.paidPurchases) + kpi('Не купили', totals.checkoutNotPaid) + kpi('Конверсия в покупку', Number(totals.visitToPaidPercent || 0) + '%') + '</div>' +
        '<div class="phab-ref-subhead"><h4>Ежедневная статистика</h4><span class="phab-ref-meta">Europe/Moscow</span></div><div class="phab-ref-table-wrap"><table class="phab-ref-table"><thead><tr><th>Дата</th><th>Открытия</th><th>Визиты</th><th>К покупке</th><th>Купили</th><th>Покупатели</th></tr></thead><tbody>' + (detail.daily || []).map(function (row) { return '<tr><td>' + escapeHtml(row.date) + '</td><td>' + row.opens + '</td><td>' + row.uniqueVisits + '</td><td>' + row.checkoutStarts + '</td><td>' + row.paidPurchases + '</td><td>' + row.uniqueBuyers + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<div class="phab-ref-subhead"><h4>Кто дошёл до покупки</h4><span class="phab-ref-meta">Телефон на экране скрыт; полный — только в CSV</span></div><div class="phab-ref-table-wrap"><table class="phab-ref-table"><thead><tr><th>Статус</th><th>Телефон</th><th>Открытие</th><th>Переход к оплате</th><th>Покупка</th><th>Что</th><th>Сумма</th></tr></thead><tbody>' +
        ((detail.journeys || []).length ? detail.journeys.map(function (row) { return '<tr><td><span class="phab-ref-state ' + escapeHtml(row.status) + '">' + escapeHtml(row.status) + '</span></td><td>' + escapeHtml(row.clientPhoneMasked || '—') + '</td><td>' + formatDate(row.openedAt, true) + '</td><td>' + formatDate(row.checkoutAt, true) + '</td><td>' + formatDate(row.paidAt, true) + '</td><td>' + escapeHtml(row.productName || row.planKey || '—') + '</td><td>' + money(row.amountMinor) + '</td></tr>'; }).join('') : '<tr><td colspan="7">Событий пока нет.</td></tr>') + '</tbody></table></div>';
    }

    function kpi(label, value) { return '<div class="phab-ref-kpi"><span>' + escapeHtml(label) + '</span><b>' + escapeHtml(value || 0) + '</b></div>'; }

    function bind() {
      section.querySelectorAll('[data-select]').forEach(function (button) { button.addEventListener('click', function () { void select(button.getAttribute('data-select')); }); });
      var from = section.querySelector('[data-field="from"]'); var to = section.querySelector('[data-field="to"]'); var query = section.querySelector('[data-field="query"]');
      if (from) from.addEventListener('change', function () { state.from = from.value; });
      if (to) to.addEventListener('change', function () { state.to = to.value; });
      if (query) query.addEventListener('input', function () { state.query = query.value; render(); var next = section.querySelector('[data-field="query"]'); if (next) { next.focus(); next.setSelectionRange(state.query.length, state.query.length); } });
      var refresh = section.querySelector('[data-action="refresh"]'); if (refresh) refresh.addEventListener('click', function () { void load(); });
      var create = section.querySelector('[data-action="create"]'); if (create) create.addEventListener('click', openCreate);
      var copy = section.querySelector('[data-action="copy"]'); if (copy) copy.addEventListener('click', function () { void navigator.clipboard.writeText(state.detail.link.publicUrl); copy.textContent = 'Скопировано'; });
      var exp = section.querySelector('[data-action="export"]'); if (exp) exp.addEventListener('click', function () { void api.download(state.selectedId, state.from, state.to).catch(showError); });
      var toggle = section.querySelector('[data-action="toggle"]'); if (toggle) toggle.addEventListener('click', function () { void changeStatus(); });
    }

    async function load() {
      state.loading = true; state.error = ''; render();
      try {
        var response = await api.list(state.from, state.to); state.items = response.items || [];
        if (state.selectedId && !state.items.some(function (item) { return item.linkId === state.selectedId; })) state.selectedId = '';
        if (!state.selectedId && state.items[0]) state.selectedId = state.items[0].linkId;
        state.detail = state.selectedId ? await api.analytics(state.selectedId, state.from, state.to) : null;
      } catch (error) { state.error = error.message || 'Не удалось загрузить ссылки.'; }
      state.loading = false; render();
    }

    async function select(id) {
      state.selectedId = id; state.detail = null; render();
      try { state.detail = await api.analytics(id, state.from, state.to); } catch (error) { showError(error); }
      render();
    }

    function showError(error) { state.error = error && error.message ? error.message : 'Операция не выполнена.'; render(); }

    async function changeStatus() {
      if (!state.detail) return;
      var link = state.detail.link; var status = link.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
      try { await api.update(link.linkId, { expectedRevision: link.revision, status: status }); await load(); } catch (error) { showError(error); }
    }

    function openCreate() {
      var modal = document.createElement('div'); modal.className = 'phab-ref-modal';
      var start = new Date(); var end = new Date(start.getTime() + 30 * 86400000);
      modal.innerHTML = '<form class="phab-ref-modal-card"><h3>Новая реферальная ссылка</h3><div class="phab-ref-form"><label class="phab-ref-field"><span>Название акции</span><input name="campaignName" required maxlength="120"></label><label class="phab-ref-field"><span>Кому выдали</span><input name="recipientName" required maxlength="160"></label><label class="phab-ref-field phab-ref-wide"><span>На какую страницу</span><input name="targetUrl" type="url" required placeholder="https://padlhub.ru/..."></label><label class="phab-ref-field"><span>Начало акции</span><input name="validFrom" type="date" required value="' + dateInput(start) + '"></label><label class="phab-ref-field"><span>Конец акции</span><input name="validTo" type="date" required value="' + dateInput(end) + '"></label><label class="phab-ref-field"><span>Внешний номер / примечание</span><input name="recipientExternalRef" maxlength="160"></label><label class="phab-ref-field"><span>Код старой таблицы (необязательно)</span><input name="legacyAttributionKey" placeholder="TR-001" pattern="TR-(00[1-9]|0[1-4][0-9]|050)"></label></div><div class="phab-ref-message error" hidden></div><div class="phab-ref-modal-actions"><button type="button" class="phab-ref-btn secondary" data-close>Отмена</button><button class="phab-ref-btn">Создать ссылку</button></div></form>';
      document.body.appendChild(modal);
      modal.querySelector('[data-close]').addEventListener('click', function () { modal.remove(); });
      modal.addEventListener('click', function (event) { if (event.target === modal) modal.remove(); });
      modal.querySelector('form').addEventListener('submit', async function (event) {
        event.preventDefault(); var form = event.currentTarget; var submit = form.querySelector('button[type="submit"],button:not([type])'); submit.disabled = true;
        var data = new FormData(form); var errorEl = form.querySelector('.phab-ref-message');
        try {
          var created = await api.create({
            campaignName: String(data.get('campaignName') || '').trim(), recipientName: String(data.get('recipientName') || '').trim(),
            targetUrl: String(data.get('targetUrl') || '').trim(), validFrom: String(data.get('validFrom')) + 'T00:00:00.000+03:00', validTo: String(data.get('validTo')) + 'T23:59:59.999+03:00', timezone: 'Europe/Moscow', status: 'ACTIVE',
            recipientExternalRef: String(data.get('recipientExternalRef') || '').trim() || undefined,
            legacyAttributionKey: String(data.get('legacyAttributionKey') || '').trim() || undefined
          });
          modal.remove(); state.selectedId = created.linkId; await load();
        } catch (error) { errorEl.hidden = false; errorEl.textContent = error.message || 'Не удалось создать ссылку.'; submit.disabled = false; }
      });
    }

    render();
  }

  global.PHABReferralLinksAdmin = { mount: mount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})(window);
