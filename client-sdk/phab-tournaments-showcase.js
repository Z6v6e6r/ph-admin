(function () {
  var STYLE_ID = 'phab-tournaments-showcase-style';
  var DEFAULT_API_BASE_URL = inferApiBaseUrl(document.currentScript && document.currentScript.src);
  var LEVEL_BASE_OPTIONS = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];
  var LEVEL_DIVISION_COUNT = 4;
  var LEVEL_BANDS = [
    { base: 'D', min: 1, max: 2 },
    { base: 'D+', min: 2, max: 3 },
    { base: 'C', min: 3, max: 3.5 },
    { base: 'C+', min: 3.5, max: 4 },
    { base: 'B', min: 4, max: 4.7 },
    { base: 'B+', min: 4.7, max: 5.5 },
    { base: 'A', min: 5.5, max: 6.3 }
  ];
  var LEVEL_OPTIONS = buildLevelOptions();
  var LEVEL_SUPERSCRIPTS = {
    1: '¹',
    2: '²',
    3: '³',
    4: '⁴'
  };
  var DEFAULT_FORWARD_DAYS = 30;
  var DEFAULT_INITIAL_FORWARD_DAYS = 1;
  var DIRECTORY_REQUEST_TIMEOUT_MS = 12000;
  var DIRECTORY_REQUEST_RETRY_COUNT = 2;
  var SMS_RESEND_COOLDOWN_MS = 30000;
  var VIVA_API_BASE_URL = 'https://api.vivacrm.ru';
  var DEFAULTS = {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    stationIds: [],
    limit: 48,
    initialForwardDays: DEFAULT_INITIAL_FORWARD_DAYS,
    forwardDays: DEFAULT_FORWARD_DAYS,
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
    style.textContent = `
      :root {
        --ph-tournament-bg: #f5f5f7;
        --ph-tournament-white: #ffffff;
        --ph-tournament-ink: #1a1a1a;
        --ph-tournament-ink-soft: #6b7280;
        --ph-tournament-line: #e5e7eb;
        --ph-tournament-purple: #7353d9;
        --ph-tournament-purple-dark: #5b3fb5;
        --ph-tournament-purple-soft: #f4f0ff;
        --ph-tournament-green: #eef8f1;
        --ph-tournament-green-ink: #2f8654;
        --ph-tournament-orange: #fef7ef;
        --ph-tournament-orange-ink: #b3641e;
        --ph-tournament-red: #ffe8e8;
        --ph-tournament-red-ink: #c62828;
        --ph-tournament-gray-soft: #f3f4f6;
        --ph-tournament-gray-ink: #4b5563;
        --ph-tournament-shadow: 0 4px 30px rgba(0, 0, 0, 0.07);
        --ph-tournament-card-bg: #fafafa;
        --ph-tournament-card-line: #e8e8e9;
        --ph-tournament-card-line-soft: #e8e8e9;
        --ph-tournament-card-border: #ededed;
        --ph-tournament-card-ink: #1f1e20;
        --ph-tournament-card-ink-soft: #b4b4b4;
        --ph-tournament-card-meta: #353436;
        --ph-tournament-card-icon: #888889;
        --ph-tournament-card-accent: #8766eb;
        --ph-tournament-card-accent-soft: rgba(47, 157, 212, 0.08);
        --ph-tournament-card-accent-ink: #2f9dd4;
        --ph-tournament-card-map: #8766eb;
        --ph-tournament-display-font: "Source Code Pro", "Roboto Mono", "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --ph-tournament-button-font: "Source Code Pro", "Roboto Mono", "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --ph-tournament-time-font: "Source Code Pro", "Roboto Mono", "Roboto", "Roboto Flex", "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --ph-tournament-ui-font: "Inter Display", "Inter", "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --ph-tournament-card-title-font: "Source Code Pro", "Inter Display", "Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .phab-tournaments {
        position: relative;
        background: #ffffff;
        color-scheme: light;
        color: var(--ph-tournament-ink);
        font-family: var(--ph-tournament-time-font);
      }

      .phab-tournaments,
      .phab-tournaments * {
        box-sizing: border-box;
      }

      .phab-tournaments__shell {
        position: relative;
        display: grid;
        gap: 16px;
      }

      .phab-tournaments__hero,
      .phab-tournaments__toolbar,
      .phab-tournaments__entry,
      .phab-tournaments__notice,
      .phab-tournaments__dialog {
        border: 1px solid var(--ph-tournament-line);
        background: var(--ph-tournament-white);
        box-shadow: var(--ph-tournament-shadow);
      }

      .phab-tournaments__hero {
        display: flex;
        gap: 16px;
        align-items: flex-end;
        justify-content: space-between;
        flex-wrap: wrap;
        padding: 20px;
        border-radius: 20px;
      }

      .phab-tournaments__hero-copy {
        display: grid;
        gap: 10px;
      }

      .phab-tournaments__eyebrow {
        margin: 0;
        font-size: 11px;
        font-weight: 500;
        line-height: 1.2;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ph-tournament-ink-soft);
        font-family: var(--ph-tournament-time-font);
      }

      .phab-tournaments__title {
        margin: 0;
        font-size: clamp(28px, 4vw, 52px);
        line-height: 0.96;
        letter-spacing: -0.05em;
        font-family: var(--ph-tournament-display-font);
        font-weight: 800;
      }

      .phab-tournaments__subtitle {
        margin: 0;
        max-width: 760px;
        color: var(--ph-tournament-ink-soft);
        font-size: 14px;
        line-height: 1.55;
        font-family: var(--ph-tournament-time-font);
      }

      .phab-tournaments__hero-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }

      .phab-tournaments__pill {
        display: inline-flex;
        align-items: center;
        min-height: 32px;
        padding: 0 12px;
        border-radius: 999px;
        border: 1px solid var(--ph-tournament-line);
        background: var(--ph-tournament-purple-soft);
        color: var(--ph-tournament-ink-soft);
        font-size: 11px;
        line-height: 1;
        font-weight: 500;
        letter-spacing: -0.04em;
        white-space: nowrap;
        font-family: var(--ph-tournament-time-font);
      }

      .phab-tournaments__toolbar {
        display: grid;
        gap: 0;
        padding: 0;
        border: none;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
      }

      .phab-tournaments__toolbar-row {
        display: grid;
        gap: 14px;
      }

      .phab-tournaments__days-panel {
        display: flex;
        gap: 0;
        align-items: center;
        min-width: 0;
        width: 100%;
      }

      .phab-tournaments__day-nav {
        display: none;
      }

      .phab-tournaments__day-nav:disabled {
        opacity: 0.42;
        cursor: default;
        box-shadow: none;
      }

      .phab-tournaments__day-rail {
        display: flex;
        gap: 6px;
        min-width: 0;
        overflow-x: auto;
        padding: 0 6px 10px;
        scrollbar-width: none;
        scroll-behavior: smooth;
        flex: 1 1 auto;
      }

      .phab-tournaments__day-rail::-webkit-scrollbar {
        display: none;
      }

      .phab-tournaments__day {
        appearance: none;
        border: none;
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: 7px;
        min-width: 48px;
        padding: 0;
        background: transparent;
        color: var(--ph-tournament-ink);
        cursor: pointer;
      }

      .phab-tournaments__day-weekday {
        margin: 0;
        font-size: 12px;
        line-height: 1;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: #bdbdbd;
        font-family: var(--ph-tournament-time-font);
      }

      .phab-tournaments__day-month,
      .phab-tournaments__day-date {
        display: flex;
        width: 48px;
        align-items: center;
        justify-content: center;
      }

      .phab-tournaments__day-month {
        min-height: 21px;
        padding: 3px 8px;
        border-radius: 8px 8px 0 0;
        background: #1a1a1a;
        color: #ffffff;
        font-size: 10px;
        line-height: 1;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        font-family: var(--ph-tournament-button-font);
        font-style: italic;
        font-weight: 800;
      }

      .phab-tournaments__day-date {
        min-height: 31px;
        padding: 6px 12px;
        border: 1px solid var(--ph-tournament-line);
        border-top: none;
        border-radius: 0 0 8px 8px;
        background: var(--ph-tournament-white);
        color: var(--ph-tournament-ink);
        box-shadow: none;
        font-size: 18px;
        line-height: 1;
        letter-spacing: -0.02em;
        font-family: var(--ph-tournament-button-font);
        font-style: italic;
        font-weight: 800;
      }

      .phab-tournaments__day.is-active .phab-tournaments__day-weekday {
        color: #bdbdbd;
      }

      .phab-tournaments__day.is-active .phab-tournaments__day-date {
        border-color: var(--ph-tournament-purple);
        background: var(--ph-tournament-purple);
        color: #ffffff;
      }

      .phab-tournaments__toolbar-meta {
        display: grid;
        gap: 12px;
      }

      .phab-tournaments__view {
        display: inline-flex;
        padding: 4px;
        border-radius: 999px;
        background: var(--ph-tournament-bg);
        border: 1px solid var(--ph-tournament-line);
        width: 100%;
      }

      .phab-tournaments__view-button {
        appearance: none;
        border: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        min-height: 56px;
        padding: 0 16px;
        border-radius: 999px;
        background: transparent;
        color: var(--ph-tournament-ink-soft);
        font-size: 16px;
        line-height: 1;
        cursor: pointer;
        transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease;
        font-family: var(--ph-tournament-button-font);
        font-style: italic;
        font-weight: 800;
        flex: 1 1 0;
      }

      .phab-tournaments__view-button.is-active {
        background: #1a1a1a;
        color: #ffffff;
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.12);
      }

      .phab-tournaments__board {
        display: grid;
        gap: 14px;
      }

      .phab-tournaments__day-heading {
        display: flex;
        gap: 10px;
        align-items: flex-end;
        justify-content: space-between;
        flex-wrap: wrap;
        padding: 2px 4px 0;
      }

      .phab-tournaments__day-title {
        margin: 0;
        font-size: clamp(22px, 2.8vw, 34px);
        line-height: 1;
        letter-spacing: -0.04em;
        color: var(--ph-tournament-ink);
        font-family: var(--ph-tournament-display-font);
        font-weight: 800;
      }

      .phab-tournaments__day-caption {
        margin: 0;
        color: var(--ph-tournament-ink-soft);
        font-size: 12px;
        line-height: 1.45;
        font-family: var(--ph-tournament-time-font);
      }

      .phab-tournaments__collection {
        display: grid;
        gap: 12px;
      }

      .phab-tournaments__collection--cards {
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        align-items: start;
        justify-items: center;
      }

      .phab-tournaments__collection--schedule {
        grid-template-columns: minmax(0, 1fr);
        gap: 8px;
      }

      .phab-tournaments__entry {
        position: relative;
        overflow: hidden;
        border-radius: 20px;
      }

      .phab-tournaments__entry--interactive {
        cursor: pointer;
      }

      .phab-tournaments__entry--interactive:focus-visible {
        outline: 2px solid rgba(111, 71, 255, 0.7);
        outline-offset: 2px;
      }

      .phab-tournaments__entry::before {
        content: none;
      }

      .phab-tournaments__entry--schedule,
      .phab-tournaments__entry--card {
        display: grid;
        gap: 16px;
        padding: 18px;
      }

      .phab-tournaments__time-col {
        display: grid;
        align-content: start;
        gap: 4px;
      }

      .phab-tournaments__schedule-header,
      .phab-tournaments__entry--schedule {
        display: grid;
        grid-template-columns:
          minmax(72px, 94px) minmax(44px, 54px) minmax(160px, 1.05fr)
          minmax(210px, 1.12fr) minmax(128px, 0.74fr) minmax(128px, 0.74fr)
          minmax(64px, 76px) minmax(128px, 148px);
        align-items: center;
        column-gap: 8px;
      }

      .phab-tournaments__schedule-header {
        min-height: 38px;
        padding: 8px 14px;
        border-radius: 10px;
        background: #f0f0f2;
        color: #686871;
        font-family: var(--ph-tournament-time-font);
        font-size: 11px;
        line-height: 1.2;
        font-weight: 700;
        text-align: center;
      }

      .phab-tournaments__entry--schedule {
        min-height: 78px;
        padding: 12px 14px;
        gap: 0 8px;
        border: none;
        border-radius: 10px;
        background: #fafafa;
        box-shadow: none;
      }

      .phab-tournaments__collection--schedule .phab-tournaments__entry--schedule:nth-child(odd) {
        background: #f2f2f4;
      }

      .phab-tournaments__collection--schedule .phab-tournaments__entry--schedule:nth-child(even) {
        background: #ffffff;
      }

      .phab-tournaments__schedule-cell,
      .phab-tournaments__schedule-header-cell {
        min-width: 0;
        padding: 0 4px;
        text-align: center;
        overflow-wrap: anywhere;
      }

      .phab-tournaments__schedule-time {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        color: #18181a;
        font-family: var(--ph-tournament-time-font);
        font-size: 15px;
        line-height: 1.15;
        font-weight: 700;
      }

      .phab-tournaments__schedule-title {
        margin: 0;
        color: #18181a;
        font-family: var(--ph-tournament-ui-font);
        font-size: 15px;
        line-height: 1.25;
        font-weight: 700;
        text-align: left;
      }

      .phab-tournaments__schedule-meta-bundle {
        display: grid;
        grid-template-columns: minmax(68px, 96px) minmax(72px, 1fr) minmax(44px, 58px);
        align-items: center;
        gap: 6px;
      }

      .phab-tournaments__schedule-type,
      .phab-tournaments__schedule-gender,
      .phab-tournaments__schedule-level,
      .phab-tournaments__schedule-trainer,
      .phab-tournaments__schedule-location,
      .phab-tournaments__schedule-spots {
        color: #242428;
        font-family: var(--ph-tournament-ui-font);
        font-size: 13px;
        line-height: 1.2;
        font-weight: 700;
      }

      .phab-tournaments__schedule-level {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 3px;
        min-height: 28px;
        padding: 6px 10px;
        border-radius: 999px;
        background: #f1edff;
        color: #6d4ee6;
      }

      .phab-tournaments__level-mark {
        display: inline-flex;
        align-items: flex-start;
        line-height: 1;
      }

      .phab-tournaments__level-mark sup {
        margin-left: 1px;
        font-size: 0.72em;
        line-height: 1;
        transform: translateY(-0.22em);
      }

      .phab-tournaments__schedule-cta {
        min-height: 38px;
        padding: 10px 14px;
        border-radius: 10px;
        font-size: 12px;
        letter-spacing: 0;
      }

      .phab-tournaments__time-value {
        color: var(--ph-tournament-ink);
        font-size: clamp(24px, 3.2vw, 34px);
        line-height: 0.94;
        letter-spacing: -0.05em;
        font-family: var(--ph-tournament-display-font);
        font-weight: 800;
      }

      .phab-tournaments__duration {
        color: var(--ph-tournament-ink-soft);
        font-size: 11px;
        line-height: 1.35;
        font-family: var(--ph-tournament-time-font);
      }

      .phab-tournaments__chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .phab-tournaments__chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 24px;
        padding: 4px 8px;
        border-radius: 24px;
        font-size: 11px;
        line-height: 1.2;
        white-space: nowrap;
        font-family: var(--ph-tournament-time-font);
        font-weight: 500;
        letter-spacing: -0.05em;
      }

      .phab-tournaments__chip--badge,
      .phab-tournaments__chip--type {
        background: #000000;
        color: #ffffff;
      }

      .phab-tournaments__chip--status-upcoming,
      .phab-tournaments__chip--status-live,
      .phab-tournaments__chip--status-waitlist {
        background: var(--ph-tournament-purple-soft);
        color: var(--ph-tournament-purple);
      }

      .phab-tournaments__chip--status-live {
        background: linear-gradient(135deg, #7b57f6 0%, #6847e8 100%);
        color: #ffffff;
      }

      .phab-tournaments__chip--status-hot {
        background: var(--ph-tournament-orange);
        color: var(--ph-tournament-orange-ink);
      }

      .phab-tournaments__chip--status-full,
      .phab-tournaments__chip--status-closed {
        background: var(--ph-tournament-gray-soft);
        color: var(--ph-tournament-gray-ink);
      }

      .phab-tournaments__chip--status-completed {
        background: var(--ph-tournament-green);
        color: var(--ph-tournament-green-ink);
      }

      .phab-tournaments__chip--status-cancelled {
        background: var(--ph-tournament-red);
        color: var(--ph-tournament-red-ink);
      }

      .phab-tournaments__chip--level {
        background: linear-gradient(90deg, #e56b00 0%, #dd4d20 100%);
        color: #ffffff;
      }

      .phab-tournaments__chip--gender {
        background: var(--ph-tournament-purple-soft);
        color: var(--ph-tournament-purple);
      }

      .phab-tournaments__entry-title {
        margin: 0;
        color: #000000;
        font-size: clamp(26px, 3.1vw, 44px);
        line-height: 0.98;
        letter-spacing: -0.04em;
        font-family: var(--ph-tournament-display-font);
        font-weight: 800;
      }

      .phab-tournaments__subline {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 12px;
        color: #000000;
        font-size: 12px;
        line-height: 1.35;
        letter-spacing: -0.05em;
        font-family: var(--ph-tournament-time-font);
      }

      .phab-tournaments__avatar {
        width: 54px;
        height: 54px;
        flex: 0 0 54px;
        border-radius: 999px;
        overflow: hidden;
        display: grid;
        place-items: center;
        background: linear-gradient(135deg, #6f4df6 0%, #8e6bff 100%);
        color: #ffffff;
        font-size: 18px;
        line-height: 1;
        letter-spacing: -0.04em;
        font-family: var(--ph-tournament-display-font);
        font-weight: 800;
      }

      .phab-tournaments__avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .phab-tournaments__stats {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }

      .phab-tournaments__players {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: #000000;
        font-size: 18px;
        line-height: 1;
        font-family: var(--ph-tournament-display-font);
        font-weight: 800;
      }

      .phab-tournaments__players-note {
        color: var(--ph-tournament-ink-soft);
        font-size: 11px;
        line-height: 1;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        font-family: var(--ph-tournament-time-font);
        font-weight: 500;
      }

      .phab-tournaments__metric-pill {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        padding: 4px 8px;
        border-radius: 24px;
        background: var(--ph-tournament-purple-soft);
        color: var(--ph-tournament-purple);
        font-size: 11px;
        line-height: 1.2;
        letter-spacing: -0.05em;
        font-family: var(--ph-tournament-time-font);
        font-weight: 500;
      }

      .phab-tournaments__metric-pill--success {
        background: var(--ph-tournament-green);
        color: var(--ph-tournament-green-ink);
      }

      .phab-tournaments__metric-pill--hot {
        background: var(--ph-tournament-orange);
        color: var(--ph-tournament-orange-ink);
      }

      .phab-tournaments__metric-pill--danger {
        background: var(--ph-tournament-gray-soft);
        color: var(--ph-tournament-gray-ink);
      }

      .phab-tournaments__aside-bottom {
        display: grid;
        gap: 8px;
        justify-items: stretch;
      }

      .phab-tournaments__button,
      .phab-tournaments__button-secondary {
        appearance: none;
        border: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        min-height: 44px;
        padding: 14px 20px;
        border-radius: 12px;
        text-decoration: none;
        cursor: pointer;
        transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
        font-size: 14px;
        line-height: 1;
        letter-spacing: 0.02em;
        font-family: var(--ph-tournament-display-font);
        font-weight: 800;
      }

      .phab-tournaments__button:hover,
      .phab-tournaments__button-secondary:hover {
        transform: translateY(-1px);
      }

      .phab-tournaments__button {
        background: linear-gradient(135deg, #7b57f6 0%, #6847e8 100%);
        color: #ffffff;
        box-shadow: 0 10px 20px rgba(104, 71, 232, 0.2);
      }

      .phab-tournaments__button:disabled {
        opacity: 0.54;
        cursor: default;
        box-shadow: none;
      }

      .phab-tournaments__button-secondary {
        background: #f1edff;
        color: #6d4ee6;
      }

      .phab-tournaments__hint {
        margin: 0;
        color: var(--ph-tournament-ink-soft);
        font-size: 11px;
        line-height: 1.45;
        font-family: var(--ph-tournament-time-font);
      }

      .phab-tournaments__card-head {
        display: grid;
        gap: 12px;
      }

      .phab-tournaments__card-row {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        justify-content: space-between;
      }

      .phab-tournaments__card-title-wrap {
        display: flex;
        align-items: baseline;
        gap: 14px;
        min-width: 0;
        flex: 1 1 auto;
      }

      .phab-tournaments__card-time {
        color: var(--ph-tournament-ink);
        font-size: clamp(24px, 3.2vw, 34px);
        line-height: 0.94;
        letter-spacing: -0.05em;
        font-family: var(--ph-tournament-display-font);
        font-weight: 800;
        white-space: nowrap;
      }

      .phab-tournaments__card-meta {
        display: flex;
        align-items: center;
        gap: 14px;
        flex-wrap: wrap;
      }

      .phab-tournaments__card-location {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: #63657a;
        font-size: 12px;
        line-height: 1.35;
        letter-spacing: -0.04em;
        font-family: var(--ph-tournament-time-font);
      }

      .phab-tournaments__card-location::before {
        content: "•";
        color: #7a6adf;
        font-size: 16px;
        line-height: 1;
      }

      .phab-tournaments__card-body {
        display: grid;
        grid-template-columns: 54px minmax(0, 1fr) auto;
        gap: 12px;
        align-items: center;
      }

      .phab-tournaments__card-body-main {
        display: grid;
        gap: 8px;
        min-width: 0;
      }

      .phab-tournaments__card-support {
        margin: 0;
        color: #232323;
        font-size: 14px;
        line-height: 1.2;
        font-family: var(--ph-tournament-time-font);
        font-weight: 500;
      }

      .phab-tournaments__card-status {
        justify-self: end;
      }

      .phab-tournaments__card-title {
        margin: 0;
        color: #000000;
        font-size: clamp(18px, 3.1vw, 24px);
        line-height: 1.02;
        letter-spacing: -0.04em;
        font-family: var(--ph-tournament-display-font);
        font-weight: 800;
        min-width: 0;
      }

      .phab-tournaments__card-footer {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }

      .phab-tournaments__entry--card {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        max-width: 359px;
        min-height: 363px;
        padding: 0 20px 16px;
        gap: 12px;
        border: none;
        border-radius: 0;
        border-bottom: 0.5px solid var(--ph-tournament-card-border);
        background: transparent;
        box-shadow: none;
        color: var(--ph-tournament-card-ink);
        justify-self: center;
        overflow: visible;
      }

      .phab-tournaments__card-compact-profile {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        width: 100%;
      }

      .phab-tournaments__card-compact-profile-main {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        flex: 1 1 auto;
      }

      .phab-tournaments__card-compact-organizer-avatar {
        width: 36px;
        height: 36px;
        flex: 0 0 36px;
        border-radius: 8px;
        overflow: hidden;
        display: grid;
        place-items: center;
        background: #d9d9d9;
        color: var(--ph-tournament-card-ink);
        font-family: var(--ph-tournament-card-title-font);
        font-size: 12px;
        line-height: 1;
        font-weight: 800;
      }

      .phab-tournaments__card-compact-organizer-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .phab-tournaments__card-compact-organizer-copy {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: flex-start;
        gap: 5px;
        min-width: 0;
      }

      .phab-tournaments__card-compact-organizer-name,
      .phab-tournaments__card-compact-organizer-handle {
        margin: 0;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .phab-tournaments__card-compact-organizer-name {
        color: var(--ph-tournament-card-ink);
        font-family: var(--ph-tournament-card-title-font);
        font-size: 14px;
        line-height: 1;
        font-weight: 700;
        letter-spacing: 0.01em;
      }

      .phab-tournaments__card-compact-organizer-handle {
        color: var(--ph-tournament-card-ink-soft);
        font-family: var(--ph-tournament-ui-font);
        font-size: 11px;
        line-height: 1;
        font-weight: 500;
        letter-spacing: 0.02em;
      }

      .phab-tournaments__card-compact-more {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: 40px;
        color: var(--ph-tournament-card-ink-soft);
        flex: 0 0 16px;
      }

      .phab-tournaments__card-compact-more svg {
        width: 100%;
        height: 100%;
        display: block;
      }

      .phab-tournaments__card-compact-surface {
        box-sizing: border-box;
        position: relative;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: flex-start;
        width: 100%;
        min-height: 263px;
        padding: 14px 12px;
        gap: 20px;
        background: var(--ph-tournament-card-bg);
        border-radius: 12px;
      }

      .phab-tournaments__card-compact-head {
        position: relative;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
        width: 100%;
        isolation: isolate;
      }

      .phab-tournaments__card-compact-heading {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        min-width: 0;
        flex: 1 1 auto;
        padding-right: 58px;
      }

      .phab-tournaments__card-compact-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 3px;
        min-height: 18px;
        max-width: 100%;
        padding: 5px 6px;
        border-radius: 24px;
        background: var(--ph-tournament-card-accent-soft);
        color: var(--ph-tournament-card-accent-ink);
        font-family: var(--ph-tournament-ui-font);
        font-size: 10px;
        line-height: 1;
        font-weight: 500;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }

      .phab-tournaments__card-compact-badge-text {
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .phab-tournaments__card-compact-badge-icon {
        width: 8px;
        height: 8px;
        flex: 0 0 8px;
        display: inline-flex;
      }

      .phab-tournaments__card-compact-badge-icon svg {
        width: 100%;
        height: 100%;
        display: block;
      }

      .phab-tournaments__card-compact-title {
        width: 100%;
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--ph-tournament-card-ink);
        font-family: var(--ph-tournament-card-title-font);
        font-size: 18px;
        line-height: 1;
        font-weight: 800;
        letter-spacing: 0.01em;
      }

      .phab-tournaments__card-compact-price {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
        align-self: flex-start;
        min-width: 0;
        min-height: 22px;
        padding: 5px 8px;
        border-radius: 24px;
        background: #f1edff;
      }

      .phab-tournaments__card-compact-price-value {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--ph-tournament-card-accent);
        font-family: var(--ph-tournament-ui-font);
        font-size: 11px;
        line-height: 1;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-align: center;
      }

      .phab-tournaments__card-compact-date-badge {
        position: absolute;
        top: 0;
        right: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 51px;
        padding: 8px;
        gap: 4px;
        border-radius: 8px;
        background: #ffffff;
        z-index: 2;
      }

      .phab-tournaments__card-compact-date-day,
      .phab-tournaments__card-compact-date-weekday {
        width: 100%;
        margin: 0;
        text-align: center;
      }

      .phab-tournaments__card-compact-date-day {
        color: var(--ph-tournament-card-ink);
        font-family: var(--ph-tournament-card-title-font);
        font-size: 18px;
        line-height: 1.24;
        font-weight: 800;
      }

      .phab-tournaments__card-compact-date-weekday {
        color: var(--ph-tournament-card-accent);
        font-family: var(--ph-tournament-ui-font);
        font-size: 9px;
        line-height: 1;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }

      .phab-tournaments__card-compact-info {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        width: 100%;
      }

      .phab-tournaments__card-compact-meta {
        display: flex;
        align-items: flex-start;
        gap: 4px;
        width: 100%;
        min-width: 0;
      }

      .phab-tournaments__card-compact-meta-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--ph-tournament-card-meta);
        font-family: var(--ph-tournament-ui-font);
        font-size: 12px;
        line-height: 1;
        font-weight: 500;
        letter-spacing: 0.02em;
      }

      .phab-tournaments__card-compact-meta--location .phab-tournaments__card-compact-meta-text {
        flex: 0 1 auto;
      }

      .phab-tournaments__card-compact-meta--gender .phab-tournaments__card-compact-price {
        align-self: flex-end;
        margin-left: auto;
      }

      .phab-tournaments__card-compact-meta-icon {
        width: 12px;
        height: 12px;
        flex: 0 0 12px;
        display: inline-flex;
        color: var(--ph-tournament-card-icon);
      }

      .phab-tournaments__card-compact-meta-icon svg {
        width: 100%;
        height: 100%;
        display: block;
      }

      .phab-tournaments__card-compact-map {
        display: inline-flex;
        align-items: center;
        min-height: 13px;
        padding: 0 0 1px;
        border-bottom: 1px dashed var(--ph-tournament-card-map);
        color: var(--ph-tournament-card-map);
        text-decoration: none;
        font-family: var(--ph-tournament-ui-font);
        font-size: 12px;
        line-height: 1;
        font-weight: 400;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }

      .phab-tournaments__card-compact-court {
        flex: 0 0 auto;
        color: var(--ph-tournament-card-meta);
        font-family: var(--ph-tournament-ui-font);
        font-size: 12px;
        line-height: 1;
        font-weight: 500;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }

      .phab-tournaments__card-compact-court::before {
        content: "•";
        margin: 0 4px 0 2px;
        color: var(--ph-tournament-card-icon);
      }

      .phab-tournaments__card-compact-map:hover {
        color: var(--ph-tournament-card-map);
        border-bottom-color: var(--ph-tournament-card-map);
        opacity: 0.82;
      }

      .phab-tournaments__card-compact-capacity {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        width: 100%;
      }

      .phab-tournaments__card-compact-progress {
        display: flex;
        gap: 2px;
        width: 100%;
      }

      .phab-tournaments__card-compact-progress-segment {
        height: 3px;
        flex: 1 1 0;
        background: var(--ph-tournament-card-line-soft);
      }

      .phab-tournaments__card-compact-progress-segment:first-child {
        border-radius: 24px 0 0 24px;
      }

      .phab-tournaments__card-compact-progress-segment:last-child {
        border-radius: 0 24px 24px 0;
      }

      .phab-tournaments__card-compact-progress-segment.is-filled {
        background: var(--ph-tournament-card-accent);
      }

      .phab-tournaments__card-compact-capacity-texts {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
      }

      .phab-tournaments__card-compact-capacity-value,
      .phab-tournaments__card-compact-capacity-note {
        min-width: 0;
        color: var(--ph-tournament-card-ink);
        font-family: var(--ph-tournament-ui-font);
        line-height: 1;
        font-weight: 500;
        white-space: nowrap;
      }

      .phab-tournaments__card-compact-capacity-value {
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .phab-tournaments__card-compact-capacity-note {
        font-size: 10px;
        letter-spacing: 0.02em;
        text-align: right;
      }

      .phab-tournaments__card-compact-cta {
        appearance: none;
        border: none;
        display: flex;
        flex-direction: row;
        justify-content: center;
        align-items: center;
        gap: 4px;
        flex: none;
        order: 3;
        align-self: stretch;
        flex-grow: 0;
        width: 100%;
        height: 32px;
        min-height: 32px;
        padding: 10px 24px 10px 20px;
        border-radius: 24px;
        background: var(--ph-tournament-card-accent);
        color: #fafafa;
        text-decoration: none;
        cursor: pointer;
        transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
        font-family: var(--ph-tournament-ui-font);
        font-size: 12px;
        line-height: 1;
        font-weight: 500;
        letter-spacing: 0.02em;
      }

      .phab-tournaments__card-compact-cta:visited {
        color: #fafafa;
      }

      .phab-tournaments__card-compact-cta,
      .phab-tournaments__card-compact-cta:link,
      .phab-tournaments__card-compact-cta:visited,
      .phab-tournaments__card-compact-cta:hover,
      .phab-tournaments__card-compact-cta:active {
        color: #fafafa !important;
      }

      .phab-tournaments__card-compact-cta:hover {
        transform: none;
        opacity: 0.94;
        background: #7655e2;
      }

      .phab-tournaments__card-compact-cta--secondary {
        background: transparent;
        color: var(--ph-tournament-card-ink);
        box-shadow: inset 0 0 0 1px var(--ph-tournament-card-line-soft);
      }

      .phab-tournaments__card-compact-cta:disabled,
      .phab-tournaments__card-compact-cta--disabled {
        background: transparent;
        color: var(--ph-tournament-card-ink-soft);
        box-shadow: inset 0 0 0 1px var(--ph-tournament-card-line);
        cursor: default;
        opacity: 1;
      }

      .phab-tournaments__card-compact-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        width: 100%;
      }

      .phab-tournaments__card-compact-footer-metrics {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        min-width: 0;
      }

      .phab-tournaments__card-compact-footer-metric {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 24px;
        padding: 4px 0;
        border-radius: 32px;
        color: var(--ph-tournament-card-meta);
        font-family: var(--ph-tournament-ui-font);
        font-size: 12px;
        line-height: 1;
        font-weight: 500;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }

      .phab-tournaments__card-compact-footer-metric.is-accent {
        color: var(--ph-tournament-card-accent);
      }

      .phab-tournaments__card-compact-footer-icon {
        width: 16px;
        height: 16px;
        flex: 0 0 16px;
        display: inline-flex;
      }

      .phab-tournaments__card-compact-footer-icon svg {
        width: 100%;
        height: 100%;
        display: block;
      }

      .phab-tournaments__card-compact-footer-time {
        margin-left: auto;
        color: var(--ph-tournament-card-ink-soft);
        font-family: var(--ph-tournament-ui-font);
        font-size: 11px;
        line-height: 1;
        font-weight: 500;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }

      .phab-tournaments__entry--premium {
        border-radius: 32px;
        background: linear-gradient(180deg, #fcfbff 0%, #faf7fd 100%);
        border: 1px solid rgba(221, 214, 237, 0.9);
        box-shadow:
          0 20px 50px rgba(69, 44, 125, 0.08),
          0 3px 10px rgba(69, 44, 125, 0.05);
        padding: 28px;
        display: grid;
        gap: 0;
      }

      .phab-tournaments__premium-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 18px;
      }

      .phab-tournaments__premium-head-left {
        min-width: 0;
        display: flex;
        align-items: baseline;
        gap: 18px;
        flex-wrap: nowrap;
      }

      .phab-tournaments__premium-time {
        color: #201a37;
        font-size: 58px;
        line-height: 0.95;
        letter-spacing: -0.04em;
        white-space: nowrap;
        font-family: var(--ph-tournament-display-font);
        font-weight: 800;
      }

      .phab-tournaments__premium-title {
        margin: 0;
        min-width: 0;
        padding-top: 6px;
        color: #231d38;
        font-size: 39px;
        line-height: 1.05;
        letter-spacing: -0.035em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: var(--ph-tournament-display-font);
        font-weight: 700;
      }

      .phab-tournaments__premium-badge {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 14px 22px;
        border-radius: 999px;
        background: linear-gradient(135deg, #6a41ff 0%, #8f5dff 100%);
        color: #ffffff;
        box-shadow:
          0 10px 24px rgba(120, 84, 255, 0.18),
          inset 0 1px 0 rgba(255, 255, 255, 0.18);
        font-size: 28px;
        line-height: 1;
        letter-spacing: -0.02em;
        white-space: nowrap;
        font-family: var(--ph-tournament-time-font);
        font-weight: 600;
      }

      .phab-tournaments__premium-badge-ball {
        width: 28px;
        height: 28px;
        flex: 0 0 28px;
        display: block;
      }

      .phab-tournaments__premium-meta {
        margin-top: 22px;
        color: #7b7397;
        font-size: 23px;
        line-height: 1.35;
        letter-spacing: -0.02em;
        font-family: var(--ph-tournament-time-font);
        font-weight: 500;
      }

      .phab-tournaments__premium-divider {
        height: 1px;
        margin: 28px 0;
        background: rgba(120, 108, 157, 0.14);
      }

      .phab-tournaments__premium-organizer {
        display: flex;
        align-items: center;
        gap: 18px;
      }

      .phab-tournaments__premium-avatar {
        width: 104px;
        height: 104px;
        flex: 0 0 104px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at 30% 30%, #ab6eff 0%, #6e43ff 58%, #6b42ff 100%);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.18),
          0 12px 24px rgba(111, 71, 255, 0.18);
        color: #ffffff;
        font-size: 33px;
        line-height: 1;
        letter-spacing: -0.03em;
        font-family: var(--ph-tournament-display-font);
        font-weight: 800;
      }

      .phab-tournaments__premium-organizer-name {
        margin: 0;
        min-width: 0;
        color: #2a2340;
        font-size: 32px;
        line-height: 1.2;
        letter-spacing: -0.03em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: var(--ph-tournament-time-font);
        font-weight: 500;
      }

      .phab-tournaments__premium-tariffs {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 28px;
      }

      .phab-tournaments__premium-tariff {
        min-height: 138px;
        padding: 28px 32px 24px;
        border-radius: 24px;
        border: 1px solid #e7e0f0;
        background: linear-gradient(180deg, #faf8fd 0%, #f6f2fb 100%);
        box-shadow:
          0 12px 24px rgba(84, 58, 144, 0.08),
          0 2px 4px rgba(84, 58, 144, 0.04);
        display: flex;
        flex-direction: column;
        justify-content: center;
      }

      .phab-tournaments__premium-tariff.is-selected {
        border-color: #8f5dff;
        box-shadow:
          0 14px 30px rgba(111, 71, 255, 0.2),
          inset 0 0 0 1px rgba(143, 93, 255, 0.28);
        transform: translateY(-1px);
      }

      .phab-tournaments__premium-tariff-title {
        color: #70688d;
        font-size: 30px;
        line-height: 1.1;
        letter-spacing: -0.03em;
        font-family: var(--ph-tournament-time-font);
        font-weight: 500;
      }

      .phab-tournaments__premium-tariff-price {
        margin-top: 16px;
        color: #231d38;
        font-size: 34px;
        line-height: 1;
        letter-spacing: -0.035em;
        font-family: var(--ph-tournament-display-font);
        font-weight: 700;
      }

      .phab-tournaments__premium-cta {
        margin-top: 28px;
        width: 100%;
        min-height: 72px;
        border-radius: 22px;
        border: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        white-space: nowrap;
        text-decoration: none;
        cursor: pointer;
        background: linear-gradient(90deg, #6f43ff 0%, #8857ff 50%, #7849ff 100%);
        color: #ffffff;
        box-shadow:
          0 16px 32px rgba(120, 84, 255, 0.24),
          inset 0 1px 0 rgba(255, 255, 255, 0.18);
        font-size: 34px;
        line-height: 1;
        letter-spacing: -0.03em;
        font-family: var(--ph-tournament-display-font);
        font-weight: 700;
      }

      .phab-tournaments__entry--premium.is-sold-out .phab-tournaments__premium-cta {
        background: linear-gradient(90deg, #8f84ad 0%, #9e93bb 50%, #8c82a8 100%);
        box-shadow:
          0 12px 24px rgba(95, 84, 122, 0.24),
          inset 0 1px 0 rgba(255, 255, 255, 0.15);
      }

      .phab-tournaments__notice {
        padding: 20px;
        border-radius: 20px;
        color: var(--ph-tournament-ink-soft);
        font-size: 14px;
        line-height: 1.6;
        font-family: var(--ph-tournament-time-font);
      }

      .phab-tournaments__notice-title {
        margin: 0 0 8px;
        color: var(--ph-tournament-ink);
        font-size: 22px;
        line-height: 1;
        letter-spacing: -0.03em;
        font-family: var(--ph-tournament-display-font);
        font-weight: 800;
      }

      .phab-tournaments__backdrop {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 18px;
        background: rgba(17, 17, 24, 0.46);
      }

      .phab-tournaments__backdrop.is-open {
        display: flex;
      }

      .phab-tournaments__dialog {
        width: min(100%, 620px);
        max-height: calc(100vh - 36px);
        overflow: auto;
        padding: 20px;
        border-radius: 20px;
      }

      .phab-tournaments__dialog-title {
        margin: 0 0 8px;
        color: var(--ph-tournament-ink);
        font-size: clamp(24px, 4vw, 36px);
        line-height: 0.98;
        letter-spacing: -0.04em;
        font-family: var(--ph-tournament-display-font);
        font-weight: 800;
      }

      .phab-tournaments__dialog-subtitle {
        margin: 0 0 16px;
        color: var(--ph-tournament-ink-soft);
        font-size: 13px;
        line-height: 1.5;
        font-family: var(--ph-tournament-time-font);
      }

      .phab-tournaments__dialog-status {
        margin-bottom: 16px;
        padding: 14px 16px;
        border-radius: 14px;
        font-size: 13px;
        line-height: 1.5;
        font-family: var(--ph-tournament-time-font);
      }

      .phab-tournaments__dialog-status--info {
        background: var(--ph-tournament-purple-soft);
        color: var(--ph-tournament-purple);
      }

      .phab-tournaments__dialog-status--success {
        background: var(--ph-tournament-green);
        color: var(--ph-tournament-green-ink);
      }

      .phab-tournaments__dialog-status--warning {
        background: var(--ph-tournament-orange);
        color: var(--ph-tournament-orange-ink);
      }

      .phab-tournaments__field {
        display: grid;
        gap: 8px;
        margin-top: 12px;
        font-size: 12px;
        line-height: 1.3;
        font-family: var(--ph-tournament-time-font);
        font-weight: 500;
      }

      .phab-tournaments__field input,
      .phab-tournaments__field select,
      .phab-tournaments__field textarea {
        width: 100%;
        border: 1px solid var(--ph-tournament-line);
        border-radius: 14px;
        padding: 12px 14px;
        font: inherit;
        background: var(--ph-tournament-white);
        color: var(--ph-tournament-ink);
      }

      .phab-tournaments__field textarea {
        min-height: 92px;
        resize: vertical;
      }

      .phab-tournaments__field input:focus,
      .phab-tournaments__field select:focus,
      .phab-tournaments__field textarea:focus {
        outline: none;
        border-color: rgba(115, 83, 217, 0.5);
        box-shadow: 0 0 0 4px rgba(115, 83, 217, 0.08);
      }

      .phab-tournaments__dialog-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 18px;
      }

      .phab-tournaments__dialog-actions .phab-tournaments__button,
      .phab-tournaments__dialog-actions .phab-tournaments__button-secondary {
        width: auto;
        min-width: 180px;
      }

      .phab-tournaments__footnote {
        margin: 14px 0 0;
        color: var(--ph-tournament-ink-soft);
        font-size: 11px;
        line-height: 1.45;
        font-family: var(--ph-tournament-time-font);
      }

      .phab-tournaments__detail {
        width: min(100%, 760px);
      }

      .phab-tournaments__detail-head {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 16px;
        align-items: start;
        margin-bottom: 18px;
      }

      .phab-tournaments__detail-kicker {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 10px;
      }

      .phab-tournaments__detail-title {
        margin: 0;
        color: var(--ph-tournament-ink);
        font-size: clamp(30px, 5vw, 52px);
        line-height: 0.95;
        letter-spacing: -0.05em;
        font-family: var(--ph-tournament-display-font);
        font-weight: 800;
      }

      .phab-tournaments__detail-date {
        display: grid;
        place-items: center;
        min-width: 68px;
        min-height: 68px;
        padding: 10px;
        border-radius: 18px;
        background: #1a1a1a;
        color: #ffffff;
        text-align: center;
        font-family: var(--ph-tournament-display-font);
        font-weight: 800;
      }

      .phab-tournaments__detail-date-day {
        font-size: 28px;
        line-height: 1;
      }

      .phab-tournaments__detail-date-weekday {
        margin-top: 5px;
        font-family: var(--ph-tournament-time-font);
        font-size: 11px;
        line-height: 1;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.78);
      }

      .phab-tournaments__detail-image {
        width: 100%;
        min-height: 180px;
        max-height: 320px;
        margin-bottom: 18px;
        border-radius: 18px;
        overflow: hidden;
        background: linear-gradient(135deg, #f1edff 0%, #eef8f1 100%);
      }

      .phab-tournaments__detail-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .phab-tournaments__detail-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin: 18px 0;
      }

      .phab-tournaments__detail-metric {
        display: grid;
        gap: 6px;
        padding: 14px;
        border-radius: 14px;
        background: #f8f8fb;
        border: 1px solid var(--ph-tournament-line);
      }

      .phab-tournaments__detail-metric-label {
        color: var(--ph-tournament-ink-soft);
        font-size: 11px;
        line-height: 1;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-family: var(--ph-tournament-time-font);
      }

      .phab-tournaments__detail-metric-value {
        color: var(--ph-tournament-ink);
        font-size: 15px;
        line-height: 1.25;
        font-family: var(--ph-tournament-display-font);
        font-weight: 800;
      }

      .phab-tournaments__detail-description {
        margin: 0;
        color: var(--ph-tournament-ink-soft);
        font-size: 14px;
        line-height: 1.6;
        font-family: var(--ph-tournament-time-font);
      }

      .phab-tournaments__detail-roster {
        display: grid;
        gap: 10px;
        margin-top: 18px;
      }

      .phab-tournaments__detail-roster-title {
        margin: 0;
        color: var(--ph-tournament-ink);
        font-size: 15px;
        line-height: 1;
        font-family: var(--ph-tournament-display-font);
        font-weight: 800;
      }

      .phab-tournaments__detail-roster-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .phab-tournaments__detail-player {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        padding: 7px 10px;
        border-radius: 999px;
        background: var(--ph-tournament-purple-soft);
        color: var(--ph-tournament-purple);
        font-size: 12px;
        line-height: 1;
        font-family: var(--ph-tournament-time-font);
        font-weight: 500;
      }

      .phab-tournaments__detail-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 20px;
      }

      .phab-tournaments__detail-actions .phab-tournaments__button,
      .phab-tournaments__detail-actions .phab-tournaments__button-secondary {
        width: auto;
        min-width: 180px;
      }

      .phab-tournaments--screen .phab-tournaments__shell {
        gap: 18px;
      }

      .phab-tournaments--screen .phab-tournaments__entry--schedule {
        padding: 24px;
      }

      .phab-tournaments--screen .phab-tournaments__entry-title {
        font-size: clamp(32px, 3.4vw, 52px);
      }

      @media (max-width: 1180px) {
        .phab-tournaments__entry--schedule {
          grid-template-columns:
            minmax(62px, 78px) minmax(40px, 48px) minmax(140px, 0.95fr)
            minmax(178px, 1fr) minmax(104px, 0.68fr) minmax(104px, 0.68fr)
            minmax(58px, 68px) minmax(112px, 128px);
        }

        .phab-tournaments__schedule-header {
          grid-template-columns:
            minmax(62px, 78px) minmax(40px, 48px) minmax(140px, 0.95fr)
            minmax(178px, 1fr) minmax(104px, 0.68fr) minmax(104px, 0.68fr)
            minmax(58px, 68px) minmax(112px, 128px);
        }

        .phab-tournaments__schedule-type,
        .phab-tournaments__schedule-gender,
        .phab-tournaments__schedule-level,
        .phab-tournaments__schedule-trainer,
        .phab-tournaments__schedule-location,
        .phab-tournaments__schedule-spots {
          font-size: 12px;
        }
      }

      @media (max-width: 767px) {
        .phab-tournaments__shell {
          gap: 14px;
          padding: 0 20px 20px;
        }

        .phab-tournaments__hero,
        .phab-tournaments__toolbar,
        .phab-tournaments__entry,
        .phab-tournaments__notice,
        .phab-tournaments__dialog {
          border-radius: 18px;
        }

        .phab-tournaments__hero,
        .phab-tournaments__dialog {
          padding: 16px;
        }

        .phab-tournaments__days-panel {
          gap: 0;
        }

        .phab-tournaments__day-rail {
          gap: 6px;
          padding: 0 0 10px;
        }

        .phab-tournaments__day-nav {
          width: 38px;
          height: 38px;
          font-size: 16px;
          flex-basis: 38px;
        }

        .phab-tournaments__day-month,
        .phab-tournaments__day-date {
          width: 48px;
        }

        .phab-tournaments__day-month {
          min-height: 21px;
          border-radius: 8px 8px 0 0;
        }

        .phab-tournaments__day-date {
          min-height: 31px;
          font-size: 18px;
          border-radius: 0 0 8px 8px;
        }

        .phab-tournaments__toolbar-side {
          width: 100%;
          justify-content: flex-start;
        }

        .phab-tournaments__view-button {
          min-height: 50px;
          font-size: 14px;
        }

        .phab-tournaments__day-heading {
          padding: 0;
        }

        .phab-tournaments__collection--cards {
          grid-template-columns: minmax(0, 1fr);
          gap: 0;
        }

        .phab-tournaments__entry--schedule {
          grid-template-columns: minmax(0, 1fr) 58px;
          gap: 14px;
          padding: 18px;
        }

        .phab-tournaments__schedule-header {
          display: none;
        }

        .phab-tournaments__entry-title,
        .phab-tournaments__card-title {
          font-size: 24px;
        }

        .phab-tournaments__button,
        .phab-tournaments__button-secondary {
          min-height: 42px;
          font-size: 13px;
        }

        .phab-tournaments__dialog-actions .phab-tournaments__button,
        .phab-tournaments__dialog-actions .phab-tournaments__button-secondary {
          width: 100%;
        }

        .phab-tournaments__detail-head {
          grid-template-columns: minmax(0, 1fr);
        }

        .phab-tournaments__detail-date {
          display: none;
        }

        .phab-tournaments__detail-grid {
          grid-template-columns: minmax(0, 1fr);
        }

        .phab-tournaments__detail-actions .phab-tournaments__button,
        .phab-tournaments__detail-actions .phab-tournaments__button-secondary {
          width: 100%;
        }

        .phab-tournaments__entry--premium {
          padding: 22px;
          border-radius: 26px;
        }

      .phab-tournaments__entry--card {
          width: calc(100% + 40px);
          max-width: none;
          margin: 0 -20px;
        }

        .phab-tournaments__premium-time {
          font-size: 42px;
        }

        .phab-tournaments__premium-title {
          font-size: 30px;
        }

        .phab-tournaments__premium-badge {
          font-size: 22px;
          padding: 12px 18px;
        }

        .phab-tournaments__premium-badge-ball {
          width: 22px;
          height: 22px;
          flex-basis: 22px;
        }

        .phab-tournaments__premium-meta {
          margin-top: 18px;
          font-size: 18px;
        }

        .phab-tournaments__premium-organizer-name {
          font-size: 26px;
        }

        .phab-tournaments__premium-avatar {
          width: 82px;
          height: 82px;
          flex-basis: 82px;
          font-size: 27px;
        }

        .phab-tournaments__premium-tariff {
          min-height: 116px;
          padding: 22px 24px;
        }

        .phab-tournaments__premium-tariff-title {
          font-size: 24px;
        }

        .phab-tournaments__premium-tariff-price {
          font-size: 28px;
        }

        .phab-tournaments__premium-cta {
          min-height: 62px;
          font-size: 28px;
        }
      }

      @media (max-width: 540px) {
        .phab-tournaments__view {
          width: 100%;
        }

        .phab-tournaments__view-button {
          flex: 1 1 0;
        }

        .phab-tournaments__card-row,
        .phab-tournaments__card-title-wrap {
          flex-wrap: wrap;
        }

        .phab-tournaments__card-compact-head {
          gap: 16px;
        }

        .phab-tournaments__card-compact-heading {
          padding-right: 52px;
        }

        .phab-tournaments__card-compact-capacity-texts {
          flex-wrap: wrap;
        }

        .phab-tournaments__card-compact-footer {
          flex-wrap: wrap;
        }

        .phab-tournaments__card-compact-footer-time {
          margin-left: 0;
        }

        .phab-tournaments__card-body {
          grid-template-columns: 48px minmax(0, 1fr);
          align-items: start;
        }

        .phab-tournaments__card-status {
          justify-self: start;
          grid-column: 1 / -1;
        }

        .phab-tournaments__premium-head {
          flex-direction: column;
          align-items: stretch;
          gap: 14px;
        }

        .phab-tournaments__premium-head-left {
          gap: 14px;
          align-items: flex-start;
        }

        .phab-tournaments__premium-time {
          font-size: 34px;
        }

        .phab-tournaments__premium-title {
          font-size: 24px;
          padding-top: 2px;
          white-space: normal;
        }

        .phab-tournaments__premium-badge {
          align-self: flex-start;
          font-size: 18px;
          padding: 10px 16px;
        }

        .phab-tournaments__premium-meta {
          font-size: 15px;
        }

        .phab-tournaments__premium-divider {
          margin: 20px 0;
        }

        .phab-tournaments__premium-organizer {
          gap: 14px;
        }

        .phab-tournaments__premium-avatar {
          width: 68px;
          height: 68px;
          flex-basis: 68px;
          font-size: 22px;
        }

        .phab-tournaments__premium-organizer-name {
          font-size: 22px;
          white-space: normal;
        }

        .phab-tournaments__premium-tariffs {
          gap: 14px;
        }

        .phab-tournaments__premium-tariff {
          min-height: 94px;
          border-radius: 20px;
          padding: 18px 18px 16px;
        }

        .phab-tournaments__premium-tariff-title {
          font-size: 20px;
        }

        .phab-tournaments__premium-tariff-price {
          margin-top: 10px;
          font-size: 26px;
        }

        .phab-tournaments__premium-cta {
          min-height: 58px;
          border-radius: 18px;
          font-size: 24px;
        }
      }
    `;
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

  function isValidDayKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
  }

  function resolveItemDayKey(item) {
    var parsed = parseDate(normalizeObject(item).startsAt);
    return parsed ? formatDateKey(parsed) : 'unknown';
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

  function formatCardScheduleLabel(card) {
    var start = parseDate(card.startsAt);
    var end = parseDate(card.endsAt);

    if (!start) {
      return 'Дата уточняется';
    }

    var dateLabel = start.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long'
    });

    if (end) {
      return dateLabel + ', ' + formatTime(start) + '—' + formatTime(end);
    }

    return dateLabel + ', ' + formatTime(start);
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

  function formatDurationCompact(card) {
    var minutes = formatDurationMinutes(card);
    var hours;
    var restMinutes;

    if (!minutes) {
      return '';
    }

    if (minutes < 60) {
      return String(minutes) + ' мин.';
    }

    hours = Math.floor(minutes / 60);
    restMinutes = minutes % 60;

    if (!restMinutes) {
      return String(hours) + ' ч.';
    }

    return String(hours) + ' ч. ' + String(restMinutes) + ' мин.';
  }

  function formatWeekdayShort(date) {
    return date.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '');
  }

  function formatDateBadgeDay(value) {
    var parsed = parseDate(value);
    return parsed ? String(parsed.getDate()) : '—';
  }

  function formatDateBadgeWeekday(value) {
    var parsed = parseDate(value);
    return parsed ? formatWeekdayShort(parsed) : '';
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

  function formatLevelScoreToken(value) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return '';
    }
    return String(numeric.toFixed(3)).replace(/0+$/, '').replace(/\.$/, '');
  }

  function buildLevelOptions() {
    var options = [];
    LEVEL_BANDS.forEach(function (band, bandIndex) {
      for (var step = 0; step <= LEVEL_DIVISION_COUNT; step += 1) {
        if (bandIndex > 0 && step === 0) {
          continue;
        }
        var score = band.min + (band.max - band.min) * (step / LEVEL_DIVISION_COUNT);
        var token = formatLevelScoreToken(score);
        if (token) {
          options.push({
            token: token,
            base: band.base,
            step: step,
            rank: options.length
          });
        }
      }
    });
    return options;
  }

  function formatAccessLevels(levels) {
    var list = sortLevels(levels);
    if (list.length === 0) {
      return 'Без ограничений';
    }
    return 'Уровни: ' + list.join(', ');
  }

  function formatAccessLevelCompact(levels) {
    var list = sortLevels(levels);
    if (list.length === 0) {
      return '';
    }
    return formatLevelRangeText(list);
  }

  function normalizeLevelLabel(value) {
    return normalizeLevelToken(value);
  }

  function findLevelOption(token) {
    var normalized = String(token || '').trim();
    return LEVEL_OPTIONS.find(function (item) {
      return item.token === normalized;
    }) || null;
  }

  function normalizeLevelScoreToken(value) {
    var normalized = String(value || '').trim().replace(',', '.');
    if (!normalized) {
      return '';
    }
    var numeric = Number(normalized);
    if (!Number.isFinite(numeric)) {
      return '';
    }
    var token = formatLevelScoreToken(numeric);
    return findLevelOption(token) ? token : '';
  }

  function normalizeLevelToken(value) {
    var normalized = String(value || '')
      .trim()
      .toUpperCase()
      .replace(/,/g, '.')
      .replace(/[·•]/g, ' ')
      .replace(/\s+/g, ' ');
    if (!normalized) {
      return '';
    }

    var numericToken = normalizeLevelScoreToken(normalized);
    if (numericToken) {
      return numericToken;
    }

    if (LEVEL_BASE_OPTIONS.indexOf(normalized) >= 0) {
      return normalized;
    }

    return normalized;
  }

  function expandLevelValue(value) {
    var normalized = normalizeLevelToken(value);
    if (!normalized) {
      return [];
    }
    if (LEVEL_BASE_OPTIONS.indexOf(normalized) >= 0) {
      return LEVEL_OPTIONS.filter(function (item) {
        return item.base === normalized;
      }).map(function (item) {
        return item.token;
      });
    }
    return findLevelOption(normalized) ? [normalized] : [];
  }

  function rankLevel(level) {
    var normalized = normalizeLevelLabel(level);
    var option = findLevelOption(normalized);
    return option ? option.rank : LEVEL_OPTIONS.length;
  }

  function sortLevels(levels) {
    var seen = {};
    return normalizeArray(levels)
      .reduce(function (result, item) {
        expandLevelValue(item).forEach(function (token) {
          if (!seen[token]) {
            seen[token] = true;
            result.push(token);
          }
        });
        return result;
      }, [])
      .sort(function (left, right) {
        return rankLevel(left) - rankLevel(right);
      });
  }

  function formatAccessLevelRange(levels) {
    var list = sortLevels(levels);

    if (list.length === 0) {
      return 'без ограничений';
    }

    if (list.length === 1) {
      return formatLevelStepText(list[0]);
    }

    return 'от ' + formatLevelStepText(list[0]) + ' до ' + formatLevelStepText(list[list.length - 1]);
  }

  function resolveLevelStep(token) {
    var numeric = Number(String(token || '').replace(',', '.'));
    if (!Number.isFinite(numeric)) {
      var fallback = findLevelOption(token);
      return fallback
        ? { base: fallback.base, step: Math.max(1, Math.min(LEVEL_DIVISION_COUNT, Number(fallback.step) + 1 || 1)) }
        : null;
    }

    for (var index = 0; index < LEVEL_BANDS.length; index += 1) {
      var band = LEVEL_BANDS[index];
      var isLast = index === LEVEL_BANDS.length - 1;
      var inBand = numeric >= band.min && (isLast ? numeric <= band.max : numeric < band.max);
      if (!inBand) {
        continue;
      }

      var ratio = (numeric - band.min) / (band.max - band.min);
      var step = Math.floor(ratio * LEVEL_DIVISION_COUNT) + 1;
      return {
        base: band.base,
        step: Math.max(1, Math.min(LEVEL_DIVISION_COUNT, step))
      };
    }

    return null;
  }

  function formatLevelStepText(token) {
    var step = resolveLevelStep(token);
    if (!step) {
      return String(token || '').trim();
    }
    var hasPlus = /\+$/.test(step.base);
    var base = hasPlus ? step.base.slice(0, -1) : step.base;
    return base + (LEVEL_SUPERSCRIPTS[step.step] || String(step.step)) + (hasPlus ? '+' : '');
  }

  function formatLevelRangeText(tokens) {
    if (!tokens || tokens.length === 0) {
      return '';
    }
    var first = formatLevelStepText(tokens[0]);
    var last = formatLevelStepText(tokens[tokens.length - 1]);
    return first === last ? first : first + '-' + last;
  }

  function createLevelMark(token) {
    var step = resolveLevelStep(token);
    if (!step) {
      return createElement('span', '', token);
    }
    var hasPlus = /\+$/.test(step.base);
    var base = hasPlus ? step.base.slice(0, -1) : step.base;
    var mark = createElement('span', 'phab-tournaments__level-mark');
    mark.appendChild(document.createTextNode(base));
    mark.appendChild(createElement('sup', '', String(step.step)));
    if (hasPlus) {
      mark.appendChild(document.createTextNode('+'));
    }
    return mark;
  }

  function createAccessLevelCompactNode(levels) {
    var list = sortLevels(levels);
    var node = createElement('div', 'phab-tournaments__schedule-level');
    if (list.length === 0) {
      node.textContent = 'Все';
      return node;
    }

    node.appendChild(createLevelMark(list[0]));
    if (list.length > 1 && formatLevelStepText(list[0]) !== formatLevelStepText(list[list.length - 1])) {
      node.appendChild(createElement('span', '', '-'));
      node.appendChild(createLevelMark(list[list.length - 1]));
    }
    return node;
  }

  function createAccessLevelTextNode(levels) {
    var list = sortLevels(levels);
    var node = createElement('span', 'phab-tournaments__card-compact-meta-text');
    if (list.length === 0) {
      node.textContent = 'без ограничений';
      return node;
    }

    if (list.length === 1) {
      node.appendChild(createLevelMark(list[0]));
      return node;
    }

    node.appendChild(document.createTextNode('от '));
    node.appendChild(createLevelMark(list[0]));
    node.appendChild(document.createTextNode(' до '));
    node.appendChild(createLevelMark(list[list.length - 1]));
    return node;
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

  function pluralizeRu(count, one, few, many) {
    var numeric = Math.max(0, Number(count) || 0);
    var mod10 = numeric % 10;
    var mod100 = numeric % 100;

    if (mod10 === 1 && mod100 !== 11) {
      return numeric + ' ' + one;
    }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
      return numeric + ' ' + few;
    }
    return numeric + ' ' + many;
  }

  function formatSpots(card) {
    var participantsCount = Math.max(0, Number(card.participantsCount) || 0);
    var maxPlayers = Number(card.maxPlayers);
    if (!Number.isFinite(maxPlayers) || maxPlayers <= 0) {
      return 'Состав уточняется';
    }

    return String(participantsCount) + ' / ' + String(Math.round(maxPlayers));
  }

  function formatParticipantsSummary(card) {
    var participantsCount = Math.max(0, Number(card.participantsCount) || 0);
    var maxPlayers = Number(card.maxPlayers);

    if (!Number.isFinite(maxPlayers) || maxPlayers <= 0) {
      return 'Состав уточняется';
    }

    return String(participantsCount) + '/' + String(Math.round(maxPlayers)) + ' участников';
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

  function formatGenderBadgeLabel(gender) {
    var value = String(gender || '').toUpperCase();
    if (value === 'MIXED') {
      return 'микст';
    }
    if (value === 'MALE') {
      return 'мужчины';
    }
    if (value === 'FEMALE') {
      return 'женщины';
    }
    return '';
  }

  function formatGenderCardLabel(gender) {
    var label = formatGenderBadgeLabel(gender);
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : '';
  }

  function resolveLocationLabel(card) {
    return (
      String(card.studioName || '').trim()
      || String(normalizeObject(card.sourceTournament).studioName || '').trim()
      || 'PadelHub'
    );
  }

  function resolveCourtLabel(card) {
    var skin = normalizeObject(card.skin);
    var sourceTournament = normalizeObject(card.sourceTournament);
    var details = normalizeObject(card.details);
    var booking = normalizeObject(card.booking);
    var sourceDetails = normalizeObject(sourceTournament.details);
    var label = (
      String(card.courtName || '').trim()
      || String(card.locationName || '').trim()
      || String(card.roomName || '').trim()
      || String(skin.courtName || '').trim()
      || String(skin.locationName || '').trim()
      || String(sourceTournament.courtName || '').trim()
      || String(sourceTournament.locationName || '').trim()
      || String(sourceTournament.roomName || '').trim()
      || String(details.courtName || '').trim()
      || String(details.locationName || '').trim()
      || String(details.roomName || '').trim()
      || String(booking.courtName || '').trim()
      || String(booking.locationName || '').trim()
      || String(booking.roomName || '').trim()
      || String(sourceDetails.courtName || '').trim()
      || String(sourceDetails.locationName || '').trim()
      || String(sourceDetails.roomName || '').trim()
    );

    return label;
  }

  function resolveMapUrl(card) {
    var location = resolveLocationLabel(card);
    if (!location || location === 'PadelHub') {
      return '';
    }

    return 'https://yandex.ru/maps/?text=' + encodeURIComponent(location);
  }

  function resolveTrainerLabel(card) {
    return (
      String(card.trainerName || '').trim()
      || String(normalizeObject(card.sourceTournament).trainerName || '').trim()
      || 'Организатор турнира'
    );
  }

  function resolveProfileHandle(card) {
    var base =
      String(card.slug || '').trim()
      || String(card.sourceTournamentId || '').trim()
      || 'padelhub';

    base = base.replace(/^@+/, '');
    return '@' + base;
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

    return [resolveLocationLabel(card), formatTimeRange(card)].filter(Boolean).join(' • ');
  }

  function resolvePrimaryImage(card) {
    var skin = normalizeObject(card.skin);
    return String(skin.imageUrl || '').trim();
  }

  function resolveTrainerAvatar(card) {
    var sourceTournament = normalizeObject(card.sourceTournament);
    return (
      String(card.trainerAvatarUrl || '').trim()
      || String(sourceTournament.trainerAvatarUrl || '').trim()
    );
  }

  function resolveCardBadgeLabel(card) {
    return String(card.tournamentType || 'Турнир').trim() || 'Турнир';
  }

  function resolveCardPriceLabel(card) {
    var skin = normalizeObject(card.skin);
    var booking = normalizeObject(card.booking);
    var purchaseOption = normalizeArray(booking.purchaseOptions)[0];
    var acceptedSubscription = normalizeArray(booking.acceptedSubscriptions)[0];
    var skinPriceLabel = String(skin.priceLabel || skin.price || skin.costLabel || '').trim();

    if (skinPriceLabel) {
      return formatCurrencySuffix(skinPriceLabel);
    }

    if (purchaseOption) {
      var purchase = normalizeObject(purchaseOption);
      var purchasePrice = String(purchase.priceLabel || purchase.price || '').trim();
      if (purchasePrice) {
        return formatCurrencySuffix(purchasePrice);
      }
    }

    if (acceptedSubscription) {
      var subscription = normalizeObject(acceptedSubscription);
      var writeOffLabel = String(subscription.writeOffLabel || '').trim();
      if (writeOffLabel) {
        return writeOffLabel;
      }
      var subscriptionLabel = String(subscription.label || '').trim();
      if (subscriptionLabel) {
        return subscriptionLabel;
      }
    }

    return 'Энергия';
  }

  function formatCurrencySuffix(label) {
    var value = String(label || '').trim();
    if (/^\d[\d\s.,]*$/.test(value)) {
      return value + ' ₽';
    }
    return value;
  }

  function resolveProgressDescriptor(card) {
    var maxPlayers = Number(card.maxPlayers);
    var participantsCount = Math.max(0, Number(card.participantsCount) || 0);
    var totalSegments;

    if (!Number.isFinite(maxPlayers) || maxPlayers <= 0) {
      return {
        totalSegments: 1,
        filledSegments: 0
      };
    }

    totalSegments = Math.max(1, Math.round(maxPlayers));

    return {
      totalSegments: totalSegments,
      filledSegments: Math.min(totalSegments, Math.floor(participantsCount))
    };
  }

  function resolveRemainingSpotsLabel(descriptor) {
    if (descriptor.spotsLeft === null || descriptor.spotsLeft === undefined) {
      return 'места уточняются';
    }

    if (descriptor.spotsLeft <= 0) {
      return 'мест нет';
    }

    return 'осталось: ' + pluralizeSpots(descriptor.spotsLeft);
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

  function syncResponsiveViewMode(state) {
    state.viewMode = getDefaultViewMode();
    return state.viewMode;
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

  function getStartOfToday() {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  function addDays(date, days) {
    var next = new Date(date.getTime());
    next.setDate(next.getDate() + days);
    return next;
  }

  function filterVisibleItems(items, includePast, forwardDays) {
    var today;
    var endDay;
    var days = normalizePositiveInteger(forwardDays, DEFAULT_FORWARD_DAYS);

    if (includePast) {
      return items.slice();
    }

    today = getStartOfToday();
    endDay = addDays(today, days - 1);
    endDay.setHours(23, 59, 59, 999);

    return items.filter(function (item) {
      var parsed = parseDate(item.startsAt);

      if (!parsed) {
        return true;
      }

      return parsed.getTime() >= today.getTime() && parsed.getTime() <= endDay.getTime();
    });
  }

  function toDayGroup(group) {
    var weekday = group.date ? formatWeekdayShort(group.date).toUpperCase() : '...';
    var month = group.date ? formatMonthShort(group.date).toUpperCase() : 'DATE';
    var dayNumber = group.date ? String(group.date.getDate()).padStart(2, '0') : '—';

    return {
      key: group.key,
      date: group.date,
      items: group.items,
      weekday: weekday,
      month: month,
      dayNumber: dayNumber,
      headline: group.date ? formatDayLabel(group.date) : 'Турниры без даты'
    };
  }

  function buildExistingDayGroups(items) {
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
      return toDayGroup(group);
    });
  }

  function buildForwardDayGroups(items, forwardDays) {
    var grouped = {};
    var today = getStartOfToday();
    var groups = [];
    var days = normalizePositiveInteger(forwardDays, DEFAULT_FORWARD_DAYS);

    items.forEach(function (item) {
      var parsed = parseDate(item.startsAt);
      var key = parsed ? formatDateKey(parsed) : 'unknown';

      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(item);
    });

    for (var index = 0; index < days; index += 1) {
      var date = addDays(today, index);
      var key = formatDateKey(date);
      groups.push(
        toDayGroup({
          key: key,
          date: date,
          items: grouped[key] || []
        })
      );
    }

    if (grouped.unknown && grouped.unknown.length > 0) {
      groups.push(
        toDayGroup({
          key: 'unknown',
          date: null,
          items: grouped.unknown
        })
      );
    }

    return groups;
  }

  function buildDayGroups(items, includePast, forwardDays) {
    return includePast ? buildExistingDayGroups(items) : buildForwardDayGroups(items, forwardDays);
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

  function scheduleDayRailShift(mount, state, dayGroups, nextDayKey) {
    var rail = mount ? mount.querySelector('.phab-tournaments__day-rail') : null;
    var currentIndex = dayGroups.findIndex(function (group) {
      return group.key === state.selectedDayKey;
    });
    var nextIndex = dayGroups.findIndex(function (group) {
      return group.key === nextDayKey;
    });

    state.dayRailScrollLeft = rail ? rail.scrollLeft : state.dayRailScrollLeft || 0;
    state.dayRailShiftDirection =
      currentIndex >= 0 && nextIndex >= 0
        ? Math.max(-1, Math.min(1, nextIndex - currentIndex))
        : 0;
    state.dayRailShiftPending = state.dayRailShiftDirection !== 0;
  }

  function shiftDayRail(mount, state) {
    if (
      !mount
      || !state.dayRailShiftPending
      || typeof window === 'undefined'
      || typeof window.requestAnimationFrame !== 'function'
    ) {
      return;
    }

    window.requestAnimationFrame(function () {
      var rail = mount.querySelector('.phab-tournaments__day-rail');
      var firstDay = rail ? rail.querySelector('.phab-tournaments__day') : null;
      var step = firstDay
        ? firstDay.getBoundingClientRect().width
        : 48;

      if (!rail) {
        state.dayRailShiftPending = false;
        return;
      }

      if (firstDay) {
        var styles = window.getComputedStyle ? window.getComputedStyle(rail) : null;
        var gap = styles ? parseFloat(styles.columnGap || styles.gap || '0') : 0;
        step += Number.isFinite(gap) ? gap : 0;
      }

      rail.scrollLeft = state.dayRailScrollLeft || 0;
      rail.scrollTo({
        left: Math.max(0, (state.dayRailScrollLeft || 0) + state.dayRailShiftDirection * step),
        behavior: 'smooth',
      });
      state.dayRailShiftPending = false;
    });
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
    var publicUrl = String(card.publicUrl || '').trim();
    var joinUrl = String(card.joinUrl || '').trim();

    if (descriptor.key === 'completed' || descriptor.key === 'cancelled') {
      return {
        kind: 'secondary',
        label: 'Открыть',
        mode: publicUrl ? 'public' : 'disabled'
      };
    }

    if (descriptor.key === 'closed') {
      return {
        kind: 'secondary',
        label: 'Открыть',
        mode: publicUrl ? 'public' : 'disabled'
      };
    }

    if (descriptor.key === 'full' || descriptor.key === 'waitlist') {
      return {
        kind: 'secondary',
        label: 'Открыть',
        mode: joinUrl ? 'join' : publicUrl ? 'public' : 'disabled'
      };
    }

    return {
      kind: 'primary',
      label: 'Открыть',
      mode: joinUrl ? 'join' : publicUrl ? 'public' : 'disabled'
    };
  }

  function createStatusCard(title, description) {
    var card = createElement('section', 'phab-tournaments__notice');
    card.appendChild(createElement('h3', 'phab-tournaments__notice-title', title));
    card.appendChild(createElement('p', '', description));
    return card;
  }

  function createDetailMetric(label, value) {
    return appendChildren(createElement('div', 'phab-tournaments__detail-metric'), [
      createElement('span', 'phab-tournaments__detail-metric-label', label),
      createElement('span', 'phab-tournaments__detail-metric-value', value)
    ]);
  }

  function resolveDetailDescription(card) {
    var skin = normalizeObject(card.skin);
    var description = String(skin.description || skin.subtitle || '').trim();
    if (description) {
      return description;
    }
    return [
      card.tournamentType || 'Турнир',
      formatAccessLevels(card.accessLevels),
      resolveLocationLabel(card)
    ].filter(Boolean).join(' • ');
  }

  function createDetailRoster(card) {
    var participants = normalizeArray(card.participants).slice(0, 10);
    var roster = createElement('div', 'phab-tournaments__detail-roster');
    var list = createElement('div', 'phab-tournaments__detail-roster-list');

    roster.appendChild(createElement('h4', 'phab-tournaments__detail-roster-title', 'Участники'));

    if (participants.length === 0) {
      list.appendChild(createElement('span', 'phab-tournaments__detail-player', 'Пока никто не записался'));
    } else {
      participants.forEach(function (item) {
        var participant = normalizeObject(item);
        var name = String(participant.name || 'Игрок').trim();
        var level = String(participant.levelLabel || '').trim();
        list.appendChild(
          createElement(
            'span',
            'phab-tournaments__detail-player',
            level ? name + ' · ' + level : name
          )
        );
      });
    }

    roster.appendChild(list);
    return roster;
  }

  function createTournamentDetailDialog(mount, state, item) {
    var card = normalizeObject(item);
    var descriptor = resolveTournamentState(card);
    var joinUrl = resolveUrl(card.joinUrl, state.config);
    var publicUrl = resolveUrl(card.publicUrl, state.config);
    var imageUrl = resolvePrimaryImage(card);
    var dialog = createElement('div', 'phab-tournaments__dialog phab-tournaments__detail');
    var head = createElement('div', 'phab-tournaments__detail-head');
    var copy = createElement('div', 'phab-tournaments__detail-copy');
    var kicker = createElement('div', 'phab-tournaments__detail-kicker');
    var dateBadge = createElement('div', 'phab-tournaments__detail-date');
    var grid = createElement('div', 'phab-tournaments__detail-grid');
    var actions = createElement('div', 'phab-tournaments__detail-actions');
    var joinButton = createElement(
      'button',
      'phab-tournaments__button',
      descriptor.key === 'full' || descriptor.key === 'waitlist' ? 'В лист ожидания' : 'Присоединиться'
    );
    var closeButton = createElement('button', 'phab-tournaments__button-secondary', 'Назад к списку');

    appendChildren(kicker, [
      createChip(descriptor.label, 'phab-tournaments__chip--status-' + descriptor.key),
      createChip(card.tournamentType || 'Турнир', 'phab-tournaments__chip--type'),
      formatAccessLevelCompact(card.accessLevels)
        ? createChip(formatAccessLevelCompact(card.accessLevels), 'phab-tournaments__chip--level')
        : null,
      formatGenderLabel(card.gender)
        ? createChip(formatGenderLabel(card.gender), 'phab-tournaments__chip--gender')
        : null
    ]);

    copy.appendChild(kicker);
    copy.appendChild(createElement('h3', 'phab-tournaments__detail-title', resolveTitle(card)));
    dateBadge.appendChild(createElement('span', 'phab-tournaments__detail-date-day', formatDateBadgeDay(card.startsAt)));
    dateBadge.appendChild(createElement('span', 'phab-tournaments__detail-date-weekday', formatDateBadgeWeekday(card.startsAt)));
    appendChildren(head, [copy, dateBadge]);
    dialog.appendChild(head);

    if (imageUrl) {
      var image = createElement('div', 'phab-tournaments__detail-image');
      var img = document.createElement('img');
      configureLazyImage(img);
      img.src = imageUrl;
      img.alt = resolveTitle(card);
      image.appendChild(img);
      dialog.appendChild(image);
    }

    appendChildren(grid, [
      createDetailMetric('Дата и время', formatCardScheduleLabel(card)),
      createDetailMetric('Площадка', resolveLocationLabel(card)),
      createDetailMetric('Формат', card.tournamentType || 'Турнир'),
      createDetailMetric('Места', formatParticipantsSummary(card)),
      createDetailMetric('Уровень', formatAccessLevelRange(card.accessLevels)),
      createDetailMetric('Организатор', resolveTrainerLabel(card))
    ]);
    dialog.appendChild(grid);
    dialog.appendChild(createElement('p', 'phab-tournaments__detail-description', resolveDetailDescription(card)));
    dialog.appendChild(createDetailRoster(card));

    joinButton.type = 'button';
    joinButton.disabled = !joinUrl || descriptor.key === 'completed' || descriptor.key === 'cancelled' || descriptor.key === 'closed';
    if (joinButton.disabled) {
      joinButton.textContent = descriptor.key === 'closed' ? 'Регистрация закрыта' : 'Запись недоступна';
    }
    joinButton.addEventListener('click', function () {
      joinButton.disabled = true;
      joinButton.textContent = 'Проверяем...';
      state.detailItem = null;
      state.detailRequestKey = '';
      openJoinFlow(mount, state, card, joinUrl);
    });

    closeButton.type = 'button';
    closeButton.addEventListener('click', function () {
      closeDialog(mount, state);
    });

    actions.appendChild(joinButton);
    if (publicUrl) {
      var publicButton = createElement('a', 'phab-tournaments__button-secondary', 'Открыть страницу');
      publicButton.href = publicUrl;
      actions.appendChild(publicButton);
    }
    actions.appendChild(closeButton);
    dialog.appendChild(actions);
    dialog.appendChild(
      createElement(
        'p',
        'phab-tournaments__footnote',
        'После нажатия «Присоединиться» проверим личный кабинет: если есть подходящая Энергия, предложим списание; если нет — покажем варианты оплаты участия.'
      )
    );

    return dialog;
  }

  function buildRequestUrl(config, options) {
    var requestOptions = options || {};
    var url = new URL(
      normalizeApiBaseUrl(config.apiBaseUrl) + '/tournaments/public/list',
      window.location.href
    );
    var days = normalizePositiveInteger(requestOptions.forwardDays, config.forwardDays);
    var dateKey = String(requestOptions.dateKey || '').trim();

    if (config.stationIds.length > 0) {
      url.searchParams.set('stationId', config.stationIds.join(','));
    }
    if (config.limit > 0) {
      url.searchParams.set('limit', String(config.limit));
    }
    if (config.includePast) {
      url.searchParams.set('includePast', 'true');
    }
    if (!config.includePast && dateKey) {
      url.searchParams.set('date', dateKey);
    } else if (!config.includePast && days > 0) {
      url.searchParams.set('forwardDays', String(days));
    }

    return url.toString();
  }

  function configureLazyImage(img) {
    if (!img) {
      return img;
    }
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  }

  function buildTournamentDetailUrl(config, item) {
    var card = normalizeObject(item);
    var publicUrl = buildTournamentPublicUrl(config, card);
    var slug = String(card.slug || '').trim();
    var url;

    if (publicUrl) {
      url = new URL(publicUrl, window.location.href);
    } else if (slug) {
      url = new URL(
        normalizeApiBaseUrl(config.apiBaseUrl) + '/tournaments/public/' + encodeURIComponent(slug),
        window.location.href
      );
    } else {
      return '';
    }

    url.searchParams.set('format', 'json');
    url.searchParams.set('_ts', String(Date.now()));
    return url.toString();
  }

  function buildTournamentPublicUrl(config, item) {
    var card = normalizeObject(item);
    var publicUrl = resolveUrl(card.publicUrl, config);
    var slug = String(card.slug || '').trim();

    if (publicUrl) {
      return publicUrl;
    }
    if (!slug) {
      return '';
    }

    try {
      return new URL(
        normalizeApiBaseUrl(config.apiBaseUrl) + '/tournaments/public/' + encodeURIComponent(slug),
        window.location.href
      ).toString();
    } catch (_error) {
      return '';
    }
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

  function jsonFetchWithTimeout(url, options, timeoutMs) {
    if (typeof AbortController !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return jsonFetch(url, options);
    }

    var controller = new AbortController();
    var requestOptions = Object.assign({}, options || {}, {
      signal: controller.signal
    });
    var timerId = setTimeout(function () {
      controller.abort();
    }, timeoutMs);

    return jsonFetch(url, requestOptions)
      .finally(function () {
        clearTimeout(timerId);
      });
  }

  function shouldRetryDirectoryRequest(error) {
    var message = String((error && error.message) || '').toLowerCase();
    return message.indexOf('request failed with status') !== 0;
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

  function mergeTournamentPayload(currentPayload, nextPayload) {
    var current = normalizeObject(currentPayload);
    var next = normalizeObject(nextPayload);
    var byKey = {};
    var items = [];

    normalizeArray(current.items).concat(normalizeArray(next.items)).forEach(function (item) {
      var record = normalizeObject(item);
      var key = String(record.id || record.slug || record.joinUrl || '').trim();
      if (!key) {
        key = 'item-' + items.length;
      }
      if (!byKey[key]) {
        items.push(record);
      }
      byKey[key] = record;
    });

    return Object.assign({}, current, next, {
      count: items.length,
      items: items.map(function (item) {
        var key = String(item.id || item.slug || item.joinUrl || '').trim();
        return byKey[key] || item;
      })
    });
  }

  function mergeTournamentPayloadForDay(currentPayload, nextPayload, dayKey) {
    var current = normalizeObject(currentPayload);
    var next = normalizeObject(nextPayload);
    var targetDayKey = String(dayKey || '').trim();
    var preserved = normalizeArray(current.items).filter(function (item) {
      return resolveItemDayKey(item) !== targetDayKey;
    });
    var nextItems = normalizeArray(next.items).map(function (item) {
      return normalizeObject(item);
    });
    var items = preserved.concat(nextItems);

    return Object.assign({}, current, next, {
      count: items.length,
      items: items
    });
  }

  function markLoadedDaysFromPayload(state, payload) {
    normalizeArray(normalizeObject(payload).items).forEach(function (item) {
      var key = resolveItemDayKey(item);
      if (key !== 'unknown') {
        state.loadedDayKeys[key] = true;
      }
    });
  }

  function shouldLoadDayOnDemand(state, dayKey) {
    var key = String(dayKey || '').trim();
    if (state.config.includePast || !isValidDayKey(key)) {
      return false;
    }
    return !state.loadedDayKeys[key];
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
    state.vivaAuthorizationHeader = String(flow.vivaAuthorizationHeader || '').trim();
    var phoneVerification = normalizeObject(flow.phoneVerification);
    if (phoneVerification.ok) {
      state.phoneVerificationMessage = String(phoneVerification.message || '').trim();
      state.smsResendAvailableAt = Date.now() + SMS_RESEND_COOLDOWN_MS;
    } else if (flow.code !== 'PHONE_VERIFICATION_REQUIRED') {
      state.phoneVerificationMessage = '';
      state.smsResendAvailableAt = 0;
    }
  }

  function formatCountdown(seconds) {
    return String(Math.max(0, Math.ceil(seconds))) + 'с';
  }

  function startSmsResendTimer(button, state) {
    function update() {
      if (!button.isConnected) {
        return false;
      }
      var remainingMs = Math.max(0, Number(state.smsResendAvailableAt || 0) - Date.now());
      if (remainingMs <= 0) {
        button.disabled = false;
        button.textContent = 'Отправить код повторно';
        return false;
      }
      button.disabled = true;
      button.textContent = 'Отправить код повторно (' + formatCountdown(remainingMs / 1000) + ')';
      return true;
    }

    if (!update()) {
      return;
    }

    var timerId = window.setInterval(function () {
      if (!update()) {
        window.clearInterval(timerId);
      }
    }, 1000);
  }

  function buildLevelFallbackUrl(state) {
    var flow = normalizeObject(state.flow);
    var access = normalizeObject(flow.access);
    var level =
      String(state.draft.levelLabel || '').trim()
      || String(access.levelLabel || '').trim();
    var url = new URL('/tournaments', window.location.origin);
    if (level) {
      url.searchParams.set('level', level);
    }
    return url.toString();
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
    state.detailItem = null;
    state.detailRequestKey = '';
    state.flow = null;
    state.outcome = null;
    state.activeJoinUrl = '';
    state.activeItem = null;

    if (state.reloadOnClose) {
      state.reloadOnClose = false;
      if (shouldLoadDayOnDemand(state, state.selectedDayKey) || isValidDayKey(state.selectedDayKey)) {
        loadTournaments(mount, state, { dateKey: state.selectedDayKey });
      } else {
        loadTournaments(mount, state, { forwardDays: state.config.initialForwardDays });
      }
      return;
    }

    renderTournaments(mount, state.payload, state);
  }

  function readDraftFromDialog(dialog, state) {
    var nameField = dialog.querySelector('[name="name"]');
    var phoneField = dialog.querySelector('[name="phone"]');
    var levelField = dialog.querySelector('[name="levelLabel"]');
    var notesField = dialog.querySelector('[name="notes"]');
    var authCodeField = dialog.querySelector('[name="authCode"]');
    var selectedSubscriptionField = dialog.querySelector('[name="selectedSubscriptionId"]');
    var selectedPurchaseField = dialog.querySelector('[name="selectedPurchaseOptionId"]');

    state.draft.name = nameField ? String(nameField.value || '').trim() : '';
    state.draft.phone = phoneField ? String(phoneField.value || '').trim() : '';
    state.draft.levelLabel = levelField ? String(levelField.value || '').trim() : '';
    state.draft.notes = notesField ? String(notesField.value || '').trim() : '';
    state.draft.authCode = authCodeField ? String(authCodeField.value || '').trim() : '';
    state.draft.selectedSubscriptionId = selectedSubscriptionField
      ? String(selectedSubscriptionField.value || '').trim()
      : '';
    state.draft.selectedPurchaseOptionId = selectedPurchaseField
      ? String(selectedPurchaseField.value || '').trim()
      : '';
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

  function createCompactBadgeIcon() {
    var icon = createElement('span', 'phab-tournaments__card-compact-badge-icon');
    icon.innerHTML =
      '<svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">' +
      '<path d="M5.23438 0C5.88459 0 6.44442 0.368244 6.71191 0.900391H6.94238C7.53498 0.900391 8 1.35255 8 1.92871C7.99995 2.50479 7.74889 2.99711 7.36621 3.40918C7.17696 3.59313 6.93847 3.75743 6.66699 3.85742C6.27576 4.79351 5.38208 5.47261 4.30762 5.58301V6.49902H5.2334C5.68595 6.49918 6.05664 6.85978 6.05664 7.2998V7.39941H6.46777C6.6363 7.39946 6.77609 7.53542 6.77637 7.69922C6.77637 7.86324 6.63646 7.99995 6.46777 8H1.5293C1.36059 7.99997 1.2207 7.86325 1.2207 7.69922C1.22098 7.53541 1.36076 7.39944 1.5293 7.39941H1.94043V7.2998C1.94043 6.85977 2.31111 6.49916 2.76367 6.49902H3.68945V5.58301C2.61632 5.47165 1.72387 4.79265 1.33301 3.85742C1.06154 3.75741 0.823027 3.59313 0.633789 3.40918C0.251107 2.99711 5.17542e-05 2.50479 0 1.92871C0 1.35256 0.465021 0.900396 1.05762 0.900391H1.28809C1.55558 0.368244 2.11541 0 2.76562 0H5.23438ZM4.24316 1.58398C4.10738 1.38014 3.89261 1.38011 3.75684 1.58398L3.53906 1.91211C3.50614 1.96412 3.43185 2.02013 3.37012 2.03613L2.97949 2.13281C2.74083 2.19284 2.67056 2.39701 2.83105 2.58105L3.08691 2.88477C3.12796 2.92885 3.15645 3.01723 3.15234 3.07715L3.12793 3.46875C3.11147 3.7088 3.28812 3.83311 3.51855 3.74512L3.89258 3.60059C3.95019 3.58058 4.04981 3.58058 4.10742 3.60059L4.48145 3.74512C4.7119 3.83314 4.88853 3.70882 4.87207 3.46875L4.84766 3.07715C4.84354 3.01713 4.87291 2.92878 4.91406 2.88477L5.16895 2.58105C5.32944 2.397 5.25919 2.19283 5.02051 2.13281L4.62988 2.03613C4.56815 2.02013 4.49386 1.96412 4.46094 1.91211L4.24316 1.58398Z" fill="#2F9DD4"></path>' +
      '</svg>';
    return icon;
  }

  function createCompactMoreButton() {
    var icon = createElement('span', 'phab-tournaments__card-compact-more');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      '<circle cx="4" cy="8" r="1.2" fill="currentColor"></circle>' +
      '<circle cx="8" cy="8" r="1.2" fill="currentColor"></circle>' +
      '<circle cx="12" cy="8" r="1.2" fill="currentColor"></circle>' +
      '</svg>';
    return icon;
  }

  function createCompactOrganizerAvatar(card) {
    var imageUrl = resolveTrainerAvatar(card);
    var organizerName = resolveTrainerLabel(card);
    var avatar = createElement('div', 'phab-tournaments__card-compact-organizer-avatar');

    if (imageUrl) {
      var img = document.createElement('img');
      configureLazyImage(img);
      img.src = imageUrl;
      img.alt = organizerName;
      avatar.appendChild(img);
      return avatar;
    }

    avatar.textContent = resolveInitials(organizerName);
    return avatar;
  }

  function createCompactProfileRow(card) {
    var profile = createElement('div', 'phab-tournaments__card-compact-profile');
    var main = createElement('div', 'phab-tournaments__card-compact-profile-main');
    var copy = createElement('div', 'phab-tournaments__card-compact-organizer-copy');

    appendChildren(copy, [
      createElement('p', 'phab-tournaments__card-compact-organizer-name', resolveTrainerLabel(card)),
      createElement('p', 'phab-tournaments__card-compact-organizer-handle', resolveProfileHandle(card))
    ]);

    appendChildren(main, [createCompactOrganizerAvatar(card), copy]);
    appendChildren(profile, [main, createCompactMoreButton()]);

    return profile;
  }

  function createCompactMetaIcon(kind) {
    var icon = createElement(
      'span',
      'phab-tournaments__card-compact-meta-icon phab-tournaments__card-compact-meta-icon--' + kind
    );
    var svgByKind = {
      calendar:
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
        '<path d="M8.63881 1H7.80547H4.19436L3.36102 0.999928C1.86102 1.13882 1.13324 2.06667 1.02213 3.39445C1.01102 3.55556 1.14435 3.68889 1.29991 3.68889H10.6999C10.861 3.68889 10.9944 3.55 10.9777 3.39445C10.8666 2.06667 10.1388 1.13889 8.63881 1Z" fill="#888889"></path>' +
        '<path d="M10.4445 4.24438H1.55556C1.25 4.24438 1 4.49438 1 4.79994V8.22217C1 9.88883 1.83333 10.9999 3.77778 10.9999H8.22223C10.1667 10.9999 11 9.88883 11 8.22217V4.79994C11 4.49438 10.75 4.24438 10.4445 4.24438ZM4.45 8.89439C4.42223 8.91661 4.39445 8.94439 4.36667 8.96106C4.33334 8.98328 4.3 8.99994 4.26667 9.01106C4.23334 9.02772 4.2 9.03883 4.16667 9.04439C4.12778 9.04994 4.09445 9.0555 4.05556 9.0555C3.98334 9.0555 3.91111 9.03883 3.84445 9.01106C3.77222 8.98328 3.71667 8.94439 3.66111 8.89439C3.56111 8.78883 3.5 8.64439 3.5 8.49994C3.5 8.3555 3.56111 8.21106 3.66111 8.1055C3.71667 8.0555 3.77222 8.01661 3.84445 7.98883C3.94445 7.94439 4.05556 7.93328 4.16667 7.9555C4.2 7.96106 4.23334 7.97217 4.26667 7.98883C4.3 7.99994 4.33334 8.01661 4.36667 8.03883C4.39445 8.06105 4.42223 8.08328 4.45 8.1055C4.55 8.21106 4.61111 8.3555 4.61111 8.49994C4.61111 8.64439 4.55 8.78883 4.45 8.89439ZM4.45 6.94994C4.34445 7.04994 4.2 7.11105 4.05556 7.11105C3.91111 7.11105 3.76667 7.04994 3.66111 6.94994C3.56111 6.84439 3.5 6.69994 3.5 6.5555C3.5 6.41105 3.56111 6.26661 3.66111 6.16105C3.81667 6.0055 4.06111 5.9555 4.26667 6.04439C4.33889 6.07216 4.4 6.11105 4.45 6.16105C4.55 6.26661 4.61111 6.41105 4.61111 6.5555C4.61111 6.69994 4.55 6.84439 4.45 6.94994ZM6.39445 8.89439C6.28889 8.99439 6.14445 9.0555 6 9.0555C5.85556 9.0555 5.71112 8.99439 5.60556 8.89439C5.50556 8.78883 5.44445 8.64439 5.44445 8.49994C5.44445 8.3555 5.50556 8.21106 5.60556 8.1055C5.81112 7.89994 6.18889 7.89994 6.39445 8.1055C6.49445 8.21106 6.55556 8.3555 6.55556 8.49994C6.55556 8.64439 6.49445 8.78883 6.39445 8.89439ZM6.39445 6.94994C6.36667 6.97216 6.33889 6.99439 6.31112 7.01661C6.27778 7.03883 6.24445 7.0555 6.21112 7.06661C6.17778 7.08328 6.14445 7.09439 6.11112 7.09994C6.07223 7.1055 6.03889 7.11105 6 7.11105C5.85556 7.11105 5.71112 7.04994 5.60556 6.94994C5.50556 6.84439 5.44445 6.69994 5.44445 6.5555C5.44445 6.41105 5.50556 6.26661 5.60556 6.16105C5.65556 6.11105 5.71667 6.07216 5.78889 6.04439C5.99445 5.9555 6.23889 6.0055 6.39445 6.16105C6.49445 6.26661 6.55556 6.41105 6.55556 6.5555C6.55556 6.69994 6.49445 6.84439 6.39445 6.94994ZM8.33889 6.94994C8.31112 6.97216 8.28334 6.99439 8.25556 7.01661C8.22223 7.03883 8.1889 7.0555 8.15556 7.06661C8.12223 7.08328 8.0889 7.09439 8.05556 7.09994C8.01667 7.1055 7.97778 7.11105 7.94445 7.11105C7.80001 7.11105 7.65556 7.04994 7.55001 6.94994C7.45001 6.84439 7.38889 6.69994 7.38889 6.5555C7.38889 6.41105 7.45001 6.26661 7.55001 6.16105C7.60556 6.11105 7.66112 6.07216 7.73334 6.04439C7.83334 5.99994 7.94445 5.98883 8.05556 6.01105C8.0889 6.01661 8.12223 6.02772 8.15556 6.04439C8.1889 6.0555 8.22223 6.07216 8.25556 6.09439C8.28334 6.11661 8.31112 6.13883 8.33889 6.16105C8.4389 6.26661 8.50001 6.41105 8.50001 6.5555C8.50001 6.69994 8.4389 6.84439 8.33889 6.94994Z" fill="#888889"></path>' +
        '</svg>',
      location:
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
        '<path d="M10.3081 4.22421C9.78322 1.91459 7.76855 0.874756 5.99884 0.874756C5.99884 0.874756 5.99884 0.874756 5.99384 0.874756C4.22912 0.874756 2.20945 1.90959 1.68454 4.21921C1.09963 6.79879 2.67938 8.98344 4.10914 10.3582C4.63906 10.8681 5.31895 11.1231 5.99884 11.1231C6.67873 11.1231 7.35862 10.8681 7.88353 10.3582C9.3133 8.98344 10.893 6.80379 10.3081 4.22421ZM5.99884 6.7288C5.12898 6.7288 4.42409 6.02392 4.42409 5.15406C4.42409 4.2842 5.12898 3.57932 5.99884 3.57932C6.8687 3.57932 7.57358 4.2842 7.57358 5.15406C7.57358 6.02392 6.8687 6.7288 5.99884 6.7288Z" fill="#888889"></path>' +
        '</svg>',
      level:
        '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
        '<rect x="1.25" y="6.6" width="2.1" height="4.15" rx="0.7" fill="currentColor"></rect>' +
        '<rect x="4.95" y="4.45" width="2.1" height="6.3" rx="0.7" fill="currentColor"></rect>' +
        '<rect x="8.65" y="2.3" width="2.1" height="8.45" rx="0.7" fill="currentColor"></rect>' +
        '</svg>',
      gender:
        '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
        '<path d="M4.50628 1C3.20251 1 2.14258 2.05993 2.14258 3.3637C2.14258 4.64259 3.1428 5.67764 4.44656 5.72242C4.48637 5.71745 4.52618 5.71745 4.55604 5.72242C4.56599 5.72242 4.57097 5.72242 4.58092 5.72242C4.5859 5.72242 4.5859 5.72242 4.59087 5.72242C5.86478 5.67764 6.865 4.64259 6.86998 3.3637C6.86998 2.05993 5.81005 1 4.50628 1Z" fill="#888889"></path>' +
        '<path d="M7.03117 7.04379C5.6428 6.11822 3.37863 6.11822 1.98031 7.04379C1.34833 7.46677 1 8.03903 1 8.65111C1 9.26318 1.34833 9.83047 1.97534 10.2485C2.67201 10.7162 3.58763 10.9501 4.50325 10.9501C5.41887 10.9501 6.3345 10.7162 7.03117 10.2485C7.65817 9.82549 8.0065 9.2582 8.0065 8.64115C8.00153 8.02908 7.65817 7.46179 7.03117 7.04379Z" fill="#888889"></path>' +
        '<path d="M9.97289 3.65736C10.0525 4.62274 9.36579 5.4687 8.41533 5.58315C8.41036 5.58315 8.41036 5.58315 8.40538 5.58315H8.39045C8.36059 5.58315 8.33074 5.58315 8.30586 5.5931C7.82316 5.61798 7.38028 5.46372 7.04688 5.18008C7.55942 4.72226 7.85302 4.03555 7.79331 3.28912C7.75847 2.88604 7.61914 2.5178 7.41014 2.2043C7.59923 2.10975 7.81819 2.05004 8.04212 2.03014C9.01745 1.94554 9.88829 2.67207 9.97289 3.65736Z" fill="#888889"></path>' +
        '<path d="M10.9673 8.26008C10.9275 8.74277 10.619 9.16077 10.1014 9.44441C9.60382 9.71811 8.97681 9.84749 8.35479 9.83256C8.71307 9.50911 8.92207 9.10603 8.96188 8.67808C9.01165 8.06103 8.71805 7.46886 8.13086 6.99612C7.79745 6.73238 7.40931 6.52338 6.98633 6.36912C8.08607 6.05064 9.46946 6.26462 10.3204 6.95133C10.7782 7.31957 11.0121 7.78236 10.9673 8.26008Z" fill="#888889"></path>' +
        '</svg>'
    };

    icon.innerHTML = svgByKind[kind] || '';
    return icon;
  }

  function createCompactMetaRow(kind, text, trailing) {
    var row = createElement(
      'div',
      'phab-tournaments__card-compact-meta phab-tournaments__card-compact-meta--' + kind
    );
    appendChildren(row, [
      createCompactMetaIcon(kind),
      text ? createElement('span', 'phab-tournaments__card-compact-meta-text', text) : null,
      trailing || null
    ]);
    return row;
  }

  function createCompactMetaNodeRow(kind, content, trailing) {
    var row = createElement(
      'div',
      'phab-tournaments__card-compact-meta phab-tournaments__card-compact-meta--' + kind
    );
    appendChildren(row, [
      createCompactMetaIcon(kind),
      content || null,
      trailing || null
    ]);
    return row;
  }

  function createCompactLocationMetaRow(card) {
    var row = createElement(
      'div',
      'phab-tournaments__card-compact-meta phab-tournaments__card-compact-meta--location'
    );
    appendChildren(row, [
      createCompactMetaIcon('location'),
      createCompactLocationLabel(card),
      createCompactCourtLabel(card)
    ]);
    return row;
  }

  function createCompactLocationLabel(card) {
    var mapUrl = resolveMapUrl(card);
    var location = resolveLocationLabel(card);

    if (!mapUrl) {
      return createElement('span', 'phab-tournaments__card-compact-meta-text', location);
    }

    var link = createElement('a', 'phab-tournaments__card-compact-meta-text phab-tournaments__card-compact-map', location);
    link.href = mapUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  function createCompactCourtLabel(card) {
    var label = resolveCourtLabel(card);
    return label ? createElement('span', 'phab-tournaments__card-compact-court', label) : null;
  }

  function createCompactCapacityBlock(card, descriptor) {
    var block = createElement('div', 'phab-tournaments__card-compact-capacity');
    var progress = createElement('div', 'phab-tournaments__card-compact-progress');
    var progressDescriptor = resolveProgressDescriptor(card);
    var filledSegments = progressDescriptor.filledSegments;
    var totalSegments = progressDescriptor.totalSegments;
    var index;

    for (index = 0; index < totalSegments; index += 1) {
      var segment = createElement('span', 'phab-tournaments__card-compact-progress-segment');
      if (index < filledSegments) {
        segment.className += ' is-filled';
      }
      progress.appendChild(segment);
    }

    block.appendChild(progress);
    block.appendChild(
      appendChildren(createElement('div', 'phab-tournaments__card-compact-capacity-texts'), [
        createElement('span', 'phab-tournaments__card-compact-capacity-value', formatParticipantsSummary(card)),
        createElement('span', 'phab-tournaments__card-compact-capacity-note', resolveRemainingSpotsLabel(descriptor))
      ])
    );
    return block;
  }

  function createCompactDateBadge(card) {
    var badge = createElement('div', 'phab-tournaments__card-compact-date-badge');
    appendChildren(badge, [
      createElement('span', 'phab-tournaments__card-compact-date-day', formatDateBadgeDay(card.startsAt)),
      createElement('span', 'phab-tournaments__card-compact-date-weekday', formatDateBadgeWeekday(card.startsAt))
    ]);
    return badge;
  }

  function createCompactFooterMetricIcon(kind) {
    var icon = createElement('span', 'phab-tournaments__card-compact-footer-icon');
    var svgByKind = {
      engagement:
        '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
        '<path d="M8 13.35L2.75 8.3C1.9 7.48 1.9 6.15 2.75 5.33C3.6 4.5 4.97 4.5 5.82 5.33L8 7.42L10.18 5.33C11.03 4.5 12.4 4.5 13.25 5.33C14.1 6.15 14.1 7.48 13.25 8.3L8 13.35Z" fill="currentColor"></path>' +
        '</svg>',
      waitlist:
        '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
        '<path d="M3.1 3.65H12.9C13.45 3.65 13.9 4.1 13.9 4.65V10.1C13.9 10.65 13.45 11.1 12.9 11.1H8.45L5.55 13.65V11.1H3.1C2.55 11.1 2.1 10.65 2.1 10.1V4.65C2.1 4.1 2.55 3.65 3.1 3.65Z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"></path>' +
        '</svg>'
    };

    icon.innerHTML = svgByKind[kind] || '';
    return icon;
  }

  function createCompactFooterMetric(kind, value, accent) {
    var metric = createElement(
      'div',
      'phab-tournaments__card-compact-footer-metric' + (accent ? ' is-accent' : '')
    );
    appendChildren(metric, [
      createCompactFooterMetricIcon(kind),
      createElement('span', '', String(Math.max(0, Number(value) || 0)))
    ]);
    return metric;
  }

  function createCompactFooter(card) {
    var footer = createElement('div', 'phab-tournaments__card-compact-footer');
    var metrics = createElement('div', 'phab-tournaments__card-compact-footer-metrics');

    appendChildren(metrics, [
      createCompactFooterMetric('engagement', card.participantsCount, true),
      createCompactFooterMetric('waitlist', card.waitlistCount, false)
    ]);

    footer.appendChild(metrics);

    return footer;
  }

  function createAvatar(card) {
    var imageUrl = resolveTrainerAvatar(card);
    var avatar = createElement('div', 'phab-tournaments__avatar');

    if (imageUrl) {
      var img = document.createElement('img');
      configureLazyImage(img);
      img.src = imageUrl;
      img.alt = resolveTrainerLabel(card);
      avatar.appendChild(img);
      return avatar;
    }

    avatar.textContent = resolveInitials(resolveTrainerLabel(card));
    return avatar;
  }

  function createTournamentChips(card, descriptor) {
    var chips = createElement('div', 'phab-tournaments__chips');
    var skin = normalizeObject(card.skin);
    var skinBadge = String(skin.badgeLabel || '').trim();
    var compactLevels = formatAccessLevelCompact(card.accessLevels);
    var genderLabel = formatGenderLabel(card.gender);

    if (skinBadge && skinBadge !== compactLevels) {
      chips.appendChild(createChip(skinBadge, 'phab-tournaments__chip--badge'));
    }

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

  function createCardStatusPill(card, descriptor) {
    if (descriptor.spotsLeft === 0) {
      return createMetricPill('Нет мест', 'phab-tournaments__metric-pill--danger');
    }

    if (descriptor.spotsLeft && descriptor.spotsLeft > 0 && descriptor.spotsLeft <= 2) {
      return createMetricPill(pluralizeSpots(descriptor.spotsLeft), 'phab-tournaments__metric-pill--hot');
    }

    if (descriptor.spotsLeft && descriptor.spotsLeft > 2) {
      return createMetricPill(pluralizeSpots(descriptor.spotsLeft), 'phab-tournaments__metric-pill--success');
    }

    if (descriptor.pillText) {
      var toneClass =
        descriptor.pillTone === 'success'
          ? ' phab-tournaments__metric-pill--success'
          : descriptor.pillTone === 'hot'
            ? ' phab-tournaments__metric-pill--hot'
            : descriptor.pillTone === 'danger'
              ? ' phab-tournaments__metric-pill--danger'
              : '';
      return createMetricPill(descriptor.pillText, toneClass);
    }

    return null;
  }

  function createStatsBlock(card) {
    var stats = createElement('div', 'phab-tournaments__stats');
    var players = createElement('div', 'phab-tournaments__players');
    var playersNote = formatGenderLabel(card.gender);

    players.appendChild(document.createTextNode(formatSpots(card)));
    if (playersNote) {
      players.appendChild(createElement('span', 'phab-tournaments__players-note', playersNote));
    }
    stats.appendChild(players);

    if (Number(card.waitlistCount) > 0) {
      stats.appendChild(createMetricPill('WL ' + String(card.waitlistCount)));
    }

    return stats;
  }

  function createTournamentCardBody(card, descriptor) {
    var body = createElement('div', 'phab-tournaments__card-body');
    var main = createElement('div', 'phab-tournaments__card-body-main');
    var status = createCardStatusPill(card, descriptor);
    var supportText = resolveTrainerLabel(card);

    body.appendChild(createAvatar(card));
    main.appendChild(createElement('p', 'phab-tournaments__card-support', supportText));
    main.appendChild(createStatsBlock(card));
    body.appendChild(main);

    if (status) {
      status.className += ' phab-tournaments__card-status';
      body.appendChild(status);
    }

    return body;
  }

  function createTournamentHeader(card) {
    var head = createElement('div', 'phab-tournaments__card-head');
    var titleRow = createElement('div', 'phab-tournaments__card-row');
    var titleWrap = createElement('div', 'phab-tournaments__card-title-wrap');
    var metaRow = createElement('div', 'phab-tournaments__card-row');
    var meta = createElement('div', 'phab-tournaments__card-meta');
    var typeLabel = String(card.tournamentType || 'Турнир').trim();

    titleWrap.appendChild(createElement('div', 'phab-tournaments__card-time', formatTime(card.startsAt)));
    titleWrap.appendChild(createElement('h3', 'phab-tournaments__card-title', resolveTitle(card)));
    titleRow.appendChild(titleWrap);
    titleRow.appendChild(createChip(typeLabel, 'phab-tournaments__chip--type'));

    meta.appendChild(createElement('div', 'phab-tournaments__duration', formatDurationLabel(card)));
    meta.appendChild(createElement('div', 'phab-tournaments__card-location', resolveLocationLabel(card)));
    metaRow.appendChild(meta);

    head.appendChild(titleRow);
    head.appendChild(metaRow);
    return head;
  }

  function createActionControl(card, action, state, mount) {
    var publicUrl = buildTournamentPublicUrl(state.config, card);
    var detailUrl = buildTournamentDetailUrl(state.config, card);
    var className =
      action.kind === 'secondary'
        ? 'phab-tournaments__button-secondary'
        : 'phab-tournaments__button';
    var control;

    control = createElement('button', className, action.label);
    control.type = 'button';
    control.disabled = !publicUrl && !detailUrl;
    control.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (publicUrl) {
        window.location.href = publicUrl;
        return;
      }
      openTournamentDetails(mount, state, card);
    });
    return control;
  }

  function isInteractiveTarget(target, scope) {
    if (!target || typeof target.closest !== 'function') {
      return false;
    }

    var interactive = target.closest('a, button, input, select, textarea, label, summary, [role="button"]');
    return Boolean(interactive && (!scope || scope.contains(interactive)));
  }

  function bindTournamentPreviewTrigger(node, mount, state, card) {
    if (!node) {
      return node;
    }

    node.className += ' phab-tournaments__entry--interactive';
    if (!node.hasAttribute('tabindex')) {
      node.tabIndex = 0;
    }
    node.addEventListener('click', function (event) {
      if (isInteractiveTarget(event.target, node)) {
        return;
      }
      openTournamentDetails(mount, state, card);
    });
    node.addEventListener('keydown', function (event) {
      if (event.defaultPrevented || isInteractiveTarget(event.target, node)) {
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openTournamentDetails(mount, state, card);
      }
    });

    return node;
  }

  function createCardModeActionControl(card, action, state, mount) {
    var control = createActionControl(card, action, state, mount);

    control.className = 'phab-tournaments__card-compact-cta';
    control.textContent = action.label;

    if (action.kind === 'secondary') {
      control.className += ' phab-tournaments__card-compact-cta--secondary';
    }

    if (action.mode === 'disabled') {
      control.className += ' phab-tournaments__card-compact-cta--disabled';
    }

    return control;
  }

  function createBallIcon() {
    var holder = createElement('span', 'phab-tournaments__premium-badge-ball');
    holder.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="10" fill="#E7F099"></circle>' +
      '<path d="M7.2 6.5C9.6 8.2 10.8 10.2 10.8 12C10.8 13.8 9.6 15.8 7.2 17.5" stroke="#6D56D7" stroke-width="1.6" stroke-linecap="round"></path>' +
      '<path d="M16.8 6.5C14.4 8.2 13.2 10.2 13.2 12C13.2 13.8 14.4 15.8 16.8 17.5" stroke="#6D56D7" stroke-width="1.6" stroke-linecap="round"></path>' +
      '</svg>';
    return holder;
  }

  function resolvePremiumTariffs(card) {
    var skin = normalizeObject(card.skin);
    var source = normalizeArray(skin.tariffs)
      .map(function (item) {
        var tariff = normalizeObject(item);
        return {
          title: String(tariff.title || '').trim(),
          price: String(tariff.price || '').trim()
        };
      })
      .filter(function (item) {
        return item.title && item.price;
      });

    if (source.length >= 2) {
      return source.slice(0, 2);
    }

    return [
      { title: 'Энергия 1', price: '5500 ₽' },
      { title: 'Энергия 5', price: '3960 ₽' }
    ];
  }

  function resolvePremiumAvailability(descriptor) {
    if (descriptor.spotsLeft === 0 || descriptor.key === 'full' || descriptor.key === 'closed') {
      return 'sold-out';
    }
    if (descriptor.spotsLeft > 0 && descriptor.spotsLeft <= 3) {
      return 'low-spots';
    }
    return 'normal';
  }

  function createPremiumCard(card, descriptor, action, state, mount) {
    var article = createElement('article', 'phab-tournaments__entry phab-tournaments__entry--premium');
    var availability = resolvePremiumAvailability(descriptor);
    var skin = normalizeObject(card.skin);
    var selectedTariffIndex = Number(skin.selectedTariffIndex);
    var tariffs = resolvePremiumTariffs(card);
    var metaSegments = [
      formatDurationLabel(card),
      resolveLocationLabel(card),
      formatAccessLevelCompact(card.accessLevels),
      formatGenderLabel(card.gender)
    ].filter(Boolean);
    var header = createElement('div', 'phab-tournaments__premium-head');
    var headerLeft = createElement('div', 'phab-tournaments__premium-head-left');
    var badge = createElement('div', 'phab-tournaments__premium-badge');
    var organizer = createElement('div', 'phab-tournaments__premium-organizer');
    var organizerName = resolveTrainerLabel(card);
    var meta = createElement('div', 'phab-tournaments__premium-meta', metaSegments.join(' • '));
    var tariffsWrap = createElement('div', 'phab-tournaments__premium-tariffs');
    var ctaLabel = action && action.label ? action.label : 'Записаться';
    var cta = createActionControl(card, action, state, mount);
    var ctaSuffix = availability === 'sold-out' ? ' • Sold out' : ' • ' + pluralizeSpots(descriptor.spotsLeft || 0);

    if (availability === 'sold-out') {
      article.className += ' is-sold-out';
    } else if (availability === 'low-spots') {
      article.className += ' is-low-spots';
    }

    headerLeft.appendChild(createElement('div', 'phab-tournaments__premium-time', formatTime(card.startsAt)));
    headerLeft.appendChild(createElement('h3', 'phab-tournaments__premium-title', resolveTitle(card)));
    header.appendChild(headerLeft);

    badge.appendChild(createBallIcon());
    badge.appendChild(createElement('span', null, card.tournamentType || 'Американо'));
    header.appendChild(badge);

    organizer.appendChild(createElement('div', 'phab-tournaments__premium-avatar', resolveInitials(organizerName)));
    organizer.appendChild(createElement('p', 'phab-tournaments__premium-organizer-name', organizerName));

    appendChildren(article, [
      header,
      meta,
      createElement('div', 'phab-tournaments__premium-divider'),
      organizer,
      createElement('div', 'phab-tournaments__premium-divider'),
      tariffsWrap
    ]);

    tariffs.forEach(function (tariff, index) {
      var tariffCard = createElement('div', 'phab-tournaments__premium-tariff');
      if (Number.isFinite(selectedTariffIndex) && index === Math.max(0, Math.min(1, Math.floor(selectedTariffIndex)))) {
        tariffCard.className += ' is-selected';
      }
      tariffCard.appendChild(createElement('div', 'phab-tournaments__premium-tariff-title', tariff.title));
      tariffCard.appendChild(createElement('div', 'phab-tournaments__premium-tariff-price', tariff.price));
      tariffsWrap.appendChild(tariffCard);
    });

    cta.className = cta.tagName === 'A' ? 'phab-tournaments__premium-cta' : 'phab-tournaments__premium-cta';
    cta.textContent = ctaLabel + ctaSuffix;
    article.appendChild(cta);

    return bindTournamentPreviewTrigger(article, mount, state, card);
  }

  function createScheduleCard(card, state, mount) {
    var descriptor = resolveTournamentState(card);
    var action = resolveAction(card, descriptor);
    var article = createElement('article', 'phab-tournaments__entry phab-tournaments__entry--schedule');
    var metaBundle = createElement('div', 'phab-tournaments__schedule-cell phab-tournaments__schedule-meta-bundle');
    var actionControl = createActionControl(card, action, state, mount);

    actionControl.className =
      (action.kind === 'secondary'
        ? 'phab-tournaments__button-secondary'
        : 'phab-tournaments__button')
      + ' phab-tournaments__schedule-cta';
    actionControl.textContent = action.label;

    appendChildren(metaBundle, [
      createAccessLevelCompactNode(card.accessLevels),
      createElement('div', 'phab-tournaments__schedule-type', card.tournamentType || 'Турнир'),
      createElement('div', 'phab-tournaments__schedule-gender', formatGenderLabel(card.gender) || '—')
    ]);

    appendChildren(article, [
      createScheduleTimeCell(card),
      createAvatar(card),
      createElement('h3', 'phab-tournaments__schedule-cell phab-tournaments__schedule-title', resolveTitle(card)),
      metaBundle,
      createElement('div', 'phab-tournaments__schedule-cell phab-tournaments__schedule-trainer', resolveTrainerLabel(card)),
      createElement('div', 'phab-tournaments__schedule-cell phab-tournaments__schedule-location', resolveLocationLabel(card)),
      createElement('div', 'phab-tournaments__schedule-cell phab-tournaments__schedule-spots', formatSpots(card)),
      appendChildren(createElement('div', 'phab-tournaments__schedule-cell'), [actionControl])
    ]);
    return bindTournamentPreviewTrigger(article, mount, state, card);
  }

  function createScheduleTimeCell(card) {
    var cell = createElement('div', 'phab-tournaments__schedule-cell phab-tournaments__schedule-time');
    var start = parseDate(card.startsAt);
    var end = parseDate(card.endsAt);

    if (!start) {
      cell.appendChild(createElement('span', null, 'Скоро'));
      return cell;
    }

    cell.appendChild(createElement('span', null, formatTime(start)));
    if (end) {
      cell.appendChild(createElement('span', null, formatTime(end)));
    }
    return cell;
  }

  function createScheduleHeaderRow() {
    var row = createElement('div', 'phab-tournaments__schedule-header');
    [
      'Время',
      '',
      'Турнир',
      'Уровень / тип / пол',
      'Тренер',
      'Площадка',
      'Места',
      ''
    ].forEach(function (label) {
      row.appendChild(createElement('div', 'phab-tournaments__schedule-header-cell', label));
    });
    return row;
  }

  function createCardModeCard(card, state, mount) {
    var descriptor = resolveTournamentState(card);
    var action = resolveAction(card, descriptor);
    var article = createElement('article', 'phab-tournaments__entry phab-tournaments__entry--card');
    var surface = createElement('div', 'phab-tournaments__card-compact-surface');
    var header = createElement('div', 'phab-tournaments__card-compact-head');
    var heading = createElement('div', 'phab-tournaments__card-compact-heading');
    var badge = createElement('div', 'phab-tournaments__card-compact-badge');
    var badgeText = createElement('span', 'phab-tournaments__card-compact-badge-text', resolveCardBadgeLabel(card));
    var price = createElement('div', 'phab-tournaments__card-compact-price');
    var genderLabel = formatGenderCardLabel(card.gender);
    var info = createElement('div', 'phab-tournaments__card-compact-info');

    appendChildren(badge, [createCompactBadgeIcon(), badgeText]);
    appendChildren(heading, [
      badge,
      createElement('h3', 'phab-tournaments__card-compact-title', resolveTitle(card))
    ]);
    price.appendChild(
      createElement('span', 'phab-tournaments__card-compact-price-value', resolveCardPriceLabel(card))
    );
    appendChildren(header, [heading, createCompactDateBadge(card)]);

    appendChildren(info, [
      createCompactMetaRow('calendar', formatCardScheduleLabel(card)),
      createCompactLocationMetaRow(card),
      createCompactMetaNodeRow('level', createAccessLevelTextNode(card.accessLevels)),
      genderLabel ? createCompactMetaRow('gender', genderLabel, price) : null
    ]);

    appendChildren(surface, [
      header,
      info,
      createCompactCapacityBlock(card, descriptor),
      createCardModeActionControl(card, action, state, mount)
    ]);

    appendChildren(article, [
      createCompactProfileRow(card),
      surface,
      createCompactFooter(card)
    ]);

    return bindTournamentPreviewTrigger(article, mount, state, card);
  }

  function selectDay(mount, state, dayKey, dayGroups) {
    var nextDayKey = String(dayKey || '').trim();
    if (!nextDayKey) {
      return;
    }

    scheduleDayRailShift(mount, state, dayGroups || state.dayGroups || [], nextDayKey);
    state.selectedDayKey = nextDayKey;

    if (shouldLoadDayOnDemand(state, nextDayKey)) {
      loadTournaments(mount, state, { dateKey: nextDayKey });
      return;
    }

    renderTournaments(mount, state.payload, state);
  }

  function createDayButton(group, state, mount) {
    var button = createElement('button', 'phab-tournaments__day', null);
    var isActive = group.key === state.selectedDayKey;

    button.type = 'button';
    button.className += isActive ? ' is-active' : '';
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    button.setAttribute('aria-label', group.headline);
    appendChildren(button, [
      createElement('span', 'phab-tournaments__day-weekday', group.weekday),
      createElement('span', 'phab-tournaments__day-month', group.month),
      createElement('span', 'phab-tournaments__day-date', group.dayNumber)
    ]);

    button.addEventListener('click', function () {
      selectDay(mount, state, group.key, state.dayGroups || []);
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
        selectDay(mount, state, dayGroups[nextIndex].key, dayGroups);
      }
    });
    return button;
  }

  function createToolbar(mount, state, dayGroups) {
    var toolbar = createElement('div', 'phab-tournaments__toolbar');
    var row = createElement('div', 'phab-tournaments__toolbar-row');
    var daysPanel = createElement('div', 'phab-tournaments__days-panel');
    var rail = createElement('div', 'phab-tournaments__day-rail');
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

    row.appendChild(daysPanel);
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

    copy.appendChild(createElement('p', 'phab-tournaments__eyebrow', 'Турнирное расписание'));
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
        + (state.detailItem || state.flow || state.outcome || state.authPending ? ' is-open' : '')
    );

    if (!state.detailItem && !state.flow && !state.outcome && !state.authPending) {
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

    if (state.detailItem && !state.flow && !state.outcome && !state.authPending) {
      backdrop.appendChild(createTournamentDetailDialog(mount, state, state.detailItem));
      return backdrop;
    }

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
        : flow.code === 'READY_TO_JOIN' || flow.code === 'SUBSCRIPTION_AVAILABLE'
          ? 'success'
          : 'info';
    var actionLabel =
      flow.code === 'PHONE_VERIFICATION_REQUIRED'
        ? 'Подтвердить код'
        : flow.code === 'SUBSCRIPTION_AVAILABLE'
          ? 'Списать и записаться'
          : flow.code === 'PURCHASE_REQUIRED'
            ? 'Перейти к оплате'
            : flow.code === 'READY_TO_JOIN'
              ? normalizeObject(flowTournament.skin).ctaLabel || 'Подтвердить участие'
              : flow.code === 'LEVEL_NOT_ALLOWED'
                ? 'Проверить ещё раз'
                : 'Продолжить';
    var payment = normalizeObject(flow.payment);

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

    var phoneField = createElement('label', 'phab-tournaments__field');
    phoneField.appendChild(document.createTextNode('Телефон'));
    var phoneInput = document.createElement('input');
    phoneInput.name = 'phone';
    phoneInput.type = 'tel';
    phoneInput.placeholder = '+7 999 123-45-67';
    phoneInput.value = state.draft.phone || '';
    phoneField.appendChild(phoneInput);
    dialog.appendChild(phoneField);

    if (flow.code === 'PHONE_VERIFICATION_REQUIRED') {
      var codeField = createElement('label', 'phab-tournaments__field');
      codeField.appendChild(document.createTextNode('Код из SMS'));
      var codeInput = document.createElement('input');
      codeInput.name = 'authCode';
      codeInput.type = 'text';
      codeInput.inputMode = 'numeric';
      codeInput.autocomplete = 'one-time-code';
      codeInput.placeholder = 'Введите код';
      codeInput.value = state.draft.authCode || '';
      codeField.appendChild(codeInput);
      dialog.appendChild(codeField);
      if (state.phoneVerificationMessage) {
        dialog.appendChild(
          createElement(
            'p',
            'phab-tournaments__footnote',
            state.phoneVerificationMessage
          )
        );
      }
    }

    if (needsLevel) {
      var levelField = createElement('label', 'phab-tournaments__field');
      levelField.appendChild(document.createTextNode('Уровень игрока'));
      var levelSelect = document.createElement('select');
      levelSelect.name = 'levelLabel';
      var placeholderOption = document.createElement('option');
      placeholderOption.value = '';
      placeholderOption.textContent = 'Выберите уровень';
      levelSelect.appendChild(placeholderOption);
      var selectedLevelToken = normalizeLevelToken(state.draft.levelLabel);
      LEVEL_OPTIONS.forEach(function (level) {
        var option = document.createElement('option');
        option.value = level.token;
        option.textContent = level.base + ' · ' + level.token;
        if (selectedLevelToken === level.token) {
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

    if (flow.code === 'SUBSCRIPTION_AVAILABLE' && normalizeArray(payment.availableSubscriptions).length > 0) {
      var subscriptionField = createElement('label', 'phab-tournaments__field');
      subscriptionField.appendChild(document.createTextNode('Способ записи'));
      var subscriptionSelect = document.createElement('select');
      subscriptionSelect.name = 'selectedSubscriptionId';
      normalizeArray(payment.availableSubscriptions).forEach(function (item) {
        var subscription = normalizeObject(item);
        var option = document.createElement('option');
        option.value = String(subscription.id || '');
        option.textContent = String(subscription.label || 'Абонемент');
        if (state.draft.selectedSubscriptionId === option.value) {
          option.selected = true;
        }
        subscriptionSelect.appendChild(option);
      });
      subscriptionField.appendChild(subscriptionSelect);
      dialog.appendChild(subscriptionField);
    }

    if (flow.code === 'PURCHASE_REQUIRED' && normalizeArray(payment.purchaseOptions).length > 0) {
      var purchaseField = createElement('div', 'phab-tournaments__field');
      purchaseField.appendChild(document.createTextNode('Доступные тарифы'));
      var purchaseList = createElement('div', 'phab-tournaments__dialog-actions');
      normalizeArray(payment.purchaseOptions).forEach(function (item) {
        var purchase = normalizeObject(item);
        var purchaseId = String(purchase.id || '').trim();
        if (!purchaseId) {
          return;
        }
        var purchaseButton = createElement(
          'button',
          'phab-tournaments__button-secondary',
          [purchase.label, purchase.priceLabel].filter(Boolean).join(' · ')
        );
        purchaseButton.type = 'button';
        purchaseButton.addEventListener('click', function () {
          readDraftFromDialog(dialog, state);
          state.draft.selectedPurchaseOptionId = purchaseId;
          startDirectVivaPurchase(mount, state, purchase);
        });
        purchaseList.appendChild(purchaseButton);
      });
      purchaseField.appendChild(purchaseList);
      dialog.appendChild(purchaseField);
    }

    var actions = createElement('div', 'phab-tournaments__dialog-actions');
    var primaryButton = createElement('button', 'phab-tournaments__button', actionLabel);
    var secondaryButton = createElement(
      'button',
      'phab-tournaments__button-secondary',
      flow.code === 'LEVEL_NOT_ALLOWED' && flow.waitlistAllowed ? 'В лист ожидания' : 'Закрыть'
    );

    if (flow.code !== 'PURCHASE_REQUIRED') {
      primaryButton.type = 'button';
      primaryButton.addEventListener('click', function () {
        readDraftFromDialog(dialog, state);
        submitJoin(mount, state, false);
      });
    }

    secondaryButton.type = 'button';
    if (flow.code === 'LEVEL_NOT_ALLOWED' && flow.waitlistAllowed) {
      secondaryButton.addEventListener('click', function () {
        readDraftFromDialog(dialog, state);
        submitJoin(mount, state, true);
      });
    } else {
      secondaryButton.addEventListener('click', function () {
        if (flow.code === 'LEVEL_NOT_ALLOWED' && !flow.waitlistAllowed) {
          window.location.href = buildLevelFallbackUrl(state);
          return;
        }
        closeDialog(mount, state);
      });
    }

    if (flow.code === 'PHONE_VERIFICATION_REQUIRED') {
      var resendButton = createElement(
        'button',
        'phab-tournaments__button-secondary',
        'Отправить код повторно'
      );
      resendButton.type = 'button';
      resendButton.addEventListener('click', function () {
        readDraftFromDialog(dialog, state);
        state.draft.authCode = '';
        submitJoin(mount, state, false);
      });
      startSmsResendTimer(resendButton, state);
      actions.appendChild(resendButton);
    }

    if (flow.code !== 'PURCHASE_REQUIRED') {
      actions.appendChild(primaryButton);
    }
    if (flow.code === 'LEVEL_NOT_ALLOWED' && !flow.waitlistAllowed) {
      secondaryButton.textContent = 'Подобрать турнир по уровню';
    }
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
      filterVisibleItems(
        normalizeArray(response.items).map(function (entry) {
          return normalizeObject(entry);
        }),
        state.config.includePast,
        state.config.forwardDays
      )
    );
    syncResponsiveViewMode(state);
    var dayGroups = buildDayGroups(
      items,
      state.config.includePast,
      state.config.forwardDays
    );
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
      shell.appendChild(createToolbar(mount, state, dayGroups));
    }

    if (!selectedGroup || selectedGroup.items.length === 0) {
      board.appendChild(
        createStatusCard(
          'Пока нет доступных турниров',
          selectedGroup
            ? 'ищем подходящие турниры на выбранную дату'
            : 'Проверьте фильтры stationId/includePast или убедитесь, что у турниров есть public URL.'
        )
      );
    } else {
      var heading = createElement('div', 'phab-tournaments__day-heading');
      heading.appendChild(
        createElement('h3', 'phab-tournaments__day-title', selectedGroup.headline)
      );
      board.appendChild(heading);

      collection = createElement(
        'div',
        'phab-tournaments__collection phab-tournaments__collection--' + state.viewMode
      );

      if (state.viewMode === 'schedule') {
        collection.appendChild(createScheduleHeaderRow());
      }

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
    shiftDayRail(mount, state);
  }

  function renderLoading(mount) {
    mount.innerHTML = '';
    mount.appendChild(
      createStatusCard(
        'Загружаем турниры',
        'ищем подходящие турниры на выбранную дату'
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
    var payment = normalizeObject(response.payment);
    if (response.code === 'PURCHASE_STARTED' && payment.checkoutUrl) {
      window.location.assign(String(payment.checkoutUrl));
      return;
    }
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
    state.detailItem = null;

    if (flow.code === 'AUTH_REQUIRED' && flow.authUrl) {
      startAuthPolling(mount, state, flow);
      return;
    }

    clearAuth(state);
    if (
      flow.code === 'PURCHASE_REQUIRED'
      && state.vivaAuthorizationHeader
      && state.draft.selectedPurchaseOptionId
    ) {
      var directPurchase = normalizeArray(normalizeObject(flow.payment).purchaseOptions).find(function (item) {
        return String(normalizeObject(item).id || '').trim() === state.draft.selectedPurchaseOptionId;
      });
      if (directPurchase) {
        state.flow = flow;
        startDirectVivaPurchase(mount, state, directPurchase);
        return;
      }
    }
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

  function openTournamentDetails(mount, state, item) {
    var requestKey = String(
      (item && (item.slug || item.id || item.publicUrl || item.joinUrl)) || Date.now()
    );
    var detailUrl = buildTournamentDetailUrl(state.config, item);
    state.detailItem = item;
    state.activeItem = item;
    state.activeJoinUrl = resolveUrl(item.joinUrl, state.config);
    state.detailRequestKey = requestKey;
    state.outcome = null;
    state.flow = null;
    state.draft.authCode = '';
    state.draft.selectedSubscriptionId = '';
    state.draft.selectedPurchaseOptionId = '';
    state.vivaAuthorizationHeader = '';
    clearAuth(state);
    renderTournaments(mount, state.payload, state);

    if (!detailUrl) {
      return;
    }

    jsonFetch(detailUrl, {
      cache: 'no-store',
      credentials: state.crossOriginApi ? 'omit' : 'include'
    })
      .then(function (freshItem) {
        if (
          !state.detailItem ||
          state.detailRequestKey !== requestKey ||
          state.flow ||
          state.outcome ||
          state.authPending
        ) {
          return;
        }
        state.detailItem = freshItem;
        state.activeItem = freshItem;
        state.activeJoinUrl = resolveUrl(freshItem.joinUrl || item.joinUrl, state.config);
        state.payload = mergeTournamentPayload(state.payload, { items: [freshItem] });
        renderTournaments(mount, state.payload, state);
      })
      .catch(function () {
        // Keep the already opened card if a fresh Viva-backed read is temporarily unavailable.
      });
  }

  function openJoinFlow(mount, state, item, joinUrl) {
    if (!joinUrl) {
      return;
    }

    state.detailItem = null;
    state.detailRequestKey = '';
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
      authCode: state.draft.authCode,
      selectedSubscriptionId: state.draft.selectedSubscriptionId,
      selectedPurchaseOptionId: state.draft.selectedPurchaseOptionId,
      directViva: state.draft.selectedPurchaseOptionId ? '1' : '0',
      purchaseConfirmed:
        state.flow && (
          state.flow.code === 'PURCHASE_REQUIRED'
          || (state.flow.code === 'PHONE_VERIFICATION_REQUIRED' && state.draft.selectedPurchaseOptionId)
        )
          ? '1'
          : '0',
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

  function startDirectVivaPurchase(mount, state, purchaseOption) {
    var flow = normalizeObject(state.flow);
    var tournament = normalizeObject(flow.tournament);
    var booking = normalizeObject(tournament.booking);
    var widgetId = String(booking.vivaWidgetId || 'iSkq6G').trim();
    var exerciseId = String(booking.vivaExerciseId || '').trim();
    var studioId = String(booking.vivaStudioId || '').trim();
    var purchase = normalizeObject(purchaseOption);
    var productId = String(purchase.id || state.draft.selectedPurchaseOptionId || '').trim();
    var productType = normalizeVivaTransactionProductType(purchase.productType);
    var productName = String(purchase.label || '').trim();

    if (!widgetId || !exerciseId || !studioId || !productId) {
      state.outcome = {
        ok: false,
        message: 'Не хватает данных Viva для покупки участия.'
      };
      renderTournaments(mount, state.payload, state);
      return;
    }

    createVivaTransaction({
      widgetId: widgetId,
      exerciseId: exerciseId,
      studioId: studioId,
      productId: productId,
      productName: productType === 'SERVICE' ? productName : '',
      productType: productType,
      phone: state.draft.phone,
      authorizationHeader: state.vivaAuthorizationHeader,
      successUrl: buildPaymentReturnUrl(exerciseId, 'TorneosPADL_paymentsuccess'),
      failUrl: buildPaymentReturnUrl(exerciseId, 'TorneosPADL_paymentfailed')
    })
      .then(function (transaction) {
        var transactionId = findVivaTransactionId(transaction);
        var checkoutUrl = findVivaCheckoutUrl(transaction);
        if (!transactionId || !checkoutUrl) {
          throw new Error('Viva не вернула ссылку оплаты или номер транзакции.');
        }
        return formFetch(state.activeJoinUrl, {
          format: 'json',
          name: state.draft.name,
          phone: state.draft.phone,
          levelLabel: state.draft.levelLabel,
          notes: state.draft.notes,
          selectedPurchaseOptionId: state.draft.selectedPurchaseOptionId,
          directTransactionId: transactionId,
          directCheckoutUrl: checkoutUrl,
          purchaseConfirmed: '1',
          waitlist: '0'
        });
      })
      .then(function (payload) {
        handleJoinResponse(mount, state, payload);
      })
      .catch(function (error) {
        if (error && error.status === 401) {
          state.vivaAuthorizationHeader = '';
          formFetch(state.activeJoinUrl, {
            format: 'json',
            name: state.draft.name,
            phone: state.draft.phone,
            levelLabel: state.draft.levelLabel,
            notes: state.draft.notes,
            selectedPurchaseOptionId: state.draft.selectedPurchaseOptionId,
            directViva: '1',
            forceAuthCode: '1',
            purchaseConfirmed: '1',
            waitlist: '0'
          })
            .then(function (payload) {
              handleJoinResponse(mount, state, payload);
            })
            .catch(function (retryError) {
              state.outcome = {
                ok: false,
                message: 'Не удалось запросить авторизацию Viva: ' + retryError.message
              };
              renderTournaments(mount, state.payload, state);
            });
          return;
        }
        state.outcome = {
          ok: false,
          message: 'Не удалось создать оплату Viva: ' + error.message
        };
        renderTournaments(mount, state.payload, state);
      });
  }

  function createVivaTransaction(options) {
    var url = new URL(
      '/end-user/api/v1/' + encodeURIComponent(options.widgetId) + '/transactions',
      VIVA_API_BASE_URL + '/'
    );
    var payload = {
      products: [
        {
          id: options.productId,
          ...(options.productName ? { name: options.productName } : {}),
          type: options.productType,
          count: 1,
          bookingRequests: [
            {
              exerciseId: options.exerciseId,
              client: null,
              comment: null,
              marketingAttribution: {}
            }
          ]
        }
      ],
      clientPhone: String(options.phone || '').replace(/\D+/g, ''),
      paymentMethod: 'WIDGET',
      successUrl: options.successUrl,
      failUrl: options.failUrl,
      exerciseId: options.exerciseId,
      studioId: options.studioId,
      promoCode: null
    };

    return fetch(url.toString(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.authorizationHeader ? { Authorization: options.authorizationHeader } : {})
      },
      credentials: 'include',
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json().catch(function () {
        return {};
      }).then(function (payload) {
        if (!response.ok) {
          var error = new Error(String(payload.message || payload.error || 'status ' + response.status));
          error.status = response.status;
          throw error;
        }
        return payload;
      });
    });
  }

  function normalizeVivaTransactionProductType(value) {
    return String(value || '').toUpperCase() === 'SUBSCRIPTION' ? 'SUBSCRIPTION' : 'SERVICE';
  }

  function buildPaymentReturnUrl(exerciseId, flag) {
    var url = new URL('https://padlhub.ru/padel_torneos');
    url.searchParams.set('TorneosPADL_exercise', exerciseId);
    url.searchParams.set(flag, 'true');
    return url.toString();
  }

  function findVivaCheckoutUrl(payload) {
    return findFirstMatchingString(payload, function (key, value) {
      var normalizedKey = String(key || '').toLowerCase().replace(/[\s-]+/g, '_');
      if (!/^https?:\/\//i.test(value)) {
        return false;
      }
      if (/(success|fail|return|callback|webhook|cancel)/i.test(normalizedKey)) {
        return false;
      }
      return /(payment|checkout|redirect|confirmation|form|pay).*(url|link)/i.test(key)
        || /(url|link).*(payment|checkout|redirect|confirmation|form|pay)/i.test(key);
    });
  }

  function findVivaTransactionId(payload) {
    return findFirstMatchingString(payload, function (key, value) {
      var normalizedKey = String(key || '').toLowerCase().replace(/[\s-]+/g, '_');
      return Boolean(value) && /^(id|transactionid|transaction_id|orderid|order_id)$/.test(normalizedKey);
    });
  }

  function findFirstMatchingString(value, matches, key, seen) {
    var currentKey = key || '';
    var visited = seen || [];
    if (typeof value === 'string' && value.trim() && matches(currentKey, value.trim())) {
      return value.trim();
    }
    if (!value || typeof value !== 'object' || visited.indexOf(value) >= 0) {
      return '';
    }
    visited.push(value);

    if (Array.isArray(value)) {
      for (var index = 0; index < value.length; index += 1) {
        var arrayFound = findFirstMatchingString(value[index], matches, currentKey, visited);
        if (arrayFound) {
          return arrayFound;
        }
      }
      return '';
    }

    var keys = Object.keys(value);
    for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      var childKey = keys[keyIndex];
      var found = findFirstMatchingString(value[childKey], matches, childKey, visited);
      if (found) {
        return found;
      }
    }
    return '';
  }

  function loadTournaments(mount, state, options) {
    var loadOptions = options || {};
    var forwardDays = normalizePositiveInteger(loadOptions.forwardDays, state.config.forwardDays);
    var dateKey = String(loadOptions.dateKey || '').trim();
    var requestOptions = { forwardDays: forwardDays };
    var isDayRequest = isValidDayKey(dateKey);
    var retriesLeft = DIRECTORY_REQUEST_RETRY_COUNT;
    if (isDayRequest) {
      requestOptions.dateKey = dateKey;
      if (state.loadingDayKeys[dateKey]) {
        return Promise.resolve(state.payload);
      }
      state.loadingDayKeys[dateKey] = true;
    }
    if (!loadOptions.background) {
      renderLoading(mount);
    }

    function applyPayload(payload) {
      if (isDayRequest) {
        state.loadingDayKeys[dateKey] = false;
        state.loadedDayKeys[dateKey] = true;
        state.payload = mergeTournamentPayloadForDay(state.payload, payload, dateKey);
        renderTournaments(mount, state.payload, state);
        return;
      }
      state.loadedForwardDays = forwardDays;
      state.payload = payload;
      state.loadedDayKeys = {};
      markLoadedDaysFromPayload(state, payload);
      renderTournaments(mount, payload, state);
    }

    function finalizeWithError(error) {
      if (isDayRequest) {
        state.loadingDayKeys[dateKey] = false;
      }
      if (!loadOptions.background) {
        renderError(mount, 'Проверьте доступность каталога турниров: ' + error.message);
      }
    }

    function attemptLoad() {
      return jsonFetchWithTimeout(
        buildRequestUrl(state.config, requestOptions),
        {
          credentials: state.crossOriginApi ? 'omit' : 'include'
        },
        DIRECTORY_REQUEST_TIMEOUT_MS
      )
        .then(applyPayload)
        .catch(function (error) {
          if (retriesLeft > 0 && shouldRetryDirectoryRequest(error)) {
            retriesLeft -= 1;
            return attemptLoad();
          }
          finalizeWithError(error);
        });
    }

    return attemptLoad();
  }

  function readConfig(mount) {
    var dataset = mount.dataset || {};

    return {
      apiBaseUrl: normalizeApiBaseUrl(dataset.apiBase || DEFAULTS.apiBaseUrl),
      stationIds: normalizeCsv(dataset.stationIds || ''),
      limit: normalizePositiveInteger(dataset.limit, DEFAULTS.limit),
      initialForwardDays: normalizePositiveInteger(
        dataset.initialForwardDays || dataset.initialDays,
        DEFAULTS.initialForwardDays
      ),
      forwardDays: normalizePositiveInteger(dataset.forwardDays, DEFAULTS.forwardDays),
      includePast: normalizeBoolean(dataset.includePast),
      refreshMs: normalizeRefreshMs(dataset.refreshMs),
      variant: String(dataset.variant || DEFAULTS.variant).trim() || DEFAULTS.variant,
      title: String(dataset.title || DEFAULTS.title).trim(),
      subtitle: String(dataset.subtitle || DEFAULTS.subtitle).trim()
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
      viewMode: getDefaultViewMode(),
      draft: {
        name: '',
        phone: '',
        levelLabel: '',
        notes: '',
        authCode: '',
        selectedSubscriptionId: '',
        selectedPurchaseOptionId: ''
      },
      vivaAuthorizationHeader: '',
      phoneVerificationMessage: '',
      smsResendAvailableAt: 0,
      activeJoinUrl: '',
      activeItem: null,
      detailItem: null,
      detailRequestKey: '',
      flow: null,
      outcome: null,
      authPending: null,
      authTimer: 0,
      reloadOnClose: false,
      loadedForwardDays: config.initialForwardDays,
      loadedDayKeys: {},
      loadingDayKeys: {},
      dayRailScrollLeft: 0,
      dayRailShiftDirection: 0,
      dayRailShiftPending: false
    };

    mount.__phabTournamentsInitialized = true;
    mount.__phabTournamentsState = state;
    loadTournaments(mount, state, { forwardDays: config.initialForwardDays });

    if (config.refreshMs > 0) {
      mount.__phabTournamentsRefreshTimer = window.setInterval(function () {
        if (!mount.__phabTournamentsDestroyed && isValidDayKey(state.selectedDayKey)) {
          loadTournaments(mount, state, {
            dateKey: state.selectedDayKey,
            background: true
          });
          return;
        }
        loadTournaments(mount, state, {
          forwardDays: config.initialForwardDays,
          background: true
        });
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
