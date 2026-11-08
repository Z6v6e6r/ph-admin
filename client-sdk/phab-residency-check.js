/**
 * Mobile resident check screen for CUP staff (/api/ui/admin/residency/check).
 *
 * Final contract: the served page is a thin staff-authorized shell; this script
 * talks to the resident-services admin API (D) on the same origin.
 * - Staff authorization happens on the server page route before this script
 *   runs; the page config carries the verified station scope and permissions.
 * - The pass token arrives in the URL fragment (#pass=<rsp1_...>), which is
 *   never sent to a server. The script reads it once, immediately clears it from
 *   the address bar with history.replaceState, keeps it only in memory and
 *   sends it in request bodies.
 * - Pass preview is a POST with {token, stationId}; the resident photo/name come
 *   from the E profile endpoint (also a POST, verified server-side against the
 *   same pass) and are merged client-side.
 * - Issuance is a critical command: exactly one Idempotency-Key per issuance
 *   intent, the same key and body are reused for a manual retry, and a new
 *   selection creates a new intent (and therefore a new key).
 * - Success renders only after HTTP 2xx with response.issuanceId; a return
 *   confirms only after 2xx with response.returnId.
 * - demoMode uses deterministic local data and never touches the network.
 * - The pass token, photo URL and resident data are never written to storage,
 *   console or analytics. Only an unresolved issuance attempt is marked in
 *   sessionStorage (Idempotency-Key, station, pass expiry) so a full reload
 *   resolves that exact attempt read-only before any new issuance.
 */
