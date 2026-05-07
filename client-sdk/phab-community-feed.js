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
      '.phab-community-feed__card--tournament-showcase {',
      '  --ph-tournament-card-bg: #fafafa;',
      '  --ph-tournament-card-line: #e8e8e9;',
      '  --ph-tournament-card-line-soft: #e8e8e9;',
      '  --ph-tournament-card-border: #ededed;',
      '  --ph-tournament-card-ink: #1f1e20;',
      '  --ph-tournament-card-ink-soft: #b4b4b4;',
      '  --ph-tournament-card-meta: #353436;',
      '  --ph-tournament-card-icon: #888889;',
      '  --ph-tournament-card-accent: #8766eb;',
      '  --ph-tournament-card-accent-soft: rgba(47, 157, 212, 0.08);',
      '  --ph-tournament-card-accent-ink: #2f9dd4;',
      '  --ph-tournament-ui-font: "Inter Display", "Inter", "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
      '  --ph-tournament-card-title-font: "RF Dewi UltraBold", "Inter Display", "Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
      '  display: flex;',
      '  flex-direction: column;',
      '  align-items: center;',
      '  width: 100%;',
      '  max-width: 359px;',
      '  min-height: 363px;',
      '  padding: 0 20px 16px;',
      '  gap: 12px;',
      '  border: none;',
      '  border-radius: 0;',
      '  border-bottom: 0.5px solid var(--ph-tournament-card-border);',
      '  background: transparent;',
      '  box-shadow: none;',
      '  color: var(--ph-tournament-card-ink);',
      '  justify-self: center;',
      '  overflow: visible;',
      '}',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-profile { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; width: 100%; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-profile-main { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-organizer-avatar { width: 36px; height: 36px; flex: 0 0 36px; border-radius: 8px; overflow: hidden; display: grid; place-items: center; background: #d9d9d9; color: var(--ph-tournament-card-ink); font-family: var(--ph-tournament-card-title-font); font-size: 12px; line-height: 1; font-weight: 800; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-organizer-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-organizer-copy { display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 5px; min-width: 0; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-organizer-name, .phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-organizer-handle { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-organizer-name { color: var(--ph-tournament-card-ink); font-family: var(--ph-tournament-card-title-font); font-size: 14px; line-height: 1; font-weight: 700; letter-spacing: 0.01em; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-organizer-handle { color: var(--ph-tournament-card-ink-soft); font-family: var(--ph-tournament-ui-font); font-size: 11px; line-height: 1; font-weight: 500; letter-spacing: 0.02em; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-surface { box-sizing: border-box; position: relative; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; width: 100%; min-height: 263px; padding: 14px 12px; gap: 16px; background: var(--ph-tournament-card-bg); border-radius: 12px; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-head { position: relative; display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; width: 100%; isolation: isolate; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-heading { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; flex: 1 1 auto; padding-right: 58px; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-badge { display: inline-flex; align-items: center; justify-content: center; gap: 3px; min-height: 18px; max-width: 100%; padding: 5px 6px; border-radius: 24px; background: var(--ph-tournament-card-accent-soft); color: var(--ph-tournament-card-accent-ink); font-family: var(--ph-tournament-ui-font); font-size: 10px; line-height: 1; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-badge-text { overflow: hidden; text-overflow: ellipsis; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-badge-icon { width: 8px; height: 8px; flex: 0 0 8px; display: inline-flex; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-badge-icon svg { width: 100%; height: 100%; display: block; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-title { width: 100%; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ph-tournament-card-ink); font-family: var(--ph-tournament-card-title-font); font-size: 18px; line-height: 1; font-weight: 800; letter-spacing: 0.01em; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-date-badge { position: absolute; top: 0; right: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 44px; height: 51px; padding: 8px; gap: 4px; border-radius: 8px; background: #ffffff; z-index: 2; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-date-day, .phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-date-weekday { width: 100%; margin: 0; text-align: center; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-date-day { color: var(--ph-tournament-card-ink); font-family: var(--ph-tournament-card-title-font); font-size: 18px; line-height: 1.24; font-weight: 800; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-date-weekday { color: var(--ph-tournament-card-accent); font-family: var(--ph-tournament-ui-font); font-size: 9px; line-height: 1; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-info { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; width: 100%; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-meta { display: flex; align-items: flex-start; gap: 4px; width: 100%; min-width: 0; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-meta-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ph-tournament-card-meta); font-family: var(--ph-tournament-ui-font); font-size: 12px; line-height: 1; font-weight: 500; letter-spacing: 0.02em; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-meta-icon { width: 12px; height: 12px; flex: 0 0 12px; display: inline-flex; color: var(--ph-tournament-card-icon); }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-meta-icon svg { width: 100%; height: 100%; display: block; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-capacity { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; width: 100%; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-price-row { display: flex; justify-content: flex-end; width: 100%; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-price-badge { appearance: none; box-sizing: border-box; display: inline-flex; flex-direction: row; justify-content: center; align-items: center; width: 74px; height: 33px; padding: 8px 12px; gap: 4px; border: 1.5px dashed #2e2e2f; border-radius: 6px; background: transparent; color: #fafafa; font-family: "RF Dewi", var(--ph-tournament-ui-font); font-size: 14px; line-height: 1.24; font-weight: 700; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-price-badge:hover { opacity: 0.9; }',
      '.phab-community-feed__energy-modal-backdrop { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(15, 15, 18, 0.42); }',
      '.phab-community-feed__energy-modal { width: min(320px, 100%); border-radius: 16px; background: #ffffff; box-shadow: 0 24px 70px rgba(16, 16, 18, 0.28); color: #1f1e20; font-family: "Inter Display", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow: hidden; }',
      '.phab-community-feed__energy-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 18px 18px 10px; }',
      '.phab-community-feed__energy-modal-title { margin: 0; font-size: 18px; line-height: 1.15; font-weight: 800; }',
      '.phab-community-feed__energy-modal-close { appearance: none; width: 32px; height: 32px; border: 0; border-radius: 999px; background: #f1f1f3; color: #303034; font-size: 20px; line-height: 1; cursor: pointer; }',
      '.phab-community-feed__energy-modal-list { display: grid; gap: 0; padding: 6px 18px 18px; }',
      '.phab-community-feed__energy-modal-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 46px; border-top: 1px solid #ededee; font-size: 15px; line-height: 1.2; }',
      '.phab-community-feed__energy-modal-row:first-child { border-top: 0; }',
      '.phab-community-feed__energy-modal-name { font-weight: 700; }',
      '.phab-community-feed__energy-modal-price { font-weight: 800; white-space: nowrap; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-progress { display: flex; gap: 2px; width: 100%; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-progress-segment { height: 3px; flex: 1 1 0; background: var(--ph-tournament-card-line-soft); }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-progress-segment:first-child { border-radius: 24px 0 0 24px; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-progress-segment:last-child { border-radius: 0 24px 24px 0; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-progress-segment.is-filled { background: var(--ph-tournament-card-accent); }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-capacity-texts { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-capacity-value, .phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-capacity-note { min-width: 0; color: var(--ph-tournament-card-ink); font-family: var(--ph-tournament-ui-font); line-height: 1; font-weight: 500; white-space: nowrap; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-capacity-value { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-capacity-note { font-size: 10px; letter-spacing: 0.02em; text-align: right; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-cta { appearance: none; border: none; display: inline-flex; align-items: center; justify-content: center; width: 100%; min-height: 32px; padding: 10px 24px 10px 20px; border-radius: 24px; background: var(--ph-tournament-card-accent); color: #fafafa; text-decoration: none; cursor: pointer; transition: opacity 120ms ease, background 120ms ease, color 120ms ease; font-family: var(--ph-tournament-ui-font); font-size: 12px; line-height: 1; font-weight: 500; letter-spacing: 0.02em; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-cta:hover { opacity: 0.94; background: #7655e2; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-cta--disabled { background: transparent; color: var(--ph-tournament-card-ink-soft); box-shadow: inset 0 0 0 1px var(--ph-tournament-card-line); cursor: default; opacity: 1; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-footer-metrics { display: flex; align-items: flex-start; gap: 14px; min-width: 0; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-footer-metric { display: inline-flex; align-items: center; gap: 4px; min-height: 24px; padding: 4px 0; border-radius: 32px; color: var(--ph-tournament-card-meta); font-family: var(--ph-tournament-ui-font); font-size: 12px; line-height: 1; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap; }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-footer-metric.is-accent { color: var(--ph-tournament-card-accent); }',
      '.phab-community-feed__card--tournament-showcase .phab-tournaments__card-compact-footer-time { margin-left: auto; color: var(--ph-tournament-card-ink-soft); font-family: var(--ph-tournament-ui-font); font-size: 11px; line-height: 1; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap; }',
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

  function appendChildren(parent, children) {
    normalizeArray(children).forEach(function (child) {
      if (child) {
        parent.appendChild(child);
      }
    });
    return parent;
  }

  function resolveTournamentCardData(item, participants, tournamentSkin) {
    var details = normalizeObject(item.details);
    var publicTournament = pickFirstObject([
      details.publicTournament,
      details.tournament,
      details.customTournament
    ]);
    var skin = pickFirstObject([
      publicTournament.skin,
      details.skin,
      details.tournamentSkin
    ]);
    var startsAt = normalizeString(publicTournament.startsAt || details.startsAt || item.startAt);
    var endsAt = normalizeString(publicTournament.endsAt || details.endsAt || item.endAt);
    var maxPlayers = normalizePositiveInteger(
      publicTournament.maxPlayers || details.maxPlayers || tournamentSkin.maxPlayers,
      0
    );
    var participantsCount = normalizePositiveInteger(
      publicTournament.participantsCount || details.participantsCount || tournamentSkin.participantsCount,
      participants.length
    );

    return {
      title: normalizeString(skin.title || publicTournament.name || tournamentSkin.title || item.title) || 'Турнир PadelHub',
      badgeLabel: normalizeString(skin.badgeLabel || details.badgeLabel || publicTournament.tournamentType || details.tournamentType) || 'Рейтинговая игра',
      ctaLabel: normalizeString(skin.ctaLabel || tournamentSkin.ctaLabel || item.ctaLabel) || 'Записаться',
      publicUrl: normalizeString(publicTournament.publicUrl || details.publicUrl || tournamentSkin.publicUrl),
      trainerName: normalizeString(publicTournament.trainerName || details.trainerName || item.authorName) || 'PadelHub',
      trainerAvatarUrl: normalizeString(publicTournament.trainerAvatarUrl || details.trainerAvatarUrl || tournamentSkin.imageUrl),
      profileHandle: normalizeString(publicTournament.studioName || details.studioName || item.stationName || item.courtName) || '@padelhub',
      tournamentType: normalizeString(publicTournament.tournamentType || details.tournamentType) || 'Турнир',
      gender: normalizeString(publicTournament.gender || details.gender),
      levelLabel: normalizeString(item.levelLabel || details.levelLabel) || formatAccessLevelRange(publicTournament.accessLevels || details.accessLevels),
      stationName: normalizeString(publicTournament.studioName || details.studioName || item.stationName || item.courtName),
      priceLabel: normalizeString(skin.priceLabel || skin.price || skin.costLabel || details.priceLabel || item.priceLabel),
      startsAt: startsAt,
      endsAt: endsAt,
      maxPlayers: maxPlayers,
      participantsCount: participantsCount,
      waitlistCount: normalizePositiveInteger(publicTournament.waitlistCount || details.waitlistCount, 0),
      registrationOpen: publicTournament.registrationOpen !== false,
      spotsLeft: maxPlayers > 0 ? Math.max(0, maxPlayers - participantsCount) : null
    };
  }

  function formatAccessLevelRange(value) {
    var levels = normalizeArray(value)
      .map(normalizeString)
      .filter(Boolean);
    if (levels.length === 0) {
      return '';
    }
    if (levels.length === 1) {
      return levels[0];
    }
    return levels[0] + ' - ' + levels[levels.length - 1];
  }

  function formatTournamentGenderLabel(value) {
    var normalized = normalizeString(value).toUpperCase();
    if (normalized === 'FEMALE' || normalized === 'WOMEN' || normalized === 'Ж') {
      return 'Ж';
    }
    if (normalized === 'MALE' || normalized === 'MEN' || normalized === 'М') {
      return 'М';
    }
    if (normalized === 'MIXED' || normalized === 'MIX') {
      return 'М/Ж';
    }
    return '';
  }

  function formatTournamentDateParts(value) {
    var parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return { day: '', weekday: '' };
    }
    return {
      day: parsed.toLocaleDateString('ru-RU', { day: '2-digit' }),
      weekday: parsed.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '')
    };
  }

  function formatTournamentTime(value) {
    var parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }
    return parsed.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function formatTournamentScheduleLabel(card) {
    var date = new Date(card.startsAt);
    var dateLabel = Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
    var start = formatTournamentTime(card.startsAt);
    var end = formatTournamentTime(card.endsAt);
    return [dateLabel, start && end ? start + '-' + end : start].filter(Boolean).join(', ');
  }

  function formatTournamentDurationLabel(card) {
    var start = new Date(card.startsAt);
    var end = new Date(card.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return '';
    }
    var minutes = Math.round((end.getTime() - start.getTime()) / 60000);
    if (minutes >= 60) {
      var hours = Math.floor(minutes / 60);
      var rest = minutes % 60;
      return String(hours) + ' ч' + (rest ? ' ' + String(rest) + ' мин' : '');
    }
    return String(minutes) + ' мин';
  }

  function resolveTournamentRemainingSpotsLabel(card) {
    if (!card.registrationOpen) {
      return 'Запись закрыта';
    }
    if (card.spotsLeft === null) {
      return 'Есть места';
    }
    if (card.spotsLeft <= 0) {
      return 'Нет мест';
    }
    return 'осталось ' + String(card.spotsLeft);
  }

  function createTournamentCompactIcon(kind) {
    var icon = createElement(
      'span',
      kind === 'badge'
        ? 'phab-tournaments__card-compact-badge-icon'
        : 'phab-tournaments__card-compact-meta-icon phab-tournaments__card-compact-meta-icon--' + kind
    );
    var svgByKind = {
      badge:
        '<svg viewBox="0 0 8 8" fill="none" aria-hidden="true">' +
        '<path d="M5.23438 0C5.88459 0 6.44442 0.368244 6.71191 0.900391H6.94238C7.53498 0.900391 8 1.35255 8 1.92871C7.99995 2.50479 7.74889 2.99711 7.36621 3.40918C7.17696 3.59313 6.93847 3.75743 6.66699 3.85742C6.27576 4.79351 5.38208 5.47261 4.30762 5.58301V6.49902H5.2334C5.68595 6.49918 6.05664 6.85978 6.05664 7.2998V7.39941H6.46777C6.6363 7.39946 6.77609 7.53542 6.77637 7.69922C6.77637 7.86324 6.63646 7.99995 6.46777 8H1.5293C1.36059 7.99997 1.2207 7.86325 1.2207 7.69922C1.22098 7.53541 1.36076 7.39944 1.5293 7.39941H1.94043V7.2998C1.94043 6.85977 2.31111 6.49916 2.76367 6.49902H3.68945V5.58301C2.61632 5.47165 1.72387 4.79265 1.33301 3.85742C1.06154 3.75741 0.823027 3.59313 0.633789 3.40918C0.251107 2.99711 5.17542e-05 2.50479 0 1.92871C0 1.35256 0.465021 0.900396 1.05762 0.900391H1.28809C1.55558 0.368244 2.11541 0 2.76562 0H5.23438ZM4.24316 1.58398C4.10738 1.38014 3.89261 1.38011 3.75684 1.58398L3.53906 1.91211C3.50614 1.96412 3.43185 2.02013 3.37012 2.03613L2.97949 2.13281C2.74083 2.19284 2.67056 2.39701 2.83105 2.58105L3.08691 2.88477C3.12796 2.92885 3.15645 3.01723 3.15234 3.07715L3.12793 3.46875C3.11147 3.7088 3.28812 3.83311 3.51855 3.74512L3.89258 3.60059C3.95019 3.58058 4.04981 3.58058 4.10742 3.60059L4.48145 3.74512C4.7119 3.83314 4.88853 3.70882 4.87207 3.46875L4.84766 3.07715C4.84354 3.01713 4.87291 2.92878 4.91406 2.88477L5.16895 2.58105C5.32944 2.397 5.25919 2.19283 5.02051 2.13281L4.62988 2.03613C4.56815 2.02013 4.49386 1.96412 4.46094 1.91211L4.24316 1.58398Z" fill="#5FC0F0"></path>' +
        '</svg>',
      calendar:
        '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
        '<rect x="1.25" y="2.25" width="9.5" height="8.5" rx="1.5" stroke="currentColor" stroke-width="1.1"></rect>' +
        '<path d="M3.2 1.25V3.1M8.8 1.25V3.1M1.25 4.25H10.75" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"></path>' +
        '</svg>',
      location:
        '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
        '<path d="M6 10.65C6 10.65 9.15 7.92 9.15 5.25C9.15 3.51 7.74 2.1 6 2.1C4.26 2.1 2.85 3.51 2.85 5.25C2.85 7.92 6 10.65 6 10.65Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"></path>' +
        '<circle cx="6" cy="5.25" r="1.2" fill="currentColor"></circle>' +
        '</svg>',
      level:
        '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
        '<rect x="1.25" y="6.6" width="2.1" height="4.15" rx="0.7" fill="currentColor"></rect>' +
        '<rect x="4.95" y="4.45" width="2.1" height="6.3" rx="0.7" fill="currentColor"></rect>' +
        '<rect x="8.65" y="2.3" width="2.1" height="8.45" rx="0.7" fill="currentColor"></rect>' +
        '</svg>',
      gender:
        '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
        '<circle cx="4.55" cy="3.4" r="1.75" stroke="currentColor" stroke-width="1.1"></circle>' +
        '<path d="M1.65 10.1C1.95 8.25 2.95 7.05 4.55 7.05C6.15 7.05 7.15 8.25 7.45 10.1" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"></path>' +
        '<circle cx="8.35" cy="4.05" r="1.35" stroke="currentColor" stroke-width="1.1"></circle>' +
        '<path d="M7.45 7.35C8.9 7.45 9.85 8.45 10.15 10.1" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"></path>' +
        '</svg>'
    };
    icon.innerHTML = svgByKind[kind] || '';
    return icon;
  }

  function createTournamentCompactMetaRow(kind, text, trailing) {
    if (!normalizeString(text)) {
      return null;
    }
    return appendChildren(
      createElement('div', 'phab-tournaments__card-compact-meta phab-tournaments__card-compact-meta--' + kind),
      [
        createTournamentCompactIcon(kind),
        createElement('span', 'phab-tournaments__card-compact-meta-text', text),
        trailing || null
      ]
    );
  }

  function createTournamentCompactAvatar(card) {
    var avatar = createElement('div', 'phab-tournaments__card-compact-organizer-avatar');
    if (card.trainerAvatarUrl) {
      var img = document.createElement('img');
      img.src = card.trainerAvatarUrl;
      img.alt = card.trainerName;
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.onerror = function () {
        img.remove();
        avatar.textContent = buildInitials(card.trainerName);
      };
      avatar.appendChild(img);
      return avatar;
    }
    avatar.textContent = buildInitials(card.trainerName);
    return avatar;
  }

  function createTournamentCompactProgress(card) {
    var block = createElement('div', 'phab-tournaments__card-compact-capacity');
    var progress = createElement('div', 'phab-tournaments__card-compact-progress');
    var priceRow = createElement('div', 'phab-tournaments__card-compact-price-row');
    var total = Math.max(1, Math.min(16, card.maxPlayers || 8));
    var filled = Math.max(0, Math.min(total, card.maxPlayers ? card.participantsCount : 0));
    var index;
    for (index = 0; index < total; index += 1) {
      progress.appendChild(
        createElement(
          'span',
          'phab-tournaments__card-compact-progress-segment' + (index < filled ? ' is-filled' : '')
        )
      );
    }
    priceRow.appendChild(createTournamentEnergyButton(card));
    block.appendChild(priceRow);
    block.appendChild(progress);
    block.appendChild(
      appendChildren(createElement('div', 'phab-tournaments__card-compact-capacity-texts'), [
        createElement(
          'span',
          'phab-tournaments__card-compact-capacity-value',
          card.maxPlayers ? String(card.participantsCount) + '/' + String(card.maxPlayers) : String(card.participantsCount) + ' записались'
        ),
        createElement('span', 'phab-tournaments__card-compact-capacity-note', resolveTournamentRemainingSpotsLabel(card))
      ])
    );
    return block;
  }

  function createTournamentEnergyButton(card) {
    var button = createElement(
      'button',
      'phab-tournaments__card-compact-price-badge',
      card.priceLabel || 'Энергия'
    );
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      openTournamentEnergyPopup();
    });
    return button;
  }

  function openTournamentEnergyPopup() {
    var existing = document.querySelector('.phab-community-feed__energy-modal-backdrop');
    if (existing) {
      existing.remove();
    }

    var tariffs = [
      { name: 'Энергия 1', price: '5500' },
      { name: 'Энергия 5', price: '19800' },
      { name: 'Энергия 25', price: '97000' }
    ];
    var backdrop = createElement('div', 'phab-community-feed__energy-modal-backdrop');
    var dialog = createElement('div', 'phab-community-feed__energy-modal');
    var closeButton = createElement('button', 'phab-community-feed__energy-modal-close', '×');
    var list = createElement('div', 'phab-community-feed__energy-modal-list');

    backdrop.setAttribute('role', 'presentation');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Тарифы Энергии');
    closeButton.type = 'button';

    tariffs.forEach(function (tariff) {
      list.appendChild(
        appendChildren(createElement('div', 'phab-community-feed__energy-modal-row'), [
          createElement('span', 'phab-community-feed__energy-modal-name', tariff.name),
          createElement('span', 'phab-community-feed__energy-modal-price', tariff.price)
        ])
      );
    });

    function close() {
      backdrop.remove();
      document.removeEventListener('keydown', onKeyDown);
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        close();
      }
    }

    closeButton.addEventListener('click', close);
    backdrop.addEventListener('click', function (event) {
      if (event.target === backdrop) {
        close();
      }
    });
    document.addEventListener('keydown', onKeyDown);

    appendChildren(dialog, [
      appendChildren(createElement('div', 'phab-community-feed__energy-modal-head'), [
        createElement('h3', 'phab-community-feed__energy-modal-title', 'Энергия'),
        closeButton
      ]),
      list
    ]);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    closeButton.focus();
  }

  function createTournamentFeedCard(item, participants, tournamentSkin) {
    var card = resolveTournamentCardData(item, participants, tournamentSkin);
    var article = createElement(
      'article',
      'phab-community-feed__card phab-community-feed__card--tournament-showcase phab-tournaments__entry phab-tournaments__entry--card'
    );
    var profile = createElement('div', 'phab-tournaments__card-compact-profile');
    var profileMain = createElement('div', 'phab-tournaments__card-compact-profile-main');
    var profileCopy = createElement('div', 'phab-tournaments__card-compact-organizer-copy');
    var surface = createElement('div', 'phab-tournaments__card-compact-surface');
    var head = createElement('div', 'phab-tournaments__card-compact-head');
    var heading = createElement('div', 'phab-tournaments__card-compact-heading');
    var badge = createElement('div', 'phab-tournaments__card-compact-badge');
    var dateParts = formatTournamentDateParts(card.startsAt);
    var info = createElement('div', 'phab-tournaments__card-compact-info');
    var footer = createElement('div', 'phab-tournaments__card-compact-footer');
    var metrics = createElement('div', 'phab-tournaments__card-compact-footer-metrics');
    var cta = createElement('a', 'phab-tournaments__card-compact-cta', card.ctaLabel);
    var genderLabel = formatTournamentGenderLabel(card.gender);
    var durationLabel = formatTournamentDurationLabel(card);

    appendChildren(profileCopy, [
      createElement('p', 'phab-tournaments__card-compact-organizer-name', card.trainerName),
      createElement('p', 'phab-tournaments__card-compact-organizer-handle', card.profileHandle)
    ]);
    appendChildren(profileMain, [createTournamentCompactAvatar(card), profileCopy]);
    appendChildren(profile, [profileMain]);

    appendChildren(badge, [
      createTournamentCompactIcon('badge'),
      createElement('span', 'phab-tournaments__card-compact-badge-text', card.badgeLabel)
    ]);
    appendChildren(heading, [
      badge,
      createElement('h3', 'phab-tournaments__card-compact-title', card.title)
    ]);
    appendChildren(head, [
      heading,
      appendChildren(createElement('div', 'phab-tournaments__card-compact-date-badge'), [
        createElement('span', 'phab-tournaments__card-compact-date-day', dateParts.day),
        createElement('span', 'phab-tournaments__card-compact-date-weekday', dateParts.weekday)
      ])
    ]);

    appendChildren(info, [
      createTournamentCompactMetaRow('calendar', formatTournamentScheduleLabel(card)),
      createTournamentCompactMetaRow('location', card.stationName),
      createTournamentCompactMetaRow('level', card.levelLabel),
      genderLabel ? createTournamentCompactMetaRow('gender', genderLabel) : null
    ]);

    cta.href = card.publicUrl || '#';
    cta.target = '_blank';
    cta.rel = 'noopener noreferrer';
    if (!card.publicUrl) {
      cta.className += ' phab-tournaments__card-compact-cta--disabled';
      cta.removeAttribute('href');
    }

    appendChildren(surface, [head, info, createTournamentCompactProgress(card), cta]);
    appendChildren(metrics, [
      createElement('span', 'phab-tournaments__card-compact-footer-metric is-accent', String(card.participantsCount)),
      createElement('span', 'phab-tournaments__card-compact-footer-metric', String(card.waitlistCount))
    ]);
    appendChildren(footer, [
      metrics,
      durationLabel ? createElement('span', 'phab-tournaments__card-compact-footer-time', durationLabel) : null
    ]);
    appendChildren(article, [profile, surface, footer]);

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
