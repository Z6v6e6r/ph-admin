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
    title: '',
    subtitle: '',
    view: ''
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
      '  --ph-tournament-ink: #1b1734;',
      '  --ph-tournament-ink-soft: rgba(27, 23, 52, 0.62);',
      '  --ph-tournament-line: rgba(95, 76, 170, 0.12);',
      '  --ph-tournament-surface: rgba(255, 255, 255, 0.9);',
      '  --ph-tournament-surface-strong: rgba(255, 255, 255, 0.96);',
      '  --ph-tournament-surface-soft: rgba(240, 236, 255, 0.86);',
      '  --ph-tournament-purple-1: #5b2cff;',
      '  --ph-tournament-purple-2: #b066ff;',
      '  --ph-tournament-pink: #ee76c8;',
      '  --ph-tournament-orange: #f58d4f;',
      '  --ph-tournament-green: #dcf4e5;',
      '  --ph-tournament-rose: #ffe8ee;',
      '  --ph-tournament-shadow: 0 24px 60px rgba(92, 72, 173, 0.16);',
      '}',
      '.phab-tournaments {',
      '  position: relative;',
      '  color: var(--ph-tournament-ink);',
      '  font-family: "Manrope", "Helvetica Neue", Arial, sans-serif;',
      '}',
      '.phab-tournaments, .phab-tournaments * { box-sizing: border-box; }',
      '.phab-tournaments__shell {',
      '  position: relative;',
      '  display: grid;',
      '  gap: 18px;',
      '}',
      '.phab-tournaments__hero,',
      '.phab-tournaments__toolbar,',
      '.phab-tournaments__entry,',
      '.phab-tournaments__notice,',
      '.phab-tournaments__dialog {',
      '  border: 1px solid var(--ph-tournament-line);',
      '  background: linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(251,249,255,0.92) 100%);',
      '  box-shadow: var(--ph-tournament-shadow);',
      '  backdrop-filter: blur(12px);',
      '}',
      '.phab-tournaments__hero {',
      '  display: flex;',
      '  gap: 18px;',
      '  align-items: flex-end;',
      '  justify-content: space-between;',
      '  flex-wrap: wrap;',
      '  padding: 22px 24px;',
      '  border-radius: 34px;',
      '  background:',
      '    radial-gradient(circle at top right, rgba(176, 102, 255, 0.16), transparent 32%),',
      '    radial-gradient(circle at bottom left, rgba(238, 118, 200, 0.12), transparent 34%),',
      '    linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(249,247,255,0.94) 100%);',
      '}',
      '.phab-tournaments__hero-copy { display: grid; gap: 10px; }',
      '.phab-tournaments__eyebrow {',
      '  margin: 0;',
      '  font-size: 12px;',
      '  font-weight: 800;',
      '  line-height: 1.2;',
      '  letter-spacing: 0.12em;',
      '  text-transform: uppercase;',
      '  color: rgba(27, 23, 52, 0.48);',
      '}',
      '.phab-tournaments__title {',
      '  margin: 0;',
      '  font-size: clamp(30px, 4vw, 58px);',
      '  line-height: 0.96;',
      '  letter-spacing: -0.05em;',
      '}',
      '.phab-tournaments__subtitle {',
      '  margin: 0;',
      '  max-width: 760px;',
      '  font-size: 16px;',
      '  line-height: 1.6;',
      '  color: var(--ph-tournament-ink-soft);',
      '}',
      '.phab-tournaments__hero-meta,',
      '.phab-tournaments__summary {',
      '  display: flex;',
      '  flex-wrap: wrap;',
      '  gap: 10px;',
      '  align-items: center;',
      '}',
      '.phab-tournaments__pill {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  min-height: 40px;',
      '  padding: 10px 16px;',
      '  border-radius: 999px;',
      '  background: rgba(241, 237, 255, 0.92);',
      '  border: 1px solid rgba(95, 76, 170, 0.08);',
      '  color: rgba(27, 23, 52, 0.78);',
      '  font-size: 13px;',
      '  font-weight: 700;',
      '  line-height: 1;',
      '  white-space: nowrap;',
      '}',
      '.phab-tournaments__toolbar {',
      '  display: grid;',
      '  gap: 14px;',
      '  padding: 14px 16px;',
      '  border-radius: 34px;',
      '  background:',
      '    radial-gradient(circle at top left, rgba(116, 88, 255, 0.12), transparent 30%),',
      '    linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(250,249,255,0.94) 100%);',
      '}',
      '.phab-tournaments__toolbar-row {',
      '  display: flex;',
      '  gap: 12px;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  flex-wrap: wrap;',
      '}',
      '.phab-tournaments__days-panel {',
      '  display: flex;',
      '  gap: 12px;',
      '  align-items: center;',
      '  min-width: 0;',
      '  flex: 1 1 520px;',
      '}',
      '.phab-tournaments__day-nav {',
      '  appearance: none;',
      '  border: none;',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  width: 48px;',
      '  height: 48px;',
      '  padding: 0;',
      '  border-radius: 999px;',
      '  background: rgba(242, 238, 255, 0.94);',
      '  color: var(--ph-tournament-ink);',
      '  font-size: 24px;',
      '  line-height: 1;',
      '  cursor: pointer;',
      '  transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;',
      '}',
      '.phab-tournaments__day-nav:hover {',
      '  transform: translateY(-1px);',
      '  box-shadow: 0 12px 24px rgba(91, 44, 255, 0.12);',
      '}',
      '.phab-tournaments__day-nav:disabled { opacity: 0.38; cursor: default; box-shadow: none; }',
      '.phab-tournaments__day-rail {',
      '  display: flex;',
      '  gap: 12px;',
      '  min-width: 0;',
      '  overflow-x: auto;',
      '  padding-bottom: 4px;',
      '  scrollbar-width: none;',
      '  scroll-behavior: smooth;',
      '}',
      '.phab-tournaments__day-rail::-webkit-scrollbar { display: none; }',
      '.phab-tournaments__day {',
      '  appearance: none;',
      '  border: 1px solid rgba(95, 76, 170, 0.08);',
      '  display: inline-flex;',
      '  flex-direction: column;',
      '  align-items: center;',
      '  justify-content: center;',
      '  gap: 6px;',
      '  min-width: 84px;',
      '  min-height: 118px;',
      '  padding: 14px 16px;',
      '  border-radius: 34px;',
      '  background: rgba(255, 255, 255, 0.92);',
      '  color: rgba(27, 23, 52, 0.78);',
      '  cursor: pointer;',
      '  transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;',
      '}',
      '.phab-tournaments__day:hover { transform: translateY(-1px); }',
      '.phab-tournaments__day.is-active {',
      '  border-color: transparent;',
      '  background: linear-gradient(180deg, var(--ph-tournament-purple-1) 0%, #7a39ff 58%, var(--ph-tournament-purple-2) 100%);',
      '  color: #fff;',
      '  box-shadow: 0 18px 40px rgba(91, 44, 255, 0.26);',
      '}',
      '.phab-tournaments__day-weekday {',
      '  font-size: 14px;',
      '  font-weight: 800;',
      '  line-height: 1;',
      '  letter-spacing: 0.08em;',
      '  text-transform: uppercase;',
      '}',
      '.phab-tournaments__day-date {',
      '  font-size: 34px;',
      '  font-weight: 900;',
      '  line-height: 0.92;',
      '  letter-spacing: -0.05em;',
      '}',
      '.phab-tournaments__day-month {',
      '  font-size: 12px;',
      '  font-weight: 700;',
      '  line-height: 1;',
      '  letter-spacing: 0.08em;',
      '  text-transform: uppercase;',
      '  opacity: 0.82;',
      '}',
      '.phab-tournaments__toolbar-side {',
      '  display: flex;',
      '  gap: 12px;',
      '  align-items: center;',
      '  justify-content: flex-end;',
      '  flex-wrap: wrap;',
      '}',
      '.phab-tournaments__view {',
      '  display: inline-flex;',
      '  padding: 4px;',
      '  border-radius: 999px;',
      '  background: rgba(241, 237, 255, 0.92);',
      '  border: 1px solid rgba(95, 76, 170, 0.08);',
      '}',
      '.phab-tournaments__view-button {',
      '  appearance: none;',
      '  border: none;',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  min-width: 108px;',
      '  min-height: 44px;',
      '  padding: 0 16px;',
      '  border-radius: 999px;',
      '  background: transparent;',
      '  color: rgba(27, 23, 52, 0.7);',
      '  font-size: 14px;',
      '  font-weight: 800;',
      '  line-height: 1;',
      '  cursor: pointer;',
      '  transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease;',
      '}',
      '.phab-tournaments__view-button.is-active {',
      '  background: #111018;',
      '  color: #fff;',
      '  box-shadow: 0 12px 24px rgba(17, 16, 24, 0.18);',
      '}',
      '.phab-tournaments__board { display: grid; gap: 14px; }',
      '.phab-tournaments__day-heading {',
      '  display: flex;',
      '  gap: 12px;',
      '  align-items: flex-end;',
      '  justify-content: space-between;',
      '  flex-wrap: wrap;',
      '  padding: 2px 4px 0;',
      '}',
      '.phab-tournaments__day-title {',
      '  margin: 0;',
      '  font-size: clamp(22px, 2.8vw, 34px);',
      '  line-height: 1;',
      '  letter-spacing: -0.04em;',
      '}',
      '.phab-tournaments__day-caption {',
      '  margin: 0;',
      '  color: var(--ph-tournament-ink-soft);',
      '  font-size: 14px;',
      '  line-height: 1.5;',
      '}',
      '.phab-tournaments__collection { display: grid; gap: 18px; }',
      '.phab-tournaments__collection--cards {',
      '  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));',
      '}',
      '.phab-tournaments__collection--schedule { grid-template-columns: minmax(0, 1fr); }',
      '.phab-tournaments__entry { position: relative; overflow: hidden; }',
      '.phab-tournaments__entry::before {',
      '  content: "";',
      '  position: absolute;',
      '  inset: auto -34px -78px auto;',
      '  width: 190px;',
      '  height: 190px;',
      '  border-radius: 999px;',
      '  background: radial-gradient(circle, rgba(176, 102, 255, 0.16) 0%, rgba(176, 102, 255, 0) 72%);',
      '  pointer-events: none;',
      '}',
      '.phab-tournaments__entry--schedule {',
      '  display: grid;',
      '  grid-template-columns: 116px minmax(0, 1fr) 220px;',
      '  gap: 20px;',
      '  align-items: stretch;',
      '  padding: 24px;',
      '  border-radius: 34px;',
      '}',
      '.phab-tournaments__entry--card {',
      '  display: grid;',
      '  gap: 18px;',
      '  padding: 22px;',
      '  border-radius: 32px;',
      '}',
      '.phab-tournaments__time-col {',
      '  display: grid;',
      '  align-content: start;',
      '  gap: 8px;',
      '}',
      '.phab-tournaments__time-value {',
      '  font-size: clamp(28px, 4vw, 40px);',
      '  font-weight: 900;',
      '  line-height: 0.92;',
      '  letter-spacing: -0.06em;',
      '}',
      '.phab-tournaments__duration {',
      '  color: var(--ph-tournament-ink-soft);',
      '  font-size: 15px;',
      '  line-height: 1.25;',
      '}',
      '.phab-tournaments__main {',
      '  position: relative;',
      '  display: grid;',
      '  gap: 14px;',
      '  min-width: 0;',
      '}',
      '.phab-tournaments__main::after {',
      '  content: "";',
      '  position: absolute;',
      '  left: 0;',
      '  right: 0;',
      '  bottom: 72px;',
      '  height: 1px;',
      '  background: rgba(95, 76, 170, 0.12);',
      '  opacity: 0;',
      '}',
      '.phab-tournaments__entry--schedule .phab-tournaments__main::after { opacity: 1; }',
      '.phab-tournaments__chips { display: flex; flex-wrap: wrap; gap: 10px; }',
      '.phab-tournaments__chip {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  min-height: 36px;',
      '  padding: 8px 14px;',
      '  border-radius: 999px;',
      '  font-size: 14px;',
      '  font-weight: 800;',
      '  line-height: 1;',
      '  white-space: nowrap;',
      '}',
      '.phab-tournaments__chip--status-upcoming { background: rgba(240, 236, 255, 0.94); color: #5b2cff; }',
      '.phab-tournaments__chip--status-live { background: linear-gradient(90deg, #7a39ff 0%, #ee76c8 100%); color: #fff; }',
      '.phab-tournaments__chip--status-hot { background: rgba(255, 238, 223, 0.94); color: #c86426; }',
      '.phab-tournaments__chip--status-waitlist { background: rgba(237, 231, 255, 0.94); color: #6d3bff; }',
      '.phab-tournaments__chip--status-full { background: rgba(245, 241, 255, 0.96); color: #7b719c; }',
      '.phab-tournaments__chip--status-completed { background: var(--ph-tournament-green); color: #24734e; }',
      '.phab-tournaments__chip--status-cancelled { background: var(--ph-tournament-rose); color: #c14963; }',
      '.phab-tournaments__chip--status-closed { background: rgba(241, 237, 255, 0.92); color: #6d678b; }',
      '.phab-tournaments__chip--type { background: rgba(240, 236, 255, 0.88); color: #494173; }',
      '.phab-tournaments__chip--level { background: rgba(255, 237, 223, 0.96); color: #cf6c30; }',
      '.phab-tournaments__chip--gender { background: rgba(247, 244, 255, 0.98); color: #7466a4; }',
      '.phab-tournaments__entry-title {',
      '  margin: 0;',
      '  font-size: clamp(30px, 3.4vw, 54px);',
      '  font-weight: 900;',
      '  line-height: 0.96;',
      '  letter-spacing: -0.05em;',
      '}',
      '.phab-tournaments__subline {',
      '  display: flex;',
      '  flex-wrap: wrap;',
      '  gap: 10px 14px;',
      '  color: var(--ph-tournament-ink-soft);',
      '  font-size: 16px;',
      '  line-height: 1.45;',
      '}',
      '.phab-tournaments__host {',
      '  display: flex;',
      '  gap: 12px;',
      '  align-items: center;',
      '  min-width: 0;',
      '}',
      '.phab-tournaments__avatar {',
      '  width: 58px;',
      '  height: 58px;',
      '  flex: 0 0 58px;',
      '  border-radius: 999px;',
      '  overflow: hidden;',
      '  display: grid;',
      '  place-items: center;',
      '  background: linear-gradient(135deg, #2d235b 0%, #7a39ff 100%);',
      '  color: #fff;',
      '  font-size: 22px;',
      '  font-weight: 900;',
      '  letter-spacing: -0.04em;',
      '  box-shadow: 0 12px 28px rgba(91, 44, 255, 0.18);',
      '}',
      '.phab-tournaments__avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }',
      '.phab-tournaments__host-meta { display: grid; gap: 4px; min-width: 0; }',
      '.phab-tournaments__host-label {',
      '  margin: 0;',
      '  color: rgba(27, 23, 52, 0.48);',
      '  font-size: 12px;',
      '  font-weight: 700;',
      '  line-height: 1;',
      '  text-transform: uppercase;',
      '  letter-spacing: 0.08em;',
      '}',
      '.phab-tournaments__host-name {',
      '  margin: 0;',
      '  font-size: 17px;',
      '  font-weight: 700;',
      '  line-height: 1.3;',
      '  color: rgba(27, 23, 52, 0.76);',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  white-space: nowrap;',
      '}',
      '.phab-tournaments__stats {',
      '  display: flex;',
      '  flex-wrap: wrap;',
      '  gap: 12px;',
      '  align-items: center;',
      '  padding-top: 2px;',
      '}',
      '.phab-tournaments__players {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 10px;',
      '  font-size: 18px;',
      '  font-weight: 800;',
      '  line-height: 1;',
      '}',
      '.phab-tournaments__players-note {',
      '  color: var(--ph-tournament-ink-soft);',
      '  font-size: 14px;',
      '  font-weight: 700;',
      '  line-height: 1;',
      '  letter-spacing: 0.04em;',
      '  text-transform: uppercase;',
      '}',
      '.phab-tournaments__metric-pill {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  min-height: 40px;',
      '  padding: 10px 16px;',
      '  border-radius: 999px;',
      '  background: rgba(245, 241, 255, 0.94);',
      '  color: #5a4d8e;',
      '  font-size: 15px;',
      '  font-weight: 700;',
      '  line-height: 1;',
      '}',
      '.phab-tournaments__metric-pill--success { background: var(--ph-tournament-green); color: #24734e; }',
      '.phab-tournaments__metric-pill--hot { background: rgba(255, 238, 223, 0.96); color: #c86426; }',
      '.phab-tournaments__metric-pill--danger { background: rgba(245, 241, 255, 0.96); color: #6c638d; }',
      '.phab-tournaments__side {',
      '  display: grid;',
      '  align-content: space-between;',
      '  justify-items: end;',
      '  gap: 14px;',
      '}',
      '.phab-tournaments__aside-bottom {',
      '  display: grid;',
      '  gap: 12px;',
      '  justify-items: end;',
      '  width: min(100%, 220px);',
      '}',
      '.phab-tournaments__calendar {',
      '  width: 132px;',
      '  min-height: 140px;',
      '  border-radius: 30px;',
      '  overflow: hidden;',
      '  background: linear-gradient(180deg, #36206d 0%, #612dff 54%, #ee76c8 100%);',
      '  color: #fff;',
      '  box-shadow: 0 18px 42px rgba(91, 44, 255, 0.22);',
      '}',
      '.phab-tournaments__calendar-top {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  min-height: 46px;',
      '  padding: 10px 12px;',
      '  background: rgba(20, 12, 46, 0.24);',
      '  font-size: 16px;',
      '  font-weight: 900;',
      '  line-height: 1;',
      '  letter-spacing: 0.06em;',
      '  text-transform: uppercase;',
      '}',
      '.phab-tournaments__calendar-day {',
      '  display: grid;',
      '  place-items: center;',
      '  min-height: 94px;',
      '  padding: 10px 14px 8px;',
      '  font-size: 56px;',
      '  font-weight: 900;',
      '  line-height: 0.92;',
      '  letter-spacing: -0.06em;',
      '  text-shadow: 0 3px 0 rgba(31, 23, 52, 0.16);',
      '}',
      '.phab-tournaments__calendar-month {',
      '  padding: 0 14px 12px;',
      '  text-align: center;',
      '  font-size: 12px;',
      '  font-weight: 800;',
      '  line-height: 1;',
      '  letter-spacing: 0.1em;',
      '  text-transform: uppercase;',
      '  opacity: 0.92;',
      '}',
      '.phab-tournaments__button,',
      '.phab-tournaments__button-secondary {',
      '  appearance: none;',
      '  border: none;',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  width: 100%;',
      '  min-height: 56px;',
      '  padding: 14px 20px;',
      '  border-radius: 999px;',
      '  font-size: 17px;',
      '  font-weight: 900;',
      '  line-height: 1;',
      '  text-decoration: none;',
      '  cursor: pointer;',
      '  transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;',
      '}',
      '.phab-tournaments__button:hover,',
      '.phab-tournaments__button-secondary:hover { transform: translateY(-1px); }',
      '.phab-tournaments__button {',
      '  background: linear-gradient(90deg, var(--ph-tournament-purple-1) 0%, var(--ph-tournament-purple-2) 100%);',
      '  color: #fff;',
      '  box-shadow: 0 16px 32px rgba(91, 44, 255, 0.24);',
      '}',
      '.phab-tournaments__button:disabled { opacity: 0.54; cursor: default; box-shadow: none; }',
      '.phab-tournaments__button-secondary {',
      '  background: rgba(255, 255, 255, 0.94);',
      '  border: 1px solid rgba(95, 76, 170, 0.14);',
      '  color: var(--ph-tournament-ink);',
      '}',
      '.phab-tournaments__hint {',
      '  margin: 0;',
      '  color: rgba(27, 23, 52, 0.5);',
      '  font-size: 12px;',
      '  line-height: 1.5;',
      '}',
      '.phab-tournaments__card-top {',
      '  display: flex;',
      '  gap: 16px;',
      '  align-items: flex-start;',
      '  justify-content: space-between;',
      '}',
      '.phab-tournaments__card-head {',
      '  display: grid;',
      '  gap: 14px;',
      '  min-width: 0;',
      '  flex: 1 1 auto;',
      '}',
      '.phab-tournaments__card-summary {',
      '  display: flex;',
      '  gap: 12px;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  flex-wrap: wrap;',
      '}',
      '.phab-tournaments__card-title {',
      '  margin: 0;',
      '  font-size: clamp(28px, 4vw, 42px);',
      '  line-height: 0.96;',
      '  letter-spacing: -0.05em;',
      '}',
      '.phab-tournaments__card-footer {',
      '  display: flex;',
      '  gap: 12px;',
      '  align-items: center;',
      '  flex-wrap: wrap;',
      '}',
      '.phab-tournaments__notice {',
      '  padding: 24px;',
      '  border-radius: 30px;',
      '  color: var(--ph-tournament-ink-soft);',
      '  font-size: 16px;',
      '  line-height: 1.65;',
      '}',
      '.phab-tournaments__notice-title {',
      '  margin: 0 0 8px;',
      '  color: var(--ph-tournament-ink);',
      '  font-size: 24px;',
      '  font-weight: 900;',
      '  line-height: 1;',
      '  letter-spacing: -0.04em;',
      '}',
      '.phab-tournaments__backdrop {',
      '  position: fixed;',
      '  inset: 0;',
      '  z-index: 9999;',
      '  display: none;',
      '  align-items: center;',
      '  justify-content: center;',
      '  padding: 18px;',
      '  background: rgba(22, 18, 43, 0.48);',
      '}',
      '.phab-tournaments__backdrop.is-open { display: flex; }',
      '.phab-tournaments__dialog {',
      '  width: min(100%, 620px);',
      '  max-height: calc(100vh - 36px);',
      '  overflow: auto;',
      '  padding: 24px;',
      '  border-radius: 30px;',
      '}',
      '.phab-tournaments__dialog-title {',
      '  margin: 0 0 8px;',
      '  font-size: clamp(28px, 4vw, 40px);',
      '  line-height: 0.96;',
      '  letter-spacing: -0.05em;',
      '}',
      '.phab-tournaments__dialog-subtitle {',
      '  margin: 0 0 16px;',
      '  color: var(--ph-tournament-ink-soft);',
      '  line-height: 1.55;',
      '}',
      '.phab-tournaments__dialog-status {',
      '  margin-bottom: 16px;',
      '  padding: 14px 16px;',
      '  border-radius: 20px;',
      '  font-size: 15px;',
      '  line-height: 1.5;',
      '}',
      '.phab-tournaments__dialog-status--info { background: rgba(240, 236, 255, 0.92); color: #4f43a5; }',
      '.phab-tournaments__dialog-status--success { background: var(--ph-tournament-green); color: #24734e; }',
      '.phab-tournaments__dialog-status--warning { background: rgba(255, 238, 223, 0.96); color: #c86426; }',
      '.phab-tournaments__field { display: grid; gap: 8px; margin-top: 12px; font-size: 13px; font-weight: 700; }',
      '.phab-tournaments__field input,',
      '.phab-tournaments__field select,',
      '.phab-tournaments__field textarea {',
      '  width: 100%;',
      '  border: 1px solid rgba(95, 76, 170, 0.16);',
      '  border-radius: 18px;',
      '  padding: 13px 14px;',
      '  font: inherit;',
      '  font-size: 15px;',
      '  background: rgba(255,255,255,0.96);',
      '  color: var(--ph-tournament-ink);',
      '}',
      '.phab-tournaments__field textarea { min-height: 92px; resize: vertical; }',
      '.phab-tournaments__field input:focus,',
      '.phab-tournaments__field select:focus,',
      '.phab-tournaments__field textarea:focus {',
      '  outline: none;',
      '  border-color: rgba(91, 44, 255, 0.36);',
      '  box-shadow: 0 0 0 4px rgba(91, 44, 255, 0.08);',
      '}',
      '.phab-tournaments__dialog-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }',
      '.phab-tournaments__dialog-actions .phab-tournaments__button,',
      '.phab-tournaments__dialog-actions .phab-tournaments__button-secondary { width: auto; min-width: 180px; }',
      '.phab-tournaments__footnote {',
      '  margin: 14px 0 0;',
      '  color: rgba(27, 23, 52, 0.52);',
      '  font-size: 12px;',
      '  line-height: 1.5;',
      '}',
      '.phab-tournaments--screen .phab-tournaments__shell { gap: 22px; }',
      '.phab-tournaments--screen .phab-tournaments__entry--schedule { padding: 28px; }',
      '.phab-tournaments--screen .phab-tournaments__entry-title { font-size: clamp(34px, 3.6vw, 58px); }',
      '@media (max-width: 1180px) {',
      '  .phab-tournaments__entry--schedule { grid-template-columns: 96px minmax(0, 1fr) 188px; }',
      '  .phab-tournaments__calendar { width: 118px; min-height: 132px; }',
      '  .phab-tournaments__calendar-day { font-size: 50px; min-height: 88px; }',
      '}',
      '@media (max-width: 767px) {',
      '  .phab-tournaments__shell { gap: 14px; }',
      '  .phab-tournaments__hero { padding: 18px; border-radius: 28px; }',
      '  .phab-tournaments__toolbar { padding: 12px; border-radius: 28px; }',
      '  .phab-tournaments__toolbar-row { align-items: stretch; }',
      '  .phab-tournaments__days-panel { flex-basis: 100%; }',
      '  .phab-tournaments__day-nav { width: 42px; height: 42px; font-size: 20px; }',
      '  .phab-tournaments__day { min-width: 74px; min-height: 104px; padding: 12px 10px; border-radius: 28px; }',
      '  .phab-tournaments__day-date { font-size: 30px; }',
      '  .phab-tournaments__toolbar-side { width: 100%; justify-content: space-between; }',
      '  .phab-tournaments__view-button { min-width: 92px; min-height: 40px; font-size: 13px; }',
      '  .phab-tournaments__day-heading { padding: 0; }',
      '  .phab-tournaments__collection--cards { grid-template-columns: minmax(0, 1fr); }',
      '  .phab-tournaments__entry--schedule {',
      '    grid-template-columns: minmax(0, 1fr) 118px;',
      '    gap: 14px;',
      '    padding: 18px;',
      '    border-radius: 28px;',
      '  }',
      '  .phab-tournaments__time-col { grid-column: 1; grid-row: 1; }',
      '  .phab-tournaments__side { grid-column: 2; grid-row: 1; align-content: start; }',
      '  .phab-tournaments__main { grid-column: 1 / -1; }',
      '  .phab-tournaments__entry--schedule .phab-tournaments__main::after { bottom: 88px; }',
      '  .phab-tournaments__entry--card { padding: 18px; border-radius: 28px; }',
      '  .phab-tournaments__card-top { gap: 14px; }',
      '  .phab-tournaments__entry-title,',
      '  .phab-tournaments__card-title { font-size: 26px; }',
      '  .phab-tournaments__subline { font-size: 15px; }',
      '  .phab-tournaments__host-name { white-space: normal; }',
      '  .phab-tournaments__calendar { width: 118px; min-height: 124px; border-radius: 24px; }',
      '  .phab-tournaments__calendar-top { min-height: 40px; font-size: 14px; }',
      '  .phab-tournaments__calendar-day { min-height: 76px; font-size: 44px; }',
      '  .phab-tournaments__aside-bottom { width: 100%; justify-items: stretch; }',
      '  .phab-tournaments__button,',
      '  .phab-tournaments__button-secondary { min-height: 52px; font-size: 16px; }',
      '  .phab-tournaments__dialog { padding: 18px; border-radius: 24px; }',
      '  .phab-tournaments__dialog-actions .phab-tournaments__button,',
      '  .phab-tournaments__dialog-actions .phab-tournaments__button-secondary { width: 100%; }',
      '}',
      '@media (max-width: 540px) {',
      '  .phab-tournaments__summary { width: 100%; }',
      '  .phab-tournaments__toolbar-side { flex-direction: column; align-items: stretch; }',
      '  .phab-tournaments__view { width: 100%; }',
      '  .phab-tournaments__view-button { flex: 1 1 0; }',
      '  .phab-tournaments__entry--schedule { grid-template-columns: minmax(0, 1fr); }',
      '  .phab-tournaments__time-col,',
      '  .phab-tournaments__side,',
      '  .phab-tournaments__main { grid-column: auto; grid-row: auto; }',
      '  .phab-tournaments__side { justify-items: start; }',
      '  .phab-tournaments__aside-bottom { justify-items: stretch; }',
      '  .phab-tournaments__card-top { flex-direction: column; }',
      '  .phab-tournaments__card-summary { align-items: stretch; }',
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

  function appendChildren(parent, children) {
    children.forEach(function (child) {
      if (child) {
        parent.appendChild(child);
      }
    });
    return parent;
  }

  function parseDate(value) {
    if (!value) {
      return null;
    }

    var parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed;
  }

  function formatGeneratedAt(value) {
    var parsed = parseDate(value);
    if (!parsed) {
      return 'Обновляется автоматически';
    }

    return 'Обновлено ' + parsed.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatTournamentDate(value) {
    var parsed = parseDate(value);
    if (!parsed) {
      return 'Дата уточняется';
    }

    return parsed.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatDateKey(date) {
    return [
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function formatTime(value) {
    var parsed = parseDate(value);
    if (!parsed) {
      return 'Скоро';
    }

    return parsed.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatTimeRange(card) {
    var start = parseDate(card.startsAt);
    var end = parseDate(card.endsAt);

    if (start && end) {
      return formatTime(start) + ' - ' + formatTime(end);
    }
    if (start) {
      return formatTime(start);
    }
    return 'Время уточняется';
  }

  function formatDurationMinutes(card) {
    var start = parseDate(card.startsAt);
    var end = parseDate(card.endsAt);

    if (start && end) {
      var minutes = Math.round((end.getTime() - start.getTime()) / 60000);
      if (minutes > 0) {
        return minutes;
      }
    }

    return null;
  }

  function formatDurationLabel(card) {
    var minutes = formatDurationMinutes(card);
    if (!minutes) {
      return 'Длительность уточняется';
    }

    return String(minutes) + ' мин';
  }

  function formatWeekdayShort(date) {
    return date.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '');
  }

  function formatMonthShort(date) {
    return date.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
  }

  function formatDayLabel(date) {
    return date.toLocaleDateString('ru-RU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
  }

  function formatAccessLevels(levels) {
    var list = normalizeArray(levels).filter(Boolean);
    if (list.length === 0) {
      return 'Без ограничений';
    }
    return 'Уровни: ' + list.join(', ');
  }

  function formatAccessLevelCompact(levels) {
    var list = normalizeArray(levels).filter(Boolean);
    if (list.length === 0) {
      return '';
    }
    return list.join('/');
  }

  function pluralizeSpots(count) {
    var numeric = Math.max(0, Number(count) || 0);
    var mod10 = numeric % 10;
    var mod100 = numeric % 100;

    if (mod10 === 1 && mod100 !== 11) {
      return numeric + ' место';
    }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
      return numeric + ' места';
    }
    return numeric + ' мест';
  }

  function formatSpots(card) {
    var participantsCount = Math.max(0, Number(card.participantsCount) || 0);
    var maxPlayers = Number(card.maxPlayers);
    if (!Number.isFinite(maxPlayers) || maxPlayers <= 0) {
      return 'Состав уточняется';
    }

    return String(participantsCount) + ' / ' + String(Math.round(maxPlayers));
  }

  function formatGenderLabel(gender) {
    var value = String(gender || '').toUpperCase();
    if (value === 'MIXED') {
      return 'MIX';
    }
    if (value === 'MALE') {
      return 'MALE';
    }
    if (value === 'FEMALE') {
      return 'FEMALE';
    }
    return '';
  }

  function resolveLocationLabel(card) {
    return (
      String(card.studioName || '').trim()
      || String(normalizeObject(card.sourceTournament).studioName || '').trim()
      || 'PadelHub'
    );
  }

  function resolveTrainerLabel(card) {
    return (
      String(card.trainerName || '').trim()
      || String(normalizeObject(card.sourceTournament).trainerName || '').trim()
      || 'Организатор турнира'
    );
  }

  function resolveTitle(card) {
    var skin = normalizeObject(card.skin);
    return String(skin.title || card.name || 'Турнир').trim() || 'Турнир';
  }

  function resolveSubtitle(card) {
    var skin = normalizeObject(card.skin);
    if (skin.subtitle) {
      return String(skin.subtitle);
    }

    return [formatTimeRange(card), resolveLocationLabel(card)].filter(Boolean).join(' • ');
  }

  function resolvePrimaryImage(card) {
    var skin = normalizeObject(card.skin);
    return String(skin.imageUrl || '').trim();
  }

  function resolveInitials(value) {
    var words = String(value || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (words.length === 0) {
      return 'PH';
    }
    if (words.length === 1) {
      return words[0].slice(0, 2).toUpperCase();
    }
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  }

  function getDefaultViewMode() {
    if (window.matchMedia && window.matchMedia('(max-width: 767px)').matches) {
      return 'cards';
    }
    return 'schedule';
  }

  function sortItems(items) {
    return items.slice().sort(function (left, right) {
      var leftDate = parseDate(left.startsAt);
      var rightDate = parseDate(right.startsAt);

      if (leftDate && rightDate) {
        return leftDate.getTime() - rightDate.getTime();
      }
      if (leftDate) {
        return -1;
      }
      if (rightDate) {
        return 1;
      }

      return resolveTitle(left).localeCompare(resolveTitle(right), 'ru');
    });
  }

  function buildDayGroups(items) {
    var grouped = {};
    var ordered = [];

    items.forEach(function (item) {
      var parsed = parseDate(item.startsAt);
      var key = parsed ? formatDateKey(parsed) : 'unknown';

      if (!grouped[key]) {
        grouped[key] = {
          key: key,
          date: parsed,
          items: []
        };
        ordered.push(grouped[key]);
      }

      grouped[key].items.push(item);
    });

    return ordered.map(function (group) {
      var weekday = group.date ? formatWeekdayShort(group.date).toUpperCase() : '...';
      var month = group.date ? formatMonthShort(group.date).toUpperCase() : 'DATE';
      var dayNumber = group.date ? String(group.date.getDate()) : '—';

      return {
        key: group.key,
        date: group.date,
        items: group.items,
        weekday: weekday,
        month: month,
        dayNumber: dayNumber,
        headline: group.date ? formatDayLabel(group.date) : 'Турниры без даты'
      };
    });
  }

  function ensureSelectedDay(state, dayGroups) {
    if (dayGroups.length === 0) {
      state.selectedDayKey = '';
      return;
    }

    var exists = dayGroups.some(function (group) {
      return group.key === state.selectedDayKey;
    });

    if (!exists) {
      state.selectedDayKey = dayGroups[0].key;
    }
  }

  function getSelectedGroup(state, dayGroups) {
    ensureSelectedDay(state, dayGroups);
    return (
      dayGroups.find(function (group) {
        return group.key === state.selectedDayKey;
      }) || dayGroups[0] || null
    );
  }

  function resolveTournamentState(card) {
    var now = Date.now();
    var start = parseDate(card.startsAt);
    var end = parseDate(card.endsAt);
    var sourceStatus = String(normalizeObject(card.sourceTournament).status || '').toUpperCase();
    var participantsCount = Math.max(0, Number(card.participantsCount) || 0);
    var maxPlayers = Number(card.maxPlayers);
    var spotsLeft = Number.isFinite(maxPlayers) && maxPlayers > 0
      ? Math.max(0, Math.round(maxPlayers) - participantsCount)
      : null;

    if (!end && start) {
      end = new Date(start.getTime() + 120 * 60000);
    }

    if (sourceStatus === 'CANCELED') {
      return {
        key: 'cancelled',
        label: 'Отменено',
        spotsLeft: spotsLeft,
        pillTone: 'danger',
        pillText: 'Отменено'
      };
    }

    if (sourceStatus === 'FINISHED' || (end && end.getTime() < now)) {
      return {
        key: 'completed',
        label: 'Завершено',
        spotsLeft: spotsLeft,
        pillTone: 'success',
        pillText: 'Завершено'
      };
    }

    if (sourceStatus === 'RUNNING' || (start && end && start.getTime() <= now && end.getTime() >= now)) {
      return {
        key: 'live',
        label: 'Идёт игра',
        spotsLeft: spotsLeft,
        pillTone: 'hot',
        pillText: 'LIVE'
      };
    }

    if (!card.registrationOpen) {
      return {
        key: 'closed',
        label: 'Регистрация закрыта',
        spotsLeft: spotsLeft,
        pillTone: 'danger',
        pillText: 'Регистрация закрыта'
      };
    }

    if (spotsLeft === 0) {
      return {
        key: card.waitlistCount > 0 ? 'waitlist' : 'full',
        label: card.waitlistCount > 0 ? 'Лист ожидания' : 'Нет мест',
        spotsLeft: 0,
        pillTone: 'danger',
        pillText: card.waitlistCount > 0 ? 'Лист ожидания' : 'Нет мест'
      };
    }

    if (spotsLeft !== null && spotsLeft <= 2) {
      return {
        key: 'hot',
        label: pluralizeSpots(spotsLeft),
        spotsLeft: spotsLeft,
        pillTone: 'hot',
        pillText: pluralizeSpots(spotsLeft)
      };
    }

    return {
      key: 'upcoming',
      label: 'Открыта запись',
      spotsLeft: spotsLeft,
      pillTone: spotsLeft !== null && spotsLeft > 0 ? 'success' : 'danger',
      pillText: spotsLeft !== null ? pluralizeSpots(spotsLeft) : 'Набор открыт'
    };
  }

  function resolveAction(card, descriptor) {
    var skin = normalizeObject(card.skin);
    var publicUrl = String(card.publicUrl || '').trim();
    var joinUrl = String(card.joinUrl || '').trim();

    if (descriptor.key === 'completed' || descriptor.key === 'cancelled') {
      return {
        kind: 'secondary',
        label: 'Просмотр',
        mode: publicUrl ? 'public' : 'disabled'
      };
    }

    if (descriptor.key === 'closed') {
      return {
        kind: 'secondary',
        label: publicUrl ? 'Подробнее' : 'Регистрация закрыта',
        mode: publicUrl ? 'public' : 'disabled'
      };
    }

    if (descriptor.key === 'full' || descriptor.key === 'waitlist') {
      return {
        kind: 'secondary',
        label: 'Лист ожидания',
        mode: joinUrl ? 'join' : publicUrl ? 'public' : 'disabled'
      };
    }

    return {
      kind: 'primary',
      label: String(skin.ctaLabel || '').trim() || 'Записаться',
      mode: joinUrl ? 'join' : publicUrl ? 'public' : 'disabled'
    };
  }

  function createStatusCard(title, description) {
    var card = createElement('section', 'phab-tournaments__notice');
    card.appendChild(createElement('h3', 'phab-tournaments__notice-title', title));
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

  function createChip(text, toneClass) {
    return createElement('span', 'phab-tournaments__chip ' + toneClass, text);
  }

  function createMetricPill(text, modifierClass) {
    return createElement(
      'span',
      'phab-tournaments__metric-pill' + (modifierClass ? ' ' + modifierClass : ''),
      text
    );
  }

  function createInfoPill(text) {
    return createElement('span', 'phab-tournaments__pill', text);
  }

  function createAvatar(card) {
    var imageUrl = resolvePrimaryImage(card);
    var avatar = createElement('div', 'phab-tournaments__avatar');

    if (imageUrl) {
      var img = document.createElement('img');
      img.src = imageUrl;
      img.alt = resolveTrainerLabel(card);
      avatar.appendChild(img);
      return avatar;
    }

    avatar.textContent = resolveInitials(resolveTrainerLabel(card));
    return avatar;
  }

  function createCalendar(card) {
    var skin = normalizeObject(card.skin);
    var start = parseDate(card.startsAt);
    var topLabel = String(skin.badgeLabel || '').trim() || formatAccessLevelCompact(card.accessLevels) || 'DAY';
    var dayLabel = start ? String(start.getDate()) : '—';
    var monthLabel = start ? formatMonthShort(start).toUpperCase() : 'DATE';
    var calendar = createElement('div', 'phab-tournaments__calendar');

    calendar.appendChild(createElement('div', 'phab-tournaments__calendar-top', topLabel));
    calendar.appendChild(createElement('div', 'phab-tournaments__calendar-day', dayLabel));
    calendar.appendChild(createElement('div', 'phab-tournaments__calendar-month', monthLabel));
    return calendar;
  }

  function createTournamentChips(card, descriptor) {
    var chips = createElement('div', 'phab-tournaments__chips');
    var compactLevels = formatAccessLevelCompact(card.accessLevels);
    var genderLabel = formatGenderLabel(card.gender);

    chips.appendChild(createChip(descriptor.label, 'phab-tournaments__chip--status-' + descriptor.key));
    chips.appendChild(
      createChip(card.tournamentType || 'Турнир', 'phab-tournaments__chip--type')
    );

    if (compactLevels) {
      chips.appendChild(createChip(compactLevels, 'phab-tournaments__chip--level'));
    }

    if (genderLabel) {
      chips.appendChild(createChip(genderLabel, 'phab-tournaments__chip--gender'));
    }

    return chips;
  }

  function createHostBlock(card) {
    var host = createElement('div', 'phab-tournaments__host');
    var meta = createElement('div', 'phab-tournaments__host-meta');

    meta.appendChild(createElement('p', 'phab-tournaments__host-label', 'Организатор'));
    meta.appendChild(createElement('p', 'phab-tournaments__host-name', resolveTrainerLabel(card)));

    host.appendChild(createAvatar(card));
    host.appendChild(meta);
    return host;
  }

  function createStatsBlock(card, descriptor) {
    var stats = createElement('div', 'phab-tournaments__stats');
    var players = createElement('div', 'phab-tournaments__players');
    var playersNote = formatGenderLabel(card.gender);

    players.appendChild(document.createTextNode(formatSpots(card)));
    if (playersNote) {
      players.appendChild(createElement('span', 'phab-tournaments__players-note', playersNote));
    }
    stats.appendChild(players);

    if (descriptor.spotsLeft === 0) {
      stats.appendChild(createMetricPill('Нет мест', 'phab-tournaments__metric-pill--danger'));
    } else if (descriptor.spotsLeft && descriptor.spotsLeft > 0 && descriptor.spotsLeft <= 2) {
      stats.appendChild(
        createMetricPill(pluralizeSpots(descriptor.spotsLeft), 'phab-tournaments__metric-pill--hot')
      );
    } else if (descriptor.spotsLeft && descriptor.spotsLeft > 2) {
      stats.appendChild(
        createMetricPill(pluralizeSpots(descriptor.spotsLeft), 'phab-tournaments__metric-pill--success')
      );
    } else if (descriptor.pillText) {
      stats.appendChild(createMetricPill(descriptor.pillText));
    }

    if (Number(card.waitlistCount) > 0) {
      stats.appendChild(createMetricPill('WL ' + String(card.waitlistCount)));
    }

    return stats;
  }

  function createActionControl(card, action, state, mount) {
    var joinUrl = resolveUrl(card.joinUrl, state.config);
    var publicUrl = resolveUrl(card.publicUrl, state.config);
    var className =
      action.kind === 'secondary'
        ? 'phab-tournaments__button-secondary'
        : 'phab-tournaments__button';
    var control;

    if (action.mode === 'public' && publicUrl) {
      control = createElement('a', className, action.label);
      control.href = publicUrl;
      control.target = '_blank';
      control.rel = 'noopener noreferrer';
      return control;
    }

    control = createElement('button', className, action.label);
    control.type = 'button';
    control.disabled = action.mode === 'disabled' || !joinUrl;
    control.addEventListener('click', function () {
      openJoinFlow(mount, state, card, joinUrl);
    });
    return control;
  }

  function createScheduleCard(card, state, mount) {
    var descriptor = resolveTournamentState(card);
    var action = resolveAction(card, descriptor);
    var article = createElement('article', 'phab-tournaments__entry phab-tournaments__entry--schedule');
    var timeCol = createElement('div', 'phab-tournaments__time-col');
    var main = createElement('div', 'phab-tournaments__main');
    var side = createElement('div', 'phab-tournaments__side');
    var asideBottom = createElement('div', 'phab-tournaments__aside-bottom');

    timeCol.appendChild(createElement('div', 'phab-tournaments__time-value', formatTime(card.startsAt)));
    timeCol.appendChild(createElement('div', 'phab-tournaments__duration', formatDurationLabel(card)));

    main.appendChild(createTournamentChips(card, descriptor));
    main.appendChild(createElement('h3', 'phab-tournaments__entry-title', resolveTitle(card)));
    main.appendChild(createElement('div', 'phab-tournaments__subline', resolveSubtitle(card)));
    main.appendChild(createHostBlock(card));
    main.appendChild(createStatsBlock(card, descriptor));

    side.appendChild(createCalendar(card));
    asideBottom.appendChild(createActionControl(card, action, state, mount));
    if (state.crossOriginApi) {
      asideBottom.appendChild(
        createElement(
          'p',
          'phab-tournaments__hint',
          'После нажатия откроется отдельная страница записи на backend PadelHub.'
        )
      );
    }
    side.appendChild(asideBottom);

    article.appendChild(timeCol);
    article.appendChild(main);
    article.appendChild(side);
    return article;
  }

  function createCardModeCard(card, state, mount) {
    var descriptor = resolveTournamentState(card);
    var action = resolveAction(card, descriptor);
    var article = createElement('article', 'phab-tournaments__entry phab-tournaments__entry--card');
    var top = createElement('div', 'phab-tournaments__card-top');
    var head = createElement('div', 'phab-tournaments__card-head');
    var summary = createElement('div', 'phab-tournaments__card-summary');
    var footer = createElement('div', 'phab-tournaments__card-footer');
    var meta = createElement('div', 'phab-tournaments__subline');

    head.appendChild(createTournamentChips(card, descriptor));
    head.appendChild(createElement('div', 'phab-tournaments__time-value', formatTime(card.startsAt)));
    head.appendChild(createElement('div', 'phab-tournaments__duration', formatDurationLabel(card)));
    head.appendChild(createElement('h3', 'phab-tournaments__card-title', resolveTitle(card)));

    meta.appendChild(document.createTextNode(resolveLocationLabel(card)));
    meta.appendChild(document.createTextNode(' • ' + formatTimeRange(card)));
    head.appendChild(meta);

    top.appendChild(head);
    top.appendChild(createCalendar(card));

    summary.appendChild(createHostBlock(card));
    article.appendChild(top);
    article.appendChild(summary);
    article.appendChild(createStatsBlock(card, descriptor));

    footer.appendChild(createActionControl(card, action, state, mount));
    if (Number(card.waitlistCount) > 0 && descriptor.key !== 'waitlist') {
      footer.appendChild(createMetricPill('Лист ожидания: ' + String(card.waitlistCount)));
    }
    article.appendChild(footer);

    return article;
  }

  function createDayButton(group, state, mount) {
    var button = createElement('button', 'phab-tournaments__day', null);
    var isActive = group.key === state.selectedDayKey;

    button.type = 'button';
    button.className += isActive ? ' is-active' : '';
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    appendChildren(button, [
      createElement('span', 'phab-tournaments__day-weekday', group.weekday),
      createElement('span', 'phab-tournaments__day-date', group.dayNumber),
      createElement('span', 'phab-tournaments__day-month', group.month)
    ]);

    button.addEventListener('click', function () {
      state.selectedDayKey = group.key;
      renderTournaments(mount, state.payload, state);
    });

    return button;
  }

  function createDayNavigationButton(label, delta, disabled, state, mount, dayGroups) {
    var button = createElement('button', 'phab-tournaments__day-nav', label);
    button.type = 'button';
    button.disabled = disabled;
    button.addEventListener('click', function () {
      var currentIndex = dayGroups.findIndex(function (group) {
        return group.key === state.selectedDayKey;
      });
      var nextIndex = Math.max(0, Math.min(dayGroups.length - 1, currentIndex + delta));
      if (dayGroups[nextIndex]) {
        state.selectedDayKey = dayGroups[nextIndex].key;
        renderTournaments(mount, state.payload, state);
      }
    });
    return button;
  }

  function createToolbar(mount, state, response, dayGroups) {
    var toolbar = createElement('div', 'phab-tournaments__toolbar');
    var row = createElement('div', 'phab-tournaments__toolbar-row');
    var daysPanel = createElement('div', 'phab-tournaments__days-panel');
    var rail = createElement('div', 'phab-tournaments__day-rail');
    var toolbarSide = createElement('div', 'phab-tournaments__toolbar-side');
    var summary = createElement('div', 'phab-tournaments__summary');
    var view = createElement('div', 'phab-tournaments__view');
    var scheduleButton = createElement('button', 'phab-tournaments__view-button', 'Список');
    var cardsButton = createElement('button', 'phab-tournaments__view-button', 'Карточки');
    var currentIndex = dayGroups.findIndex(function (group) {
      return group.key === state.selectedDayKey;
    });

    if (currentIndex < 0) {
      currentIndex = 0;
    }

    dayGroups.forEach(function (group) {
      rail.appendChild(createDayButton(group, state, mount));
    });

    daysPanel.appendChild(
      createDayNavigationButton('‹', -1, currentIndex <= 0, state, mount, dayGroups)
    );
    daysPanel.appendChild(rail);
    daysPanel.appendChild(
      createDayNavigationButton(
        '›',
        1,
        dayGroups.length === 0 || currentIndex >= dayGroups.length - 1,
        state,
        mount,
        dayGroups
      )
    );

    summary.appendChild(createInfoPill(String(dayGroups.length) + ' дней'));
    summary.appendChild(createInfoPill(String(state.items.length) + ' турниров'));
    summary.appendChild(createInfoPill(formatGeneratedAt(response.generatedAt)));
    if (state.config.stationIds.length > 0) {
      summary.appendChild(
        createInfoPill('Станции: ' + state.config.stationIds.join(', '))
      );
    }

    scheduleButton.type = 'button';
    cardsButton.type = 'button';
    scheduleButton.className += state.viewMode === 'schedule' ? ' is-active' : '';
    cardsButton.className += state.viewMode === 'cards' ? ' is-active' : '';
    scheduleButton.setAttribute('aria-pressed', state.viewMode === 'schedule' ? 'true' : 'false');
    cardsButton.setAttribute('aria-pressed', state.viewMode === 'cards' ? 'true' : 'false');
    scheduleButton.addEventListener('click', function () {
      state.viewMode = 'schedule';
      renderTournaments(mount, state.payload, state);
    });
    cardsButton.addEventListener('click', function () {
      state.viewMode = 'cards';
      renderTournaments(mount, state.payload, state);
    });

    view.appendChild(scheduleButton);
    view.appendChild(cardsButton);
    toolbarSide.appendChild(summary);
    toolbarSide.appendChild(view);
    row.appendChild(daysPanel);
    row.appendChild(toolbarSide);
    toolbar.appendChild(row);

    return toolbar;
  }

  function createHeader(state) {
    var hasTitle = Boolean(String(state.config.title || '').trim());
    var hasSubtitle = Boolean(String(state.config.subtitle || '').trim());
    if (!hasTitle && !hasSubtitle) {
      return null;
    }

    var hero = createElement('div', 'phab-tournaments__hero');
    var copy = createElement('div', 'phab-tournaments__hero-copy');
    var meta = createElement('div', 'phab-tournaments__hero-meta');

    copy.appendChild(createElement('p', 'phab-tournaments__eyebrow', 'Tournament Showcase'));
    if (hasTitle) {
      copy.appendChild(createElement('h2', 'phab-tournaments__title', state.config.title));
    }
    if (hasSubtitle) {
      copy.appendChild(createElement('p', 'phab-tournaments__subtitle', state.config.subtitle));
    }

    meta.appendChild(createInfoPill(state.crossOriginApi ? 'Внешняя витрина' : 'Запись внутри виджета'));
    if (state.config.includePast) {
      meta.appendChild(createInfoPill('С прошедшими турнирами'));
    }

    hero.appendChild(copy);
    hero.appendChild(meta);
    return hero;
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
        createElement('h3', 'phab-tournaments__dialog-title', resolveTitle(tournament))
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
      createElement('h3', 'phab-tournaments__dialog-title', resolveTitle(flowTournament))
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
        'Если уровень не совпадает с условиями турнира или свободных мест уже нет, система предложит лист ожидания.'
      )
    );

    backdrop.appendChild(dialog);
    return backdrop;
  }

  function renderTournaments(mount, payload, state) {
    var response = normalizeObject(payload);
    var items = sortItems(
      normalizeArray(response.items).map(function (entry) {
        return normalizeObject(entry);
      })
    );
    var dayGroups = buildDayGroups(items);
    var selectedGroup;
    var root = createElement(
      'section',
      'phab-tournaments phab-tournaments--' + (state.config.variant || 'embed')
    );
    var shell = createElement('div', 'phab-tournaments__shell');
    var header = createHeader(state);
    var board = createElement('div', 'phab-tournaments__board');
    var collection;

    state.payload = response;
    state.items = items;
    state.dayGroups = dayGroups;
    ensureSelectedDay(state, dayGroups);
    selectedGroup = getSelectedGroup(state, dayGroups);

    if (header) {
      shell.appendChild(header);
    }

    if (dayGroups.length > 0) {
      shell.appendChild(createToolbar(mount, state, response, dayGroups));
    }

    if (!selectedGroup || selectedGroup.items.length === 0) {
      board.appendChild(
        createStatusCard(
          'Пока нет доступных турниров',
          'Проверьте фильтры stationId/includePast или убедитесь, что у турниров есть public URL.'
        )
      );
    } else {
      var heading = createElement('div', 'phab-tournaments__day-heading');
      heading.appendChild(
        createElement('h3', 'phab-tournaments__day-title', selectedGroup.headline)
      );
      heading.appendChild(
        createElement(
          'p',
          'phab-tournaments__day-caption',
          String(selectedGroup.items.length) + ' турниров на выбранную дату'
        )
      );
      board.appendChild(heading);

      collection = createElement(
        'div',
        'phab-tournaments__collection phab-tournaments__collection--' + state.viewMode
      );

      selectedGroup.items.forEach(function (card) {
        collection.appendChild(
          state.viewMode === 'cards'
            ? createCardModeCard(card, state, mount)
            : createScheduleCard(card, state, mount)
        );
      });
      board.appendChild(collection);
    }

    shell.appendChild(board);
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
        'Собираем свежую витрину, карточки и состояния для мобильной и десктопной версии.'
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
    var rawView = String(dataset.view || DEFAULTS.view).trim().toLowerCase();
    var normalizedView =
      rawView === 'cards' || rawView === 'schedule' ? rawView : DEFAULTS.view;

    return {
      apiBaseUrl: normalizeApiBaseUrl(dataset.apiBase || DEFAULTS.apiBaseUrl),
      stationIds: normalizeCsv(dataset.stationIds || ''),
      limit: normalizePositiveInteger(dataset.limit, DEFAULTS.limit),
      includePast: normalizeBoolean(dataset.includePast),
      refreshMs: normalizeRefreshMs(dataset.refreshMs),
      variant: String(dataset.variant || DEFAULTS.variant).trim() || DEFAULTS.variant,
      title: String(dataset.title || DEFAULTS.title).trim(),
      subtitle: String(dataset.subtitle || DEFAULTS.subtitle).trim(),
      view: normalizedView
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
      dayGroups: [],
      selectedDayKey: '',
      viewMode: config.view || getDefaultViewMode(),
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
