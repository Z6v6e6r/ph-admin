(function () {
  var STYLE_ID = 'phab-tournaments-showcase-style';
  var DEFAULT_API_BASE_URL = inferApiBaseUrl(document.currentScript && document.currentScript.src);
  var LEVEL_OPTIONS = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];
  var DEFAULTS = {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    stationIds: [],
    limit: 12,
    includePast: false,
    refreshMs: 0,
    variant: 'embed',
    title: 'Турниры PadelHub',
    subtitle: 'Выбирайте турнир, входите через LK и записывайтесь прямо со страницы.'
  };

  function inferApiBaseUrl(scriptSrc) {
    if (!scriptSrc) {
      return '';
    }

    try {
      var parsed = new URL(scriptSrc, window.location.href);
      parsed.pathname = parsed.pathname.replace(
        /\/client-script\/tournaments-showcase(?:\.download)?\.js$/,
        ''
      );
      return parsed.toString().replace(/\/$/, '');
    } catch (_error) {
      return '';
    }
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      ':root {',
      '  --ph-tournament-ink: #1f2c21;',
      '  --ph-tournament-ink-soft: rgba(31, 44, 33, 0.68);',
      '  --ph-tournament-line: rgba(31, 44, 33, 0.1);',
      '  --ph-tournament-surface: linear-gradient(145deg, rgba(255,255,255,0.94) 0%, rgba(248,252,247,0.98) 100%);',
      '  --ph-tournament-accent: #f45f34;',
      '  --ph-tournament-accent-soft: rgba(244, 95, 52, 0.12);',
      '  --ph-tournament-success: rgba(228, 250, 236, 0.92);',
      '  --ph-tournament-warning: rgba(255, 242, 225, 0.96);',
      '  --ph-tournament-info: rgba(231, 244, 255, 0.92);',
      '  --ph-tournament-shadow: 0 18px 40px rgba(31, 44, 33, 0.12);',
      '}',
      '.phab-tournaments { color: var(--ph-tournament-ink); }',
      '.phab-tournaments, .phab-tournaments * { box-sizing: border-box; }',
      '.phab-tournaments__shell { display: grid; gap: 18px; }',
      '.phab-tournaments__topbar {',
      '  display: flex;',
      '  gap: 14px;',
      '  align-items: flex-start;',
      '  justify-content: space-between;',
      '  flex-wrap: wrap;',
      '  padding: 20px;',
      '  border-radius: 28px;',
      '  background: linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(246,250,255,0.96) 100%);',
      '  border: 1px solid var(--ph-tournament-line);',
      '  box-shadow: var(--ph-tournament-shadow);',
      '}',
      '.phab-tournaments__eyebrow {',
      '  margin: 0 0 8px;',
      '  font-size: 12px;',
      '  line-height: 1.2;',
      '  letter-spacing: 0.12em;',
      '  text-transform: uppercase;',
      '  color: rgba(31, 44, 33, 0.54);',
      '}',
      '.phab-tournaments__title {',
      '  margin: 0;',
      '  font-size: clamp(24px, 2.8vw, 38px);',
      '  line-height: 0.96;',
      '  letter-spacing: -0.04em;',
      '}',
      '.phab-tournaments__subtitle {',
      '  margin: 10px 0 0;',
      '  max-width: 760px;',
      '  font-size: 15px;',
      '  line-height: 1.5;',
      '  color: var(--ph-tournament-ink-soft);',
      '}',
      '.phab-tournaments__meta { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }',
      '.phab-tournaments__pill {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  min-height: 36px;',
      '  padding: 8px 14px;',
      '  border-radius: 999px;',
      '  background: rgba(31, 44, 33, 0.06);',
      '  font-size: 13px;',
      '  line-height: 1;',
      '  white-space: nowrap;',
      '}',
      '.phab-tournaments__grid {',
      '  display: grid;',
      '  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));',
      '  gap: 18px;',
      '}',
      '.phab-tournaments__card {',
      '  position: relative;',
      '  display: grid;',
      '  gap: 16px;',
      '  min-height: 100%;',
      '  padding: 20px;',
      '  border-radius: 28px;',
      '  background: var(--ph-tournament-surface);',
      '  border: 1px solid var(--ph-tournament-line);',
      '  box-shadow: var(--ph-tournament-shadow);',
      '  overflow: hidden;',
      '}',
      '.phab-tournaments__card::after {',
      '  content: "";',
      '  position: absolute;',
      '  inset: auto -44px -78px auto;',
      '  width: 160px;',
      '  height: 160px;',
      '  border-radius: 999px;',
      '  background: radial-gradient(circle, rgba(255,221,192,0.65) 0%, rgba(255,221,192,0) 72%);',
      '  pointer-events: none;',
      '}',
      '.phab-tournaments__card-head { display: grid; gap: 10px; }',
      '.phab-tournaments__name-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }',
      '.phab-tournaments__name {',
      '  margin: 0;',
      '  font-size: 26px;',
      '  line-height: 0.98;',
      '  letter-spacing: -0.04em;',
      '}',
      '.phab-tournaments__badge {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  min-height: 28px;',
      '  padding: 6px 10px;',
      '  border-radius: 999px;',
      '  background: rgba(0, 109, 255, 0.12);',
      '  color: #005ed9;',
      '  font-size: 12px;',
      '  font-weight: 700;',
      '}',
      '.phab-tournaments__meta-text {',
      '  margin: 0;',
      '  font-size: 14px;',
      '  line-height: 1.55;',
      '  color: rgba(31, 44, 33, 0.76);',
      '}',
      '.phab-tournaments__facts { display: flex; flex-wrap: wrap; gap: 8px; }',
      '.phab-tournaments__fact {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  min-height: 32px;',
      '  padding: 7px 11px;',
      '  border-radius: 999px;',
      '  background: rgba(31, 44, 33, 0.06);',
      '  font-size: 13px;',
      '  line-height: 1;',
      '}',
      '.phab-tournaments__fact--accent { background: var(--ph-tournament-accent-soft); color: #9c3d22; }',
      '.phab-tournaments__fact--ok { background: rgba(197,245,213,0.72); }',
      '.phab-tournaments__tags { display: flex; flex-wrap: wrap; gap: 8px; }',
      '.phab-tournaments__tag {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  min-height: 28px;',
      '  padding: 6px 10px;',
      '  border-radius: 999px;',
      '  background: rgba(31, 44, 33, 0.05);',
      '  font-size: 12px;',
      '  line-height: 1;',
      '}',
      '.phab-tournaments__footer { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }',
      '.phab-tournaments__button,',
      '.phab-tournaments__button-secondary {',
      '  appearance: none;',
      '  border: none;',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  min-height: 46px;',
      '  padding: 12px 18px;',
      '  border-radius: 999px;',
      '  font-size: 14px;',
      '  font-weight: 700;',
      '  line-height: 1;',
      '  text-decoration: none;',
      '  cursor: pointer;',
      '}',
      '.phab-tournaments__button {',
      '  background: linear-gradient(90deg, #f45f34 0%, #f5974c 100%);',
      '  color: #fff;',
      '  box-shadow: 0 14px 30px rgba(244, 95, 52, 0.24);',
      '}',
      '.phab-tournaments__button:disabled { opacity: 0.58; cursor: default; box-shadow: none; }',
      '.phab-tournaments__button-secondary {',
      '  background: rgba(31, 44, 33, 0.08);',
      '  color: var(--ph-tournament-ink);',
      '}',
      '.phab-tournaments__hint {',
      '  margin: 0;',
      '  font-size: 12px;',
      '  line-height: 1.45;',
      '  color: rgba(31, 44, 33, 0.58);',
      '}',
      '.phab-tournaments__status {',
      '  padding: 22px;',
      '  border-radius: 24px;',
      '  background: rgba(255,255,255,0.84);',
      '  border: 1px solid var(--ph-tournament-line);',
      '  box-shadow: var(--ph-tournament-shadow);',
      '  font-size: 15px;',
      '  line-height: 1.55;',
      '}',
      '.phab-tournaments__status-title { margin: 0 0 8px; font-size: 18px; line-height: 1.1; }',
      '.phab-tournaments__backdrop {',
      '  position: fixed;',
      '  inset: 0;',
      '  z-index: 9999;',
      '  display: none;',
      '  align-items: center;',
      '  justify-content: center;',
      '  padding: 16px;',
      '  background: rgba(31, 44, 33, 0.42);',
      '}',
      '.phab-tournaments__backdrop.is-open { display: flex; }',
      '.phab-tournaments__dialog {',
      '  width: min(100%, 580px);',
      '  max-height: calc(100vh - 32px);',
      '  overflow: auto;',
      '  padding: 22px;',
      '  border-radius: 28px;',
      '  background: #fff;',
      '  border: 1px solid rgba(31, 44, 33, 0.08);',
      '  box-shadow: 0 24px 60px rgba(31, 44, 33, 0.18);',
      '}',
      '.phab-tournaments__dialog-title {',
      '  margin: 0 0 8px;',
      '  font-size: 28px;',
      '  line-height: 0.98;',
      '  letter-spacing: -0.04em;',
      '}',
      '.phab-tournaments__dialog-subtitle {',
      '  margin: 0 0 16px;',
      '  color: rgba(31, 44, 33, 0.72);',
      '  line-height: 1.5;',
      '}',
      '.phab-tournaments__dialog-status {',
      '  margin-bottom: 16px;',
      '  padding: 14px 16px;',
      '  border-radius: 18px;',
      '  font-size: 14px;',
      '  line-height: 1.45;',
      '}',
      '.phab-tournaments__dialog-status--info { background: var(--ph-tournament-info); }',
      '.phab-tournaments__dialog-status--success { background: var(--ph-tournament-success); }',
      '.phab-tournaments__dialog-status--warning { background: var(--ph-tournament-warning); }',
      '.phab-tournaments__field { display: grid; gap: 6px; margin-top: 12px; font-size: 13px; }',
      '.phab-tournaments__field input,',
      '.phab-tournaments__field select,',
      '.phab-tournaments__field textarea {',
      '  width: 100%;',
      '  border: 1px solid rgba(31, 44, 33, 0.14);',
      '  border-radius: 14px;',
      '  padding: 12px 13px;',
      '  font-size: 15px;',
      '  background: #fff;',
      '  color: var(--ph-tournament-ink);',
      '}',
      '.phab-tournaments__field textarea { min-height: 86px; resize: vertical; }',
      '.phab-tournaments__dialog-actions {',
      '  display: flex;',
      '  gap: 10px;',
      '  flex-wrap: wrap;',
      '  margin-top: 18px;',
      '}',
      '.phab-tournaments__footnote {',
      '  margin: 14px 0 0;',
      '  font-size: 12px;',
      '  line-height: 1.45;',
      '  color: rgba(31, 44, 33, 0.58);',
      '}',
      '.phab-tournaments--screen .phab-tournaments__topbar { padding: 22px 24px; }',
      '.phab-tournaments--screen .phab-tournaments__grid {',
      '  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));',
      '  gap: 22px;',
      '}',
      '.phab-tournaments--screen .phab-tournaments__card { padding: 24px; }',
      '.phab-tournaments--screen .phab-tournaments__name { font-size: 30px; }',
      '@media (max-width: 767px) {',
      '  .phab-tournaments__topbar { padding: 16px; border-radius: 22px; }',
      '  .phab-tournaments__grid { grid-template-columns: minmax(0, 1fr); }',
      '  .phab-tournaments__card { padding: 18px; border-radius: 22px; }',
      '  .phab-tournaments__dialog { padding: 18px; border-radius: 22px; }',
      '  .phab-tournaments__dialog-title { font-size: 24px; }',
      '  .phab-tournaments__name { font-size: 24px; }',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function normalizeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function normalizeCsv(value) {
    return String(value || '')
      .split(',')
      .map(function (entry) {
        return entry.trim();
      })
      .filter(function (entry) {
        return entry.length > 0;
      });
  }

  function normalizePositiveInteger(value, fallback) {
    var numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return fallback;
    }
    return Math.floor(numericValue);
  }

  function normalizeBoolean(value) {
    var normalized = String(value || '')
      .trim()
      .toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }

  function normalizeRefreshMs(value) {
    var numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return 0;
    }
    return Math.min(900000, Math.max(30000, Math.floor(numericValue)));
  }

  function normalizeApiBaseUrl(value) {
    return String(value || '').trim().replace(/\/$/, '');
  }

  function createElement(tagName, className, textContent) {
    var element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (textContent !== undefined && textContent !== null) {
      element.textContent = String(textContent);
    }
    return element;
  }

  function formatGeneratedAt(value) {
    if (!value) {
      return 'Обновляется автоматически';
    }

    var parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return 'Обновляется автоматически';
    }

    return 'Обновлено ' + parsed.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatTournamentDate(value) {
    if (!value) {
      return 'Дата уточняется';
    }

    var parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }

    return parsed.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatAccessLevels(levels) {
    var list = normalizeArray(levels).filter(Boolean);
    if (list.length === 0) {
      return 'Без ограничений';
    }
    return 'Уровни: ' + list.join(', ');
  }

  function formatSpots(card) {
    var participantsCount = Number(card.participantsCount);
    var maxPlayers = Number(card.maxPlayers);
    if (!Number.isFinite(participantsCount) || !Number.isFinite(maxPlayers) || maxPlayers <= 0) {
      return 'Состав уточняется';
    }
    return String(Math.max(0, participantsCount)) + '/' + String(Math.round(maxPlayers)) + ' мест';
  }

  function createStatusCard(title, description) {
    var card = createElement('div', 'phab-tournaments__status');
    card.appendChild(createElement('h3', 'phab-tournaments__status-title', title));
    card.appendChild(createElement('p', '', description));
    return card;
  }

  function buildRequestUrl(config) {
    var url = new URL(
      normalizeApiBaseUrl(config.apiBaseUrl) + '/tournaments/public/list',
      window.location.href
    );

    if (config.stationIds.length > 0) {
      url.searchParams.set('stationId', config.stationIds.join(','));
    }
    if (config.limit > 0) {
      url.searchParams.set('limit', String(config.limit));
    }
    if (config.includePast) {
      url.searchParams.set('includePast', 'true');
    }

    return url.toString();
  }

  function resolveUrl(value, config) {
    var text = String(value || '').trim();
    if (!text) {
      return '';
    }

    try {
      return new URL(text, normalizeApiBaseUrl(config.apiBaseUrl) + '/').toString();
    } catch (_error) {
      return text;
    }
  }

  function jsonFetch(url, options) {
    var requestOptions = options || {};
    if (!requestOptions.credentials) {
      requestOptions.credentials = 'include';
    }
    requestOptions.headers = Object.assign(
      { Accept: 'application/json' },
      requestOptions.headers || {}
    );

    return fetch(url, requestOptions).then(function (response) {
      if (!response.ok) {
        throw new Error('Request failed with status ' + response.status);
      }
      return response.json();
    });
  }

  function formFetch(url, payload) {
    return jsonFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: new URLSearchParams(payload).toString()
    });
  }

  function isCrossOriginApi(config) {
    try {
      var apiOrigin = new URL(normalizeApiBaseUrl(config.apiBaseUrl) + '/', window.location.href).origin;
      return apiOrigin !== window.location.origin;
    } catch (_error) {
      return false;
    }
  }

  function syncDraft(state, flow) {
    var client = normalizeObject(flow.client);
    if (client.name) {
      state.draft.name = String(client.name);
    }
    if (client.phone) {
      state.draft.phone = String(client.phone);
    }
    if (client.levelLabel) {
      state.draft.levelLabel = String(client.levelLabel);
    }
  }

  function clearAuth(state) {
    if (state.authTimer) {
      window.clearInterval(state.authTimer);
      state.authTimer = 0;
    }
    state.authPending = null;
  }

  function closeDialog(mount, state) {
    clearAuth(state);
    state.flow = null;
    state.outcome = null;
    state.activeJoinUrl = '';
    state.activeItem = null;

    if (state.reloadOnClose) {
      state.reloadOnClose = false;
      loadTournaments(mount, state);
      return;
    }

    renderTournaments(mount, state.payload, state);
  }

  function readDraftFromDialog(dialog, state) {
    var nameField = dialog.querySelector('[name="name"]');
    var phoneField = dialog.querySelector('[name="phone"]');
    var levelField = dialog.querySelector('[name="levelLabel"]');
    var notesField = dialog.querySelector('[name="notes"]');

    state.draft.name = nameField ? String(nameField.value || '').trim() : '';
    state.draft.phone = phoneField ? String(phoneField.value || '').trim() : '';
    state.draft.levelLabel = levelField ? String(levelField.value || '').trim() : '';
    state.draft.notes = notesField ? String(notesField.value || '').trim() : '';
  }

  function createFact(text, modifier) {
    return createElement(
      'span',
      'phab-tournaments__fact' + (modifier ? ' phab-tournaments__fact--' + modifier : ''),
      text
    );
  }

  function createTournamentCard(card, state, mount) {
    var article = createElement('article', 'phab-tournaments__card');
    var head = createElement('div', 'phab-tournaments__card-head');
    var nameRow = createElement('div', 'phab-tournaments__name-row');
    var skin = normalizeObject(card.skin);
    var title = createElement('h3', 'phab-tournaments__name', skin.title || card.name || 'Турнир');
    var metaText = [
      skin.subtitle || formatTournamentDate(card.startsAt),
      card.studioName || '',
      card.trainerName || ''
    ]
      .filter(Boolean)
      .join(' · ');
    var facts = createElement('div', 'phab-tournaments__facts');
    var tags = createElement('div', 'phab-tournaments__tags');
    var footer = createElement('div', 'phab-tournaments__footer');
    var hint = createElement(
      'p',
      'phab-tournaments__hint',
      state.crossOriginApi
        ? 'Кнопка откроет отдельную страницу записи на backend PadelHub.'
        : 'Кнопка откроет LK-авторизацию и проверку уровня перед записью.'
    );
    var primaryButton = createElement(
      'button',
      'phab-tournaments__button',
      skin.ctaLabel || 'Присоединиться'
    );
    var joinUrl = resolveUrl(card.joinUrl, state.config);
    var publicUrl = resolveUrl(card.publicUrl, state.config);

    nameRow.appendChild(title);
    if (skin.badgeLabel) {
      nameRow.appendChild(
        createElement('span', 'phab-tournaments__badge', skin.badgeLabel)
      );
    }

    head.appendChild(nameRow);
    if (metaText) {
      head.appendChild(createElement('p', 'phab-tournaments__meta-text', metaText));
    }
    article.appendChild(head);

    facts.appendChild(createFact(card.tournamentType || 'Турнир', 'accent'));
    facts.appendChild(createFact(formatAccessLevels(card.accessLevels)));
    facts.appendChild(createFact(formatSpots(card), 'ok'));
    if (card.waitlistCount) {
      facts.appendChild(createFact('Лист ожидания: ' + String(card.waitlistCount)));
    }
    article.appendChild(facts);

    normalizeArray(skin.tags).slice(0, 4).forEach(function (tag) {
      tags.appendChild(createElement('span', 'phab-tournaments__tag', tag));
    });
    if (tags.childNodes.length > 0) {
      article.appendChild(tags);
    }

    primaryButton.type = 'button';
    primaryButton.disabled = !joinUrl;
    primaryButton.addEventListener('click', function () {
      openJoinFlow(mount, state, card, joinUrl);
    });

    footer.appendChild(primaryButton);
    if (publicUrl && publicUrl !== joinUrl) {
      var secondaryLink = createElement(
        'a',
        'phab-tournaments__button-secondary',
        'Публичная карточка'
      );
      secondaryLink.href = publicUrl;
      secondaryLink.target = '_blank';
      secondaryLink.rel = 'noopener noreferrer';
      footer.appendChild(secondaryLink);
    }
    footer.appendChild(hint);
    article.appendChild(footer);

    return article;
  }

  function renderDialog(mount, state) {
    var backdrop = createElement(
      'div',
      'phab-tournaments__backdrop'
        + (state.flow || state.outcome || state.authPending ? ' is-open' : '')
    );

    if (!state.flow && !state.outcome && !state.authPending) {
      return backdrop;
    }

    var dialog = createElement('div', 'phab-tournaments__dialog');
    var tournament = normalizeObject(
      state.activeItem || (state.flow && state.flow.tournament) || (state.authPending && state.authPending.tournament)
    );

    backdrop.addEventListener('click', function (event) {
      if (event.target === backdrop) {
        closeDialog(mount, state);
      }
    });

    if (state.authPending) {
      dialog.appendChild(
        createElement(
          'h3',
          'phab-tournaments__dialog-title',
          tournament.name || 'Авторизация через LK'
        )
      );
      dialog.appendChild(
        createElement(
          'p',
          'phab-tournaments__dialog-subtitle',
          formatTournamentDate(tournament.startsAt)
        )
      );
      dialog.appendChild(
        createElement(
          'div',
          'phab-tournaments__dialog-status phab-tournaments__dialog-status--info',
          state.authPending.message
            || 'Откройте личный кабинет, завершите вход и вернитесь на страницу.'
        )
      );

      var authActions = createElement('div', 'phab-tournaments__dialog-actions');
      var authRetryButton = createElement(
        'button',
        'phab-tournaments__button',
        'Открыть LK ещё раз'
      );
      var authCloseButton = createElement(
        'button',
        'phab-tournaments__button-secondary',
        'Закрыть'
      );

      authRetryButton.type = 'button';
      authRetryButton.addEventListener('click', function () {
        if (state.authPending && state.authPending.authUrl) {
          window.open(state.authPending.authUrl, 'padlhub-lk-auth', 'width=460,height=860');
        }
      });

      authCloseButton.type = 'button';
      authCloseButton.addEventListener('click', function () {
        closeDialog(mount, state);
      });

      authActions.appendChild(authRetryButton);
      authActions.appendChild(authCloseButton);
      dialog.appendChild(authActions);
      dialog.appendChild(
        createElement(
          'p',
          'phab-tournaments__footnote',
          'После авторизации виджет сам перепроверит заявку и предложит следующий шаг.'
        )
      );
      backdrop.appendChild(dialog);
      return backdrop;
    }

    if (state.outcome) {
      dialog.appendChild(createElement('h3', 'phab-tournaments__dialog-title', 'Статус заявки'));
      dialog.appendChild(
        createElement(
          'div',
          'phab-tournaments__dialog-status phab-tournaments__dialog-status--success',
          state.outcome.message || 'Заявка отправлена.'
        )
      );
      var outcomeActions = createElement('div', 'phab-tournaments__dialog-actions');
      var outcomeCloseButton = createElement('button', 'phab-tournaments__button', 'Готово');
      outcomeCloseButton.type = 'button';
      outcomeCloseButton.addEventListener('click', function () {
        closeDialog(mount, state);
      });
      outcomeActions.appendChild(outcomeCloseButton);
      dialog.appendChild(outcomeActions);
      backdrop.appendChild(dialog);
      return backdrop;
    }

    var flow = normalizeObject(state.flow);
    var flowTournament = normalizeObject(flow.tournament);
    var needsLevel = normalizeArray(flowTournament.accessLevels).length > 0;
    var statusTone =
      flow.code === 'LEVEL_NOT_ALLOWED'
        ? 'warning'
        : flow.code === 'READY_TO_JOIN'
          ? 'success'
          : 'info';
    var actionLabel =
      flow.code === 'READY_TO_JOIN'
        ? normalizeObject(flowTournament.skin).ctaLabel || 'Подтвердить участие'
        : flow.code === 'LEVEL_NOT_ALLOWED'
          ? 'Проверить ещё раз'
          : 'Продолжить';

    dialog.appendChild(
      createElement(
        'h3',
        'phab-tournaments__dialog-title',
        normalizeObject(flowTournament.skin).title || flowTournament.name || 'Турнир'
      )
    );
    dialog.appendChild(
      createElement(
        'p',
        'phab-tournaments__dialog-subtitle',
        normalizeObject(flowTournament.skin).subtitle || formatTournamentDate(flowTournament.startsAt)
      )
    );
    dialog.appendChild(
      createElement(
        'div',
        'phab-tournaments__dialog-status phab-tournaments__dialog-status--' + statusTone,
        flow.message || 'Проверьте данные и продолжайте.'
      )
    );

    var nameField = createElement('label', 'phab-tournaments__field');
    nameField.appendChild(document.createTextNode('Имя и фамилия'));
    var nameInput = document.createElement('input');
    nameInput.name = 'name';
    nameInput.type = 'text';
    nameInput.placeholder = 'Как к вам обращаться';
    nameInput.value = state.draft.name || '';
    nameField.appendChild(nameInput);
    dialog.appendChild(nameField);

    var phoneField = createElement('label', 'phab-tournaments__field');
    phoneField.appendChild(document.createTextNode('Телефон'));
    var phoneInput = document.createElement('input');
    phoneInput.name = 'phone';
    phoneInput.type = 'tel';
    phoneInput.placeholder = '+7 999 123-45-67';
    phoneInput.value = state.draft.phone || '';
    phoneField.appendChild(phoneInput);
    dialog.appendChild(phoneField);

    if (needsLevel) {
      var levelField = createElement('label', 'phab-tournaments__field');
      levelField.appendChild(document.createTextNode('Уровень игрока'));
      var levelSelect = document.createElement('select');
      levelSelect.name = 'levelLabel';
      var placeholderOption = document.createElement('option');
      placeholderOption.value = '';
      placeholderOption.textContent = 'Выберите уровень';
      levelSelect.appendChild(placeholderOption);
      LEVEL_OPTIONS.forEach(function (level) {
        var option = document.createElement('option');
        option.value = level;
        option.textContent = level;
        if (state.draft.levelLabel === level) {
          option.selected = true;
        }
        levelSelect.appendChild(option);
      });
      levelField.appendChild(levelSelect);
      dialog.appendChild(levelField);
    }

    var notesField = createElement('label', 'phab-tournaments__field');
    notesField.appendChild(document.createTextNode('Комментарий для организатора'));
    var notesInput = document.createElement('textarea');
    notesInput.name = 'notes';
    notesInput.placeholder = 'Если нужно, оставьте заметку для организатора';
    notesInput.value = state.draft.notes || '';
    notesField.appendChild(notesInput);
    dialog.appendChild(notesField);

    var actions = createElement('div', 'phab-tournaments__dialog-actions');
    var primaryButton = createElement('button', 'phab-tournaments__button', actionLabel);
    var secondaryButton = createElement(
      'button',
      'phab-tournaments__button-secondary',
      flow.code === 'LEVEL_NOT_ALLOWED' && flow.waitlistAllowed ? 'В лист ожидания' : 'Закрыть'
    );

    primaryButton.type = 'button';
    primaryButton.addEventListener('click', function () {
      readDraftFromDialog(dialog, state);
      submitJoin(mount, state, false);
    });

    secondaryButton.type = 'button';
    if (flow.code === 'LEVEL_NOT_ALLOWED' && flow.waitlistAllowed) {
      secondaryButton.addEventListener('click', function () {
        readDraftFromDialog(dialog, state);
        submitJoin(mount, state, true);
      });
    } else {
      secondaryButton.addEventListener('click', function () {
        closeDialog(mount, state);
      });
    }

    actions.appendChild(primaryButton);
    actions.appendChild(secondaryButton);
    dialog.appendChild(actions);
    dialog.appendChild(
      createElement(
        'p',
        'phab-tournaments__footnote',
        'Если уровень не совпадает с условиями турнира, можно оставить заявку в лист ожидания.'
      )
    );

    backdrop.appendChild(dialog);
    return backdrop;
  }

  function renderTournaments(mount, payload, state) {
    var response = normalizeObject(payload);
    var items = normalizeArray(response.items).map(function (entry) {
      return normalizeObject(entry);
    });
    var root = createElement(
      'section',
      'phab-tournaments phab-tournaments--' + (state.config.variant || 'embed')
    );
    var shell = createElement('div', 'phab-tournaments__shell');
    var topbar = createElement('div', 'phab-tournaments__topbar');
    var intro = createElement('div', 'phab-tournaments__intro');
    var meta = createElement('div', 'phab-tournaments__meta');
    var title = createElement('h2', 'phab-tournaments__title', state.config.title);
    var subtitle = createElement(
      'p',
      'phab-tournaments__subtitle',
      state.config.subtitle
    );
    var grid = createElement('div', 'phab-tournaments__grid');

    state.payload = response;
    state.items = items;

    intro.appendChild(createElement('p', 'phab-tournaments__eyebrow', 'Public Tournament Showcase'));
    intro.appendChild(title);
    intro.appendChild(subtitle);

    meta.appendChild(
      createElement(
        'span',
        'phab-tournaments__pill',
        String(items.length) + ' турниров'
      )
    );
    meta.appendChild(
      createElement(
        'span',
        'phab-tournaments__pill',
        formatGeneratedAt(response.generatedAt)
      )
    );
    if (state.config.stationIds.length > 0) {
      meta.appendChild(
        createElement(
          'span',
          'phab-tournaments__pill',
          'Станции: ' + state.config.stationIds.join(', ')
        )
      );
    }
    if (state.config.includePast) {
      meta.appendChild(
        createElement(
          'span',
          'phab-tournaments__pill',
          'Есть прошедшие турниры'
        )
      );
    }

    topbar.appendChild(intro);
    topbar.appendChild(meta);
    shell.appendChild(topbar);

    if (items.length === 0) {
      grid.appendChild(
        createStatusCard(
          'Пока нет доступных турниров',
          'Проверьте фильтры stationId/includePast или убедитесь, что у турниров есть public URL.'
        )
      );
    } else {
      items.forEach(function (card) {
        grid.appendChild(createTournamentCard(card, state, mount));
      });
    }

    shell.appendChild(grid);
    root.appendChild(shell);

    mount.innerHTML = '';
    mount.appendChild(root);
    mount.appendChild(renderDialog(mount, state));
  }

  function renderLoading(mount) {
    mount.innerHTML = '';
    mount.appendChild(
      createStatusCard(
        'Загружаем турниры',
        'Собираем публичную витрину турниров, чтобы её можно было показать на странице или в Tilda.'
      )
    );
  }

  function renderError(mount, message) {
    mount.innerHTML = '';
    mount.appendChild(
      createStatusCard(
        'Не удалось загрузить турниры',
        message
          || 'Проверьте data-api-base, доступность `/api/tournaments/public/list` и public URL турниров.'
      )
    );
  }

  function handleJoinResponse(mount, state, payload) {
    var response = normalizeObject(payload);
    if (response.code && response.tournament) {
      handleFlow(mount, state, response);
      return;
    }

    clearAuth(state);
    state.flow = null;
    state.outcome = {
      ok: response.ok !== false,
      message: String(response.message || 'Заявка отправлена.')
    };
    state.reloadOnClose = Boolean(response.ok);
    renderTournaments(mount, state.payload, state);
  }

  function startAuthPolling(mount, state, flow) {
    clearAuth(state);
    state.flow = null;
    state.authPending = flow;
    renderTournaments(mount, state.payload, state);

    if (!flow.authUrl) {
      return;
    }

    var popup = window.open(flow.authUrl, 'padlhub-lk-auth', 'width=460,height=860');
    if (!popup) {
      window.location.href = flow.authUrl;
      return;
    }

    var attempts = 0;
    var pollMs = normalizePositiveInteger(flow.authPollMs, 1500);
    var maxAttempts = Math.ceil(120000 / pollMs);
    state.authTimer = window.setInterval(function () {
      attempts += 1;
      jsonFetch(flow.authCheckUrl || state.activeJoinUrl + '?format=json')
        .then(function (nextFlow) {
          if (nextFlow && nextFlow.code === 'AUTH_REQUIRED') {
            if (attempts >= maxAttempts) {
              clearAuth(state);
              state.outcome = {
                ok: false,
                message:
                  'LK открылся, но авторизация для турнира не подтвердилась. Повторите попытку.'
              };
              renderTournaments(mount, state.payload, state);
            }
            return;
          }

          clearAuth(state);
          if (!popup.closed) {
            popup.close();
          }
          handleFlow(mount, state, nextFlow);
        })
        .catch(function () {
          if (attempts >= maxAttempts) {
            clearAuth(state);
            state.outcome = {
              ok: false,
              message: 'Не удалось подтвердить авторизацию через LK. Повторите попытку.'
            };
            renderTournaments(mount, state.payload, state);
          }
        });
    }, pollMs);
  }

  function handleFlow(mount, state, flow) {
    syncDraft(state, flow);
    state.outcome = null;

    if (flow.code === 'AUTH_REQUIRED' && flow.authUrl) {
      startAuthPolling(mount, state, flow);
      return;
    }

    clearAuth(state);
    if (flow.code === 'ALREADY_REGISTERED' || flow.code === 'ALREADY_WAITLISTED') {
      state.flow = null;
      state.outcome = {
        ok: true,
        message: String(flow.message || 'Заявка уже существует.')
      };
      renderTournaments(mount, state.payload, state);
      return;
    }

    state.flow = flow;
    renderTournaments(mount, state.payload, state);
  }

  function openJoinFlow(mount, state, item, joinUrl) {
    if (!joinUrl) {
      return;
    }

    if (state.crossOriginApi) {
      window.location.assign(joinUrl);
      return;
    }

    state.activeJoinUrl = joinUrl;
    state.activeItem = item;
    state.outcome = null;
    state.flow = null;
    clearAuth(state);

    var flowUrl = new URL(joinUrl, window.location.href);
    flowUrl.searchParams.set('format', 'json');
    jsonFetch(flowUrl.toString())
      .then(function (payload) {
        handleFlow(mount, state, payload);
      })
      .catch(function (error) {
        state.outcome = {
          ok: false,
          message: 'Не удалось открыть join-flow: ' + error.message
        };
        renderTournaments(mount, state.payload, state);
      });
  }

  function submitJoin(mount, state, waitlist) {
    if (!state.activeJoinUrl) {
      return;
    }

    formFetch(state.activeJoinUrl, {
      format: 'json',
      name: state.draft.name,
      phone: state.draft.phone,
      levelLabel: state.draft.levelLabel,
      notes: state.draft.notes,
      waitlist: waitlist ? '1' : '0'
    })
      .then(function (payload) {
        handleJoinResponse(mount, state, payload);
      })
      .catch(function (error) {
        state.outcome = {
          ok: false,
          message: 'Не удалось отправить заявку: ' + error.message
        };
        renderTournaments(mount, state.payload, state);
      });
  }

  function loadTournaments(mount, state) {
    renderLoading(mount);

    return jsonFetch(buildRequestUrl(state.config), {
      credentials: state.crossOriginApi ? 'omit' : 'include'
    })
      .then(function (payload) {
        state.payload = payload;
        renderTournaments(mount, payload, state);
      })
      .catch(function (error) {
        renderError(mount, 'Проверьте доступность каталога турниров: ' + error.message);
      });
  }

  function readConfig(mount) {
    var dataset = mount.dataset || {};
    var title = String(dataset.title || '').trim();
    var subtitle = String(dataset.subtitle || '').trim();

    return {
      apiBaseUrl: normalizeApiBaseUrl(dataset.apiBase || DEFAULTS.apiBaseUrl),
      stationIds: normalizeCsv(dataset.stationIds || ''),
      limit: normalizePositiveInteger(dataset.limit, DEFAULTS.limit),
      includePast: normalizeBoolean(dataset.includePast),
      refreshMs: normalizeRefreshMs(dataset.refreshMs),
      variant: String(dataset.variant || DEFAULTS.variant).trim() || DEFAULTS.variant,
      title: title || DEFAULTS.title,
      subtitle: subtitle || DEFAULTS.subtitle
    };
  }

  function initMount(mount) {
    if (!mount || mount.__phabTournamentsInitialized) {
      return;
    }

    var config = readConfig(mount);
    if (!config.apiBaseUrl) {
      renderError(mount);
      return;
    }

    var state = {
      config: config,
      crossOriginApi: isCrossOriginApi(config),
      payload: { items: [] },
      items: [],
      draft: {
        name: '',
        phone: '',
        levelLabel: '',
        notes: ''
      },
      activeJoinUrl: '',
      activeItem: null,
      flow: null,
      outcome: null,
      authPending: null,
      authTimer: 0,
      reloadOnClose: false
    };

    mount.__phabTournamentsInitialized = true;
    mount.__phabTournamentsState = state;
    loadTournaments(mount, state);

    if (config.refreshMs > 0) {
      mount.__phabTournamentsRefreshTimer = window.setInterval(function () {
        loadTournaments(mount, state);
      }, config.refreshMs);
    }
  }

  function initAll() {
    ensureStyles();

    var mounts = document.querySelectorAll('[data-ph-tournaments-showcase]');
    Array.prototype.forEach.call(mounts, function (mount) {
      initMount(mount);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
