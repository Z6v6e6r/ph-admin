(function (global) {
  'use strict';

  var FLOW_STEPS = [
    ['RECIPIENT_KIND', 'Кому подарок'],
    ['DESIGN', 'Дизайн'],
    ['DENOMINATION', 'Номинал'],
    ['MESSAGE', 'Поздравление'],
    ['DELIVERY', 'Доставка'],
    ['REVIEW', 'Проверка заказа']
  ];
  var REQUIRED_STEPS = ['DESIGN', 'DENOMINATION', 'REVIEW'];
  var mounted = false;

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function operationId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'phab-gift-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function defaultCatalog() {
    return {
      title: 'Подарочные сертификаты ПаделХАБ',
      publicEnabled: true,
      availableFrom: null,
      availableTo: null,
      flowSteps: FLOW_STEPS.map(function (step) { return step[0]; }),
      policy: {
        validityStart: 'ISSUE',
        validityDays: 365,
        activationDeadlineDays: null,
        scheduledDeliveryEnabled: true,
        emailAttachmentEnabled: true
      },
      designs: [
        {
          key: 'classic',
          audience: 'UNIVERSAL',
          title: 'Классический',
          description: null,
          imageUrl: '',
          alt: 'Подарочный сертификат ПаделХАБ',
          codeXPercent: 5.1,
          codeYPercent: 88,
          amountXPercent: 78.3,
          amountYPercent: 88,
          active: true,
          sortOrder: 10
        }
      ],
      denominations: [
        { amountMinor: 300000, currency: 'RUB', active: true, sortOrder: 10 },
        { amountMinor: 500000, currency: 'RUB', active: true, sortOrder: 20 },
        { amountMinor: 1000000, currency: 'RUB', active: true, sortOrder: 30 }
      ]
    };
  }

  function toInput(view) {
    return {
      title: view.title,
      publicEnabled: view.publicEnabled === true,
      availableFrom: view.availableFrom || null,
      availableTo: view.availableTo || null,
      flowSteps: Array.isArray(view.flowSteps) ? view.flowSteps.slice() : [],
      policy: Object.assign({}, view.policy),
      designs: (view.designs || []).map(function (item) {
        return {
          key: item.key,
          audience: item.audience,
          title: item.title,
          description: item.description || null,
          imageUrl: item.imageUrl,
          alt: item.alt,
          codeXPercent: Number(item.codeXPercent === undefined ? 5.1 : item.codeXPercent),
          codeYPercent: Number(item.codeYPercent === undefined ? 88 : item.codeYPercent),
          amountXPercent: Number(item.amountXPercent === undefined ? 78.3 : item.amountXPercent),
          amountYPercent: Number(item.amountYPercent === undefined ? 88 : item.amountYPercent),
          active: item.active === true,
          sortOrder: Number(item.sortOrder || 0)
        };
      }),
      denominations: (view.denominations || []).map(function (item) {
        return {
          amountMinor: Number(item.amountMinor),
          currency: 'RUB',
          active: item.active === true,
          sortOrder: Number(item.sortOrder || 0)
        };
      })
    };
  }

  function createApi(config) {
    var baseUrl = String(config.notificationApiBaseUrl || '').replace(/\/+$/, '');
    var tenantKey = encodeURIComponent(String(config.notificationTenantKey || 'local-padel'));
    var userRoot = baseUrl + '/user/api/v1/' + tenantKey;
    var adminRoot = baseUrl + '/admin/api/v1/' + tenantKey;
    var accessToken = '';

    function headers(extra) {
      return Object.assign(
        {
          Accept: 'application/json',
          'X-App-Platform': 'cup-admin',
          'X-App-Version': 'phab-cup-gift-local-0.1.0',
          'X-Correlation-ID': operationId()
        },
        extra || {}
      );
    }

    async function request(url, options) {
      var response = await fetch(url, Object.assign({ credentials: 'include' }, options || {}));
      var contentType = response.headers.get('content-type') || '';
      var payload = contentType.indexOf('application/json') >= 0
        ? await response.json().catch(function () { return null; })
        : null;
      if (!response.ok) {
        var message = payload && payload.message
          ? String(payload.message)
          : 'PadlHub Admin API: HTTP ' + response.status;
        var error = new Error(message);
        error.status = response.status;
        error.code = payload && payload.code ? String(payload.code) : '';
        throw error;
      }
      return payload;
    }

    async function refresh() {
      var session = await request(userRoot + '/auth/session/refresh', {
        method: 'POST',
        headers: headers({
          'Idempotency-Key': operationId(),
          'X-Session-Intent': 'refresh'
        })
      });
      accessToken = session && session.accessToken ? String(session.accessToken) : '';
      return session;
    }

    async function adminRequest(path, method, body, allowRefresh) {
      var requestHeaders = headers(body === undefined ? {} : { 'Content-Type': 'application/json' });
      if (accessToken) requestHeaders.Authorization = 'Bearer ' + accessToken;
      if (method !== 'GET') requestHeaders['Idempotency-Key'] = operationId();
      try {
        return await request(adminRoot + path, {
          method: method || 'GET',
          headers: requestHeaders,
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      } catch (error) {
        if (error && error.status === 401 && allowRefresh !== false) {
          await refresh();
          return adminRequest(path, method, body, false);
        }
        throw error;
      }
    }

    return {
      restoreSession: async function () {
        try {
          return await refresh();
        } catch (error) {
          if (error && (error.status === 401 || error.status === 403)) return null;
          throw error;
        }
      },
      requestCode: function (phone) {
        return request(userRoot + '/auth/challenges', {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json', 'Idempotency-Key': operationId() }),
          body: JSON.stringify({ method: 'phone_otp', phone: phone })
        });
      },
      verifyCode: async function (challengeId, code) {
        var session = await request(
          userRoot + '/auth/challenges/' + encodeURIComponent(challengeId) + '/verify',
          {
            method: 'POST',
            headers: headers({ 'Content-Type': 'application/json', 'Idempotency-Key': operationId() }),
            body: JSON.stringify({ code: code })
          }
        );
        accessToken = session && session.accessToken ? String(session.accessToken) : '';
        return session;
      },
      getCatalog: function () {
        return adminRequest('/gift-certificate-catalog', 'GET', undefined, true);
      },
      saveDraft: function (expectedRevision, catalog) {
        return adminRequest(
          '/gift-certificate-catalog/draft',
          'PUT',
          { expectedRevision: expectedRevision, catalog: catalog },
          true
        );
      },
      publish: function (catalogId, expectedRevision) {
        return adminRequest(
          '/gift-certificate-catalog/draft/publish',
          'POST',
          { catalogId: catalogId, expectedRevision: expectedRevision },
          true
        );
      },
      uploadMedia: async function (file) {
        var requestHeaders = headers({
          'Content-Type': file.type,
          'Idempotency-Key': operationId()
        });
        if (accessToken) requestHeaders.Authorization = 'Bearer ' + accessToken;
        try {
          return await request(adminRoot + '/gift-certificate-media', {
            method: 'POST',
            headers: requestHeaders,
            body: file
          });
        } catch (error) {
          if (error && error.status === 401) {
            await refresh();
            return this.uploadMedia(file);
          }
          throw error;
        }
      }
    };
  }

  function ensureStyles() {
    if (document.getElementById('phab-gift-certificates-style')) return;
    var style = document.createElement('style');
    style.id = 'phab-gift-certificates-style';
    style.textContent =
      '.phab-gift-section{height:100%;overflow:auto;padding:24px 18px 96px;background:#f7f7f9;color:#330020}' +
      '.phab-gift-shell{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:16px}' +
      '.phab-gift-page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}.phab-gift-page-head h2{margin:0;font-size:25px}.phab-gift-page-head p{margin:7px 0 0;color:rgba(51,0,32,.6);font-size:13px}' +
      '.phab-gift-toolbar{display:flex;gap:9px;flex-wrap:wrap;justify-content:flex-end}' +
      '.phab-gift-card{background:#fff;border:1px solid rgba(51,0,32,.12);border-radius:18px;box-shadow:0 10px 26px rgba(51,0,32,.06)}' +
      '.phab-gift-status{display:flex;align-items:center;gap:14px;padding:17px 18px}.phab-gift-status-icon{display:grid;width:44px;height:44px;place-items:center;border-radius:50%;background:#efffe7;font-size:21px}' +
      '.phab-gift-status-copy{min-width:0;flex:1}.phab-gift-status-copy strong,.phab-gift-status-copy span{display:block}.phab-gift-status-copy span{margin-top:4px;color:rgba(51,0,32,.55);font-size:12px}' +
      '.phab-gift-badges{display:flex;gap:7px;flex-wrap:wrap}.phab-gift-badge{padding:7px 10px;border-radius:999px;background:#f1edf0;font-size:10px;font-weight:800}.phab-gift-badge.live{color:#24572c;background:#eef8f0}' +
      '.phab-gift-manager{padding:18px}.phab-gift-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}.phab-gift-tab{border:0;border-radius:10px;padding:10px 13px;background:#f3f1f3;color:#5f5260;font-size:12px;font-weight:800;cursor:pointer}.phab-gift-tab strong{margin-left:6px}.phab-gift-tab.active{color:#fff;background:#65003f}' +
      '.phab-gift-search{position:relative;margin-bottom:14px}.phab-gift-search input{width:100%;min-height:42px;padding:9px 12px 9px 38px;border:1px solid rgba(51,0,32,.14);border-radius:10px;background:#fff;color:#330020;font:13px inherit}.phab-gift-search span{position:absolute;top:11px;left:14px;color:#8e818a}' +
      '.phab-gift-manager-grid{display:grid;grid-template-columns:330px minmax(0,1fr);gap:14px;align-items:start}.phab-gift-list{display:flex;flex-direction:column;gap:8px}' +
      '.phab-gift-row{display:grid;grid-template-columns:58px minmax(0,1fr) 26px;gap:11px;align-items:center;width:100%;padding:10px;border:1px solid rgba(51,0,32,.11);border-radius:12px;background:#fff;color:#330020;text-align:left;cursor:pointer}.phab-gift-row:hover,.phab-gift-row.active{border-color:#65003f;background:#fff8fc}.phab-gift-row img,.phab-gift-row-thumb{width:58px;height:42px;border-radius:8px;object-fit:cover;background:linear-gradient(135deg,#65003f,#ff5b5b)}.phab-gift-row-thumb{display:grid;place-items:center;color:#fff;font-size:11px;font-weight:900}.phab-gift-row-copy{min-width:0}.phab-gift-row-copy strong,.phab-gift-row-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.phab-gift-row-copy span{margin-top:4px;color:rgba(51,0,32,.55);font-size:11px}.phab-gift-row-state{font-size:16px;color:#52a764}' +
      '.phab-gift-editor{padding:18px}.phab-gift-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px}.phab-gift-card h3{margin:0;font-size:16px}.phab-gift-card p{margin:5px 0 0;color:rgba(51,0,32,.58);font-size:12px;line-height:1.45}' +
      '.phab-gift-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.phab-gift-wide{grid-column:1/-1}' +
      '.phab-gift-field{display:flex;flex-direction:column;gap:6px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.phab-gift-field input,.phab-gift-field select{width:100%;min-height:42px;border:1px solid rgba(51,0,32,.18);border-radius:10px;padding:9px 10px;background:#fff;color:#330020;font:13px inherit;text-transform:none;letter-spacing:0}' +
      '.phab-gift-check{display:flex;gap:8px;align-items:center;font-size:12px;font-weight:700}.phab-gift-check input{margin:0}' +
      '.phab-gift-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.phab-gift-btn{border:0;border-radius:10px;padding:10px 13px;font-size:12px;font-weight:800;cursor:pointer;background:#ff5b5b;color:#fff}.phab-gift-btn.secondary{background:#fff;color:#330020;border:1px solid rgba(51,0,32,.18)}.phab-gift-btn:disabled{opacity:.45;cursor:default}' +
      '.phab-gift-note{white-space:pre-wrap;border-radius:10px;padding:10px 12px;background:#eef8f0;color:#24572c;font-size:11px}.phab-gift-note.error{background:#fff0f1;color:#9f1735}' +
      '.phab-gift-certificate{position:relative;aspect-ratio:1990/1280;border-radius:15px;overflow:hidden;background:linear-gradient(135deg,#330020,#ff5454);color:#fff;background-size:cover;background-position:center}.phab-gift-certificate-code,.phab-gift-certificate-amount{position:absolute;color:#fff;text-shadow:0 1px 4px rgba(27,19,42,.25);white-space:nowrap}.phab-gift-certificate-code{left:5.1%;bottom:7.1%;font-size:clamp(12px,2.2vw,22px);font-weight:500;letter-spacing:.03em}.phab-gift-certificate-amount{right:4.1%;bottom:7.1%;width:17.6%;font-size:clamp(12px,2.2vw,23px);font-weight:800;text-align:center;font-style:italic}' +
      '.phab-gift-settings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.phab-gift-settings .phab-gift-card{padding:18px}.phab-gift-settings .phab-gift-card:last-child{grid-column:1/-1}.phab-gift-flow{display:flex;flex-wrap:wrap;gap:8px}.phab-gift-flow label{padding:8px 10px;border:1px solid rgba(51,0,32,.15);border-radius:10px;background:#faf9f7}' +
      '.phab-gift-actionbar{position:sticky;z-index:4;bottom:0;display:flex;align-items:center;gap:14px;padding:13px 16px;margin-top:0;border:1px solid rgba(51,0,32,.13);border-radius:16px;background:rgba(255,255,255,.96);box-shadow:0 -8px 24px rgba(51,0,32,.08);backdrop-filter:blur(10px)}.phab-gift-actionbar .phab-gift-note{min-width:0;flex:1}.phab-gift-actionbar .phab-gift-actions{margin:0;flex:0 0 auto}' +
      '.phab-gift-modal{position:fixed;z-index:10000;inset:0;display:grid;place-items:center;padding:20px;background:rgba(30,0,19,.48)}.phab-gift-modal-card{width:min(520px,100%);padding:18px;border-radius:18px;background:#fff;box-shadow:0 24px 80px rgba(20,0,13,.3)}' +
      '.phab-gift-auth{max-width:620px;margin:50px auto;padding:18px}' +
      '@media(max-width:920px){.phab-gift-manager-grid{grid-template-columns:1fr}.phab-gift-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.phab-gift-settings{grid-template-columns:1fr}.phab-gift-settings .phab-gift-card:last-child{grid-column:auto}}' +
      '@media(max-width:640px){.phab-gift-section{padding:16px 10px 88px}.phab-gift-page-head{flex-direction:column}.phab-gift-toolbar{justify-content:flex-start}.phab-gift-grid{grid-template-columns:1fr}.phab-gift-wide{grid-column:auto}.phab-gift-list{grid-template-columns:1fr}.phab-gift-actionbar{align-items:stretch;flex-direction:column;bottom:0}.phab-gift-actionbar .phab-gift-actions{width:100%}.phab-gift-actionbar .phab-gift-btn{flex:1}}';
    document.head.appendChild(style);
  }

  function mount() {
    if (mounted) return;
    var config = global.__PHAB_ADMIN_CONFIG__ || {};
    var root = document.querySelector(config.mountSelector || '#phab-admin-root');
    var tabs = root && root.querySelector('.phab-admin-tabs');
    var content = root && root.querySelector('.phab-admin-content');
    var mobileSelect = root && root.querySelector('.phab-admin-mobile-tab-select');
    if (!root || !tabs || !content || !mobileSelect) {
      global.setTimeout(mount, 50);
      return;
    }
    if (!config.notificationApiBaseUrl) return;
    mounted = true;
    ensureStyles();

    var api = createApi(config);
    var mediaBaseUrl = String(config.notificationApiBaseUrl || '').replace(/\/+$/, '');
    var state = {
      session: null,
      challengeId: '',
      catalog: defaultCatalog(),
      catalogId: '',
      revision: null,
      published: null,
      loaded: false,
      loading: false,
      busy: '',
      dirty: false,
      message: '',
      error: '',
      view: 'designs',
      selectedDesign: 0,
      selectedDenomination: 0,
      previewOpen: false
    };

    var tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'phab-admin-tab';
    tab.textContent = 'Сертификаты';
    tabs.insertBefore(tab, tabs.children[3] || null);

    var option = document.createElement('option');
    option.value = 'gift-certificates';
    option.textContent = 'Сертификаты';
    mobileSelect.insertBefore(option, mobileSelect.options[3] || null);

    var section = document.createElement('div');
    section.className = 'phab-admin-hidden';
    content.appendChild(section);

    function setSectionVisible(visible) {
      section.className = visible ? 'phab-gift-section' : 'phab-admin-hidden';
      tab.classList.toggle('phab-admin-tab-active', visible);
    }

    function activate() {
      mobileSelect.value = 'gift-certificates';
      mobileSelect.dispatchEvent(new Event('change', { bubbles: true }));
      setSectionVisible(true);
      void ensureLoaded();
    }

    tabs.addEventListener('click', function (event) {
      if (event.target !== tab) setSectionVisible(false);
    });
    mobileSelect.addEventListener('change', function () {
      var active = mobileSelect.value === 'gift-certificates';
      setSectionVisible(active);
      if (active) void ensureLoaded();
    });
    tab.addEventListener('click', activate);

    function validationIssues() {
      var catalog = state.catalog;
      var issues = [];
      if (!String(catalog.title || '').trim()) issues.push('Укажите заголовок витрины.');
      REQUIRED_STEPS.forEach(function (step) {
        if (catalog.flowSteps.indexOf(step) < 0) issues.push('Обязательный шаг: ' + step + '.');
      });
      if (!catalog.designs.some(function (item) { return item.active; })) {
        issues.push('Нужен хотя бы один активный дизайн.');
      }
      catalog.designs.forEach(function (item, index) {
        if (!/^[a-z][a-z0-9-]{1,62}$/.test(item.key)) issues.push('Проверьте ключ дизайна ' + (index + 1) + '.');
        if (!String(item.title || '').trim()) issues.push('Укажите название дизайна ' + (index + 1) + '.');
        if (!String(item.imageUrl || '').trim()) issues.push('Загрузите изображение дизайна ' + (index + 1) + '.');
        if (!String(item.alt || '').trim()) issues.push('Укажите alt-текст дизайна ' + (index + 1) + '.');
        if (['codeXPercent', 'codeYPercent', 'amountXPercent', 'amountYPercent'].some(function (field) {
          return !Number.isFinite(item[field]) || item[field] < 0 || item[field] > 100;
        })) issues.push('Координаты дизайна ' + (index + 1) + ' должны быть от 0 до 100%.');
      });
      if (!catalog.denominations.some(function (item) { return item.active; })) {
        issues.push('Нужен хотя бы один активный номинал.');
      }
      catalog.denominations.forEach(function (item, index) {
        if (!Number.isInteger(item.amountMinor) || item.amountMinor < 10000) {
          issues.push('Номинал ' + (index + 1) + ' должен быть не меньше 100 ₽.');
        }
      });
      if (!Number.isInteger(catalog.policy.validityDays) || catalog.policy.validityDays < 1) {
        issues.push('Проверьте срок действия.');
      }
      if (catalog.policy.validityStart === 'ACTIVATION' && !catalog.policy.activationDeadlineDays) {
        issues.push('Укажите срок активации.');
      }
      return issues;
    }

    function markDirty() {
      state.dirty = true;
      state.message = '';
      state.error = '';
      updateActionState();
    }

    function updateActionState() {
      var issues = validationIssues();
      var save = section.querySelector('[data-gift-save]');
      var publish = section.querySelector('[data-gift-publish]');
      var status = section.querySelector('[data-gift-validation]');
      if (save) save.disabled = Boolean(state.busy) || issues.length > 0;
      if (publish) {
        publish.disabled = Boolean(state.busy) || !state.catalogId || state.revision === null || state.dirty || issues.length > 0;
      }
      if (status) {
        status.textContent = state.error || state.message || (issues.length ? issues.join('\n') : 'Настройки готовы к сохранению.');
        status.className = 'phab-gift-note' + (state.error || issues.length ? ' error' : '');
      }
      var draftBadge = section.querySelector('[data-gift-draft-badge]');
      if (draftBadge) draftBadge.textContent = state.dirty ? 'Есть изменения' : 'Черновик сохранён';
    }

    function renderAuth() {
      section.innerHTML =
        '<div class="phab-gift-shell"><section class="phab-gift-card phab-gift-auth">' +
        '<h3>Подключение PadlHub Admin API</h3>' +
        '<p>Для управления сертификатами нужна отдельная операторская сессия с правами каталога.</p>' +
        '<div class="phab-gift-grid" style="margin-top:16px">' +
        '<label class="phab-gift-field phab-gift-wide">Номер телефона<input type="tel" placeholder="+7 999 000-00-01" data-gift-phone></label>' +
        (state.challengeId
          ? '<label class="phab-gift-field phab-gift-wide">Код<input type="text" inputmode="numeric" maxlength="4" placeholder="0000" data-gift-code></label>'
          : '') +
        '</div><div class="phab-gift-actions"><button class="phab-gift-btn" type="button" data-gift-login>' +
        (state.challengeId ? 'Войти' : 'Получить код') +
        '</button></div>' +
        '<div class="phab-gift-note' + (state.error ? ' error' : '') + '" style="margin-top:14px">' +
        escapeHtml(state.error || state.message || 'Введите телефон локального оператора.') +
        '</div></section></div>';
      section.querySelector('[data-gift-login]').addEventListener('click', function () {
        void login();
      });
    }

    function audienceLabel(value) {
      if (value === 'FOR_HER') return 'Для неё';
      if (value === 'FOR_HIM') return 'Для него';
      return 'Универсальный';
    }

    function mediaUrl(value) {
      var source = String(value || '');
      return source.charAt(0) === '/' ? mediaBaseUrl + source : source;
    }

    function designRowHtml(item, index) {
      var media = item.imageUrl
        ? '<img src="' + escapeHtml(mediaUrl(item.imageUrl)) + '" alt="">'
        : '<span class="phab-gift-row-thumb">Дизайн</span>';
      return '<button class="phab-gift-row' + (state.selectedDesign === index ? ' active' : '') + '" type="button" data-gift-select-design="' + index + '" data-gift-search-text="' + escapeHtml(String(item.title || '') + ' ' + String(item.key || '') + ' ' + audienceLabel(item.audience)) + '">' +
        media + '<span class="phab-gift-row-copy"><strong>' + escapeHtml(item.title || 'Без названия') + '</strong><span>' + escapeHtml(audienceLabel(item.audience)) + ' · порядок ' + Number(item.sortOrder || 0) + '</span></span>' +
        '<span class="phab-gift-row-state">' + (item.active ? '●' : '○') + '</span></button>';
    }

    function denominationRowHtml(item, index) {
      var amount = new Intl.NumberFormat('ru-RU').format(Number(item.amountMinor || 0) / 100) + ' ₽';
      return '<button class="phab-gift-row' + (state.selectedDenomination === index ? ' active' : '') + '" type="button" data-gift-select-denomination="' + index + '" data-gift-search-text="' + escapeHtml(amount) + '">' +
        '<span class="phab-gift-row-thumb">' + escapeHtml(amount) + '</span><span class="phab-gift-row-copy"><strong>' + escapeHtml(amount) + '</strong><span>RUB · порядок ' + Number(item.sortOrder || 0) + '</span></span>' +
        '<span class="phab-gift-row-state">' + (item.active ? '●' : '○') + '</span></button>';
    }

    function designHtml(item, index) {
      if (!item) return '<article class="phab-gift-editor phab-gift-card"><h3>Нет дизайнов</h3><p>Добавьте первый дизайн сертификата.</p></article>';
      var denomination = state.catalog.denominations.find(function (value) { return value.active; }) || state.catalog.denominations[0];
      var amount = denomination ? new Intl.NumberFormat('ru-RU').format(denomination.amountMinor / 100) + ' ₽' : '— ₽';
      var artworkStyle = item.imageUrl ? ' style="background-image:url(&quot;' + escapeHtml(mediaUrl(item.imageUrl)) + '&quot;)"' : '';
      return '<article class="phab-gift-editor phab-gift-card" data-gift-design="' + index + '">' +
        '<div class="phab-gift-card-head"><div><h3>Редактор дизайна</h3><p>Изменения применятся после сохранения черновика.</p></div></div>' +
        '<div class="phab-gift-grid">' +
        '<label class="phab-gift-field">Ключ<input value="' + escapeHtml(item.key) + '" data-design-field="key"></label>' +
        '<label class="phab-gift-field">Для кого<select data-design-field="audience">' +
        ['UNIVERSAL', 'FOR_HER', 'FOR_HIM'].map(function (value) {
          var label = value === 'FOR_HER' ? 'Для неё' : value === 'FOR_HIM' ? 'Для него' : 'Универсальный';
          return '<option value="' + value + '"' + (item.audience === value ? ' selected' : '') + '>' + label + '</option>';
        }).join('') + '</select></label>' +
        '<label class="phab-gift-field">Название<input value="' + escapeHtml(item.title) + '" data-design-field="title"></label>' +
        '<label class="phab-gift-field">Порядок<input type="number" min="0" max="999" value="' + Number(item.sortOrder || 0) + '" data-design-field="sortOrder"></label>' +
        '<label class="phab-gift-field phab-gift-wide">Изображение<input value="' + escapeHtml(item.imageUrl) + '" readonly data-design-field="imageUrl"></label>' +
        '<label class="phab-gift-field phab-gift-wide">JPEG, PNG или WebP<input type="file" accept="image/jpeg,image/png,image/webp" data-gift-upload="' + index + '"></label>' +
        '<label class="phab-gift-field phab-gift-wide">Alt-текст<input value="' + escapeHtml(item.alt) + '" data-design-field="alt"></label>' +
        '<label class="phab-gift-field">Код · X, %<input type="number" min="0" max="100" step="0.1" value="' + Number(item.codeXPercent) + '" data-design-field="codeXPercent"></label>' +
        '<label class="phab-gift-field">Код · Y, %<input type="number" min="0" max="100" step="0.1" value="' + Number(item.codeYPercent) + '" data-design-field="codeYPercent"></label>' +
        '<label class="phab-gift-field">Номинал · X, %<input type="number" min="0" max="100" step="0.1" value="' + Number(item.amountXPercent) + '" data-design-field="amountXPercent"></label>' +
        '<label class="phab-gift-field">Номинал · Y, %<input type="number" min="0" max="100" step="0.1" value="' + Number(item.amountYPercent) + '" data-design-field="amountYPercent"></label>' +
        '</div><div style="margin-top:16px"><div class="phab-gift-card-head"><div><h3>Положение на фоне</h3><p>Координаты отсчитываются от левого верхнего угла.</p></div></div><div class="phab-gift-certificate"' + artworkStyle + '><span class="phab-gift-certificate-code" data-gift-overlay="code" style="left:' + Number(item.codeXPercent) + '%;top:' + Number(item.codeYPercent) + '%;bottom:auto">FM15-NI*KZ4</span><span class="phab-gift-certificate-amount" data-gift-overlay="amount" style="left:' + Number(item.amountXPercent) + '%;top:' + Number(item.amountYPercent) + '%;right:auto;bottom:auto">' + escapeHtml(amount) + '</span></div></div><div class="phab-gift-actions">' +
        '<label class="phab-gift-check"><input type="checkbox" data-design-field="active"' + (item.active ? ' checked' : '') + '>Активен</label>' +
        '<button class="phab-gift-btn secondary" type="button" data-gift-remove-design="' + index + '">Удалить</button>' +
        '</div></article>';
    }

    function denominationHtml(item, index) {
      if (!item) return '<article class="phab-gift-editor phab-gift-card"><h3>Нет номиналов</h3><p>Добавьте первый доступный номинал.</p></article>';
      return '<article class="phab-gift-editor phab-gift-card" data-gift-denomination="' + index + '">' +
        '<div class="phab-gift-card-head"><div><h3>Редактор номинала</h3><p>Сумма повторно проверяется сервером при оформлении заказа.</p></div></div><div class="phab-gift-grid">' +
        '<label class="phab-gift-field">Номинал, ₽<input type="number" min="100" max="1000000" value="' + Number(item.amountMinor || 0) / 100 + '" data-denomination-field="amount"></label>' +
        '<label class="phab-gift-field">Порядок<input type="number" min="0" max="999" value="' + Number(item.sortOrder || 0) + '" data-denomination-field="sortOrder"></label>' +
        '</div><div class="phab-gift-actions"><label class="phab-gift-check"><input type="checkbox" data-denomination-field="active"' + (item.active ? ' checked' : '') + '>Активен</label>' +
        '<button class="phab-gift-btn secondary" type="button" data-gift-remove-denomination="' + index + '">Удалить</button></div></article>';
    }

    function renderEditor() {
      var catalog = state.catalog;
      state.selectedDesign = Math.max(0, Math.min(state.selectedDesign, Math.max(0, catalog.designs.length - 1)));
      state.selectedDenomination = Math.max(0, Math.min(state.selectedDenomination, Math.max(0, catalog.denominations.length - 1)));
      var previewDesign = catalog.designs[state.selectedDesign] || catalog.designs.find(function (item) { return item.active; }) || catalog.designs[0];
      var previewDenomination = catalog.denominations.find(function (item) { return item.active; }) || catalog.denominations[0];
      var previewStyle = previewDesign && previewDesign.imageUrl
        ? ' style="background-image:url(&quot;' + escapeHtml(mediaUrl(previewDesign.imageUrl)) + '&quot;)"'
        : '';
      var previewAmount = previewDenomination ? new Intl.NumberFormat('ru-RU').format(previewDenomination.amountMinor / 100) + ' ₽' : '— ₽';
      var previewCodeStyle = previewDesign ? ' style="left:' + Number(previewDesign.codeXPercent) + '%;top:' + Number(previewDesign.codeYPercent) + '%;bottom:auto"' : '';
      var previewAmountStyle = previewDesign ? ' style="left:' + Number(previewDesign.amountXPercent) + '%;top:' + Number(previewDesign.amountYPercent) + '%;right:auto;bottom:auto"' : '';
      var action = state.view === 'designs'
        ? '<button class="phab-gift-btn" type="button" data-gift-add-design>＋ Добавить дизайн</button>'
        : state.view === 'denominations'
          ? '<button class="phab-gift-btn" type="button" data-gift-add-denomination>＋ Добавить номинал</button>'
          : '';
      var managerContent = '';
      if (state.view === 'designs') {
        managerContent = '<div class="phab-gift-search"><span>⌕</span><input type="search" placeholder="Поиск по названию, ключу или аудитории" data-gift-search></div>' +
          '<div class="phab-gift-manager-grid"><div class="phab-gift-list">' + catalog.designs.map(designRowHtml).join('') + '</div>' +
          designHtml(catalog.designs[state.selectedDesign], state.selectedDesign) + '</div>';
      } else if (state.view === 'denominations') {
        managerContent = '<div class="phab-gift-search"><span>⌕</span><input type="search" placeholder="Поиск номинала" data-gift-search></div>' +
          '<div class="phab-gift-manager-grid"><div class="phab-gift-list">' + catalog.denominations.map(denominationRowHtml).join('') + '</div>' +
          denominationHtml(catalog.denominations[state.selectedDenomination], state.selectedDenomination) + '</div>';
      } else {
        managerContent = '<div class="phab-gift-settings">' +
          '<section class="phab-gift-card"><div class="phab-gift-card-head"><div><h3>Основные настройки</h3><p>На витрину попадает только опубликованная версия.</p></div></div>' +
          '<div class="phab-gift-grid"><label class="phab-gift-field phab-gift-wide">Заголовок витрины<input value="' + escapeHtml(catalog.title) + '" data-gift-field="title"></label>' +
          '<label class="phab-gift-field">Доступен с · ISO 8601<input value="' + escapeHtml(catalog.availableFrom || '') + '" placeholder="Без ограничения" data-gift-field="availableFrom"></label>' +
          '<label class="phab-gift-field">Доступен до · ISO 8601<input value="' + escapeHtml(catalog.availableTo || '') + '" placeholder="Без ограничения" data-gift-field="availableTo"></label>' +
          '<label class="phab-gift-check phab-gift-wide"><input type="checkbox" data-gift-field="publicEnabled"' + (catalog.publicEnabled ? ' checked' : '') + '>Показывать опубликованную версию на витрине</label></div></section>' +
          '<section class="phab-gift-card"><div class="phab-gift-card-head"><div><h3>Срок действия и доставка</h3><p>Правило фиксируется в версии каталога и сертификате.</p></div></div>' +
          '<div class="phab-gift-grid"><label class="phab-gift-field">Отсчёт срока<select data-policy-field="validityStart"><option value="ISSUE"' + (catalog.policy.validityStart === 'ISSUE' ? ' selected' : '') + '>С момента оплаты</option><option value="ACTIVATION"' + (catalog.policy.validityStart === 'ACTIVATION' ? ' selected' : '') + '>С момента активации</option></select></label>' +
          '<label class="phab-gift-field">Срок действия, дней<input type="number" min="1" max="3650" value="' + Number(catalog.policy.validityDays) + '" data-policy-field="validityDays"></label>' +
          (catalog.policy.validityStart === 'ACTIVATION' ? '<label class="phab-gift-field">Активировать в течение, дней<input type="number" min="1" max="3650" value="' + Number(catalog.policy.activationDeadlineDays || 90) + '" data-policy-field="activationDeadlineDays"></label>' : '') +
          '<label class="phab-gift-check"><input type="checkbox" data-policy-field="scheduledDeliveryEnabled"' + (catalog.policy.scheduledDeliveryEnabled ? ' checked' : '') + '>Разрешить отложенную доставку</label>' +
          '<label class="phab-gift-check"><input type="checkbox" data-policy-field="emailAttachmentEnabled"' + (catalog.policy.emailAttachmentEnabled ? ' checked' : '') + '>Прикладывать PDF к письму</label></div></section>' +
          '<section class="phab-gift-card"><div class="phab-gift-card-head"><div><h3>Структура оформления</h3><p>Дизайн, номинал и проверка заказа обязательны.</p></div></div><div class="phab-gift-flow">' +
          FLOW_STEPS.map(function (step) { return '<label class="phab-gift-check"><input type="checkbox" value="' + step[0] + '" data-gift-flow' + (catalog.flowSteps.indexOf(step[0]) >= 0 ? ' checked' : '') + (REQUIRED_STEPS.indexOf(step[0]) >= 0 ? ' disabled' : '') + '>' + step[1] + '</label>'; }).join('') +
          '</div></section></div>';
      }
      section.innerHTML =
        '<div class="phab-gift-shell"><header class="phab-gift-page-head"><div><h2>Подарочные сертификаты</h2><p>Управляйте дизайнами, номиналами и правилами витрины.</p></div><div class="phab-gift-toolbar">' +
        '<button class="phab-gift-btn secondary" type="button" data-gift-preview>◉ Предпросмотр</button>' +
        '<button class="phab-gift-btn secondary" type="button" data-gift-view="settings">⚙ Настройки</button>' + action + '</div></header>' +
        '<section class="phab-gift-card phab-gift-status"><span class="phab-gift-status-icon">✓</span><div class="phab-gift-status-copy"><strong>' +
        (state.published ? 'Витрина опубликована' : 'Витрина ещё не опубликована') + '</strong><span>' +
        (state.published ? 'Покупатели видят версию ' + Number(state.published.catalogNumber) + '. Сохраняйте изменения в черновик перед новой публикацией.' : 'Заполните каталог, сохраните черновик и опубликуйте первую версию.') +
        '</span></div><div class="phab-gift-badges"><span class="phab-gift-badge' + (state.published ? ' live' : '') + '">' +
        (state.published ? 'Опубликовано · v' + Number(state.published.catalogNumber) : 'Не опубликовано') + '</span><span class="phab-gift-badge" data-gift-draft-badge>' +
        (state.dirty ? 'Есть изменения' : 'Черновик сохранён') + '</span></div></section>' +
        '<section class="phab-gift-card phab-gift-manager"><div class="phab-gift-tabs">' +
        '<button class="phab-gift-tab' + (state.view === 'designs' ? ' active' : '') + '" type="button" data-gift-view="designs">Дизайны <strong>' + catalog.designs.length + '</strong></button>' +
        '<button class="phab-gift-tab' + (state.view === 'denominations' ? ' active' : '') + '" type="button" data-gift-view="denominations">Номиналы <strong>' + catalog.denominations.length + '</strong></button>' +
        '<button class="phab-gift-tab' + (state.view === 'settings' ? ' active' : '') + '" type="button" data-gift-view="settings">Настройки</button></div>' + managerContent + '</section>' +
        '<footer class="phab-gift-actionbar"><div class="phab-gift-note" data-gift-validation></div><div class="phab-gift-actions">' +
        '<button class="phab-gift-btn secondary" type="button" data-gift-save>Сохранить черновик</button><button class="phab-gift-btn" type="button" data-gift-publish>Опубликовать</button></div></footer>' +
        (state.previewOpen ? '<div class="phab-gift-modal" data-gift-close-preview><section class="phab-gift-modal-card" role="dialog" aria-modal="true" aria-label="Предпросмотр сертификата"><div class="phab-gift-card-head"><div><h3>Первая страница сертификата</h3><p>На готовый дизайн наносятся только код и номинал по координатам выбранного фона.</p></div><button class="phab-gift-btn secondary" type="button" data-gift-close-preview>Закрыть</button></div><div class="phab-gift-certificate"' + previewStyle + '><span class="phab-gift-certificate-code"' + previewCodeStyle + '>FM15-NI*KZ4</span><span class="phab-gift-certificate-amount"' + previewAmountStyle + '>' + escapeHtml(previewAmount) + '</span></div></section></div>' : '') +
        '</div>';
      bindEditor();
      updateActionState();
    }

    function bindEditor() {
      Array.prototype.slice.call(section.querySelectorAll('[data-gift-view]')).forEach(function (button) {
        button.addEventListener('click', function () {
          state.view = button.getAttribute('data-gift-view') || 'designs';
          state.previewOpen = false;
          renderEditor();
        });
      });
      Array.prototype.slice.call(section.querySelectorAll('[data-gift-select-design]')).forEach(function (button) {
        button.addEventListener('click', function () {
          state.selectedDesign = Number(button.getAttribute('data-gift-select-design'));
          renderEditor();
        });
      });
      Array.prototype.slice.call(section.querySelectorAll('[data-gift-select-denomination]')).forEach(function (button) {
        button.addEventListener('click', function () {
          state.selectedDenomination = Number(button.getAttribute('data-gift-select-denomination'));
          renderEditor();
        });
      });
      var search = section.querySelector('[data-gift-search]');
      if (search) search.addEventListener('input', function () {
        var query = String(search.value || '').trim().toLocaleLowerCase('ru-RU');
        Array.prototype.slice.call(section.querySelectorAll('.phab-gift-row')).forEach(function (row) {
          row.style.display = String(row.getAttribute('data-gift-search-text') || '').toLocaleLowerCase('ru-RU').indexOf(query) >= 0 ? '' : 'none';
        });
      });
      var preview = section.querySelector('[data-gift-preview]');
      if (preview) preview.addEventListener('click', function () {
        state.previewOpen = true;
        renderEditor();
      });
      Array.prototype.slice.call(section.querySelectorAll('[data-gift-close-preview]')).forEach(function (element) {
        element.addEventListener('click', function (event) {
          if (event.target !== element) return;
          state.previewOpen = false;
          renderEditor();
        });
      });
      Array.prototype.slice.call(section.querySelectorAll('[data-gift-field]')).forEach(function (element) {
        element.addEventListener('change', function () {
          var field = element.getAttribute('data-gift-field');
          state.catalog[field] = element.type === 'checkbox' ? element.checked : (String(element.value || '').trim() || null);
          markDirty();
        });
      });
      Array.prototype.slice.call(section.querySelectorAll('[data-policy-field]')).forEach(function (element) {
        element.addEventListener('change', function () {
          var field = element.getAttribute('data-policy-field');
          if (element.type === 'checkbox') state.catalog.policy[field] = element.checked;
          else if (field === 'validityStart') {
            state.catalog.policy.validityStart = element.value;
            state.catalog.policy.activationDeadlineDays = element.value === 'ACTIVATION' ? 90 : null;
            markDirty();
            renderEditor();
            return;
          } else state.catalog.policy[field] = Number(element.value);
          markDirty();
        });
      });
      Array.prototype.slice.call(section.querySelectorAll('[data-gift-flow]')).forEach(function (element) {
        element.addEventListener('change', function () {
          state.catalog.flowSteps = FLOW_STEPS.filter(function (step) {
            return REQUIRED_STEPS.indexOf(step[0]) >= 0 || Boolean(section.querySelector('[data-gift-flow][value="' + step[0] + '"]:checked'));
          }).map(function (step) { return step[0]; });
          markDirty();
        });
      });
      Array.prototype.slice.call(section.querySelectorAll('[data-gift-design]')).forEach(function (card) {
        var index = Number(card.getAttribute('data-gift-design'));
        Array.prototype.slice.call(card.querySelectorAll('[data-design-field]')).forEach(function (element) {
          if (element.getAttribute('data-design-field') === 'imageUrl') return;
          element.addEventListener(/Percent$/.test(element.getAttribute('data-design-field')) ? 'input' : 'change', function () {
            var field = element.getAttribute('data-design-field');
            state.catalog.designs[index][field] = element.type === 'checkbox'
              ? element.checked
              : field === 'sortOrder' || /Percent$/.test(field) ? Number(element.value) : String(element.value || '');
            if (/Percent$/.test(field)) {
              var target = card.querySelector('[data-gift-overlay="' + (field.indexOf('code') === 0 ? 'code' : 'amount') + '"]');
              if (target) target.style[field.indexOf('XPercent') > 0 ? 'left' : 'top'] = Number(element.value) + '%';
            }
            markDirty();
          });
        });
      });
      Array.prototype.slice.call(section.querySelectorAll('[data-gift-denomination]')).forEach(function (card) {
        var index = Number(card.getAttribute('data-gift-denomination'));
        Array.prototype.slice.call(card.querySelectorAll('[data-denomination-field]')).forEach(function (element) {
          element.addEventListener('change', function () {
            var field = element.getAttribute('data-denomination-field');
            if (field === 'active') state.catalog.denominations[index].active = element.checked;
            else if (field === 'amount') state.catalog.denominations[index].amountMinor = Math.round(Number(element.value) * 100);
            else state.catalog.denominations[index].sortOrder = Number(element.value);
            markDirty();
          });
        });
      });
      var addDesign = section.querySelector('[data-gift-add-design]');
      if (addDesign) addDesign.addEventListener('click', function () {
        state.catalog.designs.push({ key: 'design-' + (state.catalog.designs.length + 1), audience: 'UNIVERSAL', title: 'Новый дизайн', description: null, imageUrl: '', alt: 'Подарочный сертификат ПаделХАБ', codeXPercent: 5.1, codeYPercent: 88, amountXPercent: 78.3, amountYPercent: 88, active: false, sortOrder: (state.catalog.designs.length + 1) * 10 });
        state.selectedDesign = state.catalog.designs.length - 1;
        markDirty();
        renderEditor();
      });
      var addDenomination = section.querySelector('[data-gift-add-denomination]');
      if (addDenomination) addDenomination.addEventListener('click', function () {
        state.catalog.denominations.push({ amountMinor: 100000, currency: 'RUB', active: false, sortOrder: (state.catalog.denominations.length + 1) * 10 });
        state.selectedDenomination = state.catalog.denominations.length - 1;
        markDirty();
        renderEditor();
      });
      Array.prototype.slice.call(section.querySelectorAll('[data-gift-remove-design]')).forEach(function (button) {
        button.addEventListener('click', function () {
          state.catalog.designs.splice(Number(button.getAttribute('data-gift-remove-design')), 1);
          state.selectedDesign = Math.max(0, state.selectedDesign - 1);
          markDirty();
          renderEditor();
        });
      });
      Array.prototype.slice.call(section.querySelectorAll('[data-gift-remove-denomination]')).forEach(function (button) {
        button.addEventListener('click', function () {
          state.catalog.denominations.splice(Number(button.getAttribute('data-gift-remove-denomination')), 1);
          state.selectedDenomination = Math.max(0, state.selectedDenomination - 1);
          markDirty();
          renderEditor();
        });
      });
      Array.prototype.slice.call(section.querySelectorAll('[data-gift-upload]')).forEach(function (input) {
        input.addEventListener('change', function () {
          var file = input.files && input.files[0];
          if (file) void upload(Number(input.getAttribute('data-gift-upload')), file);
        });
      });
      var saveButton = section.querySelector('[data-gift-save]');
      var publishButton = section.querySelector('[data-gift-publish]');
      if (saveButton) saveButton.addEventListener('click', function () { void save(); });
      if (publishButton) publishButton.addEventListener('click', function () { void publish(); });
    }

    async function login() {
      state.error = '';
      try {
        if (!state.challengeId) {
          var phone = String(section.querySelector('[data-gift-phone]').value || '').trim();
          if (!phone) throw new Error('Введите номер телефона.');
          var challenge = await api.requestCode(phone);
          state.challengeId = String(challenge.challengeId || '');
          state.message = 'Код подготовлен. Введите четыре цифры.';
          renderAuth();
          return;
        }
        var code = String(section.querySelector('[data-gift-code]').value || '').replace(/\D/g, '').slice(0, 4);
        if (code.length !== 4) throw new Error('Введите код из четырёх цифр.');
        state.session = await api.verifyCode(state.challengeId, code);
        state.challengeId = '';
        await loadCatalog();
      } catch (error) {
        state.error = error && error.message ? error.message : 'Не удалось войти.';
        renderAuth();
      }
    }

    async function loadCatalog() {
      state.loading = true;
      state.error = '';
      try {
        var response = await api.getCatalog();
        var source = response.draft || response.published;
        state.catalog = source ? toInput(source) : defaultCatalog();
        state.catalogId = response.draft ? String(response.draft.id) : '';
        state.revision = response.draft ? Number(response.draft.revision) : null;
        state.published = response.published || null;
        state.dirty = !source;
        state.loaded = true;
        state.message = source ? 'Каталог загружен.' : 'Создан новый локальный черновик.';
        renderEditor();
      } catch (error) {
        if (error && (error.status === 401 || error.status === 403)) {
          state.session = null;
          state.error = error.message || 'Недостаточно прав для каталога сертификатов.';
          renderAuth();
          return;
        }
        state.error = error && error.message ? error.message : 'Не удалось загрузить каталог.';
        state.loaded = true;
        renderEditor();
      } finally {
        state.loading = false;
      }
    }

    async function ensureLoaded() {
      if (state.loading || state.loaded) return;
      section.innerHTML = '<div class="phab-gift-shell"><div class="phab-gift-note">Подключаем PadlHub Admin API…</div></div>';
      try {
        state.session = await api.restoreSession();
        if (!state.session) {
          renderAuth();
          return;
        }
        await loadCatalog();
      } catch (error) {
        state.error = error && error.message ? error.message : 'PadlHub Admin API недоступен.';
        renderAuth();
      }
    }

    async function upload(index, file) {
      state.busy = 'upload';
      state.error = '';
      state.message = 'Загружаем изображение…';
      updateActionState();
      try {
        var result = await api.uploadMedia(file);
        state.catalog.designs[index].imageUrl = String(result.mediaUrl || '');
        state.dirty = true;
        state.message = 'Изображение загружено в PadlHub.';
        renderEditor();
      } catch (error) {
        state.error = error && error.message ? error.message : 'Не удалось загрузить изображение.';
        updateActionState();
      } finally {
        state.busy = '';
        updateActionState();
      }
    }

    async function save() {
      if (validationIssues().length) return;
      state.busy = 'save';
      state.error = '';
      state.message = 'Сохраняем черновик…';
      updateActionState();
      try {
        var saved = await api.saveDraft(state.revision, state.catalog);
        state.catalog = toInput(saved);
        state.catalogId = String(saved.id);
        state.revision = Number(saved.revision);
        state.dirty = false;
        state.message = saved.replayed ? 'Черновик уже был сохранён.' : 'Черновик сохранён.';
        renderEditor();
      } catch (error) {
        state.error = error && error.message ? error.message : 'Не удалось сохранить черновик.';
      } finally {
        state.busy = '';
        updateActionState();
      }
    }

    async function publish() {
      if (!state.catalogId || state.revision === null || state.dirty) return;
      state.busy = 'publish';
      state.error = '';
      state.message = 'Публикуем витрину…';
      updateActionState();
      try {
        var published = await api.publish(state.catalogId, state.revision);
        state.published = published;
        state.catalog = toInput(published);
        state.catalogId = '';
        state.revision = null;
        state.dirty = false;
        state.message = 'Витрина опубликована.';
        renderEditor();
      } catch (error) {
        state.error = error && error.message ? error.message : 'Не удалось опубликовать витрину.';
      } finally {
        state.busy = '';
        updateActionState();
      }
    }
  }

  global.PHABGiftCertificatesAdmin = { mount: mount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})(window);
