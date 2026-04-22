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
    style.textContent = `
      @font-face {
        font-family: "RF Dewi UltraBold";
        src: url("https://padlhub.su/lk/fonts/rf-dewi-ultrabold.ttf") format("truetype");
        font-weight: 800;
        font-style: normal;
        font-display: swap;
      }

      @font-face {
        font-family: "RF Dewi Expanded UltraBold Italic";
        src: url("https://padlhub.su/lk/fonts/rf-dewi-expanded-ultrabold-italic.ttf") format("truetype");
        font-weight: 800;
        font-style: italic;
        font-display: swap;
      }

      @font-face {
        font-family: "Source Code Pro";
        src: url("https://padlhub.su/lk/fonts/SourceCodePro-Medium.ttf") format("truetype");
        font-weight: 500;
        font-style: normal;
        font-display: swap;
      }

      @font-face {
        font-family: "Source Code Pro Regular";
        src: url("https://padlhub.su/lk/fonts/SourceCodePro-Regular.ttf") format("truetype");
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }

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
        --ph-tournament-display-font: "RF Dewi UltraBold", "Source Code Pro", "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --ph-tournament-button-font: "RF Dewi Expanded UltraBold Italic", "RF Dewi UltraBold", "Source Code Pro", "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --ph-tournament-time-font: "Source Code Pro Regular", "Source Code Pro", "Roboto", "Roboto Flex", "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --ph-tournament-ui-font: "Inter Display", "Inter", "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --ph-tournament-card-title-font: "RF Dewi UltraBold", "Inter Display", "Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
        gap: 14px;
        padding: 16px;
        border-radius: 20px;
      }

      .phab-tournaments__toolbar-row {
        display: grid;
        gap: 14px;
      }

      .phab-tournaments__days-panel {
        display: flex;
        gap: 12px;
        align-items: center;
        min-width: 0;
        width: 100%;
      }

      .phab-tournaments__day-nav {
        appearance: none;
        border: 1px solid var(--ph-tournament-line);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        padding: 0;
        border-radius: 999px;
        background: var(--ph-tournament-white);
        color: var(--ph-tournament-ink);
        font-size: 17px;
        line-height: 1;
        cursor: pointer;
        transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
        font-family: var(--ph-tournament-button-font);
        font-style: italic;
        font-weight: 800;
        flex: 0 0 44px;
      }

      .phab-tournaments__day-nav:hover {
        transform: translateY(-1px);
      }

      .phab-tournaments__day-nav:disabled {
        opacity: 0.42;
        cursor: default;
        box-shadow: none;
      }

      .phab-tournaments__day-rail {
        display: flex;
        gap: 12px;
        min-width: 0;
        overflow-x: auto;
        padding-bottom: 2px;
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
        justify-content: flex-end;
        gap: 0;
        min-width: 64px;
        padding: 0;
        background: transparent;
        color: var(--ph-tournament-ink);
        cursor: pointer;
        transition: transform 120ms ease, opacity 120ms ease;
      }

      .phab-tournaments__day:hover {
        transform: translateY(-1px);
      }

      .phab-tournaments__day-weekday {
        margin-bottom: 8px;
        font-size: 11px;
        line-height: 1;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #bdbdbd;
        font-family: var(--ph-tournament-time-font);
      }

      .phab-tournaments__day-month,
      .phab-tournaments__day-date {
        display: flex;
        width: 64px;
        align-items: center;
        justify-content: center;
      }

      .phab-tournaments__day-month {
        min-height: 24px;
        border-radius: 18px 18px 0 0;
        background: #1a1a1a;
        color: #ffffff;
        font-size: 12px;
        line-height: 1;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        font-family: var(--ph-tournament-button-font);
        font-style: italic;
        font-weight: 800;
      }

      .phab-tournaments__day-date {
        min-height: 58px;
        border: 1px solid var(--ph-tournament-line);
        border-top: none;
        border-radius: 0 0 18px 18px;
        background: var(--ph-tournament-white);
        color: var(--ph-tournament-ink);
        box-shadow: 0 2px 0 rgba(0, 0, 0, 0.04);
        font-size: 22px;
        line-height: 1;
        letter-spacing: -0.04em;
        font-family: var(--ph-tournament-button-font);
        font-style: italic;
        font-weight: 800;
      }

      .phab-tournaments__day.is-active .phab-tournaments__day-weekday {
        color: var(--ph-tournament-purple);
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
      }

      .phab-tournaments__entry {
        position: relative;
        overflow: hidden;
        border-radius: 20px;
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
        width: 100%;
        max-width: 359px;
        min-height: 0;
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
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: flex-start;
        width: 100%;
        min-height: 241px;
        padding: 14px 12px;
        gap: 20px;
        background: var(--ph-tournament-card-bg);
        border-radius: 12px;
      }

      .phab-tournaments__card-compact-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
        width: 100%;
      }

      .phab-tournaments__card-compact-heading {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        min-width: 0;
        flex: 1 1 auto;
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
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 74px;
        min-height: 33px;
        padding: 8px 12px;
        border: 1.5px dashed var(--ph-tournament-card-line);
        border-radius: 6px;
      }

      .phab-tournaments__card-compact-price-value {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--ph-tournament-card-ink);
        font-family: var(--ph-tournament-card-title-font);
        font-size: 14px;
        line-height: 1.24;
        font-weight: 800;
        text-align: center;
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
        flex: 1 1 auto;
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
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        min-height: 13px;
        margin-left: auto;
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
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
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
          grid-template-columns: 82px minmax(0, 1fr) 144px;
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
        .phab-tournaments__toolbar,
        .phab-tournaments__dialog {
          padding: 16px;
        }

        .phab-tournaments__days-panel {
          gap: 10px;
        }

        .phab-tournaments__day-rail {
          gap: 10px;
        }

        .phab-tournaments__day-nav {
          width: 40px;
          height: 40px;
          font-size: 16px;
          flex-basis: 40px;
        }

        .phab-tournaments__day-month,
        .phab-tournaments__day-date {
          width: 60px;
        }

        .phab-tournaments__day-month {
          min-height: 22px;
          border-radius: 16px 16px 0 0;
        }

        .phab-tournaments__day-date {
          min-height: 54px;
          font-size: 20px;
          border-radius: 0 0 16px 16px;
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

  function normalizeLevelLabel(value) {
    return String(value || '').trim().toUpperCase();
  }

  function rankLevel(level) {
    var normalized = normalizeLevelLabel(level);
    var index = LEVEL_OPTIONS.indexOf(normalized);
    return index === -1 ? LEVEL_OPTIONS.length : index;
  }

  function sortLevels(levels) {
    return normalizeArray(levels)
      .map(normalizeLevelLabel)
      .filter(Boolean)
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
      return list[0];
    }

    return 'от ' + list[0] + ' до ' + list[list.length - 1];
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

  function resolveLocationLabel(card) {
    return (
      String(card.studioName || '').trim()
      || String(normalizeObject(card.sourceTournament).studioName || '').trim()
      || 'PadelHub'
    );
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

  function resolveCardBadgeLabel(card) {
    return [String(card.tournamentType || 'Турнир').trim(), formatGenderBadgeLabel(card.gender)]
      .filter(Boolean)
      .join(' · ');
  }

  function resolveCardPriceLabel(card) {
    var booking = normalizeObject(card.booking);
    var purchaseOption = normalizeArray(booking.purchaseOptions)[0];
    var acceptedSubscription = normalizeArray(booking.acceptedSubscriptions)[0];

    if (purchaseOption) {
      var purchase = normalizeObject(purchaseOption);
      var purchasePrice = String(purchase.priceLabel || purchase.price || '').trim();
      if (purchasePrice) {
        return purchasePrice;
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

    return booking.required ? 'Оплата' : 'Без оплаты';
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

  function filterVisibleItems(items, includePast) {
    var todayKey;

    if (includePast) {
      return items.slice();
    }

    todayKey = formatDateKey(new Date());

    return items.filter(function (item) {
      var parsed = parseDate(item.startsAt);

      if (!parsed) {
        return true;
      }

      return formatDateKey(parsed) >= todayKey;
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
        label: 'В лист ожидания',
        mode: joinUrl ? 'join' : publicUrl ? 'public' : 'disabled'
      };
    }

    return {
      kind: 'primary',
      label: String(skin.ctaLabel || '').trim() || 'Принять участие',
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

  function createCompactBadgeIcon() {
    var icon = createElement('span', 'phab-tournaments__card-compact-badge-icon');
    icon.innerHTML =
      '<svg viewBox="0 0 8 8" fill="none" aria-hidden="true">' +
      '<circle cx="2.35" cy="5.6" r="1.2" fill="#2F9DD4"></circle>' +
      '<circle cx="5.8" cy="2.2" r="1.15" fill="#2F9DD4"></circle>' +
      '<path d="M2.95 5L5.1 2.9" stroke="#2F9DD4" stroke-width="1.05" stroke-linecap="round"></path>' +
      '<circle cx="2.1" cy="2.1" r="1.25" fill="#2F9DD4"></circle>' +
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
    var imageUrl = resolvePrimaryImage(card);
    var organizerName = resolveTrainerLabel(card);
    var avatar = createElement('div', 'phab-tournaments__card-compact-organizer-avatar');

    if (imageUrl) {
      var img = document.createElement('img');
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
      createElement('span', 'phab-tournaments__card-compact-meta-text', text),
      trailing || null
    ]);
    return row;
  }

  function createCompactMapLink(card) {
    var mapUrl = resolveMapUrl(card);

    if (!mapUrl) {
      return createElement('span', 'phab-tournaments__card-compact-map', 'на карте');
    }

    var link = createElement('a', 'phab-tournaments__card-compact-map', 'на карте');
    link.href = mapUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
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
    var durationLabel = formatDurationCompact(card);

    appendChildren(metrics, [
      createCompactFooterMetric('engagement', card.participantsCount, true),
      createCompactFooterMetric('waitlist', card.waitlistCount, false)
    ]);

    appendChildren(footer, [
      metrics,
      durationLabel
        ? createElement('span', 'phab-tournaments__card-compact-footer-time', durationLabel)
        : null
    ]);

    return footer;
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

  function createCardModeActionControl(card, action, state, mount) {
    var control = createActionControl(card, action, state, mount);

    control.className = 'phab-tournaments__card-compact-cta';

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

    return article;
  }

  function createScheduleCard(card, state, mount) {
    var descriptor = resolveTournamentState(card);
    var action = resolveAction(card, descriptor);
    var article = createElement('article', 'phab-tournaments__entry phab-tournaments__entry--schedule');
    var asideBottom = createElement('div', 'phab-tournaments__aside-bottom');
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

    article.appendChild(createTournamentHeader(card));
    article.appendChild(createTournamentCardBody(card, descriptor));
    article.appendChild(asideBottom);
    return article;
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
    var info = createElement('div', 'phab-tournaments__card-compact-info');

    appendChildren(badge, [createCompactBadgeIcon(), badgeText]);
    appendChildren(heading, [
      badge,
      createElement('h3', 'phab-tournaments__card-compact-title', resolveTitle(card))
    ]);
    price.appendChild(
      createElement('span', 'phab-tournaments__card-compact-price-value', resolveCardPriceLabel(card))
    );
    appendChildren(header, [heading, price]);

    appendChildren(info, [
      createCompactMetaRow('calendar', formatCardScheduleLabel(card)),
      createCompactMetaRow('location', resolveLocationLabel(card), createCompactMapLink(card)),
      createCompactMetaRow('level', formatAccessLevelRange(card.accessLevels))
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

    return article;
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

  function createToolbar(mount, state, dayGroups) {
    var toolbar = createElement('div', 'phab-tournaments__toolbar');
    var row = createElement('div', 'phab-tournaments__toolbar-row');
    var daysPanel = createElement('div', 'phab-tournaments__days-panel');
    var rail = createElement('div', 'phab-tournaments__day-rail');
    var toolbarMeta = createElement('div', 'phab-tournaments__toolbar-meta');
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
    toolbarMeta.appendChild(view);
    row.appendChild(daysPanel);
    row.appendChild(toolbarMeta);
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
      filterVisibleItems(
        normalizeArray(response.items).map(function (entry) {
          return normalizeObject(entry);
        }),
        state.config.includePast
      )
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
      shell.appendChild(createToolbar(mount, state, dayGroups));
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
