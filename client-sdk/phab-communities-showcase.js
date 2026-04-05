(function () {
  var STYLE_ID = 'phab-communities-showcase-style';
  var DEFAULT_API_BASE_URL = inferApiBaseUrl(document.currentScript && document.currentScript.src);
  var DEFAULTS = {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    stationIds: [],
    tags: [],
    limit: 12,
    refreshMs: 0,
    variant: 'embed'
  };

  function inferApiBaseUrl(scriptSrc) {
    if (!scriptSrc) {
      return '';
    }

    try {
      var parsed = new URL(scriptSrc, window.location.href);
      parsed.pathname = parsed.pathname.replace(
        /\/client-script\/communities-showcase(?:\.download)?\.js$/,
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
      '  --ph-community-ink: #1f2c21;',
      '  --ph-community-ink-soft: rgba(31, 44, 33, 0.68);',
      '  --ph-community-line: rgba(31, 44, 33, 0.1);',
      '  --ph-community-card: rgba(255, 255, 255, 0.88);',
      '  --ph-community-surface: linear-gradient(145deg, rgba(255,255,255,0.92) 0%, rgba(248,252,247,0.94) 100%);',
      '  --ph-community-accent: #ff6f3d;',
      '  --ph-community-accent-soft: rgba(255, 111, 61, 0.14);',
      '  --ph-community-mint: #c5f5d5;',
      '  --ph-community-blue: #d8ecff;',
      '  --ph-community-shadow: 0 18px 40px rgba(31, 44, 33, 0.12);',
      '}',
      '.phab-communities { color: var(--ph-community-ink); }',
      '.phab-communities, .phab-communities * { box-sizing: border-box; }',
      '.phab-communities__shell { display: grid; gap: 18px; }',
      '.phab-communities__topbar {',
      '  display: flex;',
      '  gap: 12px;',
      '  align-items: flex-start;',
      '  justify-content: space-between;',
      '  flex-wrap: wrap;',
      '  padding: 18px 20px;',
      '  border-radius: 26px;',
      '  background: linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(244,249,255,0.95) 100%);',
      '  border: 1px solid var(--ph-community-line);',
      '  box-shadow: var(--ph-community-shadow);',
      '}',
      '.phab-communities__eyebrow {',
      '  margin: 0 0 8px;',
      '  font-size: 12px;',
      '  line-height: 1.2;',
      '  letter-spacing: 0.12em;',
      '  text-transform: uppercase;',
      '  color: rgba(31, 44, 33, 0.54);',
      '}',
      '.phab-communities__title {',
      '  margin: 0;',
      '  font-size: clamp(24px, 2.8vw, 38px);',
      '  line-height: 0.96;',
      '  letter-spacing: -0.04em;',
      '}',
      '.phab-communities__subtitle {',
      '  margin: 10px 0 0;',
      '  max-width: 760px;',
      '  font-size: 15px;',
      '  line-height: 1.5;',
      '  color: var(--ph-community-ink-soft);',
      '}',
      '.phab-communities__meta { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }',
      '.phab-communities__pill {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  min-height: 36px;',
      '  padding: 8px 14px;',
      '  border-radius: 999px;',
      '  background: rgba(31, 44, 33, 0.06);',
      '  color: var(--ph-community-ink);',
      '  font-size: 13px;',
      '  line-height: 1;',
      '  white-space: nowrap;',
      '}',
      '.phab-communities__grid {',
      '  display: grid;',
      '  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));',
      '  gap: 18px;',
      '}',
      '.phab-communities__card {',
      '  position: relative;',
      '  display: grid;',
      '  gap: 16px;',
      '  min-height: 100%;',
      '  padding: 20px;',
      '  border-radius: 28px;',
      '  background: var(--ph-community-surface);',
      '  border: 1px solid var(--ph-community-line);',
      '  box-shadow: var(--ph-community-shadow);',
      '  overflow: hidden;',
      '}',
      '.phab-communities__card::after {',
      '  content: "";',
      '  position: absolute;',
      '  inset: auto -40px -70px auto;',
      '  width: 150px;',
      '  height: 150px;',
      '  border-radius: 999px;',
      '  background: radial-gradient(circle, rgba(197,245,213,0.54) 0%, rgba(197,245,213,0) 72%);',
      '  pointer-events: none;',
      '}',
      '.phab-communities__card-head { display: flex; gap: 14px; align-items: center; }',
      '.phab-communities__logo {',
      '  width: 68px;',
      '  height: 68px;',
      '  flex: 0 0 68px;',
      '  border-radius: 22px;',
      '  overflow: hidden;',
      '  background: linear-gradient(135deg, #1f2c21 0%, #31533c 100%);',
      '  color: #fff;',
      '  display: grid;',
      '  place-items: center;',
      '  font-size: 24px;',
      '  font-weight: 800;',
      '  letter-spacing: -0.03em;',
      '}',
      '.phab-communities__logo img { width: 100%; height: 100%; object-fit: cover; display: block; }',
      '.phab-communities__name {',
      '  margin: 0;',
      '  font-size: 24px;',
      '  line-height: 1;',
      '  letter-spacing: -0.04em;',
      '}',
      '.phab-communities__name-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }',
      '.phab-communities__verified {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  min-width: 28px;',
      '  height: 28px;',
      '  padding: 0 8px;',
      '  border-radius: 999px;',
      '  background: rgba(0, 109, 255, 0.12);',
      '  color: #005ed9;',
      '  font-size: 12px;',
      '  font-weight: 700;',
      '}',
      '.phab-communities__location {',
      '  margin: 6px 0 0;',
      '  font-size: 13px;',
      '  line-height: 1.4;',
      '  color: var(--ph-community-ink-soft);',
      '}',
      '.phab-communities__description {',
      '  margin: 0;',
      '  font-size: 15px;',
      '  line-height: 1.55;',
      '  color: rgba(31, 44, 33, 0.84);',
      '  display: -webkit-box;',
      '  -webkit-line-clamp: 4;',
      '  -webkit-box-orient: vertical;',
      '  overflow: hidden;',
      '}',
      '.phab-communities__facts { display: flex; flex-wrap: wrap; gap: 8px; }',
      '.phab-communities__fact {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 6px;',
      '  min-height: 34px;',
      '  padding: 7px 12px;',
      '  border-radius: 999px;',
      '  background: rgba(31, 44, 33, 0.06);',
      '  font-size: 13px;',
      '  line-height: 1;',
      '}',
      '.phab-communities__fact--members { background: var(--ph-community-mint); }',
      '.phab-communities__fact--station { background: var(--ph-community-blue); }',
      '.phab-communities__tags { display: flex; flex-wrap: wrap; gap: 8px; }',
      '.phab-communities__tag {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  min-height: 28px;',
      '  padding: 6px 10px;',
      '  border-radius: 999px;',
      '  background: rgba(255, 111, 61, 0.12);',
      '  color: #ab3f1b;',
      '  font-size: 12px;',
      '  line-height: 1;',
      '}',
      '.phab-communities__footer {',
      '  display: flex;',
      '  align-items: flex-end;',
      '  justify-content: space-between;',
      '  gap: 12px;',
      '  flex-wrap: wrap;',
      '}',
      '.phab-communities__hint {',
      '  margin: 0;',
      '  font-size: 12px;',
      '  line-height: 1.45;',
      '  color: rgba(31, 44, 33, 0.58);',
      '}',
      '.phab-communities__button {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  min-height: 46px;',
      '  padding: 12px 18px;',
      '  border-radius: 999px;',
      '  background: linear-gradient(90deg, #ff6f3d 0%, #ff8a3d 100%);',
      '  color: #fff;',
      '  text-decoration: none;',
      '  font-size: 14px;',
      '  font-weight: 700;',
      '  line-height: 1;',
      '  box-shadow: 0 14px 30px rgba(255, 111, 61, 0.24);',
      '}',
      '.phab-communities__status {',
      '  padding: 22px;',
      '  border-radius: 24px;',
      '  background: rgba(255,255,255,0.82);',
      '  border: 1px solid var(--ph-community-line);',
      '  box-shadow: var(--ph-community-shadow);',
      '  color: var(--ph-community-ink);',
      '  font-size: 15px;',
      '  line-height: 1.55;',
      '}',
      '.phab-communities__status-title { margin: 0 0 8px; font-size: 18px; line-height: 1.1; }',
      '.phab-communities--screen .phab-communities__topbar { padding: 22px 24px; }',
      '.phab-communities--screen .phab-communities__grid {',
      '  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));',
      '  gap: 22px;',
      '}',
      '.phab-communities--screen .phab-communities__card { padding: 24px; }',
      '.phab-communities--screen .phab-communities__name { font-size: 28px; }',
      '.phab-communities--screen .phab-communities__description { font-size: 16px; }',
      '.phab-communities--screen .phab-communities__button { min-height: 50px; font-size: 15px; }',
      '@media (max-width: 767px) {',
      '  .phab-communities__topbar { padding: 16px; border-radius: 20px; }',
      '  .phab-communities__grid { grid-template-columns: minmax(0, 1fr); }',
      '  .phab-communities__card { padding: 18px; border-radius: 22px; }',
      '  .phab-communities__logo { width: 58px; height: 58px; flex-basis: 58px; border-radius: 18px; }',
      '  .phab-communities__name { font-size: 22px; }',
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

  function formatMembersLabel(count) {
    var numericCount = Number(count);
    if (!Number.isFinite(numericCount) || numericCount <= 0) {
      return 'Новое сообщество';
    }
    return String(Math.round(numericCount)) + ' участников';
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

  function createStatusCard(title, description) {
    var card = createElement('div', 'phab-communities__status');
    card.appendChild(createElement('h3', 'phab-communities__status-title', title));
    card.appendChild(createElement('p', '', description));
    return card;
  }

  function createLogo(card) {
    var logo = createElement('div', 'phab-communities__logo');
    if (card.logo) {
      var image = document.createElement('img');
      image.alt = card.name || 'Community logo';
      image.src = card.logo;
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.onerror = function () {
        image.remove();
        logo.textContent = buildInitials(card.name);
      };
      logo.appendChild(image);
      return logo;
    }

    logo.textContent = buildInitials(card.name);
    return logo;
  }

  function buildInitials(name) {
    var words = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);

    if (words.length === 0) {
      return 'PH';
    }

    return words
      .map(function (word) {
        return word.charAt(0).toUpperCase();
      })
      .join('');
  }

  function createFact(label, modifier) {
    return createElement(
      'span',
      'phab-communities__fact' + (modifier ? ' phab-communities__fact--' + modifier : ''),
      label
    );
  }

  function createCommunityCard(card) {
    var article = createElement('article', 'phab-communities__card');
    var head = createElement('div', 'phab-communities__card-head');
    var titleWrap = createElement('div', 'phab-communities__title-wrap');
    var nameRow = createElement('div', 'phab-communities__name-row');
    var name = createElement('h3', 'phab-communities__name', card.name || 'Сообщество');

    head.appendChild(createLogo(card));
    nameRow.appendChild(name);
    if (card.isVerified) {
      nameRow.appendChild(createElement('span', 'phab-communities__verified', 'PRO'));
    }

    titleWrap.appendChild(nameRow);
    if (card.stationName || card.city) {
      titleWrap.appendChild(
        createElement(
          'p',
          'phab-communities__location',
          [card.stationName, card.city].filter(Boolean).join(' · ')
        )
      );
    }

    head.appendChild(titleWrap);
    article.appendChild(head);

    if (card.description) {
      article.appendChild(
        createElement('p', 'phab-communities__description', card.description)
      );
    }

    var facts = createElement('div', 'phab-communities__facts');
    facts.appendChild(createFact(formatMembersLabel(card.membersCount), 'members'));
    if (card.stationName) {
      facts.appendChild(createFact(card.stationName, 'station'));
    }
    if (card.joinLabel) {
      facts.appendChild(createFact(card.joinLabel));
    }
    article.appendChild(facts);

    var tags = normalizeArray(card.focusTags && card.focusTags.length ? card.focusTags : card.tags);
    if (tags.length > 0) {
      var tagsWrap = createElement('div', 'phab-communities__tags');
      tags.slice(0, 4).forEach(function (tag) {
        tagsWrap.appendChild(createElement('span', 'phab-communities__tag', tag));
      });
      article.appendChild(tagsWrap);
    }

    var footer = createElement('div', 'phab-communities__footer');
    footer.appendChild(
      createElement(
        'p',
        'phab-communities__hint',
        card.publicUrl && card.publicUrl !== card.joinUrl
          ? 'У сообщества есть отдельная публичная страница.'
          : 'Ссылка на вступление откроется в новом окне.'
      )
    );

    var button = createElement('a', 'phab-communities__button', card.joinLabel || 'Вступить');
    button.href = String(card.joinUrl || '#');
    button.target = '_blank';
    button.rel = 'noopener noreferrer';
    footer.appendChild(button);

    article.appendChild(footer);
    return article;
  }

  function renderCommunities(mount, payload, config) {
    var response = normalizeObject(payload);
    var items = normalizeArray(response.items).map(function (entry) {
      return normalizeObject(entry);
    });
    var root = createElement(
      'section',
      'phab-communities phab-communities--' + (config.variant || 'embed')
    );
    var shell = createElement('div', 'phab-communities__shell');
    var topbar = createElement('div', 'phab-communities__topbar');
    var intro = createElement('div', 'phab-communities__intro');
    var meta = createElement('div', 'phab-communities__meta');
    var title = createElement('h2', 'phab-communities__title', 'Сообщества PadelHub');
    var subtitle = createElement(
      'p',
      'phab-communities__subtitle',
      'Показываем активные сообщества, в которые можно вступить с сайта, Tilda-страницы или экрана на ресепшен.'
    );
    var grid = createElement('div', 'phab-communities__grid');

    intro.appendChild(createElement('p', 'phab-communities__eyebrow', 'Public Community Feed'));
    intro.appendChild(title);
    intro.appendChild(subtitle);

    meta.appendChild(
      createElement(
        'span',
        'phab-communities__pill',
        String(items.length) + ' сообществ'
      )
    );
    meta.appendChild(
      createElement(
        'span',
        'phab-communities__pill',
        formatGeneratedAt(response.generatedAt)
      )
    );

    if (config.stationIds.length > 0) {
      meta.appendChild(
        createElement(
          'span',
          'phab-communities__pill',
          'Станции: ' + config.stationIds.join(', ')
        )
      );
    }

    if (config.tags.length > 0) {
      meta.appendChild(
        createElement(
          'span',
          'phab-communities__pill',
          'Теги: ' + config.tags.join(', ')
        )
      );
    }

    topbar.appendChild(intro);
    topbar.appendChild(meta);
    shell.appendChild(topbar);

    if (items.length === 0) {
      grid.appendChild(
        createStatusCard(
          'Пока нет подходящих сообществ',
          'Проверьте фильтры stationId/tag или добавьте invite/public URL в карточки сообществ.'
        )
      );
    } else {
      items.forEach(function (card) {
        grid.appendChild(createCommunityCard(card));
      });
    }

    shell.appendChild(grid);
    root.appendChild(shell);

    mount.innerHTML = '';
    mount.appendChild(root);
  }

  function renderLoading(mount) {
    mount.innerHTML = '';
    mount.appendChild(
      createStatusCard(
        'Загружаем сообщества',
        'Сейчас подтянем публичную витрину, чтобы её можно было показать на странице или на экране.'
      )
    );
  }

  function renderError(mount) {
    mount.innerHTML = '';
    mount.appendChild(
      createStatusCard(
        'Не удалось загрузить сообщества',
        'Проверьте data-api-base, доступность `/api/communities/public/list` и наличие публичных invite/public ссылок у сообществ.'
      )
    );
  }

  function buildRequestUrl(config) {
    var url = new URL(
      normalizeApiBaseUrl(config.apiBaseUrl) + '/communities/public/list',
      window.location.href
    );

    if (config.stationIds.length > 0) {
      url.searchParams.set('stationId', config.stationIds.join(','));
    }
    if (config.tags.length > 0) {
      url.searchParams.set('tag', config.tags.join(','));
    }
    if (config.limit > 0) {
      url.searchParams.set('limit', String(config.limit));
    }

    return url.toString();
  }

  function loadCommunities(mount, config) {
    renderLoading(mount);

    return fetch(buildRequestUrl(config), {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Request failed with status ' + response.status);
        }
        return response.json();
      })
      .then(function (payload) {
        renderCommunities(mount, payload, config);
      })
      .catch(function (_error) {
        renderError(mount);
      });
  }

  function readConfig(mount) {
    var dataset = mount.dataset || {};
    return {
      apiBaseUrl: normalizeApiBaseUrl(dataset.apiBase || DEFAULTS.apiBaseUrl),
      stationIds: normalizeCsv(dataset.stationIds || ''),
      tags: normalizeCsv(dataset.tags || ''),
      limit: normalizePositiveInteger(dataset.limit, DEFAULTS.limit),
      refreshMs: normalizeRefreshMs(dataset.refreshMs),
      variant: String(dataset.variant || DEFAULTS.variant).trim() || DEFAULTS.variant
    };
  }

  function initMount(mount) {
    if (!mount || mount.__phabCommunitiesInitialized) {
      return;
    }

    var config = readConfig(mount);
    if (!config.apiBaseUrl) {
      renderError(mount);
      return;
    }

    mount.__phabCommunitiesInitialized = true;
    loadCommunities(mount, config);

    if (config.refreshMs > 0) {
      mount.__phabCommunitiesTimer = window.setInterval(function () {
        loadCommunities(mount, config);
      }, config.refreshMs);
    }
  }

  function initAll() {
    ensureStyles();

    var mounts = document.querySelectorAll('[data-ph-communities-showcase]');
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
