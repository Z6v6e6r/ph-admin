(function () {
  var DEFAULTS = {
    apiBaseUrl: '',
    pollIntervalMs: 5000,
    title: 'Поддержка PadelHub',
    launcherText: 'Чат',
    storageKey: 'phab_messenger_widget_session',
    stations: []
  };

  var STYLE_ID = 'phab-messenger-widget-style';

  function nowIso() {
    return new Date().toISOString();
  }

  function parseIso(value) {
    if (!value) {
      return 0;
    }
    var ts = Date.parse(value);
    return Number.isNaN(ts) ? 0 : ts;
  }

  function mergeConfig(input) {
    var cfg = Object.assign({}, DEFAULTS, input || {});
    if (!cfg.apiBaseUrl) {
      throw new Error('PHAB widget: apiBaseUrl is required');
    }
    cfg.apiBaseUrl = String(cfg.apiBaseUrl).replace(/\/+$/, '');
    cfg.pollIntervalMs = Math.max(2000, Number(cfg.pollIntervalMs || DEFAULTS.pollIntervalMs));
    if (!Array.isArray(cfg.stations)) {
      cfg.stations = [];
    }
    return cfg;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.phab-launcher{position:fixed;right:20px;bottom:20px;z-index:2147483000;border:none;border-radius:999px;padding:12px 18px;background:#116149;color:#fff;font:600 14px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;cursor:pointer;box-shadow:0 10px 24px rgba(0,0,0,.18)}' +
      '.phab-launcher-badge{display:inline-block;min-width:18px;height:18px;padding:0 5px;margin-left:8px;border-radius:10px;background:#d1362a;color:#fff;font-size:11px;line-height:18px;text-align:center}' +
      '.phab-panel{position:fixed;right:20px;bottom:74px;width:360px;max-width:calc(100vw - 20px);height:520px;max-height:70vh;background:#fff;border:1px solid #d8e0dc;border-radius:14px;display:flex;flex-direction:column;z-index:2147483001;box-shadow:0 20px 48px rgba(0,0,0,.18)}' +
      '.phab-panel-hidden{display:none}' +
      '.phab-header{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #e6ece8;background:#f3f7f5}' +
      '.phab-title{font:700 14px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;color:#17352d}' +
      '.phab-status{font:500 12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;color:#39564d}' +
      '.phab-body{flex:1;display:flex;flex-direction:column;min-height:0}' +
      '.phab-station-wrap{padding:12px 14px;border-bottom:1px solid #eef2f0;background:#fafcfa}' +
      '.phab-select,.phab-input{width:100%;box-sizing:border-box;border:1px solid #c6d3cd;border-radius:9px;padding:9px 10px;font:500 13px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif}' +
      '.phab-messages{flex:1;overflow:auto;padding:12px 12px 8px;background:#fff}' +
      '.phab-msg{max-width:82%;margin:0 0 8px;padding:8px 10px;border-radius:10px;font:500 13px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;white-space:pre-wrap;word-break:break-word}' +
      '.phab-msg-client{margin-left:auto;background:#106f52;color:#fff;border-bottom-right-radius:4px}' +
      '.phab-msg-staff{margin-right:auto;background:#eef4f1;color:#1c342d;border-bottom-left-radius:4px}' +
      '.phab-msg-meta{display:block;margin-top:3px;font-size:10px;opacity:.7}' +
      '.phab-footer{padding:10px;border-top:1px solid #e6ece8;display:flex;gap:8px;background:#fafcfa}' +
      '.phab-send{border:none;border-radius:9px;padding:0 14px;background:#116149;color:#fff;font:600 13px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;cursor:pointer}' +
      '.phab-hint{padding:8px 12px;color:#4b5e58;font:500 12px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif}' +
      '@media(max-width:520px){.phab-panel{left:10px;right:10px;bottom:70px;width:auto;height:65vh}}';
    document.head.appendChild(style);
  }

  function createWidgetDom(cfg) {
    var launcher = document.createElement('button');
    launcher.className = 'phab-launcher';
    launcher.type = 'button';
    launcher.textContent = cfg.launcherText;

    var badge = document.createElement('span');
    badge.className = 'phab-launcher-badge';
    badge.style.display = 'none';
    badge.textContent = '0';
    launcher.appendChild(badge);

    var panel = document.createElement('section');
    panel.className = 'phab-panel phab-panel-hidden';

    var header = document.createElement('div');
    header.className = 'phab-header';
    panel.appendChild(header);

    var title = document.createElement('div');
    title.className = 'phab-title';
    title.textContent = cfg.title;
    header.appendChild(title);

    var status = document.createElement('div');
    status.className = 'phab-status';
    status.textContent = 'Ожидание';
    header.appendChild(status);

    var body = document.createElement('div');
    body.className = 'phab-body';
    panel.appendChild(body);

    var stationWrap = document.createElement('div');
    stationWrap.className = 'phab-station-wrap';
    body.appendChild(stationWrap);

    var stationSelect = document.createElement('select');
    stationSelect.className = 'phab-select';
    stationWrap.appendChild(stationSelect);

    var hint = document.createElement('div');
    hint.className = 'phab-hint';
    hint.textContent = 'Выберите станцию и начните диалог';
    body.appendChild(hint);

    var messages = document.createElement('div');
    messages.className = 'phab-messages';
    body.appendChild(messages);

    var footer = document.createElement('div');
    footer.className = 'phab-footer';
    panel.appendChild(footer);

    var input = document.createElement('input');
    input.className = 'phab-input';
    input.type = 'text';
    input.placeholder = 'Введите сообщение...';
    input.maxLength = 2000;
    footer.appendChild(input);

    var send = document.createElement('button');
    send.className = 'phab-send';
    send.type = 'button';
    send.textContent = 'Отправить';
    footer.appendChild(send);

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    return {
      launcher: launcher,
      badge: badge,
      panel: panel,
      status: status,
      stationSelect: stationSelect,
      hint: hint,
      messages: messages,
      input: input,
      send: send
    };
  }

  function formatTime(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    var hh = String(date.getHours()).padStart(2, '0');
    var mm = String(date.getMinutes()).padStart(2, '0');
    return hh + ':' + mm;
  }

  function createApi(cfg, clientId) {
    return {
      async request(path, options) {
        var headers = Object.assign(
          {
            'Content-Type': 'application/json',
            'x-user-id': clientId,
            'x-user-role': 'CLIENT'
          },
          cfg.authHeaders || {},
          options && options.headers ? options.headers : {}
        );

        var response = await fetch(cfg.apiBaseUrl + path, Object.assign({}, options, { headers: headers }));
        if (!response.ok) {
          var text = await response.text().catch(function () {
            return '';
          });
          throw new Error('HTTP ' + response.status + ': ' + text);
        }

        var contentType = response.headers.get('content-type') || '';
        if (contentType.indexOf('application/json') === -1) {
          return null;
        }
        return response.json();
      },

      async createThread(payload) {
        return this.request('/messenger/threads', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      },

      async getThread(threadId) {
        return this.request('/messenger/threads/' + encodeURIComponent(threadId), { method: 'GET' });
      },

      async listMessages(threadId) {
        return this.request('/messenger/threads/' + encodeURIComponent(threadId) + '/messages', {
          method: 'GET'
        });
      },

      async sendMessage(threadId, text) {
        return this.request('/messenger/threads/' + encodeURIComponent(threadId) + '/messages', {
          method: 'POST',
          body: JSON.stringify({ text: text })
        });
      }
    };
  }

  function widgetInstance(rawConfig) {
    var cfg = mergeConfig(rawConfig);
    ensureStyle();

    var state = {
      open: false,
      loading: false,
      clientId: String(cfg.clientId || 'client-' + Math.random().toString(36).slice(2, 10)),
      threadId: null,
      stationId: null,
      stationName: null,
      lastSeenAt: null,
      lastBadgeMessageAt: null,
      unreadCount: 0,
      disposed: false
    };

    var dom = createWidgetDom(cfg);
    var api = createApi(cfg, state.clientId);
    var pollTimer = null;

    function setStatus(text) {
      dom.status.textContent = text;
    }

    function showHint(text) {
      dom.hint.textContent = text;
    }

    function setBadge(count) {
      var safeCount = Math.max(0, Number(count || 0));
      state.unreadCount = safeCount;
      if (safeCount <= 0) {
        dom.badge.style.display = 'none';
        return;
      }
      dom.badge.style.display = '';
      dom.badge.textContent = safeCount > 99 ? '99+' : String(safeCount);
    }

    function loadSession() {
      try {
        var raw = localStorage.getItem(cfg.storageKey);
        if (!raw) {
          return;
        }
        var parsed = JSON.parse(raw);
        if (parsed && parsed.clientId === state.clientId) {
          state.threadId = parsed.threadId || null;
          state.stationId = parsed.stationId || null;
          state.stationName = sanitizeStationName(parsed.stationName, parsed.stationId) || null;
          state.lastSeenAt = parsed.lastSeenAt || null;
          state.lastBadgeMessageAt = parsed.lastBadgeMessageAt || null;
        }
      } catch (_err) {}
    }

    function saveSession() {
      try {
        localStorage.setItem(
          cfg.storageKey,
          JSON.stringify({
            clientId: state.clientId,
            threadId: state.threadId,
            stationId: state.stationId,
            stationName: state.stationName,
            lastSeenAt: state.lastSeenAt,
            lastBadgeMessageAt: state.lastBadgeMessageAt
          })
        );
      } catch (_err) {}
    }

    function renderStations() {
      var stations = cfg.stations.slice();
      dom.stationSelect.innerHTML = '';

      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Выберите станцию...';
      dom.stationSelect.appendChild(placeholder);

      stations.forEach(function (station) {
        var option = document.createElement('option');
        option.value = String(station.id);
        option.textContent = String(station.name || station.id);
        dom.stationSelect.appendChild(option);
      });

      if (state.stationId) {
        dom.stationSelect.value = state.stationId;
      }
    }

    function renderMessages(messages) {
      dom.messages.innerHTML = '';
      messages.forEach(function (message) {
        var item = document.createElement('div');
        var own = message.senderRole === 'CLIENT';
        item.className = 'phab-msg ' + (own ? 'phab-msg-client' : 'phab-msg-staff');
        item.textContent = message.text || '';

        var meta = document.createElement('span');
        meta.className = 'phab-msg-meta';
        var roleLabel = own ? 'Вы' : message.origin === 'AI' ? 'AI' : 'Поддержка';
        meta.textContent = roleLabel + ' • ' + formatTime(message.createdAt);
        item.appendChild(meta);

        dom.messages.appendChild(item);
      });
      dom.messages.scrollTop = dom.messages.scrollHeight;
    }

    function getStationById(stationId) {
      for (var i = 0; i < cfg.stations.length; i += 1) {
        if (String(cfg.stations[i].id) === String(stationId)) {
          return cfg.stations[i];
        }
      }
      return null;
    }

    function isUuidLike(value) {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(value || '').trim()
      );
    }

    function sanitizeStationName(stationName, stationId) {
      var candidate = String(stationName || '').trim();
      if (!candidate) {
        return '';
      }
      var normalizedStationId = String(stationId || '').trim();
      if (normalizedStationId && candidate.toLowerCase() === normalizedStationId.toLowerCase()) {
        return '';
      }
      if (isUuidLike(candidate)) {
        return '';
      }
      return candidate;
    }

    function resolveStationNameById(stationId) {
      var station = getStationById(stationId);
      return sanitizeStationName(station && station.name, stationId);
    }

    function resolveStationLabel(stationId, stationName) {
      return (
        sanitizeStationName(stationName, stationId) ||
        resolveStationNameById(stationId) ||
        String(stationId || '').trim()
      );
    }

    async function ensureThread() {
      if (state.threadId) {
        return state.threadId;
      }

      var selectedStationId = dom.stationSelect.value || state.stationId;
      if (!selectedStationId) {
        throw new Error('Станция не выбрана');
      }

      var stationName = resolveStationNameById(selectedStationId);
      var createPayload = {
        connector: 'LK_WEB_MESSENGER',
        stationId: selectedStationId,
        clientId: state.clientId,
        aiMode: 'SUGGEST'
      };
      if (stationName) {
        createPayload.stationName = stationName;
      }

      var thread = await api.createThread(createPayload);

      state.threadId = thread.id;
      state.stationId = selectedStationId;
      state.stationName =
        sanitizeStationName(thread && thread.stationName, selectedStationId) || stationName || null;
      saveSession();
      return thread.id;
    }

    async function syncMessages(markSeen) {
      if (!state.threadId) {
        renderMessages([]);
        return;
      }

      var messages = await api.listMessages(state.threadId);
      renderMessages(messages || []);

      if (markSeen) {
        state.lastSeenAt = nowIso();
        state.lastBadgeMessageAt = null;
        setBadge(0);
        saveSession();
      }
    }

    async function refreshUnreadOnly() {
      if (!state.threadId || state.open) {
        return;
      }
      try {
        var thread = await api.getThread(state.threadId);
        var lastSeen = parseIso(state.lastSeenAt);
        var lastMessage = parseIso(thread && thread.lastMessageAt);
        var lastBadgeMessage = parseIso(state.lastBadgeMessageAt);
        if (lastMessage > lastSeen) {
          if (lastMessage > lastBadgeMessage) {
            state.lastBadgeMessageAt = thread.lastMessageAt || nowIso();
            setBadge(Math.min(99, state.unreadCount + 1));
            saveSession();
          }
        }
      } catch (_err) {}
    }

    async function sendCurrentMessage() {
      var text = String(dom.input.value || '').trim();
      if (!text) {
        return;
      }
      if (state.loading) {
        return;
      }

      state.loading = true;
      dom.send.disabled = true;
      setStatus('Отправка...');

      try {
        var threadId = await ensureThread();
        await api.sendMessage(threadId, text);
        dom.input.value = '';
        await syncMessages(true);
        setStatus('Онлайн');
        showHint('Диалог активен: ' + (resolveStationLabel(state.stationId, state.stationName) || 'станция'));
      } catch (err) {
        setStatus('Ошибка');
        showHint(err && err.message ? err.message : 'Не удалось отправить сообщение');
      } finally {
        state.loading = false;
        dom.send.disabled = false;
      }
    }

    async function validateSavedThread() {
      if (!state.threadId) {
        return;
      }
      try {
        var thread = await api.getThread(state.threadId);
        if (!thread || !thread.id) {
          state.threadId = null;
          saveSession();
          return;
        }
        state.stationId = thread.stationId || state.stationId;
        state.stationName =
          sanitizeStationName(thread && thread.stationName, state.stationId) ||
          resolveStationNameById(state.stationId) ||
          state.stationName;
        saveSession();
      } catch (_err) {
        state.threadId = null;
        saveSession();
      }
    }

    function togglePanel() {
      state.open = !state.open;
      if (state.open) {
        dom.panel.classList.remove('phab-panel-hidden');
        syncMessages(true).catch(function () {});
        setStatus('Онлайн');
      } else {
        dom.panel.classList.add('phab-panel-hidden');
      }
    }

    async function init() {
      loadSession();
      renderStations();
      await validateSavedThread();

      if (state.stationId) {
        dom.stationSelect.value = state.stationId;
        showHint('Станция: ' + resolveStationLabel(state.stationId, state.stationName));
      }

      dom.launcher.addEventListener('click', function () {
        togglePanel();
      });

      dom.send.addEventListener('click', function () {
        sendCurrentMessage().catch(function () {});
      });

      dom.input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          sendCurrentMessage().catch(function () {});
        }
      });

      dom.stationSelect.addEventListener('change', function () {
        if (!state.threadId) {
          var station = getStationById(dom.stationSelect.value);
          state.stationId = dom.stationSelect.value || null;
          state.stationName = sanitizeStationName(station ? station.name : null, state.stationId) || null;
          saveSession();
          if (state.stationId) {
            showHint('Станция выбрана: ' + resolveStationLabel(state.stationId, state.stationName));
          }
        }
      });

      pollTimer = window.setInterval(function () {
        if (state.disposed) {
          return;
        }
        if (state.open) {
          syncMessages(true).catch(function () {});
        } else {
          refreshUnreadOnly().catch(function () {});
        }
      }, cfg.pollIntervalMs);
    }

    function destroy() {
      state.disposed = true;
      if (pollTimer) {
        window.clearInterval(pollTimer);
      }
      dom.launcher.remove();
      dom.panel.remove();
    }

    init().catch(function (err) {
      setStatus('Ошибка');
      showHint(err && err.message ? err.message : 'Ошибка инициализации');
    });

    return {
      destroy: destroy,
      getState: function () {
        return Object.assign({}, state);
      }
    };
  }

  window.PHABMessengerWidget = {
    init: function (config) {
      return widgetInstance(config || {});
    }
  };
})();
