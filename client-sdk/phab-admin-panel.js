(function () {
  var DEFAULTS = {
    apiBaseUrl: '',
    mountSelector: '',
    title: 'ЦУП Дворотека',
    userId: '',
    roles: [],
    role: '',
    stationIds: [],
    pollIntervalMs: 8000,
    authHeaders: {},
    authToken: ''
  };

  var STYLE_ID = 'phab-admin-panel-style';
  var PADLHUB_FAVICON_URL = 'https://padlhub.ru/favicon.ico';
  var CONNECTOR_ROUTES = ['TG_BOT', 'MAX_BOT', 'LK_WEB_MESSENGER'];
  var CONNECTOR_CONFIG_PRESETS = {
    MAX_BOT: {
      label: 'MAX Bot',
      description: 'Транспорт сообщений через MAX + support outbox',
      fields: [
        'inboundEnabled: включить прием входящих из MAX',
        'outboxEnabled: включить доставку ответов через outbox',
        'outboxPollIntervalMs: интервал pull outbox (мс)',
        'outboxPullLimit: размер пачки сообщений на pull',
        'outboxLeaseSec: lease на сообщение (сек)',
        'requireIntegrationToken: требовать x-integration-token',
        'normalizeStationAlias: маппить station alias (tereh/nagat и т.д.)',
        'allowedMessageKinds: допустимые kind для входящих событий'
      ],
      template: {
        inboundEnabled: true,
        outboxEnabled: true,
        outboxPollIntervalMs: 5000,
        outboxPullLimit: 20,
        outboxLeaseSec: 30,
        requireIntegrationToken: true,
        normalizeStationAlias: true,
        allowedMessageKinds: ['TEXT', 'CONTACT', 'STATION_SELECTION', 'COMMAND', 'SYSTEM']
      }
    },
    MAX_ACADEMY_BOT: {
      label: 'MAX Academy Bot',
      description: 'Транспорт сообщений через MAX Академии будущего + support outbox',
      fields: [
        'inboundEnabled: включить прием входящих из MAX',
        'outboxEnabled: включить доставку ответов через outbox',
        'outboxPollIntervalMs: интервал pull outbox (мс)',
        'outboxPullLimit: размер пачки сообщений на pull',
        'outboxLeaseSec: lease на сообщение (сек)',
        'requireIntegrationToken: требовать x-integration-token',
        'normalizeStationAlias: маппить station alias (tereh/nagat и т.д.)',
        'allowedMessageKinds: допустимые kind для входящих событий'
      ],
      template: {
        inboundEnabled: true,
        outboxEnabled: true,
        outboxPollIntervalMs: 5000,
        outboxPullLimit: 20,
        outboxLeaseSec: 30,
        requireIntegrationToken: true,
        normalizeStationAlias: true,
        allowedMessageKinds: ['TEXT', 'CONTACT', 'STATION_SELECTION', 'COMMAND', 'SYSTEM']
      }
    },
    LK_WEB_MESSENGER: {
      label: 'LK Web Messenger',
      description: 'Диалоги и сообщения из web-виджета ЛК',
      fields: [
        'inboundEnabled: включить прием входящих из WEB',
        'widgetEnabled: разрешить web-виджет',
        'ingestPath: ожидаемый путь входящих событий',
        'sourceTag: тег источника в metadata',
        'syncFromMongoEnabled: подтягивать внешние записи из Mongo',
        'syncIntervalMs: частота синхронизации (мс)',
        'mapAuthorizedAsVerified: AUTHORIZED => VERIFIED',
        'resolveStationAliasByName: добавлять alias станции (например tereh)'
      ],
      template: {
        inboundEnabled: true,
        widgetEnabled: true,
        ingestPath: '/lk/support/dialogs/events',
        sourceTag: 'lk_support_widget',
        syncFromMongoEnabled: true,
        syncIntervalMs: 5000,
        mapAuthorizedAsVerified: true,
        resolveStationAliasByName: true
      }
    },
    LK_ACADEMY_WEB_MESSENGER: {
      label: 'LK Academy Web Messenger',
      description: 'Диалоги и сообщения из личного кабинета Академии будущего',
      fields: [
        'inboundEnabled: включить прием входящих из WEB',
        'widgetEnabled: разрешить web-виджет',
        'ingestPath: ожидаемый путь входящих событий',
        'sourceTag: тег источника в metadata',
        'syncFromMongoEnabled: подтягивать внешние записи из Mongo',
        'syncIntervalMs: частота синхронизации (мс)',
        'mapAuthorizedAsVerified: AUTHORIZED => VERIFIED',
        'resolveStationAliasByName: добавлять alias станции (например tereh)'
      ],
      template: {
        inboundEnabled: true,
        widgetEnabled: true,
        ingestPath: '/lk-academy/support/dialogs/events',
        sourceTag: 'lk_academy_support_widget',
        syncFromMongoEnabled: true,
        syncIntervalMs: 5000,
        mapAuthorizedAsVerified: true,
        resolveStationAliasByName: true
      }
    },
    TG_BOT: {
      label: 'Telegram Bot',
      description: 'Базовый preset TG',
      fields: ['inboundEnabled: включить прием', 'outboxEnabled: включить outbox'],
      template: {
        inboundEnabled: true,
        outboxEnabled: true
      }
    }
  };
  var SUPPORT_CONNECTOR_ROUTES = [
    'TG_BOT',
    'MAX_BOT',
    'MAX_ACADEMY_BOT',
    'LK_WEB_MESSENGER',
    'LK_ACADEMY_WEB_MESSENGER',
    'EMAIL',
    'PHONE_CALL',
    'BITRIX'
  ];
  var ROLE_OPTIONS = [
    'SUPER_ADMIN',
    'TOURNAMENT_MANAGER',
    'GAME_MANAGER',
    'STATION_ADMIN',
    'MANAGER',
    'SUPPORT',
    'CLIENT'
  ];
  var PADLHUB_FAVICON_URL = 'https://padlhub.ru/favicon.ico';
  var MAX_FAVICON_URL = 'https://max.ru/favicon.ico';
  var FFC_FAVICON_URL = 'https://ffc.team/favicon.ico';

  function normalizeConfig(raw) {
    var cfg = Object.assign({}, DEFAULTS, raw || {});
    if (!cfg.apiBaseUrl) {
      throw new Error('PHAB admin panel: apiBaseUrl is required');
    }
    cfg.apiBaseUrl = String(cfg.apiBaseUrl).replace(/\/+$/, '');
    cfg.userId = String(cfg.userId || 'admin-' + Math.random().toString(36).slice(2, 8));

    if (!Array.isArray(cfg.roles)) {
      cfg.roles = [];
    }
    if (cfg.role && cfg.roles.indexOf(cfg.role) === -1) {
      cfg.roles.unshift(String(cfg.role));
    }
    if (!Array.isArray(cfg.stationIds)) {
      cfg.stationIds = [];
    }
    cfg.authToken = String(cfg.authToken || '').trim();
    if (!cfg.authToken) {
      try {
        cfg.authToken = String(window.localStorage.getItem('phab_admin_token') || '').trim();
      } catch (_error) {
        cfg.authToken = '';
      }
    }
    cfg.pollIntervalMs = Math.max(3000, Number(cfg.pollIntervalMs || DEFAULTS.pollIntervalMs));
    return cfg;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      @import url("https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Unbounded:wght@500;700;800&display=swap");
      .phab-admin{
        --cup-wine:#330020;
        --cup-white:#ffffff;
        --cup-cream:#ffe891;
        --cup-lime:#cfffb6;
        --cup-cyan:#b6fdff;
        --cup-lilac:#ddc8fc;
        --cup-red:#ff464e;
        --cup-navy:#0a1433;
        --cup-blue:#003a86;
        --cup-violet:#610788;
        --cup-green:#01433a;
        --cup-shadow:0 28px 60px rgba(51,0,32,.22);
        --cup-font-heading:"Druk Wide","Unbounded","Arial Black",sans-serif;
        --cup-font-body:"TT Neoris Trial Variable","Manrope","Helvetica Neue",sans-serif;
        position:relative;
        overflow:hidden;
        border-radius:20px;
        border:2px solid rgba(51,0,32,.16);
        color:var(--cup-wine);
        background:
          linear-gradient(132deg,rgba(207,255,182,.82) 0%,rgba(182,253,255,.84) 44%,rgba(221,200,252,.84) 100%);
        font-family:var(--cup-font-body);
        box-shadow:var(--cup-shadow);
        animation:phab-cup-enter .5s cubic-bezier(.2,.8,.2,1);
        display:flex;
        flex-direction:column;
        height:100%;
      }
      .phab-admin::before,
      .phab-admin::after{
        content:"";
        position:absolute;
        pointer-events:none;
        z-index:0;
      }
      .phab-admin::before{
        width:340px;
        height:340px;
        top:-110px;
        right:-70px;
        border-radius:40px;
        background:
          linear-gradient(90deg,var(--cup-red) 0 24%,var(--cup-wine) 24% 48%,var(--cup-lilac) 48% 72%,var(--cup-cream) 72% 100%);
        transform:rotate(16deg);
        opacity:.5;
      }
      .phab-admin::after{
        width:270px;
        height:230px;
        bottom:-94px;
        left:-92px;
        border-radius:30px;
        background:
          linear-gradient(135deg,var(--cup-blue) 0 26%,var(--cup-cyan) 26% 52%,var(--cup-green) 52% 76%,var(--cup-lime) 76% 100%);
        transform:rotate(-16deg);
        opacity:.5;
      }
      .phab-admin *{
        box-sizing:border-box;
        position:relative;
        z-index:1;
      }
      .phab-admin-header{
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:10px;
        padding:16px 18px 14px;
        background:linear-gradient(94deg,var(--cup-wine) 0%,#5f0636 100%);
        color:var(--cup-white);
        border-bottom:2px solid rgba(255,255,255,.28);
      }
      .phab-admin-title{
        font-family:var(--cup-font-heading);
        font-size:18px;
        letter-spacing:.02em;
        font-weight:700;
        text-transform:uppercase;
      }
      .phab-admin-subtitle{
        margin-top:4px;
        font-size:12px;
        font-weight:500;
        letter-spacing:.04em;
        opacity:.9;
      }
      .phab-admin-toolbar{
        display:flex;
        gap:8px;
        align-items:center;
        flex-wrap:wrap;
      }
      .phab-admin-btn,
      .phab-admin-btn-secondary{
        border:none;
        cursor:pointer;
        font-family:var(--cup-font-body);
        font-size:12px;
        font-weight:700;
        letter-spacing:.02em;
        border-radius:12px;
        padding:8px 12px;
        transition:transform .16s ease, box-shadow .16s ease, background .16s ease, color .16s ease;
      }
      .phab-admin-btn{
        background:linear-gradient(90deg,var(--cup-red) 0%,#ff7158 100%);
        color:var(--cup-white);
        box-shadow:0 8px 16px rgba(255,70,78,.28);
      }
      .phab-admin-btn:hover{
        transform:translateY(-1px);
        box-shadow:0 10px 20px rgba(255,70,78,.34);
      }
      .phab-admin-btn:disabled{
        opacity:.55;
        cursor:default;
        transform:none;
        box-shadow:none;
      }
      .phab-admin-btn-secondary{
        border:1px solid rgba(51,0,32,.18);
        background:rgba(255,255,255,.84);
        color:var(--cup-wine);
      }
      .phab-admin-btn-secondary:hover{
        background:var(--cup-lime);
      }
      .phab-admin-tabs{
        display:flex;
        gap:8px;
        flex-wrap:wrap;
        padding:10px 12px;
        border-bottom:1px solid rgba(51,0,32,.14);
        background:linear-gradient(90deg,rgba(255,255,255,.78) 0%,rgba(255,255,255,.62) 100%);
        backdrop-filter:blur(2px);
      }
      .phab-admin-tab{
        border:1px solid rgba(51,0,32,.2);
        background:rgba(255,255,255,.82);
        color:var(--cup-wine);
        padding:8px 12px;
        border-radius:999px;
        cursor:pointer;
        font-size:11px;
        font-weight:800;
        font-family:var(--cup-font-heading);
        letter-spacing:.03em;
        text-transform:uppercase;
        transition:all .2s ease;
      }
      .phab-admin-tab:hover{
        transform:translateY(-1px);
        border-color:rgba(51,0,32,.34);
      }
      .phab-admin-tab-active{
        background:var(--cup-wine);
        color:var(--cup-white);
        border-color:var(--cup-wine);
      }
      .phab-admin-content{
        padding:12px;
        min-height:500px;
        flex:1;
        display:flex;
        flex-direction:column;
        min-height:0;
        overflow:auto;
        -webkit-overflow-scrolling:touch;
      }
      .phab-admin-hidden{
        display:none !important;
      }
      .phab-admin-msg-grid{
        display:grid;
        grid-template-columns:310px 1fr;
        gap:12px;
        flex:1;
        min-height:0;
        height:100%;
      }
      .phab-admin-pane{
        background:rgba(255,255,255,.88);
        border:1px solid rgba(51,0,32,.15);
        border-radius:16px;
        overflow:hidden;
        box-shadow:0 12px 28px rgba(51,0,32,.09);
        display:flex;
        flex-direction:column;
        min-height:0;
      }
      .phab-admin-pane-head{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        padding:11px 12px;
        border-bottom:1px solid rgba(51,0,32,.12);
        font-size:11px;
        font-weight:800;
        letter-spacing:.06em;
        text-transform:uppercase;
        color:var(--cup-wine);
        font-family:var(--cup-font-heading);
        background:linear-gradient(90deg,rgba(255,232,145,.86) 0%,rgba(182,253,255,.76) 100%);
      }
      .phab-admin-pane-head-title{
        flex:0 0 auto;
      }
      .phab-admin-pane-head-search{
        flex:1 1 auto;
        min-width:0;
        max-width:198px;
        width:auto !important;
        padding:8px 10px;
        font-size:12px;
        font-weight:500;
        letter-spacing:normal;
        text-transform:none;
        font-family:var(--cup-font-body);
        background:rgba(255,255,255,.94);
      }
      .phab-admin-dialog-filters-wrap{
        display:flex;
        flex-wrap:wrap;
        gap:6px;
        padding:8px;
        border-bottom:1px solid rgba(51,0,32,.1);
        background:rgba(255,255,255,.74);
      }
      .phab-admin-dialog-filter{
        border:1px solid rgba(51,0,32,.16);
        background:rgba(255,255,255,.92);
        color:var(--cup-wine);
        border-radius:999px;
        padding:6px 10px;
        font-size:10px;
        font-weight:700;
        cursor:pointer;
        transition:all .16s ease;
      }
      .phab-admin-dialog-filter:hover{
        transform:translateY(-1px);
        border-color:rgba(51,0,32,.28);
      }
      .phab-admin-dialog-filter-active{
        background:linear-gradient(90deg,var(--cup-lime) 0%,rgba(182,253,255,.84) 100%);
        border-color:rgba(0,58,134,.34);
      }
      .phab-admin-pane-body{
        padding:8px;
        overflow:auto;
        flex:1;
        min-height:0;
      }
      .phab-admin-chat-list-wrap{
        height:100%;
        min-height:0;
        max-height:none;
      }
      .phab-admin-list{
        list-style:none;
        margin:0;
        padding:0;
        display:flex;
        flex-direction:column;
        gap:7px;
      }
      .phab-admin-list-more{
        padding:8px 4px 2px;
        text-align:center;
        font-size:12px;
        font-weight:600;
        color:rgba(51,0,32,.58);
      }
      .phab-admin-list-btn{
        width:100%;
        text-align:left;
        border:1px solid rgba(51,0,32,.13);
        background:rgba(255,255,255,.92);
        border-radius:12px;
        padding:8px 10px;
        cursor:pointer;
        transition:all .16s ease;
      }
      .phab-admin-list-btn:hover{
        transform:translateX(1px);
        border-color:rgba(51,0,32,.26);
        box-shadow:0 8px 16px rgba(51,0,32,.08);
      }
      .phab-admin-list-btn-active{
        background:linear-gradient(90deg,var(--cup-lime) 0%,rgba(182,253,255,.84) 100%);
        border-color:rgba(0,58,134,.36);
      }
      .phab-admin-list-btn-inactive{
        background:rgba(243,243,246,.96);
        border-color:rgba(51,0,32,.08);
        opacity:.7;
      }
      .phab-admin-list-btn-inactive .phab-admin-list-title,
      .phab-admin-list-btn-inactive .phab-admin-list-meta,
      .phab-admin-list-btn-inactive .phab-admin-chat-preview{
        color:rgba(51,0,32,.58);
      }
      .phab-admin-chat-item-top{
        min-width:0;
      }
      .phab-admin-chat-item{
        display:grid;
        grid-template-columns:minmax(0,1fr) auto;
        column-gap:10px;
        align-items:stretch;
      }
      .phab-admin-chat-item-main{
        min-width:0;
      }
      .phab-admin-chat-item-side{
        min-width:24px;
        display:flex;
        flex-direction:column;
        align-items:flex-end;
        justify-content:flex-end;
        gap:6px;
      }
      .phab-admin-chat-source{
        display:flex;
        align-items:center;
        justify-content:flex-end;
        gap:5px;
        min-height:14px;
        flex-wrap:wrap;
        max-width:34px;
      }
      .phab-admin-chat-source-icon{
        width:14px;
        height:14px;
        border-radius:4px;
        border:1px solid rgba(51,0,32,.14);
        object-fit:cover;
        background:rgba(255,255,255,.95);
        display:block;
        flex:0 0 auto;
      }
      .phab-admin-chat-badge{
        min-width:20px;
        height:20px;
        padding:0 6px;
        border-radius:999px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        font-size:11px;
        font-weight:800;
        line-height:1;
        flex:0 0 auto;
      }
      .phab-admin-chat-badge-unread{
        background:#ff5a63;
        color:#fff;
        border:1px solid rgba(123,20,51,.18);
      }
      .phab-admin-chat-badge-pending{
        background:rgba(51,0,32,.12);
        color:var(--cup-wine);
        border:1px solid rgba(51,0,32,.12);
      }
      .phab-admin-chat-preview{
        margin-top:6px;
        font-size:11px;
        line-height:1.35;
        color:rgba(51,0,32,.82);
        display:-webkit-box;
        -webkit-line-clamp:2;
        -webkit-box-orient:vertical;
        overflow:hidden;
        word-break:break-word;
      }
      .phab-admin-chat-item-side:empty{
        display:none;
      }
      .phab-admin-list-title{
        font-size:12px;
        font-weight:700;
        color:var(--cup-wine);
      }
      .phab-admin-list-meta{
        margin-top:3px;
        font-size:11px;
        color:rgba(51,0,32,.72);
      }
      .phab-admin-status{
        font-size:11px;
        font-weight:700;
        padding:5px 9px;
        border-radius:999px;
        background:rgba(207,255,182,.92);
        color:#0f5c3c;
        border:1px solid rgba(1,67,58,.24);
        animation:phab-cup-pulse 2.2s ease-in-out infinite;
      }
      .phab-admin-status-error{
        background:rgba(255,70,78,.12);
        border-color:rgba(255,70,78,.45);
        color:#9f1735;
      }
      .phab-admin-dialog-wrap{
        display:grid;
        grid-template-rows:auto minmax(0,1fr) auto;
        height:100%;
        min-height:0;
      }
      .phab-admin-dialog-body{
        display:grid;
        grid-template-columns:minmax(0,1fr) minmax(0,1fr);
        grid-template-rows:minmax(0,1fr);
        gap:12px;
        padding:12px;
        height:100%;
        min-height:0;
        align-items:stretch;
        overflow:hidden;
      }
      .phab-admin-dialog-head{
        display:grid;
        grid-template-columns:minmax(0,1fr) auto;
        column-gap:18px;
        row-gap:4px;
        align-items:start;
        padding:10px 12px;
        border-bottom:1px solid rgba(51,0,32,.12);
        background:linear-gradient(90deg,rgba(207,255,182,.78) 0%,rgba(255,255,255,.96) 100%);
      }
      .phab-admin-dialog-title{
        grid-column:1;
        font-size:14px;
        font-family:var(--cup-font-heading);
        font-weight:700;
        letter-spacing:.04em;
        text-transform:uppercase;
        color:var(--cup-wine);
      }
      .phab-admin-dialog-meta{
        grid-column:1;
        font-size:11px;
        color:rgba(51,0,32,.72);
      }
      .phab-admin-dialog-tags{
        grid-column:1;
        margin-top:4px;
      }
      .phab-admin-dialog-options{
        grid-column:2;
        grid-row:1 / span 3;
        align-self:center;
        justify-self:end;
        display:flex;
        flex-direction:column;
        align-items:flex-end;
        gap:8px;
        width:min(100%,320px);
        max-width:100%;
        margin-top:0;
      }
      .phab-admin-dialog-option{
        display:flex;
        align-items:center;
        justify-content:flex-end;
        gap:10px;
        width:100%;
      }
      .phab-admin-dialog-option .phab-admin-switch{
        order:2;
        flex:0 0 auto;
      }
      .phab-admin-dialog-option .phab-admin-switch-text{
        text-align:right;
      }
      .phab-admin-dialog-links{
        display:flex;
        flex-wrap:wrap;
        align-items:center;
        gap:8px;
        margin-top:7px;
      }
      .phab-admin-dialog-link-status{
        display:inline-flex;
        align-items:center;
        gap:6px;
        font-size:11px;
        font-weight:700;
        color:rgba(51,0,32,.78);
      }
      .phab-admin-dialog-link-status::before{
        content:"";
        width:8px;
        height:8px;
        border-radius:999px;
        background:#9aa1ac;
        box-shadow:0 0 0 1px rgba(51,0,32,.1);
        flex:0 0 auto;
      }
      .phab-admin-dialog-link-status-ok{
        color:#0f5c3c;
      }
      .phab-admin-dialog-link-status-ok::before{
        background:#27b36a;
      }
      .phab-admin-dialog-link-status-missing{
        color:#7c5200;
      }
      .phab-admin-dialog-link-status-missing::before{
        background:#f0b323;
      }
      .phab-admin-dialog-link-status-disabled{
        color:#5f6570;
      }
      .phab-admin-dialog-link-status-disabled::before{
        background:#9aa1ac;
      }
      .phab-admin-dialog-link{
        display:inline-flex;
        align-items:center;
        gap:6px;
        padding:4px 9px;
        border-radius:999px;
        background:rgba(255,255,255,.92);
        border:1px solid rgba(51,0,32,.14);
        color:var(--cup-wine);
        font-size:11px;
        font-weight:700;
        text-decoration:none;
      }
      .phab-admin-dialog-link:hover{
        background:rgba(255,255,255,.98);
        border-color:rgba(51,0,32,.28);
      }
      .phab-admin-dialog-cabinet{
        display:grid;
        grid-template-rows:auto minmax(0,1fr);
        min-height:0;
        grid-column:2;
        grid-row:1;
        height:100%;
        border:1px solid rgba(51,0,32,.12);
        border-radius:16px;
        overflow:hidden;
        background:linear-gradient(180deg,rgba(255,255,255,.96) 0%,rgba(242,248,255,.94) 100%);
        box-shadow:0 10px 22px rgba(51,0,32,.06);
      }
      .phab-admin-dialog-cabinet-head{
        padding:12px;
        border-bottom:1px solid rgba(51,0,32,.1);
        background:linear-gradient(90deg,rgba(182,253,255,.3) 0%,rgba(255,255,255,.85) 100%);
      }
      .phab-admin-dialog-cabinet-title{
        font-size:12px;
        font-family:var(--cup-font-heading);
        font-weight:700;
        letter-spacing:.03em;
        text-transform:uppercase;
        color:var(--cup-wine);
      }
      .phab-admin-dialog-cabinet-meta{
        margin-top:5px;
        font-size:11px;
        color:rgba(51,0,32,.68);
      }
      .phab-admin-dialog-cabinet-frame-wrap{
        min-height:0;
        position:relative;
        background:
          linear-gradient(rgba(255,255,255,.88),rgba(255,255,255,.88)),
          linear-gradient(135deg,rgba(207,255,182,.22) 0%,rgba(182,253,255,.2) 50%,rgba(221,200,252,.24) 100%);
      }
      .phab-admin-dialog-webview{
        display:block;
        width:100%;
        height:100%;
        border:0;
        background:#fff;
      }
      .phab-admin-dialog-cabinet-empty{
        display:flex;
        align-items:center;
        justify-content:center;
        height:100%;
        text-align:center;
        padding:18px;
      }
      .phab-admin-dialog-tags{
        display:flex;
        flex-wrap:wrap;
        gap:6px;
        margin-top:8px;
      }
      .phab-admin-connector-icons{
        display:inline-flex;
        align-items:center;
        gap:6px;
        margin-right:2px;
      }
      .phab-admin-connector-logo{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        width:26px;
        height:26px;
        border-radius:8px;
        border:1px solid rgba(51,0,32,.14);
        background:rgba(255,255,255,.92);
        box-shadow:0 4px 10px rgba(51,0,32,.08);
        overflow:hidden;
        flex:0 0 auto;
      }
      .phab-admin-connector-logo-max{
        background:linear-gradient(135deg,#00a8ff 0%,#0b59d3 100%);
        color:#fff;
        font-size:9px;
        font-weight:900;
        letter-spacing:.04em;
        font-family:var(--cup-font-heading);
      }
      .phab-admin-connector-logo-padlhub img{
        display:block;
        width:18px;
        height:18px;
        object-fit:contain;
      }
      .phab-admin-connector-logo-padlhub-fallback{
        color:var(--cup-wine);
        font-size:12px;
        font-weight:900;
        font-family:var(--cup-font-heading);
      }
      .phab-admin-chip{
        display:inline-flex;
        align-items:center;
        padding:3px 8px;
        border-radius:999px;
        background:rgba(255,255,255,.9);
        border:1px solid rgba(51,0,32,.14);
        color:var(--cup-wine);
        font-size:10px;
        font-weight:800;
        letter-spacing:.03em;
        text-transform:uppercase;
      }
      .phab-admin-chip-alert{
        background:rgba(255,70,78,.12);
        border-color:rgba(255,70,78,.45);
        color:#9f1735;
      }
      .phab-admin-chip-warn{
        background:rgba(255,232,145,.58);
        border-color:rgba(160,120,0,.32);
        color:#7c5200;
      }
      .phab-admin-messages{
        padding:12px;
        overflow:auto;
        min-height:0;
        grid-column:1;
        grid-row:1;
        height:100%;
        border:1px solid rgba(51,0,32,.12);
        border-radius:16px;
        box-shadow:0 10px 22px rgba(51,0,32,.06);
        background:
          linear-gradient(rgba(255,255,255,.82),rgba(255,255,255,.82)),
          repeating-linear-gradient(0deg,transparent 0 19px,rgba(51,0,32,.04) 19px 20px);
      }
      .phab-admin-message{
        max-width:84%;
        padding:9px 11px;
        border-radius:13px;
        margin:0 0 8px;
        font-size:12px;
        line-height:1.4;
        white-space:pre-wrap;
        word-break:break-word;
      }
      .phab-admin-message-text{
        display:block;
      }
      .phab-admin-message-client{
        margin-right:auto;
        background:rgba(182,253,255,.72);
        color:#16343f;
        border:1px solid rgba(0,58,134,.22);
        border-bottom-left-radius:4px;
      }
      .phab-admin-message-staff{
        margin-left:auto;
        background:linear-gradient(110deg,var(--cup-wine) 0%,#5f0636 100%);
        color:var(--cup-white);
        border:1px solid rgba(255,255,255,.3);
        border-bottom-right-radius:4px;
      }
      .phab-admin-message-system{
        margin-left:auto;
        margin-right:auto;
        background:rgba(223,228,235,.82);
        color:#39424e;
        border:1px solid rgba(83,95,111,.2);
        max-width:92%;
      }
      .phab-admin-message-meta{
        display:block;
        margin-top:4px;
        font-size:10px;
        opacity:.78;
      }
      .phab-admin-skeleton{
        border-radius:12px;
        background:
          linear-gradient(
            90deg,
            rgba(255,255,255,.18) 0%,
            rgba(255,255,255,.58) 45%,
            rgba(255,255,255,.18) 100%
          ),
          rgba(51,0,32,.08);
        background-size:260px 100%;
        animation:phab-admin-skeleton-wave 1.2s ease-in-out infinite;
      }
      .phab-admin-message-skeleton{
        width:min(84%,420px);
        height:44px;
        margin:0 0 10px;
      }
      .phab-admin-message-skeleton:nth-child(2n){
        margin-left:auto;
        width:min(76%,360px);
      }
      .phab-admin-message-skeleton:nth-child(3n){
        width:min(68%,320px);
      }
      @keyframes phab-admin-skeleton-wave{
        0%{background-position:-260px 0}
        100%{background-position:260px 0}
      }
      .phab-admin-compose{
        display:flex;
        gap:8px;
        padding:10px;
        border-top:1px solid rgba(51,0,32,.12);
        background:linear-gradient(90deg,rgba(255,232,145,.55) 0%,rgba(255,255,255,.88) 100%);
      }
      .phab-admin-input,
      .phab-admin-settings-input{
        width:100%;
        border:1px solid rgba(51,0,32,.2);
        border-radius:10px;
        padding:9px 10px;
        font-size:12px;
        font-family:var(--cup-font-body);
        background:rgba(255,255,255,.92);
        color:var(--cup-wine);
      }
      .phab-admin-input:focus,
      .phab-admin-settings-input:focus{
        outline:none;
        border-color:rgba(0,58,134,.55);
        box-shadow:0 0 0 3px rgba(182,253,255,.45);
      }
      .phab-admin-games-controls{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        margin-top:10px;
        flex-wrap:wrap;
      }
      .phab-admin-logs-controls{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        margin-bottom:10px;
        flex-wrap:wrap;
      }
      .phab-admin-logs-filters{
        display:flex;
        align-items:flex-end;
        gap:8px;
        flex-wrap:wrap;
      }
      .phab-admin-logs-filter{
        display:flex;
        flex-direction:column;
        gap:4px;
      }
      .phab-admin-games-pagesize{
        display:flex;
        align-items:center;
        gap:6px;
        font-size:12px;
        font-weight:700;
        color:var(--cup-wine);
      }
      .phab-admin-games-pagination{
        display:flex;
        align-items:center;
        gap:6px;
      }
      .phab-admin-games-page-info{
        min-width:160px;
        text-align:center;
        font-size:12px;
        font-weight:700;
        color:var(--cup-wine);
      }
      .phab-admin-games-table-wrap{
        width:100%;
        overflow-x:auto;
        overflow-y:hidden;
        -webkit-overflow-scrolling:touch;
        touch-action:pan-x pan-y;
      }
      .phab-admin-games-table-wrap .phab-admin-games-table{
        min-width:1320px;
      }
      .phab-admin-games-table{
        width:100%;
        border-collapse:separate;
        border-spacing:0;
        background:rgba(255,255,255,.9);
        border:1px solid rgba(51,0,32,.15);
        border-radius:16px;
        overflow:hidden;
        box-shadow:0 12px 26px rgba(51,0,32,.08);
      }
      .phab-admin-games-table th,
      .phab-admin-games-table td{
        border-bottom:1px solid rgba(51,0,32,.1);
        padding:10px 11px;
        font-size:12px;
        text-align:left;
        vertical-align:top;
      }
      .phab-admin-games-table th{
        position:relative;
        background:linear-gradient(90deg,rgba(255,232,145,.85) 0%,rgba(182,253,255,.72) 100%);
        color:var(--cup-wine);
        font-family:var(--cup-font-heading);
        font-size:11px;
        font-weight:700;
        text-transform:uppercase;
        letter-spacing:.04em;
      }
      .phab-admin-games-table tbody tr:nth-child(even){
        background:rgba(221,200,252,.2);
      }
      .phab-admin-games-row{
        cursor:pointer;
        transition:background .18s ease;
      }
      .phab-admin-games-row:hover{
        background:rgba(255,232,145,.35) !important;
      }
      .phab-admin-games-chat-btn{
        min-width:88px;
      }
      .phab-admin-games-sortable{
        cursor:pointer;
        user-select:none;
        transition:filter .2s ease;
      }
      .phab-admin-games-sortable:hover{
        filter:brightness(1.08);
      }
      .phab-admin-games-sort-indicator{
        margin-left:4px;
        font-size:10px;
        opacity:.9;
      }
      .phab-admin-games-cell-line{
        display:block;
        line-height:1.35;
      }
      .phab-admin-games-cell-line + .phab-admin-games-cell-line{
        margin-top:4px;
      }
      .phab-admin-games-team-title{
        font-weight:800;
        text-transform:uppercase;
        letter-spacing:.02em;
        color:#2a0a2a;
      }
      .phab-admin-games-result-cell{
        text-align:center !important;
        vertical-align:middle !important;
      }
      .phab-admin-games-result-cell .phab-admin-games-cell-line{
        text-align:center;
      }
      .phab-admin-games-rating-cell .phab-admin-games-cell-line{
        white-space:pre-wrap;
      }
      .phab-admin-col-resizer{
        position:absolute;
        top:0;
        right:-3px;
        width:8px;
        height:100%;
        cursor:col-resize;
        user-select:none;
        touch-action:none;
        z-index:2;
      }
      .phab-admin-col-resizer::after{
        content:'';
        position:absolute;
        top:25%;
        right:3px;
        width:2px;
        height:50%;
        border-radius:2px;
        background:rgba(51,0,32,.22);
        transition:background .2s ease;
      }
      .phab-admin-col-resizer:hover::after{
        background:rgba(51,0,32,.45);
      }
      .phab-admin-resizing,
      .phab-admin-resizing *{
        cursor:col-resize !important;
        user-select:none !important;
      }
      .phab-admin-settings-grid{
        display:grid;
        grid-template-columns:repeat(3,minmax(250px,1fr));
        gap:12px;
      }
      .phab-admin-settings-card{
        background:rgba(255,255,255,.9);
        border:1px solid rgba(51,0,32,.16);
        border-radius:16px;
        display:grid;
        grid-template-rows:auto 1fr auto;
        min-height:410px;
        box-shadow:0 12px 26px rgba(51,0,32,.08);
      }
      .phab-admin-settings-head{
        padding:10px 12px;
        border-bottom:1px solid rgba(51,0,32,.1);
        font-size:11px;
        font-weight:800;
        text-transform:uppercase;
        letter-spacing:.05em;
        font-family:var(--cup-font-heading);
        color:var(--cup-wine);
        background:linear-gradient(90deg,rgba(207,255,182,.82) 0%,rgba(255,255,255,.95) 100%);
      }
      .phab-admin-settings-list{
        padding:9px;
        overflow:auto;
        max-height:248px;
        border-bottom:1px solid rgba(51,0,32,.1);
      }
      .phab-admin-settings-form{
        padding:9px;
        display:flex;
        flex-direction:column;
        gap:7px;
      }
      .phab-admin-settings-label{
        font-size:10px;
        font-weight:800;
        letter-spacing:.04em;
        text-transform:uppercase;
        color:rgba(51,0,32,.8);
      }
      .phab-admin-settings-row{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        padding:8px;
        border:1px solid rgba(51,0,32,.14);
        border-radius:10px;
        background:rgba(255,255,255,.92);
        margin-bottom:6px;
      }
      .phab-admin-settings-row-main{
        display:flex;
        flex-direction:column;
        gap:2px;
        min-width:0;
      }
      .phab-admin-settings-row-title{
        font-size:12px;
        font-weight:700;
        color:var(--cup-wine);
        word-break:break-word;
      }
      .phab-admin-settings-row-meta{
        font-size:11px;
        color:rgba(51,0,32,.72);
        word-break:break-word;
      }
      .phab-admin-check{
        display:flex;
        align-items:center;
        gap:6px;
        font-size:12px;
        color:var(--cup-wine);
      }
      .phab-admin-switch{
        position:relative;
        display:inline-flex;
        align-items:center;
      }
      .phab-admin-switch-input{
        position:absolute;
        width:1px;
        height:1px;
        opacity:0;
        pointer-events:none;
      }
      .phab-admin-switch-track{
        width:42px;
        height:24px;
        border-radius:999px;
        border:1px solid rgba(51,0,32,.28);
        background:rgba(51,0,32,.12);
        box-shadow:inset 0 1px 2px rgba(51,0,32,.12);
        transition:background .2s ease,border-color .2s ease;
        position:relative;
        cursor:pointer;
      }
      .phab-admin-switch-track::after{
        content:"";
        position:absolute;
        top:2px;
        left:2px;
        width:18px;
        height:18px;
        border-radius:50%;
        background:#fff;
        box-shadow:0 2px 6px rgba(51,0,32,.25);
        transition:transform .2s ease;
      }
      .phab-admin-switch-input:checked + .phab-admin-switch-track{
        background:rgba(1,67,58,.78);
        border-color:rgba(1,67,58,.9);
      }
      .phab-admin-switch-input:checked + .phab-admin-switch-track::after{
        transform:translateX(18px);
      }
      .phab-admin-switch-input:focus-visible + .phab-admin-switch-track{
        outline:2px solid rgba(0,58,134,.45);
        outline-offset:2px;
      }
      .phab-admin-switch-text{
        font-size:13px;
        font-weight:700;
        color:var(--cup-wine);
      }
      .phab-admin-empty{
        font-size:12px;
        color:rgba(51,0,32,.7);
        padding:12px;
      }
      .phab-admin-modal{
        position:fixed;
        inset:0;
        z-index:2147483600;
        display:flex;
        align-items:flex-start;
        justify-content:center;
        padding:18px;
        background:rgba(24,10,22,.42);
        backdrop-filter:blur(2px);
        overflow-y:auto;
        overflow-x:hidden;
        overscroll-behavior:contain;
        -webkit-overflow-scrolling:touch;
      }
      .phab-admin-modal-card{
        width:min(980px,95vw);
        max-height:calc(100dvh - 36px);
        display:flex;
        flex-direction:column;
        border-radius:18px;
        background:linear-gradient(180deg,rgba(255,255,255,.97) 0%,rgba(255,250,242,.97) 100%);
        border:1px solid rgba(51,0,32,.2);
        box-shadow:0 22px 52px rgba(28,4,24,.28);
        overflow:hidden;
        min-height:0;
        margin:auto 0;
      }
      .phab-admin-modal-head{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        padding:12px 14px;
        border-bottom:1px solid rgba(51,0,32,.12);
        background:linear-gradient(90deg,rgba(182,253,255,.72) 0%,rgba(255,232,145,.72) 100%);
      }
      .phab-admin-modal-title{
        font-family:var(--cup-font-heading);
        font-size:13px;
        font-weight:800;
        letter-spacing:.04em;
        text-transform:uppercase;
        color:var(--cup-wine);
      }
      .phab-admin-modal-actions{
        display:flex;
        align-items:center;
        gap:8px;
      }
      .phab-admin-modal-close{
        width:32px;
        height:32px;
        border-radius:10px;
        border:1px solid rgba(51,0,32,.2);
        background:rgba(255,255,255,.92);
        color:var(--cup-wine);
        font-size:18px;
        line-height:1;
        cursor:pointer;
      }
      .phab-admin-btn-danger{
        border:1px solid rgba(138,0,42,.18);
        background:linear-gradient(180deg,#fff 0%,#ffe6ea 100%);
        color:#7b1433;
        font-size:12px;
        font-weight:700;
        padding:8px 12px;
        border-radius:10px;
        cursor:pointer;
      }
      .phab-admin-btn-danger:disabled{
        opacity:.6;
        cursor:not-allowed;
      }
      .phab-admin-modal-body{
        padding:12px;
        overflow-y:auto;
        overflow-x:hidden;
        flex:1 1 auto;
        min-height:0;
        overscroll-behavior:contain;
        -webkit-overflow-scrolling:touch;
        touch-action:pan-y;
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:10px;
      }
      .phab-admin-detail-card{
        border:1px solid rgba(51,0,32,.14);
        border-radius:12px;
        background:rgba(255,255,255,.92);
        overflow:hidden;
        min-width:0;
      }
      .phab-admin-detail-head{
        padding:8px 10px;
        border-bottom:1px solid rgba(51,0,32,.1);
        font-size:10px;
        font-weight:800;
        letter-spacing:.05em;
        text-transform:uppercase;
        color:var(--cup-wine);
        background:rgba(207,255,182,.44);
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
      }
      .phab-admin-detail-head-title{
        min-width:0;
        flex:1 1 auto;
      }
      .phab-admin-detail-copy-btn{
        border:1px solid rgba(51,0,32,.18);
        background:rgba(255,255,255,.92);
        color:var(--cup-wine);
        border-radius:8px;
        padding:4px 8px;
        font-size:10px;
        font-weight:800;
        letter-spacing:.03em;
        text-transform:uppercase;
        cursor:pointer;
        flex:0 0 auto;
      }
      .phab-admin-detail-body{
        padding:10px;
        display:grid;
        gap:7px;
      }
      .phab-admin-detail-row{
        display:grid;
        grid-template-columns:150px 1fr;
        gap:8px;
        font-size:12px;
        color:var(--cup-wine);
      }
      .phab-admin-detail-key{
        color:rgba(51,0,32,.68);
        font-weight:700;
      }
      .phab-admin-detail-value{
        word-break:break-word;
      }
      .phab-admin-detail-link{
        color:var(--cup-blue);
        font-weight:700;
        text-decoration:none;
        word-break:break-word;
      }
      .phab-admin-detail-link:hover{
        text-decoration:underline;
      }
      .phab-admin-detail-list{
        list-style:none;
        margin:0;
        padding:0;
        display:grid;
        gap:6px;
      }
      .phab-admin-detail-list-item{
        padding:6px 8px;
        border:1px solid rgba(51,0,32,.12);
        border-radius:9px;
        background:rgba(255,255,255,.92);
        font-size:12px;
        color:var(--cup-wine);
      }
      .phab-admin-detail-json{
        font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace;
        font-size:11px;
        line-height:1.4;
        margin:0;
        white-space:pre-wrap;
        word-break:break-word;
        color:#351726;
        display:block;
        min-width:0;
      }
      .phab-admin-detail-json-wrap{
        max-height:min(60vh,560px);
        overflow-y:auto;
        overflow-x:hidden;
        overscroll-behavior:contain;
        -webkit-overflow-scrolling:touch;
        touch-action:pan-y;
        padding-right:4px;
      }
      .phab-admin-photo-grid{
        display:grid;
        grid-template-columns:repeat(auto-fill,minmax(170px,1fr));
        gap:10px;
      }
      .phab-admin-photo-card{
        display:grid;
        gap:8px;
        padding:8px;
        border:1px solid rgba(51,0,32,.12);
        border-radius:12px;
        background:rgba(255,255,255,.95);
      }
      .phab-admin-photo-link{
        display:block;
        border-radius:10px;
        overflow:hidden;
        border:1px solid rgba(51,0,32,.1);
        background:rgba(51,0,32,.04);
      }
      .phab-admin-photo-thumb{
        display:block;
        width:100%;
        aspect-ratio:4 / 3;
        object-fit:cover;
      }
      .phab-admin-photo-meta{
        display:grid;
        gap:4px;
        font-size:11px;
        color:rgba(51,0,32,.78);
      }
      .phab-admin-photo-name{
        font-size:12px;
        font-weight:700;
        color:var(--cup-wine);
        word-break:break-word;
      }
      .phab-admin-photo-sub{
        word-break:break-word;
      }
      .phab-admin-detail-span-2{
        grid-column:span 2;
      }
      .phab-admin-game-chat-meta{
        font-size:11px;
        color:rgba(51,0,32,.76);
      }
      .phab-admin-game-chat-box{
        min-height:280px;
        max-height:52vh;
      }
      .phab-admin-game-chat-compose{
        display:flex;
        gap:8px;
        padding:10px 12px 12px;
        border-top:1px solid rgba(51,0,32,.12);
        background:linear-gradient(90deg,rgba(255,232,145,.44) 0%,rgba(255,255,255,.95) 100%);
      }
      @keyframes phab-cup-enter{
        from{opacity:.2;transform:translateY(8px)}
        to{opacity:1;transform:translateY(0)}
      }
      @keyframes phab-cup-pulse{
        0%,100%{box-shadow:0 0 0 0 rgba(15,92,60,.16)}
        50%{box-shadow:0 0 0 4px rgba(15,92,60,.08)}
      }
      @media (max-width:980px){
        .phab-admin-msg-grid{
          grid-template-columns:1fr;
          grid-template-rows:minmax(220px,32dvh) minmax(0,1fr);
        }
        .phab-admin-dialog-wrap{height:100%}
        .phab-admin-dialog-head{
          grid-template-columns:1fr;
          row-gap:6px;
        }
        .phab-admin-dialog-options{
          grid-column:1;
          grid-row:auto;
          justify-self:stretch;
          align-items:stretch;
          min-width:0;
          margin-top:6px;
        }
        .phab-admin-dialog-option{
          justify-content:space-between;
        }
        .phab-admin-dialog-option .phab-admin-switch-text{
          text-align:left;
        }
        .phab-admin-dialog-body{
          grid-template-columns:1fr;
          grid-template-rows:minmax(240px,34dvh) minmax(0,1fr);
        }
        .phab-admin-messages{grid-column:auto;grid-row:1}
        .phab-admin-dialog-cabinet{grid-column:auto;grid-row:2}
        .phab-admin-settings-grid{grid-template-columns:1fr}
        .phab-admin-modal-body{grid-template-columns:1fr}
        .phab-admin-detail-span-2{grid-column:auto}
        .phab-admin-header{padding:14px}
      }
      @media (max-width:640px){
        .phab-admin{border-radius:14px}
        .phab-admin-title{font-size:15px}
        .phab-admin-subtitle{font-size:11px}
        .phab-admin-content{padding:8px}
        .phab-admin-games-controls{
          justify-content:flex-start;
        }
        .phab-admin-logs-controls{
          justify-content:flex-start;
        }
        .phab-admin-games-page-info{
          min-width:0;
        }
        .phab-admin-tabs{padding:8px 8px 9px}
        .phab-admin-tab{font-size:10px;padding:7px 10px}
        .phab-admin-modal{
          padding:8px;
          align-items:flex-start;
        }
        .phab-admin-modal-card{max-height:calc(100dvh - 16px)}
        .phab-admin-detail-row{grid-template-columns:1fr}
      }
    `;
    document.head.appendChild(style);
  }

  function createApi(cfg) {
    var roleHeader = cfg.roles.join(',');
    var stationHeader = cfg.stationIds.join(',');

    function buildHeaders(extraHeaders) {
      var headers = Object.assign(
        {
          'x-user-id': cfg.userId,
          'x-user-roles': roleHeader,
          'x-station-ids': stationHeader
        },
        cfg.authHeaders || {},
        extraHeaders || {}
      );

      if (cfg.authToken && !headers.Authorization) {
        headers.Authorization = 'Bearer ' + cfg.authToken;
      }

      return headers;
    }

    async function request(path, method, body) {
      var headers = buildHeaders(body ? { 'Content-Type': 'application/json' } : {});
      var response = await fetch(cfg.apiBaseUrl + path, {
        method: method || 'GET',
        headers: headers,
        credentials: 'same-origin',
        body: body ? JSON.stringify(body) : undefined
      });

      if (!response.ok) {
        var text = await response.text().catch(function () {
          return '';
        });
        if (response.status === 401) {
          throw new Error('Требуется авторизация. Выполните вход снова.');
        }
        throw new Error('HTTP ' + response.status + ': ' + text);
      }

      var contentType = response.headers.get('content-type') || '';
      if (contentType.indexOf('application/json') === -1) {
        return null;
      }
      return response.json();
    }

    return {
      getAllDialogs: function () {
        return request('/support/dialogs', 'GET');
      },
      getLegacyDialogs: function () {
        var query = arguments[0] || {};
        var params = new URLSearchParams();
        if (query.limit !== undefined && query.limit !== null) {
          params.set('limit', String(query.limit));
        }
        if (query.offset !== undefined && query.offset !== null) {
          params.set('offset', String(query.offset));
        }
        if (query.phone) {
          params.set('phone', String(query.phone));
        }
        var suffix = params.toString() ? '?' + params.toString() : '';
        return request('/messenger/dialogs' + suffix, 'GET');
      },
      lookupDialogVivaCabinet: function (dialogId) {
        var phone = arguments.length > 1 ? arguments[1] : undefined;
        var params = new URLSearchParams();
        if (dialogId) {
          params.set('dialogId', String(dialogId));
        }
        if (phone) {
          params.set('phone', String(phone));
        }
        var suffix = params.toString() ? '?' + params.toString() : '';
        return request('/messenger/viva/client-cabinet' + suffix, 'GET');
      },
      getConnectors: function () {
        return request('/support/connectors', 'GET');
      },
      getStations: function (connector) {
        return request('/support/connectors/' + encodeURIComponent(connector) + '/stations', 'GET');
      },
      getDialogs: function (connector, stationId) {
        return request(
          '/support/connectors/' +
            encodeURIComponent(connector) +
            '/stations/' +
            encodeURIComponent(stationId) +
            '/dialogs',
          'GET'
        );
      },
      getMessages: function (dialogId) {
        return request('/support/dialogs/' + encodeURIComponent(dialogId) + '/messages', 'GET');
      },
      getLegacyMessages: function (threadId) {
        var query = arguments[1] || {};
        var params = new URLSearchParams();
        if (query.limit !== undefined && query.limit !== null) {
          params.set('limit', String(query.limit));
        }
        if (query.before) {
          params.set('before', String(query.before));
        }
        if (query.includeService !== undefined && query.includeService !== null) {
          params.set('includeService', query.includeService ? 'true' : 'false');
        }
        var suffix = params.toString() ? '?' + params.toString() : '';
        return request('/messenger/dialogs/' + encodeURIComponent(threadId) + '/messages' + suffix, 'GET');
      },
      getLegacyServiceMessages: function (threadId) {
        var query = arguments[1] || {};
        var params = new URLSearchParams();
        if (query.limit !== undefined && query.limit !== null) {
          params.set('limit', String(query.limit));
        }
        if (query.before) {
          params.set('before', String(query.before));
        }
        var suffix = params.toString() ? '?' + params.toString() : '';
        return request(
          '/messenger/dialogs/' + encodeURIComponent(threadId) + '/service-messages' + suffix,
          'GET'
        );
      },
      sendMessage: function (dialogId, text) {
        return request('/support/dialogs/' + encodeURIComponent(dialogId) + '/reply', 'POST', {
          text: text
        });
      },
      sendLegacyMessage: function (threadId, text) {
        return request('/messenger/dialogs/' + encodeURIComponent(threadId) + '/messages', 'POST', {
          text: text
        });
      },
      setLegacyDialogResolution: function (threadId, resolved) {
        return request(
          '/messenger/dialogs/' + encodeURIComponent(threadId) + '/resolution',
          'PATCH',
          { resolved: resolved === true }
        );
      },
      getAnalytics: function (date) {
        var path = '/support/analytics/daily';
        if (date) {
          path += '?date=' + encodeURIComponent(date);
        }
        return request(path, 'GET');
      },
      getGames: function () {
        return request('/games', 'GET');
      },
      getGameById: function (gameId) {
        return request('/games/' + encodeURIComponent(gameId), 'GET');
      },
      getGameChat: function (gameId) {
        return request('/games/' + encodeURIComponent(gameId) + '/chat', 'GET');
      },
      sendGameChatMessage: function (gameId, text) {
        return request('/games/' + encodeURIComponent(gameId) + '/chat/messages', 'POST', {
          text: text
        });
      },
      getGameEvents: function () {
        var query = arguments[0] || {};
        var params = new URLSearchParams();
        if (query.event) {
          params.set('event', String(query.event));
        }
        if (query.phone) {
          params.set('phone', String(query.phone));
        }
        if (query.from) {
          params.set('from', String(query.from));
        }
        if (query.to) {
          params.set('to', String(query.to));
        }
        if (query.page) {
          params.set('page', String(query.page));
        }
        if (query.pageSize) {
          params.set('pageSize', String(query.pageSize));
        }
        var suffix = params.toString() ? '?' + params.toString() : '';
        return request('/games/events' + suffix, 'GET');
      },
      getGameAnalytics: function () {
        var query = arguments[0] || {};
        var params = new URLSearchParams();
        if (query.from) {
          params.set('from', String(query.from));
        }
        if (query.to) {
          params.set('to', String(query.to));
        }
        var suffix = params.toString() ? '?' + params.toString() : '';
        return request('/games/analytics' + suffix, 'GET');
      },
      getGameEventById: function (eventId) {
        return request('/games/events/' + encodeURIComponent(eventId), 'GET');
      },
      deleteGameEvent: function (eventId) {
        return request('/games/events/' + encodeURIComponent(eventId), 'DELETE');
      },
      getTournaments: function () {
        return request('/tournaments', 'GET');
      },
      getSettings: function () {
        return request('/messenger/settings', 'GET');
      },
      getVivaSettings: function () {
        return request('/messenger/settings/viva', 'GET');
      },
      updateVivaSettings: function (payload) {
        return request('/messenger/settings/viva', 'PATCH', payload);
      },
      getAdminUsers: function () {
        return request('/auth/admin-users', 'GET');
      },
      logout: function () {
        return request('/auth/logout', 'POST');
      },
      createStation: function (payload) {
        return request('/messenger/settings/stations', 'POST', payload);
      },
      updateStation: function (stationId, payload) {
        return request(
          '/messenger/settings/stations/' + encodeURIComponent(stationId),
          'PATCH',
          payload
        );
      },
      createConnector: function (payload) {
        return request('/messenger/settings/connectors', 'POST', payload);
      },
      updateConnector: function (connectorId, payload) {
        return request(
          '/messenger/settings/connectors/' + encodeURIComponent(connectorId),
          'PATCH',
          payload
        );
      },
      createAccessRule: function (payload) {
        return request('/messenger/settings/access-rules', 'POST', payload);
      }
    };
  }

  function formatTime(value) {
    if (!value) {
      return '-';
    }
    var d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      return '-';
    }
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    var mo = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '.' + mo + ' ' + hh + ':' + mm;
  }

  function formatDateInputValue(value) {
    if (!value) {
      return '';
    }
    var d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) {
      return '';
    }
    var year = String(d.getFullYear());
    var month = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function getTodayDateInputValue() {
    return formatDateInputValue(new Date());
  }

  function getMonthStartDateInputValue() {
    var d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return formatDateInputValue(d);
  }

  function formatMoney(value) {
    var amount = Number(value);
    if (!Number.isFinite(amount)) {
      amount = 0;
    }
    return (
      new Intl.NumberFormat('ru-RU', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      }).format(amount) + ' ₽'
    );
  }

  function formatDurationMs(value) {
    if (value == null || Number.isNaN(Number(value))) {
      return '-';
    }
    var totalSeconds = Math.max(0, Math.round(Number(value) / 1000));
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    if (hours > 0) {
      return hours + 'ч ' + minutes + 'м';
    }
    if (minutes > 0) {
      return minutes + 'м ' + seconds + 'с';
    }
    return seconds + 'с';
  }

  function clearNode(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function parseCsvInput(raw) {
    if (!raw) {
      return [];
    }
    return Array.from(
      new Set(
        String(raw)
          .split(',')
          .map(function (item) {
            return item.trim();
          })
          .filter(function (item) {
            return item.length > 0;
          })
      )
    );
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function getConnectorConfigPreset(route) {
    return CONNECTOR_CONFIG_PRESETS[String(route || '').trim().toUpperCase()] || null;
  }

  function cloneObject(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function buildConnectorConfigTemplate(route) {
    var preset = getConnectorConfigPreset(route);
    if (!preset || !isPlainObject(preset.template)) {
      return {};
    }
    return cloneObject(preset.template);
  }

  function formatConnectorConfigGuide(route) {
    var preset = getConnectorConfigPreset(route);
    if (!preset) {
      return 'Для этого route нет предустановленного шаблона. Можно сохранить произвольный JSON-объект.';
    }
    return (
      preset.label +
      ': ' +
      preset.description +
      '\n' +
      preset.fields.map(function (line) {
        return '• ' + line;
      }).join('\n')
    );
  }

  function createRoot(cfg) {
    if (cfg.mountSelector) {
      var mount = document.querySelector(cfg.mountSelector);
      if (mount) {
        return mount;
      }

      if (window.console && console.warn) {
        console.warn(
          '[PHAB admin panel] mountSelector not found, fallback to floating panel:',
          cfg.mountSelector
        );
      }
    }

    var section = document.createElement('section');
    section.style.position = 'fixed';
    section.style.left = '16px';
    section.style.right = '16px';
    section.style.top = '16px';
    section.style.bottom = '16px';
    section.style.zIndex = '2147483002';
    document.body.appendChild(section);
    return section;
  }

  function createLayout(root, cfg) {
    root.innerHTML = '';
    root.classList.add('phab-admin');
    var overlayHost = document.body || root;

    var header = document.createElement('div');
    header.className = 'phab-admin-header';
    root.appendChild(header);

    var heading = document.createElement('div');
    header.appendChild(heading);

    var title = document.createElement('div');
    title.className = 'phab-admin-title';
    title.textContent = cfg.title;
    heading.appendChild(title);

    var subtitle = document.createElement('div');
    subtitle.className = 'phab-admin-subtitle';
    subtitle.textContent = 'Центр управления пространством';
    heading.appendChild(subtitle);

    var toolbar = document.createElement('div');
    toolbar.className = 'phab-admin-toolbar';
    header.appendChild(toolbar);

    var status = document.createElement('span');
    status.className = 'phab-admin-status';
    status.textContent = 'Готово';
    toolbar.appendChild(status);

    var logoutBtn = document.createElement('button');
    logoutBtn.className = 'phab-admin-btn-secondary';
    logoutBtn.type = 'button';
    logoutBtn.textContent = 'Разлогиниться';
    toolbar.appendChild(logoutBtn);

    var refreshBtn = document.createElement('button');
    refreshBtn.className = 'phab-admin-btn';
    refreshBtn.type = 'button';
    refreshBtn.textContent = 'Обновить';
    toolbar.appendChild(refreshBtn);

    var tabs = document.createElement('div');
    tabs.className = 'phab-admin-tabs';
    root.appendChild(tabs);

    var tabMessages = document.createElement('button');
    tabMessages.className = 'phab-admin-tab phab-admin-tab-active';
    tabMessages.type = 'button';
    tabMessages.textContent = 'Диалоги';
    tabs.appendChild(tabMessages);

    var tabGames = document.createElement('button');
    tabGames.className = 'phab-admin-tab';
    tabGames.type = 'button';
    tabGames.textContent = 'Игры';
    tabs.appendChild(tabGames);

    var tabLogs = document.createElement('button');
    tabLogs.className = 'phab-admin-tab';
    tabLogs.type = 'button';
    tabLogs.textContent = 'Логи';
    tabs.appendChild(tabLogs);

    var tabTournaments = document.createElement('button');
    tabTournaments.className = 'phab-admin-tab';
    tabTournaments.type = 'button';
    tabTournaments.textContent = 'Турниры';
    tabs.appendChild(tabTournaments);

    var tabAnalytics = document.createElement('button');
    tabAnalytics.className = 'phab-admin-tab';
    tabAnalytics.type = 'button';
    tabAnalytics.textContent = 'Аналитика';
    tabs.appendChild(tabAnalytics);

    var tabSettings = document.createElement('button');
    tabSettings.className = 'phab-admin-tab';
    tabSettings.type = 'button';
    tabSettings.textContent = 'Настройки';
    tabs.appendChild(tabSettings);

    var content = document.createElement('div');
    content.className = 'phab-admin-content';
    root.appendChild(content);

    var messagesSection = document.createElement('div');
    messagesSection.style.flex = '1';
    messagesSection.style.minHeight = '0';
    messagesSection.style.display = 'flex';
    messagesSection.style.flexDirection = 'column';
    content.appendChild(messagesSection);

    var gamesSection = document.createElement('div');
    gamesSection.className = 'phab-admin-hidden';
    content.appendChild(gamesSection);

    var logsSection = document.createElement('div');
    logsSection.className = 'phab-admin-hidden';
    content.appendChild(logsSection);

    var analyticsSection = document.createElement('div');
    analyticsSection.className = 'phab-admin-hidden';
    content.appendChild(analyticsSection);

    var tournamentsSection = document.createElement('div');
    tournamentsSection.className = 'phab-admin-hidden';
    content.appendChild(tournamentsSection);

    var settingsSection = document.createElement('div');
    settingsSection.className = 'phab-admin-hidden';
    content.appendChild(settingsSection);

    var messagesGrid = document.createElement('div');
    messagesGrid.className = 'phab-admin-msg-grid';
    messagesSection.appendChild(messagesGrid);

    var leftPane = document.createElement('div');
    leftPane.className = 'phab-admin-pane';
    messagesGrid.appendChild(leftPane);

    var leftHead = document.createElement('div');
    leftHead.className = 'phab-admin-pane-head';
    leftPane.appendChild(leftHead);

    var leftHeadTitle = document.createElement('span');
    leftHeadTitle.className = 'phab-admin-pane-head-title';
    leftHeadTitle.textContent = 'Чаты';
    leftHead.appendChild(leftHeadTitle);

    var dialogSearchInput = document.createElement('input');
    dialogSearchInput.className = 'phab-admin-input phab-admin-pane-head-search';
    dialogSearchInput.type = 'search';
    dialogSearchInput.placeholder = 'Поиск по имени или номеру...';
    dialogSearchInput.setAttribute('aria-label', 'Поиск диалогов');
    leftHead.appendChild(dialogSearchInput);

    var dialogFiltersWrap = document.createElement('div');
    dialogFiltersWrap.className = 'phab-admin-dialog-filters-wrap phab-admin-hidden';
    leftPane.appendChild(dialogFiltersWrap);

    var dialogFilters = document.createElement('div');
    dialogFiltersWrap.appendChild(dialogFilters);

    var leftBody = document.createElement('div');
    leftBody.className = 'phab-admin-pane-body phab-admin-chat-list-wrap';
    leftPane.appendChild(leftBody);

    var dialogsList = document.createElement('ul');
    dialogsList.className = 'phab-admin-list';
    leftBody.appendChild(dialogsList);

    var rightPane = document.createElement('div');
    rightPane.className = 'phab-admin-pane';
    messagesGrid.appendChild(rightPane);

    var dialogWrap = document.createElement('div');
    dialogWrap.className = 'phab-admin-dialog-wrap';
    rightPane.appendChild(dialogWrap);

    var dialogHead = document.createElement('div');
    dialogHead.className = 'phab-admin-dialog-head';
    dialogWrap.appendChild(dialogHead);

    var dialogTitle = document.createElement('div');
    dialogTitle.className = 'phab-admin-dialog-title';
    dialogTitle.textContent = 'Диалоги';
    dialogHead.appendChild(dialogTitle);

    var dialogMeta = document.createElement('div');
    dialogMeta.className = 'phab-admin-dialog-meta';
    dialogMeta.textContent = 'Выберите чат, чтобы открыть переписку и будущую ленту действий';
    dialogHead.appendChild(dialogMeta);

    var dialogTags = document.createElement('div');
    dialogTags.className = 'phab-admin-dialog-tags';
    dialogHead.appendChild(dialogTags);

    var dialogOptions = document.createElement('div');
    dialogOptions.className = 'phab-admin-dialog-options';
    dialogOptions.style.display = 'none';
    dialogHead.appendChild(dialogOptions);

    var messageModeWrap = document.createElement('div');
    messageModeWrap.className = 'phab-admin-dialog-option';
    dialogOptions.appendChild(messageModeWrap);

    var messageModeToggleLabel = document.createElement('label');
    messageModeToggleLabel.className = 'phab-admin-switch';
    messageModeWrap.appendChild(messageModeToggleLabel);

    var messageModeToggle = document.createElement('input');
    messageModeToggle.type = 'checkbox';
    messageModeToggle.className = 'phab-admin-switch-input';
    messageModeToggle.checked = false;
    messageModeToggleLabel.appendChild(messageModeToggle);

    var messageModeToggleTrack = document.createElement('span');
    messageModeToggleTrack.className = 'phab-admin-switch-track';
    messageModeToggleLabel.appendChild(messageModeToggleTrack);

    var messageModeToggleText = document.createElement('span');
    messageModeToggleText.className = 'phab-admin-switch-text';
    messageModeToggleText.textContent = 'Показывать служебные сообщения';
    messageModeWrap.appendChild(messageModeToggleText);

    var resolutionWrap = document.createElement('div');
    resolutionWrap.className = 'phab-admin-dialog-option';
    dialogOptions.appendChild(resolutionWrap);

    var resolutionToggleLabel = document.createElement('label');
    resolutionToggleLabel.className = 'phab-admin-switch';
    resolutionWrap.appendChild(resolutionToggleLabel);

    var resolutionToggle = document.createElement('input');
    resolutionToggle.type = 'checkbox';
    resolutionToggle.className = 'phab-admin-switch-input';
    resolutionToggle.checked = false;
    resolutionToggle.disabled = true;
    resolutionToggleLabel.appendChild(resolutionToggle);

    var resolutionToggleTrack = document.createElement('span');
    resolutionToggleTrack.className = 'phab-admin-switch-track';
    resolutionToggleLabel.appendChild(resolutionToggleTrack);

    var resolutionToggleText = document.createElement('span');
    resolutionToggleText.className = 'phab-admin-switch-text';
    resolutionToggleText.textContent = 'Вопрос пользователя решен';
    resolutionWrap.appendChild(resolutionToggleText);

    var dialogBody = document.createElement('div');
    dialogBody.className = 'phab-admin-dialog-body';
    dialogWrap.appendChild(dialogBody);

    var cabinetPane = document.createElement('div');
    cabinetPane.className = 'phab-admin-dialog-cabinet';
    dialogBody.appendChild(cabinetPane);

    var cabinetHead = document.createElement('div');
    cabinetHead.className = 'phab-admin-dialog-cabinet-head';
    cabinetPane.appendChild(cabinetHead);

    var cabinetTitle = document.createElement('div');
    cabinetTitle.className = 'phab-admin-dialog-cabinet-title';
    cabinetTitle.textContent = 'Личный кабинет';
    cabinetHead.appendChild(cabinetTitle);

    var cabinetMeta = document.createElement('div');
    cabinetMeta.className = 'phab-admin-dialog-cabinet-meta';
    cabinetMeta.textContent = 'Выберите чат, чтобы открыть кабинет клиента и встроенное окно Viva CRM.';
    cabinetHead.appendChild(cabinetMeta);

    var dialogLinks = document.createElement('div');
    dialogLinks.className = 'phab-admin-dialog-links';
    dialogLinks.style.display = 'none';
    cabinetHead.appendChild(dialogLinks);

    var vivaCabinetStatus = document.createElement('span');
    vivaCabinetStatus.className = 'phab-admin-dialog-link-status';
    dialogLinks.appendChild(vivaCabinetStatus);

    var vivaCabinetLink = document.createElement('a');
    vivaCabinetLink.className = 'phab-admin-dialog-link';
    vivaCabinetLink.target = '_blank';
    vivaCabinetLink.rel = 'noopener noreferrer';
    vivaCabinetLink.textContent = 'ЛК клиента в Viva CRM';
    dialogLinks.appendChild(vivaCabinetLink);

    var cabinetFrameWrap = document.createElement('div');
    cabinetFrameWrap.className = 'phab-admin-dialog-cabinet-frame-wrap';
    cabinetPane.appendChild(cabinetFrameWrap);

    var cabinetEmpty = document.createElement('div');
    cabinetEmpty.className = 'phab-admin-empty phab-admin-dialog-cabinet-empty';
    cabinetEmpty.textContent = 'Выберите чат слева, чтобы открыть кабинет клиента.';
    cabinetFrameWrap.appendChild(cabinetEmpty);

    var cabinetFrame = document.createElement('iframe');
    cabinetFrame.className = 'phab-admin-dialog-webview';
    cabinetFrame.loading = 'lazy';
    cabinetFrame.style.display = 'none';
    cabinetFrame.setAttribute('title', 'Личный кабинет клиента Viva CRM');
    cabinetFrameWrap.appendChild(cabinetFrame);

    var messagesBox = document.createElement('div');
    messagesBox.className = 'phab-admin-messages';
    dialogBody.appendChild(messagesBox);

    var compose = document.createElement('div');
    compose.className = 'phab-admin-compose';
    dialogWrap.appendChild(compose);

    var input = document.createElement('input');
    input.className = 'phab-admin-input';
    input.type = 'text';
    input.placeholder = 'Ответ сотрудника...';
    input.maxLength = 2000;
    compose.appendChild(input);

    var sendBtn = document.createElement('button');
    sendBtn.className = 'phab-admin-btn';
    sendBtn.type = 'button';
    sendBtn.textContent = 'Отправить';
    compose.appendChild(sendBtn);

    var gamesControls = document.createElement('div');
    gamesControls.className = 'phab-admin-games-controls';

    var gamesPageSizeWrap = document.createElement('label');
    gamesPageSizeWrap.className = 'phab-admin-games-pagesize';
    gamesPageSizeWrap.appendChild(document.createTextNode('Показывать'));
    gamesControls.appendChild(gamesPageSizeWrap);

    var gamesPageSizeSelect = document.createElement('select');
    gamesPageSizeSelect.className = 'phab-admin-settings-input';
    gamesPageSizeSelect.style.width = '84px';
    [{ value: '15', label: '15' }, { value: '50', label: '50' }].forEach(function (entry) {
      var option = document.createElement('option');
      option.value = entry.value;
      option.textContent = entry.label;
      gamesPageSizeSelect.appendChild(option);
    });
    gamesPageSizeWrap.appendChild(gamesPageSizeSelect);
    gamesPageSizeWrap.appendChild(document.createTextNode('игр'));

    var gamesPagination = document.createElement('div');
    gamesPagination.className = 'phab-admin-games-pagination';
    gamesControls.appendChild(gamesPagination);

    var gamesPrevPageBtn = document.createElement('button');
    gamesPrevPageBtn.className = 'phab-admin-btn-secondary';
    gamesPrevPageBtn.type = 'button';
    gamesPrevPageBtn.textContent = '←';
    gamesPagination.appendChild(gamesPrevPageBtn);

    var gamesPageInfo = document.createElement('span');
    gamesPageInfo.className = 'phab-admin-games-page-info';
    gamesPageInfo.textContent = 'Страница 1 из 1';
    gamesPagination.appendChild(gamesPageInfo);

    var gamesNextPageBtn = document.createElement('button');
    gamesNextPageBtn.className = 'phab-admin-btn-secondary';
    gamesNextPageBtn.type = 'button';
    gamesNextPageBtn.textContent = '→';
    gamesPagination.appendChild(gamesNextPageBtn);

    var gamesTableWrap = document.createElement('div');
    gamesTableWrap.className = 'phab-admin-games-table-wrap';
    gamesSection.appendChild(gamesTableWrap);

    var gamesTable = document.createElement('table');
    gamesTable.className = 'phab-admin-games-table';
    gamesTableWrap.appendChild(gamesTable);

    gamesSection.appendChild(gamesControls);

    var logsTableWrap = document.createElement('div');
    logsTableWrap.className = 'phab-admin-games-table-wrap';
    var logsControls = document.createElement('div');
    logsControls.className = 'phab-admin-logs-controls';
    logsSection.appendChild(logsControls);

    var logsFilters = document.createElement('div');
    logsFilters.className = 'phab-admin-logs-filters';
    logsControls.appendChild(logsFilters);

    var logsFromWrap = document.createElement('label');
    logsFromWrap.className = 'phab-admin-logs-filter';
    logsFilters.appendChild(logsFromWrap);

    var logsFromLabel = document.createElement('span');
    logsFromLabel.className = 'phab-admin-settings-label';
    logsFromLabel.textContent = 'С даты';
    logsFromWrap.appendChild(logsFromLabel);

    var logsFromInput = document.createElement('input');
    logsFromInput.className = 'phab-admin-settings-input';
    logsFromInput.type = 'date';
    logsFromInput.style.width = '160px';
    logsFromWrap.appendChild(logsFromInput);

    var logsToWrap = document.createElement('label');
    logsToWrap.className = 'phab-admin-logs-filter';
    logsFilters.appendChild(logsToWrap);

    var logsToLabel = document.createElement('span');
    logsToLabel.className = 'phab-admin-settings-label';
    logsToLabel.textContent = 'По дату';
    logsToWrap.appendChild(logsToLabel);

    var logsToInput = document.createElement('input');
    logsToInput.className = 'phab-admin-settings-input';
    logsToInput.type = 'date';
    logsToInput.style.width = '160px';
    logsToWrap.appendChild(logsToInput);

    var logsEventWrap = document.createElement('label');
    logsEventWrap.className = 'phab-admin-logs-filter';
    logsFilters.appendChild(logsEventWrap);

    var logsEventLabel = document.createElement('span');
    logsEventLabel.className = 'phab-admin-settings-label';
    logsEventLabel.textContent = 'Событие';
    logsEventWrap.appendChild(logsEventLabel);

    var logsEventInput = document.createElement('input');
    logsEventInput.className = 'phab-admin-settings-input';
    logsEventInput.type = 'text';
    logsEventInput.placeholder = 'client_error';
    logsEventInput.style.width = '180px';
    logsEventWrap.appendChild(logsEventInput);

    var logsPhoneWrap = document.createElement('label');
    logsPhoneWrap.className = 'phab-admin-logs-filter';
    logsFilters.appendChild(logsPhoneWrap);

    var logsPhoneLabel = document.createElement('span');
    logsPhoneLabel.className = 'phab-admin-settings-label';
    logsPhoneLabel.textContent = 'Телефон';
    logsPhoneWrap.appendChild(logsPhoneLabel);

    var logsPhoneInput = document.createElement('input');
    logsPhoneInput.className = 'phab-admin-settings-input';
    logsPhoneInput.type = 'text';
    logsPhoneInput.placeholder = '+79991234567';
    logsPhoneInput.style.width = '180px';
    logsPhoneWrap.appendChild(logsPhoneInput);

    var logsApplyBtn = document.createElement('button');
    logsApplyBtn.className = 'phab-admin-btn';
    logsApplyBtn.type = 'button';
    logsApplyBtn.textContent = 'Применить';
    logsFilters.appendChild(logsApplyBtn);

    var logsResetBtn = document.createElement('button');
    logsResetBtn.className = 'phab-admin-btn-secondary';
    logsResetBtn.type = 'button';
    logsResetBtn.textContent = 'Сбросить';
    logsFilters.appendChild(logsResetBtn);

    var logsPagination = document.createElement('div');
    logsPagination.className = 'phab-admin-games-pagination';
    logsControls.appendChild(logsPagination);

    var logsPrevPageBtn = document.createElement('button');
    logsPrevPageBtn.className = 'phab-admin-btn-secondary';
    logsPrevPageBtn.type = 'button';
    logsPrevPageBtn.textContent = '←';
    logsPagination.appendChild(logsPrevPageBtn);

    var logsPageInfo = document.createElement('span');
    logsPageInfo.className = 'phab-admin-games-page-info';
    logsPageInfo.textContent = 'Страница 1 из 1';
    logsPagination.appendChild(logsPageInfo);

    var logsNextPageBtn = document.createElement('button');
    logsNextPageBtn.className = 'phab-admin-btn-secondary';
    logsNextPageBtn.type = 'button';
    logsNextPageBtn.textContent = '→';
    logsPagination.appendChild(logsNextPageBtn);

    logsSection.appendChild(logsTableWrap);

    var logsTable = document.createElement('table');
    logsTable.className = 'phab-admin-games-table';
    logsTableWrap.appendChild(logsTable);

    var analyticsControls = document.createElement('div');
    analyticsControls.className = 'phab-admin-logs-controls';
    analyticsSection.appendChild(analyticsControls);

    var analyticsFilters = document.createElement('div');
    analyticsFilters.className = 'phab-admin-logs-filters';
    analyticsControls.appendChild(analyticsFilters);

    var analyticsFromWrap = document.createElement('label');
    analyticsFromWrap.className = 'phab-admin-logs-filter';
    analyticsFilters.appendChild(analyticsFromWrap);

    var analyticsFromLabel = document.createElement('span');
    analyticsFromLabel.className = 'phab-admin-settings-label';
    analyticsFromLabel.textContent = 'С даты';
    analyticsFromWrap.appendChild(analyticsFromLabel);

    var analyticsFromInput = document.createElement('input');
    analyticsFromInput.className = 'phab-admin-settings-input';
    analyticsFromInput.type = 'date';
    analyticsFromInput.style.width = '160px';
    analyticsFromWrap.appendChild(analyticsFromInput);

    var analyticsToWrap = document.createElement('label');
    analyticsToWrap.className = 'phab-admin-logs-filter';
    analyticsFilters.appendChild(analyticsToWrap);

    var analyticsToLabel = document.createElement('span');
    analyticsToLabel.className = 'phab-admin-settings-label';
    analyticsToLabel.textContent = 'По дату';
    analyticsToWrap.appendChild(analyticsToLabel);

    var analyticsToInput = document.createElement('input');
    analyticsToInput.className = 'phab-admin-settings-input';
    analyticsToInput.type = 'date';
    analyticsToInput.style.width = '160px';
    analyticsToWrap.appendChild(analyticsToInput);

    var analyticsApplyBtn = document.createElement('button');
    analyticsApplyBtn.className = 'phab-admin-btn';
    analyticsApplyBtn.type = 'button';
    analyticsApplyBtn.textContent = 'Применить';
    analyticsFilters.appendChild(analyticsApplyBtn);

    var analyticsResetBtn = document.createElement('button');
    analyticsResetBtn.className = 'phab-admin-btn-secondary';
    analyticsResetBtn.type = 'button';
    analyticsResetBtn.textContent = 'Сбросить';
    analyticsFilters.appendChild(analyticsResetBtn);

    var analyticsTableWrap = document.createElement('div');
    analyticsTableWrap.className = 'phab-admin-games-table-wrap';
    analyticsSection.appendChild(analyticsTableWrap);

    var analyticsTable = document.createElement('table');
    analyticsTable.className = 'phab-admin-games-table';
    analyticsTableWrap.appendChild(analyticsTable);

    var tournamentsTable = document.createElement('table');
    tournamentsTable.className = 'phab-admin-games-table';
    tournamentsSection.appendChild(tournamentsTable);

    var settingsGrid = document.createElement('div');
    settingsGrid.className = 'phab-admin-settings-grid';
    settingsSection.appendChild(settingsGrid);

    var stationCard = document.createElement('div');
    stationCard.className = 'phab-admin-settings-card';
    settingsGrid.appendChild(stationCard);

    var stationHead = document.createElement('div');
    stationHead.className = 'phab-admin-settings-head';
    stationHead.textContent = 'Станции';
    stationCard.appendChild(stationHead);

    var stationList = document.createElement('div');
    stationList.className = 'phab-admin-settings-list';
    stationCard.appendChild(stationList);

    var stationForm = document.createElement('div');
    stationForm.className = 'phab-admin-settings-form';
    stationCard.appendChild(stationForm);

    var stationIdLabel = document.createElement('label');
    stationIdLabel.className = 'phab-admin-settings-label';
    stationIdLabel.textContent = 'Station ID';
    stationForm.appendChild(stationIdLabel);

    var stationIdInput = document.createElement('input');
    stationIdInput.className = 'phab-admin-settings-input';
    stationIdInput.placeholder = 'station-msk-1';
    stationForm.appendChild(stationIdInput);

    var stationNameLabel = document.createElement('label');
    stationNameLabel.className = 'phab-admin-settings-label';
    stationNameLabel.textContent = 'Название станции';
    stationForm.appendChild(stationNameLabel);

    var stationNameInput = document.createElement('input');
    stationNameInput.className = 'phab-admin-settings-input';
    stationNameInput.placeholder = 'Москва #1';
    stationForm.appendChild(stationNameInput);

    var stationActiveWrap = document.createElement('label');
    stationActiveWrap.className = 'phab-admin-check';
    stationForm.appendChild(stationActiveWrap);

    var stationActiveInput = document.createElement('input');
    stationActiveInput.type = 'checkbox';
    stationActiveInput.checked = true;
    stationActiveWrap.appendChild(stationActiveInput);
    stationActiveWrap.appendChild(document.createTextNode('Активна'));

    var stationCreateBtn = document.createElement('button');
    stationCreateBtn.className = 'phab-admin-btn';
    stationCreateBtn.type = 'button';
    stationCreateBtn.textContent = 'Добавить станцию';
    stationForm.appendChild(stationCreateBtn);

    var connectorCard = document.createElement('div');
    connectorCard.className = 'phab-admin-settings-card';
    settingsGrid.appendChild(connectorCard);

    var connectorHead = document.createElement('div');
    connectorHead.className = 'phab-admin-settings-head';
    connectorHead.textContent = 'Коннекторы';
    connectorCard.appendChild(connectorHead);

    var connectorList = document.createElement('div');
    connectorList.className = 'phab-admin-settings-list';
    connectorCard.appendChild(connectorList);

    var connectorForm = document.createElement('div');
    connectorForm.className = 'phab-admin-settings-form';
    connectorCard.appendChild(connectorForm);

    var connectorNameLabel = document.createElement('label');
    connectorNameLabel.className = 'phab-admin-settings-label';
    connectorNameLabel.textContent = 'Название коннектора';
    connectorForm.appendChild(connectorNameLabel);

    var connectorNameInput = document.createElement('input');
    connectorNameInput.className = 'phab-admin-settings-input';
    connectorNameInput.placeholder = 'Telegram Москва';
    connectorForm.appendChild(connectorNameInput);

    var connectorRouteLabel = document.createElement('label');
    connectorRouteLabel.className = 'phab-admin-settings-label';
    connectorRouteLabel.textContent = 'Route';
    connectorForm.appendChild(connectorRouteLabel);

    var connectorRouteInput = document.createElement('select');
    connectorRouteInput.className = 'phab-admin-settings-input';
    CONNECTOR_ROUTES.forEach(function (route) {
      var option = document.createElement('option');
      option.value = route;
      option.textContent = route;
      connectorRouteInput.appendChild(option);
    });
    connectorForm.appendChild(connectorRouteInput);

    var connectorStationsLabel = document.createElement('label');
    connectorStationsLabel.className = 'phab-admin-settings-label';
    connectorStationsLabel.textContent = 'Station IDs (CSV, пусто = все)';
    connectorForm.appendChild(connectorStationsLabel);

    var connectorStationsInput = document.createElement('input');
    connectorStationsInput.className = 'phab-admin-settings-input';
    connectorStationsInput.placeholder = 'station-msk-1, station-spb-1';
    connectorForm.appendChild(connectorStationsInput);

    var connectorConfigLabel = document.createElement('label');
    connectorConfigLabel.className = 'phab-admin-settings-label';
    connectorConfigLabel.textContent = 'Конфиг коннектора (JSON)';
    connectorForm.appendChild(connectorConfigLabel);

    var connectorConfigInput = document.createElement('textarea');
    connectorConfigInput.className = 'phab-admin-settings-input';
    connectorConfigInput.rows = 8;
    connectorConfigInput.placeholder = '{"inboundEnabled":true}';
    connectorConfigInput.style.fontFamily = 'monospace';
    connectorConfigInput.style.fontSize = '12px';
    connectorForm.appendChild(connectorConfigInput);

    var connectorConfigTemplateBtn = document.createElement('button');
    connectorConfigTemplateBtn.className = 'phab-admin-btn-secondary';
    connectorConfigTemplateBtn.type = 'button';
    connectorConfigTemplateBtn.textContent = 'Подставить шаблон';
    connectorForm.appendChild(connectorConfigTemplateBtn);

    var connectorConfigGuide = document.createElement('div');
    connectorConfigGuide.className = 'phab-admin-settings-row-meta';
    connectorConfigGuide.style.whiteSpace = 'pre-wrap';
    connectorForm.appendChild(connectorConfigGuide);

    var connectorActiveWrap = document.createElement('label');
    connectorActiveWrap.className = 'phab-admin-check';
    connectorForm.appendChild(connectorActiveWrap);

    var connectorActiveInput = document.createElement('input');
    connectorActiveInput.type = 'checkbox';
    connectorActiveInput.checked = true;
    connectorActiveWrap.appendChild(connectorActiveInput);
    connectorActiveWrap.appendChild(document.createTextNode('Активен'));

    var connectorCreateBtn = document.createElement('button');
    connectorCreateBtn.className = 'phab-admin-btn';
    connectorCreateBtn.type = 'button';
    connectorCreateBtn.textContent = 'Создать коннектор';
    connectorForm.appendChild(connectorCreateBtn);

    var accessCard = document.createElement('div');
    accessCard.className = 'phab-admin-settings-card';
    settingsGrid.appendChild(accessCard);

    var accessHead = document.createElement('div');
    accessHead.className = 'phab-admin-settings-head';
    accessHead.textContent = 'Права доступа';
    accessCard.appendChild(accessHead);

    var accessList = document.createElement('div');
    accessList.className = 'phab-admin-settings-list';
    accessCard.appendChild(accessList);

    var accessForm = document.createElement('div');
    accessForm.className = 'phab-admin-settings-form';
    accessCard.appendChild(accessForm);

    var accessRoleLabel = document.createElement('label');
    accessRoleLabel.className = 'phab-admin-settings-label';
    accessRoleLabel.textContent = 'Роль';
    accessForm.appendChild(accessRoleLabel);

    var accessRoleInput = document.createElement('select');
    accessRoleInput.className = 'phab-admin-settings-input';
    ROLE_OPTIONS.forEach(function (role) {
      var option = document.createElement('option');
      option.value = role;
      option.textContent = role;
      accessRoleInput.appendChild(option);
    });
    accessForm.appendChild(accessRoleInput);

    var accessStationsLabel = document.createElement('label');
    accessStationsLabel.className = 'phab-admin-settings-label';
    accessStationsLabel.textContent = 'Station IDs (CSV, пусто = все)';
    accessForm.appendChild(accessStationsLabel);

    var accessStationsInput = document.createElement('input');
    accessStationsInput.className = 'phab-admin-settings-input';
    accessStationsInput.placeholder = 'station-msk-1, station-spb-1';
    accessForm.appendChild(accessStationsInput);

    var accessRoutesLabel = document.createElement('label');
    accessRoutesLabel.className = 'phab-admin-settings-label';
    accessRoutesLabel.textContent = 'Connector routes (CSV, пусто = все)';
    accessForm.appendChild(accessRoutesLabel);

    var accessRoutesInput = document.createElement('input');
    accessRoutesInput.className = 'phab-admin-settings-input';
    accessRoutesInput.placeholder = 'TG_BOT, MAX_BOT, MAX_ACADEMY_BOT';
    accessForm.appendChild(accessRoutesInput);

    var accessReadWrap = document.createElement('label');
    accessReadWrap.className = 'phab-admin-check';
    accessForm.appendChild(accessReadWrap);

    var accessReadInput = document.createElement('input');
    accessReadInput.type = 'checkbox';
    accessReadInput.checked = true;
    accessReadWrap.appendChild(accessReadInput);
    accessReadWrap.appendChild(document.createTextNode('canRead'));

    var accessWriteWrap = document.createElement('label');
    accessWriteWrap.className = 'phab-admin-check';
    accessForm.appendChild(accessWriteWrap);

    var accessWriteInput = document.createElement('input');
    accessWriteInput.type = 'checkbox';
    accessWriteInput.checked = false;
    accessWriteWrap.appendChild(accessWriteInput);
    accessWriteWrap.appendChild(document.createTextNode('canWrite'));

    var accessCreateBtn = document.createElement('button');
    accessCreateBtn.className = 'phab-admin-btn';
    accessCreateBtn.type = 'button';
    accessCreateBtn.textContent = 'Добавить правило';
    accessForm.appendChild(accessCreateBtn);

    var vivaCard = document.createElement('div');
    vivaCard.className = 'phab-admin-settings-card';
    settingsGrid.appendChild(vivaCard);

    var vivaHead = document.createElement('div');
    vivaHead.className = 'phab-admin-settings-head';
    vivaHead.textContent = 'Viva CRM';
    vivaCard.appendChild(vivaHead);

    var vivaList = document.createElement('div');
    vivaList.className = 'phab-admin-settings-list';
    vivaCard.appendChild(vivaList);

    var vivaForm = document.createElement('div');
    vivaForm.className = 'phab-admin-settings-form';
    vivaCard.appendChild(vivaForm);

    var vivaBaseUrlLabel = document.createElement('label');
    vivaBaseUrlLabel.className = 'phab-admin-settings-label';
    vivaBaseUrlLabel.textContent = 'API Base URL';
    vivaForm.appendChild(vivaBaseUrlLabel);

    var vivaBaseUrlInput = document.createElement('input');
    vivaBaseUrlInput.className = 'phab-admin-settings-input';
    vivaBaseUrlInput.placeholder = 'https://api.vivacrm.ru';
    vivaForm.appendChild(vivaBaseUrlInput);

    var vivaTokenUrlLabel = document.createElement('label');
    vivaTokenUrlLabel.className = 'phab-admin-settings-label';
    vivaTokenUrlLabel.textContent = 'Token URL';
    vivaForm.appendChild(vivaTokenUrlLabel);

    var vivaTokenUrlInput = document.createElement('input');
    vivaTokenUrlInput.className = 'phab-admin-settings-input';
    vivaTokenUrlInput.placeholder = 'https://kc.vivacrm.ru/realms/prod/protocol/openid-connect/token';
    vivaForm.appendChild(vivaTokenUrlInput);

    var vivaClientIdLabel = document.createElement('label');
    vivaClientIdLabel.className = 'phab-admin-settings-label';
    vivaClientIdLabel.textContent = 'Client ID';
    vivaForm.appendChild(vivaClientIdLabel);

    var vivaClientIdInput = document.createElement('input');
    vivaClientIdInput.className = 'phab-admin-settings-input';
    vivaClientIdInput.placeholder = 'React-auth-dev';
    vivaForm.appendChild(vivaClientIdInput);

    var vivaUsernameLabel = document.createElement('label');
    vivaUsernameLabel.className = 'phab-admin-settings-label';
    vivaUsernameLabel.textContent = 'Username';
    vivaForm.appendChild(vivaUsernameLabel);

    var vivaUsernameInput = document.createElement('input');
    vivaUsernameInput.className = 'phab-admin-settings-input';
    vivaUsernameInput.placeholder = 'it@example.com';
    vivaForm.appendChild(vivaUsernameInput);

    var vivaStaticTokenLabel = document.createElement('label');
    vivaStaticTokenLabel.className = 'phab-admin-settings-label';
    vivaStaticTokenLabel.textContent = 'Статический token';
    vivaForm.appendChild(vivaStaticTokenLabel);

    var vivaStaticTokenInput = document.createElement('input');
    vivaStaticTokenInput.className = 'phab-admin-settings-input';
    vivaStaticTokenInput.type = 'password';
    vivaStaticTokenInput.placeholder = 'Оставьте пустым, чтобы не менять';
    vivaForm.appendChild(vivaStaticTokenInput);

    var vivaPasswordLabel = document.createElement('label');
    vivaPasswordLabel.className = 'phab-admin-settings-label';
    vivaPasswordLabel.textContent = 'Password grant password';
    vivaForm.appendChild(vivaPasswordLabel);

    var vivaPasswordInput = document.createElement('input');
    vivaPasswordInput.className = 'phab-admin-settings-input';
    vivaPasswordInput.type = 'password';
    vivaPasswordInput.placeholder = 'Оставьте пустым, чтобы не менять';
    vivaForm.appendChild(vivaPasswordInput);

    var vivaSaveBtn = document.createElement('button');
    vivaSaveBtn.className = 'phab-admin-btn';
    vivaSaveBtn.type = 'button';
    vivaSaveBtn.textContent = 'Сохранить Viva';
    vivaForm.appendChild(vivaSaveBtn);

    var staffCard = document.createElement('div');
    staffCard.className = 'phab-admin-settings-card';
    settingsGrid.appendChild(staffCard);

    var staffHead = document.createElement('div');
    staffHead.className = 'phab-admin-settings-head';
    staffHead.textContent = 'Админы и управляющие';
    staffCard.appendChild(staffHead);

    var staffList = document.createElement('div');
    staffList.className = 'phab-admin-settings-list';
    staffCard.appendChild(staffList);

    var staffNote = document.createElement('div');
    staffNote.className = 'phab-admin-settings-form';
    staffCard.appendChild(staffNote);

    var staffInfo = document.createElement('div');
    staffInfo.className = 'phab-admin-settings-row-meta';
    staffInfo.textContent =
      'Список собран из текущей auth-конфигурации. Здесь видны суперадмины, управляющие и админы станций с их зонами доступа.';
    staffNote.appendChild(staffInfo);

    var gameModal = document.createElement('div');
    gameModal.className = 'phab-admin-modal phab-admin-hidden';
    overlayHost.appendChild(gameModal);

    var gameModalCard = document.createElement('div');
    gameModalCard.className = 'phab-admin-modal-card';
    gameModal.appendChild(gameModalCard);

    var gameModalHead = document.createElement('div');
    gameModalHead.className = 'phab-admin-modal-head';
    gameModalCard.appendChild(gameModalHead);

    var gameModalTitle = document.createElement('div');
    gameModalTitle.className = 'phab-admin-modal-title';
    gameModalTitle.textContent = 'Игра';
    gameModalHead.appendChild(gameModalTitle);

    var gameModalCloseBtn = document.createElement('button');
    gameModalCloseBtn.className = 'phab-admin-modal-close';
    gameModalCloseBtn.type = 'button';
    gameModalCloseBtn.textContent = '×';
    gameModalHead.appendChild(gameModalCloseBtn);

    var gameModalBody = document.createElement('div');
    gameModalBody.className = 'phab-admin-modal-body';
    gameModalCard.appendChild(gameModalBody);

    var eventModal = document.createElement('div');
    eventModal.className = 'phab-admin-modal phab-admin-hidden';
    overlayHost.appendChild(eventModal);

    var eventModalCard = document.createElement('div');
    eventModalCard.className = 'phab-admin-modal-card';
    eventModal.appendChild(eventModalCard);

    var eventModalHead = document.createElement('div');
    eventModalHead.className = 'phab-admin-modal-head';
    eventModalCard.appendChild(eventModalHead);

    var eventModalTitle = document.createElement('div');
    eventModalTitle.className = 'phab-admin-modal-title';
    eventModalTitle.textContent = 'Событие';
    eventModalHead.appendChild(eventModalTitle);

    var eventModalActions = document.createElement('div');
    eventModalActions.className = 'phab-admin-modal-actions';
    eventModalHead.appendChild(eventModalActions);

    var eventDeleteBtn = document.createElement('button');
    eventDeleteBtn.className = 'phab-admin-btn-danger';
    eventDeleteBtn.type = 'button';
    eventDeleteBtn.textContent = 'Удалить лог';
    eventModalActions.appendChild(eventDeleteBtn);

    var eventModalCloseBtn = document.createElement('button');
    eventModalCloseBtn.className = 'phab-admin-modal-close';
    eventModalCloseBtn.type = 'button';
    eventModalCloseBtn.textContent = '×';
    eventModalActions.appendChild(eventModalCloseBtn);

    var eventModalBody = document.createElement('div');
    eventModalBody.className = 'phab-admin-modal-body';
    eventModalCard.appendChild(eventModalBody);

    var gameChatModal = document.createElement('div');
    gameChatModal.className = 'phab-admin-modal phab-admin-hidden';
    overlayHost.appendChild(gameChatModal);

    var gameChatCard = document.createElement('div');
    gameChatCard.className = 'phab-admin-modal-card';
    gameChatModal.appendChild(gameChatCard);

    var gameChatHead = document.createElement('div');
    gameChatHead.className = 'phab-admin-modal-head';
    gameChatCard.appendChild(gameChatHead);

    var gameChatTitleWrap = document.createElement('div');
    gameChatHead.appendChild(gameChatTitleWrap);

    var gameChatTitle = document.createElement('div');
    gameChatTitle.className = 'phab-admin-modal-title';
    gameChatTitle.textContent = 'Чат игры';
    gameChatTitleWrap.appendChild(gameChatTitle);

    var gameChatMeta = document.createElement('div');
    gameChatMeta.className = 'phab-admin-game-chat-meta';
    gameChatMeta.textContent = '-';
    gameChatTitleWrap.appendChild(gameChatMeta);

    var gameChatCloseBtn = document.createElement('button');
    gameChatCloseBtn.className = 'phab-admin-modal-close';
    gameChatCloseBtn.type = 'button';
    gameChatCloseBtn.textContent = '×';
    gameChatHead.appendChild(gameChatCloseBtn);

    var gameChatBox = document.createElement('div');
    gameChatBox.className = 'phab-admin-messages phab-admin-game-chat-box';
    gameChatCard.appendChild(gameChatBox);

    var gameChatCompose = document.createElement('div');
    gameChatCompose.className = 'phab-admin-game-chat-compose';
    gameChatCard.appendChild(gameChatCompose);

    var gameChatInput = document.createElement('input');
    gameChatInput.className = 'phab-admin-input';
    gameChatInput.type = 'text';
    gameChatInput.maxLength = 2000;
    gameChatInput.placeholder = 'Ответ в чат игры...';
    gameChatCompose.appendChild(gameChatInput);

    var gameChatSendBtn = document.createElement('button');
    gameChatSendBtn.className = 'phab-admin-btn';
    gameChatSendBtn.type = 'button';
    gameChatSendBtn.textContent = 'Отправить';
    gameChatCompose.appendChild(gameChatSendBtn);

    return {
      root: root,
      status: status,
      logoutBtn: logoutBtn,
      refreshBtn: refreshBtn,
      tabMessages: tabMessages,
      tabGames: tabGames,
      tabLogs: tabLogs,
      tabAnalytics: tabAnalytics,
      tabTournaments: tabTournaments,
      tabSettings: tabSettings,
      messagesSection: messagesSection,
      gamesSection: gamesSection,
      logsSection: logsSection,
      analyticsSection: analyticsSection,
      tournamentsSection: tournamentsSection,
      settingsSection: settingsSection,
      dialogSearchInput: dialogSearchInput,
      dialogFiltersWrap: dialogFiltersWrap,
      dialogFilters: dialogFilters,
      dialogsScrollBody: leftBody,
      dialogsList: dialogsList,
      dialogTitle: dialogTitle,
      dialogMeta: dialogMeta,
      dialogLinks: dialogLinks,
      dialogOptions: dialogOptions,
      messageModeToggle: messageModeToggle,
      resolutionWrap: resolutionWrap,
      resolutionToggle: resolutionToggle,
      resolutionToggleText: resolutionToggleText,
      vivaCabinetStatus: vivaCabinetStatus,
      vivaCabinetLink: vivaCabinetLink,
      cabinetMeta: cabinetMeta,
      cabinetEmpty: cabinetEmpty,
      cabinetFrame: cabinetFrame,
      dialogTags: dialogTags,
      messagesBox: messagesBox,
      input: input,
      sendBtn: sendBtn,
      gameModal: gameModal,
      gameModalCard: gameModalCard,
      gameModalTitle: gameModalTitle,
      gameModalBody: gameModalBody,
      gameModalCloseBtn: gameModalCloseBtn,
      eventModal: eventModal,
      eventModalCard: eventModalCard,
      eventModalTitle: eventModalTitle,
      eventModalBody: eventModalBody,
      eventDeleteBtn: eventDeleteBtn,
      eventModalCloseBtn: eventModalCloseBtn,
      gameChatModal: gameChatModal,
      gameChatCard: gameChatCard,
      gameChatTitle: gameChatTitle,
      gameChatMeta: gameChatMeta,
      gameChatBox: gameChatBox,
      gameChatCloseBtn: gameChatCloseBtn,
      gameChatInput: gameChatInput,
      gameChatSendBtn: gameChatSendBtn,
      gamesPageSizeSelect: gamesPageSizeSelect,
      gamesPrevPageBtn: gamesPrevPageBtn,
      gamesNextPageBtn: gamesNextPageBtn,
      gamesPageInfo: gamesPageInfo,
      gamesTable: gamesTable,
      logsFromInput: logsFromInput,
      logsToInput: logsToInput,
      logsEventInput: logsEventInput,
      logsPhoneInput: logsPhoneInput,
      logsApplyBtn: logsApplyBtn,
      logsResetBtn: logsResetBtn,
      logsPrevPageBtn: logsPrevPageBtn,
      logsNextPageBtn: logsNextPageBtn,
      logsPageInfo: logsPageInfo,
      logsTable: logsTable,
      analyticsFromInput: analyticsFromInput,
      analyticsToInput: analyticsToInput,
      analyticsApplyBtn: analyticsApplyBtn,
      analyticsResetBtn: analyticsResetBtn,
      analyticsTable: analyticsTable,
      tournamentsTable: tournamentsTable,
      stationList: stationList,
      stationIdInput: stationIdInput,
      stationNameInput: stationNameInput,
      stationActiveInput: stationActiveInput,
      stationCreateBtn: stationCreateBtn,
      connectorList: connectorList,
      connectorNameInput: connectorNameInput,
      connectorRouteInput: connectorRouteInput,
      connectorStationsInput: connectorStationsInput,
      connectorConfigInput: connectorConfigInput,
      connectorConfigTemplateBtn: connectorConfigTemplateBtn,
      connectorConfigGuide: connectorConfigGuide,
      connectorActiveInput: connectorActiveInput,
      connectorCreateBtn: connectorCreateBtn,
      accessList: accessList,
      accessRoleInput: accessRoleInput,
      accessStationsInput: accessStationsInput,
      accessRoutesInput: accessRoutesInput,
      accessReadInput: accessReadInput,
      accessWriteInput: accessWriteInput,
      accessCreateBtn: accessCreateBtn,
      vivaCard: vivaCard,
      vivaList: vivaList,
      vivaBaseUrlInput: vivaBaseUrlInput,
      vivaTokenUrlInput: vivaTokenUrlInput,
      vivaClientIdInput: vivaClientIdInput,
      vivaUsernameInput: vivaUsernameInput,
      vivaStaticTokenInput: vivaStaticTokenInput,
      vivaPasswordInput: vivaPasswordInput,
      vivaSaveBtn: vivaSaveBtn,
      staffList: staffList
    };
  }

  function createListButton(title, meta, onClick, active) {
    var li = document.createElement('li');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'phab-admin-list-btn' + (active ? ' phab-admin-list-btn-active' : '');
    btn.addEventListener('click', onClick);
    li.appendChild(btn);

    var titleEl = document.createElement('div');
    titleEl.className = 'phab-admin-list-title';
    titleEl.textContent = title;
    btn.appendChild(titleEl);

    var metaEl = document.createElement('div');
    metaEl.className = 'phab-admin-list-meta';
    metaEl.textContent = meta;
    btn.appendChild(metaEl);
    return li;
  }

  function formatStationScope(stationIds) {
    if (!Array.isArray(stationIds) || stationIds.length === 0) {
      return 'все станции';
    }
    return stationIds.join(', ');
  }

  function formatRoleLabel(role) {
    if (role === 'SUPER_ADMIN') {
      return 'Суперадмин';
    }
    if (role === 'MANAGER') {
      return 'Управляющий';
    }
    if (role === 'STATION_ADMIN') {
      return 'Админ станции';
    }
    if (role === 'SUPPORT') {
      return 'Поддержка';
    }
    return role;
  }

  function hasRole(cfg, role) {
    return Boolean(cfg && Array.isArray(cfg.roles) && cfg.roles.indexOf(role) >= 0);
  }

  function hasAnyRole(cfg, roles) {
    return Array.isArray(roles)
      ? roles.some(function (role) {
          return hasRole(cfg, role);
        })
      : false;
  }

  function isRestrictedStationAdminConfig(cfg) {
    if (!hasRole(cfg, 'STATION_ADMIN')) {
      return false;
    }

    return !hasAnyRole(cfg, [
      'SUPER_ADMIN',
      'MANAGER',
      'SUPPORT',
      'GAME_MANAGER',
      'TOURNAMENT_MANAGER'
    ]);
  }

  function canManageVivaSettings(cfg) {
    return hasAnyRole(cfg, ['SUPER_ADMIN', 'MANAGER']);
  }

  function canToggleSystemMessages(cfg) {
    return hasAnyRole(cfg, ['SUPER_ADMIN', 'MANAGER', 'STATION_ADMIN']);
  }

  var DIALOG_FILTER_NO_STATION = '__NO_STATION__';
  var DIALOG_FILTER_NO_PHONE = '__NO_PHONE__';
  var STORAGE_KEY_INCLUDE_SERVICE_MESSAGES = 'phab_admin_include_service_messages';
  var STORAGE_KEY_MESSAGE_VIEW_MODE_LEGACY = 'phab_admin_message_view_mode';

  function loadStoredIncludeServiceMessages(fallbackValue) {
    try {
      var raw = String(window.localStorage.getItem(STORAGE_KEY_INCLUDE_SERVICE_MESSAGES) || '')
        .trim()
        .toLowerCase();
      if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') {
        return true;
      }
      if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') {
        return false;
      }

      var legacyRaw = String(window.localStorage.getItem(STORAGE_KEY_MESSAGE_VIEW_MODE_LEGACY) || '')
        .trim()
        .toLowerCase();
      if (legacyRaw === 'service') {
        return true;
      }
      if (legacyRaw === 'regular') {
        return false;
      }
    } catch (_error) {
      // ignore storage errors
    }
    return fallbackValue === true;
  }

  function saveStoredIncludeServiceMessages(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY_INCLUDE_SERVICE_MESSAGES, value ? 'true' : 'false');
      window.localStorage.removeItem(STORAGE_KEY_MESSAGE_VIEW_MODE_LEGACY);
    } catch (_error) {
      // ignore storage errors
    }
  }

  function panelInstance(rawConfig) {
    var cfg = normalizeConfig(rawConfig);
    ensureStyle();

    var root = createRoot(cfg);
    var dom = createLayout(root, cfg);
    var api = createApi(cfg);
    var pollTimer = null;
    var dialogSearchTimer = null;
    var documentKeydownHandler = null;
    var isRestrictedStationAdmin = isRestrictedStationAdminConfig(cfg);
    var DIALOGS_PAGE_SIZE = 30;
    var DIALOGS_SCROLL_THRESHOLD_PX = 140;
    var MESSAGES_PAGE_SIZE = 120;

    var state = {
      activeTab: 'messages',
      allDialogs: [],
      loading: false,
      dialogs: [],
      dialogPageSize: DIALOGS_PAGE_SIZE,
      hasMoreDialogs: true,
      dialogsLoadingMore: false,
      dialogsSignature: '',
      dialogsHydrated: false,
      dialogSearchQuery: '',
      dialogSearchPhoneDigits: '',
      dialogStationFilters: [],
      dialogFilterOptions: [],
      messagePageSize: MESSAGES_PAGE_SIZE,
      rawMessages: [],
      messages: [],
      messagesSignature: '',
      messagesThreadId: null,
      messagesLoading: false,
      messagesLoadingThreadId: null,
      messagesCacheByThreadId: Object.create(null),
      messagesFetchPromisesByThreadId: Object.create(null),
      vivaLookupPromisesByDialogId: Object.create(null),
      games: [],
      gameEvents: [],
      analytics: [],
      analyticsTotals: {
        gamesCount: 0,
        playersAddedCount: 0,
        paymentsAmount: 0
      },
      gamesSortField: 'createdAt',
      gamesSortDirection: 'desc',
      gamesPageSize: 15,
      gamesPage: 1,
      gamesColumnWidths: {},
      gameEventsColumnWidths: {},
      analyticsColumnWidths: {},
      gameEventsPageSize: 30,
      gameEventsPage: 1,
      gameEventsTotal: 0,
      gameEventsTotalPages: 1,
      gameEventsFilterEvent: '',
      gameEventsFilterPhone: '',
      gameEventsFilterFrom: '',
      gameEventsFilterTo: '',
      analyticsFilterFrom: getMonthStartDateInputValue(),
      analyticsFilterTo: getTodayDateInputValue(),
      tournaments: [],
      tournamentsColumnWidths: {},
      tournamentsColumnWidths: {},
      settings: {
        stations: [],
        connectors: [],
        accessRules: [],
        adminUsers: [],
        viva: null
      },
      selectedGameId: null,
      selectedGame: null,
      selectedGameEventId: null,
      selectedGameEvent: null,
      deletingGameEvent: false,
      gameChatGameId: null,
      gameChatThreadId: null,
      selectedThreadId: null,
      includeServiceMessages: loadStoredIncludeServiceMessages(false),
      updatingResolution: false
    };
    if (!canToggleSystemMessages(cfg)) {
      state.includeServiceMessages = false;
    }
    var incomingSoundState = {
      context: null,
      unlockBound: false,
      unlocked: false,
      lastPlayAt: 0
    };
    dom.gamesPageSizeSelect.value = String(state.gamesPageSize);
    dom.dialogSearchInput.value = state.dialogSearchQuery;
    dom.messageModeToggle.checked = state.includeServiceMessages === true;
    dom.resolutionToggle.checked = false;
    dom.resolutionToggle.disabled = true;
    dom.logsEventInput.value = state.gameEventsFilterEvent;
    dom.logsPhoneInput.value = state.gameEventsFilterPhone;
    dom.logsFromInput.value = state.gameEventsFilterFrom;
    dom.logsToInput.value = state.gameEventsFilterTo;
    dom.analyticsFromInput.value = state.analyticsFilterFrom;
    dom.analyticsToInput.value = state.analyticsFilterTo;

    function setStatus(text, isError) {
      dom.status.textContent = text;
      dom.status.className = isError
        ? 'phab-admin-status phab-admin-status-error'
        : 'phab-admin-status';
    }

    function getAudioContextConstructor() {
      return window.AudioContext || window.webkitAudioContext || null;
    }

    function getIncomingSoundContext() {
      if (incomingSoundState.context) {
        return incomingSoundState.context;
      }
      var AudioContextCtor = getAudioContextConstructor();
      if (!AudioContextCtor) {
        return null;
      }
      try {
        incomingSoundState.context = new AudioContextCtor();
      } catch (_error) {
        incomingSoundState.context = null;
      }
      return incomingSoundState.context;
    }

    function markIncomingSoundUnlocked(context) {
      incomingSoundState.unlocked = Boolean(context && context.state === 'running');
      return incomingSoundState.unlocked;
    }

    function tryUnlockIncomingSound() {
      var context = getIncomingSoundContext();
      if (!context) {
        return;
      }
      if (context.state === 'running') {
        markIncomingSoundUnlocked(context);
        return;
      }
      if (typeof context.resume !== 'function') {
        return;
      }
      context
        .resume()
        .then(function () {
          markIncomingSoundUnlocked(context);
        })
        .catch(function () {
          // ignore unlock errors
        });
    }

    function bindIncomingSoundUnlock() {
      if (incomingSoundState.unlockBound) {
        return;
      }
      incomingSoundState.unlockBound = true;
      ['pointerdown', 'touchstart', 'keydown'].forEach(function (eventName) {
        document.addEventListener(eventName, tryUnlockIncomingSound, {
          passive: true
        });
      });
    }

    function createNoiseBuffer(context, durationSec) {
      var frameCount = Math.max(1, Math.floor(context.sampleRate * durationSec));
      var buffer = context.createBuffer(1, frameCount, context.sampleRate);
      var data = buffer.getChannelData(0);
      for (var index = 0; index < frameCount; index += 1) {
        data[index] = Math.random() * 2 - 1;
      }
      return buffer;
    }

    function playIncomingMessageSound() {
      var nowTs = Date.now();
      if (nowTs - incomingSoundState.lastPlayAt < 1200) {
        return;
      }

      var context = getIncomingSoundContext();
      if (!context) {
        return;
      }
      if (!incomingSoundState.unlocked && context.state !== 'running') {
        return;
      }
      if (context.state === 'suspended') {
        tryUnlockIncomingSound();
        return;
      }

      incomingSoundState.lastPlayAt = nowTs;

      var startAt = context.currentTime + 0.01;
      var master = context.createGain();
      master.gain.setValueAtTime(0.36, startAt);
      master.connect(context.destination);

      var bodyOsc = context.createOscillator();
      var bodyGain = context.createGain();
      bodyOsc.type = 'triangle';
      bodyOsc.frequency.setValueAtTime(240, startAt);
      bodyOsc.frequency.exponentialRampToValueAtTime(105, startAt + 0.08);
      bodyGain.gain.setValueAtTime(0.0001, startAt);
      bodyGain.gain.exponentialRampToValueAtTime(0.22, startAt + 0.004);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.09);
      bodyOsc.connect(bodyGain);
      bodyGain.connect(master);
      bodyOsc.start(startAt);
      bodyOsc.stop(startAt + 0.1);

      var snapOsc = context.createOscillator();
      var snapGain = context.createGain();
      snapOsc.type = 'square';
      snapOsc.frequency.setValueAtTime(1200, startAt);
      snapOsc.frequency.exponentialRampToValueAtTime(360, startAt + 0.03);
      snapGain.gain.setValueAtTime(0.0001, startAt);
      snapGain.gain.exponentialRampToValueAtTime(0.09, startAt + 0.002);
      snapGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.035);
      snapOsc.connect(snapGain);
      snapGain.connect(master);
      snapOsc.start(startAt);
      snapOsc.stop(startAt + 0.04);

      var noise = context.createBufferSource();
      var noiseFilter = context.createBiquadFilter();
      var noiseGain = context.createGain();
      noise.buffer = createNoiseBuffer(context, 0.05);
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(1400, startAt);
      noiseFilter.Q.setValueAtTime(0.8, startAt);
      noiseGain.gain.setValueAtTime(0.0001, startAt);
      noiseGain.gain.exponentialRampToValueAtTime(0.06, startAt + 0.001);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.05);
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(master);
      noise.start(startAt);
      noise.stop(startAt + 0.05);
    }

    function shouldPlayIncomingDialogsSound(previousDialogs, nextDialogs) {
      if (!state.dialogsHydrated) {
        return false;
      }

      var prevMap = {};
      (Array.isArray(previousDialogs) ? previousDialogs : []).forEach(function (dialog) {
        if (dialog && dialog.dialogId) {
          prevMap[dialog.dialogId] = dialog;
        }
      });

      return (Array.isArray(nextDialogs) ? nextDialogs : []).some(function (dialog) {
        if (!dialog || !dialog.dialogId) {
          return false;
        }

        var previous = prevMap[dialog.dialogId];
        var senderRole = String(dialog.lastMessageSenderRole || '').toUpperCase();

        if (!previous) {
          return (
            senderRole === 'CLIENT' ||
            Number(dialog.unreadCount || 0) > 0 ||
            Number(dialog.pendingClientMessagesCount || 0) > 0
          );
        }

        var lastMessageChanged =
          String(dialog.lastMessageAt || '') !== String(previous.lastMessageAt || '') ||
          String(dialog.lastMessageText || '') !== String(previous.lastMessageText || '');
        if (!lastMessageChanged) {
          return false;
        }

        var unreadIncreased =
          Number(dialog.unreadCount || 0) > Number(previous.unreadCount || 0);
        var pendingIncreased =
          Number(dialog.pendingClientMessagesCount || 0) >
          Number(previous.pendingClientMessagesCount || 0);

        return senderRole === 'CLIENT' || unreadIncreased || pendingIncreased;
      });
    }

    function getSelectedDialog() {
      for (var i = 0; i < state.dialogs.length; i += 1) {
        if (state.dialogs[i].dialogId === state.selectedThreadId) {
          return state.dialogs[i];
        }
      }
      return null;
    }

    function getDialogCabinetUrl(dialog) {
      if (!dialog) {
        return '';
      }
      if (
        dialog.settings &&
        typeof dialog.settings.vivaCabinetUrl === 'string' &&
        String(dialog.settings.vivaCabinetUrl).trim()
      ) {
        return String(dialog.settings.vivaCabinetUrl).trim();
      }
      return typeof dialog.vivaCabinetUrl === 'string'
        ? String(dialog.vivaCabinetUrl).trim()
        : '';
    }

    function getDialogVivaStatus(dialog) {
      if (!dialog) {
        return '';
      }
      if (
        dialog.settings &&
        typeof dialog.settings.vivaStatus === 'string' &&
        String(dialog.settings.vivaStatus).trim()
      ) {
        return String(dialog.settings.vivaStatus).trim().toUpperCase();
      }
      return typeof dialog.vivaStatus === 'string'
        ? String(dialog.vivaStatus).trim().toUpperCase()
        : '';
    }

    function getDialogCabinetWebviewUrl(dialog) {
      if (!dialog) {
        return '';
      }
      if (typeof dialog.vivaCabinetWebviewUrl === 'string') {
        return String(dialog.vivaCabinetWebviewUrl).trim();
      }
      if (typeof dialog.vivaCabinetEmbedUrl === 'string') {
        return String(dialog.vivaCabinetEmbedUrl).trim();
      }
      return '';
    }

    function renderDialogHeader() {
      var dialog = getSelectedDialog();
      clearNode(dom.dialogTags);
      if (!dialog) {
        applyDialogHeader(null);
        return;
      }

      applyDialogHeader(dialog);
    }

    function applyDialogHeader(dialog) {
      renderMessageModeToggle();
      if (!dialog) {
        dom.dialogTitle.textContent = 'Чат не выбран';
        dom.dialogMeta.textContent =
          'Выберите чат слева, чтобы открыть переписку. Позже здесь появится единая лента действий клиента из CRM, Битрикс, Mango Office и чатов.';
        renderDialogLinks(null);
        return;
      }

      var title = getDialogDisplayTitle(dialog);
      var phone = getDialogPrimaryPhone(dialog);
      dom.dialogTitle.textContent =
        title +
        (phone && normalizeDialogLabel(title) !== normalizeDialogLabel(phone)
          ? ' · ' + phone
          : '');
      dom.dialogMeta.textContent =
        (dialog.stationName || dialog.stationId || 'Без станции') +
        ' · ' +
        dialog.connector +
        ' · ' +
        (dialog.authStatus === 'VERIFIED' ? 'авторизован' : 'ждет номер') +
        ' · ответ: ' +
        formatDurationMs(dialog.averageFirstResponseMs) +
        ' · последнее сообщение: ' +
        formatDateTimeFull(dialog.lastMessageAt);
      renderDialogLinks(dialog);
    }

    function renderDialogLinks(dialog) {
      var vivaStatus = getDialogVivaStatus(dialog);
      var vivaCabinetUrl = getDialogCabinetUrl(dialog);
      var vivaCabinetWebviewUrl = getDialogCabinetWebviewUrl(dialog);
      var effectiveStatus = vivaStatus || (vivaCabinetUrl ? 'FOUND' : '');

      if (!dialog) {
        dom.dialogLinks.style.display = 'none';
        dom.vivaCabinetStatus.textContent = '';
        dom.vivaCabinetStatus.className = 'phab-admin-dialog-link-status';
        dom.vivaCabinetLink.removeAttribute('href');
        dom.vivaCabinetLink.style.display = 'none';
        dom.cabinetMeta.textContent =
          'Выберите чат, чтобы открыть кабинет клиента и встроенное окно Viva CRM.';
        dom.cabinetFrame.removeAttribute('src');
        dom.cabinetFrame.style.display = 'none';
        dom.cabinetEmpty.style.display = 'flex';
        dom.cabinetEmpty.textContent = 'Выберите чат слева, чтобы открыть кабинет клиента.';
        return;
      }

      if (!effectiveStatus && !vivaCabinetUrl) {
        dom.dialogLinks.style.display = 'none';
        dom.vivaCabinetStatus.textContent = '';
        dom.vivaCabinetStatus.className = 'phab-admin-dialog-link-status';
        dom.vivaCabinetLink.removeAttribute('href');
        dom.vivaCabinetLink.style.display = 'none';
        dom.cabinetMeta.textContent = 'Сведения о личном кабинете клиента пока недоступны.';
        dom.cabinetFrame.removeAttribute('src');
        dom.cabinetFrame.style.display = 'none';
        dom.cabinetEmpty.style.display = 'flex';
        dom.cabinetEmpty.textContent = 'По этому чату ещё нет ссылки на личный кабинет Viva CRM.';
        return;
      }

      if (effectiveStatus === 'FOUND') {
        dom.vivaCabinetStatus.textContent = 'Viva найден';
        dom.vivaCabinetStatus.className =
          'phab-admin-dialog-link-status phab-admin-dialog-link-status-ok';
      } else if (effectiveStatus === 'DISABLED') {
        dom.vivaCabinetStatus.textContent = 'Viva не настроен';
        dom.vivaCabinetStatus.className =
          'phab-admin-dialog-link-status phab-admin-dialog-link-status-disabled';
      } else {
        dom.vivaCabinetStatus.textContent = 'Viva не найден';
        dom.vivaCabinetStatus.className =
          'phab-admin-dialog-link-status phab-admin-dialog-link-status-missing';
      }

      if (vivaCabinetUrl) {
        dom.vivaCabinetLink.href = vivaCabinetUrl;
        dom.vivaCabinetLink.style.display = 'inline-flex';
      } else {
        dom.vivaCabinetLink.removeAttribute('href');
        dom.vivaCabinetLink.style.display = 'none';
      }

      dom.dialogLinks.style.display = 'flex';

      if (vivaCabinetWebviewUrl) {
        dom.cabinetMeta.textContent =
          'Справа открыт вебвью кабинета клиента. Если Viva CRM не встраивается, откройте кабинет по ссылке выше.';
        if (dom.cabinetFrame.getAttribute('src') !== vivaCabinetWebviewUrl) {
          dom.cabinetFrame.src = vivaCabinetWebviewUrl;
        }
        dom.cabinetFrame.style.display = 'block';
        dom.cabinetEmpty.style.display = 'none';
        return;
      }

      dom.cabinetFrame.removeAttribute('src');
      dom.cabinetFrame.style.display = 'none';
      dom.cabinetEmpty.style.display = 'flex';
      if (effectiveStatus === 'DISABLED') {
        dom.cabinetMeta.textContent = 'Интеграция Viva CRM сейчас не настроена.';
        dom.cabinetEmpty.textContent =
          'Вебвью кабинета недоступно, потому что интеграция Viva CRM не настроена.';
      } else if (effectiveStatus === 'FOUND') {
        dom.cabinetMeta.textContent =
          'Ссылка на кабинет найдена, но отдельный webview URL не передан. Используйте кнопку выше.';
        dom.cabinetEmpty.textContent =
          'Встроенное окно кабинета пока недоступно. Откройте личный кабинет клиента по ссылке выше.';
      } else {
        dom.cabinetMeta.textContent = 'Клиент пока не найден в Viva CRM.';
        dom.cabinetEmpty.textContent = 'Viva CRM не вернул личный кабинет для этого клиента.';
      }
    }

    function createConnectorTagNode(value) {
      var normalized = String(value || '').trim().toUpperCase();
      if (normalized !== 'MAX_BOT') {
        var chip = document.createElement('span');
        var lower = normalized.toLowerCase();
        chip.className =
          'phab-admin-chip' +
          (lower.indexOf('critical') >= 0 || lower.indexOf('distressed') >= 0
            ? ' phab-admin-chip-alert'
            : lower.indexOf('important') >= 0 || lower.indexOf('negative') >= 0
              ? ' phab-admin-chip-warn'
              : '');
        chip.textContent = String(value);
        return chip;
      }

      var wrap = document.createElement('span');
      wrap.className = 'phab-admin-connector-icons';

      var maxLogo = document.createElement('span');
      maxLogo.className = 'phab-admin-connector-logo phab-admin-connector-logo-max';
      maxLogo.textContent = 'MAX';
      maxLogo.title = 'MAX';
      wrap.appendChild(maxLogo);

      var padlHubLogo = document.createElement('span');
      padlHubLogo.className = 'phab-admin-connector-logo phab-admin-connector-logo-padlhub';
      padlHubLogo.title = 'PadlHub';
      wrap.appendChild(padlHubLogo);

      var fallback = document.createElement('span');
      fallback.className = 'phab-admin-connector-logo-padlhub-fallback';
      fallback.textContent = 'P';
      padlHubLogo.appendChild(fallback);

      var favicon = document.createElement('img');
      favicon.alt = 'PadlHub';
      favicon.src = PADLHUB_FAVICON_URL;
      favicon.addEventListener('load', function () {
        fallback.style.display = 'none';
      });
      favicon.addEventListener('error', function () {
        favicon.remove();
        fallback.style.display = 'inline-flex';
      });
      padlHubLogo.appendChild(favicon);

      return wrap;
    }

    function formatDateTimeFull(value) {
      if (!value) {
        return '-';
      }
      var d = new Date(value);
      if (Number.isNaN(d.getTime())) {
        return String(value);
      }
      var hh = String(d.getHours()).padStart(2, '0');
      var mm = String(d.getMinutes()).padStart(2, '0');
      var dd = String(d.getDate()).padStart(2, '0');
      var mo = String(d.getMonth() + 1).padStart(2, '0');
      var yyyy = String(d.getFullYear());
      return dd + '.' + mo + '.' + yyyy + ' ' + hh + ':' + mm;
    }

    function isObject(value) {
      return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    function toDisplayValue(value) {
      if (value === null || value === undefined) {
        return '-';
      }
      if (typeof value === 'boolean') {
        return value ? 'Да' : 'Нет';
      }
      if (Array.isArray(value)) {
        return value.length === 0 ? '-' : value.join(', ');
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      var text = String(value).trim();
      return text ? text : '-';
    }

    function normalizeObject(value) {
      return isObject(value) ? value : {};
    }

    function normalizeArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function pickPhotoUrl(photo) {
      var candidate = normalizeObject(photo);
      var value =
        candidate.dataUrl ||
        candidate.url ||
        candidate.fileUrl ||
        candidate.src ||
        candidate.href ||
        '';
      return typeof value === 'string' ? value.trim() : '';
    }

    function formatFileSize(size) {
      var bytes = Number(size);
      if (!Number.isFinite(bytes) || bytes <= 0) {
        return '-';
      }
      var units = ['Б', 'КБ', 'МБ', 'ГБ'];
      var value = bytes;
      var unitIndex = 0;
      while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
      }
      var precision = unitIndex === 0 || value >= 10 ? 0 : 1;
      return value.toFixed(precision).replace(/\.0$/, '') + ' ' + units[unitIndex];
    }

    function extractGamePhotos(game) {
      var details = normalizeObject(game && game.details);
      var metadata = normalizeObject(details.metadata);
      var matchResult = normalizeObject(metadata.matchResult);
      var buckets = [
        normalizeArray(matchResult.photos),
        normalizeArray(metadata.photos),
        normalizeArray(details.photos)
      ];
      var seen = {};
      var result = [];

      buckets.forEach(function (items) {
        items.forEach(function (item) {
          var photo = normalizeObject(item);
          var src = pickPhotoUrl(photo);
          if (!src) {
            return;
          }
          var key = String(photo.id || photo.name || src);
          if (seen[key]) {
            return;
          }
          seen[key] = true;
          result.push(photo);
        });
      });

      return result;
    }

    function appendGamePhotosCard(game) {
      var photos = extractGamePhotos(game);
      if (photos.length === 0) {
        return;
      }

      var card = createDetailCard('Фото матча', true);
      var grid = document.createElement('div');
      grid.className = 'phab-admin-photo-grid';
      card.body.appendChild(grid);

      photos.forEach(function (item, index) {
        var photo = normalizeObject(item);
        var src = pickPhotoUrl(photo);
        if (!src) {
          return;
        }

        var photoCard = document.createElement('article');
        photoCard.className = 'phab-admin-photo-card';
        grid.appendChild(photoCard);

        var link = document.createElement('a');
        link.className = 'phab-admin-photo-link';
        link.href = src;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        photoCard.appendChild(link);

        var img = document.createElement('img');
        img.className = 'phab-admin-photo-thumb';
        img.src = src;
        img.alt = photo.name ? String(photo.name) : 'Фото матча ' + String(index + 1);
        img.loading = 'lazy';
        link.appendChild(img);

        var meta = document.createElement('div');
        meta.className = 'phab-admin-photo-meta';
        photoCard.appendChild(meta);

        var name = document.createElement('div');
        name.className = 'phab-admin-photo-name';
        name.textContent = photo.name ? String(photo.name) : 'Фото ' + String(index + 1);
        meta.appendChild(name);

        var details = [];
        if (photo.type) {
          details.push(String(photo.type));
        }
        if (photo.size) {
          details.push(formatFileSize(photo.size));
        }
        if (details.length > 0) {
          var sizeRow = document.createElement('div');
          sizeRow.className = 'phab-admin-photo-sub';
          sizeRow.textContent = details.join(' · ');
          meta.appendChild(sizeRow);
        }

        var sourceParts = [];
        if (photo.source) {
          sourceParts.push('Источник: ' + String(photo.source));
        }
        if (photo.createdAt) {
          sourceParts.push(formatDateTimeFull(photo.createdAt));
        }
        if (sourceParts.length > 0) {
          var createdRow = document.createElement('div');
          createdRow.className = 'phab-admin-photo-sub';
          createdRow.textContent = sourceParts.join(' · ');
          meta.appendChild(createdRow);
        }
      });

      dom.gameModalBody.appendChild(card.card);
    }

    function createDetailCard(title, spanTwo) {
      var card = document.createElement('section');
      card.className = 'phab-admin-detail-card' + (spanTwo ? ' phab-admin-detail-span-2' : '');

      var head = document.createElement('div');
      head.className = 'phab-admin-detail-head';
      card.appendChild(head);

      var headTitle = document.createElement('div');
      headTitle.className = 'phab-admin-detail-head-title';
      headTitle.textContent = title;
      head.appendChild(headTitle);

      var body = document.createElement('div');
      body.className = 'phab-admin-detail-body';
      card.appendChild(body);

      return { card: card, head: head, headTitle: headTitle, body: body };
    }

    async function copyText(text) {
      var value = String(text || '');
      if (!value) {
        return false;
      }
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        return true;
      }
      var textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', 'readonly');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.select();
      var copied = false;
      try {
        copied = document.execCommand('copy');
      } finally {
        document.body.removeChild(textarea);
      }
      return copied;
    }

    function appendDetailRow(container, label, value) {
      var row = document.createElement('div');
      row.className = 'phab-admin-detail-row';
      container.appendChild(row);

      var key = document.createElement('div');
      key.className = 'phab-admin-detail-key';
      key.textContent = label;
      row.appendChild(key);

      var val = document.createElement('div');
      val.className = 'phab-admin-detail-value';
      val.textContent = toDisplayValue(value);
      row.appendChild(val);
    }

    function appendDetailLinkRow(container, label, href, text) {
      if (!href) {
        appendDetailRow(container, label, '-');
        return;
      }

      var row = document.createElement('div');
      row.className = 'phab-admin-detail-row';
      container.appendChild(row);

      var key = document.createElement('div');
      key.className = 'phab-admin-detail-key';
      key.textContent = label;
      row.appendChild(key);

      var val = document.createElement('div');
      val.className = 'phab-admin-detail-value';
      row.appendChild(val);

      var link = document.createElement('a');
      link.className = 'phab-admin-detail-link';
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = text || href;
      val.appendChild(link);
    }

    function appendDetailList(container, items) {
      if (!items || items.length === 0) {
        appendDetailRow(container, 'Данные', '-');
        return;
      }
      var list = document.createElement('ul');
      list.className = 'phab-admin-detail-list';
      container.appendChild(list);
      items.forEach(function (item) {
        var li = document.createElement('li');
        li.className = 'phab-admin-detail-list-item';
        li.textContent = String(item);
        list.appendChild(li);
      });
    }

    function appendJsonCardTo(container, title, payload) {
      var card = createDetailCard(title, true);
      card.card.className += ' phab-admin-detail-card-json';
      var payloadText = JSON.stringify(payload || {}, null, 2);

      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'phab-admin-detail-copy-btn';
      copyBtn.textContent = 'Скопировать';
      copyBtn.addEventListener('click', function () {
        copyBtn.disabled = true;
        copyText(payloadText)
          .then(function (copied) {
            copyBtn.textContent = copied ? 'Скопировано' : 'Не удалось';
            window.setTimeout(function () {
              copyBtn.textContent = 'Скопировать';
              copyBtn.disabled = false;
            }, 1200);
          })
          .catch(function () {
            copyBtn.textContent = 'Не удалось';
            window.setTimeout(function () {
              copyBtn.textContent = 'Скопировать';
              copyBtn.disabled = false;
            }, 1200);
          });
      });
      card.head.appendChild(copyBtn);

      var wrap = document.createElement('div');
      wrap.className = 'phab-admin-detail-json-wrap';
      card.body.appendChild(wrap);

      var pre = document.createElement('pre');
      pre.className = 'phab-admin-detail-json';
      pre.textContent = payloadText;
      wrap.appendChild(pre);
      container.appendChild(card.card);
    }

    function appendJsonCard(title, payload) {
      appendJsonCardTo(dom.gameModalBody, title, payload);
    }

    function buildEventUserLines(event) {
      var lines = [];
      if (event.userName) {
        lines.push(String(event.userName));
      }
      if (event.userPhone) {
        lines.push(String(event.userPhone));
      }
      if (event.userClientId) {
        lines.push('clientId: ' + String(event.userClientId));
      }
      return lines;
    }

    function buildEventSummaryLines(event) {
      var lines = [];
      if (event.payloadLabel) {
        lines.push(String(event.payloadLabel));
      }
      if (event.payloadModule) {
        lines.push('Модуль: ' + String(event.payloadModule));
      }
      if (event.payloadSource) {
        lines.push('Источник: ' + String(event.payloadSource));
      }
      if (event.payloadStatus) {
        lines.push('Статус: ' + String(event.payloadStatus));
      }
      if (event.payloadMessage) {
        lines.push(String(event.payloadMessage));
      }
      if (event.payloadError) {
        lines.push('Ошибка: ' + String(event.payloadError));
      }
      return lines;
    }

    function renderCellLines(container, lines, emptyText) {
      if (!lines || lines.length === 0) {
        container.textContent = emptyText || '-';
        return;
      }
      lines.forEach(function (line) {
        var node = document.createElement('span');
        node.className = 'phab-admin-games-cell-line';
        node.textContent = String(line);
        container.appendChild(node);
      });
    }

    function closeGameEventModal() {
      dom.eventModal.classList.add('phab-admin-hidden');
      state.selectedGameEventId = null;
      state.selectedGameEvent = null;
      state.deletingGameEvent = false;
      dom.eventDeleteBtn.disabled = false;
      dom.eventDeleteBtn.textContent = 'Удалить лог';
    }

    function renderGameEventDetails(event) {
      clearNode(dom.eventModalBody);
      if (!event || !event.id) {
        var empty = document.createElement('div');
        empty.className = 'phab-admin-empty';
        empty.textContent = 'Событие не найдено';
        dom.eventModalBody.appendChild(empty);
        dom.eventDeleteBtn.disabled = true;
        dom.eventDeleteBtn.textContent = 'Удалить лог';
        return;
      }

      var details = normalizeObject(event.details);
      var page = normalizeObject(details.page);
      var payload = normalizeObject(details.payload);
      var user = normalizeObject(details.user);
      var device = normalizeObject(details.device);

      dom.eventModalTitle.textContent = 'Событие ' + event.event;
      dom.eventDeleteBtn.disabled = state.deletingGameEvent;
      dom.eventDeleteBtn.textContent = state.deletingGameEvent ? 'Удаление...' : 'Удалить лог';

      var mainCard = createDetailCard('Основное');
      appendDetailRow(mainCard.body, 'ID', event.id);
      appendDetailRow(mainCard.body, 'Тип', event.event);
      appendDetailRow(mainCard.body, 'Время', formatDateTimeFull(event.timestamp));
      appendDetailRow(mainCard.body, 'Источник', event.source);
      appendDetailRow(mainCard.body, 'Tenant', event.tenantKey);
      appendDetailRow(mainCard.body, 'Session ID', event.sessionId);
      dom.eventModalBody.appendChild(mainCard.card);

      var userCard = createDetailCard('Пользователь');
      appendDetailRow(userCard.body, 'Имя', event.userName);
      appendDetailRow(userCard.body, 'Телефон', event.userPhone);
      appendDetailRow(userCard.body, 'Client ID', event.userClientId);
      dom.eventModalBody.appendChild(userCard.card);

      var pageCard = createDetailCard('Страница');
      appendDetailRow(pageCard.body, 'Path', event.pagePath || page.path);
      appendDetailLinkRow(
        pageCard.body,
        'URL',
        event.pageHref || page.href,
        event.pageHref || page.href || '-'
      );
      dom.eventModalBody.appendChild(pageCard.card);

      var payloadCard = createDetailCard('Payload');
      appendDetailRow(payloadCard.body, 'Label', event.payloadLabel || payload.label);
      appendDetailRow(payloadCard.body, 'Module', event.payloadModule || payload.module);
      appendDetailRow(payloadCard.body, 'Source', event.payloadSource || payload.source);
      appendDetailRow(payloadCard.body, 'Status', event.payloadStatus || payload.status);
      appendDetailRow(payloadCard.body, 'Message', event.payloadMessage);
      appendDetailRow(payloadCard.body, 'Error', event.payloadError);
      dom.eventModalBody.appendChild(payloadCard.card);

      if (Object.keys(user).length > 0) {
        appendJsonCardTo(dom.eventModalBody, 'User', user);
      }
      if (Object.keys(page).length > 0) {
        appendJsonCardTo(dom.eventModalBody, 'Page', page);
      }
      if (Object.keys(payload).length > 0) {
        appendJsonCardTo(dom.eventModalBody, 'Payload JSON', payload);
      }
      if (Object.keys(device).length > 0) {
        appendJsonCardTo(dom.eventModalBody, 'Device', device);
      }
      appendJsonCardTo(
        dom.eventModalBody,
        'Raw event payload',
        Object.keys(details).length > 0 ? details : event
      );
    }

    async function deleteSelectedGameEvent() {
      var event = state.selectedGameEvent;
      if (!event || !event.id || state.deletingGameEvent) {
        return;
      }

      var eventLabel = String(event.event || event.id);
      if (!window.confirm('Удалить лог "' + eventLabel + '" из базы?')) {
        return;
      }

      state.deletingGameEvent = true;
      renderGameEventDetails(event);
      try {
        await api.deleteGameEvent(event.id);
        if (state.gameEvents.length === 1 && state.gameEventsPage > 1) {
          state.gameEventsPage -= 1;
        }
        closeGameEventModal();
        await loadGameEvents();
        setStatus('Лог удален', false);
      } finally {
        state.deletingGameEvent = false;
        if (state.selectedGameEvent && state.selectedGameEvent.id === event.id) {
          renderGameEventDetails(state.selectedGameEvent);
        }
      }
    }

    async function openGameEventDetails(event) {
      if (!event || !event.id) {
        return;
      }
      state.selectedGameEventId = event.id;
      state.selectedGameEvent = event;
      dom.eventModal.classList.remove('phab-admin-hidden');
      renderGameEventDetails(event);

      try {
        var details = await api.getGameEventById(event.id);
        if (state.selectedGameEventId !== event.id) {
          return;
        }
        if (details && details.id) {
          state.selectedGameEvent = details;
          renderGameEventDetails(details);
        }
      } catch (error) {
        if (state.selectedGameEventId === event.id) {
          setStatus('Не удалось загрузить событие', true);
        }
        throw error;
      }
    }

    function closeGameModal() {
      dom.gameModal.classList.add('phab-admin-hidden');
      state.selectedGameId = null;
      state.selectedGame = null;
    }

    function renderGameDetails(game) {
      clearNode(dom.gameModalBody);
      if (!game || !game.id) {
        var empty = document.createElement('div');
        empty.className = 'phab-admin-empty';
        empty.textContent = 'Игра не найдена';
        dom.gameModalBody.appendChild(empty);
        return;
      }

      var details = normalizeObject(game.details);
      var organizer = normalizeObject(details.organizer);
      var booking = normalizeObject(details.booking);
      var payment = normalizeObject(details.payment);
      var invite = normalizeObject(details.invite);
      var settings = normalizeObject(details.settings);
      var metadata = normalizeObject(details.metadata);
      var restrictedGameView = isRestrictedStationAdmin;

      dom.gameModalTitle.textContent = 'Игра ' + game.id;

      var mainCard = createDetailCard('Основное');
      appendDetailRow(mainCard.body, 'ID', game.id);
      appendDetailRow(mainCard.body, 'Источник', game.source);
      appendDetailRow(mainCard.body, 'Название', game.name);
      appendDetailRow(mainCard.body, 'Статус', game.rawStatus || game.status);
      appendDetailRow(mainCard.body, 'Результат', game.result);
      appendDetailRow(mainCard.body, 'Δ рейтинг', game.ratingDelta);
      appendDetailRow(mainCard.body, 'Создана', formatDateTimeFull(game.createdAt));
      appendDetailRow(mainCard.body, 'Обновлена', formatDateTimeFull(game.updatedAt));
      appendDetailRow(mainCard.body, 'Дата игры', game.gameDate);
      appendDetailRow(mainCard.body, 'Время игры', game.gameTime);
      appendDetailRow(mainCard.body, 'Старт (ISO)', game.startsAt);
      appendDetailRow(mainCard.body, 'Станция', game.stationName);
      appendDetailRow(mainCard.body, 'Корт', game.courtName);
      appendDetailRow(mainCard.body, 'Локация', game.locationName || game.name);
      dom.gameModalBody.appendChild(mainCard.card);

      var organizerCard = createDetailCard('Организатор');
      appendDetailRow(
        organizerCard.body,
        'Имя',
        organizer.name || game.organizerName || '-'
      );
      if (!restrictedGameView) {
        appendDetailRow(organizerCard.body, 'Телефон', organizer.phone || '-');
        appendDetailRow(organizerCard.body, 'Рейтинг', organizer.rating || '-');
        appendDetailRow(organizerCard.body, 'ID', organizer.id || '-');
      }
      if (!restrictedGameView && organizer.id) {
        appendDetailLinkRow(
          organizerCard.body,
          'Viva CRM',
          'https://cabinet.vivacrm.ru/clients/' + encodeURIComponent(String(organizer.id)),
          'cabinet.vivacrm.ru/clients/' + String(organizer.id)
        );
      }
      dom.gameModalBody.appendChild(organizerCard.card);

      var participantsCard = createDetailCard('Состав');
      var participants = normalizeArray(details.participants);
      if (participants.length > 0) {
        appendDetailList(
          participantsCard.body,
          participants.map(function (participant) {
            var p = normalizeObject(participant);
            var chunks = [];
            if (p.name) {
              chunks.push(String(p.name));
            }
            if (p.phone) {
              chunks.push(String(p.phone));
            }
            if (p.rating) {
              chunks.push('рейт. ' + String(p.rating));
            }
            if (p.status) {
              chunks.push(String(p.status));
            }
            return chunks.join(' · ');
          })
        );
      } else {
        var fallbackParticipants = normalizeArray(game.participantDetails);
        if (fallbackParticipants.length > 0) {
          appendDetailList(
            participantsCard.body,
            fallbackParticipants.map(function (participant) {
              return participant.phone
                ? String(participant.name) + ' · ' + String(participant.phone)
                : String(participant.name);
            })
          );
        } else {
          appendDetailList(participantsCard.body, normalizeArray(game.participantNames));
        }
      }
      dom.gameModalBody.appendChild(participantsCard.card);

      appendGamePhotosCard(game);

      if (!restrictedGameView) {
        var bookingCard = createDetailCard('Бронирование');
        appendDetailRow(
          bookingCard.body,
          'Студия / Корт',
          [booking.studioName, booking.roomName].filter(Boolean).join(' · ')
        );
        appendDetailRow(bookingCard.body, 'Дата', booking.date || game.gameDate);
        appendDetailRow(
          bookingCard.body,
          'Время',
          booking.timeFrom && booking.timeTo
            ? String(booking.timeFrom) + ' - ' + String(booking.timeTo)
            : game.gameTime
        );
        appendDetailRow(bookingCard.body, 'Start TS', booking.startTs);
        appendDetailRow(bookingCard.body, 'End TS', booking.endTs);
        appendDetailRow(bookingCard.body, 'Slot ID', booking.slotId);
        dom.gameModalBody.appendChild(bookingCard.card);

        var paymentCard = createDetailCard('Оплата');
        appendDetailRow(paymentCard.body, 'Сумма', payment.amount);
        appendDetailRow(paymentCard.body, 'Оплачено', payment.paid);
        appendDetailRow(paymentCard.body, 'Оплачено в', formatDateTimeFull(payment.paidAt));
        appendDetailRow(paymentCard.body, 'Метод', payment.paymentMethod);
        appendDetailRow(paymentCard.body, 'Ссылка', payment.paymentUrl);
        dom.gameModalBody.appendChild(paymentCard.card);

        var configCard = createDetailCard('Настройки и инвайт');
        appendDetailRow(configCard.body, 'Рейтинговая игра', settings.ratingGame);
        appendDetailRow(configCard.body, 'Мин рейтинг', settings.minRating);
        appendDetailRow(configCard.body, 'Макс рейтинг', settings.maxRating);
        appendDetailRow(configCard.body, 'Приватная', settings.isPrivate);
        appendDetailRow(configCard.body, 'Pay mode', settings.payMode);
        appendDetailRow(configCard.body, 'Макс игроков', invite.maxPlayers);
        appendDetailRow(configCard.body, 'Waitlist', invite.waitlistEnabled);
        appendDetailRow(configCard.body, 'Invite URL', invite.inviteUrl);
        dom.gameModalBody.appendChild(configCard.card);

        var phonesCard = createDetailCard('Телефоны');
        appendDetailRow(phonesCard.body, 'Все связанные', normalizeArray(details.allRelatedPhones));
        appendDetailRow(phonesCard.body, 'Участники', normalizeArray(details.participantPhones));
        appendDetailRow(phonesCard.body, 'Приглашенные', normalizeArray(details.invitedPhones));
        appendDetailRow(phonesCard.body, 'Лист ожидания', normalizeArray(details.waitlistPhones));
        dom.gameModalBody.appendChild(phonesCard.card);

        appendJsonCard('Metadata', metadata);
        appendJsonCard(
          'Raw game payload',
          Object.keys(details).length > 0 ? details : game
        );
      }
    }

    async function openGameDetails(game) {
      if (!game || !game.id) {
        return;
      }
      state.selectedGameId = game.id;
      state.selectedGame = game;
      dom.gameModal.classList.remove('phab-admin-hidden');
      renderGameDetails(game);

      try {
        var details = await api.getGameById(game.id);
        if (state.selectedGameId !== game.id) {
          return;
        }
        if (details && details.id) {
          state.selectedGame = details;
          renderGameDetails(details);
        }
      } catch (error) {
        if (state.selectedGameId === game.id) {
          setStatus('Не удалось загрузить полные данные игры', true);
        }
        throw error;
      }
    }

    function renderGameChatMessages(messages) {
      clearNode(dom.gameChatBox);
      if (!messages || messages.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'phab-admin-empty';
        empty.textContent = 'Сообщений пока нет';
        dom.gameChatBox.appendChild(empty);
        return;
      }

      messages.forEach(function (message) {
        var own = String(message.senderRole || '').toUpperCase() !== 'CLIENT';
        var div = document.createElement('div');
        div.className =
          'phab-admin-message ' +
          (own ? 'phab-admin-message-staff' : 'phab-admin-message-client');
        div.textContent = message.text || '';

        var meta = document.createElement('span');
        meta.className = 'phab-admin-message-meta';
        var sender = String(message.senderName || '').trim();
        if (!sender) {
          sender = own ? 'Сотрудник' : 'Клиент';
        }
        var roleRaw = String(message.senderRoleRaw || '').trim();
        meta.textContent =
          sender +
          (roleRaw ? ' (' + roleRaw + ')' : '') +
          ' · ' +
          formatTime(message.createdAt);
        div.appendChild(meta);

        dom.gameChatBox.appendChild(div);
      });

      dom.gameChatBox.scrollTop = dom.gameChatBox.scrollHeight;
    }

    function closeGameChatModal() {
      dom.gameChatModal.classList.add('phab-admin-hidden');
      state.gameChatGameId = null;
      state.gameChatThreadId = null;
      dom.gameChatInput.value = '';
      dom.gameChatInput.disabled = false;
      dom.gameChatSendBtn.disabled = false;
    }

    async function reloadGameChatMessages() {
      var gameId = state.gameChatGameId;
      if (!gameId) {
        return;
      }
      var payload = await api.getGameChat(gameId);
      if (gameId !== state.gameChatGameId) {
        return;
      }
      state.gameChatThreadId = String(payload.gameId || '');
      renderGameChatMessages(payload.messages || []);
    }

    async function openGameChat(game) {
      if (isRestrictedStationAdmin) {
        setStatus('Администратору станции чат игры недоступен', true);
        return;
      }
      if (!game || !game.id) {
        return;
      }

      state.gameChatGameId = game.id;
      state.gameChatThreadId = null;
      dom.gameChatModal.classList.remove('phab-admin-hidden');
      dom.gameChatTitle.textContent = 'Чат игры ' + game.id;
      dom.gameChatMeta.textContent = 'Подключение к чату...';
      dom.gameChatInput.value = '';
      dom.gameChatInput.disabled = true;
      dom.gameChatSendBtn.disabled = true;
      renderGameChatMessages([]);

      try {
        var payload = await api.getGameChat(game.id);
        if (state.gameChatGameId !== game.id) {
          return;
        }
        if (!payload || !payload.gameId) {
          throw new Error('Не удалось открыть чат игры');
        }

        state.gameChatThreadId = String(payload.gameId || '');
        dom.gameChatMeta.textContent =
          'Mongo chat · gameId ' + state.gameChatThreadId;
        renderGameChatMessages(payload.messages || []);
        dom.gameChatInput.disabled = false;
        dom.gameChatSendBtn.disabled = false;
        dom.gameChatInput.focus();
      } catch (error) {
        if (state.gameChatGameId === game.id) {
          dom.gameChatMeta.textContent = 'Ошибка подключения к чату игры';
          dom.gameChatInput.disabled = true;
          dom.gameChatSendBtn.disabled = true;
        }
        throw error;
      }
    }

    async function sendGameChatMessage() {
      var text = String(dom.gameChatInput.value || '').trim();
      var gameId = state.gameChatGameId;
      if (!text || !gameId) {
        return;
      }

      dom.gameChatSendBtn.disabled = true;
      try {
        await api.sendGameChatMessage(gameId, text);
        dom.gameChatInput.value = '';
        await reloadGameChatMessages();
        setStatus('Сообщение отправлено в чат игры', false);
      } finally {
        dom.gameChatSendBtn.disabled = false;
      }
    }

    function normalizeDialogLabel(value) {
      return String(value || '')
        .trim()
        .toLowerCase();
    }

    function normalizePhoneSearchValue(value) {
      var digits = String(value || '').replace(/\D+/g, '');
      if (!digits) {
        return '';
      }
      if (digits.length === 11 && digits.indexOf('8') === 0) {
        return '7' + digits.slice(1);
      }
      if (digits.length === 10) {
        return '7' + digits;
      }
      if (digits.length === 11 && digits.indexOf('7') === 0) {
        return digits;
      }
      return digits;
    }

    function resolvePhoneSearchDigits(query) {
      var normalized = normalizePhoneSearchValue(query);
      return normalized.length >= 10 ? normalized : '';
    }

    function isTechnicalDialogLabel(value) {
      var normalized = normalizeDialogLabel(value);
      return normalized === 'viva crm' || normalized === 'vivacrm';
    }

    function getDialogSubjectLabel(dialog) {
      var subject = String(dialog && dialog.subject || '').trim();
      if (!subject || isTechnicalDialogLabel(subject)) {
        return '';
      }
      return subject;
    }

    function getDialogSearchHaystack(dialog) {
      var values = [];
      values.push(String(dialog && dialog.clientDisplayName || ''));
      values.push(getDialogSubjectLabel(dialog));
      values.push(getDialogPrimaryPhone(dialog));
      if (Array.isArray(dialog && dialog.phones)) {
        dialog.phones.forEach(function (phone) {
          values.push(String(phone || ''));
        });
      }
      return values
        .join(' ')
        .trim()
        .toLowerCase();
    }

    function dialogMatchesSearch(dialog, query) {
      if (state.dialogSearchPhoneDigits) {
        return true;
      }
      var normalizedQuery = String(query || '')
        .trim()
        .toLowerCase();
      if (!normalizedQuery) {
        return true;
      }
      return getDialogSearchHaystack(dialog).indexOf(normalizedQuery) >= 0;
    }

    function isSystemMessage(message) {
      var direction = String(message && message.direction || '').toUpperCase();
      var senderRole = String(message && (message.senderRoleRaw || message.senderRole) || '').toUpperCase();
      var kind = String(message && message.kind || '').toUpperCase();
      return direction === 'SYSTEM' || senderRole === 'SYSTEM' || kind === 'SYSTEM';
    }

    function isSystemDialog(dialog) {
      var senderRole = String(
        dialog && (dialog.lastMessageSenderRoleRaw || dialog.lastMessageSenderRole) || ''
      ).toUpperCase();
      var preview = String(dialog && dialog.lastMessageText || '').trim().toLowerCase();
      return (
        senderRole === 'SYSTEM' ||
        preview === 'системное событие' ||
        preview.indexOf('служебное сообщение') === 0
      );
    }

    function isVivaOtpSystemMessage(message) {
      if (!isSystemMessage(message)) {
        return false;
      }
      var text = String(message && message.text || '').toLowerCase();
      return (
        text.indexOf('viva crm') >= 0 &&
        (
          text.indexOf('otp') >= 0 ||
          text.indexOf('код авторизации') >= 0 ||
          /\b\d{4,8}\b/.test(text)
        )
      );
    }

    function isVivaOtpSystemDialog(dialog) {
      var text = String(dialog && dialog.lastMessageText || '').toLowerCase();
      return (
        text.indexOf('viva crm') >= 0 &&
        (
          text.indexOf('otp') >= 0 ||
          text.indexOf('код авторизации') >= 0 ||
          /\b\d{4,8}\b/.test(text)
        )
      );
    }

    function shouldIncludeServiceMessages() {
      return canToggleSystemMessages(cfg) && state.includeServiceMessages === true;
    }

    function shouldHideSystemMessage(message) {
      if (!message) {
        return false;
      }
      if (isSystemMessage(message) && !shouldIncludeServiceMessages()) {
        return true;
      }
      if (isRestrictedStationAdmin && isSystemMessage(message) && isVivaOtpSystemMessage(message)) {
        return true;
      }
      return false;
    }

    function shouldHideDialog(dialog) {
      if (!dialog) {
        return false;
      }
      if (isRestrictedStationAdmin && isVivaOtpSystemDialog(dialog)) {
        return true;
      }
      return false;
    }

    function getVisibleMessages(messages) {
      return (Array.isArray(messages) ? messages : []).filter(function (message) {
        return !shouldHideSystemMessage(message);
      });
    }

    function canToggleResolution(dialog) {
      if (!dialog || !dialog.dialogId) {
        return false;
      }
      if (typeof dialog.isResolved !== 'boolean') {
        return false;
      }
      return hasAnyRole(cfg, ['SUPER_ADMIN', 'MANAGER', 'SUPPORT', 'STATION_ADMIN']);
    }

    function renderMessageModeToggle() {
      var dialog = getSelectedDialog();
      var canToggleMessages = canToggleSystemMessages(cfg);
      var canToggleResolved = canToggleResolution(dialog);
      if (!canToggleMessages && !canToggleResolved) {
        dom.dialogOptions.style.display = 'none';
        return;
      }

      dom.dialogOptions.style.display = 'flex';
      dom.messageModeToggle.checked = shouldIncludeServiceMessages();
      if (canToggleMessages) {
        dom.messageModeToggle.disabled = false;
        dom.messageModeToggle.parentElement.style.opacity = '1';
      } else {
        dom.messageModeToggle.disabled = true;
        dom.messageModeToggle.parentElement.style.opacity = '.55';
      }

      if (canToggleResolved) {
        dom.resolutionWrap.style.display = 'flex';
        dom.resolutionToggle.disabled =
          state.updatingResolution || dialog.isActiveForUser === false;
        dom.resolutionToggle.checked = dialog.isResolved === true;
        dom.resolutionToggleText.textContent =
          dialog.isResolved === true ? 'Вопрос пользователя решен' : 'Вопрос пользователя не решен';
      } else {
        dom.resolutionWrap.style.display = 'none';
        dom.resolutionToggle.checked = false;
        dom.resolutionToggle.disabled = true;
        dom.resolutionToggleText.textContent = 'Вопрос пользователя решен';
      }
    }

    function canFilterDialogsByStation() {
      return hasAnyRole(cfg, ['SUPER_ADMIN', 'MANAGER']);
    }

    function getDialogPrimaryPhone(dialog) {
      if (!dialog) {
        return '';
      }
      if (dialog.primaryPhone) {
        return String(dialog.primaryPhone).trim();
      }
      if (Array.isArray(dialog.phones)) {
        for (var i = 0; i < dialog.phones.length; i += 1) {
          var value = String(dialog.phones[i] || '').trim();
          if (value) {
            return value;
          }
        }
      }
      return '';
    }

    function isUuidLikeStationLabel(value) {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(value || '').trim()
      );
    }

    function getStationNameFromSettings(stationId) {
      var normalizedStationId = String(stationId || '').trim();
      if (!normalizedStationId) {
        return '';
      }
      var stations =
        state &&
        state.settings &&
        Array.isArray(state.settings.stations)
          ? state.settings.stations
          : [];
      for (var i = 0; i < stations.length; i += 1) {
        var item = stations[i] || {};
        var candidateId = String(item.stationId || item.id || '').trim();
        if (candidateId !== normalizedStationId) {
          continue;
        }
        return String(item.stationName || item.name || '').trim();
      }
      return '';
    }

    function normalizeStationDisplayName(stationName, stationId) {
      var candidate = String(stationName || '').trim();
      if (!candidate) {
        return '';
      }
      var normalizedStationId = String(stationId || '').trim();
      if (normalizedStationId && candidate.toLowerCase() === normalizedStationId.toLowerCase()) {
        return '';
      }
      if (isUuidLikeStationLabel(candidate)) {
        return '';
      }
      if (normalizeDialogLabel(candidate) === 'без станции') {
        return '';
      }
      return candidate;
    }

    function resolveDialogStationLabel(stationId, stationName) {
      var normalizedStationId = String(stationId || '').trim();
      var directName = normalizeStationDisplayName(stationName, normalizedStationId);
      if (directName) {
        return directName;
      }
      var settingsName = normalizeStationDisplayName(
        getStationNameFromSettings(normalizedStationId),
        normalizedStationId
      );
      return settingsName || normalizedStationId;
    }

    function getDialogCurrentStationInfo(dialog) {
      var writeStationIds = Array.isArray(dialog && dialog.writeStationIds)
        ? dialog.writeStationIds
            .map(function (value) {
              return String(value || '').trim();
            })
            .filter(Boolean)
        : [];
      var canonicalWriteStationId = writeStationIds.length > 0 ? writeStationIds[0] : '';
      var currentStationId = String(dialog && dialog.currentStationId || '').trim();
      var currentStationName = String(dialog && dialog.currentStationName || '').trim();
      var fallbackStationId = String(dialog && dialog.stationId || '').trim();
      var fallbackStationName = String(dialog && dialog.stationName || '').trim();
      var normalizedCurrentStationName = normalizeDialogLabel(currentStationName);
      var normalizedFallbackStationName = normalizeDialogLabel(fallbackStationName);

      if (
        canonicalWriteStationId &&
        canonicalWriteStationId.toUpperCase() !== 'UNASSIGNED'
      ) {
        currentStationId = canonicalWriteStationId;
      }

      if (currentStationId.toUpperCase() === 'UNASSIGNED') {
        currentStationId = '';
      }
      if (fallbackStationId.toUpperCase() === 'UNASSIGNED') {
        fallbackStationId = '';
      }
      if (normalizedCurrentStationName === 'без станции') {
        currentStationName = '';
      }
      if (normalizedFallbackStationName === 'без станции') {
        fallbackStationName = '';
      }

      if (!currentStationId && !currentStationName) {
        if (fallbackStationId) {
          currentStationId = fallbackStationId;
          currentStationName = resolveDialogStationLabel(fallbackStationId, fallbackStationName);
        } else if (fallbackStationName) {
          currentStationName = fallbackStationName;
        }
      }

      if (!currentStationId && !currentStationName) {
        return null;
      }

      var stationLabel = resolveDialogStationLabel(currentStationId, currentStationName);
      var normalizedStationLabel = normalizeDialogLabel(stationLabel || currentStationId);
      var rawKey =
        normalizedStationLabel ||
        canonicalWriteStationId ||
        currentStationId ||
        'station';
      return {
        key: 'station:' + rawKey,
        label: stationLabel || currentStationId
      };
    }

    function buildDialogFilterOptions(dialogs) {
      var stationMap = {};
      var noStationCount = 0;
      var noPhoneCount = 0;

      (Array.isArray(dialogs) ? dialogs : []).forEach(function (dialog) {
        var stationInfo = getDialogCurrentStationInfo(dialog);
        if (stationInfo) {
          if (!stationMap[stationInfo.key]) {
            stationMap[stationInfo.key] = {
              key: stationInfo.key,
              label: stationInfo.label,
              count: 0
            };
          }
          stationMap[stationInfo.key].count += 1;
        } else {
          noStationCount += 1;
        }

        if (!getDialogPrimaryPhone(dialog)) {
          noPhoneCount += 1;
        }
      });

      var options = Object.keys(stationMap)
        .map(function (key) {
          return stationMap[key];
        })
        .sort(function (left, right) {
          return String(left.label || '').localeCompare(String(right.label || ''), 'ru');
        });

      if (noStationCount > 0) {
        options.unshift({
          key: DIALOG_FILTER_NO_STATION,
          label: 'Без станции',
          count: noStationCount
        });
      }

      if (noPhoneCount > 0) {
        options.splice(noStationCount > 0 ? 1 : 0, 0, {
          key: DIALOG_FILTER_NO_PHONE,
          label: 'Без номера',
          count: noPhoneCount
        });
      }

      return options;
    }

    function dialogMatchesStationFilters(dialog, filters) {
      var activeFilters = Array.isArray(filters) ? filters : [];
      if (activeFilters.length === 0) {
        return true;
      }

      var stationInfo = getDialogCurrentStationInfo(dialog);
      var primaryPhone = getDialogPrimaryPhone(dialog);

      return activeFilters.some(function (filterKey) {
        if (filterKey === DIALOG_FILTER_NO_STATION) {
          return !stationInfo;
        }
        if (filterKey === DIALOG_FILTER_NO_PHONE) {
          return !primaryPhone;
        }
        return Boolean(stationInfo && stationInfo.key === filterKey);
      });
    }

    function renderDialogFilters() {
      clearNode(dom.dialogFilters);

      if (!canFilterDialogsByStation()) {
        dom.dialogFiltersWrap.className = 'phab-admin-dialog-filters-wrap phab-admin-hidden';
        return;
      }

      var options = Array.isArray(state.dialogFilterOptions) ? state.dialogFilterOptions : [];
      if (options.length === 0) {
        dom.dialogFiltersWrap.className = 'phab-admin-dialog-filters-wrap phab-admin-hidden';
        return;
      }

      dom.dialogFiltersWrap.className = 'phab-admin-dialog-filters-wrap';

      var allBtn = document.createElement('button');
      allBtn.type = 'button';
      allBtn.className =
        'phab-admin-dialog-filter' +
        ((state.dialogStationFilters || []).length === 0 ? ' phab-admin-dialog-filter-active' : '');
      allBtn.textContent = 'Все';
      allBtn.addEventListener('click', function () {
        setDialogStationFilters([]).catch(handleError);
      });
      dom.dialogFilters.appendChild(allBtn);

      options.forEach(function (option) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          'phab-admin-dialog-filter' +
          ((state.dialogStationFilters || []).indexOf(option.key) >= 0
            ? ' phab-admin-dialog-filter-active'
            : '');
        btn.textContent = option.label + ' · ' + option.count;
        btn.addEventListener('click', function () {
          var nextFilters = Array.isArray(state.dialogStationFilters)
            ? state.dialogStationFilters.slice()
            : [];
          var idx = nextFilters.indexOf(option.key);
          if (idx >= 0) {
            nextFilters.splice(idx, 1);
          } else {
            nextFilters.push(option.key);
          }
          setDialogStationFilters(nextFilters).catch(handleError);
        });
        dom.dialogFilters.appendChild(btn);
      });
    }

    function getDialogDisplayTitle(dialog) {
      var subjectCandidate = getDialogSubjectLabel(dialog);
      var candidate = String(dialog && dialog.clientDisplayName || '').trim();
      var reserved = [
        dialog && dialog.stationName,
        dialog && dialog.stationId,
        dialog && dialog.currentStationName,
        dialog && dialog.currentStationId,
        'Без станции',
        'UNASSIGNED'
      ]
        .map(normalizeDialogLabel)
        .filter(Boolean);

      if (subjectCandidate && reserved.indexOf(normalizeDialogLabel(subjectCandidate)) < 0) {
        return subjectCandidate;
      }
      if (
        candidate &&
        !isTechnicalDialogLabel(candidate) &&
        reserved.indexOf(candidate.toLowerCase()) < 0
      ) {
        return candidate;
      }
      return (
        getDialogPrimaryPhone(dialog) ||
        subjectCandidate ||
        ('Диалог ' + String(dialog && dialog.dialogId || '').slice(0, 8))
      );
    }

    function resolveDialogConnector(dialog) {
      if (!dialog) {
        return '';
      }
      return String(
        dialog.connector ||
          dialog.lastInboundConnector ||
          dialog.lastReplyConnector ||
          ''
      )
        .trim()
        .toUpperCase();
    }

    function getDialogSourceIcons(dialog) {
      var connector = resolveDialogConnector(dialog);
      if (connector === 'LK_WEB_MESSENGER' || connector === 'LK_ACADEMY_WEB_MESSENGER') {
        return [
          { src: PADLHUB_FAVICON_URL, alt: 'Padelhub' }
        ];
      }
      if (connector === 'MAX_ACADEMY_BOT') {
        return [
          { src: MAX_FAVICON_URL, alt: 'MAX' },
          { src: FFC_FAVICON_URL, alt: 'FFC Team' }
        ];
      }
      if (connector === 'MAX_BOT') {
        return [
          { src: MAX_FAVICON_URL, alt: 'MAX' },
          { src: PADLHUB_FAVICON_URL, alt: 'PadlHub' }
        ];
      }
      return [];
    }

    function buildDialogSourceNode(dialog) {
      var icons = getDialogSourceIcons(dialog);
      if (!icons.length) {
        return null;
      }
      var wrap = document.createElement('div');
      wrap.className = 'phab-admin-chat-source';
      icons.forEach(function (item) {
        var icon = document.createElement('img');
        icon.className = 'phab-admin-chat-source-icon';
        icon.src = item.src;
        icon.alt = item.alt;
        icon.loading = 'lazy';
        icon.decoding = 'async';
        icon.referrerPolicy = 'no-referrer';
        icon.addEventListener('error', function () {
          icon.remove();
          if (!wrap.children.length) {
            wrap.remove();
          }
        });
        wrap.appendChild(icon);
      });
      return wrap;
    }

    function renderDialogs() {
      var dialogsScrollBody = dom.dialogsScrollBody || dom.dialogsList;
      var previousScrollTop = dialogsScrollBody.scrollTop;
      clearNode(dom.dialogsList);
      renderDialogFilters();
      renderDialogHeader();

      if (state.dialogs.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'phab-admin-empty';
        empty.textContent =
          state.allDialogs.length > 0
            ? 'Нет чатов по выбранному фильтру, поиску или настройкам показа'
            : 'Нет доступных чатов';
        dom.dialogsList.appendChild(empty);
        dom.dialogTitle.textContent = 'Чат не выбран';
        dom.dialogMeta.textContent = 'Список слева сортируется по дате последнего сообщения';
        renderMessages([]);
        return;
      }

      state.dialogs.forEach(function (item) {
        var stationLabel = String(
          resolveDialogStationLabel(item && item.stationId, item && item.stationName) ||
            'Без станции'
        );
        var currentStationLabel = String(
          resolveDialogStationLabel(item && item.currentStationId, item && item.currentStationName)
        ).trim();
        if (
          currentStationLabel &&
          String(item.stationId || '').trim().toUpperCase() === 'UNASSIGNED' &&
          currentStationLabel !== stationLabel
        ) {
          stationLabel += ' → ' + currentStationLabel;
        }
        var li = document.createElement('li');
        dom.dialogsList.appendChild(li);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          'phab-admin-list-btn phab-admin-chat-item' +
          (item.isActiveForUser === false ? ' phab-admin-list-btn-inactive' : '') +
          (state.selectedThreadId === item.dialogId ? ' phab-admin-list-btn-active' : '');
        btn.addEventListener('mouseenter', function () {
          prefetchDialogMessages(item.dialogId);
        });
        btn.addEventListener('click', function () {
          if (state.selectedThreadId === item.dialogId) {
            return;
          }
          state.selectedThreadId = item.dialogId;
          openSelectedDialog().catch(handleError);
        });
        li.appendChild(btn);

        var main = document.createElement('div');
        main.className = 'phab-admin-chat-item-main';
        btn.appendChild(main);

        var side = document.createElement('div');
        side.className = 'phab-admin-chat-item-side';
        btn.appendChild(side);

        var top = document.createElement('div');
        top.className = 'phab-admin-chat-item-top';
        main.appendChild(top);

        var titleEl = document.createElement('div');
        titleEl.className = 'phab-admin-list-title';
        titleEl.textContent = getDialogDisplayTitle(item);
        top.appendChild(titleEl);

        var badgeCount = Number(item.unreadCount || 0);
        var badgeTone = 'red';
        if (badgeCount <= 0) {
          badgeCount = Number(item.pendingClientMessagesCount || 0);
          badgeTone = 'gray';
        }
        if (badgeCount > 0) {
          var badge = document.createElement('span');
          badge.className =
            'phab-admin-chat-badge ' +
            (badgeTone === 'red'
              ? 'phab-admin-chat-badge-unread'
              : 'phab-admin-chat-badge-pending');
          badge.textContent = String(badgeCount);
          side.appendChild(badge);
        }

        var meta = document.createElement('div');
        meta.className = 'phab-admin-list-meta';
        meta.textContent =
          stationLabel +
          ' · ' +
          (getDialogPrimaryPhone(item) || 'без номера') +
          ' · ' +
          formatTime(item.lastMessageAt) +
          (item.isActiveForUser === false ? ' · неактивен' : '');
        main.appendChild(meta);

        var preview = document.createElement('div');
        preview.className = 'phab-admin-chat-preview';
        preview.textContent = String(item.lastMessageText || 'Сообщений пока нет');
        main.appendChild(preview);

        var sourceNode = buildDialogSourceNode(item);
        if (sourceNode) {
          side.appendChild(sourceNode);
        }
      });

      if (state.dialogs.length > 0 && (state.hasMoreDialogs || state.dialogsLoadingMore)) {
        var more = document.createElement('li');
        more.className = 'phab-admin-list-more';
        more.textContent = state.dialogsLoadingMore
          ? 'Загружаем ещё диалоги...'
          : 'Прокрутите вниз, чтобы загрузить ещё';
        dom.dialogsList.appendChild(more);
      }

      dialogsScrollBody.scrollTop = previousScrollTop;
    }

    function normalizeSupportDialog(item) {
      if (!item || !item.dialogId) {
        return null;
      }
      var copy = Object.assign({}, item);
      var settings = isPlainObject(item.settings)
        ? {
            vivaStatus: item.settings.vivaStatus || item.vivaStatus || undefined,
            vivaClientId: item.settings.vivaClientId || item.vivaClientId || undefined,
            vivaCabinetUrl: item.settings.vivaCabinetUrl || item.vivaCabinetUrl || undefined
          }
        : (
          item.vivaStatus || item.vivaClientId || item.vivaCabinetUrl
            ? {
                vivaStatus: item.vivaStatus || undefined,
                vivaClientId: item.vivaClientId || undefined,
                vivaCabinetUrl: item.vivaCabinetUrl || undefined
              }
            : undefined
        );
      copy.dialogId = String(item.dialogId);
      copy.dataSource = 'support';
      copy.settings = settings;
      copy.vivaStatus = item.vivaStatus || (settings && settings.vivaStatus) || undefined;
      copy.vivaClientId = item.vivaClientId || (settings && settings.vivaClientId) || undefined;
      copy.vivaCabinetUrl = item.vivaCabinetUrl || (settings && settings.vivaCabinetUrl) || undefined;
      copy.writeStationIds = Array.isArray(item.writeStationIds) ? item.writeStationIds.slice() : [];
      copy.readOnlyStationIds = Array.isArray(item.readOnlyStationIds)
        ? item.readOnlyStationIds.slice()
        : [];
      copy.isReadOnlyForUser = item.isReadOnlyForUser === true;
      copy.isResolved = typeof item.isResolved === 'boolean' ? item.isResolved : false;
      copy.resolvedAt = item.resolvedAt || undefined;
      copy.resolvedByUserId = item.resolvedByUserId || undefined;
      return copy;
    }

    function normalizeLegacyDialog(item) {
      if (!item || !item.threadId) {
        return null;
      }
      var settings = isPlainObject(item.settings)
        ? {
            vivaStatus: item.settings.vivaStatus || item.vivaStatus || undefined,
            vivaClientId: item.settings.vivaClientId || item.vivaClientId || undefined,
            vivaCabinetUrl: item.settings.vivaCabinetUrl || item.vivaCabinetUrl || undefined
          }
        : (
          item.vivaStatus || item.vivaClientId || item.vivaCabinetUrl
            ? {
                vivaStatus: item.vivaStatus || undefined,
                vivaClientId: item.vivaClientId || undefined,
                vivaCabinetUrl: item.vivaCabinetUrl || undefined
              }
            : undefined
        );
      return {
        dialogId: String(item.threadId),
        dataSource: 'messenger',
        connector: item.connector || '',
        stationId: item.stationId || '',
        stationName: item.stationName || item.stationId || 'Без станции',
        currentStationId: item.currentStationId || undefined,
        currentStationName: item.currentStationName || undefined,
        accessStationIds: Array.isArray(item.accessStationIds) ? item.accessStationIds.slice() : [],
        writeStationIds: Array.isArray(item.writeStationIds) ? item.writeStationIds.slice() : [],
        readOnlyStationIds: Array.isArray(item.readOnlyStationIds)
          ? item.readOnlyStationIds.slice()
          : [],
        isActiveForUser: item.isActiveForUser !== false,
        isReadOnlyForUser: item.isReadOnlyForUser === true,
        isResolved: typeof item.isResolved === 'boolean' ? item.isResolved : undefined,
        resolvedAt: item.resolvedAt || undefined,
        resolvedByUserId: item.resolvedByUserId || undefined,
        clientId: item.clientId || '',
        clientDisplayName: item.clientDisplayName || undefined,
        settings: settings,
        vivaStatus: item.vivaStatus || (settings && settings.vivaStatus) || undefined,
        vivaClientId: item.vivaClientId || (settings && settings.vivaClientId) || undefined,
        vivaCabinetUrl: item.vivaCabinetUrl || (settings && settings.vivaCabinetUrl) || undefined,
        vivaCabinetWebviewUrl:
          item.vivaCabinetWebviewUrl || item.vivaCabinetEmbedUrl || undefined,
        authStatus: 'VERIFIED',
        primaryPhone: item.primaryPhone || undefined,
        phones: Array.isArray(item.phones) ? item.phones.slice() : [],
        emails: [],
        subject: item.subject || '',
        status: item.status || 'OPEN',
        unreadCount: Number(item.unreadMessagesCount || 0),
        waitingForStaffSince: undefined,
        pendingClientMessagesCount: Number(item.pendingClientMessagesCount || 0),
        averageFirstResponseMs: item.averageStaffResponseTimeMs,
        lastFirstResponseMs: item.lastStaffResponseTimeMs,
        lastMessageAt: item.lastMessageAt,
        lastRankingMessageAt: item.lastRankingMessageAt || item.lastMessageAt,
        lastMessageText: item.lastMessageText || '',
        lastMessageSenderRole: item.lastMessageSenderRole || '',
        lastMessageSenderRoleRaw: item.lastMessageSenderRoleRaw || item.lastMessageSenderRole || '',
        lastInboundConnector: item.connector || '',
        ai:
          item.aiTopic || item.aiUrgency || typeof item.aiQualityScore === 'number'
            ? {
                topic: item.aiTopic || '',
                sentiment: '',
                priority: item.aiUrgency || ''
              }
            : undefined
      };
    }

    function normalizeConnectorSettingsItem(item) {
      if (!item || !item.id) {
        return null;
      }

      var route = String(item.route || '').trim().toUpperCase();
      return {
        id: String(item.id),
        name: String(item.name || item.id),
        route: route,
        stationIds: Array.isArray(item.stationIds) ? item.stationIds.slice() : [],
        config: isPlainObject(item.config) ? cloneObject(item.config) : buildConnectorConfigTemplate(route),
        isActive: item.isActive !== false,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      };
    }

    function sortDialogsByLastMessage(items) {
      return (Array.isArray(items) ? items.slice() : []).sort(function (left, right) {
        var leftUnread = Number(left && left.unreadCount || 0);
        var rightUnread = Number(right && right.unreadCount || 0);
        if (leftUnread !== rightUnread) {
          return rightUnread - leftUnread;
        }

        var leftPending = Number(left && left.pendingClientMessagesCount || 0);
        var rightPending = Number(right && right.pendingClientMessagesCount || 0);
        if (leftPending !== rightPending) {
          return rightPending - leftPending;
        }

        var leftRank = parseDateValue(left.lastRankingMessageAt);
        var rightRank = parseDateValue(right.lastRankingMessageAt);

        if (leftRank != null && rightRank == null) {
          return -1;
        }
        if (leftRank == null && rightRank != null) {
          return 1;
        }
        if (leftRank != null && rightRank != null && leftRank !== rightRank) {
          return rightRank - leftRank;
        }

        var byLastMessage = compareNullable(parseDateValue(right.lastMessageAt), parseDateValue(left.lastMessageAt));
        if (byLastMessage !== 0) {
          return byLastMessage;
        }

        return String(left && left.dialogId || '').localeCompare(String(right && right.dialogId || ''));
      });
    }

    function buildDialogsSignature(dialogs) {
      return JSON.stringify(
        (Array.isArray(dialogs) ? dialogs : []).map(function (dialog) {
          return [
            String(dialog && dialog.dialogId || ''),
            String(dialog && dialog.stationId || ''),
            String(dialog && dialog.stationName || ''),
            String(dialog && dialog.currentStationId || ''),
            String(dialog && dialog.currentStationName || ''),
            String(dialog && dialog.clientDisplayName || ''),
            String(getDialogPrimaryPhone(dialog) || ''),
            String(dialog && dialog.subject || ''),
            String(dialog && dialog.status || ''),
            String(dialog && dialog.isResolved === true ? '1' : '0'),
            Number(dialog && dialog.unreadCount || 0),
            Number(dialog && dialog.pendingClientMessagesCount || 0),
            String(dialog && dialog.lastMessageAt || ''),
            String(dialog && dialog.lastRankingMessageAt || ''),
            String(dialog && dialog.lastMessageText || ''),
            String(dialog && dialog.lastMessageSenderRole || ''),
            String(dialog && dialog.lastInboundConnector || '')
          ];
        })
      );
    }

    function buildMessagesSignature(messages) {
      return JSON.stringify(
        (Array.isArray(messages) ? messages : []).map(function (message) {
          return [
            String(message && message.id || ''),
            String(message && message.text || ''),
            String(message && message.createdAt || ''),
            String(message && message.direction || ''),
            String(message && message.senderRole || ''),
            String(message && message.senderName || ''),
            String(message && message.connector || ''),
            String(message && message.kind || '')
          ];
        })
      );
    }

    function mergeDialogCollections(previousDialogs, nextDialogs) {
      var mergedById = new Map();
      (Array.isArray(previousDialogs) ? previousDialogs : []).forEach(function (dialog) {
        if (dialog && dialog.dialogId) {
          mergedById.set(dialog.dialogId, dialog);
        }
      });
      (Array.isArray(nextDialogs) ? nextDialogs : []).forEach(function (dialog) {
        if (dialog && dialog.dialogId) {
          mergedById.set(dialog.dialogId, dialog);
        }
      });
      return Array.from(mergedById.values());
    }

    function applyDialogs(nextDialogs, options) {
      var opts = options || {};
      var rawList = sortDialogsByLastMessage(
        (Array.isArray(nextDialogs) ? nextDialogs : []).filter(Boolean)
      );
      var fullList = rawList.filter(function (dialog) {
        return !shouldHideDialog(dialog);
      });
      var previousDialogs = Array.isArray(state.dialogs) ? state.dialogs.slice() : [];
      var nextFilterOptions = buildDialogFilterOptions(fullList);
      var allowedFilterKeys = nextFilterOptions.map(function (option) {
        return option.key;
      });
      var nextFilters = (Array.isArray(state.dialogStationFilters) ? state.dialogStationFilters : []).filter(
        function (filterKey) {
          return allowedFilterKeys.indexOf(filterKey) >= 0;
        }
      );
      var list = fullList.filter(function (dialog) {
        return (
          dialogMatchesStationFilters(dialog, nextFilters) &&
          dialogMatchesSearch(dialog, state.dialogSearchQuery)
        );
      });
      var nextSelectedThreadId = state.selectedThreadId;
      if (list.length > 0) {
        var selectedExists = list.some(function (dialog) {
          return dialog.dialogId === nextSelectedThreadId;
        });
        if (!selectedExists) {
          nextSelectedThreadId = list[0].dialogId;
        }
      } else {
        nextSelectedThreadId = null;
      }

      var nextSignature = buildDialogsSignature(list);
      var dialogsChanged = nextSignature !== state.dialogsSignature;
      var filtersChanged =
        JSON.stringify(nextFilters) !== JSON.stringify(state.dialogStationFilters) ||
        JSON.stringify(nextFilterOptions) !== JSON.stringify(state.dialogFilterOptions);
      var selectionChanged = nextSelectedThreadId !== state.selectedThreadId;

      state.allDialogs = rawList;
      state.dialogs = list;
      state.dialogsSignature = nextSignature;
      state.dialogStationFilters = nextFilters;
      state.dialogFilterOptions = nextFilterOptions;
      state.selectedThreadId = nextSelectedThreadId;
      if (!state.dialogsHydrated) {
        state.dialogsHydrated = true;
      } else if (!opts.silent && shouldPlayIncomingDialogsSound(previousDialogs, list)) {
        playIncomingMessageSound();
      }

      if (opts.forceRender || dialogsChanged || selectionChanged || filtersChanged) {
        renderDialogs();
      }

      return {
        dialogsChanged: dialogsChanged,
        selectionChanged: selectionChanged,
        filtersChanged: filtersChanged
      };
    }

    function updateDialogById(dialogId, updater) {
      if (!dialogId || typeof updater !== 'function') {
        return false;
      }

      var changed = false;
      var patchList = function (items) {
        return (Array.isArray(items) ? items : []).map(function (dialog) {
          if (!dialog || dialog.dialogId !== dialogId) {
            return dialog;
          }
          var nextDialog = updater(dialog);
          if (nextDialog && nextDialog !== dialog) {
            changed = true;
            return nextDialog;
          }
          return dialog;
        });
      };

      state.allDialogs = patchList(state.allDialogs);
      state.dialogs = patchList(state.dialogs);
      return changed;
    }

    function applyVivaLookupToDialog(dialogId, lookup) {
      if (!dialogId || !lookup) {
        return;
      }

      var status = String(lookup.status || '').trim().toUpperCase();
      var vivaCabinetUrl = String(lookup.vivaCabinetUrl || '').trim();
      var vivaClientId = String(lookup.vivaClientId || '').trim();
      if (!status && !vivaCabinetUrl) {
        return;
      }

      var changed = updateDialogById(dialogId, function (dialog) {
        var nextSettings = isPlainObject(dialog.settings)
          ? cloneObject(dialog.settings)
          : {};

        if (status) {
          nextSettings.vivaStatus = status;
        }
        if (vivaClientId) {
          nextSettings.vivaClientId = vivaClientId;
        }
        if (vivaCabinetUrl) {
          nextSettings.vivaCabinetUrl = vivaCabinetUrl;
        }

        var currentStatus = getDialogVivaStatus(dialog);
        var currentClientId =
          dialog.settings && dialog.settings.vivaClientId
            ? String(dialog.settings.vivaClientId).trim()
            : String(dialog.vivaClientId || '').trim();
        var currentCabinetUrl = getDialogCabinetUrl(dialog);

        if (
          currentStatus === (status || currentStatus) &&
          currentClientId === (vivaClientId || currentClientId) &&
          currentCabinetUrl === (vivaCabinetUrl || currentCabinetUrl)
        ) {
          return dialog;
        }

        return Object.assign({}, dialog, {
          settings: nextSettings,
          vivaStatus: status || dialog.vivaStatus,
          vivaClientId: vivaClientId || dialog.vivaClientId,
          vivaCabinetUrl: vivaCabinetUrl || dialog.vivaCabinetUrl
        });
      });

      if (changed) {
        renderDialogHeader();
      }
    }

    async function ensureSelectedDialogVivaCabinet() {
      var selectedDialog = getSelectedDialog();
      if (!selectedDialog || !selectedDialog.dialogId) {
        return null;
      }
      if (getDialogCabinetUrl(selectedDialog)) {
        return null;
      }

      var dialogId = String(selectedDialog.dialogId);
      if (state.vivaLookupPromisesByDialogId[dialogId]) {
        return state.vivaLookupPromisesByDialogId[dialogId];
      }

      var phone = getDialogPrimaryPhone(selectedDialog);
      var request = api
        .lookupDialogVivaCabinet(dialogId, phone || undefined)
        .then(function (lookup) {
          if (lookup) {
            applyVivaLookupToDialog(dialogId, lookup);
          }
          return lookup;
        })
        .catch(function () {
          return null;
        })
        .finally(function () {
          delete state.vivaLookupPromisesByDialogId[dialogId];
        });

      state.vivaLookupPromisesByDialogId[dialogId] = request;
      return request;
    }

    async function loadMoreDialogsIfNeeded() {
      if (state.activeTab !== 'messages' || state.dialogsLoadingMore || !state.hasMoreDialogs) {
        return;
      }

      var container = dom.dialogsScrollBody || dom.dialogsList;
      if (!container) {
        return;
      }

      var distanceToBottom = container.scrollHeight - container.clientHeight - container.scrollTop;
      if (distanceToBottom > DIALOGS_SCROLL_THRESHOLD_PX) {
        return;
      }

      await loadDialogs({
        append: true,
        silent: true
      });
    }

    async function setDialogStationFilters(nextFilters) {
      state.dialogStationFilters = Array.isArray(nextFilters) ? nextFilters.slice() : [];
      var dialogsResult = applyDialogs(state.allDialogs, {
        forceRender: true,
        silent: true
      });

      if (!state.selectedThreadId) {
        applyMessages([], { forceRender: true, forceScrollBottom: true });
        return;
      }

      if (dialogsResult && dialogsResult.selectionChanged) {
        await openSelectedDialog();
      }
    }

    async function setDialogSearchQuery(nextQuery) {
      var previousPhoneSearch = state.dialogSearchPhoneDigits;
      state.dialogSearchQuery = String(nextQuery || '').trim();
      state.dialogSearchPhoneDigits = resolvePhoneSearchDigits(state.dialogSearchQuery);

      if (state.dialogSearchPhoneDigits || previousPhoneSearch) {
        await refreshDialogsView();
        return;
      }

      var dialogsResult = applyDialogs(state.allDialogs, {
        forceRender: true,
        silent: true
      });

      if (!state.selectedThreadId) {
        applyMessages([], { forceRender: true, forceScrollBottom: true });
        return;
      }

      if (dialogsResult && dialogsResult.selectionChanged) {
        await openSelectedDialog();
      }
    }

    function resolveIncludeServiceMessages(value) {
      return value === true;
    }

    async function setIncludeServiceMessages(nextValue) {
      state.includeServiceMessages = resolveIncludeServiceMessages(nextValue);
      saveStoredIncludeServiceMessages(state.includeServiceMessages);
      state.messagesCacheByThreadId = Object.create(null);
      state.messagesFetchPromisesByThreadId = Object.create(null);
      var dialogsResult = applyDialogs(state.allDialogs, {
        forceRender: true,
        silent: true
      });

      if (!state.selectedThreadId) {
        applyMessages([], { forceRender: true, forceScrollBottom: true });
        return;
      }

      if (dialogsResult && dialogsResult.selectionChanged) {
        await openSelectedDialog();
        return;
      }

      await loadMessages({
        forceRender: true,
        preserveScroll: true,
        forceRefresh: true
      });
    }

    async function setDialogResolved(nextResolved) {
      var dialog = getSelectedDialog();
      if (!dialog || !dialog.dialogId) {
        return;
      }
      if (typeof dialog.isResolved !== 'boolean') {
        return;
      }
      if (state.updatingResolution) {
        return;
      }

      state.updatingResolution = true;
      renderMessageModeToggle();
      try {
        var payload = await api.setLegacyDialogResolution(dialog.dialogId, nextResolved === true);
        var normalized = normalizeLegacyDialog(payload || {});
        var resolvedDialogId = String(dialog.dialogId);
        if (normalized && normalized.dialogId === resolvedDialogId) {
          for (var i = 0; i < state.allDialogs.length; i += 1) {
            if (String(state.allDialogs[i] && state.allDialogs[i].dialogId || '') !== resolvedDialogId) {
              continue;
            }
            state.allDialogs[i] = Object.assign({}, state.allDialogs[i], normalized);
          }
        } else {
          dialog.isResolved = nextResolved === true;
          if (nextResolved === true) {
            dialog.pendingClientMessagesCount = 0;
            dialog.hasNewMessages = false;
          }
        }

        applyDialogs(state.allDialogs, {
          forceRender: true,
          silent: true
        });
        renderMessageModeToggle();
      } finally {
        state.updatingResolution = false;
        renderMessageModeToggle();
      }
    }

    function markSelectedDialogAsReadLocally() {
      var dialog = getSelectedDialog();
      if (!dialog || Number(dialog.unreadCount || 0) <= 0) {
        return;
      }
      dialog.unreadCount = 0;
      applyDialogs(state.allDialogs, {
        forceRender: true,
        silent: true
      });
    }

    function applyMessages(nextMessages, options) {
      var opts = options || {};
      var rawList = Array.isArray(nextMessages) ? nextMessages : [];
      var list = getVisibleMessages(rawList);
      var nextSignature = buildMessagesSignature(list);
      var nextThreadId = state.selectedThreadId || null;
      var messagesChanged =
        nextSignature !== state.messagesSignature || nextThreadId !== state.messagesThreadId;

      state.rawMessages = rawList;
      state.messages = list;
      state.messagesSignature = nextSignature;
      state.messagesThreadId = nextThreadId;

      if (opts.forceRender || messagesChanged) {
        renderMessages(state.messages, {
          preserveScroll: Boolean(opts.preserveScroll),
          forceScrollBottom: Boolean(opts.forceScrollBottom)
        });
      }

      return {
        messagesChanged: messagesChanged
      };
    }

    function resolveMessagesLimit(rawLimit) {
      var parsed = Number(rawLimit);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return state.messagePageSize || MESSAGES_PAGE_SIZE;
      }
      return Math.max(1, Math.min(Math.floor(parsed), 500));
    }

    function buildMessagesCacheKey(threadId, options) {
      var opts = options || {};
      var includeService = resolveIncludeServiceMessages(opts.includeService);
      var before = String(opts.before || '');
      var limit = String(resolveMessagesLimit(opts.limit));
      return (
        String(threadId || '') +
        '|includeService=' +
        (includeService ? 'true' : 'false') +
        '|before=' +
        before +
        '|limit=' +
        limit
      );
    }

    function getCachedMessages(threadId, options) {
      if (!threadId) {
        return null;
      }
      var cacheKey = buildMessagesCacheKey(threadId, options);
      return state.messagesCacheByThreadId[cacheKey] || null;
    }

    function setMessagesLoading(loading, threadId) {
      state.messagesLoading = Boolean(loading);
      state.messagesLoadingThreadId = loading ? (threadId || null) : null;
      renderMessages(state.messages, {
        forceScrollBottom: false,
        preserveScroll: true
      });
    }

    function fetchDialogMessages(threadId, options) {
      var opts = options || {};
      if (!threadId) {
        return Promise.resolve([]);
      }

      var requestOptions = {
        includeService: resolveIncludeServiceMessages(opts.includeService),
        before: opts.before,
        limit: resolveMessagesLimit(opts.limit)
      };
      var cacheKey = buildMessagesCacheKey(threadId, requestOptions);

      if (!opts.forceRefresh) {
        var cached = getCachedMessages(threadId, requestOptions);
        if (cached) {
          return Promise.resolve(cached.slice());
        }
      }

      var inFlight = state.messagesFetchPromisesByThreadId[cacheKey];
      if (inFlight) {
        return inFlight;
      }

      var request = api.getLegacyMessages(threadId, {
        includeService: requestOptions.includeService,
        before: requestOptions.before,
        limit: requestOptions.limit
      })
        .then(function (payload) {
          var normalized = normalizeLegacyMessages(payload || []);
          state.messagesCacheByThreadId[cacheKey] = normalized.slice();
          return normalized;
        })
        .finally(function () {
          delete state.messagesFetchPromisesByThreadId[cacheKey];
        });

      state.messagesFetchPromisesByThreadId[cacheKey] = request;
      return request;
    }

    function prefetchDialogMessages(threadId) {
      if (!threadId || threadId === state.selectedThreadId) {
        return;
      }
      if (getCachedMessages(threadId, { includeService: shouldIncludeServiceMessages() })) {
        return;
      }
      fetchDialogMessages(threadId, {
        forceRefresh: false,
        includeService: shouldIncludeServiceMessages(),
        limit: state.messagePageSize
      }).catch(function () {
        // ignore background prefetch failures
      });
    }

    function normalizeSupportMessages(messages) {
      return (Array.isArray(messages) ? messages : []).map(function (message) {
        return Object.assign({ dataSource: 'support' }, message);
      });
    }

    function normalizeLegacyMessages(messages) {
      return (Array.isArray(messages) ? messages : []).map(function (message) {
        var senderRole = String(message.senderRole || '').toUpperCase();
        var senderRoleRaw = String(message.senderRoleRaw || senderRole || '').toUpperCase();
        var direction = String(message.direction || '').toUpperCase();
        var isSystem = direction === 'SYSTEM' || senderRoleRaw === 'SYSTEM';
        var senderName = String(message.senderName || '').trim();
        return {
          id: message.id,
          dataSource: 'messenger',
          text: message.text || '',
          createdAt: message.createdAt,
          connector: '',
          kind: 'TEXT',
          direction: isSystem ? 'SYSTEM' : (senderRole === 'CLIENT' ? 'INBOUND' : 'OUTBOUND'),
          senderRole: isSystem ? 'SYSTEM' : senderRole,
          senderRoleRaw: senderRoleRaw,
          senderTitle: senderName || undefined,
          senderName:
            isSystem
              ? (senderName || 'Система')
              : senderName || (
                senderRole === 'CLIENT'
                  ? 'Клиент'
                  : senderRole === 'SUPER_ADMIN'
                    ? 'Суперадмин'
                    : senderRole === 'STATION_ADMIN'
                      ? 'Администратор станции'
                      : senderRole === 'MANAGER'
                        ? 'Менеджер'
                        : 'Сотрудник'
              )
        };
      });
    }

    function renderMessages(messages, options) {
      var opts = options || {};
      var previousScrollTop = dom.messagesBox.scrollTop;
      var previousClientHeight = dom.messagesBox.clientHeight;
      var previousScrollHeight = dom.messagesBox.scrollHeight;
      var distanceFromBottom = previousScrollHeight - previousScrollTop - previousClientHeight;
      var shouldStickToBottom = opts.forceScrollBottom || distanceFromBottom <= 24;

      clearNode(dom.messagesBox);
      clearNode(dom.dialogTags);
      var selectedDialog = getSelectedDialog();
      if (!state.selectedThreadId) {
        dom.input.disabled = true;
        dom.sendBtn.disabled = true;
        dom.input.placeholder = 'Выберите чат слева...';
        var hint = document.createElement('div');
        hint.className = 'phab-admin-empty';
        hint.textContent = 'Выберите чат слева, чтобы открыть переписку';
        dom.messagesBox.appendChild(hint);
        return;
      }

      if (!selectedDialog) {
        renderDialogHeader();
      }

      if (selectedDialog) {
        var dialogIsActiveForUser = selectedDialog.isActiveForUser !== false;
        dom.input.disabled = !dialogIsActiveForUser;
        dom.sendBtn.disabled = !dialogIsActiveForUser;
        dom.input.placeholder = dialogIsActiveForUser
          ? 'Ответ сотрудника...'
          : 'Чат неактивен для вашей станции';

        var dialogStationLabel = String(
          selectedDialog.stationName || selectedDialog.stationId || 'Без станции'
        );
        var selectedStationLabel = String(
          selectedDialog.currentStationName || selectedDialog.currentStationId || ''
        ).trim();
        applyDialogHeader({
          clientDisplayName: getDialogDisplayTitle(selectedDialog),
          subject: selectedDialog.subject,
          primaryPhone:
            selectedDialog.primaryPhone &&
            getDialogDisplayTitle(selectedDialog) !== selectedDialog.primaryPhone
              ? selectedDialog.primaryPhone
              : undefined,
          stationName: dialogStationLabel,
          stationId: selectedDialog.stationId,
          connector: selectedDialog.lastInboundConnector || selectedDialog.connector,
          authStatus: selectedDialog.authStatus,
          averageFirstResponseMs: selectedDialog.averageFirstResponseMs,
          lastMessageAt: selectedDialog.lastMessageAt,
          vivaStatus: selectedDialog.vivaStatus,
          vivaCabinetUrl: selectedDialog.vivaCabinetUrl,
          vivaCabinetWebviewUrl: selectedDialog.vivaCabinetWebviewUrl
        });

        [
          selectedDialog.lastInboundConnector,
          selectedDialog.ai && selectedDialog.ai.topic,
          selectedDialog.ai && selectedDialog.ai.sentiment,
          selectedDialog.ai && selectedDialog.ai.priority
        ]
          .filter(Boolean)
          .forEach(function (value) {
            dom.dialogTags.appendChild(createConnectorTagNode(value));
          });

        if (
          selectedStationLabel &&
          String(selectedDialog.stationId || '').trim().toUpperCase() === 'UNASSIGNED' &&
          selectedStationLabel !== dialogStationLabel
        ) {
          var stationChip = document.createElement('span');
          stationChip.className = 'phab-admin-chip phab-admin-chip-warn';
          stationChip.textContent = 'выбрана станция: ' + selectedStationLabel;
          dom.dialogTags.appendChild(stationChip);
        }

        if (selectedDialog.phones && selectedDialog.phones.length > 1) {
          var phonesChip = document.createElement('span');
          phonesChip.className = 'phab-admin-chip';
          phonesChip.textContent = 'телефоны: ' + selectedDialog.phones.join(', ');
          dom.dialogTags.appendChild(phonesChip);
        }

        if (selectedDialog.isActiveForUser === false) {
          var inactiveChip = document.createElement('span');
          inactiveChip.className = 'phab-admin-chip phab-admin-chip-warn';
          inactiveChip.textContent = 'неактивный чат для вашей станции';
          dom.dialogTags.appendChild(inactiveChip);
        }
      }

      if (!messages || messages.length === 0) {
        if (
          state.messagesLoading &&
          state.messagesLoadingThreadId &&
          state.messagesLoadingThreadId === state.selectedThreadId
        ) {
          for (var skeletonIndex = 0; skeletonIndex < 4; skeletonIndex += 1) {
            var skeleton = document.createElement('div');
            skeleton.className = 'phab-admin-message-skeleton phab-admin-skeleton';
            dom.messagesBox.appendChild(skeleton);
          }
          return;
        }

        var empty = document.createElement('div');
        empty.className = 'phab-admin-empty';
        empty.textContent =
          state.rawMessages && state.rawMessages.length > 0
            ? 'Сообщения скрыты текущими настройками'
            : 'Сообщений пока нет';
        dom.messagesBox.appendChild(empty);
        return;
      }

      messages.forEach(function (message) {
        var isSystem = message.direction === 'SYSTEM' || message.senderRole === 'SYSTEM';
        var own = !isSystem && message.direction !== 'INBOUND' && message.senderRole !== 'CLIENT';
        var div = document.createElement('div');
        div.className =
          'phab-admin-message ' +
          (isSystem
            ? 'phab-admin-message-system'
            : own
              ? 'phab-admin-message-staff'
              : 'phab-admin-message-client');
        var text = document.createElement('span');
        text.className = 'phab-admin-message-text';
        text.textContent = message.text || '';
        div.appendChild(text);

        var meta = document.createElement('span');
        meta.className = 'phab-admin-message-meta';
        var roleLabel = formatRoleLabel(String(message.senderRoleRaw || message.senderRole || '').toUpperCase());
        var sender = isSystem
          ? 'Система'
          : own
            ? (message.senderName || 'Сотрудник')
            : (message.senderName || 'Клиент');
        meta.textContent =
          sender +
          (!isSystem && own && roleLabel && sender !== roleLabel ? ' · ' + roleLabel : '') +
          ' · ' +
          (message.connector || '-') +
          ' · ' +
          (message.kind || '-') +
          ' · ' +
          formatTime(message.createdAt);
        div.appendChild(meta);

        dom.messagesBox.appendChild(div);
      });

      if (shouldStickToBottom) {
        dom.messagesBox.scrollTop = dom.messagesBox.scrollHeight;
        return;
      }

      if (opts.preserveScroll) {
        dom.messagesBox.scrollTop = Math.max(
          0,
          dom.messagesBox.scrollHeight - dom.messagesBox.clientHeight - Math.max(0, distanceFromBottom)
        );
        return;
      }

      dom.messagesBox.scrollTop = previousScrollTop;
    }

    function parseDateValue(value) {
      if (!value) {
        return null;
      }
      var parsed = Date.parse(String(value));
      return Number.isFinite(parsed) ? parsed : null;
    }

    function parseGameDateValue(game) {
      var gameDate = String(game.gameDate || '').trim();
      var gameTime = String(game.gameTime || '').trim();
      if (gameDate) {
        var hhmm = '00:00';
        if (gameTime) {
          var match = gameTime.match(/(\d{2}:\d{2})/);
          if (match && match[1]) {
            hhmm = match[1];
          }
        }
        var ts = Date.parse(gameDate + 'T' + hhmm + ':00');
        if (Number.isFinite(ts)) {
          return ts;
        }
      }
      return parseDateValue(game.startsAt);
    }

    function compareNullable(left, right) {
      if (left == null && right == null) {
        return 0;
      }
      if (left == null) {
        return 1;
      }
      if (right == null) {
        return -1;
      }
      if (left < right) {
        return -1;
      }
      if (left > right) {
        return 1;
      }
      return 0;
    }

    function sortGames(items) {
      var list = Array.isArray(items) ? items.slice() : [];
      var field = state.gamesSortField || 'createdAt';
      var direction = state.gamesSortDirection === 'asc' ? 1 : -1;

      list.sort(function (left, right) {
        var result = 0;

        if (field === 'createdAt') {
          result = compareNullable(parseDateValue(left.createdAt), parseDateValue(right.createdAt));
        } else if (field === 'gameDate') {
          result = compareNullable(parseGameDateValue(left), parseGameDateValue(right));
        } else {
          var leftName = String(left.organizerName || '').trim().toLowerCase();
          var rightName = String(right.organizerName || '').trim().toLowerCase();
          if (!leftName && !rightName) {
            result = 0;
          } else if (!leftName) {
            result = 1;
          } else if (!rightName) {
            result = -1;
          } else {
            result = leftName.localeCompare(rightName, 'ru');
          }
        }

        if (result === 0) {
          result = compareNullable(parseDateValue(left.createdAt), parseDateValue(right.createdAt));
        }

        return result * direction;
      });

      return list;
    }

    function getGamesSortIndicator(field) {
      if (state.gamesSortField !== field) {
        return '';
      }
      return state.gamesSortDirection === 'asc' ? '↑' : '↓';
    }

    function setGamesSorting(field) {
      if (state.gamesSortField === field) {
        state.gamesSortDirection = state.gamesSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        state.gamesSortField = field;
        state.gamesSortDirection = field === 'organizer' ? 'asc' : 'desc';
      }
      state.gamesPage = 1;
      renderGames();
    }

    function getGameParticipantLines(game) {
      if (Array.isArray(game.teamParticipantLines) && game.teamParticipantLines.length > 0) {
        return game.teamParticipantLines
          .map(function (line) {
            return String(line || '').trim();
          })
          .filter(function (line) {
            return Boolean(line);
          });
      }

      if (Array.isArray(game.participantDetails) && game.participantDetails.length > 0) {
        return game.participantDetails
          .map(function (participant) {
            var name = String((participant && participant.name) || '').trim();
            if (!name) {
              return null;
            }
            var phone = String((participant && participant.phone) || '').trim();
            return phone ? name + ' · ' + phone : name;
          })
          .filter(function (line) {
            return Boolean(line);
          });
      }

      if (Array.isArray(game.participantNames) && game.participantNames.length > 0) {
        return game.participantNames
          .map(function (name) {
            return String(name || '').trim();
          })
          .filter(function (name) {
            return Boolean(name);
          });
      }

      return [];
    }

    function normalizeMultilineValue(value) {
      var text = String(value || '');
      if (!text) {
        return [];
      }
      return text
        .split(/\r?\n/)
        .map(function (line) {
          return String(line || '').trim();
        })
        .filter(function (line) {
          return Boolean(line);
        });
    }

    function getGameResultLines(game) {
      if (Array.isArray(game.resultLines) && game.resultLines.length > 0) {
        return game.resultLines
          .map(function (line) {
            return String(line || '').trim();
          })
          .filter(function (line) {
            return Boolean(line);
          });
      }
      return normalizeMultilineValue(game.result);
    }

    function getGameRatingDeltaLines(game) {
      if (Array.isArray(game.ratingDeltaLines) && game.ratingDeltaLines.length > 0) {
        return game.ratingDeltaLines
          .map(function (line) {
            return String(line || '').trim();
          })
          .filter(function (line) {
            return Boolean(line);
          });
      }
      return normalizeMultilineValue(game.ratingDelta);
    }

    function getGameLocationParts(game) {
      var station = String(game.stationName || '').trim();
      var court = String(game.courtName || '').trim();
      if (station || court) {
        return { station: station || '-', court: court || '-' };
      }

      var location = String(game.locationName || '').trim();
      if (location && location.indexOf('·') !== -1) {
        var chunks = location
          .split('·')
          .map(function (chunk) {
            return String(chunk || '').trim();
          })
          .filter(function (chunk) {
            return Boolean(chunk);
          });
        if (chunks.length >= 2) {
          return { station: chunks[0], court: chunks.slice(1).join(' · ') };
        }
      }

      return { station: location || '-', court: '-' };
    }

    function applyColumnWidth(columnNode, width) {
      if (!columnNode) {
        return;
      }
      if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
        columnNode.style.width = String(Math.round(width)) + 'px';
      }
    }

    function clampGamesPage(totalItems) {
      var pageSize = Number(state.gamesPageSize || 15);
      if (!Number.isFinite(pageSize) || pageSize <= 0) {
        pageSize = 15;
      }
      var totalPages = Math.max(1, Math.ceil(Number(totalItems || 0) / pageSize));
      var page = Number(state.gamesPage || 1);
      if (!Number.isFinite(page) || page <= 0) {
        page = 1;
      }
      if (page > totalPages) {
        page = totalPages;
      }
      state.gamesPageSize = pageSize;
      state.gamesPage = page;
      return { pageSize: pageSize, totalPages: totalPages, page: page };
    }

    function updateGamesPaginationControls(totalItems, totalPages) {
      if (totalItems === 0) {
        dom.gamesPageInfo.textContent = 'Страница 1 из 1 · 0 игр';
        dom.gamesPrevPageBtn.disabled = true;
        dom.gamesNextPageBtn.disabled = true;
        dom.gamesPageSizeSelect.value = String(state.gamesPageSize);
        return;
      }
      var from = totalItems === 0 ? 0 : (state.gamesPage - 1) * state.gamesPageSize + 1;
      var to = Math.min(totalItems, state.gamesPage * state.gamesPageSize);
      dom.gamesPageInfo.textContent =
        'Страница ' +
        String(state.gamesPage) +
        ' из ' +
        String(totalPages) +
        ' · ' +
        String(from) +
        '-' +
        String(to) +
        ' из ' +
        String(totalItems);
      dom.gamesPrevPageBtn.disabled = state.gamesPage <= 1;
      dom.gamesNextPageBtn.disabled = state.gamesPage >= totalPages;
      dom.gamesPageSizeSelect.value = String(state.gamesPageSize);
    }

    function updateGameEventsPaginationControls(totalItems, totalPages) {
      if (totalItems === 0) {
        dom.logsPageInfo.textContent = 'Страница 1 из 1 · 0 событий';
        dom.logsPrevPageBtn.disabled = true;
        dom.logsNextPageBtn.disabled = true;
        return;
      }
      var from = (state.gameEventsPage - 1) * state.gameEventsPageSize + 1;
      var to = Math.min(totalItems, state.gameEventsPage * state.gameEventsPageSize);
      dom.logsPageInfo.textContent =
        'Страница ' +
        String(state.gameEventsPage) +
        ' из ' +
        String(totalPages) +
        ' · ' +
        String(from) +
        '-' +
        String(to) +
        ' из ' +
        String(totalItems);
      dom.logsPrevPageBtn.disabled = state.gameEventsPage <= 1;
      dom.logsNextPageBtn.disabled = state.gameEventsPage >= totalPages;
    }

    function attachColumnResizeHandle(headerNode, options) {
      var handle = document.createElement('span');
      handle.className = 'phab-admin-col-resizer';
      handle.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
      });
      headerNode.appendChild(handle);

      handle.addEventListener('mousedown', function (event) {
        event.preventDefault();
        event.stopPropagation();

        var startX = Number(event.clientX || 0);
        var startWidth = headerNode.getBoundingClientRect().width;
        var minWidth = options && options.minWidth ? options.minWidth : 90;

        function onMouseMove(moveEvent) {
          var nextWidth = Math.max(minWidth, startWidth + (Number(moveEvent.clientX || 0) - startX));
          if (options && typeof options.onResize === 'function') {
            options.onResize(nextWidth);
          }
        }

        function onMouseUp() {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          if (document.body) {
            document.body.classList.remove('phab-admin-resizing');
          }
        }

        if (document.body) {
          document.body.classList.add('phab-admin-resizing');
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    }

    function renderGames() {
      clearNode(dom.gamesTable);
      var sortedGames = sortGames(state.games);
      var pagination = clampGamesPage(sortedGames.length);
      var startIndex = (pagination.page - 1) * pagination.pageSize;
      var pageGames = sortedGames.slice(startIndex, startIndex + pagination.pageSize);
      updateGamesPaginationControls(sortedGames.length, pagination.totalPages);

      var columns = [
        { key: 'organizer', label: 'Организатор', sortField: 'organizer', minWidth: 170 },
        { key: 'participants', label: 'Состав', minWidth: 220 },
        { key: 'createdAt', label: 'Создана', sortField: 'createdAt', minWidth: 150 },
        { key: 'gameDate', label: 'Дата игры', sortField: 'gameDate', minWidth: 160 },
        { key: 'result', label: 'Результат', minWidth: 130 },
        { key: 'ratingDelta', label: 'Δ рейтинг', minWidth: 120 },
        { key: 'station', label: 'Станция', minWidth: 150 },
        { key: 'court', label: 'Корт', minWidth: 170 },
        { key: 'status', label: 'Статус', minWidth: 140 }
      ];
      if (!isRestrictedStationAdmin) {
        columns.splice(columns.length - 1, 0, { key: 'chat', label: 'Чат', minWidth: 110 });
      }
      var colgroup = document.createElement('colgroup');
      var colRefs = {};
      columns.forEach(function (column) {
        var col = document.createElement('col');
        colRefs[column.key] = col;
        applyColumnWidth(col, state.gamesColumnWidths[column.key]);
        colgroup.appendChild(col);
      });
      dom.gamesTable.appendChild(colgroup);

      var thead = document.createElement('thead');
      var headRow = document.createElement('tr');
      columns.forEach(function (item) {
        var th = document.createElement('th');
        th.textContent = item.label;
        applyColumnWidth(th, state.gamesColumnWidths[item.key]);
        if (item.sortField) {
          th.className = 'phab-admin-games-sortable';
          var indicator = getGamesSortIndicator(item.sortField);
          if (indicator) {
            var indicatorNode = document.createElement('span');
            indicatorNode.className = 'phab-admin-games-sort-indicator';
            indicatorNode.textContent = indicator;
            th.appendChild(indicatorNode);
          }
          th.addEventListener('click', function () {
            setGamesSorting(item.sortField);
          });
        }
        attachColumnResizeHandle(th, {
          minWidth: item.minWidth,
          onResize: function (nextWidth) {
            state.gamesColumnWidths[item.key] = nextWidth;
            applyColumnWidth(th, nextWidth);
            applyColumnWidth(colRefs[item.key], nextWidth);
          }
        });
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      dom.gamesTable.appendChild(thead);

      var tbody = document.createElement('tbody');
      dom.gamesTable.appendChild(tbody);

      if (state.games.length === 0) {
        var tr = document.createElement('tr');
        var td = document.createElement('td');
        td.colSpan = columns.length;
        td.textContent = 'Нет игр';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      pageGames.forEach(function (game) {
        var tr = document.createElement('tr');
        tr.className = 'phab-admin-games-row';
        tr.addEventListener('click', function () {
          openGameDetails(game).catch(handleError);
        });
        var gameDate = game.gameDate
          ? game.gameDate + (game.gameTime ? ' ' + game.gameTime : '')
          : formatTime(game.startsAt);
        var participantsCell = document.createElement('td');
        var participantLines = getGameParticipantLines(game);
        if (participantLines.length === 0) {
          participantsCell.textContent = '-';
        } else {
          participantLines.forEach(function (line) {
            var lineNode = document.createElement('span');
            lineNode.className = 'phab-admin-games-cell-line';
            if (line.indexOf('Команда ') === 0) {
              lineNode.className += ' phab-admin-games-team-title';
            }
            lineNode.textContent = line;
            participantsCell.appendChild(lineNode);
          });
        }

        var organizerCell = document.createElement('td');
        organizerCell.textContent = String(game.organizerName || '-');
        tr.appendChild(organizerCell);

        tr.appendChild(participantsCell);

        var createdCell = document.createElement('td');
        createdCell.textContent = String(formatTime(game.createdAt));
        tr.appendChild(createdCell);

        var gameDateCell = document.createElement('td');
        gameDateCell.textContent = String(gameDate || '-');
        tr.appendChild(gameDateCell);

        var resultCell = document.createElement('td');
        resultCell.className = 'phab-admin-games-result-cell';
        var resultLines = getGameResultLines(game);
        if (resultLines.length === 0) {
          resultCell.textContent = '-';
        } else {
          resultLines.forEach(function (line) {
            var resultLineNode = document.createElement('span');
            resultLineNode.className = 'phab-admin-games-cell-line';
            resultLineNode.textContent = line;
            resultCell.appendChild(resultLineNode);
          });
        }
        tr.appendChild(resultCell);

        var ratingDeltaCell = document.createElement('td');
        ratingDeltaCell.className = 'phab-admin-games-rating-cell';
        var ratingDeltaLines = getGameRatingDeltaLines(game);
        if (ratingDeltaLines.length === 0) {
          ratingDeltaCell.textContent = '-';
        } else {
          ratingDeltaLines.forEach(function (line) {
            var ratingLineNode = document.createElement('span');
            ratingLineNode.className = 'phab-admin-games-cell-line';
            ratingLineNode.textContent = line;
            ratingDeltaCell.appendChild(ratingLineNode);
          });
        }
        tr.appendChild(ratingDeltaCell);

        var locationParts = getGameLocationParts(game);

        var stationCell = document.createElement('td');
        stationCell.textContent = locationParts.station;
        tr.appendChild(stationCell);

        var courtCell = document.createElement('td');
        courtCell.textContent = locationParts.court;
        tr.appendChild(courtCell);

        if (!isRestrictedStationAdmin) {
          var chatCell = document.createElement('td');
          var chatBtn = document.createElement('button');
          chatBtn.type = 'button';
          chatBtn.className = 'phab-admin-btn-secondary phab-admin-games-chat-btn';
          chatBtn.textContent = 'Чат';
          chatBtn.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            openGameChat(game).catch(handleError);
          });
          chatCell.appendChild(chatBtn);
          tr.appendChild(chatCell);
        }

        var statusCell = document.createElement('td');
        statusCell.textContent = String(game.rawStatus || game.status || '-');
        tr.appendChild(statusCell);

        tbody.appendChild(tr);
      });
    }

    function renderGameEvents() {
      clearNode(dom.logsTable);

      var columns = [
        { key: 'timestamp', label: 'Время', minWidth: 150 },
        { key: 'event', label: 'Событие', minWidth: 160 },
        { key: 'source', label: 'Источник', minWidth: 120 },
        { key: 'user', label: 'Пользователь', minWidth: 190 },
        { key: 'page', label: 'Страница', minWidth: 180 },
        { key: 'summary', label: 'Payload', minWidth: 260 },
        { key: 'sessionId', label: 'Session', minWidth: 170 }
      ];
      var colgroup = document.createElement('colgroup');
      var colRefs = {};
      columns.forEach(function (column) {
        var col = document.createElement('col');
        colRefs[column.key] = col;
        applyColumnWidth(col, state.gameEventsColumnWidths[column.key]);
        colgroup.appendChild(col);
      });
      dom.logsTable.appendChild(colgroup);

      var thead = document.createElement('thead');
      var headRow = document.createElement('tr');
      columns.forEach(function (column) {
        var th = document.createElement('th');
        th.textContent = column.label;
        applyColumnWidth(th, state.gameEventsColumnWidths[column.key]);
        attachColumnResizeHandle(th, {
          minWidth: column.minWidth,
          onResize: function (nextWidth) {
            state.gameEventsColumnWidths[column.key] = nextWidth;
            applyColumnWidth(th, nextWidth);
            applyColumnWidth(colRefs[column.key], nextWidth);
          }
        });
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      dom.logsTable.appendChild(thead);

      var tbody = document.createElement('tbody');
      dom.logsTable.appendChild(tbody);

      if (state.gameEvents.length === 0) {
        var emptyRow = document.createElement('tr');
        var emptyCell = document.createElement('td');
        emptyCell.colSpan = 7;
        emptyCell.textContent = 'Нет событий';
        emptyRow.appendChild(emptyCell);
        tbody.appendChild(emptyRow);
        updateGameEventsPaginationControls(0, 1);
        return;
      }

      state.gameEvents.forEach(function (event) {
        var tr = document.createElement('tr');
        tr.className = 'phab-admin-games-row';
        tr.addEventListener('click', function () {
          openGameEventDetails(event).catch(handleError);
        });

        var timestampCell = document.createElement('td');
        timestampCell.textContent = formatTime(event.timestamp);
        tr.appendChild(timestampCell);

        var eventCell = document.createElement('td');
        renderCellLines(eventCell, [event.event, event.tenantKey ? 'tenant: ' + event.tenantKey : null].filter(Boolean), '-');
        tr.appendChild(eventCell);

        var sourceCell = document.createElement('td');
        sourceCell.textContent = String(event.source || '-');
        tr.appendChild(sourceCell);

        var userCell = document.createElement('td');
        renderCellLines(userCell, buildEventUserLines(event), '-');
        tr.appendChild(userCell);

        var pageCell = document.createElement('td');
        renderCellLines(
          pageCell,
          [event.pagePath, event.pageHref].filter(function (value, index, list) {
            return Boolean(value) && list.indexOf(value) === index;
          }),
          '-'
        );
        tr.appendChild(pageCell);

        var summaryCell = document.createElement('td');
        renderCellLines(summaryCell, buildEventSummaryLines(event), '-');
        tr.appendChild(summaryCell);

        var sessionCell = document.createElement('td');
        renderCellLines(sessionCell, [event.sessionId], '-');
        tr.appendChild(sessionCell);

        tbody.appendChild(tr);
      });

      updateGameEventsPaginationControls(state.gameEventsTotal, state.gameEventsTotalPages);
    }

    function renderAnalytics() {
      clearNode(dom.analyticsTable);

      var columns = [
        { key: 'stationName', label: 'Станция', minWidth: 220 },
        { key: 'gamesCount', label: 'Игр создано', minWidth: 140 },
        { key: 'playersAddedCount', label: 'Игроков добавилось', minWidth: 170 },
        { key: 'paymentsAmount', label: 'Сумма оплат', minWidth: 160 }
      ];
      var colgroup = document.createElement('colgroup');
      var colRefs = {};
      columns.forEach(function (column) {
        var col = document.createElement('col');
        colRefs[column.key] = col;
        applyColumnWidth(col, state.analyticsColumnWidths[column.key]);
        colgroup.appendChild(col);
      });
      dom.analyticsTable.appendChild(colgroup);

      var thead = document.createElement('thead');
      var headRow = document.createElement('tr');
      columns.forEach(function (column) {
        var th = document.createElement('th');
        th.textContent = column.label;
        applyColumnWidth(th, state.analyticsColumnWidths[column.key]);
        attachColumnResizeHandle(th, {
          minWidth: column.minWidth,
          onResize: function (nextWidth) {
            state.analyticsColumnWidths[column.key] = nextWidth;
            applyColumnWidth(th, nextWidth);
            applyColumnWidth(colRefs[column.key], nextWidth);
          }
        });
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      dom.analyticsTable.appendChild(thead);

      var tbody = document.createElement('tbody');
      dom.analyticsTable.appendChild(tbody);

      if (state.analytics.length === 0) {
        var emptyRow = document.createElement('tr');
        var emptyCell = document.createElement('td');
        emptyCell.colSpan = 4;
        emptyCell.textContent = 'Нет данных за период';
        emptyRow.appendChild(emptyCell);
        tbody.appendChild(emptyRow);
        return;
      }

      state.analytics.forEach(function (item) {
        var tr = document.createElement('tr');
        [
          item.stationName || 'Без станции',
          String(Number(item.gamesCount || 0)),
          String(Number(item.playersAddedCount || 0)),
          formatMoney(item.paymentsAmount || 0)
        ].forEach(function (value) {
          var td = document.createElement('td');
          td.textContent = value;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });

      var tfoot = document.createElement('tfoot');
      var totalRow = document.createElement('tr');
      [
        'Итого',
        String(Number(state.analyticsTotals.gamesCount || 0)),
        String(Number(state.analyticsTotals.playersAddedCount || 0)),
        formatMoney(state.analyticsTotals.paymentsAmount || 0)
      ].forEach(function (value) {
        var td = document.createElement('td');
        td.textContent = value;
        td.style.fontWeight = '700';
        totalRow.appendChild(td);
      });
      tfoot.appendChild(totalRow);
      dom.analyticsTable.appendChild(tfoot);
    }

    function renderTournaments() {
      clearNode(dom.tournamentsTable);

      var columns = [
        { key: 'id', label: 'ID', minWidth: 130 },
        { key: 'name', label: 'Название', minWidth: 180 },
        { key: 'status', label: 'Статус', minWidth: 130 },
        { key: 'gameId', label: 'Игра', minWidth: 130 },
        { key: 'startsAt', label: 'Старт', minWidth: 150 },
        { key: 'updatedAt', label: 'Обновлено', minWidth: 150 }
      ];
      var colgroup = document.createElement('colgroup');
      var colRefs = {};
      columns.forEach(function (column) {
        var col = document.createElement('col');
        colRefs[column.key] = col;
        applyColumnWidth(col, state.tournamentsColumnWidths[column.key]);
        colgroup.appendChild(col);
      });
      dom.tournamentsTable.appendChild(colgroup);

      var thead = document.createElement('thead');
      var headRow = document.createElement('tr');
      columns.forEach(function (column) {
        var th = document.createElement('th');
        th.textContent = column.label;
        applyColumnWidth(th, state.tournamentsColumnWidths[column.key]);
        attachColumnResizeHandle(th, {
          minWidth: column.minWidth,
          onResize: function (nextWidth) {
            state.tournamentsColumnWidths[column.key] = nextWidth;
            applyColumnWidth(th, nextWidth);
            applyColumnWidth(colRefs[column.key], nextWidth);
          }
        });
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      dom.tournamentsTable.appendChild(thead);

      var tbody = document.createElement('tbody');
      dom.tournamentsTable.appendChild(tbody);

      if (state.tournaments.length === 0) {
        var tr = document.createElement('tr');
        var td = document.createElement('td');
        td.colSpan = 6;
        td.textContent = 'Нет турниров';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      state.tournaments.forEach(function (tournament) {
        var tr = document.createElement('tr');
        [
          tournament.id,
          tournament.name,
          tournament.status,
          tournament.gameId || '-',
          formatTime(tournament.startsAt),
          formatTime(tournament.updatedAt)
        ].forEach(function (value) {
          var td = document.createElement('td');
          td.textContent = String(value || '-');
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }

    function renderSettingsStations() {
      clearNode(dom.stationList);
      var stations = state.settings.stations || [];
      if (stations.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'phab-admin-empty';
        empty.textContent = 'Станции не настроены';
        dom.stationList.appendChild(empty);
        return;
      }

      stations.forEach(function (station) {
        var row = document.createElement('div');
        row.className = 'phab-admin-settings-row';
        dom.stationList.appendChild(row);

        var main = document.createElement('div');
        main.className = 'phab-admin-settings-row-main';
        row.appendChild(main);

        var title = document.createElement('div');
        title.className = 'phab-admin-settings-row-title';
        title.textContent = station.stationName + ' (' + station.stationId + ')';
        main.appendChild(title);

        var meta = document.createElement('div');
        meta.className = 'phab-admin-settings-row-meta';
        meta.textContent =
          (station.isActive ? 'active' : 'inactive') + ' · обновлено ' + formatTime(station.updatedAt);
        main.appendChild(meta);

        var action = document.createElement('button');
        action.type = 'button';
        action.className = 'phab-admin-btn-secondary';
        action.textContent = station.isActive ? 'Выкл' : 'Вкл';
        action.addEventListener('click', function () {
          toggleStation(station).catch(handleError);
        });
        row.appendChild(action);
      });
    }

    function renderConnectorConfigGuide(route) {
      dom.connectorConfigGuide.textContent = formatConnectorConfigGuide(route);
    }

    function applyConnectorConfigTemplateForRoute(route, force) {
      var shouldFill = force || !String(dom.connectorConfigInput.value || '').trim();
      if (!shouldFill) {
        renderConnectorConfigGuide(route);
        return;
      }
      var template = buildConnectorConfigTemplate(route);
      dom.connectorConfigInput.value = JSON.stringify(template, null, 2);
      renderConnectorConfigGuide(route);
    }

    function parseConnectorConfigInput() {
      var raw = String(dom.connectorConfigInput.value || '').trim();
      if (!raw) {
        return buildConnectorConfigTemplate(dom.connectorRouteInput.value);
      }

      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_error) {
        throw new Error('Некорректный JSON в конфиге коннектора');
      }

      if (!isPlainObject(parsed)) {
        throw new Error('Конфиг коннектора должен быть JSON-объектом');
      }

      return parsed;
    }

    function renderSettingsConnectors() {
      clearNode(dom.connectorList);
      var connectors = state.settings.connectors || [];
      if (connectors.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'phab-admin-empty';
        empty.textContent = 'Коннекторы не настроены';
        dom.connectorList.appendChild(empty);
        return;
      }

      connectors.forEach(function (connector) {
        var row = document.createElement('div');
        row.className = 'phab-admin-settings-row';
        dom.connectorList.appendChild(row);

        var main = document.createElement('div');
        main.className = 'phab-admin-settings-row-main';
        row.appendChild(main);

        var title = document.createElement('div');
        title.className = 'phab-admin-settings-row-title';
        title.textContent = connector.name + ' [' + connector.route + ']';
        main.appendChild(title);

        var meta = document.createElement('div');
        meta.className = 'phab-admin-settings-row-meta';
        meta.textContent =
          (connector.isActive ? 'active' : 'inactive') +
          ' · станции: ' +
          (connector.stationIds && connector.stationIds.length > 0
            ? connector.stationIds.join(', ')
            : 'all') +
          ' · config: ' +
          (connector.config && Object.keys(connector.config).length > 0
            ? Object.keys(connector.config).join(', ')
            : '-');
        main.appendChild(meta);

        var configAction = document.createElement('button');
        configAction.type = 'button';
        configAction.className = 'phab-admin-btn-secondary';
        configAction.textContent = 'Конфиг';
        configAction.addEventListener('click', function () {
          editConnectorConfig(connector).catch(handleError);
        });
        row.appendChild(configAction);

        var action = document.createElement('button');
        action.type = 'button';
        action.className = 'phab-admin-btn-secondary';
        action.textContent = connector.isActive ? 'Выкл' : 'Вкл';
        action.addEventListener('click', function () {
          toggleConnector(connector).catch(handleError);
        });
        row.appendChild(action);
      });
    }

    function renderSettingsAccessRules() {
      clearNode(dom.accessList);
      var rules = state.settings.accessRules || [];
      if (rules.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'phab-admin-empty';
        empty.textContent = 'Правила доступа не настроены';
        dom.accessList.appendChild(empty);
        return;
      }

      rules.forEach(function (rule) {
        var row = document.createElement('div');
        row.className = 'phab-admin-settings-row';
        dom.accessList.appendChild(row);

        var main = document.createElement('div');
        main.className = 'phab-admin-settings-row-main';
        row.appendChild(main);

        var title = document.createElement('div');
        title.className = 'phab-admin-settings-row-title';
        title.textContent = rule.role + ' · ' + (rule.canWrite ? 'read/write' : 'read');
        main.appendChild(title);

        var meta = document.createElement('div');
        meta.className = 'phab-admin-settings-row-meta';
        meta.textContent =
          'stations=' +
          (rule.stationIds && rule.stationIds.length > 0 ? rule.stationIds.join(',') : 'all') +
          ' · routes=' +
          (rule.connectorRoutes && rule.connectorRoutes.length > 0
            ? rule.connectorRoutes.join(',')
            : 'all');
        main.appendChild(meta);
      });
    }

    function renderSettingsViva() {
      clearNode(dom.vivaList);

      if (!canManageVivaSettings(cfg)) {
        dom.vivaCard.className = 'phab-admin-settings-card phab-admin-hidden';
        return;
      }

      dom.vivaCard.className = 'phab-admin-settings-card';

      var viva = state.settings.viva || null;
      var summary = document.createElement('div');
      summary.className = 'phab-admin-settings-row';
      dom.vivaList.appendChild(summary);

      var main = document.createElement('div');
      main.className = 'phab-admin-settings-row-main';
      summary.appendChild(main);

      var title = document.createElement('div');
      title.className = 'phab-admin-settings-row-title';
      title.textContent = 'Конфигурация Viva Admin API';
      main.appendChild(title);

      var meta = document.createElement('div');
      meta.className = 'phab-admin-settings-row-meta';
      meta.textContent = viva
        ? 'источник: ' +
          (viva.source || 'defaults') +
          ' · статический token: ' +
          (viva.hasStaticToken ? 'настроен' : 'нет') +
          ' · password grant: ' +
          (viva.username && viva.hasPassword ? 'настроен' : 'неполный') +
          (viva.updatedAt ? ' · обновлено: ' + formatDateTimeFull(viva.updatedAt) : '') +
          (viva.updatedBy ? ' · кем: ' + viva.updatedBy : '')
        : 'Настройки Viva пока не загружены';
      main.appendChild(meta);

      dom.vivaBaseUrlInput.value = viva && viva.baseUrl ? viva.baseUrl : '';
      dom.vivaTokenUrlInput.value = viva && viva.tokenUrl ? viva.tokenUrl : '';
      dom.vivaClientIdInput.value = viva && viva.clientId ? viva.clientId : '';
      dom.vivaUsernameInput.value = viva && viva.username ? viva.username : '';
      dom.vivaStaticTokenInput.value = '';
      dom.vivaPasswordInput.value = '';
    }

    function renderSettingsAdminUsers() {
      clearNode(dom.staffList);
      var users = state.settings.adminUsers || [];
      if (users.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'phab-admin-empty';
        empty.textContent = 'Сотрудники в auth-конфигурации не найдены';
        dom.staffList.appendChild(empty);
        return;
      }

      [
        { role: 'SUPER_ADMIN', title: 'Суперадмины' },
        { role: 'MANAGER', title: 'Управляющие' },
        { role: 'STATION_ADMIN', title: 'Админы станций' }
      ].forEach(function (group) {
        var groupUsers = users.filter(function (user) {
          return Array.isArray(user.roles) && user.roles.indexOf(group.role) >= 0;
        });
        if (groupUsers.length === 0) {
          return;
        }

        var groupTitle = document.createElement('div');
        groupTitle.className = 'phab-admin-settings-label';
        groupTitle.style.marginBottom = '6px';
        groupTitle.textContent = group.title;
        dom.staffList.appendChild(groupTitle);

        groupUsers.forEach(function (user) {
          var row = document.createElement('div');
          row.className = 'phab-admin-settings-row';
          dom.staffList.appendChild(row);

          var main = document.createElement('div');
          main.className = 'phab-admin-settings-row-main';
          row.appendChild(main);

          var title = document.createElement('div');
          title.className = 'phab-admin-settings-row-title';
          title.textContent = user.title || user.login;
          main.appendChild(title);

          var meta = document.createElement('div');
          meta.className = 'phab-admin-settings-row-meta';
          meta.textContent =
            'логин: ' +
            user.login +
            ' · ' +
            user.roles.map(formatRoleLabel).join(', ') +
            ' · станции: ' +
            formatStationScope(user.stationIds);
          main.appendChild(meta);
        });
      });
    }

    function renderSettings() {
      renderSettingsStations();
      renderSettingsConnectors();
      renderSettingsAccessRules();
      renderSettingsViva();
      renderSettingsAdminUsers();
    }

    async function loadDialogs(options) {
      var opts = options || {};
      var append = opts.append === true;
      var limit = append
        ? state.dialogPageSize
        : Math.max(state.allDialogs.length || state.dialogPageSize, state.dialogPageSize);
      var offset = append ? state.allDialogs.length : 0;

      if (append) {
        state.dialogsLoadingMore = true;
      }

      try {
        var legacyDialogs =
          (await api.getLegacyDialogs({
            limit: limit,
            offset: offset,
            phone: state.dialogSearchPhoneDigits || undefined
          })) || [];
        var normalizedDialogs = legacyDialogs.map(normalizeLegacyDialog).filter(Boolean);
        state.hasMoreDialogs = normalizedDialogs.length >= limit;

        if (append) {
          return applyDialogs(mergeDialogCollections(state.allDialogs, normalizedDialogs), opts);
        }

        return applyDialogs(normalizedDialogs, opts);
      } finally {
        if (append) {
          state.dialogsLoadingMore = false;
        }
      }
    }

    async function openSelectedDialog() {
      renderDialogs();
      if (!state.selectedThreadId) {
        applyMessages([], { forceRender: true, forceScrollBottom: true });
        return;
      }
      var vivaLookupPromise = ensureSelectedDialogVivaCabinet();
      await loadMessages({ forceRender: true, forceScrollBottom: true, forceRefresh: true });
      await vivaLookupPromise;
      markSelectedDialogAsReadLocally();
      if (!getSelectedDialog()) {
        applyMessages([], { forceRender: true, forceScrollBottom: true });
        return;
      }
      renderDialogHeader();
    }

    async function refreshDialogsView() {
      var dialogsResult = await loadDialogs();
      if (!state.selectedThreadId) {
        applyMessages([], { forceRender: true, forceScrollBottom: true });
        return;
      }
      await loadMessages(
        dialogsResult && dialogsResult.selectionChanged
          ? { forceRender: true, forceScrollBottom: true, forceRefresh: true }
          : { preserveScroll: true, forceRefresh: true }
      );
      if (dialogsResult && dialogsResult.selectionChanged) {
        await ensureSelectedDialogVivaCabinet();
      }
    }

    async function loadMessages(options) {
      var opts = options || {};
      if (!state.selectedThreadId) {
        applyMessages([], { forceRender: true, forceScrollBottom: true });
        return;
      }
      var threadId = state.selectedThreadId;
      var requestToken = String(threadId) + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
      state.latestMessagesRequestToken = requestToken;
      var requestOptions = {
        includeService: shouldIncludeServiceMessages(),
        before: opts.before,
        limit: resolveMessagesLimit(opts.limit)
      };

      var cached = getCachedMessages(threadId, requestOptions);
      if (cached) {
        applyMessages(cached.slice(), opts);
      } else {
        applyMessages([], Object.assign({}, opts, { forceRender: true }));
        setMessagesLoading(true, threadId);
      }

      try {
        var normalized = await fetchDialogMessages(
          threadId,
          Object.assign({}, requestOptions, {
            forceRefresh: opts.forceRefresh !== false
          })
        );
        if (state.latestMessagesRequestToken !== requestToken) {
          return;
        }
        state.messagesLoading = false;
        state.messagesLoadingThreadId = null;
        applyMessages(normalized.slice(), opts);
      } catch (error) {
        if (state.latestMessagesRequestToken === requestToken) {
          state.messagesLoading = false;
          state.messagesLoadingThreadId = null;
          renderMessages(state.messages, {
            forceScrollBottom: false,
            preserveScroll: true
          });
        }
        throw error;
      }
    }

    async function loadGames() {
      state.games = (await api.getGames()) || [];
      renderGames();
    }

    async function loadGameEvents() {
      var response =
        (await api.getGameEvents({
          event: state.gameEventsFilterEvent || undefined,
          phone: state.gameEventsFilterPhone || undefined,
          from: state.gameEventsFilterFrom || undefined,
          to: state.gameEventsFilterTo || undefined,
          page: state.gameEventsPage,
          pageSize: state.gameEventsPageSize
        })) || [];

      if (Array.isArray(response)) {
        state.gameEvents = response;
        state.gameEventsTotal = response.length;
        state.gameEventsTotalPages = response.length > 0 ? 1 : 1;
        state.gameEventsPage = 1;
      } else {
        state.gameEvents = Array.isArray(response.items) ? response.items : [];
        state.gameEventsTotal = Number(response.total || 0);
        state.gameEventsPage = Math.max(1, Number(response.page || state.gameEventsPage || 1));
        state.gameEventsPageSize = Math.max(
          1,
          Number(response.pageSize || state.gameEventsPageSize || 30)
        );
        state.gameEventsTotalPages = Math.max(
          1,
          Number(response.totalPages || Math.ceil(state.gameEventsTotal / state.gameEventsPageSize) || 1)
        );
      }

      dom.logsEventInput.value = state.gameEventsFilterEvent;
      dom.logsPhoneInput.value = state.gameEventsFilterPhone;
      dom.logsFromInput.value = state.gameEventsFilterFrom;
      dom.logsToInput.value = state.gameEventsFilterTo;
      renderGameEvents();
    }

    async function loadGameAnalytics() {
      var response =
        (await api.getGameAnalytics({
          from: state.analyticsFilterFrom || undefined,
          to: state.analyticsFilterTo || undefined
        })) || {};

      state.analytics = Array.isArray(response.items) ? response.items : [];
      state.analyticsTotals = isObject(response.totals)
        ? {
            gamesCount: Number(response.totals.gamesCount || 0),
            playersAddedCount: Number(response.totals.playersAddedCount || 0),
            paymentsAmount: Number(response.totals.paymentsAmount || 0)
          }
        : {
            gamesCount: 0,
            playersAddedCount: 0,
            paymentsAmount: 0
          };

      dom.analyticsFromInput.value = state.analyticsFilterFrom;
      dom.analyticsToInput.value = state.analyticsFilterTo;
      renderAnalytics();
    }

    async function loadTournaments() {
      state.tournaments = (await api.getTournaments()) || [];
      renderTournaments();
    }

    async function loadSettings() {
      if (isRestrictedStationAdmin) {
        state.settings = {
          stations: [],
          connectors: [],
          accessRules: [],
          adminUsers: [],
          viva: null
        };
        renderSettings();
        return;
      }
      var settings = (await api.getSettings()) || {};
      var adminUsersResponse = (await api.getAdminUsers()) || {};
      var vivaSettings =
        canManageVivaSettings(cfg) ? (await api.getVivaSettings()) || null : null;
      state.settings = {
        stations: settings.stations || [],
        connectors: (settings.connectors || [])
          .map(normalizeConnectorSettingsItem)
          .filter(Boolean),
        accessRules: settings.accessRules || [],
        adminUsers: Array.isArray(adminUsersResponse.users) ? adminUsersResponse.users : [],
        viva: vivaSettings
      };
      renderSettings();
    }

    async function saveVivaSettings() {
      if (!canManageVivaSettings(cfg)) {
        return;
      }

      dom.vivaSaveBtn.disabled = true;
      try {
        var payload = {
          baseUrl: String(dom.vivaBaseUrlInput.value || '').trim(),
          tokenUrl: String(dom.vivaTokenUrlInput.value || '').trim(),
          clientId: String(dom.vivaClientIdInput.value || '').trim(),
          username: String(dom.vivaUsernameInput.value || '').trim()
        };

        var staticToken = String(dom.vivaStaticTokenInput.value || '').trim();
        var password = String(dom.vivaPasswordInput.value || '').trim();
        if (staticToken) {
          payload.staticToken = staticToken;
        }
        if (password) {
          payload.password = password;
        }

        await api.updateVivaSettings(payload);
        await loadSettings();
        await refreshDialogsView();
        setStatus('Настройки Viva сохранены', false);
      } finally {
        dom.vivaSaveBtn.disabled = false;
      }
    }

    async function createStation() {
      var stationId = String(dom.stationIdInput.value || '').trim();
      if (!stationId) {
        setStatus('Укажите stationId', true);
        return;
      }

      dom.stationCreateBtn.disabled = true;
      try {
        await api.createStation({
          stationId: stationId,
          stationName: String(dom.stationNameInput.value || '').trim() || undefined,
          isActive: Boolean(dom.stationActiveInput.checked)
        });
        dom.stationIdInput.value = '';
        dom.stationNameInput.value = '';
        dom.stationActiveInput.checked = true;
        await loadSettings();
        await refreshDialogsView();
        setStatus('Станция добавлена', false);
      } finally {
        dom.stationCreateBtn.disabled = false;
      }
    }

    async function toggleStation(station) {
      await api.updateStation(station.stationId, { isActive: !station.isActive });
      await loadSettings();
      await refreshDialogsView();
      setStatus('Станция обновлена', false);
    }

    async function createConnector() {
      var name = String(dom.connectorNameInput.value || '').trim();
      if (!name) {
        setStatus('Укажите название коннектора', true);
        return;
      }

      dom.connectorCreateBtn.disabled = true;
      try {
        var config = parseConnectorConfigInput();
        await api.createConnector({
          name: name,
          route: dom.connectorRouteInput.value,
          stationIds: parseCsvInput(dom.connectorStationsInput.value),
          config: config,
          isActive: Boolean(dom.connectorActiveInput.checked)
        });
        dom.connectorNameInput.value = '';
        dom.connectorStationsInput.value = '';
        applyConnectorConfigTemplateForRoute(dom.connectorRouteInput.value, true);
        dom.connectorActiveInput.checked = true;
        await loadSettings();
        await refreshDialogsView();
        setStatus('Коннектор добавлен', false);
      } finally {
        dom.connectorCreateBtn.disabled = false;
      }
    }

    async function editConnectorConfig(connector) {
      var current = isPlainObject(connector && connector.config)
        ? connector.config
        : buildConnectorConfigTemplate(connector && connector.route);
      var raw = window.prompt(
        'Редактирование config (JSON) для ' + String(connector.name || connector.id),
        JSON.stringify(current, null, 2)
      );
      if (raw === null) {
        return;
      }

      var parsed;
      try {
        parsed = JSON.parse(String(raw || '').trim() || '{}');
      } catch (_error) {
        throw new Error('Некорректный JSON в конфиге коннектора');
      }
      if (!isPlainObject(parsed)) {
        throw new Error('Конфиг коннектора должен быть JSON-объектом');
      }

      await api.updateConnector(connector.id, { config: parsed });
      await loadSettings();
      await refreshDialogsView();
      setStatus('Конфиг коннектора обновлен', false);
    }

    async function toggleConnector(connector) {
      await api.updateConnector(connector.id, { isActive: !connector.isActive });
      await loadSettings();
      await refreshDialogsView();
      setStatus('Коннектор обновлен', false);
    }

    async function createAccessRule() {
      dom.accessCreateBtn.disabled = true;
      try {
        var routes = parseCsvInput(dom.accessRoutesInput.value)
          .map(function (value) {
            return value.toUpperCase();
          })
          .filter(function (value) {
            return CONNECTOR_ROUTES.indexOf(value) >= 0;
          });
        await api.createAccessRule({
          role: dom.accessRoleInput.value,
          stationIds: parseCsvInput(dom.accessStationsInput.value),
          connectorRoutes: routes,
          canRead: Boolean(dom.accessReadInput.checked),
          canWrite: Boolean(dom.accessWriteInput.checked)
        });
        dom.accessStationsInput.value = '';
        dom.accessRoutesInput.value = '';
        dom.accessReadInput.checked = true;
        dom.accessWriteInput.checked = false;
        await loadSettings();
        await refreshDialogsView();
        setStatus('Правило доступа добавлено', false);
      } finally {
        dom.accessCreateBtn.disabled = false;
      }
    }

    async function sendMessage() {
      var text = String(dom.input.value || '').trim();
      if (!text || !state.selectedThreadId) {
        return;
      }

      dom.sendBtn.disabled = true;
      try {
        await api.sendLegacyMessage(state.selectedThreadId, text);
        dom.input.value = '';
        await loadDialogs();
        await loadMessages({ forceRender: true, forceScrollBottom: true });
        setStatus('Сообщение отправлено', false);
      } finally {
        dom.sendBtn.disabled = false;
      }
    }

    function switchTab(nextTab) {
      if (isRestrictedStationAdmin && ['logs', 'analytics', 'settings'].indexOf(nextTab) >= 0) {
        nextTab = 'messages';
      }
      state.activeTab = nextTab;
      var isMessages = nextTab === 'messages';
      var isGames = nextTab === 'games';
      var isLogs = nextTab === 'logs';
      var isAnalytics = nextTab === 'analytics';
      var isTournaments = nextTab === 'tournaments';
      var isSettings = nextTab === 'settings';
      var hideLogsTab = isRestrictedStationAdmin;
      var hideAnalyticsTab = isRestrictedStationAdmin;
      var hideSettingsTab = isRestrictedStationAdmin;

      dom.tabMessages.className = 'phab-admin-tab' + (isMessages ? ' phab-admin-tab-active' : '');
      dom.tabGames.className = 'phab-admin-tab' + (isGames ? ' phab-admin-tab-active' : '');
      dom.tabLogs.className =
        'phab-admin-tab' +
        (isLogs ? ' phab-admin-tab-active' : '') +
        (hideLogsTab ? ' phab-admin-hidden' : '');
      dom.tabAnalytics.className =
        'phab-admin-tab' +
        (isAnalytics ? ' phab-admin-tab-active' : '') +
        (hideAnalyticsTab ? ' phab-admin-hidden' : '');
      dom.tabTournaments.className =
        'phab-admin-tab' + (isTournaments ? ' phab-admin-tab-active' : '');
      dom.tabSettings.className =
        'phab-admin-tab' +
        (isSettings ? ' phab-admin-tab-active' : '') +
        (hideSettingsTab ? ' phab-admin-hidden' : '');
      dom.messagesSection.className = isMessages ? '' : 'phab-admin-hidden';
      dom.gamesSection.className = isGames ? '' : 'phab-admin-hidden';
      dom.logsSection.className = isLogs ? '' : 'phab-admin-hidden';
      dom.analyticsSection.className = isAnalytics ? '' : 'phab-admin-hidden';
      dom.tournamentsSection.className = isTournaments ? '' : 'phab-admin-hidden';
      dom.settingsSection.className = isSettings ? '' : 'phab-admin-hidden';
    }

    function handleError(error) {
      setStatus(error && error.message ? error.message : 'Ошибка', true);
      if (window.console && console.error) {
        console.error('[PHAB admin panel]', error);
      }
    }

    async function logout() {
      dom.logoutBtn.disabled = true;
      dom.refreshBtn.disabled = true;
      setStatus('Выходим...', false);
      try {
        await api.logout();
      } catch (error) {
        if (!(error && /Требуется авторизация/i.test(String(error.message || '')))) {
          throw error;
        }
      } finally {
        cfg.authToken = '';
        try {
          window.localStorage.removeItem('phab_admin_token');
        } catch (_error) {
          // ignore localStorage errors
        }
      }

      window.location.href = '/api/ui/admin/login?next=' + encodeURIComponent('/api/ui/admin');
    }

    async function refreshActiveTab() {
      try {
        setStatus('Обновление...', false);
        if (state.activeTab === 'messages') {
          await refreshDialogsView();
        } else if (state.activeTab === 'games') {
          await loadGames();
        } else if (state.activeTab === 'logs') {
          await loadGameEvents();
        } else if (state.activeTab === 'analytics') {
          await loadGameAnalytics();
        } else if (state.activeTab === 'tournaments') {
          await loadTournaments();
        } else {
          await loadSettings();
        }
        setStatus('Готово', false);
      } catch (error) {
        handleError(error);
      }
    }

    function bindEvents() {
      bindIncomingSoundUnlock();
      if (isRestrictedStationAdmin) {
        dom.tabLogs.classList.add('phab-admin-hidden');
        dom.tabAnalytics.classList.add('phab-admin-hidden');
        dom.tabSettings.classList.add('phab-admin-hidden');
      }
      dom.tabMessages.addEventListener('click', function () {
        switchTab('messages');
        refreshDialogsView().catch(handleError);
      });
      dom.tabGames.addEventListener('click', function () {
        switchTab('games');
        loadGames().catch(handleError);
      });
      dom.tabLogs.addEventListener('click', function () {
        switchTab('logs');
        loadGameEvents().catch(handleError);
      });
      dom.tabAnalytics.addEventListener('click', function () {
        switchTab('analytics');
        loadGameAnalytics().catch(handleError);
      });
      dom.tabTournaments.addEventListener('click', function () {
        switchTab('tournaments');
        loadTournaments().catch(handleError);
      });
      dom.tabSettings.addEventListener('click', function () {
        switchTab('settings');
        loadSettings().catch(handleError);
      });
      dom.messageModeToggle.addEventListener('change', function () {
        setIncludeServiceMessages(dom.messageModeToggle.checked).catch(handleError);
      });
      dom.resolutionToggle.addEventListener('change', function () {
        setDialogResolved(dom.resolutionToggle.checked).catch(function (error) {
          var selected = getSelectedDialog();
          dom.resolutionToggle.checked = selected ? selected.isResolved === true : false;
          handleError(error);
          renderMessageModeToggle();
        });
      });
      dom.dialogSearchInput.addEventListener('input', function () {
        var nextValue = dom.dialogSearchInput.value;
        if (dialogSearchTimer) {
          window.clearTimeout(dialogSearchTimer);
        }
        dialogSearchTimer = window.setTimeout(function () {
          setDialogSearchQuery(nextValue).catch(handleError);
        }, 220);
      });
      dom.dialogSearchInput.addEventListener('search', function () {
        if (dialogSearchTimer) {
          window.clearTimeout(dialogSearchTimer);
        }
        setDialogSearchQuery(dom.dialogSearchInput.value).catch(handleError);
      });
      dom.dialogSearchInput.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') {
          return;
        }
        event.preventDefault();
        if (dialogSearchTimer) {
          window.clearTimeout(dialogSearchTimer);
        }
        setDialogSearchQuery(dom.dialogSearchInput.value).catch(handleError);
      });
      dom.dialogsScrollBody.addEventListener('scroll', function () {
        loadMoreDialogsIfNeeded().catch(handleError);
      });
      dom.gamesPageSizeSelect.addEventListener('change', function () {
        var next = Number(dom.gamesPageSizeSelect.value || 15);
        state.gamesPageSize = next === 50 ? 50 : 15;
        state.gamesPage = 1;
        renderGames();
      });
      dom.gamesPrevPageBtn.addEventListener('click', function () {
        if (state.gamesPage <= 1) {
          return;
        }
        state.gamesPage -= 1;
        renderGames();
      });
      dom.gamesNextPageBtn.addEventListener('click', function () {
        state.gamesPage += 1;
        renderGames();
      });
      dom.logsApplyBtn.addEventListener('click', function () {
        state.gameEventsFilterEvent = String(dom.logsEventInput.value || '').trim();
        state.gameEventsFilterPhone = String(dom.logsPhoneInput.value || '').trim();
        state.gameEventsFilterFrom = String(dom.logsFromInput.value || '').trim();
        state.gameEventsFilterTo = String(dom.logsToInput.value || '').trim();
        state.gameEventsPage = 1;
        loadGameEvents().catch(handleError);
      });
      dom.logsResetBtn.addEventListener('click', function () {
        state.gameEventsFilterEvent = '';
        state.gameEventsFilterPhone = '';
        state.gameEventsFilterFrom = '';
        state.gameEventsFilterTo = '';
        state.gameEventsPage = 1;
        dom.logsEventInput.value = '';
        dom.logsPhoneInput.value = '';
        dom.logsFromInput.value = '';
        dom.logsToInput.value = '';
        loadGameEvents().catch(handleError);
      });
      dom.logsPrevPageBtn.addEventListener('click', function () {
        if (state.gameEventsPage <= 1) {
          return;
        }
        state.gameEventsPage -= 1;
        loadGameEvents().catch(handleError);
      });
      dom.logsNextPageBtn.addEventListener('click', function () {
        if (state.gameEventsPage >= state.gameEventsTotalPages) {
          return;
        }
        state.gameEventsPage += 1;
        loadGameEvents().catch(handleError);
      });
      dom.analyticsApplyBtn.addEventListener('click', function () {
        state.analyticsFilterFrom = String(dom.analyticsFromInput.value || '').trim();
        state.analyticsFilterTo = String(dom.analyticsToInput.value || '').trim();
        loadGameAnalytics().catch(handleError);
      });
      dom.analyticsResetBtn.addEventListener('click', function () {
        state.analyticsFilterFrom = getMonthStartDateInputValue();
        state.analyticsFilterTo = getTodayDateInputValue();
        dom.analyticsFromInput.value = state.analyticsFilterFrom;
        dom.analyticsToInput.value = state.analyticsFilterTo;
        loadGameAnalytics().catch(handleError);
      });
      [dom.logsEventInput, dom.logsPhoneInput, dom.logsFromInput, dom.logsToInput].forEach(function (input) {
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') {
            event.preventDefault();
            state.gameEventsFilterEvent = String(dom.logsEventInput.value || '').trim();
            state.gameEventsFilterPhone = String(dom.logsPhoneInput.value || '').trim();
            state.gameEventsFilterFrom = String(dom.logsFromInput.value || '').trim();
            state.gameEventsFilterTo = String(dom.logsToInput.value || '').trim();
            state.gameEventsPage = 1;
            loadGameEvents().catch(handleError);
          }
        });
      });
      [dom.analyticsFromInput, dom.analyticsToInput].forEach(function (input) {
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') {
            event.preventDefault();
            state.analyticsFilterFrom = String(dom.analyticsFromInput.value || '').trim();
            state.analyticsFilterTo = String(dom.analyticsToInput.value || '').trim();
            loadGameAnalytics().catch(handleError);
          }
        });
      });
      dom.refreshBtn.addEventListener('click', function () {
        refreshActiveTab().catch(handleError);
      });
      dom.logoutBtn.addEventListener('click', function () {
        logout().catch(function (error) {
          dom.logoutBtn.disabled = false;
          dom.refreshBtn.disabled = false;
          handleError(error);
        });
      });
      dom.sendBtn.addEventListener('click', function () {
        sendMessage().catch(handleError);
      });
      dom.input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          sendMessage().catch(handleError);
        }
      });
      dom.stationCreateBtn.addEventListener('click', function () {
        createStation().catch(handleError);
      });
      dom.connectorCreateBtn.addEventListener('click', function () {
        createConnector().catch(handleError);
      });
      dom.connectorRouteInput.addEventListener('change', function () {
        applyConnectorConfigTemplateForRoute(dom.connectorRouteInput.value, false);
      });
      dom.connectorConfigTemplateBtn.addEventListener('click', function () {
        applyConnectorConfigTemplateForRoute(dom.connectorRouteInput.value, true);
      });
      dom.accessCreateBtn.addEventListener('click', function () {
        createAccessRule().catch(handleError);
      });
      dom.vivaSaveBtn.addEventListener('click', function () {
        saveVivaSettings().catch(handleError);
      });
      dom.gameModalCloseBtn.addEventListener('click', function () {
        closeGameModal();
      });
      dom.gameModal.addEventListener('click', function (event) {
        if (event.target === dom.gameModal) {
          closeGameModal();
        }
      });
      dom.eventModalCloseBtn.addEventListener('click', function () {
        closeGameEventModal();
      });
      dom.eventDeleteBtn.addEventListener('click', function () {
        deleteSelectedGameEvent().catch(handleError);
      });
      dom.eventModal.addEventListener('click', function (event) {
        if (event.target === dom.eventModal) {
          closeGameEventModal();
        }
      });
      dom.gameChatCloseBtn.addEventListener('click', function () {
        closeGameChatModal();
      });
      dom.gameChatModal.addEventListener('click', function (event) {
        if (event.target === dom.gameChatModal) {
          closeGameChatModal();
        }
      });
      dom.gameChatSendBtn.addEventListener('click', function () {
        sendGameChatMessage().catch(handleError);
      });
      dom.gameChatInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          sendGameChatMessage().catch(handleError);
        }
      });
      documentKeydownHandler = function (event) {
        if (event.key !== 'Escape') {
          return;
        }
        if (!dom.gameChatModal.classList.contains('phab-admin-hidden')) {
          closeGameChatModal();
          return;
        }
        if (!dom.eventModal.classList.contains('phab-admin-hidden')) {
          closeGameEventModal();
          return;
        }
        if (!dom.gameModal.classList.contains('phab-admin-hidden')) {
          closeGameModal();
        }
      };
      document.addEventListener('keydown', documentKeydownHandler);
      applyConnectorConfigTemplateForRoute(dom.connectorRouteInput.value, false);
    }

    async function init() {
      bindEvents();
      await refreshDialogsView();
      pollTimer = window.setInterval(function () {
        if (state.activeTab === 'messages') {
          refreshDialogsView().catch(handleError);
        }
      }, cfg.pollIntervalMs);
      setStatus('Готово', false);
    }

    function destroy() {
      if (pollTimer) {
        window.clearInterval(pollTimer);
      }
      if (dialogSearchTimer) {
        window.clearTimeout(dialogSearchTimer);
      }
      if (documentKeydownHandler) {
        document.removeEventListener('keydown', documentKeydownHandler);
      }
      [dom.gameModal, dom.eventModal, dom.gameChatModal].forEach(function (node) {
        if (node && node.parentNode) {
          node.parentNode.removeChild(node);
        }
      });
      if (!cfg.mountSelector) {
        root.remove();
      } else {
        root.innerHTML = '';
      }
    }

    init().catch(handleError);
    return {
      destroy: destroy,
      reload: function () {
        return refreshActiveTab();
      }
    };
  }

  window.PHABAdminPanel = {
    init: function (config) {
      return panelInstance(config || {});
    }
  };
})();