(function () {
  'use strict';

  var CONFIG_VERSION = 'rsp1_';
  var RESIDENT_PASS_TOKEN_PATTERN = /^rsp1_[A-Za-z0-9_-]{32,64}$/;
  var REQUEST_TIMEOUT_MS = 15000;
  var JOURNAL_LIMIT = 10;
  var MAX_PASS_TOKEN_LENGTH = 512;
  var PERMISSION_ISSUE = 'resident-services:issue';
  var PERMISSION_RETURN = 'resident-services:return';
  var PERMISSION_READ = 'resident-services:read';
  var MONTHS_GENITIVE = [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря'
  ];

  var ERROR_COPY = {
    RESIDENT_PASS_NOT_FOUND: 'Пропуск не найден. Проверьте QR-код или обратитесь в ЦУП.',
    RESIDENT_PASS_INVALID: 'Пропуск недействителен. Проверьте QR-код или обратитесь в ЦУП.',
    RESIDENT_PASS_EXPIRED: 'QR-код клиента истёк. Попросите клиента показать новый QR и отсканируйте его.',
    RESIDENT_PASS_ALREADY_USED: 'Пропуск уже использован. Обратитесь в ЦУП.',
    RESIDENT_NOT_ACTIVE: 'Резидент не активен. Обратитесь в ЦУП.',
    RESIDENT_TERM_EXPIRED: 'Срок резидентства истёк. Обратитесь в ЦУП.',
    RESIDENT_STATION_REQUIRED: 'Выберите станцию и повторите действие.',
    RESIDENT_STATION_FORBIDDEN: 'Нет доступа к станции резидента. Обратитесь к администратору ЦУП.',
    RESIDENT_SERVICE_NOT_CONFIGURED: 'Услуга не настроена. Повторите проверку позже.',
    RESIDENT_SERVICE_LIMIT_EXCEEDED: 'Превышен лимит услуги. Обновите данные пропуска и выберите меньшее количество.',
    RESIDENT_SERVICES_IDEMPOTENCY_CONFLICT: 'Этот идентификатор операции уже использован для другой выдачи. Проверьте журнал и начните заново.',
    RESIDENT_SERVICES_IDEMPOTENCY_KEY_INVALID: 'Некорректный идентификатор операции. Начните выдачу заново.',
    RESIDENT_ISSUANCE_NOT_FOUND: 'Выдача не найдена. Обновите журнал.',
    RESIDENT_SERVICES_DISABLED: 'Раздел выдачи услуг резидентам выключен.',
    RESIDENT_SERVICES_PERSISTENCE_UNAVAILABLE: 'Не удалось сохранить операцию. Повторите позже.',
    RESIDENT_SERVICES_NOT_CONFIGURED: 'Выдача услуг временно недоступна: раздел не настроен.'
  };

  var STATUS_CLASS = {
    ACTIVE: 'phab-rc-status-active',
    EXPIRING: 'phab-rc-status-expiring',
    EXPIRED: 'phab-rc-status-expired',
    SUSPENDED: 'phab-rc-status-suspended',
    NONE: 'phab-rc-status-none'
  };

  var passTokenState = { loaded: false, value: '' };

  var state = {
    started: false,
    phase: 'loading',
    preview: null,
    profile: null,
    profileError: '',
    loadError: '',
    commandError: '',
    unknownError: '',
    statusMessage: '',
    stationId: '',
    pendingStationId: '',
    stationInput: null,
    stationContinue: null,
    selection: {},
    serviceRows: {},
    confirmButton: null,
    confirmCount: null,
    issueIntent: null,
    issueResult: null,
    successIssuanceItems: null,
    returnTarget: null,
    returnQuantity: 1,
    returnIntent: null,
    returnBusy: false,
    returnError: '',
    returnCompleted: null,
    returnQuantityEl: null,
    returnSubmit: null,
    returnMinus: null,
    returnPlus: null,
    journalOpen: false,
    journalLoading: false,
    journalReturnLoading: false,
    journalIssuanceSnapshots: {},
    contextRevision: 0,
    journal: null,
    journalError: '',
    demoJournal: null,
    demoIssuances: {},
    demoSequence: 0,
    demoReturnSequence: 0,
    busy: false,
    recovery: null,
    pendingFocus: ''
  };

  function text(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function node(tagName, className, label) {
    var element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (label !== undefined && label !== null) {
      element.textContent = text(label);
    }
    return element;
  }

  function button(label, onClick, extraClass) {
    var element = node('button', 'phab-rc-button' + (extraClass ? ' ' + extraClass : ''), label);
    element.setAttribute('type', 'button');
    if (typeof onClick === 'function') {
      element.addEventListener('click', onClick);
    }
    return element;
  }

  function clear(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function mountNode() {
    return document.getElementById('phab-residency-check-root');
  }

  function setStatus(message) {
    state.statusMessage = text(message);
    var live = document.getElementById('phab-rc-status');
    if (live) {
      live.textContent = state.statusMessage;
    }
  }

  function readConfig() {
    var config = window.__PHAB_RESIDENCY_CHECK_CONFIG__;
    return config && typeof config === 'object' ? config : {};
  }

  /**
   * Reads the token from the URL fragment only. A query-string token would land
   * in nginx access logs, browser history and Referer headers, so it is never
   * accepted here.
   */
  function readFragmentPassToken() {
    var fragment = '';
    try {
      fragment = typeof window.location.hash === 'string' ? window.location.hash : '';
    } catch (_error) {
      fragment = '';
    }
    var normalized = fragment.charAt(0) === '#' ? fragment.slice(1) : fragment;
    var raw = '';
    if (normalized.indexOf('pass=') === 0) {
      raw = normalized.slice('pass='.length);
    } else if (normalized.indexOf('token=') === 0) {
      raw = normalized.slice('token='.length);
    }
    var value = '';
    if (raw) {
      try {
        value = decodeURIComponent(raw);
      } catch (_error) {
        value = raw;
      }
      value = value.trim();
    }
    if (
      !value ||
      value.length > MAX_PASS_TOKEN_LENGTH ||
      !RESIDENT_PASS_TOKEN_PATTERN.test(value)
    ) {
      return '';
    }
    return value;
  }

  /** Rewrites the address bar without the fragment so the token does not persist. */
  function clearLocationFragment() {
    try {
      if (!window.location.hash) {
        return;
      }
      if (window.history && typeof window.history.replaceState === 'function') {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    } catch (_error) {
      // A blocked history API must not break the resident check.
    }
  }

  /** Read-once accessor: the fragment token is captured and cleared on first use. */
  function passToken() {
    if (!passTokenState.loaded) {
      passTokenState.loaded = true;
      passTokenState.value = readFragmentPassToken();
      clearLocationFragment();
    }
    return passTokenState.value;
  }

  function stringList(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map(function (entry) {
        return text(entry).trim();
      })
      .filter(function (entry) {
        return entry.length > 0;
      });
  }

  /** Empty list means the staff user has a global station scope. */
  function allowedStationIds() {
    return stringList(readConfig().allowedStationIds);
  }

  function defaultStationId() {
    var value = readConfig().defaultStationId;
    return typeof value === 'string' ? value.trim() : '';
  }

  function stationLabels() {
    var labels = readConfig().stationLabels;
    return labels && typeof labels === 'object' && !Array.isArray(labels) ? labels : {};
  }

  function stationLabel(stationId) {
    var raw = text(stationId).trim();
    if (!raw) {
      return 'Станция не указана';
    }
    return text(stationLabels()[raw]) || raw;
  }

  function permissions() {
    return stringList(readConfig().permissions);
  }

  function hasPermission(permission) {
    var list = permissions();
    return list.indexOf('*') !== -1 || list.indexOf(permission) !== -1;
  }

  function demoMode() {
    return readConfig().demoMode === true;
  }

  function apiBase() {
    var base = text(readConfig().apiBase).trim() || '/api';
    if (base.charAt(base.length - 1) === '/') {
      return base.slice(0, -1);
    }
    return base;
  }

  function apiUrl(path) {
    return apiBase() + path;
  }

  /** One key per command intent; crypto.randomUUID with a bounded fallback. */
  function newIdempotencyKey() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (_error) {
      // fall through to the fallback generator
    }
    var random = '';
    try {
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        var bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        for (var index = 0; index < bytes.length; index++) {
          random += ('0' + bytes[index].toString(16)).slice(-2);
        }
      }
    } catch (_error) {
      random = '';
    }
    if (!random) {
      random = Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    }
    return random;
  }

  function newCorrelationId() {
    return newIdempotencyKey();
  }

  /*
   * Unresolved-issuance marker for recovery after a full page reload.
   * Stores only the Idempotency-Key of the caller's own attempt, the station and
   * the pass expiry: never the pass token, a Bearer, the photo or resident data.
   * The key alone cannot replay an issuance (the server binds the request hash
   * to the token) and is resolvable only by the same staff actor.
   */
  var PENDING_ISSUE_STORAGE_KEY = 'phab.residency.pendingIssue.v1';
  var PENDING_ISSUE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
  // A pass that expired this long ago can no longer be committed by an in-flight
  // transaction, so "not found" becomes a definitive "not saved".
  var PENDING_ISSUE_SETTLE_MS = 90 * 1000;

  function pendingStorage() {
    try {
      return window.sessionStorage || null;
    } catch (_error) {
      return null;
    }
  }

  function writePendingIssue(intent) {
    var storage = pendingStorage();
    if (!storage || !intent || demoMode()) {
      return;
    }
    try {
      storage.setItem(
        PENDING_ISSUE_STORAGE_KEY,
        JSON.stringify({
          v: 1,
          key: intent.key,
          stationId: text(intent.body && intent.body.stationId),
          passExpiresAt: text(intent.passExpiresAt),
          createdAt: new Date().toISOString()
        })
      );
    } catch (_error) {
      // Storage may be blocked; in-memory retry still works on this page.
    }
  }

  function clearPendingIssue() {
    var storage = pendingStorage();
    if (!storage) {
      return;
    }
    try {
      storage.removeItem(PENDING_ISSUE_STORAGE_KEY);
    } catch (_error) {
      // ignore
    }
  }

  function readPendingIssue() {
    var storage = pendingStorage();
    if (!storage || demoMode()) {
      return null;
    }
    var raw = null;
    try {
      raw = storage.getItem(PENDING_ISSUE_STORAGE_KEY);
    } catch (_error) {
      return null;
    }
    if (!raw) {
      return null;
    }
    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (_error) {
      parsed = null;
    }
    var createdAt = parsed ? Date.parse(text(parsed.createdAt)) : NaN;
    if (
      !parsed ||
      parsed.v !== 1 ||
      typeof parsed.key !== 'string' ||
      parsed.key.length < 16 ||
      parsed.key.length > 128 ||
      !Number.isFinite(createdAt) ||
      Date.now() - createdAt > PENDING_ISSUE_MAX_AGE_MS
    ) {
      clearPendingIssue();
      return null;
    }
    return {
      key: parsed.key,
      stationId: text(parsed.stationId).trim(),
      passExpiresAt: text(parsed.passExpiresAt),
      createdAt: text(parsed.createdAt)
    };
  }

  /** True when the pass behind an unresolved attempt can no longer commit. */
  function pendingIssueSettled(marker) {
    var expiresAt = Date.parse(text(marker && marker.passExpiresAt));
    var createdAt = Date.parse(text(marker && marker.createdAt));
    // Without a known expiry fall back to the server's maximum pass TTL (120s).
    var deadline = Number.isFinite(expiresAt) ? expiresAt : createdAt + 120 * 1000;
    return Number.isFinite(deadline) && Date.now() > deadline + PENDING_ISSUE_SETTLE_MS;
  }

  function readCorrelationId(response) {
    try {
      if (response && response.headers && typeof response.headers.get === 'function') {
        return text(response.headers.get('X-Correlation-ID'));
      }
    } catch (_error) {
      return '';
    }
    return '';
  }

  /** Same-origin credentialed request with an explicit 15s abort timeout. */
  async function request(path, options) {
    var init = options || {};
    init.credentials = 'same-origin';
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = 0;
    if (controller) {
      init.signal = controller.signal;
      timer = window.setTimeout(function () {
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
    }
    try {
      var response = await window.fetch(path, init);
      var raw = await response.text();
      var body = null;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch (_parseError) {
          body = null;
        }
      }
      return {
        ok: response.ok,
        status: response.status,
        body: body,
        correlationId: readCorrelationId(response),
        network: false
      };
    } catch (_error) {
      return {
        ok: false,
        status: 0,
        body: null,
        correlationId: '',
        network: true
      };
    } finally {
      if (timer) {
        window.clearTimeout(timer);
      }
    }
  }

  function mutationHeaders(intentKey) {
    var headers = {
      'Content-Type': 'application/json',
      'X-Correlation-ID': newCorrelationId()
    };
    if (intentKey) {
      headers['Idempotency-Key'] = intentKey;
    }
    return headers;
  }

  /** Stable error code from { code }, { error: { code } } or { message: { code } }. */
  function readErrorCode(outcome) {
    var body = outcome ? outcome.body : null;
    if (!body || typeof body !== 'object') {
      return '';
    }
    if (typeof body.code === 'string' && body.code) {
      return body.code;
    }
    if (body.error && typeof body.error.code === 'string' && body.error.code) {
      return body.error.code;
    }
    if (body.message && typeof body.message === 'object' && typeof body.message.code === 'string' && body.message.code) {
      return body.message.code;
    }
    return '';
  }

  function shortId(value) {
    var raw = text(value);
    if (!raw) {
      return '—';
    }
    return raw.length > 8 ? raw.slice(0, 8) : raw;
  }

  function errorMessage(outcome) {
    var code = readErrorCode(outcome);
    if (code && ERROR_COPY[code]) {
      return ERROR_COPY[code];
    }
    if (outcome && outcome.network) {
      return 'Нет связи с сервером. Проверьте интернет-соединение и повторите действие.';
    }
    var status = outcome ? Number(outcome.status) || 0 : 0;
    var correlation = outcome && outcome.correlationId ? ' Идентификатор обращения: ' + shortId(outcome.correlationId) + '.' : '';
    if (status === 401) {
      return 'Сессия истекла. Войдите в ЦУП заново и повторите проверку.';
    }
    if (status === 403) {
      return 'Нет доступа к станции резидента или разделу проверки. Обратитесь к администратору ЦУП.';
    }
    if (code) {
      return 'Не удалось выполнить операцию. Код: ' + code + '.' + correlation;
    }
    if (status) {
      return 'Не удалось выполнить операцию (HTTP ' + status + ').' + correlation;
    }
    return 'Не удалось выполнить операцию. Повторите позже.';
  }

  function staticBlockerReason(blocker) {
    var code = text(blocker);
    if (!code) {
      return '';
    }
    return ERROR_COPY[code] || 'Недоступно по правилам выдачи.';
  }

  function safePhotoUrl(value) {
    var url = text(value).trim();
    if (!url) {
      return '';
    }
    if (url.charAt(0) === '/') {
      return url.charAt(1) === '/' ? '' : url;
    }
    if (/^https:\/\//i.test(url)) {
      return url;
    }
    if (/^data:image\/svg\+xml[;,]/i.test(url)) {
      return url;
    }
    return '';
  }

  function initials(value) {
    var parts = text(value)
      .trim()
      .split(/\s+/)
      .filter(function (part) {
        return part.length > 0;
      })
      .slice(0, 2);
    var letters = parts
      .map(function (part) {
        return part.charAt(0).toUpperCase();
      })
      .join('');
    return letters || '?';
  }

  function photoFallbackElement(fullName) {
    var fallback = node('div', 'phab-rc-photo phab-rc-photo-fallback');
    fallback.textContent = initials(fullName);
    fallback.setAttribute('aria-hidden', 'true');
    return fallback;
  }

  /** Large photo; a null/failed image falls back to initials, never to a blank box. */
  function photoElement(fullName, photoUrl) {
    var url = safePhotoUrl(photoUrl);
    if (!url) {
      return photoFallbackElement(fullName);
    }
    var image = node('img', 'phab-rc-photo');
    image.setAttribute('alt', 'Фото резидента');
    image.setAttribute('decoding', 'async');
    image.addEventListener('error', function () {
      if (image.parentNode) {
        image.parentNode.replaceChild(photoFallbackElement(fullName), image);
      }
    });
    image.setAttribute('src', url);
    return image;
  }

  function formatDateTime(value) {
    var raw = text(value);
    if (!raw) {
      return '—';
    }
    var date = new Date(raw);
    if (isNaN(date.getTime())) {
      return raw;
    }
    try {
      return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_error) {
      return raw;
    }
  }

  function formatTermDate(value) {
    var date = new Date(text(value));
    if (isNaN(date.getTime())) {
      return '';
    }
    return date.getDate() + ' ' + MONTHS_GENITIVE[date.getMonth()] + ' ' + date.getFullYear();
  }

  /** Status/term are derived from the resident activeTo timestamp. */
  function deriveResidency(preview) {
    var resident = preview && preview.resident ? preview.resident : {};
    var activeFrom = text(resident.activeFrom) || null;
    var activeTo = text(resident.activeTo) || null;
    var date = activeTo ? new Date(activeTo) : null;
    var valid = Boolean(date && !isNaN(date.getTime()));
    var status = 'ACTIVE';
    var statusLabel = 'Активно';
    if (valid) {
      var remainingMs = date.getTime() - Date.now();
      if (remainingMs < 0) {
        status = 'EXPIRED';
        statusLabel = 'Истёк';
      } else if (remainingMs <= 14 * 24 * 60 * 60 * 1000) {
        status = 'EXPIRING';
        statusLabel = 'Истекает';
      }
    }
    return {
      status: status,
      statusLabel: statusLabel,
      activeFrom: activeFrom,
      activeTo: activeTo,
      termLabel: valid ? 'до ' + formatTermDate(activeTo) : 'Срок не указан'
    };
  }

  function statusPill(residency) {
    return node(
      'span',
      'phab-rc-pill ' + (STATUS_CLASS[residency.status] || STATUS_CLASS.NONE),
      residency.statusLabel
    );
  }

  function headingNode(level, className, label, autofocus) {
    var heading = node(level, className, label);
    heading.setAttribute('tabindex', '-1');
    if (autofocus) {
      heading.setAttribute('data-autofocus', '');
    }
    return heading;
  }

  function applyPendingFocus() {
    if (!state.pendingFocus) {
      return;
    }
    state.pendingFocus = '';
    var mount = mountNode();
    var target = mount ? mount.querySelector('[data-autofocus]') : null;
    if (target && typeof target.focus === 'function') {
      try {
        target.focus();
      } catch (_error) {
        // focus is best effort
      }
    }
  }

  function permissionNotice(message) {
    return node('p', 'phab-rc-permission-notice', message);
  }

  function errorCard(title, message, options) {
    var settings = options || {};
    var card = node('section', 'phab-rc-card phab-rc-error');
    card.appendChild(headingNode('h2', 'phab-rc-card-title', title, Boolean(settings.autofocus)));
    card.appendChild(node('p', 'phab-rc-card-text', message));
    if (settings.retryLabel && typeof settings.onRetry === 'function') {
      card.appendChild(button(settings.retryLabel, settings.onRetry, 'phab-rc-button-secondary'));
    }
    if (settings.changeStationLabel && typeof settings.onChangeStation === 'function') {
      card.appendChild(button(settings.changeStationLabel, settings.onChangeStation, 'phab-rc-button-secondary'));
    }
    return card;
  }

  function loadingCard() {
    var card = node('div', 'phab-rc-loading');
    card.setAttribute('aria-busy', 'true');
    card.appendChild(node('p', 'phab-rc-loading-text', 'Проверяем пропуск…'));
    return card;
  }

  function syncStationUi() {
    var pending = text(state.pendingStationId).trim();
    if (state.stationContinue) {
      state.stationContinue.disabled = !pending;
    }
    setStatus(pending ? 'Станция выбрана: ' + stationLabel(pending) : 'Выберите станцию.');
  }

  function chooseStation(stationId) {
    var value = text(stationId).trim();
    if (!value) {
      setStatus('Выберите станцию.');
      return;
    }
    state.stationId = value;
    void loadCheck();
  }

  function showStationPhase() {
    state.phase = 'station';
    state.pendingStationId = state.stationId;
    state.pendingFocus = 'station';
    state.statusMessage = '';
    render();
  }

  function stationCard() {
    var allowed = allowedStationIds();
    var card = node('section', 'phab-rc-card phab-rc-station-card');
    card.appendChild(headingNode('h1', 'phab-rc-card-title', 'Выберите станцию', state.pendingFocus === 'station'));
    card.appendChild(
      node(
        'p',
        'phab-rc-card-text',
        allowed.length > 0
          ? 'Проверка относится к одной станции. Выберите её, чтобы запросить данные пропуска.'
          : 'Укажите станцию, к которой относится проверка.'
      )
    );

    state.stationInput = null;
    state.stationContinue = null;

    if (allowed.length > 0) {
      var group = node('div', 'phab-rc-station-options');
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', 'Станции');
      allowed.forEach(function (stationId) {
        var option = node('label', 'phab-rc-station-option');
        var radio = node('input', 'phab-rc-station-radio');
        radio.setAttribute('type', 'radio');
        radio.setAttribute('name', 'phab-rc-station');
        radio.setAttribute('value', stationId);
        radio.checked = state.pendingStationId === stationId;
        radio.addEventListener('change', function () {
          if (radio.checked) {
            state.pendingStationId = stationId;
            syncStationUi();
          }
        });
        option.appendChild(radio);
        option.appendChild(node('span', 'phab-rc-station-name', stationLabel(stationId)));
        group.appendChild(option);
      });
      card.appendChild(group);
    } else {
      var fieldLabel = node('label', 'phab-rc-station-field-label', 'Станция');
      fieldLabel.setAttribute('for', 'phab-rc-station-input');
      var input = node('input', 'phab-rc-station-input');
      input.id = 'phab-rc-station-input';
      input.setAttribute('type', 'text');
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('maxlength', '120');
      input.value = state.pendingStationId;
      input.addEventListener('input', function () {
        state.pendingStationId = input.value.trim();
        syncStationUi();
      });
      card.appendChild(fieldLabel);
      card.appendChild(input);
      state.stationInput = input;
    }

    var submit = button('Продолжить', function () {
      chooseStation(state.pendingStationId);
    }, 'phab-rc-button-primary');
    submit.disabled = !text(state.pendingStationId).trim();
    card.appendChild(submit);
    state.stationContinue = submit;
    return card;
  }

  function identityCard() {
    var preview = state.preview || {};
    var resident = preview.resident || {};
    var profile = state.profile || {};
    var residency = deriveResidency(preview);
    var card = node('section', 'phab-rc-card phab-rc-identity');

    card.appendChild(photoElement(profile.fullName, profile.photoUrl));
    card.appendChild(node('h1', 'phab-rc-name', text(profile.fullName) || 'Имя не указано'));
    if (text(resident.subscriptionTypeTitle)) {
      card.appendChild(node('p', 'phab-rc-subscription', 'Абонемент: ' + text(resident.subscriptionTypeTitle)));
    }
    card.appendChild(node('p', 'phab-rc-station', 'Станция: ' + stationLabel(text(preview.stationId) || state.stationId)));
    if (text(resident.homeStationId)) {
      card.appendChild(node('p', 'phab-rc-home-station', 'Домашняя станция: ' + stationLabel(resident.homeStationId)));
    }
    card.appendChild(statusPill(residency));
    card.appendChild(node('p', 'phab-rc-term', residency.termLabel));
    if (state.profileError) {
      card.appendChild(node('p', 'phab-rc-inline-error', state.profileError));
    }
    return card;
  }

  function serviceKey(service) {
    return text(service ? service.serviceKind : '') || text(service ? service.id : '');
  }

  function findService(serviceKind) {
    if (!state.preview) {
      return null;
    }
    var services = Array.isArray(state.preview.services) ? state.preview.services : [];
    for (var index = 0; index < services.length; index++) {
      if (serviceKey(services[index]) === serviceKind) {
        return services[index];
      }
    }
    return null;
  }

  function maxQuantity(service) {
    if (service && text(service.limitPeriod) === 'MANUAL_PER_ISSUANCE') {
      return 1;
    }
    var remaining = service ? Number(service.remaining) : NaN;
    if (isFinite(remaining) && remaining >= 1) {
      return Math.floor(remaining);
    }
    var limit = service ? Number(service.limitQuantity) : NaN;
    if (isFinite(limit) && limit >= 1) {
      return Math.floor(limit);
    }
    return 1;
  }

  function selectedCount() {
    return Object.keys(state.selection).reduce(function (total, serviceKind) {
      return total + (Number(state.selection[serviceKind]) || 0);
    }, 0);
  }

  function selectionSignature() {
    return Object.keys(state.selection)
      .sort()
      .map(function (serviceKind) {
        return serviceKind + ':' + state.selection[serviceKind];
      })
      .join('|');
  }

  function toggleService(serviceKind, checked) {
    if (!serviceKind || state.busy) {
      return;
    }
    if (checked) {
      state.selection[serviceKind] = 1;
    } else {
      delete state.selection[serviceKind];
    }
    syncSelectionUi();
  }

  function stepQuantity(serviceKind, delta) {
    if (!serviceKind || state.busy) {
      return;
    }
    var current = Number(state.selection[serviceKind]) || 0;
    if (!current) {
      return;
    }
    var max = maxQuantity(findService(serviceKind));
    var next = Math.min(max, Math.max(1, current + delta));
    state.selection[serviceKind] = next;
    syncSelectionUi();
  }

  function syncSelectionUi() {
    var count = selectedCount();
    Object.keys(state.serviceRows).forEach(function (serviceKind) {
      var row = state.serviceRows[serviceKind];
      var selected = Object.prototype.hasOwnProperty.call(state.selection, serviceKind);
      if (row.row && row.row.classList) {
        if (selected) {
          row.row.classList.add('phab-rc-service-selected');
        } else {
          row.row.classList.remove('phab-rc-service-selected');
        }
      }
      if (row.checkbox) {
        row.checkbox.checked = selected;
      }
      if (row.stepper) {
        row.stepper.hidden = !(selected && row.max > 1);
      }
      if (row.quantity) {
        row.quantity.textContent = String(state.selection[serviceKind] || 1);
      }
    });
    if (state.confirmCount) {
      state.confirmCount.textContent = 'Выбрано: ' + count;
    }
    if (state.confirmButton) {
      state.confirmButton.disabled = state.busy || state.phase === 'issuing' || count === 0;
    }
    setStatus(count > 0 ? 'Выбрано позиций: ' + count : '');
  }

  function serviceRow(service) {
    var serviceKind = serviceKey(service);
    var available = Boolean(service.available);
    var canIssue = hasPermission(PERMISSION_ISSUE) && state.preview && state.preview.issuable !== false;
    var selectable = available && canIssue;
    var max = maxQuantity(service);
    var row = node('div', 'phab-rc-service' + (available ? '' : ' phab-rc-service-unavailable'));
    row.setAttribute('data-service-row', '');
    row.setAttribute('data-service-kind', serviceKind);

    var main = node(selectable ? 'label' : 'div', 'phab-rc-service-main');
    if (selectable) {
      var input = node('input', 'phab-rc-service-input');
      input.setAttribute('type', 'checkbox');
      input.id = 'phab-rc-service-' + serviceKind;
      input.checked = Object.prototype.hasOwnProperty.call(state.selection, serviceKind);
      input.disabled = state.busy || state.phase === 'issuing';
      input.addEventListener('change', function () {
        toggleService(serviceKind, input.checked);
      });
      main.appendChild(input);
    }
    main.appendChild(node('span', 'phab-rc-service-name', text(service.label) || serviceKind));
    row.appendChild(main);

    var meta = node('div', 'phab-rc-service-meta');
    var remaining = service.remaining;
    if (remaining !== null && remaining !== undefined && text(remaining)) {
      var quantityText = 'Осталось: ' + text(remaining);
      if (service.limitQuantity !== null && service.limitQuantity !== undefined && text(service.limitQuantity)) {
        quantityText += ' из ' + text(service.limitQuantity);
      }
      meta.appendChild(node('span', 'phab-rc-service-remaining', quantityText));
    }
    if (!available) {
      meta.appendChild(
        node('span', 'phab-rc-service-reason', 'Недоступно: ' + (staticBlockerReason(service.blocker) || 'Причина не указана'))
      );
    }
    row.appendChild(meta);

    if (selectable && max > 1) {
      var stepper = node('div', 'phab-rc-service-stepper');
      var minus = button('−', function () {
        stepQuantity(serviceKind, -1);
      }, 'phab-rc-step');
      minus.setAttribute('aria-label', 'Уменьшить количество: ' + (text(service.label) || serviceKind));
      var quantity = node('span', 'phab-rc-service-quantity', String(state.selection[serviceKind] || 1));
      var plus = button('+', function () {
        stepQuantity(serviceKind, 1);
      }, 'phab-rc-step');
      plus.setAttribute('aria-label', 'Увеличить количество: ' + (text(service.label) || serviceKind));
      stepper.appendChild(minus);
      stepper.appendChild(quantity);
      stepper.appendChild(plus);
      stepper.hidden = !Object.prototype.hasOwnProperty.call(state.selection, serviceKind);
      row.appendChild(stepper);
      state.serviceRows[serviceKind] = state.serviceRows[serviceKind] || {};
      state.serviceRows[serviceKind].stepper = stepper;
      state.serviceRows[serviceKind].quantity = quantity;
    }

    state.serviceRows[serviceKind] = state.serviceRows[serviceKind] || {};
    state.serviceRows[serviceKind].row = row;
    state.serviceRows[serviceKind].max = max;
    if (selectable) {
      state.serviceRows[serviceKind].checkbox = row.querySelector('.phab-rc-service-input');
    }
    return row;
  }

  function servicesCard() {
    var preview = state.preview || {};
    var card = node('section', 'phab-rc-card');
    card.appendChild(node('h2', 'phab-rc-card-title', 'Услуги'));
    if (preview.issuable === false) {
      card.appendChild(node('p', 'phab-rc-issuable-note', 'Выдача сейчас недоступна.'));
    }
    var services = Array.isArray(preview.services) ? preview.services : [];
    if (!services.length) {
      card.appendChild(node('p', 'phab-rc-empty', 'Доступных услуг нет.'));
      return card;
    }
    if (services.some(function (service) {
      return text(service && service.limitPeriod) === 'MANUAL_PER_ISSUANCE';
    })) {
      card.appendChild(node(
        'p',
        'phab-rc-manual-issuance-note',
        'Перед выдачей проверьте посещение и убедитесь, что услуги за этот визит ещё не выданы. Можно выбрать одну ракетку и одно полотенце.'
      ));
    }
    services.forEach(function (service) {
      card.appendChild(serviceRow(service));
    });
    return card;
  }

  function eventTypeLabel(eventType) {
    var value = text(eventType);
    if (value === 'ITEM_RETURNED') {
      return 'Возврат';
    }
    if (value === 'ISSUANCE_CONFIRMED') {
      return 'Выдача';
    }
    return 'Событие';
  }

  function eventItemsText(items) {
    var parts = (Array.isArray(items) ? items : []).map(function (item) {
      return (text(item && item.label) || text(item && item.serviceKind)) + ' ×' + (Number(item && item.quantity) || 1);
    });
    return parts.join(', ') || '—';
  }

  function eventRacketQuantity(items) {
    return (Array.isArray(items) ? items : []).reduce(function (total, item) {
      if (!item || text(item.serviceKind) !== 'RACKET') {
        return total;
      }
      return total + Math.max(1, Number(item.quantity) || 1);
    }, 0);
  }

  /**
   * The journal is append-only. Use return events already on the screen to
   * render a completed return accurately; opening a return still reads the
   * current issuance below, because a paginated journal is not authoritative.
   */
  function journalRacketRemaining(entries, issuanceId) {
    return (Array.isArray(entries) ? entries : []).reduce(function (total, entry) {
      if (!entry || text(entry.issuanceId) !== issuanceId) {
        return total;
      }
      var quantity = eventRacketQuantity(entry.items);
      return text(entry.eventType) === 'ITEM_RETURNED' ? total - quantity : total + quantity;
    }, 0);
  }

  function journalSnapshotRemaining(issuanceId) {
    var snapshot = state.journalIssuanceSnapshots[text(issuanceId)];
    return snapshot && typeof snapshot.remaining === 'number' ? snapshot.remaining : null;
  }

  async function openJournalReturnFlow(issuanceId) {
    var id = text(issuanceId).trim();
    if (!id || state.journalReturnLoading || state.returnBusy || state.busy) {
      return;
    }
    var contextRevision = state.contextRevision;
    var stationId = state.stationId;
    state.journalReturnLoading = true;
    state.journalError = '';
    render();
    var outcome;
    if (demoMode()) {
      outcome = { ok: true, body: state.demoIssuances[id] || null };
    } else {
      outcome = await request(
        apiUrl('/v1/admin/resident-services/issuances/' + encodeURIComponent(id)),
        { method: 'GET', headers: { 'X-Correlation-ID': newCorrelationId() } }
      );
    }
    state.journalReturnLoading = false;
    if (contextRevision !== state.contextRevision || stationId !== state.stationId) {
      return;
    }
    var currentItems = outcome && outcome.body && Array.isArray(outcome.body.items) ? outcome.body.items : null;
    if (!outcome || !outcome.ok || !currentItems) {
      state.journalError = outcome && outcome.ok
        ? 'Сервис выдачи вернул некорректные данные. Обновите журнал.'
        : errorMessage(outcome);
      render();
      return;
    }
    var available = issueReturnableQuantity(currentItems);
    state.journalIssuanceSnapshots[id] = { remaining: available };
    if (available < 1) {
      state.statusMessage = 'Ракетка по этой выдаче уже полностью возвращена.';
      render();
      return;
    }
    openReturnFlow(id, available);
  }

  function journalToggle() {
    var wrap = node('div', 'phab-rc-journal-toggle-wrap');
    var toggle = button(state.journalOpen ? 'Скрыть журнал' : 'Журнал операций', function () {
      toggleJournal();
    }, 'phab-rc-button-secondary phab-rc-journal-toggle');
    toggle.setAttribute('aria-expanded', state.journalOpen ? 'true' : 'false');
    toggle.setAttribute('aria-controls', 'phab-rc-journal');
    wrap.appendChild(toggle);
    return wrap;
  }

  function journalItem(entry) {
    var eventType = text(entry ? entry.eventType : '');
    var item = node('li', 'phab-rc-journal-item' + (eventType === 'ITEM_RETURNED' ? ' phab-rc-journal-item-returned' : ''));
    item.appendChild(
      node('div', 'phab-rc-journal-head', eventTypeLabel(eventType) + ' · ' + formatDateTime(entry ? entry.occurredAt : ''))
    );
    item.appendChild(node('div', 'phab-rc-journal-station', 'Станция: ' + stationLabel(entry ? entry.stationId : '')));
    item.appendChild(node('div', 'phab-rc-journal-items', eventItemsText(entry ? entry.items : [])));
    item.appendChild(node('div', 'phab-rc-journal-op', 'Выдача: ' + shortId(entry ? entry.issuanceId : '')));
    if (eventType === 'ITEM_RETURNED' && text(entry ? entry.returnId : '')) {
      item.appendChild(node('div', 'phab-rc-journal-op', 'Возврат: ' + shortId(entry.returnId)));
    }
    var issuanceId = text(entry ? entry.issuanceId : '');
    var snapshotRemaining = journalSnapshotRemaining(issuanceId);
    var racketsRemaining = snapshotRemaining === null
      ? journalRacketRemaining(state.journal, issuanceId)
      : snapshotRemaining;
    if (eventType === 'ISSUANCE_CONFIRMED' && eventRacketQuantity(entry ? entry.items : []) > 0 && racketsRemaining <= 0) {
      item.appendChild(node('div', 'phab-rc-journal-returned', 'Ракетка полностью возвращена'));
    }
    if (
      eventType === 'ISSUANCE_CONFIRMED' &&
      entry &&
      entry.issuanceId &&
      hasPermission(PERMISSION_RETURN) &&
      racketsRemaining > 0
    ) {
      var returnButton = button('Вернуть ракетку', function () {
        void openJournalReturnFlow(text(entry.issuanceId));
      }, 'phab-rc-button-return');
      returnButton.setAttribute('data-return-issuance-id', text(entry.issuanceId));
      returnButton.disabled = state.journalReturnLoading || state.returnBusy || state.busy;
      item.appendChild(returnButton);
    }
    return item;
  }

  function journalSection() {
    var section = node('section', 'phab-rc-card phab-rc-journal');
    section.id = 'phab-rc-journal';
    section.hidden = !state.journalOpen;
    section.appendChild(headingNode('h2', 'phab-rc-card-title', 'Журнал операций', state.pendingFocus === 'journal'));

    if (!state.journalOpen) {
      return section;
    }
    if (state.journalLoading) {
      section.appendChild(node('p', 'phab-rc-card-text', 'Загружаем журнал…'));
      return section;
    }
    if (state.journalError) {
      section.appendChild(node('p', 'phab-rc-inline-error', state.journalError));
      section.appendChild(
        button('Обновить журнал', function () {
          void loadJournal();
        }, 'phab-rc-button-secondary')
      );
      return section;
    }
    var entries = Array.isArray(state.journal) ? state.journal : [];
    if (!entries.length) {
      section.appendChild(node('p', 'phab-rc-card-text', 'Операций пока нет.'));
      return section;
    }
    var list = node('ul', 'phab-rc-journal-list');
    entries.forEach(function (entry) {
      list.appendChild(journalItem(entry));
    });
    section.appendChild(list);
    return section;
  }

  function issueReturnableQuantity(items) {
    return (Array.isArray(items) ? items : []).reduce(function (total, item) {
      if (!item || text(item.serviceKind) !== 'RACKET' || item.returnable === false) {
        return total;
      }
      var quantity = Math.max(0, Number(item.quantity) || 0);
      var returned = Math.max(0, Number(item.returnedQuantity) || 0);
      return total + Math.max(0, quantity - returned);
    }, 0);
  }

  function syncReturnUi() {
    if (state.returnQuantityEl) {
      state.returnQuantityEl.textContent = String(state.returnQuantity);
    }
    var max = state.returnTarget ? state.returnTarget.maxQuantity : 1;
    if (state.returnMinus) {
      state.returnMinus.disabled = state.returnBusy || state.returnQuantity <= 1;
    }
    if (state.returnPlus) {
      state.returnPlus.disabled = state.returnBusy || state.returnQuantity >= max;
    }
    if (state.returnSubmit) {
      state.returnSubmit.disabled = state.returnBusy || !state.returnTarget;
    }
  }

  function stepReturnQuantity(delta) {
    if (!state.returnTarget || state.returnBusy) {
      return;
    }
    var max = state.returnTarget.maxQuantity;
    var next = Math.min(max, Math.max(1, state.returnQuantity + delta));
    if (next === state.returnQuantity) {
      return;
    }
    state.returnQuantity = next;
    state.returnError = '';
    syncReturnUi();
  }

  function openReturnFlow(issuanceId, maxQuantityValue) {
    var id = text(issuanceId).trim();
    if (!id) {
      return;
    }
    var max = Math.max(1, Math.floor(Number(maxQuantityValue) || 1));
    state.returnTarget = { issuanceId: id, maxQuantity: max };
    state.returnQuantity = max;
    state.returnIntent = null;
    state.returnError = '';
    state.pendingFocus = 'return';
    state.statusMessage = 'Проверьте количество ракеток для возврата.';
    render();
  }

  function closeReturnFlow() {
    state.returnTarget = null;
    state.returnIntent = null;
    state.returnError = '';
    state.statusMessage = 'Возврат отменён.';
    render();
  }

  function returnCard() {
    var target = state.returnTarget;
    var card = node('section', 'phab-rc-card phab-rc-return-card');
    card.appendChild(headingNode('h2', 'phab-rc-card-title', 'Вернуть ракетку', state.pendingFocus === 'return'));
    card.appendChild(node('p', 'phab-rc-card-text', 'Выдача: ' + shortId(target.issuanceId)));

    var quantityRow = node('div', 'phab-rc-return-quantity');
    quantityRow.appendChild(node('span', 'phab-rc-return-label', 'Количество ракеток'));
    var stepper = node('div', 'phab-rc-return-stepper');
    var minus = button('−', function () {
      stepReturnQuantity(-1);
    }, 'phab-rc-step');
    minus.setAttribute('aria-label', 'Уменьшить количество ракеток для возврата');
    var quantity = node('span', 'phab-rc-return-value', String(state.returnQuantity));
    var plus = button('+', function () {
      stepReturnQuantity(1);
    }, 'phab-rc-step');
    plus.setAttribute('aria-label', 'Увеличить количество ракеток для возврата');
    stepper.appendChild(minus);
    stepper.appendChild(quantity);
    stepper.appendChild(plus);
    quantityRow.appendChild(stepper);
    card.appendChild(quantityRow);

    if (state.returnError) {
      card.appendChild(node('p', 'phab-rc-inline-error', state.returnError));
    }

    var submit = button(state.returnBusy ? 'Возвращаем…' : 'Подтвердить возврат', function () {
      void submitReturn();
    }, 'phab-rc-button-primary');
    submit.disabled = state.returnBusy;
    card.appendChild(submit);

    if (state.returnError && state.returnIntent) {
      var retry = button('Повторить с тем же идентификатором', function () {
        void submitReturn();
      }, 'phab-rc-button-secondary');
      retry.disabled = state.returnBusy;
      card.appendChild(retry);
    }

    var cancel = button('Отмена', function () {
      closeReturnFlow();
    }, 'phab-rc-button-secondary');
    cancel.disabled = state.returnBusy;
    card.appendChild(cancel);

    state.returnQuantityEl = quantity;
    state.returnSubmit = submit;
    state.returnMinus = minus;
    state.returnPlus = plus;
    return card;
  }

  function checkContent() {
    var content = node('div', 'phab-rc-content');
    content.appendChild(identityCard());
    content.appendChild(servicesCard());
    if (!hasPermission(PERMISSION_ISSUE)) {
      content.appendChild(permissionNotice('Нет права подтверждать выдачу (resident-services:issue): экран доступен только для просмотра.'));
    }
    if (!hasPermission(PERMISSION_READ)) {
      content.appendChild(permissionNotice('Журнал недоступен: нет права чтения (resident-services:read).'));
    } else {
      content.appendChild(journalToggle());
    }
    return content;
  }

  function confirmBar() {
    var bar = node('div', 'phab-rc-confirm');
    var count = node('span', 'phab-rc-confirm-count', 'Выбрано: ' + selectedCount());
    count.setAttribute('aria-hidden', 'true');
    bar.appendChild(count);
    var confirm = button('Подтвердить выдачу', function () {
      void confirmIssue();
    }, 'phab-rc-confirm-button');
    confirm.setAttribute('data-confirm-button', '');
    confirm.disabled = state.busy || state.phase === 'issuing' || selectedCount() === 0;
    bar.appendChild(confirm);
    state.confirmCount = count;
    state.confirmButton = confirm;
    return bar;
  }

  function unknownCard() {
    var card = node('section', 'phab-rc-card phab-rc-unknown');
    card.appendChild(headingNode('h2', 'phab-rc-card-title', 'Результат неизвестен', state.pendingFocus === 'unknown'));
    card.appendChild(
      node(
        'p',
        'phab-rc-card-text',
        'Сервер не подтвердил выдачу. Операция могла сохраниться, поэтому не создавайте новую выдачу, пока не проверите результат.'
      )
    );
    if (state.unknownError) {
      card.appendChild(node('p', 'phab-rc-inline-error', state.unknownError));
    }
    var retry = button('Повторить с тем же идентификатором', function () {
      void retryIssue();
    }, 'phab-rc-button-primary');
    retry.disabled = !state.issueIntent || state.busy || state.phase === 'issuing';
    card.appendChild(retry);
    card.appendChild(
      button('Проверить журнал', function () {
        openJournal();
      }, 'phab-rc-button-secondary')
    );
    card.appendChild(
      node(
        'p',
        'phab-rc-hint',
        'Если измените выбор позиций, следующий запрос получит новый идентификатор операции. Проверка журнала безопасна и не создаёт операцию.'
      )
    );
    return card;
  }

  function successReturnQuantity() {
    if (Array.isArray(state.successIssuanceItems)) {
      return issueReturnableQuantity(state.successIssuanceItems);
    }
    var result = state.issueResult || {};
    return issueReturnableQuantity(result.items);
  }

  function successCard() {
    var result = state.issueResult || {};
    var profile = state.profile || {};
    var card = node('section', 'phab-rc-card phab-rc-success');
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', 'Результат выдачи');
    card.appendChild(headingNode('h2', 'phab-rc-card-title phab-rc-success-title', 'Выдано', state.pendingFocus === 'success'));
    if (text(profile.fullName)) {
      card.appendChild(node('p', 'phab-rc-success-resident', text(profile.fullName)));
    }
    card.appendChild(node('p', 'phab-rc-success-op', 'Выдача: ' + shortId(result.issuanceId)));
    card.appendChild(node('p', 'phab-rc-success-time', 'Время: ' + formatDateTime(result.issuedAt)));
    card.appendChild(node('p', 'phab-rc-success-station', 'Станция: ' + stationLabel(text(result.stationId) || state.stationId)));

    var items = Array.isArray(result.items) ? result.items : [];
    var list = node('ul', 'phab-rc-success-items');
    items.forEach(function (item) {
      list.appendChild(
        node(
          'li',
          'phab-rc-success-item',
          (text(item && item.label) || text(item && item.serviceKind)) + ' ×' + (Number(item && item.quantity) || 1)
        )
      );
    });
    if (items.length > 0) {
      card.appendChild(list);
    }

    if (state.returnCompleted && state.returnCompleted.issuanceId === text(result.issuanceId)) {
      card.appendChild(
        node('p', 'phab-rc-success-return', 'Возврат подтверждён: ' + shortId(state.returnCompleted.returnId))
      );
    }

    var returnable = successReturnQuantity();
    if (returnable > 0 && hasPermission(PERMISSION_RETURN)) {
      var returnButton = button('Вернуть ракетку', function () {
        openReturnFlow(text(result.issuanceId), returnable);
      }, 'phab-rc-button-return');
      returnButton.setAttribute('data-success-return', '');
      returnButton.disabled = state.returnBusy;
      card.appendChild(returnButton);
    }

    card.appendChild(
      button('Готово', function () {
        void loadCheck();
      }, 'phab-rc-button-primary')
    );
    return card;
  }

  function render() {
    var mount = mountNode();
    if (!mount) {
      return;
    }
    state.serviceRows = {};
    state.confirmButton = null;
    state.confirmCount = null;
    state.stationInput = null;
    state.stationContinue = null;
    state.returnQuantityEl = null;
    state.returnSubmit = null;
    state.returnMinus = null;
    state.returnPlus = null;
    clear(mount);

    var page = node('div', 'phab-rc-page');
    var header = node('div', 'phab-rc-header');
    header.appendChild(node('span', 'phab-rc-header-title', 'ЦУП · Проверка резидента'));
    if (demoMode()) {
      header.appendChild(node('span', 'phab-rc-demo-badge', 'Демо-данные'));
    }
    page.appendChild(header);

    var live = node('div', 'phab-rc-live', state.statusMessage);
    live.id = 'phab-rc-status';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    page.appendChild(live);

    if (state.stationId && state.phase !== 'station') {
      page.appendChild(node('div', 'phab-rc-context', 'Станция: ' + stationLabel(state.stationId)));
    }

    if (state.phase === 'recovery') {
      page.appendChild(recoveryCard());
      if (state.journalOpen && hasPermission(PERMISSION_READ)) {
        page.appendChild(journalSection());
      }
    } else if (state.phase === 'loading') {
      page.appendChild(loadingCard());
    } else if (state.phase === 'station') {
      page.appendChild(stationCard());
    } else if (state.phase === 'load-error') {
      var canChangeStation = allowedStationIds().length !== 1;
      page.appendChild(
        errorCard('Не удалось проверить пропуск', state.loadError, {
          autofocus: state.pendingFocus === 'load-error',
          retryLabel: 'Проверить снова',
          onRetry: function () {
            void loadCheck();
          },
          changeStationLabel: canChangeStation ? 'Сменить станцию' : '',
          onChangeStation: canChangeStation ? showStationPhase : null
        })
      );
    } else if (state.phase === 'success') {
      page.appendChild(successCard());
      if (state.returnTarget) {
        page.appendChild(returnCard());
      }
    } else if (state.preview) {
      if (state.phase === 'unknown') {
        page.appendChild(unknownCard());
      }
      if (state.commandError) {
        page.appendChild(
          errorCard('Выдача не выполнена', state.commandError, {
            autofocus: state.pendingFocus === 'command-error'
          })
        );
      }
      page.appendChild(checkContent());
      if (hasPermission(PERMISSION_READ)) {
        page.appendChild(journalSection());
      }
      if (state.returnTarget) {
        page.appendChild(returnCard());
      }
      if (hasPermission(PERMISSION_ISSUE) && state.preview.issuable !== false) {
        page.appendChild(confirmBar());
      }
    } else {
      page.appendChild(
        errorCard('Нет данных пропуска', 'Обновите страницу и попробуйте снова.', {
          autofocus: state.pendingFocus === 'empty'
        })
      );
    }

    mount.appendChild(page);
    applyPendingFocus();
  }

  function ensureIssueIntent() {
    var signature = selectionSignature();
    if (state.issueIntent && state.issueIntent.signature === signature) {
      return state.issueIntent;
    }
    var items = Object.keys(state.selection)
      .sort()
      .map(function (serviceKind) {
        return { serviceKind: serviceKind, quantity: Math.max(1, Number(state.selection[serviceKind]) || 1) };
      });
    var intent = {
      key: newIdempotencyKey(),
      body: { token: passToken(), stationId: state.stationId, items: items },
      signature: signature,
      passExpiresAt: text(state.preview && state.preview.expiresAt)
    };
    state.issueIntent = intent;
    return intent;
  }

  function ensureReturnIntent(issuanceId, quantity) {
    var signature = issuanceId + ':' + quantity;
    if (state.returnIntent && state.returnIntent.signature === signature) {
      return state.returnIntent;
    }
    var bounded = Math.max(1, Math.floor(Number(quantity) || 1));
    var intent = {
      key: newIdempotencyKey(),
      body: { items: [{ serviceKind: 'RACKET', quantity: bounded }] },
      signature: signature
    };
    state.returnIntent = intent;
    return intent;
  }

  function isIssueConfirmed(body) {
    return Boolean(body && typeof body.issuanceId === 'string' && body.issuanceId);
  }

  function isReturnConfirmed(body) {
    return Boolean(body && typeof body.returnId === 'string' && body.returnId);
  }

  function validPreview(body) {
    return Boolean(
      body &&
        typeof body === 'object' &&
        typeof body.passId === 'string' &&
        body.resident &&
        typeof body.resident === 'object' &&
        Array.isArray(body.services)
    );
  }

  /** The profile must belong to the exact resident instance D confirmed. */
  function validProfile(body, expectedSubscriptionInstanceId) {
    return Boolean(
      body &&
        typeof body === 'object' &&
        typeof body.subscriptionInstanceId === 'string' &&
        body.subscriptionInstanceId === expectedSubscriptionInstanceId &&
        typeof body.fullName === 'string'
    );
  }

  async function loadCheck() {
    state.contextRevision += 1;
    state.preview = null;
    state.profile = null;
    state.profileError = '';
    state.loadError = '';
    state.commandError = '';
    state.unknownError = '';
    state.returnTarget = null;
    state.returnIntent = null;
    state.returnError = '';
    state.returnCompleted = null;
    state.journalIssuanceSnapshots = {};
    state.journalLoading = false;
    state.journalReturnLoading = false;
    state.journal = null;
    state.journalError = '';
    state.selection = {};
    state.issueIntent = null;
    state.issueResult = null;
    state.successIssuanceItems = null;
    state.busy = false;
    state.pendingFocus = '';
    setStatus('');

    var token = passToken();
    if (!token) {
      state.phase = 'load-error';
      state.loadError = 'В ссылке нет QR-пропуска. Отсканируйте QR-код на телефоне клиента камерой.';
      state.pendingFocus = 'load-error';
      render();
      return;
    }
    if (!state.stationId) {
      showStationPhase();
      return;
    }

    state.phase = 'loading';
    render();

    var previewBody = null;
    if (demoMode()) {
      previewBody = demoPreview();
    } else {
      var previewOutcome = await request(apiUrl('/v1/admin/resident-services/passes/preview'), {
        method: 'POST',
        headers: mutationHeaders(null),
        body: JSON.stringify({ token: token, stationId: state.stationId })
      });
      if (!previewOutcome.ok || !validPreview(previewOutcome.body)) {
        state.phase = 'load-error';
        state.loadError = previewOutcome.ok
          ? 'Сервис проверки вернул некорректные данные. Повторите проверку.'
          : errorMessage(previewOutcome);
        state.pendingFocus = 'load-error';
        render();
        return;
      }
      previewBody = previewOutcome.body;
    }

    state.preview = previewBody;
    var subscriptionInstanceId = text(previewBody.resident && previewBody.resident.subscriptionInstanceId);

    if (demoMode()) {
      state.profile = demoProfile();
    } else if (hasPermission(PERMISSION_ISSUE) && subscriptionInstanceId) {
      var profileOutcome = await request(apiUrl('/v1/admin/residency/profile'), {
        method: 'POST',
        headers: mutationHeaders(null),
        body: JSON.stringify({
          passToken: token,
          stationId: state.stationId,
          subscriptionInstanceId: subscriptionInstanceId
        })
      });
      if (profileOutcome.ok && validProfile(profileOutcome.body, subscriptionInstanceId)) {
        state.profile = profileOutcome.body;
      } else {
        state.profile = null;
        state.profileError = errorMessage(profileOutcome);
      }
    } else if (!hasPermission(PERMISSION_ISSUE)) {
      state.profileError = 'Фото и имя резидента доступны сотрудникам с правом выдачи.';
    } else {
      state.profileError = 'В данных пропуска нет профиля резидента.';
    }

    state.phase = 'check';
    state.statusMessage = 'Данные пропуска загружены. Сверьте фото и выберите позиции.';
    render();
  }

  async function loadJournal() {
    if (!state.stationId || !hasPermission(PERMISSION_READ)) {
      return;
    }
    var contextRevision = state.contextRevision;
    var stationId = state.stationId;
    state.journalLoading = true;
    state.journalIssuanceSnapshots = {};
    state.journalError = '';
    render();

    if (demoMode()) {
      state.journal = demoJournalEntries().slice();
      state.journalLoading = false;
      state.statusMessage = 'Журнал операций обновлён.';
      render();
      return;
    }

    var outcome = await request(
      apiUrl(
        '/v1/admin/resident-services/journal?stationId=' +
          encodeURIComponent(state.stationId) +
          '&limit=' +
          JOURNAL_LIMIT
      )
    );
    if (contextRevision !== state.contextRevision || stationId !== state.stationId) {
      return;
    }
    state.journalLoading = false;
    if (outcome.ok && outcome.body && Array.isArray(outcome.body.items)) {
      state.journal = outcome.body.items;
      state.journalError = '';
      state.statusMessage = 'Журнал операций обновлён.';
    } else {
      state.journalError = errorMessage(outcome);
      state.statusMessage = 'Не удалось загрузить журнал.';
    }
    render();
  }

  function openJournal() {
    if (!hasPermission(PERMISSION_READ)) {
      return;
    }
    state.journalOpen = true;
    state.pendingFocus = 'journal';
    render();
    if (!state.journal && !state.journalLoading) {
      void loadJournal();
    }
  }

  function toggleJournal() {
    if (state.journalOpen) {
      state.journalOpen = false;
      render();
      return;
    }
    openJournal();
  }

  /** Posts the exact intent it receives; never generates a key and never auto-retries. */
  async function submitIssue(intent) {
    state.busy = true;
    state.phase = 'issuing';
    state.commandError = '';
    state.unknownError = '';
    state.statusMessage = 'Подтверждаем выдачу…';
    render();

    var outcome = null;
    if (demoMode()) {
      outcome = { ok: true, status: 200, body: demoIssue(intent.body), correlationId: '', network: false };
    } else {
      // Persist the attempt marker before sending, so a reload while the
      // request is in flight can still resolve the exact operation.
      writePendingIssue(intent);
      outcome = await request(apiUrl('/v1/admin/resident-services/issuances'), {
        method: 'POST',
        headers: mutationHeaders(intent.key),
        body: JSON.stringify(intent.body)
      });
    }
    state.busy = false;

    if (outcome.ok && isIssueConfirmed(outcome.body)) {
      clearPendingIssue();
      state.issueResult = outcome.body;
      state.successIssuanceItems = Array.isArray(outcome.body.items) ? outcome.body.items : null;
      state.issueIntent = null;
      state.journal = null;
      state.phase = 'success';
      state.pendingFocus = 'success';
      state.statusMessage = 'Выдача подтверждена сервером.';
      render();
      return;
    }

    if (outcome.ok || outcome.network || Number(outcome.status) >= 500) {
      state.phase = 'unknown';
      state.pendingFocus = 'unknown';
      state.unknownError = outcome.ok
        ? 'Сервер ответил без подтверждения операции (нет issuanceId).'
        : errorMessage(outcome);
      state.statusMessage = 'Результат неизвестен. Не повторяйте выдачу автоматически.';
      render();
      return;
    }

    // A definitive 4xx means the server rejected this attempt: nothing to recover.
    // 401/403/408/429 are excluded: they say nothing about whether an earlier
    // send of the same key was committed.
    if ([401, 403, 408, 429].indexOf(Number(outcome.status)) === -1) {
      clearPendingIssue();
    }
    if (readErrorCode(outcome) === 'RESIDENT_SERVICES_IDEMPOTENCY_CONFLICT') {
      state.issueIntent = null;
    }
    state.phase = 'check';
    state.commandError = errorMessage(outcome);
    state.pendingFocus = 'command-error';
    state.statusMessage = 'Выдача не выполнена.';
    render();
  }

  async function confirmIssue() {
    if (state.busy || state.phase === 'issuing') {
      return;
    }
    if (!hasPermission(PERMISSION_ISSUE) || !state.preview || state.preview.issuable === false) {
      return;
    }
    if (selectedCount() === 0) {
      setStatus('Выберите хотя бы одну позицию.');
      return;
    }
    if (!passToken()) {
      state.phase = 'load-error';
      state.loadError = 'В ссылке нет идентификатора пропуска.';
      state.pendingFocus = 'load-error';
      render();
      return;
    }
    if (!state.stationId) {
      showStationPhase();
      return;
    }
    await submitIssue(ensureIssueIntent());
  }

  /** Manual retry only: reuses the exact key and body of the failed intent. */
  async function retryIssue() {
    if (state.busy || state.phase === 'issuing') {
      return;
    }
    if (!state.issueIntent) {
      setStatus('Повторять нечего. Начните выдачу заново.');
      return;
    }
    await submitIssue(state.issueIntent);
  }

  async function submitReturn() {
    if (!state.returnTarget || state.returnBusy || state.busy) {
      return;
    }
    if (!hasPermission(PERMISSION_RETURN)) {
      return;
    }
    var intent = ensureReturnIntent(state.returnTarget.issuanceId, state.returnQuantity);
    state.returnBusy = true;
    state.returnError = '';
    state.statusMessage = 'Возвращаем ракетку…';
    render();

    var outcome = null;
    if (demoMode()) {
      outcome = {
        ok: true,
        status: 200,
        body: demoReturn(state.returnTarget.issuanceId, state.returnQuantity),
        correlationId: '',
        network: false
      };
    } else {
      outcome = await request(
        apiUrl('/v1/admin/resident-services/issuances/' + encodeURIComponent(state.returnTarget.issuanceId) + '/returns'),
        {
          method: 'POST',
          headers: mutationHeaders(intent.key),
          body: JSON.stringify(intent.body)
        }
      );
    }
    state.returnBusy = false;

    if (outcome.ok && isReturnConfirmed(outcome.body)) {
      var returned = outcome.body;
      state.returnCompleted = { issuanceId: text(returned.issuanceId), returnId: text(returned.returnId) };
      if (Array.isArray(returned.issuanceItems)) {
        state.successIssuanceItems = returned.issuanceItems;
      }
      state.returnTarget = null;
      state.returnIntent = null;
      state.returnError = '';
      state.journal = null;
      if (state.phase === 'success') {
        state.pendingFocus = 'success';
        render();
      } else if (state.journalOpen) {
        await loadJournal();
      } else {
        render();
      }
      setStatus('Возврат ракетки подтверждён.');
      return;
    }

    var code = readErrorCode(outcome);
    if (code === 'RESIDENT_ISSUANCE_NOT_FOUND') {
      state.returnTarget = null;
      state.returnIntent = null;
      state.returnError = '';
      state.statusMessage = ERROR_COPY.RESIDENT_ISSUANCE_NOT_FOUND;
      render();
      return;
    }
    if (code === 'RESIDENT_SERVICES_IDEMPOTENCY_CONFLICT') {
      state.returnIntent = null;
    }
    state.returnError = errorMessage(outcome);
    state.statusMessage = 'Возврат ракетки не подтверждён.';
    render();
  }

  function demoOutstanding(serviceKind) {
    var total = 0;
    Object.keys(state.demoIssuances).forEach(function (issuanceId) {
      var issuance = state.demoIssuances[issuanceId];
      (issuance.items || []).forEach(function (item) {
        if (text(item.serviceKind) !== serviceKind) {
          return;
        }
        var quantity = Math.max(0, Number(item.quantity) || 0);
        var returned = Math.max(0, Number(item.returnedQuantity) || 0);
        total += Math.max(0, quantity - returned);
      });
    });
    return total;
  }

  function demoPreview() {
    var now = Date.now();
    var racketIssued = demoOutstanding('RACKET');
    var towelIssued = demoOutstanding('TOWEL');
    var racketRemaining = Math.max(0, 1 - racketIssued);
    var towelRemaining = Math.max(0, 3 - towelIssued);
    return {
      schemaVersion: 'rsp1',
      passId: 'demo-active',
      state: 'ACTIVE',
      issuedAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
      stationId: state.stationId,
      resident: {
        confirmed: true,
        subscriptionInstanceId: 'demo-instance',
        subscriptionTypeId: 'demo-type',
        subscriptionTypeTitle: 'Демо-абонемент',
        activeFrom: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
        activeTo: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
        homeStationId: state.stationId
      },
      services: [
        {
          serviceKind: 'RACKET',
          label: 'Ракетка',
          returnable: true,
          limitPeriod: 'DAY',
          limitQuantity: 2,
          used: 1 + racketIssued,
          remaining: racketRemaining,
          available: racketRemaining > 0,
          blocker: racketRemaining > 0 ? null : 'RESIDENT_SERVICE_LIMIT_EXCEEDED'
        },
        {
          serviceKind: 'TOWEL',
          label: 'Полотенце',
          returnable: false,
          limitPeriod: 'DAY',
          limitQuantity: 3,
          used: towelIssued,
          remaining: towelRemaining,
          available: towelRemaining > 0,
          blocker: towelRemaining > 0 ? null : 'RESIDENT_SERVICE_LIMIT_EXCEEDED'
        }
      ],
      issuable: racketRemaining + towelRemaining > 0
    };
  }

  function demoProfile() {
    return {
      fullName: 'Анна Резидентова',
      photoUrl: null,
      subscriptionInstanceId: 'demo-instance'
    };
  }

  function demoJournalEntries() {
    if (!state.demoJournal) {
      state.demoJournal = [
        {
          eventId: 'demo-event-0',
          eventType: 'ISSUANCE_CONFIRMED',
          issuanceId: 'demo-issuance-0',
          returnId: null,
          stationId: state.stationId,
          actorId: 'demo-staff',
          occurredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          items: [{ serviceKind: 'TOWEL', label: 'Полотенце', quantity: 2 }]
        }
      ];
    }
    return state.demoJournal;
  }

  function demoIssue(body) {
    var entries = demoJournalEntries();
    state.demoSequence += 1;
    var sequence = state.demoSequence;
    var issuanceId = 'demo-issuance-' + sequence;
    var now = Date.now();
    var items = (Array.isArray(body.items) ? body.items : []).map(function (item) {
      var service = findService(item.serviceKind) || {};
      return {
        serviceKind: item.serviceKind,
        label: text(service.label) || text(item.serviceKind),
        quantity: Math.max(1, Number(item.quantity) || 1),
        returnable: Boolean(service.returnable),
        returnedQuantity: 0,
        limitPeriod: text(service.limitPeriod) || 'DAY',
        limitQuantity: Number(service.limitQuantity) || 0,
        remainingAfter: Math.max(0, Number(service.remaining) || 0)
      };
    });
    var view = {
      issuanceId: issuanceId,
      operationId: 'demo-operation-' + sequence,
      state: 'ISSUED',
      stationId: state.stationId,
      issuedAt: new Date(now).toISOString(),
      returnedAt: null,
      resident: {
        subscriptionTypeId: 'demo-type',
        subscriptionTypeTitle: 'Демо-абонемент',
        activeFrom: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
        activeTo: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString()
      },
      items: items
    };
    state.demoIssuances[issuanceId] = view;
    entries.unshift({
      eventId: 'demo-event-' + sequence,
      eventType: 'ISSUANCE_CONFIRMED',
      issuanceId: issuanceId,
      returnId: null,
      stationId: state.stationId,
      actorId: 'demo-staff',
      occurredAt: view.issuedAt,
      items: items.map(function (item) {
        return { serviceKind: item.serviceKind, label: item.label, quantity: item.quantity };
      })
    });
    return view;
  }

  function demoReturn(issuanceId, quantity) {
    var entries = demoJournalEntries();
    var issuance = state.demoIssuances[issuanceId] || null;
    var now = new Date().toISOString();
    state.demoReturnSequence += 1;
    var returnId = 'demo-return-' + state.demoReturnSequence;
    var remaining = Math.max(1, Number(quantity) || 1);
    var returnedItems = [];

    if (issuance) {
      (issuance.items || []).forEach(function (item) {
        if (text(item.serviceKind) !== 'RACKET' || remaining <= 0) {
          return;
        }
        var outstanding = Math.max(
          0,
          (Number(item.quantity) || 0) - (Number(item.returnedQuantity) || 0)
        );
        var taken = Math.min(outstanding, remaining);
        item.returnedQuantity = (Number(item.returnedQuantity) || 0) + taken;
        remaining -= taken;
        if (taken > 0) {
          returnedItems.push({ serviceKind: 'RACKET', label: text(item.label) || 'Ракетка', quantity: taken });
        }
      });
      issuance.state = issueReturnableQuantity(issuance.items) > 0 ? 'PARTIALLY_RETURNED' : 'RETURNED';
    }

    if (!returnedItems.length) {
      returnedItems.push({ serviceKind: 'RACKET', label: 'Ракетка', quantity: Math.max(1, Number(quantity) || 1) });
    }

    entries.unshift({
      eventId: 'demo-return-event-' + state.demoReturnSequence,
      eventType: 'ITEM_RETURNED',
      issuanceId: issuanceId,
      returnId: returnId,
      stationId: state.stationId,
      actorId: 'demo-staff',
      occurredAt: now,
      items: returnedItems
    });
    return {
      returnId: returnId,
      issuanceId: issuanceId,
      stationId: state.stationId,
      returnedAt: now,
      items: returnedItems,
      issuanceState: issuance ? issuance.state : 'ISSUED',
      issuanceItems: issuance && Array.isArray(issuance.items) ? issuance.items.slice() : []
    };
  }

  function recoveryCard() {
    var marker = state.recovery || {};
    var card = node('section', 'phab-rc-card phab-rc-unknown');
    card.setAttribute('data-recovery', marker.status || '');
    if (marker.status === 'checking') {
      card.appendChild(headingNode('h2', 'phab-rc-card-title', 'Проверяем прошлую выдачу…', true));
      card.appendChild(
        node('p', 'phab-rc-card-text', 'Страница была перезагружена до ответа сервера. Сначала узнаём, сохранилась ли та выдача.')
      );
      return card;
    }
    if (marker.status === 'not-saved') {
      card.appendChild(headingNode('h2', 'phab-rc-card-title', 'Прошлая выдача не сохранилась', true));
      card.appendChild(
        node(
          'p',
          'phab-rc-card-text',
          'Сервер не записал операцию, а её пропуск уже истёк. Предметы по ней не выданы. Отсканируйте новый QR клиента.'
        )
      );
    } else {
      card.appendChild(headingNode('h2', 'phab-rc-card-title', 'Результат прошлой выдачи неизвестен', true));
      card.appendChild(
        node(
          'p',
          'phab-rc-card-text',
          'Страница была перезагружена до ответа сервера. Не выдавайте предметы повторно, пока не проверите результат или журнал.'
        )
      );
      if (marker.error) {
        card.appendChild(node('p', 'phab-rc-inline-error', marker.error));
      }
      var again = button('Проверить снова', function () {
        void resolvePendingIssue(true);
      }, 'phab-rc-button-primary');
      card.appendChild(again);
      if (hasPermission(PERMISSION_READ)) {
        card.appendChild(
          button('Открыть журнал', function () {
            openJournal();
          }, 'phab-rc-button-secondary')
        );
      }
      // Explicit staff decision after checking the journal; never automatic.
      card.appendChild(
        button('Проверено по журналу, продолжить', function () {
          state.recovery = null;
          proceedAfterRecovery();
        }, 'phab-rc-button-secondary')
      );
      card.appendChild(
        node('p', 'phab-rc-hint', 'Отметка о незавершённой выдаче хранится до проверки и не содержит QR-токена.')
      );
      return card;
    }
    card.appendChild(
      button(passToken() ? 'Проверить новый QR' : 'Продолжить', function () {
        state.recovery = null;
        proceedAfterRecovery();
      }, 'phab-rc-button-primary')
    );
    return card;
  }

  /** Resolves the persisted attempt with a read-only lookup; never re-issues. */
  async function resolvePendingIssue(manual) {
    var marker = readPendingIssue();
    if (!marker) {
      state.recovery = null;
      proceedAfterRecovery();
      return;
    }
    if (marker.stationId && !state.stationId) {
      state.stationId = marker.stationId;
    }
    state.recovery = { status: 'checking', marker: marker };
    state.phase = 'recovery';
    if (manual) {
      setStatus('Проверяем прошлую выдачу…');
    }
    render();
    var outcome = await request(apiUrl('/v1/admin/resident-services/issuance-attempts'), {
      method: 'GET',
      headers: { 'Idempotency-Key': marker.key, 'X-Correlation-ID': newCorrelationId() }
    });
    if (outcome.ok && isIssueConfirmed(outcome.body)) {
      clearPendingIssue();
      state.recovery = null;
      state.issueResult = outcome.body;
      state.successIssuanceItems = Array.isArray(outcome.body.items) ? outcome.body.items : null;
      if (text(outcome.body.stationId)) {
        state.stationId = text(outcome.body.stationId);
      }
      state.phase = 'success';
      state.pendingFocus = 'success';
      state.statusMessage = 'Прошлая выдача сохранена сервером. Повторно не выдавайте.';
      render();
      return;
    }
    if (readErrorCode(outcome) === 'RESIDENT_ISSUANCE_NOT_FOUND' && pendingIssueSettled(marker)) {
      clearPendingIssue();
      state.recovery = { status: 'not-saved' };
      state.statusMessage = 'Прошлая выдача не сохранилась.';
      render();
      return;
    }
    state.recovery = {
      status: 'unknown',
      error: readErrorCode(outcome) === 'RESIDENT_ISSUANCE_NOT_FOUND'
        ? 'Операция пока не найдена. Пропуск ещё действует, запись могла не завершиться — проверьте снова через минуту.'
        : errorMessage(outcome)
    };
    state.statusMessage = 'Результат прошлой выдачи неизвестен.';
    render();
  }

  /** Ordinary start once no unresolved attempt blocks a new issuance. */
  function proceedAfterRecovery() {
    clearPendingIssue();
    if (state.stationId) {
      void loadCheck();
      return;
    }
    startStationSelection();
  }

  function startStationSelection() {
    var preferred = defaultStationId();
    var allowed = allowedStationIds();
    if (preferred) {
      state.stationId = preferred;
      void loadCheck();
      return;
    }
    if (allowed.length === 1) {
      state.stationId = allowed[0];
      void loadCheck();
      return;
    }
    state.phase = 'station';
    state.pendingStationId = '';
    state.pendingFocus = 'station';
    render();
  }

  function boot() {
    if (state.started) {
      return;
    }
    state.started = true;
    // Capture and clear the fragment token before any rendering or request.
    passToken();
    if (readPendingIssue()) {
      void resolvePendingIssue(false);
      return;
    }
    startStationSelection();
  }

  if (typeof window !== 'undefined') {
    window.PHABResidencyCheck = { init: boot, version: CONFIG_VERSION };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
