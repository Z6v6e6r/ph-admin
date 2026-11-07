(function (global) {
  'use strict';

  var MOSCOW_TZ = 'Europe/Moscow';
  var PAGE_SIZE = 20;
  var QUIET = 'phab-admin-hidden';
  var DESCRIPTION = 'Создавайте постоянные QR-ссылки, меняйте адрес перехода и отслеживайте использование';
  var mounted = false;

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function operationId() {
    return global.crypto && typeof global.crypto.randomUUID === 'function'
      ? global.crypto.randomUUID()
      : 'qr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function moscowDateInput(value) {
    var date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: MOSCOW_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(date);
    } catch (_error) {
      return date.toISOString().slice(0, 10);
    }
  }

  function daysAgo(days) {
    return new Date(Date.now() - Number(days || 0) * 86400000);
  }

  function formatDate(value, withTime) {
    if (!value) return '—';
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return new Intl.DateTimeFormat('ru-RU', withTime
      ? { dateStyle: 'short', timeStyle: 'short', timeZone: MOSCOW_TZ }
      : { dateStyle: 'short', timeZone: MOSCOW_TZ }).format(date);
  }

  function formatNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat('ru-RU').format(number) : '0';
  }

  function statusLabel(status) {
    if (status === 'ACTIVE') return 'Активен';
    if (status === 'PAUSED') return 'На паузе';
    if (status === 'ARCHIVED') return 'В архиве';
    return String(status || '—');
  }

  function trim(value) {
    return String(value === null || value === undefined ? '' : value).trim();
  }

  function queryString(params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value === undefined || value === null || value === '') return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function ensureStyles() {
    if (document.getElementById('phab-qr-links-style')) return;
    var style = document.createElement('style');
    style.id = 'phab-qr-links-style';
    style.textContent =
      '.phab-qr-page{height:100%;overflow:auto;padding:24px 18px 100px;background:#f7f7f9;color:#330020}' +
      '.phab-qr-shell{max-width:1220px;margin:0 auto;display:flex;flex-direction:column;gap:16px}' +
      '.phab-qr-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.phab-qr-head h2{margin:0;font-size:25px}.phab-qr-head p{margin:6px 0 0;color:#756571;font-size:13px}' +
      '.phab-qr-actions{display:flex;gap:8px;flex-wrap:wrap}' +
      '.phab-qr-btn{border:0;border-radius:11px;padding:11px 14px;background:#65003f;color:#fff;font:800 12px inherit;cursor:pointer}' +
      '.phab-qr-btn.secondary{background:#fff;color:#330020;border:1px solid rgba(51,0,32,.17)}.phab-qr-btn.danger{background:#a3122f}.phab-qr-btn:disabled{opacity:.45;cursor:default}' +
      '.phab-qr-card{min-width:0;max-width:100%;padding:0;background:#fff;border:1px solid rgba(51,0,32,.12);border-radius:17px;box-shadow:0 8px 24px rgba(51,0,32,.05)}' +
      '.phab-qr-filter{display:flex;align-items:end;gap:12px;padding:14px;flex-wrap:wrap}' +
      '.phab-qr-field{display:flex;flex-direction:column;gap:6px;min-width:150px;color:#6f5e69;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}' +
      '.phab-qr-field.grow{flex:1;min-width:240px}' +
      '.phab-qr-field input,.phab-qr-field select,.phab-qr-field textarea{min-height:42px;width:100%;padding:9px 11px;border:1px solid rgba(51,0,32,.18);border-radius:10px;background:#fff;color:#330020;font:13px inherit;text-transform:none;letter-spacing:0}' +
      '.phab-qr-field textarea{min-height:84px;resize:vertical}' +
      '.phab-qr-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}' +
      '.phab-qr-kpi{padding:14px;border-radius:14px;background:#fff;border:1px solid rgba(51,0,32,.12)}' +
      '.phab-qr-kpi span{display:block;color:#7b6b76;font-size:10px;text-transform:uppercase;line-height:1.25}.phab-qr-kpi b{display:block;margin-top:6px;font-size:23px}' +
      '.phab-qr-hint{color:#756671;font-size:11px;line-height:1.45}' +
      '.phab-qr-notice{padding:10px 12px;border-radius:11px;background:#eef8f0;color:#286334;font-size:12px;font-weight:700}' +
      '.phab-qr-notice.error{background:#fff2f4;color:#a31a39}' +
      '.phab-qr-message{padding:28px;text-align:center;color:#766771;font-size:13px}' +
      '.phab-qr-message.error{color:#a31a39;background:#fff2f4;border-radius:12px}' +
      '.phab-qr-table-wrap{overflow:auto;border-radius:14px}' +
      '.phab-qr-table{width:100%;border-collapse:collapse;font-size:12px}' +
      '.phab-qr-table th,.phab-qr-table td{padding:10px;border-bottom:1px solid rgba(51,0,32,.08);text-align:left;vertical-align:top}' +
      '.phab-qr-table th{position:sticky;top:0;background:#f8f5f7;color:#756671;font-size:10px;text-transform:uppercase;white-space:nowrap}' +
      '.phab-qr-sort{border:0;background:transparent;color:inherit;font:inherit;text-transform:inherit;cursor:pointer;padding:0}' +
      '.phab-qr-cell-name{min-width:190px;max-width:280px}.phab-qr-cell-name strong{display:block;font-size:13px;overflow-wrap:anywhere}.phab-qr-cell-name span{display:block;margin-top:3px;color:#7a6b75;font-size:11px}' +
      '.phab-qr-cell-link{min-width:210px;max-width:300px}.phab-qr-cell-url{min-width:190px;max-width:260px;color:#655861;font-size:11px}' +
      '.phab-qr-truncate{display:block;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.phab-qr-badge{display:inline-flex;align-items:center;padding:5px 8px;border-radius:999px;background:#eef8f0;color:#286334;font-size:10px;font-weight:900;white-space:nowrap}' +
      '.phab-qr-badge.PAUSED{background:#fff3d8;color:#815b00}.phab-qr-badge.ARCHIVED{background:#efedf0;color:#695e66}' +
      '.phab-qr-cell-actions{min-width:150px}.phab-qr-row-actions{display:flex;flex-wrap:wrap;gap:6px}' +
      '.phab-qr-mini{border:1px solid rgba(51,0,32,.16);border-radius:9px;padding:7px 9px;background:#fff;color:#330020;font:800 11px inherit;cursor:pointer;white-space:nowrap}' +
      '.phab-qr-mini.primary{background:#65003f;color:#fff;border-color:#65003f}' +
      '.phab-qr-rowmenu{margin-top:7px;display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid rgba(51,0,32,.14);border-radius:11px;background:#fff8fc}' +
      '.phab-qr-rowmenu .phab-qr-mini{text-align:left}' +
      '.phab-qr-pagination{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px;flex-wrap:wrap}.phab-qr-pagination span{color:#756671;font-size:12px}' +
      '.phab-qr-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}' +
      '.phab-qr-card-body{padding:18px}.phab-qr-card-head h3{margin:0;font-size:19px}' +
      '.phab-qr-card-grid{display:grid;grid-template-columns:280px minmax(0,1fr);gap:18px;margin-top:16px;align-items:start}' +
      '.phab-qr-qrbox{display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px;border-radius:14px;background:#faf9fa;border:1px solid rgba(51,0,32,.1)}' +
      '.phab-qr-qrimg{width:220px;height:220px;max-width:100%;object-fit:contain;background:#fff;border-radius:10px;padding:8px}' +
      '.phab-qr-qrplaceholder{width:220px;height:220px;max-width:100%;display:grid;place-items:center;border-radius:10px;background:#fff;color:#8a7d86;font-size:12px;text-align:center;padding:12px}' +
      '.phab-qr-public{display:flex;min-width:0;gap:7px;margin:13px 0}' +
      '.phab-qr-public input{min-width:0;flex:1;padding:9px 10px;border:1px solid rgba(51,0,32,.14);border-radius:9px;color:#655861;background:#faf9fa}' +
      '.phab-qr-meta{color:#776873;font-size:12px;line-height:1.5;overflow-wrap:anywhere}.phab-qr-meta b{color:#330020}' +
      '.phab-qr-kpis.detail{grid-template-columns:repeat(3,minmax(0,1fr));margin:15px 0}' +
      '.phab-qr-subhead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:20px 0 9px}.phab-qr-subhead h4{margin:0;font-size:13px}' +
      '.phab-qr-modal{position:fixed;z-index:10000;inset:0;display:grid;place-items:center;padding:18px;background:rgba(30,0,19,.48)}' +
      '.phab-qr-modal-card{width:min(720px,100%);max-height:calc(100dvh - 36px);overflow:auto;padding:20px;border-radius:18px;background:#fff}' +
      '.phab-qr-modal-card h3{margin:0 0 16px}' +
      '.phab-qr-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}.phab-qr-wide{grid-column:1/-1}' +
      '.phab-qr-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}' +
      '@media(max-width:1050px){.phab-qr-card-grid{grid-template-columns:1fr}}' +
      '@media(max-width:640px){.phab-qr-page{padding:16px 9px 90px;overflow-x:hidden}.phab-qr-shell{min-width:0;max-width:100%}.phab-qr-head,.phab-qr-card-head,.phab-qr-public{flex-direction:column}.phab-qr-head p,.phab-qr-meta{overflow-wrap:anywhere}.phab-qr-card-body{padding:14px}.phab-qr-card-head .phab-qr-actions,.phab-qr-public input,.phab-qr-public .phab-qr-btn{width:100%}.phab-qr-kpis,.phab-qr-kpis.detail{grid-template-columns:repeat(2,minmax(0,1fr))}.phab-qr-form{grid-template-columns:1fr}.phab-qr-wide{grid-column:auto}.phab-qr-filter{align-items:stretch}.phab-qr-field{min-width:100%}.phab-qr-field.grow{min-width:100%}.phab-qr-table-wrap{min-width:0;max-width:100%;overflow-x:auto}.phab-qr-qrimg,.phab-qr-qrplaceholder{width:100%;height:auto;aspect-ratio:1/1}}';
    document.head.appendChild(style);
  }

  function createApi(config) {
    var base = String(config.apiBaseUrl || '').replace(/[/]+$/, '');
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
        var error = new Error(message || 'ЦУП API: HTTP ' + response.status);
        error.status = response.status;
        error.code = payload && (payload.code || (payload.error && payload.error.code));
        throw error;
      }
      return response;
    }
    return {
      list: async function (params) {
        return (await request('/v1/admin/qr-links' + queryString(params), { headers: headers() })).json();
      },
      stations: async function () {
        return (await request('/v1/admin/qr-links/stations', { headers: headers() })).json();
      },
      allowedHosts: async function () {
        return (await request('/v1/admin/qr-links/allowed-hosts', { headers: headers() })).json();
      },
      saveAllowedHosts: async function (hosts, expectedVersion) {
        return (await request('/v1/admin/qr-links/allowed-hosts', {
          method: 'PUT',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ hosts: hosts, expectedVersion: expectedVersion })
        })).json();
      },
      get: async function (id) {
        return (await request('/v1/admin/qr-links/' + encodeURIComponent(id), { headers: headers() })).json();
      },
      create: async function (body, idempotencyKey) {
        var response = await request('/v1/admin/qr-links', {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }),
          body: JSON.stringify(body)
        });
        var item = await response.json();
        return {
          item: item,
          replayed: String(response.headers.get('Idempotency-Replayed') || '').toLowerCase() === 'true'
        };
      },
      update: async function (id, body) {
        return (await request('/v1/admin/qr-links/' + encodeURIComponent(id), {
          method: 'PATCH',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body)
        })).json();
      },
      stats: async function (id, from, to) {
        return (await request('/v1/admin/qr-links/' + encodeURIComponent(id) + '/stats' + queryString({ from: from, to: to }), { headers: headers() })).json();
      },
      history: async function (id) {
        return (await request('/v1/admin/qr-links/' + encodeURIComponent(id) + '/history', { headers: headers() })).json();
      },
      image: async function (id, format) {
        return (await request('/v1/admin/qr-links/' + encodeURIComponent(id) + '/image' + queryString({ format: format }), {
          headers: headers({ Accept: format === 'svg' ? 'image/svg+xml' : 'image/png' })
        })).blob();
      }
    };
  }

  function mount() {
    if (mounted) return;
    var config = global.__PHAB_ADMIN_CONFIG__ || {};
    if (config.qrLinksAdminEnabled !== true) return;

    var root = document.querySelector(config.mountSelector || '#phab-admin-root');
    var tabs = root && root.querySelector('.phab-admin-tabs');
    var content = root && root.querySelector('.phab-admin-content');
    var mobileSelect = root && root.querySelector('.phab-admin-mobile-tab-select');
    if (!root || !tabs || !content || !mobileSelect) { global.setTimeout(mount, 50); return; }
    mounted = true;
    ensureStyles();

    var hasPermissions = Object.prototype.hasOwnProperty.call(config, 'permissions');
    var permissions = Array.isArray(config.permissions) ? config.permissions : [];
    function can(permission) {
      return !hasPermissions || permissions.indexOf('*') >= 0 || permissions.indexOf(permission) >= 0;
    }
    var canRead = can('qr:read');
    var canManage = can('qr:manage');
    var canSettings = can('settings:write');

    var api = createApi(config);
    var state = {
      visible: false,
      shellBuilt: false,
      stations: [],
      stationsLoaded: false,
      stationsLoading: false,
      filters: { q: '', stationId: '', status: '' },
      periodMode: '30',
      from: moscowDateInput(daysAgo(29)),
      to: moscowDateInput(new Date()),
      sort: 'createdAt',
      direction: 'desc',
      page: 1,
      pageSize: PAGE_SIZE,
      items: [],
      total: 0,
      totalPages: 1,
      metrics: { totalQr: 0, activeQr: 0, redirectsPeriod: 0 },
      period: null,
      listLoading: false,
      listError: '',
      selectedId: '',
      card: null,
      stats: null,
      history: null,
      cardLoading: false,
      cardError: '',
      imageUrl: '',
      menuId: '',
      noticeText: '',
      noticeError: false
    };
    var searchTimer = null;

    var tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'phab-admin-tab';
    tab.textContent = 'QR-коды';
    tabs.appendChild(tab);

    var option = document.createElement('option');
    option.value = 'qr-links';
    option.textContent = 'QR-коды';
    mobileSelect.appendChild(option);

    var section = document.createElement('div');
    section.className = QUIET;
    content.appendChild(section);

    function setPageVisible(visible) {
      state.visible = visible;
      section.className = visible ? 'phab-qr-page' : QUIET;
      tab.classList.toggle('phab-admin-tab-active', visible);
    }

    function syncUrl(qrId) {
      try {
        var params = new URLSearchParams(global.location.search || '');
        params.set('section', 'qr-links');
        if (qrId) params.set('qrId', String(qrId));
        else params.delete('qrId');
        var search = params.toString();
        global.history.replaceState(null, '', '/api/ui/admin' + (search ? '?' + search : ''));
      } catch (_error) {
        // Deep link sync is best-effort; the module still works without History API.
      }
    }

    function ensureLoad() {
      if (!canRead) return;
      if (!state.stationsLoaded && !state.stationsLoading) void loadStations();
      if (!state.listLoading && !state.items.length && !state.listError) void loadList();
    }

    function activate() {
      setPageVisible(true);
      if (mobileSelect.value !== 'qr-links') {
        mobileSelect.value = 'qr-links';
        mobileSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      render();
      ensureLoad();
    }

    tabs.addEventListener('click', function (event) {
      if (event.target !== tab) setPageVisible(false);
    });
    mobileSelect.addEventListener('change', function () {
      var active = mobileSelect.value === 'qr-links';
      if (!active) { setPageVisible(false); return; }
      setPageVisible(true);
      render();
      ensureLoad();
    });
    tab.addEventListener('click', activate);

    // ---------------------------------------------------------------------
    // Shared delegated events. A single listener per section keeps the markup
    // free of inline onclick and avoids re-binding on every table refresh.
    // ---------------------------------------------------------------------
    section.addEventListener('click', function (event) {
      var element = event.target;
      while (element && element !== section && !(element.getAttribute && element.getAttribute('data-action'))) {
        element = element.parentNode;
      }
      if (!element || element === section || !element.getAttribute) return;
      var action = element.getAttribute('data-action');
      var id = String(element.getAttribute('data-id') || '');
      var item = findItem(id);
      if (action !== 'sort') event.preventDefault();
      switch (action) {
        case 'create': openFormModal('create', null); break;
        case 'allowed-hosts': void openAllowedHostsModal(); break;
        case 'refresh': void loadList(); if (!state.stationsLoaded) void loadStations(); break;
        case 'retry': void loadList(); break;
        case 'retry-card': if (state.selectedId) void loadCard(state.selectedId); break;
        case 'back': closeCard(); break;
        case 'open': openCard(id); break;
        case 'menu': state.menuId = state.menuId === id ? '' : id; renderListRegion(); break;
        case 'copy-short': copyWithNotice((item || state.card || {}).shortUrl, 'Ссылка скопирована'); break;
        case 'copy-card': copyWithNotice(state.card && state.card.shortUrl, 'Ссылка скопирована'); break;
        case 'download': void downloadQr(item || state.card, element.getAttribute('data-format') || 'png'); break;
        case 'edit': openFormModal('edit', item || state.card); break;
        case 'pause': void changeStatus(item || state.card, 'PAUSED'); break;
        case 'activate': void changeStatus(item || state.card, 'ACTIVE'); break;
        case 'archive': void archiveQr(item || state.card); break;
        case 'open-target': openTarget(); break;
        case 'prev': if (state.page > 1) { state.page -= 1; void loadList(); } break;
        case 'next': if (state.page < state.totalPages) { state.page += 1; void loadList(); } break;
        case 'sort': {
          var sortKey = String(element.getAttribute('data-sort') || '');
          if (!sortKey) break;
          if (state.sort === sortKey) state.direction = state.direction === 'asc' ? 'desc' : 'asc';
          else { state.sort = sortKey; state.direction = sortKey === 'name' ? 'asc' : 'desc'; }
          state.page = 1;
          void loadList();
          break;
        }
        default: break;
      }
    });

    section.addEventListener('input', function (event) {
      var field = event.target && event.target.getAttribute && event.target.getAttribute('data-field');
      if (field !== 'q') return;
      state.filters.q = event.target.value;
      if (searchTimer) global.clearTimeout(searchTimer);
      searchTimer = global.setTimeout(function () {
        state.page = 1;
        void loadList();
      }, 300);
    });

    section.addEventListener('change', function (event) {
      var field = event.target && event.target.getAttribute && event.target.getAttribute('data-field');
      if (!field) return;
      if (field === 'stationId') {
        state.filters.stationId = event.target.value;
        state.page = 1;
        void loadList();
        return;
      }
      if (field === 'status') {
        state.filters.status = event.target.value;
        state.page = 1;
        void loadList();
        return;
      }
      if (field === 'period') {
        state.periodMode = event.target.value;
        if (state.periodMode === 'custom') {
          renderFilters();
          return;
        }
        var range = periodRange(state.periodMode);
        state.from = range.from;
        state.to = range.to;
        state.page = 1;
        renderFilters();
        void loadList();
        return;
      }
      if (field === 'from' || field === 'to') {
        if (field === 'from') state.from = event.target.value;
        else state.to = event.target.value;
        state.page = 1;
        void loadList();
      }
    });

    function periodRange(mode) {
      var today = moscowDateInput(new Date());
      if (mode === 'today') return { from: today, to: today };
      if (mode === '7') return { from: moscowDateInput(daysAgo(6)), to: today };
      return { from: moscowDateInput(daysAgo(29)), to: today };
    }

    function findItem(id) {
      if (!id) return null;
      var found = state.items.filter(function (entry) { return String(entry.id) === String(id); })[0];
      if (found) return found;
      if (state.card && String(state.card.id) === String(id)) return state.card;
      return null;
    }

    function kpi(label, value) {
      var display = value === null || value === undefined || value === '' ? '—' : String(value);
      return '<div class="phab-qr-kpi"><span>' + escapeHtml(label) + '</span><b>' + escapeHtml(display) + '</b></div>';
    }

    function renderKpisHtml() {
      return '<div class="phab-qr-kpis">' +
        kpi('Всего QR', formatNumber(state.metrics.totalQr)) +
        kpi('Активных QR', formatNumber(state.metrics.activeQr)) +
        kpi('Переходов за выбранный период', formatNumber(state.metrics.redirectsPeriod)) +
        '</div>' +
        '<div class="phab-qr-hint">Показатели учитывают выбранные фильтры. Время — Europe/Moscow.</div>';
    }

    function renderKpis() {
      var region = section.querySelector('[data-kpis-region]');
      if (region) region.innerHTML = renderKpisHtml();
    }

    function noticeHtml() {
      var text = state.noticeText || '';
      return '<div class="phab-qr-notice' + (state.noticeError ? ' error' : '') + (text ? '' : ' ' + QUIET) + '" data-notice>' + escapeHtml(text) + '</div>';
    }

    function setNotice(text, isError) {
      state.noticeText = text || '';
      state.noticeError = Boolean(isError);
      var element = section.querySelector('[data-notice]');
      if (!element) return;
      element.textContent = state.noticeText;
      element.className = 'phab-qr-notice' + (state.noticeError ? ' error' : '') + (state.noticeText ? '' : ' ' + QUIET);
    }

    function stationOptions(selectedId, emptyLabel) {
      var html = '<option value="">' + escapeHtml(emptyLabel) + '</option>';
      state.stations.forEach(function (station) {
        var selected = String(station.stationId) === String(selectedId || '');
        html += '<option value="' + escapeHtml(station.stationId) + '"' + (selected ? ' selected' : '') + '>' +
          escapeHtml(station.stationName) + (station.isActive === false ? ' (неактивна)' : '') + '</option>';
      });
      return html;
    }

    function renderFilters() {
      var region = section.querySelector('[data-filter-region]');
      if (!region) return;
      var statuses = [
        { value: '', label: 'Активные и на паузе' },
        { value: 'ARCHIVED', label: 'В архиве' },
        { value: 'ALL', label: 'Все статусы' }
      ].map(function (entry) {
        return '<option value="' + entry.value + '"' + (state.filters.status === entry.value ? ' selected' : '') + '>' + entry.label + '</option>';
      }).join('');
      var periods = [
        { value: 'today', label: 'Сегодня' },
        { value: '7', label: 'За 7 дней' },
        { value: '30', label: 'За 30 дней' },
        { value: 'custom', label: 'Свой период' }
      ].map(function (entry) {
        return '<option value="' + entry.value + '"' + (state.periodMode === entry.value ? ' selected' : '') + '>' + entry.label + '</option>';
      }).join('');
      var customDates = state.periodMode === 'custom'
        ? '<label class="phab-qr-field"><span>С</span><input type="date" data-field="from" value="' + escapeHtml(state.from) + '"></label>' +
          '<label class="phab-qr-field"><span>По</span><input type="date" data-field="to" value="' + escapeHtml(state.to) + '"></label>'
        : '';
      region.innerHTML = '<div class="phab-qr-card phab-qr-filter">' +
        '<label class="phab-qr-field grow"><span>Поиск</span><input data-field="q" value="' + escapeHtml(state.filters.q) + '" placeholder="Название, код или место размещения"></label>' +
        '<label class="phab-qr-field"><span>Станция</span><select data-field="stationId">' + stationOptions(state.filters.stationId, 'Все станции') + '</select></label>' +
        '<label class="phab-qr-field"><span>Статус</span><select data-field="status">' + statuses + '</select></label>' +
        '<label class="phab-qr-field"><span>Период</span><select data-field="period">' + periods + '</select></label>' +
        customDates +
        '<button class="phab-qr-btn secondary" type="button" data-action="refresh">Обновить</button>' +
        '</div>';
    }

    function filtersActive() {
      return Boolean(trim(state.filters.q) || state.filters.stationId || state.filters.status);
    }

    function sortHeader(key, label) {
      var active = state.sort === key;
      var indicator = active ? (state.direction === 'asc' ? ' ↑' : ' ↓') : '';
      return '<th><button class="phab-qr-sort" type="button" data-action="sort" data-sort="' + key + '">' + escapeHtml(label) + indicator + '</button></th>';
    }

    function rowMenu(item, open) {
      if (!open) return '';
      var id = escapeHtml(item.id);
      var buttons = '<button class="phab-qr-mini" type="button" data-action="copy-short" data-id="' + id + '">Копировать ссылку</button>' +
        '<button class="phab-qr-mini" type="button" data-action="download" data-format="png" data-id="' + id + '">Скачать PNG</button>' +
        '<button class="phab-qr-mini" type="button" data-action="download" data-format="svg" data-id="' + id + '">Скачать SVG</button>';
      if (canManage && item.status !== 'ARCHIVED') {
        buttons += '<button class="phab-qr-mini" type="button" data-action="edit" data-id="' + id + '">Изменить</button>';
        buttons += item.status === 'ACTIVE'
          ? '<button class="phab-qr-mini" type="button" data-action="pause" data-id="' + id + '">Приостановить</button>'
          : '<button class="phab-qr-mini" type="button" data-action="activate" data-id="' + id + '">Активировать</button>';
        buttons += '<button class="phab-qr-mini" type="button" data-action="archive" data-id="' + id + '">Архивировать</button>';
      }
      return '<div class="phab-qr-rowmenu">' + buttons + '</div>';
    }

    function renderRow(item) {
      var id = escapeHtml(item.id);
      var menuOpen = String(state.menuId) === String(item.id);
      return '<tr>' +
        '<td class="phab-qr-cell-name"><strong>' + escapeHtml(item.name || '—') + '</strong>' +
          (item.placement ? '<span>' + escapeHtml(item.placement) + '</span>' : '') + '</td>' +
        '<td>' + escapeHtml(item.stationName || 'Общий QR') + '</td>' +
        '<td class="phab-qr-cell-link"><span class="phab-qr-truncate" title="' + escapeHtml(item.shortUrl || '') + '">' + escapeHtml(item.shortUrl || '—') + '</span>' +
          '<button class="phab-qr-mini" type="button" data-action="copy-short" data-id="' + id + '">Копировать</button></td>' +
        '<td class="phab-qr-cell-url"><span class="phab-qr-truncate" title="' + escapeHtml(item.targetUrl || '') + '">' + escapeHtml(item.targetUrl || '—') + '</span></td>' +
        '<td><span class="phab-qr-badge ' + escapeHtml(item.status) + '">' + escapeHtml(statusLabel(item.status)) + '</span></td>' +
        '<td>' + formatNumber(item.redirectsPeriod) + '</td>' +
        '<td>' + formatNumber(item.redirectsTotal) + '</td>' +
        '<td>' + formatDate(item.lastRedirectAt, true) + '</td>' +
        '<td class="phab-qr-cell-actions"><div class="phab-qr-row-actions">' +
          '<button class="phab-qr-mini primary" type="button" data-action="open" data-id="' + id + '">Открыть</button>' +
          '<button class="phab-qr-mini" type="button" data-action="menu" data-id="' + id + '">Действия</button>' +
        '</div>' + rowMenu(item, menuOpen) + '</td>' +
        '</tr>';
    }

    function renderListRegion() {
      var region = section.querySelector('[data-list-region]');
      if (!region) return;
      if (state.listLoading) {
        region.innerHTML = '<div class="phab-qr-message">Загружаем QR-коды…</div>';
        return;
      }
      if (state.listError) {
        region.innerHTML = '<div class="phab-qr-message error">' + escapeHtml(state.listError) + '</div>' +
          '<div class="phab-qr-message"><button class="phab-qr-btn secondary" type="button" data-action="retry">Повторить</button></div>';
        return;
      }
      if (!state.items.length) {
        region.innerHTML = '<div class="phab-qr-message">' + (filtersActive()
          ? 'Ничего не найдено. Измените фильтры.'
          : 'QR-кодов пока нет. Создайте первый QR-код.') + '</div>';
        return;
      }
      var rows = state.items.map(renderRow).join('');
      var fromIndex = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
      var toIndex = Math.min(state.total, state.page * state.pageSize);
      region.innerHTML = '<div class="phab-qr-table-wrap"><table class="phab-qr-table"><thead><tr>' +
        sortHeader('name', 'Название') +
        '<th>Станция</th><th>Короткая ссылка</th><th>Адрес перехода</th><th>Статус</th>' +
        sortHeader('redirectsPeriod', 'Переходы за период') +
        sortHeader('redirectsTotal', 'Переходы всего') +
        sortHeader('lastRedirectAt', 'Последний переход') +
        '<th>Действия</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="phab-qr-pagination"><span>Показано ' + fromIndex + '–' + toIndex + ' из ' + formatNumber(state.total) +
          ' · страница ' + state.page + ' из ' + state.totalPages + '</span>' +
          '<div class="phab-qr-actions">' +
            '<button class="phab-qr-btn secondary" type="button" data-action="prev"' + (state.page <= 1 ? ' disabled' : '') + '>Назад</button>' +
            '<button class="phab-qr-btn secondary" type="button" data-action="next"' + (state.page >= state.totalPages ? ' disabled' : '') + '>Вперёд</button>' +
          '</div></div>';
    }

    function renderNoAccess() {
      section.className = state.visible ? 'phab-qr-page' : QUIET;
      section.innerHTML = '<div class="phab-qr-shell"><div class="phab-qr-card phab-qr-card-body">' +
        '<h2>QR-коды</h2>' +
        '<div class="phab-qr-message error">Нет доступа к разделу «QR-коды»</div>' +
        '<div class="phab-qr-message">Обратитесь к администратору: для просмотра нужно право qr:read, для изменений — qr:manage.</div>' +
        '</div></div>';
    }

    function renderListView() {
      section.className = state.visible ? 'phab-qr-page' : QUIET;
      section.innerHTML = '<div class="phab-qr-shell">' +
        '<div class="phab-qr-head"><div><h2>QR-коды</h2><p>' + DESCRIPTION + '</p></div>' +
          '<div class="phab-qr-actions">' + (canManage && canSettings ? '<button class="phab-qr-btn secondary" type="button" data-action="allowed-hosts">Домены</button>' : '') + (canManage ? '<button class="phab-qr-btn" type="button" data-action="create">Создать QR</button>' : '') + '</div></div>' +
        '<div data-kpis-region>' + renderKpisHtml() + '</div>' +
        '<div data-filter-region></div>' +
        noticeHtml() +
        '<div class="phab-qr-card" data-list-region></div>' +
        '</div>';
      renderFilters();
      renderListRegion();
    }

    function render() {
      state.shellBuilt = true;
      if (!canRead) { renderNoAccess(); return; }
      if (state.selectedId) { renderCardView(); return; }
      renderListView();
    }

    async function loadStations() {
      if (state.stationsLoading || state.stationsLoaded) return;
      state.stationsLoading = true;
      try {
        var response = await api.stations();
        state.stations = Array.isArray(response.items) ? response.items : [];
        state.stationsLoaded = true;
      } catch (_error) {
        // The station filter is optional; the list still works without it.
        state.stationsLoaded = true;
      }
      state.stationsLoading = false;
      if (!state.selectedId) renderFilters();
    }

    async function loadList() {
      if (!canRead) return;
      state.listLoading = true;
      state.listError = '';
      renderListRegion();
      try {
        var response = await api.list({
          q: trim(state.filters.q) || undefined,
          stationId: state.filters.stationId || undefined,
          status: state.filters.status || undefined,
          from: state.from,
          to: state.to,
          sort: state.sort,
          direction: state.direction,
          page: state.page,
          pageSize: state.pageSize
        });
        state.items = Array.isArray(response.items) ? response.items : [];
        state.total = Number(response.total || 0);
        state.totalPages = Math.max(1, Number(response.totalPages || 1));
        state.metrics = response.metrics || { totalQr: 0, activeQr: 0, redirectsPeriod: 0 };
        state.period = response.period || null;
        if (state.page > state.totalPages) {
          state.page = state.totalPages;
          state.listLoading = false;
          return loadList();
        }
      } catch (error) {
        state.listError = error && error.message ? error.message : 'Не удалось загрузить QR-коды.';
      }
      state.listLoading = false;
      renderListRegion();
      renderKpis();
    }

    function handleActionError(error) {
      if (error && Number(error.status) === 409) {
        setNotice('Код изменился в другом окне. Обновите данные и повторите действие.', true);
        if (state.selectedId) void loadCard(state.selectedId);
        else void loadList();
        return;
      }
      setNotice(error && error.message ? error.message : 'Операция не выполнена. Повторите попытку.', true);
    }

    async function changeStatus(item, status) {
      if (!item) return;
      try {
        await api.update(String(item.id), { expectedVersion: Number(item.version), status: status });
        setNotice(status === 'PAUSED' ? 'QR-код приостановлен' : 'QR-код активирован');
        if (state.selectedId) void loadCard(state.selectedId);
        else void loadList();
      } catch (error) {
        handleActionError(error);
      }
    }

    async function archiveQr(item) {
      if (!item) return;
      var confirmText = 'Архивировать QR-код «' + (item.name || item.code || '') + '»?' +
        String.fromCharCode(10, 10) +
        'Напечатанные QR-коды перестанут перенаправлять посетителей. Код останется в архиве — удалить его нельзя.';
      if (!global.confirm(confirmText)) return;
      try {
        await api.update(String(item.id), { expectedVersion: Number(item.version), status: 'ARCHIVED' });
        setNotice('QR-код в архиве. Печатные QR-коды больше не перенаправляют.');
        if (state.selectedId) void loadCard(state.selectedId);
        else void loadList();
      } catch (error) {
        handleActionError(error);
      }
    }

    function openTarget() {
      if (!state.card || !state.card.targetUrl) {
        setNotice('У QR-кода не задан адрес перехода.', true);
        return;
      }
      global.open(String(state.card.targetUrl), '_blank', 'noopener');
    }

    async function downloadQr(item, format) {
      if (!item) return;
      var ext = format === 'svg' ? 'svg' : 'png';
      try {
        var blob = await api.image(String(item.id), ext);
        var url = URL.createObjectURL(blob);
        var anchor = document.createElement('a');
        var safeCode = String(item.code || item.id || 'qr').replace(/[^A-Za-z0-9_-]/g, '');
        anchor.href = url;
        anchor.download = 'qr-' + safeCode + '.' + ext;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        setNotice('Файл QR-кода загружен');
      } catch (error) {
        handleActionError(error);
      }
    }

    function copyText(value) {
      var text = String(value === null || value === undefined ? '' : value);
      function legacyCopy() {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', 'readonly');
        area.style.position = 'fixed';
        area.style.top = '-1000px';
        area.style.opacity = '0';
        document.body.appendChild(area);
        var copied = false;
        try {
          area.select();
          copied = document.execCommand('copy');
        } catch (_error) {
          copied = false;
        }
        area.remove();
        return copied;
      }
      if (global.navigator && global.navigator.clipboard && typeof global.navigator.clipboard.writeText === 'function') {
        return global.navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return legacyCopy(); });
      }
      return Promise.resolve(legacyCopy());
    }

    async function copyWithNotice(value, message) {
      if (!value) {
        setNotice('Ссылка недоступна.', true);
        return;
      }
      var copied = await copyText(value);
      setNotice(copied ? message : 'Не удалось скопировать. Выделите ссылку и скопируйте вручную.', !copied);
    }

    function openCard(id) {
      if (!id) return;
      state.selectedId = String(id);
      state.card = null;
      state.stats = null;
      state.history = null;
      state.cardError = '';
      state.menuId = '';
      if (state.imageUrl) {
        try { URL.revokeObjectURL(state.imageUrl); } catch (_error) {}
        state.imageUrl = '';
      }
      syncUrl(state.selectedId);
      render();
      void loadCard(state.selectedId);
    }

    function closeCard() {
      state.selectedId = '';
      state.card = null;
      state.stats = null;
      state.history = null;
      state.cardError = '';
      if (state.imageUrl) {
        try { URL.revokeObjectURL(state.imageUrl); } catch (_error) {}
        state.imageUrl = '';
      }
      syncUrl('');
      render();
      void loadList();
    }

    async function loadCard(id) {
      state.cardLoading = true;
      state.cardError = '';
      try {
        var results = await Promise.all([
          api.get(id),
          api.stats(id, state.from, state.to).catch(function () { return null; }),
          api.history(id).catch(function () { return null; }),
          api.image(id, 'png').catch(function () { return null; })
        ]);
        if (state.selectedId !== String(id)) { state.cardLoading = false; return; }
        state.card = results[0] || null;
        state.stats = results[1] || null;
        state.history = results[2] || null;
        if (state.imageUrl) {
          try { URL.revokeObjectURL(state.imageUrl); } catch (_error) {}
          state.imageUrl = '';
        }
        state.imageUrl = results[3] ? URL.createObjectURL(results[3]) : '';
      } catch (error) {
        if (state.selectedId !== String(id)) { state.cardLoading = false; return; }
        state.cardError = error && error.message ? error.message : 'Не удалось загрузить QR-код.';
      }
      state.cardLoading = false;
      renderCardView();
    }

    function renderCardView() {
      section.className = state.visible ? 'phab-qr-page' : QUIET;
      var card = state.card;
      var backButton = '<button class="phab-qr-mini" type="button" data-action="back">← К списку</button>';
      if (!card) {
        if (state.cardError) {
          section.innerHTML = '<div class="phab-qr-shell"><div class="phab-qr-card phab-qr-card-body">' + backButton +
            '<div class="phab-qr-message error">' + escapeHtml(state.cardError) + '</div>' +
            '<div class="phab-qr-message"><button class="phab-qr-btn secondary" type="button" data-action="retry-card">Повторить</button></div>' +
            '</div>' + noticeHtml() + '</div>';
        } else {
          section.innerHTML = '<div class="phab-qr-shell"><div class="phab-qr-card phab-qr-card-body">' + backButton +
            '<div class="phab-qr-message">Загружаем QR-код…</div></div></div>';
        }
        return;
      }

      var stats = state.stats || {};
      var totals = stats.totals || { redirectsPeriod: 0, redirectsTotal: 0, lastRedirectAt: null };
      var period = stats.period || state.period || null;
      var timezone = stats.timezone || (period && period.timezone) || MOSCOW_TZ;

      var daily = (state.stats && Array.isArray(state.stats.daily)) ? state.stats.daily : [];
      var dailyRows = daily.length
        ? daily.map(function (row) {
            return '<tr><td>' + escapeHtml(row.date || '—') + '</td><td>' + formatNumber(row.redirects) + '</td></tr>';
          }).join('')
        : '<tr><td colspan="2">Переходов за период пока нет.</td></tr>';

      var historyItems = (state.history && Array.isArray(state.history.items)) ? state.history.items : [];
      var historyRows = historyItems.length
        ? historyItems.map(function (entry) {
            return '<tr><td>' + escapeHtml(formatDate(entry.at, true)) + '</td><td>' + escapeHtml(entry.action || '—') + '</td><td>' + escapeHtml(entry.actorLogin || '—') + '</td></tr>';
          }).join('')
        : '<tr><td colspan="3">История изменений пока пуста.</td></tr>';

      var imageHtml = state.imageUrl
        ? '<img class="phab-qr-qrimg" src="' + escapeHtml(state.imageUrl) + '" alt="QR-код ' + escapeHtml(card.name || '') + '">'
        : '<div class="phab-qr-qrplaceholder">' + (state.cardLoading ? 'Загружаем QR-код…' : 'QR-код недоступен') + '</div>';

      var manageActions = '';
      if (canManage && card.status !== 'ARCHIVED') {
        manageActions += '<button class="phab-qr-btn secondary" type="button" data-action="edit">Изменить</button>';
        manageActions += card.status === 'ACTIVE'
          ? '<button class="phab-qr-btn secondary" type="button" data-action="pause">Приостановить</button>'
          : '<button class="phab-qr-btn secondary" type="button" data-action="activate">Активировать</button>';
        manageActions += '<button class="phab-qr-btn danger" type="button" data-action="archive">Архивировать</button>';
      }

      var archivedNotice = card.status === 'ARCHIVED'
        ? '<div class="phab-qr-notice error">QR-код в архиве: напечатанные QR-коды больше не перенаправляют.</div>'
        : '';

      section.innerHTML = '<div class="phab-qr-shell">' +
        '<div class="phab-qr-head"><div>' + backButton +
          '<h2>' + escapeHtml(card.name || 'QR-код') + '</h2>' +
          '<p>QR-код · ' + escapeHtml(card.stationName || 'Общий QR / без станции') + (card.placement ? ' · ' + escapeHtml(card.placement) : '') + '</p>' +
          '</div><div class="phab-qr-actions">' + manageActions + '</div></div>' +
        noticeHtml() + archivedNotice +
        '<div class="phab-qr-card phab-qr-card-body">' +
          '<div class="phab-qr-card-head"><div><h3>' + escapeHtml(card.name || 'QR-код') + '</h3>' +
            '<div class="phab-qr-meta"><span class="phab-qr-badge ' + escapeHtml(card.status) + '">' + escapeHtml(statusLabel(card.status)) + '</span>' +
            (card.description ? ' · ' + escapeHtml(card.description) : '') + '</div></div>' +
            '<div class="phab-qr-meta">Код: <b>' + escapeHtml(card.code || card.id) + '</b></div></div>' +
          '<div class="phab-qr-card-grid">' +
            '<div class="phab-qr-qrbox">' + imageHtml + '<div class="phab-qr-meta">Печатный QR-код</div></div>' +
            '<div>' +
              '<div class="phab-qr-meta"><b>Публичная ссылка</b></div>' +
              '<div class="phab-qr-public"><input readonly value="' + escapeHtml(card.shortUrl || '') + '">' +
                '<button class="phab-qr-btn secondary" type="button" data-action="copy-card">Копировать ссылку</button></div>' +
              '<div class="phab-qr-meta"><b>Адрес перехода</b><br>' + escapeHtml(card.targetUrl || '—') + '</div>' +
              '<div class="phab-qr-actions" style="margin-top:12px">' +
                '<button class="phab-qr-btn" type="button" data-action="copy-card">Копировать ссылку</button>' +
                '<button class="phab-qr-btn secondary" type="button" data-action="download" data-format="png">Скачать PNG</button>' +
                '<button class="phab-qr-btn secondary" type="button" data-action="download" data-format="svg">Скачать SVG</button>' +
                '<button class="phab-qr-btn secondary" type="button" data-action="open-target">Открыть целевой адрес</button>' +
              '</div>' +
              '<div class="phab-qr-meta" style="margin-top:10px">Адрес QR постоянный. Изменение страницы назначения не требует перепечатки кода.</div>' +
              '<div class="phab-qr-kpis detail">' +
                kpi('Переходов за период', formatNumber(totals.redirectsPeriod)) +
                kpi('Всего переходов', formatNumber(totals.redirectsTotal)) +
                kpi('Последний переход', totals.lastRedirectAt ? formatDate(totals.lastRedirectAt, true) : '—') +
              '</div>' +
              '<div class="phab-qr-hint">Количество открытий QR-ссылки. Повторные открытия учитываются. Показатель не подтверждает загрузку целевой страницы.</div>' +
              (period ? '<div class="phab-qr-hint">Период: ' + escapeHtml(period.from || '—') + ' — ' + escapeHtml(period.to || '—') + ' · ' + escapeHtml(timezone) + '</div>' : '') +
            '</div>' +
          '</div>' +
          '<div class="phab-qr-subhead"><h4>Ежедневная статистика</h4><span class="phab-qr-meta">' + escapeHtml(timezone) + '</span></div>' +
          '<div class="phab-qr-table-wrap"><table class="phab-qr-table"><thead><tr><th>Дата</th><th>Переходы</th></tr></thead><tbody>' + dailyRows + '</tbody></table></div>' +
          '<div class="phab-qr-subhead"><h4>История изменений</h4><span class="phab-qr-meta">Журнал действий</span></div>' +
          '<div class="phab-qr-table-wrap"><table class="phab-qr-table"><thead><tr><th>Когда</th><th>Действие</th><th>Кто</th></tr></thead><tbody>' + historyRows + '</tbody></table></div>' +
        '</div>' +
        '</div>';
    }

    async function openAllowedHostsModal() {
      var current;
      try {
        current = await api.allowedHosts();
      } catch (error) {
        setNotice(error && error.message ? error.message : 'Не удалось загрузить настройку доменов.', true);
        return;
      }
      var defaults = Array.isArray(current.defaults) ? current.defaults : [];
      var defaultsHtml = defaults.length
        ? defaults.map(function (host) { return '<span class="phab-qr-badge">' + escapeHtml(host) + '</span>'; }).join(' ')
        : '—';
      var modal = document.createElement('div');
      modal.className = 'phab-qr-modal';
      modal.innerHTML = '<form class="phab-qr-modal-card"><h3>Разрешённые домены</h3>' +
        '<p class="phab-qr-meta">Домены из серверной конфигурации разрешены всегда. Здесь можно добавить дополнительные домены для целевых страниц. Изменение записывается в аудит; удаление домена не ломает уже напечатанные QR, но запрещает новые ссылки на него.</p>' +
        '<div class="phab-qr-meta"><b>По умолчанию:</b><br>' + defaultsHtml + '</div>' +
        '<label class="phab-qr-field phab-qr-wide"><span>Дополнительные домены (по одному в строке, можно *.example.com)</span><textarea name="hosts" rows="5" placeholder="lk.padlhub.ru&#10;*.padlhub.ru">' + escapeHtml((Array.isArray(current.extra) ? current.extra : []).join('\n')) + '</textarea></label>' +
        '<div class="phab-qr-message error" data-error hidden></div>' +
        '<div class="phab-qr-modal-actions"><button type="button" class="phab-qr-btn secondary" data-close>Отмена</button><button class="phab-qr-btn" type="submit">Сохранить</button></div></form>';
      document.body.appendChild(modal);
      var close = function () { modal.remove(); };
      modal.querySelector('[data-close]').addEventListener('click', close);
      modal.addEventListener('click', function (event) { if (event.target === modal) close(); });
      var errorEl = modal.querySelector('[data-error]');
      modal.querySelector('form').addEventListener('submit', async function (event) {
        event.preventDefault();
        var form = event.currentTarget;
        var submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        errorEl.hidden = true;
        var hosts = String(form.querySelector('textarea[name="hosts"]').value || '')
          .split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
        try {
          await api.saveAllowedHosts(hosts, Number(current.version || 0));
          close();
          setNotice('Список разрешённых доменов обновлён');
        } catch (error) {
          errorEl.hidden = false;
          errorEl.textContent = error && error.status === 409
            ? 'Настройка доменов изменена в другом окне. Закройте окно и откройте заново.'
            : (error && error.message ? error.message : 'Не удалось сохранить домены.');
          submit.disabled = false;
        }
      });
    }

    function openFormModal(mode, item) {
      var editing = mode === 'edit' && item;
      var intent = { key: '', signature: '' };
      var modal = document.createElement('div');
      modal.className = 'phab-qr-modal';
      modal.innerHTML = '<form class="phab-qr-modal-card">' +
        '<h3>' + (editing ? 'Редактировать QR-код' : 'Новый QR-код') + '</h3>' +
        '<div class="phab-qr-form">' +
          '<label class="phab-qr-field"><span>Название</span><input name="name" required maxlength="120" value="' + escapeHtml(editing ? item.name : '') + '"></label>' +
          '<label class="phab-qr-field"><span>Станция</span><select name="stationId">' + stationOptions(editing ? item.stationId : '', 'Общий QR / без станции') + '</select></label>' +
          '<label class="phab-qr-field"><span>Размещение</span><input name="placement" maxlength="160" value="' + escapeHtml(editing ? item.placement : '') + '" placeholder="Стойка ресепшена, вход"></label>' +
          '<label class="phab-qr-field"><span>Статус</span><select name="status">' +
            '<option value="ACTIVE"' + (!editing || item.status !== 'PAUSED' ? ' selected' : '') + '>Активен</option>' +
            '<option value="PAUSED"' + (editing && item.status === 'PAUSED' ? ' selected' : '') + '>На паузе</option>' +
          '</select></label>' +
          '<label class="phab-qr-field phab-qr-wide"><span>Адрес перехода</span><input name="targetUrl" type="url" required maxlength="2048" value="' + escapeHtml(editing ? item.targetUrl : '') + '" placeholder="https://padlhub.ru/..."></label>' +
          '<label class="phab-qr-field phab-qr-wide"><span>Описание</span><textarea name="description" maxlength="600" placeholder="Необязательно">' + escapeHtml(editing ? item.description : '') + '</textarea></label>' +
          (editing
            ? '<label class="phab-qr-field phab-qr-wide"><span>Публичная ссылка (не меняется)</span><input readonly value="' + escapeHtml(item.shortUrl || '') + '"></label>' +
              '<div class="phab-qr-wide phab-qr-meta">Адрес QR постоянный. Изменение страницы назначения не требует перепечатки кода.</div>'
            : '') +
        '</div>' +
        '<div class="phab-qr-message error" data-form-error hidden></div>' +
        '<div class="phab-qr-modal-actions">' +
          '<button type="button" class="phab-qr-btn secondary" data-close>Отмена</button>' +
          '<button type="submit" class="phab-qr-btn">' + (editing ? 'Сохранить' : 'Создать QR') + '</button>' +
        '</div>' +
        '</form>';
      document.body.appendChild(modal);

      var form = modal.querySelector('form');
      var errorEl = modal.querySelector('[data-form-error]');
      var submit = form.querySelector('button[type="submit"]');

      function showFormError(message) {
        errorEl.hidden = false;
        errorEl.textContent = message;
        submit.disabled = false;
      }
      function close() {
        modal.remove();
      }

      modal.querySelector('[data-close]').addEventListener('click', close);
      modal.addEventListener('click', function (event) {
        if (event.target === modal) close();
      });
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        var data = new FormData(form);
        var name = trim(data.get('name'));
        var targetUrl = trim(data.get('targetUrl'));
        var stationId = trim(data.get('stationId'));
        var placement = trim(data.get('placement'));
        var description = trim(data.get('description'));
        var status = String(data.get('status') || 'ACTIVE') === 'PAUSED' ? 'PAUSED' : 'ACTIVE';
        if (!name) { showFormError('Укажите название QR-кода.'); return; }
        if (targetUrl.indexOf('https://') !== 0) { showFormError('Адрес перехода должен начинаться с https://'); return; }
        var body = { name: name, targetUrl: targetUrl, status: status };
        if (editing) {
          // PATCH clears optional fields with an explicit null.
          body.expectedVersion = Number(item.version);
          body.stationId = stationId || null;
          body.placement = placement || null;
          body.description = description || null;
        } else {
          // POST omits optional fields that the operator left empty.
          if (stationId) body.stationId = stationId;
          if (placement) body.placement = placement;
          if (description) body.description = description;
        }
        submit.disabled = true;
        errorEl.hidden = true;
        try {
          if (editing) {
            body.expectedVersion = Number(item.version);
            await api.update(String(item.id), body);
          } else {
            var signature = JSON.stringify(body);
            if (!intent.key || intent.signature !== signature) {
              intent.key = operationId();
              intent.signature = signature;
            }
            await api.create(body, intent.key);
          }
          close();
          setNotice(editing ? 'Изменения сохранены' : 'QR-код создан');
          if (state.selectedId) void loadCard(state.selectedId);
          else void loadList();
        } catch (error) {
          if (error && Number(error.status) === 409) {
            showFormError('Код изменился в другом окне. Обновите данные и повторите действие.');
            if (state.selectedId) void loadCard(state.selectedId);
          } else {
            showFormError(error && error.message ? error.message : 'Не удалось сохранить QR-код.');
          }
        }
      });
    }

    render();
    if (config.qrSection === 'qr-links') {
      activate();
      if (config.qrId) void openCard(String(config.qrId));
      else syncUrl('');
    }
  }

  global.PHABQrLinksAdmin = { mount: mount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})(window);
