(function () {
  var STYLE_ID = 'phab-community-feed-style';
  var DEFAULT_API_BASE_URL = inferApiBaseUrl(document.currentScript && document.currentScript.src);
  var DEFAULTS = {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    communityId: '',
    limit: 8,
    refreshMs: 0,
    variant: 'embed',
    title: '',
    subtitle: ''
  };

  function inferApiBaseUrl(scriptSrc) {
    if (!scriptSrc) {
      return '';
    }

    try {
      var parsed = new URL(scriptSrc, window.location.href);
      parsed.pathname = parsed.pathname.replace(
        /\/client-script\/community-feed(?:\.download)?\.js$/,
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
      '  --ph-feed-ink: #1f2c21;',
      '  --ph-feed-ink-soft: rgba(31, 44, 33, 0.72);',
      '  --ph-feed-line: rgba(31, 44, 33, 0.09);',
      '  --ph-feed-card: rgba(255, 255, 255, 0.90);',
      '  --ph-feed-surface: linear-gradient(145deg, rgba(255,255,255,0.95) 0%, rgba(244,250,247,0.98) 100%);',
      '  --ph-feed-accent: #ff6f3d;',
      '  --ph-feed-accent-soft: rgba(255, 111, 61, 0.14);',
      '  --ph-feed-blue: #e5f1ff;',
      '  --ph-feed-green: #d7f7e2;',
      '  --ph-feed-yellow: #fff4cf;',
      '  --ph-feed-hub-cream: #fff6e8;',
      '  --ph-feed-hub-orange-deep: #ff5a3c;',
      '  --ph-feed-hub-green: #c9f2d8;',
      '  --ph-feed-shadow: 0 18px 40px rgba(31, 44, 33, 0.12);',
      '}',
      '.phab-community-feed { color: var(--ph-feed-ink); }',
      '.phab-community-feed, .phab-community-feed * { box-sizing: border-box; }',
      '.phab-community-feed__shell { display: grid; gap: 18px; }',
      '.phab-community-feed__topbar {',
      '  display: grid;',
      '  grid-template-columns: minmax(0, 1fr) auto;',
      '  gap: 16px;',
      '  align-items: flex-start;',
      '  padding: 20px;',
      '  border-radius: 28px;',
      '  background: linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(242,248,255,0.96) 100%);',
      '  border: 1px solid var(--ph-feed-line);',
      '  box-shadow: var(--ph-feed-shadow);',
      '}',
      '.phab-community-feed__identity { display: flex; gap: 16px; align-items: center; min-width: 0; }',
      '.phab-community-feed__logo {',
      '  width: 72px;',
      '  height: 72px;',
      '  flex: 0 0 72px;',
      '  display: grid;',
      '  place-items: center;',
      '  border-radius: 24px;',
      '  overflow: hidden;',
      '  background: linear-gradient(135deg, #1f2c21 0%, #35553f 100%);',
      '  color: #fff;',
      '  font-size: 24px;',
      '  font-weight: 800;',
      '  letter-spacing: -0.04em;',
      '}',
      '.phab-community-feed__logo img { width: 100%; height: 100%; object-fit: cover; display: block; }',
      '.phab-community-feed__eyebrow {',
      '  margin: 0 0 8px;',
      '  font-size: 12px;',
      '  line-height: 1.2;',
      '  letter-spacing: 0.14em;',
      '  text-transform: uppercase;',
      '  color: rgba(31, 44, 33, 0.54);',
      '}',
      '.phab-community-feed__title {',
      '  margin: 0;',
      '  font-size: clamp(24px, 2.7vw, 38px);',
      '  line-height: 0.98;',
      '  letter-spacing: -0.04em;',
      '}',
      '.phab-community-feed__subtitle {',
      '  margin: 10px 0 0;',
      '  max-width: 860px;',
      '  font-size: 15px;',
      '  line-height: 1.5;',
      '  color: var(--ph-feed-ink-soft);',
      '}',
      '.phab-community-feed__meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }',
      '.phab-community-feed__pill {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  min-height: 34px;',
      '  padding: 8px 12px;',
      '  border-radius: 999px;',
      '  background: rgba(31, 44, 33, 0.06);',
      '  font-size: 13px;',
      '  line-height: 1;',
      '}',
      '.phab-community-feed__pill--accent { background: var(--ph-feed-accent-soft); color: #ac441f; }',
      '.phab-community-feed__actions { display: flex; justify-content: flex-end; }',
      '.phab-community-feed__button {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  min-height: 48px;',
      '  padding: 12px 18px;',
      '  border-radius: 999px;',
      '  background: linear-gradient(90deg, #ff6f3d 0%, #ff8b45 100%);',
      '  color: #fff;',
      '  text-decoration: none;',
      '  font-size: 14px;',
      '  font-weight: 700;',
      '  line-height: 1;',
      '  box-shadow: 0 14px 30px rgba(255, 111, 61, 0.24);',
      '}',
      '.phab-community-feed__grid {',
      '  display: grid;',
      '  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));',
      '  gap: 18px;',
      '}',
      '.phab-community-feed__card {',
      '  display: grid;',
      '  gap: 14px;',
      '  min-height: 100%;',
      '  padding: 18px;',
      '  border-radius: 26px;',
      '  background: var(--ph-feed-surface);',
      '  border: 1px solid var(--ph-feed-line);',
      '  box-shadow: var(--ph-feed-shadow);',
      '  overflow: hidden;',
      '}',
      '.phab-community-feed__card--tournament-skin {',
      '  position: relative;',
      '  gap: 16px;',
      '  background:',
      '    radial-gradient(circle at 100% 0%, rgba(255, 111, 61, 0.22), transparent 34%),',
      '    radial-gradient(circle at 0% 100%, rgba(201, 242, 216, 0.48), transparent 32%),',
      '    linear-gradient(145deg, rgba(255, 247, 233, 0.98) 0%, rgba(255,255,255,0.98) 48%, rgba(243,252,247,0.98) 100%);',
      '  border-color: rgba(255, 111, 61, 0.22);',
      '  box-shadow: 0 24px 48px rgba(255, 111, 61, 0.16);',
      '}',
      '.phab-community-feed__card--tournament-skin::before {',
      '  content: "";',
      '  position: absolute;',
      '  inset: 0 0 auto;',
      '  height: 6px;',
      '  background: linear-gradient(90deg, var(--ph-feed-hub-orange-deep) 0%, var(--ph-feed-accent) 56%, var(--ph-feed-hub-green) 100%);',
      '}',
      '.phab-community-feed__tournament-hero {',
      '  position: relative;',
      '  min-height: 220px;',
      '  border-radius: 22px;',
      '  overflow: hidden;',
      '  background:',
      '    radial-gradient(circle at 18% 16%, rgba(255,255,255,0.55), transparent 24%),',
      '    linear-gradient(135deg, #ff7a43 0%, #ff9f4a 38%, #ffe5bc 100%);',
      '}',
      '.phab-community-feed__tournament-hero--plain::after {',
      '  content: "";',
      '  position: absolute;',
      '  inset: auto -34px -44px auto;',
      '  width: 150px;',
      '  height: 150px;',
      '  border-radius: 999px;',
      '  background: radial-gradient(circle, rgba(201, 242, 216, 0.82) 0%, rgba(201, 242, 216, 0) 70%);',
      '}',
      '.phab-community-feed__tournament-image {',
      '  width: 100%;',
      '  height: 220px;',
      '  display: block;',
      '  object-fit: cover;',
      '}',
      '.phab-community-feed__tournament-overlay {',
      '  position: absolute;',
      '  inset: 0;',
      '  display: flex;',
      '  align-items: flex-end;',
      '  padding: 18px;',
      '  background: linear-gradient(180deg, rgba(28, 19, 12, 0.06) 0%, rgba(28, 19, 12, 0.78) 100%);',
      '}',
      '.phab-community-feed__tournament-overlay--plain {',
      '  background: linear-gradient(180deg, rgba(28, 19, 12, 0.04) 0%, rgba(28, 19, 12, 0.48) 100%);',
      '}',
      '.phab-community-feed__tournament-overlay-text { display: grid; gap: 8px; max-width: 92%; }',
      '.phab-community-feed__tournament-badge {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  width: fit-content;',
      '  min-height: 30px;',
      '  padding: 7px 12px;',
      '  border-radius: 999px;',
      '  background: rgba(255, 247, 233, 0.92);',
      '  color: #7d2e11;',
      '  font-size: 12px;',
      '  font-weight: 800;',
      '  line-height: 1;',
      '  letter-spacing: 0.08em;',
      '  text-transform: uppercase;',
      '}',
      '.phab-community-feed__tournament-subtitle {',
      '  margin: 0;',
      '  font-size: 14px;',
      '  line-height: 1.45;',
      '  font-weight: 600;',
      '  color: rgba(255, 250, 244, 0.96);',
      '  text-shadow: 0 1px 8px rgba(28, 19, 12, 0.24);',
      '}',
      '.phab-community-feed__tournament-meta { display: flex; flex-wrap: wrap; gap: 8px; }',
      '.phab-community-feed__tournament-pill {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  min-height: 30px;',
      '  padding: 7px 11px;',
      '  border-radius: 999px;',
      '  background: rgba(31, 44, 33, 0.07);',
      '  color: rgba(31, 44, 33, 0.82);',
      '  font-size: 12px;',
      '  font-weight: 600;',
      '  line-height: 1;',
      '}',
      '.phab-community-feed__tournament-pill--accent { background: rgba(255, 111, 61, 0.14); color: #a43d18; }',
      '.phab-community-feed__tournament-summary {',
      '  margin: 0;',
      '  font-size: 15px;',
      '  line-height: 1.6;',
      '  color: rgba(31, 44, 33, 0.80);',
      '}',
      '.phab-community-feed__tournament-footer {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 14px;',
      '  flex-wrap: wrap;',
      '  margin-top: auto;',
      '}',
      '.phab-community-feed__tournament-attendees { display: flex; align-items: center; gap: 12px; min-width: 0; }',
      '.phab-community-feed__tournament-avatar-stack { display: flex; align-items: center; padding-left: 10px; }',
      '.phab-community-feed__tournament-avatar {',
      '  width: 40px;',
      '  height: 40px;',
      '  margin-left: -10px;',
      '  border-radius: 50%;',
      '  border: 2px solid rgba(255, 251, 245, 0.98);',
      '  overflow: hidden;',
      '  display: grid;',
      '  place-items: center;',
      '  background: linear-gradient(135deg, #ffe4cb 0%, #ffd094 100%);',
      '  color: #783111;',
      '  font-size: 12px;',
      '  font-weight: 800;',
      '  line-height: 1;',
      '  box-shadow: 0 8px 18px rgba(31, 44, 33, 0.16);',
      '}',
      '.phab-community-feed__tournament-avatar:first-child { margin-left: 0; }',
      '.phab-community-feed__tournament-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }',
      '.phab-community-feed__tournament-avatar--more { background: linear-gradient(135deg, #1f2c21 0%, #35553f 100%); color: #fff; }',
      '.phab-community-feed__tournament-attendees-copy { display: grid; gap: 2px; min-width: 0; }',
      '.phab-community-feed__tournament-attendees-label {',
      '  margin: 0;',
      '  font-size: 11px;',
      '  line-height: 1.2;',
      '  letter-spacing: 0.12em;',
      '  text-transform: uppercase;',
      '  color: rgba(31, 44, 33, 0.56);',
      '}',
      '.phab-community-feed__tournament-attendees-value { margin: 0; font-size: 15px; line-height: 1.3; font-weight: 800; color: #1f2c21; }',
      '.phab-community-feed__tournament-attendees-names {',
      '  margin: 0;',
      '  font-size: 13px;',
      '  line-height: 1.4;',
      '  color: rgba(31, 44, 33, 0.66);',
      '  white-space: nowrap;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  max-width: 360px;',
      '}',
      '.phab-community-feed__tournament-cta {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  min-height: 48px;',
      '  padding: 12px 18px;',
      '  border-radius: 999px;',
      '  background: linear-gradient(90deg, var(--ph-feed-hub-orange-deep) 0%, var(--ph-feed-accent) 100%);',
      '  color: #fff;',
      '  text-decoration: none;',
      '  font-size: 14px;',
      '  font-weight: 800;',
      '  line-height: 1;',
      '  box-shadow: 0 14px 30px rgba(255, 90, 60, 0.26);',
      '}',
      '.phab-community-feed__image {',
      '  width: 100%;',
      '  aspect-ratio: 16 / 9;',
      '  border-radius: 20px;',
      '  object-fit: cover;',
      '  display: block;',
      '  background: linear-gradient(135deg, #eff4ee 0%, #ddeaf7 100%);',
      '}',
      '.phab-community-feed__badges { display: flex; flex-wrap: wrap; gap: 8px; }',
      '.phab-community-feed__badge {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  min-height: 28px;',
      '  padding: 6px 10px;',
      '  border-radius: 999px;',
      '  background: rgba(31, 44, 33, 0.08);',
      '  font-size: 12px;',
      '  line-height: 1;',
      '}',
      '.phab-community-feed__badge--kind { background: var(--ph-feed-accent-soft); color: #ac441f; }',
      '.phab-community-feed__badge--schedule { background: var(--ph-feed-blue); color: #224d79; }',
      '.phab-community-feed__badge--level { background: var(--ph-feed-green); color: #21513a; }',
      '.phab-community-feed__badge--station { background: var(--ph-feed-yellow); color: #6b5511; }',
      '.phab-community-feed__card-title {',
      '  margin: 0;',
      '  font-size: 22px;',
      '  line-height: 1.06;',
      '  letter-spacing: -0.03em;',
      '}',
      '.phab-community-feed__card-text {',
      '  margin: 0;',
      '  font-size: 15px;',
      '  line-height: 1.55;',
      '  color: rgba(31, 44, 33, 0.82);',
      '  display: -webkit-box;',
      '  -webkit-line-clamp: 5;',
      '  -webkit-box-orient: vertical;',
      '  overflow: hidden;',
      '}',
      '.phab-community-feed__participants { display: flex; flex-wrap: wrap; gap: 8px; }',
      '.phab-community-feed__participant {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 6px;',
      '  min-height: 30px;',
      '  padding: 6px 10px;',
      '  border-radius: 999px;',
      '  background: rgba(31, 44, 33, 0.06);',
      '  font-size: 12px;',
      '  line-height: 1;',
      '}',
      '.phab-community-feed__author {',
      '  margin: 0;',
      '  font-size: 13px;',
      '  line-height: 1.45;',
      '  color: rgba(31, 44, 33, 0.64);',
      '}',
      '.phab-community-feed__status {',
      '  padding: 22px;',
      '  border-radius: 24px;',
      '  background: rgba(255,255,255,0.84);',
      '  border: 1px solid var(--ph-feed-line);',
      '  box-shadow: var(--ph-feed-shadow);',
      '  font-size: 15px;',
      '  line-height: 1.55;',
      '}',
      '.phab-community-feed__status-title { margin: 0 0 8px; font-size: 18px; line-height: 1.1; }',
      '.phab-community-feed--screen .phab-community-feed__topbar { padding: 24px; }',
      '.phab-community-feed--screen .phab-community-feed__logo { width: 84px; height: 84px; flex-basis: 84px; }',
      '.phab-community-feed--screen .phab-community-feed__grid {',
      '  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));',
      '  gap: 22px;',
      '}',
      '.phab-community-feed--screen .phab-community-feed__card { padding: 22px; }',
      '.phab-community-feed--screen .phab-community-feed__card-title { font-size: 26px; }',
      '.phab-community-feed--screen .phab-community-feed__card-text { font-size: 16px; }',
      '.phab-community-feed--screen .phab-community-feed__button { min-height: 52px; font-size: 15px; }',
      '@media (max-width: 767px) {',
      '  .phab-community-feed__topbar { grid-template-columns: minmax(0, 1fr); padding: 16px; border-radius: 22px; }',
      '  .phab-community-feed__identity { align-items: flex-start; }',
      '  .phab-community-feed__logo { width: 60px; height: 60px; flex-basis: 60px; border-radius: 18px; }',
      '  .phab-community-feed__grid { grid-template-columns: minmax(0, 1fr); }',
      '  .phab-community-feed__card { padding: 16px; border-radius: 22px; }',
      '  .phab-community-feed__card-title { font-size: 20px; }',
      '  .phab-community-feed__tournament-hero { min-height: 188px; }',
      '  .phab-community-feed__tournament-image { height: 188px; }',
      '  .phab-community-feed__tournament-overlay { padding: 14px; }',
      '  .phab-community-feed__tournament-footer { align-items: flex-start; }',
      '  .phab-community-feed__tournament-attendees { width: 100%; }',
      '  .phab-community-feed__tournament-attendees-names { max-width: 100%; white-space: normal; }',
      '  .phab-community-feed__tournament-cta { width: 100%; }',
      '  .phab-community-feed__actions { justify-content: flex-start; }',
      '  .phab-community-feed__button { width: 100%; }',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function normalizeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function normalizeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeString(value) {
    return String(value || '').trim();
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
    return normalizeString(value).replace(/\/$/, '');
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

  function createStatusCard(title, description) {
    var card = createElement('div', 'phab-community-feed__status');
    card.appendChild(createElement('h3', 'phab-community-feed__status-title', title));
    card.appendChild(createElement('p', '', description));
    return card;
  }

  function buildInitials(name) {
    var words = normalizeString(name)
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

  function createLogo(community) {
    var logo = createElement('div', 'phab-community-feed__logo');
    if (community.logo) {
      var image = document.createElement('img');
      image.alt = community.name || 'Community logo';
      image.src = community.logo;
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.onerror = function () {
        image.remove();
        logo.textContent = buildInitials(community.name);
      };
      logo.appendChild(image);
      return logo;
    }

    logo.textContent = buildInitials(community.name);
    return logo;
  }

  function hasObjectValues(value) {
    return Object.keys(normalizeObject(value)).length > 0;
  }

  function pickFirstObject(values) {
    var index;
    for (index = 0; index < values.length; index += 1) {
      if (hasObjectValues(values[index])) {
        return normalizeObject(values[index]);
      }
    }
    return {};
  }

  function resolveParticipantInitials(participant) {
    var normalizedParticipant = normalizeObject(participant);
    return (
      normalizeString(normalizedParticipant.shortName)
      || buildInitials(normalizedParticipant.name || 'Игрок')
    );
  }

  function resolveTournamentSkin(item, participants) {
    var details = normalizeObject(item.details);
    var tournamentDetails = pickFirstObject([
      details.publicTournament,
      details.tournament,
      details.customTournament
    ]);
    var skin = pickFirstObject([
      details.skin,
      details.tournamentSkin,
      tournamentDetails.skin
    ]);
    var publicUrl = normalizeString(
      details.publicUrl
      || details.tournamentUrl
      || tournamentDetails.publicUrl
      || details.url
    );
    var title = normalizeString(skin.title || item.title || 'Турнир PadelHub');
    var subtitle = normalizeString(
      skin.subtitle
      || details.subtitle
      || item.stationName
      || item.courtName
    );
    var description = normalizeString(skin.description || item.body);
    var imageUrl = normalizeString(skin.imageUrl || item.imageUrl);
    var badgeLabel = normalizeString(skin.badgeLabel || details.badgeLabel || item.previewLabel);
    var ctaLabel = normalizeString(skin.ctaLabel || item.ctaLabel) || 'Записаться';
    var maxPlayers = normalizePositiveInteger(
      details.maxPlayers || tournamentDetails.maxPlayers,
      0
    );
    var participantsCount =
      normalizePositiveInteger(
        details.participantsCount || tournamentDetails.participantsCount,
        0
      ) || participants.length;
    var hasSkin =
      normalizeString(item.kind).toUpperCase() === 'TOURNAMENT' &&
      (
        hasObjectValues(skin)
        || Boolean(publicUrl)
        || Boolean(imageUrl)
        || Boolean(badgeLabel)
      );

    return {
      enabled: hasSkin,
      title: title,
      subtitle: subtitle,
      description: description,
      imageUrl: imageUrl,
      badgeLabel: badgeLabel,
      ctaLabel: ctaLabel,
      publicUrl: publicUrl,
      maxPlayers: maxPlayers,
      participantsCount: participantsCount
    };
  }

  function createTournamentParticipantAvatar(participant, extraCount) {
    var avatarClassName = 'phab-community-feed__tournament-avatar';
    var avatar = createElement(
      'span',
      extraCount > 0
        ? avatarClassName + ' phab-community-feed__tournament-avatar--more'
        : avatarClassName
    );

    if (extraCount > 0) {
      avatar.textContent = '+' + String(extraCount);
      avatar.setAttribute('aria-label', 'Дополнительные участники');
      return avatar;
    }

    var normalizedParticipant = normalizeObject(participant);
    var avatarUrl = normalizeString(normalizedParticipant.avatar);
    avatar.title = normalizeString(normalizedParticipant.name) || 'Участник';
    if (avatarUrl) {
      var image = document.createElement('img');
      image.alt = normalizeString(normalizedParticipant.name) || 'Участник';
      image.src = avatarUrl;
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.onerror = function () {
        image.remove();
        avatar.textContent = resolveParticipantInitials(normalizedParticipant);
      };
      avatar.appendChild(image);
      return avatar;
    }

    avatar.textContent = resolveParticipantInitials(normalizedParticipant);
    return avatar;
  }

  function createTournamentFeedCard(item, participants, tournamentSkin) {
    var article = createElement(
      'article',
      'phab-community-feed__card phab-community-feed__card--tournament-skin'
    );
    var hero = createElement(
      'div',
      'phab-community-feed__tournament-hero' + (tournamentSkin.imageUrl ? '' : ' phab-community-feed__tournament-hero--plain')
    );
    var overlayClassName =
      'phab-community-feed__tournament-overlay' +
      (tournamentSkin.imageUrl ? '' : ' phab-community-feed__tournament-overlay--plain');

    if (tournamentSkin.imageUrl) {
      var heroImage = document.createElement('img');
      heroImage.className = 'phab-community-feed__tournament-image';
      heroImage.src = tournamentSkin.imageUrl;
      heroImage.alt = tournamentSkin.title || 'Турнир PadelHub';
      heroImage.loading = 'lazy';
      heroImage.referrerPolicy = 'no-referrer';
      heroImage.onerror = function () {
        heroImage.remove();
        hero.className = 'phab-community-feed__tournament-hero phab-community-feed__tournament-hero--plain';
        overlay.className = 'phab-community-feed__tournament-overlay phab-community-feed__tournament-overlay--plain';
      };
      hero.appendChild(heroImage);
    }

    var overlay = createElement('div', overlayClassName);
    var overlayText = createElement('div', 'phab-community-feed__tournament-overlay-text');
    overlay.appendChild(overlayText);
    if (tournamentSkin.badgeLabel) {
      overlayText.appendChild(
        createElement('span', 'phab-community-feed__tournament-badge', tournamentSkin.badgeLabel)
      );
    }
    if (tournamentSkin.subtitle) {
      overlayText.appendChild(
        createElement('p', 'phab-community-feed__tournament-subtitle', tournamentSkin.subtitle)
      );
    }
    hero.appendChild(overlay);
    article.appendChild(hero);

    var badges = createElement('div', 'phab-community-feed__tournament-meta');
    var scheduleLabel = formatSchedule(item.startAt, item.endAt);
    var stationLabel = normalizeString(item.stationName || item.courtName);
    appendBadge(badges, resolveKindLabel(item.kind), 'kind');
    if (scheduleLabel) {
      badges.appendChild(
        createElement('span', 'phab-community-feed__tournament-pill phab-community-feed__tournament-pill--accent', scheduleLabel)
      );
    }
    if (stationLabel) {
      badges.appendChild(
        createElement('span', 'phab-community-feed__tournament-pill', stationLabel)
      );
    }
    if (item.levelLabel) {
      badges.appendChild(
        createElement('span', 'phab-community-feed__tournament-pill', item.levelLabel)
      );
    }
    if (badges.childNodes.length > 0) {
      article.appendChild(badges);
    }

    article.appendChild(
      createElement('h3', 'phab-community-feed__card-title', tournamentSkin.title || 'Турнир PadelHub')
    );

    if (tournamentSkin.description) {
      article.appendChild(
        createElement('p', 'phab-community-feed__tournament-summary', tournamentSkin.description)
      );
    }

    var footer = createElement('div', 'phab-community-feed__tournament-footer');
    var attendees = createElement('div', 'phab-community-feed__tournament-attendees');
    var avatarStack = createElement('div', 'phab-community-feed__tournament-avatar-stack');
    var attendeeCopy = createElement('div', 'phab-community-feed__tournament-attendees-copy');
    var visibleParticipants = participants.slice(0, 5);
    var hiddenParticipantsCount = Math.max(0, participants.length - visibleParticipants.length);
    var attendeeValue = tournamentSkin.maxPlayers > 0
      ? String(tournamentSkin.participantsCount) + ' из ' + String(tournamentSkin.maxPlayers) + ' мест'
      : String(tournamentSkin.participantsCount) + ' записались';
    var attendeeNames = visibleParticipants
      .map(function (participant) {
        return normalizeObject(participant).name;
      })
      .filter(Boolean);

    visibleParticipants.forEach(function (participant) {
      avatarStack.appendChild(createTournamentParticipantAvatar(participant, 0));
    });
    if (hiddenParticipantsCount > 0) {
      avatarStack.appendChild(createTournamentParticipantAvatar(null, hiddenParticipantsCount));
    }
    if (avatarStack.childNodes.length === 0) {
      avatarStack.appendChild(createTournamentParticipantAvatar({ name: 'Свободно' }, 0));
    }

    attendeeCopy.appendChild(
      createElement('p', 'phab-community-feed__tournament-attendees-label', 'Запись в турнир')
    );
    attendeeCopy.appendChild(
      createElement('p', 'phab-community-feed__tournament-attendees-value', attendeeValue)
    );
    attendeeCopy.appendChild(
      createElement(
        'p',
        'phab-community-feed__tournament-attendees-names',
        attendeeNames.length > 0
          ? attendeeNames.join(', ') + (hiddenParticipantsCount > 0 ? ' +' + String(hiddenParticipantsCount) : '')
          : 'Список участников пополняется'
      )
    );

    attendees.appendChild(avatarStack);
    attendees.appendChild(attendeeCopy);
    footer.appendChild(attendees);

    if (tournamentSkin.publicUrl) {
      var cta = createElement(
        'a',
        'phab-community-feed__tournament-cta',
        tournamentSkin.ctaLabel || 'Записаться'
      );
      cta.href = tournamentSkin.publicUrl;
      cta.target = '_blank';
      cta.rel = 'noopener noreferrer';
      footer.appendChild(cta);
    }

    article.appendChild(footer);

    var authorParts = [];
    if (item.authorName) {
      authorParts.push(item.authorName);
    }
    if (item.publishedAt) {
      authorParts.push(formatDateTime(item.publishedAt));
    }
    if (authorParts.length > 0) {
      article.appendChild(
        createElement('p', 'phab-community-feed__author', authorParts.filter(Boolean).join(' · '))
      );
    }

    return article;
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

  function formatDateTime(value) {
    if (!value) {
      return '';
    }

    var parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    return parsed.toLocaleString('ru-RU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatSchedule(startAt, endAt) {
    var startLabel = formatDateTime(startAt);
    if (!startLabel) {
      return '';
    }

    var endLabel = formatDateTime(endAt);
    if (!endLabel) {
      return startLabel;
    }

    return startLabel + ' - ' + endLabel;
  }

  function formatMembersLabel(count) {
    var numericCount = Number(count);
    if (!Number.isFinite(numericCount) || numericCount <= 0) {
      return 'Новое сообщество';
    }
    return String(Math.round(numericCount)) + ' участников';
  }

  function resolveKindLabel(kind) {
    var normalized = normalizeString(kind).toUpperCase();
    if (normalized === 'GAME') {
      return 'Игра';
    }
    if (normalized === 'TOURNAMENT') {
      return 'Турнир';
    }
    if (normalized === 'EVENT') {
      return 'Событие';
    }
    if (normalized === 'AD') {
      return 'Анонс';
    }
    return 'Новость';
  }

  function appendBadge(container, text, modifier) {
    if (!normalizeString(text)) {
      return;
    }

    container.appendChild(
      createElement(
        'span',
        'phab-community-feed__badge' + (modifier ? ' phab-community-feed__badge--' + modifier : ''),
        text
      )
    );
  }

  function createFeedCard(item) {
    var participants = normalizeArray(item.participants).filter(function (entry) {
      return normalizeObject(entry).name;
    });
    var tournamentSkin = resolveTournamentSkin(item, participants);
    if (tournamentSkin.enabled) {
      return createTournamentFeedCard(item, participants, tournamentSkin);
    }

    var article = createElement('article', 'phab-community-feed__card');
    if (item.imageUrl) {
      var image = document.createElement('img');
      image.className = 'phab-community-feed__image';
      image.src = item.imageUrl;
      image.alt = item.title || 'Feed image';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.onerror = function () {
        image.remove();
      };
      article.appendChild(image);
    }

    var badges = createElement('div', 'phab-community-feed__badges');
    appendBadge(badges, item.previewLabel || resolveKindLabel(item.kind), 'kind');
    appendBadge(badges, formatSchedule(item.startAt, item.endAt), 'schedule');
    appendBadge(badges, item.levelLabel, 'level');
    appendBadge(badges, item.stationName || item.courtName, 'station');
    if (badges.childNodes.length > 0) {
      article.appendChild(badges);
    }

    article.appendChild(
      createElement('h3', 'phab-community-feed__card-title', item.title || 'Публикация')
    );

    if (item.body) {
      article.appendChild(
        createElement('p', 'phab-community-feed__card-text', item.body)
      );
    }

    if (participants.length > 0) {
      var participantsWrap = createElement('div', 'phab-community-feed__participants');
      participants.slice(0, 6).forEach(function (participant) {
        var normalizedParticipant = normalizeObject(participant);
        var label = normalizedParticipant.levelLabel
          ? normalizedParticipant.name + ' · ' + normalizedParticipant.levelLabel
          : normalizedParticipant.name;
        participantsWrap.appendChild(
          createElement('span', 'phab-community-feed__participant', label)
        );
      });
      article.appendChild(participantsWrap);
    }

    var tags = normalizeArray(item.tags).filter(Boolean);
    if (tags.length > 0) {
      var tagsWrap = createElement('div', 'phab-community-feed__badges');
      tags.slice(0, 5).forEach(function (tag) {
        appendBadge(tagsWrap, tag, '');
      });
      article.appendChild(tagsWrap);
    }

    var authorParts = [];
    if (item.authorName) {
      authorParts.push(item.authorName);
    }
    if (item.publishedAt) {
      authorParts.push(formatDateTime(item.publishedAt));
    }
    if (authorParts.length > 0) {
      article.appendChild(
        createElement('p', 'phab-community-feed__author', authorParts.filter(Boolean).join(' · '))
      );
    }

    return article;
  }

  function renderCommunityFeed(mount, payload, config) {
    var response = normalizeObject(payload);
    var community = normalizeObject(response.community);
    var items = normalizeArray(response.items).map(function (entry) {
      return normalizeObject(entry);
    });

    var root = createElement(
      'section',
      'phab-community-feed phab-community-feed--' + (config.variant || 'embed')
    );
    var shell = createElement('div', 'phab-community-feed__shell');
    var topbar = createElement('div', 'phab-community-feed__topbar');
    var info = createElement('div', 'phab-community-feed__info');
    var identity = createElement('div', 'phab-community-feed__identity');
    var identityText = createElement('div', 'phab-community-feed__identity-text');
    var meta = createElement('div', 'phab-community-feed__meta');
    var grid = createElement('div', 'phab-community-feed__grid');
    var actions = createElement('div', 'phab-community-feed__actions');

    identity.appendChild(createLogo(community));
    identityText.appendChild(
      createElement('p', 'phab-community-feed__eyebrow', 'Public Community Feed')
    );
    identityText.appendChild(
      createElement(
        'h2',
        'phab-community-feed__title',
        config.title || community.name || 'Лента сообщества'
      )
    );
    identityText.appendChild(
      createElement(
        'p',
        'phab-community-feed__subtitle',
        config.subtitle
          || community.description
          || 'Показываем отдельную публичную ленту выбранного сообщества для сайта, Tilda-страницы или телевизора.'
      )
    );
    identity.appendChild(identityText);
    info.appendChild(identity);

    meta.appendChild(
      createElement(
        'span',
        'phab-community-feed__pill phab-community-feed__pill--accent',
        String(items.length) + ' публикаций'
      )
    );
    meta.appendChild(
      createElement(
        'span',
        'phab-community-feed__pill',
        formatGeneratedAt(response.generatedAt)
      )
    );
    if (community.stationName || community.city) {
      meta.appendChild(
        createElement(
          'span',
          'phab-community-feed__pill',
          [community.stationName, community.city].filter(Boolean).join(' · ')
        )
      );
    }
    if (community.membersCount) {
      meta.appendChild(
        createElement(
          'span',
          'phab-community-feed__pill',
          formatMembersLabel(community.membersCount)
        )
      );
    }
    info.appendChild(meta);
    topbar.appendChild(info);

    if (community.joinUrl) {
      var button = createElement(
        'a',
        'phab-community-feed__button',
        community.joinLabel || 'Перейти в сообщество'
      );
      button.href = String(community.joinUrl);
      button.target = '_blank';
      button.rel = 'noopener noreferrer';
      actions.appendChild(button);
    }
    topbar.appendChild(actions);
    shell.appendChild(topbar);

    if (items.length === 0) {
      grid.appendChild(
        createStatusCard(
          'Пока в ленте пусто',
          'У этого сообщества пока нет опубликованных элементов ленты или они ещё не промодерированы.'
        )
      );
    } else {
      items.forEach(function (item) {
        grid.appendChild(createFeedCard(item));
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
        'Загружаем ленту сообщества',
        'Сейчас подтянем актуальные публикации для отдельного экрана.'
      )
    );
  }

  function renderError(mount, description) {
    mount.innerHTML = '';
    mount.appendChild(
      createStatusCard(
        'Не удалось загрузить ленту',
        description
          || 'Проверьте data-api-base, data-community-id и доступность `/api/communities/public/feed/list`.'
      )
    );
  }

  function buildRequestUrl(config) {
    var url = new URL(
      normalizeApiBaseUrl(config.apiBaseUrl) + '/communities/public/feed/list',
      window.location.href
    );
    url.searchParams.set('communityId', config.communityId);
    if (config.limit > 0) {
      url.searchParams.set('limit', String(config.limit));
    }
    return url.toString();
  }

  function loadFeed(mount, config) {
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
        renderCommunityFeed(mount, payload, config);
      })
      .catch(function (_error) {
        renderError(mount);
      });
  }

  function readConfig(mount) {
    var dataset = mount.dataset || {};
    return {
      apiBaseUrl: normalizeApiBaseUrl(dataset.apiBase || DEFAULTS.apiBaseUrl),
      communityId: normalizeString(dataset.communityId || DEFAULTS.communityId),
      limit: normalizePositiveInteger(dataset.limit, DEFAULTS.limit),
      refreshMs: normalizeRefreshMs(dataset.refreshMs),
      variant: normalizeString(dataset.variant || DEFAULTS.variant) || DEFAULTS.variant,
      title: normalizeString(dataset.title || DEFAULTS.title),
      subtitle: normalizeString(dataset.subtitle || DEFAULTS.subtitle)
    };
  }

  function initMount(mount) {
    if (!mount || mount.__phabCommunityFeedInitialized) {
      return;
    }

    var config = readConfig(mount);
    if (!config.apiBaseUrl) {
      renderError(mount, 'Не удалось определить API base URL. Укажите data-api-base явно.');
      return;
    }
    if (!config.communityId) {
      renderError(mount, 'Для виджета нужен data-community-id с id сообщества.');
      return;
    }

    mount.__phabCommunityFeedInitialized = true;
    loadFeed(mount, config);

    if (config.refreshMs > 0) {
      mount.__phabCommunityFeedTimer = window.setInterval(function () {
        loadFeed(mount, config);
      }, config.refreshMs);
    }
  }

  function initAll() {
    ensureStyles();

    var mounts = document.querySelectorAll('[data-ph-community-feed]');
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
