(function () {
  var DEFAULTS = {
    apiBaseUrl: '',
    mountSelector: '',
    title: 'ЦУП Дворотека',
    userId: '',
    roles: [],
    role: '',
    stationIds: [],
    connectorRoutes: [],
    pollIntervalMs: 8000,
    authHeaders: {},
    authToken: ''
  };

  var STYLE_ID = 'phab-admin-panel-style';
  var PADLHUB_FAVICON_URL = 'https://padlhub.ru/favicon.ico';
  var CONNECTOR_ROUTES = [
    'TG_BOT',
    'MAX_BOT',
    'MAX_ACADEMY_BOT',
    'LK_WEB_MESSENGER',
    'LK_ACADEMY_WEB_MESSENGER',
    'PROMO_WEB_MESSENGER'
  ];
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
    PROMO_WEB_MESSENGER: {
      label: 'Promo Web Messenger',
      description: 'Диалоги и сообщения с сайта/лендинга PROMO',
      fields: [
        'inboundEnabled: включить прием входящих из WEB',
        'widgetEnabled: разрешить web-виджет',
        'ingestPath: ожидаемый путь входящих событий',
        'sourceTag: тег источника в metadata',
        'syncFromMongoEnabled: подтягивать внешние записи из Mongo',
        'syncIntervalMs: частота синхронизации (мс)',
        'mapAuthorizedAsVerified: AUTHORIZED => VERIFIED',
        'resolveStationAliasByName: добавлять alias станции promo'
      ],
      template: {
        inboundEnabled: true,
        widgetEnabled: true,
        ingestPath: '/promo/support/dialogs/events',
        sourceTag: 'promo_support_widget',
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
    'PROMO_WEB_MESSENGER',
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
  var MOBILE_CHAT_BREAKPOINT_PX = 767;
  var COMMUNITY_FEED_PREVIEW_LIMIT = 10;
  var COMMUNITY_CHAT_PREVIEW_LIMIT = 20;
  var MAX_MESSAGE_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
  var MAX_MESSAGE_ATTACHMENT_SIZE_BYTES = 4 * 1024 * 1024;
  var MAX_MESSAGE_ATTACHMENTS_TOTAL_BYTES = 12 * 1024 * 1024;
  var DEFAULT_QUICK_REPLY_OPTIONS = [
    { label: 'Сертификат', text: 'Сертификат' },
    { label: 'Оплата', text: 'Оплата' },
    { label: 'Адрес', text: 'Адрес' },
    { label: 'Спасибо!', text: 'Спасибо!' }
  ];

  function normalizeRoleValue(rawRole) {
    var normalized = String(rawRole || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (!normalized) {
      return '';
    }
    if (ROLE_OPTIONS.indexOf(normalized) >= 0) {
      return normalized;
    }
    var aliasKey = normalized.replace(/_/g, '');
    var aliases = {
      ADMIN: 'STATION_ADMIN',
      ADMINISTRATOR: 'STATION_ADMIN',
      STATIONADMIN: 'STATION_ADMIN',
      STATIONADMINISTRATOR: 'STATION_ADMIN',
      ADMINSTATION: 'STATION_ADMIN',
      SUPERADMIN: 'SUPER_ADMIN',
      TOURNAMENTMANAGER: 'TOURNAMENT_MANAGER',
      GAMEMANAGER: 'GAME_MANAGER',
      OPERATIONSMANAGER: 'MANAGER'
    };
    return aliases[aliasKey] || aliases[normalized] || normalized;
  }

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
    cfg.roles = cfg.roles
      .map(function (role) {
        return normalizeRoleValue(role);
      })
      .filter(Boolean)
      .filter(function (role, index, list) {
        return list.indexOf(role) === index;
      });
    if (cfg.role && cfg.roles.indexOf(cfg.role) === -1) {
      var normalizedRole = normalizeRoleValue(cfg.role);
      if (normalizedRole && cfg.roles.indexOf(normalizedRole) === -1) {
        cfg.roles.unshift(normalizedRole);
      }
    }
    if (!Array.isArray(cfg.stationIds)) {
      cfg.stationIds = [];
    }
    if (!Array.isArray(cfg.connectorRoutes)) {
      cfg.connectorRoutes = [];
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
      .phab-admin-heading{
        display:flex;
        flex-direction:column;
        gap:4px;
        min-width:0;
        flex:1 1 auto;
      }
      .phab-admin-heading-top{
        display:flex;
        align-items:center;
        gap:10px;
        min-width:0;
      }
      .phab-admin-brand-logo{
        width:34px;
        height:34px;
        border-radius:10px;
        background:rgba(255,255,255,.98);
        padding:4px;
        box-shadow:0 8px 18px rgba(0,0,0,.16);
        flex:0 0 auto;
      }
      .phab-admin-title-wrap{
        display:flex;
        align-items:center;
        gap:10px;
        min-width:0;
        flex:1 1 auto;
      }
      .phab-admin-title{
        font-family:var(--cup-font-heading);
        font-size:18px;
        letter-spacing:.02em;
        font-weight:700;
        text-transform:uppercase;
      }
      .phab-admin-title-short{
        display:none;
      }
      .phab-admin-subtitle{
        margin-top:4px;
        font-size:12px;
        font-weight:500;
        letter-spacing:.04em;
        opacity:.9;
      }
      .phab-admin-mobile-tab-select{
        display:none;
        min-width:0;
        max-width:180px;
        flex:1 1 auto;
        border:1px solid rgba(255,255,255,.22);
        border-radius:12px;
        padding:7px 30px 7px 10px;
        font-size:11px;
        font-weight:800;
        letter-spacing:.03em;
        color:var(--cup-white);
        background:
          linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,.08)),
          rgba(255,255,255,.08);
        font-family:var(--cup-font-body);
        appearance:none;
        -webkit-appearance:none;
        background-image:
          linear-gradient(45deg,transparent 50%,rgba(255,255,255,.9) 50%),
          linear-gradient(135deg,rgba(255,255,255,.9) 50%,transparent 50%);
        background-position:
          calc(100% - 16px) calc(50% - 2px),
          calc(100% - 10px) calc(50% - 2px);
        background-size:6px 6px, 6px 6px;
        background-repeat:no-repeat;
      }
      .phab-admin-mobile-tab-select:focus{
        outline:none;
        border-color:rgba(255,255,255,.42);
        box-shadow:0 0 0 3px rgba(182,253,255,.28);
      }
      .phab-admin-mobile-tab-select option{
        color:var(--cup-wine);
        background:#fff;
      }
      .phab-admin-toolbar{
        display:flex;
        gap:8px;
        align-items:center;
        flex-wrap:wrap;
      }
      .phab-admin-toolbar-btn{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        gap:7px;
      }
      .phab-admin-btn-icon{
        width:16px;
        height:16px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        flex:0 0 auto;
      }
      .phab-admin-btn-icon svg{
        width:100%;
        height:100%;
        display:block;
        fill:none;
        stroke:currentColor;
        stroke-width:2;
        stroke-linecap:round;
        stroke-linejoin:round;
      }
      .phab-admin-btn-label{
        white-space:nowrap;
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
      .phab-admin-pane-head-actions{
        display:flex;
        align-items:center;
        gap:8px;
        flex:1 1 auto;
        justify-content:flex-end;
        min-width:0;
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
      .phab-admin-mobile-filter-btn{
        display:none;
        flex:0 0 auto;
        padding:8px 12px;
        font-size:11px;
        line-height:1;
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
      .phab-admin-chat-item{
        display:grid;
        grid-template-columns:42px minmax(0,1fr) auto;
        column-gap:10px;
        align-items:start;
      }
      .phab-admin-chat-item-lead{
        display:flex;
        align-items:flex-start;
        justify-content:center;
        padding-top:2px;
      }
      .phab-admin-chat-item-top{
        min-width:0;
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:8px;
      }
      .phab-admin-chat-item-main{
        min-width:0;
      }
      .phab-admin-chat-item-side{
        min-width:38px;
        display:flex;
        flex-direction:column;
        align-items:flex-end;
        justify-content:flex-start;
        gap:8px;
        padding-top:1px;
      }
      .phab-admin-chat-item-time{
        font-size:10px;
        font-weight:800;
        letter-spacing:.02em;
        color:rgba(51,0,32,.56);
        white-space:nowrap;
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
      .phab-admin-source-icon{
        position:relative;
        width:38px;
        height:38px;
        border-radius:16px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        flex:0 0 auto;
        color:#fff;
        border:1px solid rgba(51,0,32,.14);
        box-shadow:0 8px 16px rgba(51,0,32,.12);
        overflow:visible;
      }
      .phab-admin-source-icon--telegram{
        background:linear-gradient(135deg,#6bb8ff 0%,#2374f4 100%);
      }
      .phab-admin-source-icon--max{
        background:linear-gradient(135deg,#41c3f2 0%,#8c2af7 100%);
      }
      .phab-admin-source-icon--max .phab-admin-source-icon-svg{
        width:100%;
        height:100%;
      }
      .phab-admin-source-icon--web{
        background:linear-gradient(135deg,#47c986 0%,#17905d 100%);
      }
      .phab-admin-source-icon-svg{
        width:20px;
        height:20px;
        display:block;
        fill:currentColor;
      }
      .phab-admin-source-icon-label{
        font-size:10px;
        font-weight:900;
        letter-spacing:.05em;
        font-family:var(--cup-font-heading);
        text-transform:uppercase;
      }
      .phab-admin-source-badge{
        position:absolute;
        right:-3px;
        bottom:-3px;
        width:17px;
        height:17px;
        border-radius:999px;
        border:2px solid rgba(255,255,255,.96);
        overflow:hidden;
        box-shadow:0 3px 8px rgba(51,0,32,.16);
        background:rgba(255,255,255,.98);
      }
      .phab-admin-source-badge img{
        display:block;
        width:100%;
        height:100%;
        object-fit:cover;
      }
      .phab-admin-source-badge-fallback{
        width:100%;
        height:100%;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:9px;
        font-weight:900;
        color:var(--cup-wine);
        font-family:var(--cup-font-heading);
        text-transform:uppercase;
      }
      .phab-admin-dialog-source-row{
        grid-column:1;
        display:none;
        align-items:center;
        gap:8px;
      }
      .phab-admin-dialog-source-meta{
        display:flex;
        flex-direction:column;
        gap:2px;
        min-width:0;
      }
      .phab-admin-dialog-source-title{
        font-size:11px;
        font-weight:800;
        color:var(--cup-wine);
      }
      .phab-admin-dialog-source-subtitle{
        font-size:10px;
        color:rgba(51,0,32,.62);
      }
      .phab-admin-mobile-back{
        display:none;
        width:38px;
        height:38px;
        border-radius:14px;
        border:1px solid rgba(51,0,32,.12);
        background:rgba(255,255,255,.9);
        color:var(--cup-wine);
        font-size:20px;
        line-height:1;
        align-items:center;
        justify-content:center;
        cursor:pointer;
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
        display:inline-flex;
        align-items:center;
        gap:6px;
      }
      .phab-admin-status-error{
        background:rgba(255,70,78,.12);
        border-color:rgba(255,70,78,.45);
        color:#9f1735;
      }
      .phab-admin-status-icon{
        width:14px;
        height:14px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        flex:0 0 auto;
      }
      .phab-admin-status-icon svg{
        width:100%;
        height:100%;
        display:block;
        fill:none;
        stroke:currentColor;
        stroke-width:2.2;
        stroke-linecap:round;
        stroke-linejoin:round;
      }
      .phab-admin-status-label{
        white-space:nowrap;
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
      .phab-admin-communities-grid{
        display:grid;
        grid-template-columns:minmax(278px,320px) minmax(0,1.2fr) minmax(308px,.92fr);
        gap:12px;
        flex:1;
        min-height:0;
        height:100%;
        overflow:auto;
        scrollbar-gutter:stable;
      }
      .phab-admin-community-pane{
        background:rgba(255,255,255,.9);
        border:1px solid rgba(51,0,32,.15);
        border-radius:20px;
        overflow:hidden;
        box-shadow:0 14px 34px rgba(51,0,32,.08);
        display:flex;
        flex-direction:column;
        min-height:0;
        max-height:100%;
      }
      .phab-admin-community-pane-head{
        padding:14px 14px 12px;
        background:
          linear-gradient(135deg,rgba(97,7,136,.95) 0%,rgba(0,58,134,.88) 100%);
        color:var(--cup-white);
      }
      .phab-admin-community-pane-head-light{
        padding:14px;
        background:linear-gradient(180deg,rgba(255,255,255,.94),rgba(246,242,255,.86));
        border-bottom:1px solid rgba(51,0,32,.08);
      }
      .phab-admin-community-pane-title{
        font-family:var(--cup-font-heading);
        font-size:14px;
        font-weight:700;
        letter-spacing:.04em;
        text-transform:uppercase;
      }
      .phab-admin-community-pane-subtitle{
        margin-top:6px;
        font-size:11px;
        color:rgba(255,255,255,.84);
      }
      .phab-admin-community-pane-head-light .phab-admin-community-pane-subtitle{
        color:rgba(51,0,32,.66);
      }
      .phab-admin-community-search{
        margin-top:12px;
        width:100%;
        max-width:none;
        padding:10px 12px;
        border-radius:14px;
        border:1px solid rgba(255,255,255,.24);
        background:rgba(255,255,255,.94);
      }
      .phab-admin-community-toolbar{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:8px;
        padding:10px 10px 0;
        background:linear-gradient(180deg,rgba(246,241,255,.78),rgba(255,255,255,.68));
      }
      .phab-admin-community-toolbar-select{
        width:100%;
        border:1px solid rgba(51,0,32,.14);
        border-radius:12px;
        padding:8px 10px;
        font-size:11px;
        font-weight:700;
        color:var(--cup-wine);
        background:rgba(255,255,255,.94);
      }
      .phab-admin-community-toolbar-select:focus{
        outline:none;
        border-color:rgba(97,7,136,.44);
        box-shadow:0 0 0 3px rgba(221,200,252,.34);
      }
      .phab-admin-community-list-body{
        padding:10px;
        overflow:auto;
        flex:1;
        min-height:0;
        scrollbar-gutter:stable;
      }
      .phab-admin-community-card{
        display:flex;
        flex-direction:column;
        gap:8px;
        padding:10px;
        border-radius:18px;
        border:1px solid rgba(51,0,32,.1);
        background:rgba(255,255,255,.94);
        box-shadow:0 10px 24px rgba(51,0,32,.06);
      }
      .phab-admin-community-card-active{
        border-color:rgba(97,7,136,.34);
        background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(245,240,255,.95));
        box-shadow:0 14px 26px rgba(97,7,136,.12);
      }
      .phab-admin-community-card-btn{
        border:none;
        background:transparent;
        padding:0;
        cursor:pointer;
        text-align:left;
      }
      .phab-admin-community-card-head{
        display:grid;
        grid-template-columns:44px minmax(0,1fr) auto;
        gap:10px;
        align-items:center;
      }
      .phab-admin-community-avatar{
        width:44px;
        height:44px;
        position:relative;
        overflow:visible;
        display:flex;
        align-items:center;
        justify-content:center;
      }
      .phab-admin-community-avatar-media{
        width:100%;
        height:100%;
        border-radius:16px;
        border:1px solid rgba(51,0,32,.1);
        background:linear-gradient(135deg,rgba(221,200,252,.9),rgba(182,253,255,.88));
        overflow:hidden;
        display:flex;
        align-items:center;
        justify-content:center;
        font-family:var(--cup-font-heading);
        font-size:13px;
        color:var(--cup-wine);
      }
      .phab-admin-community-avatar-media img{
        width:100%;
        height:100%;
        object-fit:cover;
        display:block;
      }
      .phab-admin-community-avatar-verified{
        position:absolute;
        right:-4px;
        bottom:-4px;
        width:20px;
        height:20px;
        border-radius:999px;
        background:linear-gradient(135deg,#2e8cff,#0c61ff);
        color:#fff;
        display:flex;
        align-items:center;
        justify-content:center;
        box-shadow:0 8px 18px rgba(12,97,255,.32);
        border:2px solid rgba(255,255,255,.98);
      }
      .phab-admin-community-avatar-verified svg{
        width:10px;
        height:10px;
        display:block;
        fill:none;
        stroke:currentColor;
        stroke-width:3;
        stroke-linecap:round;
        stroke-linejoin:round;
      }
      .phab-admin-community-card-title{
        font-size:18px;
        font-weight:800;
        line-height:1.08;
        color:var(--cup-wine);
      }
      .phab-admin-community-card-meta{
        margin-top:4px;
        font-size:11px;
        color:rgba(51,0,32,.62);
      }
      .phab-admin-community-status-badge{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        padding:6px 10px;
        border-radius:999px;
        font-size:10px;
        font-weight:900;
        letter-spacing:.05em;
        text-transform:uppercase;
        border:1px solid rgba(51,0,32,.1);
        white-space:nowrap;
      }
      .phab-admin-community-status-good{
        background:rgba(1,67,58,.1);
        color:#04604a;
      }
      .phab-admin-community-status-warn{
        background:rgba(255,232,145,.56);
        color:#8e5900;
      }
      .phab-admin-community-status-danger{
        background:rgba(255,70,78,.12);
        color:#be1d2a;
      }
      .phab-admin-community-status-muted{
        background:rgba(51,0,32,.08);
        color:rgba(51,0,32,.72);
      }
      .phab-admin-community-activity-row,
      .phab-admin-community-signal-row,
      .phab-admin-community-risk-row,
      .phab-admin-community-card-actions{
        display:flex;
        flex-wrap:wrap;
        gap:6px;
      }
      .phab-admin-community-mini-chip,
      .phab-admin-community-signal,
      .phab-admin-community-risk{
        display:inline-flex;
        align-items:center;
        gap:5px;
        padding:5px 9px;
        border-radius:999px;
        font-size:10px;
        font-weight:800;
        border:1px solid rgba(51,0,32,.09);
        background:rgba(247,243,255,.9);
        color:rgba(51,0,32,.78);
      }
      .phab-admin-community-signal-strong{
        background:rgba(255,70,78,.12);
        color:#be1d2a;
      }
      .phab-admin-community-mini-chip-verified{
        background:linear-gradient(135deg,rgba(46,140,255,.16),rgba(12,97,255,.2));
        color:#0b56db;
        border-color:rgba(12,97,255,.18);
      }
      .phab-admin-community-risk{
        background:rgba(255,232,145,.46);
        color:#915f00;
      }
      .phab-admin-community-risk-danger{
        background:rgba(255,70,78,.12);
        color:#be1d2a;
      }
      .phab-admin-community-card-action{
        border:none;
        cursor:pointer;
        border-radius:12px;
        padding:7px 10px;
        font-size:11px;
        font-weight:800;
        color:var(--cup-wine);
        background:rgba(246,241,255,.96);
      }
      .phab-admin-community-card-action:hover{
        background:rgba(221,200,252,.56);
      }
      .phab-admin-community-card-action-danger{
        background:rgba(255,70,78,.12);
        color:#be1d2a;
      }
      .phab-admin-community-main{
        display:flex;
        flex-direction:column;
        min-height:0;
      }
      .phab-admin-community-main-head{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:14px;
        padding:14px;
        border-bottom:1px solid rgba(51,0,32,.08);
        background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(245,240,255,.88));
      }
      .phab-admin-community-main-lead{
        display:grid;
        grid-template-columns:62px minmax(0,1fr);
        gap:12px;
        align-items:flex-start;
        min-width:0;
      }
      .phab-admin-community-main-avatar{
        width:62px;
        height:62px;
        border-radius:20px;
      }
      .phab-admin-community-main-avatar .phab-admin-community-avatar-media{
        border-radius:20px;
      }
      .phab-admin-community-main-avatar .phab-admin-community-avatar-verified{
        width:24px;
        height:24px;
        right:-5px;
        bottom:-5px;
      }
      .phab-admin-community-main-avatar .phab-admin-community-avatar-verified svg{
        width:12px;
        height:12px;
      }
      .phab-admin-community-main-title{
        font-size:22px;
        line-height:1.04;
      }
      .phab-admin-community-main-meta{
        margin-top:6px;
        font-size:12px;
        color:rgba(51,0,32,.68);
      }
      .phab-admin-community-main-actions{
        display:flex;
        flex-wrap:wrap;
        justify-content:flex-end;
        gap:8px;
        max-width:280px;
      }
      .phab-admin-community-main-action{
        border:none;
        cursor:pointer;
        padding:9px 12px;
        border-radius:14px;
        font-size:11px;
        font-weight:800;
        background:rgba(246,241,255,.98);
        color:var(--cup-wine);
      }
      .phab-admin-community-main-action:hover{
        transform:translateY(-1px);
      }
      .phab-admin-community-main-action-danger{
        background:linear-gradient(90deg,rgba(255,70,78,.14),rgba(255,113,88,.16));
        color:#be1d2a;
      }
      .phab-admin-community-main-action-warn{
        background:rgba(255,232,145,.62);
        color:#855500;
      }
      .phab-admin-community-main-action-accent{
        background:linear-gradient(135deg,rgba(46,140,255,.16),rgba(12,97,255,.22));
        color:#0b56db;
      }
      .phab-admin-community-main-tags{
        display:flex;
        flex-wrap:nowrap;
        gap:4px;
        margin-top:8px;
        max-width:100%;
        min-width:0;
        overflow-x:auto;
        overflow-y:hidden;
        scrollbar-width:none;
        -webkit-overflow-scrolling:touch;
      }
      .phab-admin-community-main-tags::-webkit-scrollbar{
        display:none;
      }
      .phab-admin-community-main-tags > *{
        flex:0 0 auto;
        white-space:nowrap;
      }
      .phab-admin-community-summary{
        display:grid;
        grid-template-columns:repeat(8,minmax(0,1fr));
        gap:6px;
        padding:8px 12px;
        border-bottom:1px solid rgba(51,0,32,.08);
        background:rgba(255,255,255,.76);
      }
      .phab-admin-community-stat{
        min-width:0;
        padding:5px 7px;
        border-radius:10px;
        border:1px solid rgba(51,0,32,.1);
        background:rgba(255,255,255,.96);
        box-shadow:0 4px 10px rgba(51,0,32,.04);
      }
      .phab-admin-community-stat-label{
        display:block;
        font-size:8px;
        font-weight:800;
        line-height:1;
        letter-spacing:.06em;
        text-transform:uppercase;
        color:rgba(51,0,32,.58);
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }
      .phab-admin-community-stat-value{
        display:block;
        margin-top:3px;
        font-size:14px;
        line-height:1;
        font-weight:800;
        color:var(--cup-wine);
      }
      .phab-admin-community-tabs{
        display:flex;
        flex-wrap:wrap;
        gap:8px;
        padding:12px 14px 10px;
        border-bottom:1px solid rgba(51,0,32,.08);
        background:rgba(255,255,255,.82);
      }
      .phab-admin-community-tab{
        border:none;
        border-radius:999px;
        padding:8px 12px;
        cursor:pointer;
        background:rgba(246,241,255,.96);
        color:rgba(51,0,32,.82);
        font-size:12px;
        font-weight:800;
      }
      .phab-admin-community-tab-active{
        background:linear-gradient(90deg,rgba(97,7,136,.96),rgba(0,58,134,.92));
        color:var(--cup-white);
      }
      .phab-admin-community-main-body,
      .phab-admin-community-preview-body{
        padding:14px;
        overflow:auto;
        flex:1;
        min-height:0;
        scrollbar-gutter:stable;
      }
      .phab-admin-community-stack{
        display:flex;
        flex-direction:column;
        gap:12px;
      }
      .phab-admin-community-section-card{
        border:1px solid rgba(51,0,32,.1);
        border-radius:18px;
        background:rgba(255,255,255,.96);
        padding:14px;
        box-shadow:0 8px 18px rgba(51,0,32,.05);
      }
      .phab-admin-community-section-card-fill{
        display:flex;
        flex-direction:column;
        min-height:calc(100dvh - 390px);
      }
      .phab-admin-community-section-head{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:10px;
        margin-bottom:12px;
      }
      .phab-admin-community-section-body-fill{
        display:flex;
        flex-direction:column;
        flex:1;
        min-height:0;
      }
      .phab-admin-community-section-title{
        font-size:12px;
        font-weight:900;
        letter-spacing:.05em;
        text-transform:uppercase;
        color:rgba(51,0,32,.7);
      }
      .phab-admin-community-section-subtitle{
        margin-top:4px;
        font-size:11px;
        color:rgba(51,0,32,.58);
      }
      .phab-admin-community-section-subtitle:first-child{
        margin-top:0;
      }
      .phab-admin-community-overview-grid{
        display:grid;
        grid-template-columns:repeat(6,minmax(0,1fr));
        gap:6px;
      }
      .phab-admin-community-overview-card{
        padding:7px 8px;
        border-radius:12px;
        background:linear-gradient(180deg,rgba(247,243,255,.98),rgba(255,255,255,.96));
        border:1px solid rgba(51,0,32,.08);
      }
      .phab-admin-community-overview-card strong{
        display:block;
        font-size:16px;
        line-height:1;
        color:var(--cup-wine);
      }
      .phab-admin-community-overview-card span{
        display:block;
        margin-top:4px;
        font-size:10px;
        line-height:1.2;
        color:rgba(51,0,32,.64);
      }
      .phab-admin-community-form-grid{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:12px;
      }
      .phab-admin-community-form-field{
        display:flex;
        flex-direction:column;
        gap:6px;
      }
      .phab-admin-community-form-field-wide{
        grid-column:1 / -1;
      }
      .phab-admin-community-form-actions{
        display:flex;
        flex-wrap:wrap;
        justify-content:flex-end;
        gap:8px;
        margin-top:4px;
      }
      .phab-admin-community-list-empty{
        padding:12px;
      }
      .phab-admin-community-member-actions{
        display:flex;
        flex-wrap:wrap;
        gap:8px;
      }
      .phab-admin-settings-list.phab-admin-community-members-list{
        flex:1;
        min-height:0;
        max-height:none;
      }
      .phab-admin-community-segments{
        display:flex;
        flex-wrap:wrap;
        gap:8px;
        margin-bottom:12px;
      }
      .phab-admin-community-segment{
        border:none;
        cursor:pointer;
        border-radius:999px;
        padding:7px 11px;
        font-size:11px;
        font-weight:800;
        background:rgba(246,241,255,.96);
        color:var(--cup-wine);
      }
      .phab-admin-community-segment-active{
        background:rgba(97,7,136,.96);
        color:var(--cup-white);
      }
      .phab-admin-community-preview-shell{
        background:
          linear-gradient(180deg,rgba(255,255,255,.98),rgba(244,240,255,.92));
      }
      .phab-admin-community-preview-frame{
        border:1px solid rgba(97,7,136,.12);
        border-radius:26px;
        padding:14px;
        background:
          linear-gradient(180deg,rgba(255,255,255,.98),rgba(247,244,255,.94));
        box-shadow:inset 0 1px 0 rgba(255,255,255,.8);
      }
      .phab-admin-community-lk-head{
        display:grid;
        grid-template-columns:60px minmax(0,1fr);
        gap:12px;
        align-items:center;
        padding:4px 2px 14px;
      }
      .phab-admin-community-lk-head .phab-admin-community-avatar{
        width:60px;
        height:60px;
      }
      .phab-admin-community-lk-head .phab-admin-community-avatar-media{
        border-radius:20px;
      }
      .phab-admin-community-lk-head .phab-admin-community-avatar-verified{
        width:22px;
        height:22px;
        right:-4px;
        bottom:-4px;
      }
      .phab-admin-community-lk-head-main{
        min-width:0;
      }
      .phab-admin-community-lk-name{
        font-size:18px;
        font-weight:900;
        line-height:1.05;
        color:var(--cup-ink);
      }
      .phab-admin-community-lk-subtitle{
        margin-top:6px;
        font-size:12px;
        color:rgba(51,0,32,.62);
      }
      .phab-admin-community-lk-segments{
        display:flex;
        flex-wrap:wrap;
        gap:6px;
        margin:-2px 0 14px;
      }
      .phab-admin-community-lk-segment{
        display:inline-flex;
        align-items:center;
        gap:0;
        min-width:40px;
        min-height:40px;
        border:none;
        cursor:pointer;
        border-radius:999px;
        padding:8px;
        background:rgba(246,241,255,.96);
        color:rgba(51,0,32,.76);
        font-size:12px;
        font-weight:900;
        line-height:1;
        transition:
          background .2s ease,
          color .2s ease,
          box-shadow .2s ease,
          padding .2s ease,
          gap .2s ease;
      }
      .phab-admin-community-lk-segment-active{
        gap:8px;
        padding:8px 14px;
        background:linear-gradient(90deg,rgba(37,31,44,.96),rgba(30,28,38,.92));
        color:#fff;
        box-shadow:0 10px 20px rgba(51,0,32,.12);
      }
      .phab-admin-community-lk-segment-icon{
        width:18px;
        height:18px;
        flex:0 0 18px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
      }
      .phab-admin-community-lk-segment-icon svg{
        width:18px;
        height:18px;
        display:block;
        fill:none;
        stroke:currentColor;
        stroke-width:2;
        stroke-linecap:round;
        stroke-linejoin:round;
      }
      .phab-admin-community-lk-segment-label{
        display:none;
        white-space:nowrap;
      }
      .phab-admin-community-lk-segment-active .phab-admin-community-lk-segment-label{
        display:inline;
      }
      .phab-admin-community-preview-tabs{
        display:flex;
        flex-wrap:wrap;
        gap:8px;
        margin-bottom:12px;
      }
      .phab-admin-community-preview-card{
        border:1px solid rgba(51,0,32,.08);
        border-radius:20px;
        padding:14px;
        background:rgba(255,255,255,.98);
        box-shadow:0 8px 18px rgba(51,0,32,.05);
      }
      .phab-admin-community-feed-card{
        overflow:hidden;
      }
      .phab-admin-community-feed-card--game{
        border-color:rgba(93,78,255,.18);
        box-shadow:0 10px 24px rgba(93,78,255,.08);
      }
      .phab-admin-community-feed-card--tournament{
        border-color:rgba(255,162,0,.2);
        box-shadow:0 10px 24px rgba(255,162,0,.08);
      }
      .phab-admin-community-feed-card--event{
        border-color:rgba(255,138,0,.22);
        box-shadow:0 10px 24px rgba(255,138,0,.08);
      }
      .phab-admin-community-feed-card--ad{
        border-color:rgba(255,132,44,.24);
        background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(255,248,241,.96));
        box-shadow:0 12px 26px rgba(255,132,44,.1);
      }
      .phab-admin-community-feed-card--news{
        border-color:rgba(97,7,136,.15);
      }
      .phab-admin-community-feed-card--system{
        border-color:rgba(51,0,32,.12);
        background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(250,248,255,.95));
      }
      .phab-admin-community-feed-card-promoted{
        box-shadow:0 16px 30px rgba(255,120,34,.16);
      }
      .phab-admin-community-feed-card-muted{
        opacity:.72;
      }
      .phab-admin-community-lk-card-top{
        display:flex;
        gap:12px;
        align-items:flex-start;
      }
      .phab-admin-community-lk-card-content{
        min-width:0;
        flex:1;
      }
      .phab-admin-community-lk-date-badge{
        flex:0 0 54px;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        gap:2px;
        padding:8px 6px;
        border-radius:14px;
        background:linear-gradient(180deg,#2b223a 0%,#6f4df6 60%,#ece7ff 60%,#f4efff 100%);
        color:#fff;
        text-align:center;
        box-shadow:0 8px 18px rgba(93,78,255,.18);
      }
      .phab-admin-community-lk-date-badge span{
        font-size:9px;
        font-weight:900;
        letter-spacing:.06em;
      }
      .phab-admin-community-lk-date-badge strong{
        font-size:24px;
        line-height:1;
      }
      .phab-admin-community-lk-date-badge em{
        font-style:normal;
        font-size:9px;
        color:rgba(43,34,58,.74);
      }
      .phab-admin-community-lk-side-action{
        flex:0 0 auto;
        width:40px;
        height:40px;
        border:none;
        border-radius:14px;
        background:rgba(243,236,255,.98);
        color:#7b52f1;
        font-size:18px;
        cursor:pointer;
      }
      .phab-admin-community-lk-side-action svg{
        width:16px;
        height:16px;
        stroke:currentColor;
        fill:none;
        stroke-width:1.8;
        stroke-linecap:round;
        stroke-linejoin:round;
      }
      .phab-admin-community-feed-media{
        margin-top:12px;
        border-radius:18px;
        overflow:hidden;
        background:linear-gradient(135deg,rgba(238,232,255,.96),rgba(251,247,255,.96));
        border:1px solid rgba(97,7,136,.1);
        min-height:152px;
        display:flex;
        align-items:center;
        justify-content:center;
      }
      .phab-admin-community-feed-media img{
        display:block;
        width:100%;
        height:100%;
        max-height:220px;
        object-fit:cover;
      }
      .phab-admin-community-feed-media-placeholder{
        padding:18px;
        text-align:center;
        font-size:12px;
        font-weight:800;
        letter-spacing:.04em;
        text-transform:uppercase;
        color:rgba(97,7,136,.74);
      }
      .phab-admin-community-feed-meta{
        display:flex;
        flex-wrap:wrap;
        gap:8px;
        margin-top:10px;
      }
      .phab-admin-community-feed-chip{
        display:inline-flex;
        align-items:center;
        gap:6px;
        padding:6px 10px;
        border-radius:999px;
        background:rgba(246,241,255,.96);
        border:1px solid rgba(97,7,136,.1);
        font-size:11px;
        font-weight:700;
        color:rgba(51,0,32,.76);
      }
      .phab-admin-community-feed-chip-strong{
        background:rgba(255,70,78,.1);
        border-color:rgba(255,70,78,.24);
        color:#b31931;
      }
      .phab-admin-community-feed-chip-accent{
        background:rgba(255,128,36,.12);
        border-color:rgba(255,128,36,.24);
        color:#db6f12;
      }
      .phab-admin-community-lk-game-meta{
        margin-top:12px;
        font-size:13px;
        color:rgba(51,0,32,.72);
      }
      .phab-admin-community-lk-game-footer{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        margin-top:14px;
      }
      .phab-admin-community-lk-participants{
        display:flex;
        align-items:center;
        min-width:0;
      }
      .phab-admin-community-lk-participant{
        width:34px;
        height:34px;
        margin-right:-8px;
        border-radius:999px;
        border:2px solid rgba(255,255,255,.98);
        background:linear-gradient(135deg,rgba(223,227,236,.98),rgba(239,232,255,.92));
        color:rgba(51,0,32,.7);
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:12px;
        font-weight:800;
        overflow:hidden;
        box-shadow:0 6px 14px rgba(51,0,32,.08);
      }
      .phab-admin-community-lk-participant img{
        width:100%;
        height:100%;
        object-fit:cover;
        display:block;
      }
      .phab-admin-community-lk-primary-cta{
        border:none;
        cursor:pointer;
        border-radius:16px;
        padding:13px 18px;
        background:linear-gradient(90deg,#ff9b32 0%,#ff6b1b 100%);
        color:#fff;
        font-size:13px;
        font-weight:900;
        box-shadow:0 12px 22px rgba(255,107,27,.22);
      }
      .phab-admin-community-lk-news-body{
        display:grid;
        grid-template-columns:minmax(0,1fr) auto;
        gap:12px;
        margin-top:12px;
        align-items:start;
      }
      .phab-admin-community-lk-ad-body{
        display:flex;
        flex-direction:column;
        gap:12px;
        margin-top:12px;
      }
      .phab-admin-community-lk-ad-hero{
        border-radius:18px;
        overflow:hidden;
        background:linear-gradient(135deg,rgba(255,243,232,.98),rgba(255,255,255,.94));
        min-height:170px;
        border:1px solid rgba(255,132,44,.18);
      }
      .phab-admin-community-lk-ad-hero img{
        display:block;
        width:100%;
        height:100%;
        min-height:170px;
        object-fit:cover;
      }
      .phab-admin-community-lk-ad-footer{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        margin-top:14px;
      }
      .phab-admin-community-lk-inline-image{
        width:108px;
        border-radius:16px;
        overflow:hidden;
        background:rgba(244,239,255,.94);
      }
      .phab-admin-community-lk-inline-image img{
        display:block;
        width:100%;
        height:108px;
        object-fit:cover;
      }
      .phab-admin-community-lk-engagement{
        margin-top:14px;
        font-size:12px;
        color:rgba(51,0,32,.58);
      }
      .phab-admin-community-preview-post-top,
      .phab-admin-community-preview-message-top,
      .phab-admin-community-history-row,
      .phab-admin-community-rating-row{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:10px;
      }
      .phab-admin-community-preview-kicker{
        font-size:10px;
        font-weight:900;
        letter-spacing:.06em;
        text-transform:uppercase;
        color:rgba(97,7,136,.86);
      }
      .phab-admin-community-preview-title{
        margin-top:6px;
        font-size:22px;
        line-height:1.04;
        font-weight:800;
        color:var(--cup-wine);
      }
      .phab-admin-community-preview-text{
        margin-top:10px;
        font-size:13px;
        line-height:1.5;
        color:rgba(51,0,32,.74);
      }
      .phab-admin-community-preview-actions{
        display:flex;
        flex-wrap:wrap;
        gap:8px;
        margin-top:12px;
      }
      .phab-admin-community-preview-action{
        border:none;
        cursor:pointer;
        border-radius:14px;
        padding:9px 12px;
        font-size:11px;
        font-weight:800;
        background:rgba(246,241,255,.96);
        color:var(--cup-wine);
      }
      .phab-admin-community-preview-action-danger{
        background:rgba(255,70,78,.12);
        color:#be1d2a;
      }
      .phab-admin-community-preview-action-accent{
        background:rgba(255,128,36,.12);
        color:#db6f12;
      }
      .phab-admin-community-preview-actions-moderation{
        padding-top:12px;
        border-top:1px solid rgba(51,0,32,.08);
      }
      .phab-admin-community-rating-list,
      .phab-admin-community-history-list{
        display:flex;
        flex-direction:column;
        gap:10px;
      }
      .phab-admin-community-rating-row strong{
        font-size:15px;
        color:var(--cup-wine);
      }
      .phab-admin-community-rating-row span,
      .phab-admin-community-history-row span{
        display:block;
        margin-top:4px;
        font-size:11px;
        color:rgba(51,0,32,.6);
      }
      .phab-admin-community-about-grid{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:10px;
      }
      .phab-admin-community-about-item{
        padding:12px;
        border-radius:16px;
        background:rgba(247,243,255,.94);
        border:1px solid rgba(51,0,32,.08);
      }
      .phab-admin-community-about-item label{
        display:block;
        font-size:10px;
        font-weight:900;
        letter-spacing:.06em;
        text-transform:uppercase;
        color:rgba(51,0,32,.54);
      }
      .phab-admin-community-about-item strong{
        display:block;
        margin-top:7px;
        font-size:14px;
        color:var(--cup-wine);
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
        position:relative;
      }
      .phab-admin-message-text{
        display:block;
      }
      .phab-admin-message-attachments{
        display:grid;
        gap:8px;
        margin-bottom:8px;
      }
      .phab-admin-message-image-link{
        display:block;
        border-radius:12px;
        overflow:hidden;
        text-decoration:none;
      }
      .phab-admin-message-image{
        display:block;
        width:min(280px,100%);
        max-height:320px;
        object-fit:cover;
        border-radius:12px;
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
      .phab-admin-message-bubble-system .phab-admin-message-meta{
        text-align:center;
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
        flex-direction:column;
        gap:10px;
        padding:10px;
        border-top:1px solid rgba(51,0,32,.12);
        background:linear-gradient(90deg,rgba(255,232,145,.55) 0%,rgba(255,255,255,.88) 100%);
      }
      .phab-admin-compose-row{
        display:flex;
        gap:8px;
        align-items:center;
      }
      .phab-admin-compose-attachments{
        display:flex;
        flex-wrap:wrap;
        gap:8px;
      }
      .phab-admin-attachment-chip{
        display:inline-flex;
        align-items:center;
        gap:8px;
        padding:6px 8px;
        border-radius:999px;
        border:1px solid rgba(51,0,32,.14);
        background:rgba(255,255,255,.9);
        color:var(--cup-wine);
        font-size:11px;
        font-weight:700;
      }
      .phab-admin-attachment-chip button{
        border:none;
        background:transparent;
        color:inherit;
        font:inherit;
        cursor:pointer;
        padding:0 2px;
      }
      .phab-admin-file-input-hidden{
        display:none;
      }
      .phab-admin-quick-replies{
        display:none;
        align-items:center;
        gap:8px;
        overflow:auto hidden;
        padding-bottom:2px;
        scrollbar-width:none;
      }
      .phab-admin-quick-replies::-webkit-scrollbar{
        display:none;
      }
      .phab-admin-quick-reply{
        border:1px solid rgba(51,0,32,.14);
        background:rgba(255,255,255,.9);
        color:var(--cup-wine);
        border-radius:999px;
        padding:8px 13px;
        font-size:11px;
        font-weight:700;
        cursor:pointer;
        white-space:nowrap;
        box-shadow:0 6px 14px rgba(51,0,32,.08);
      }
      .phab-admin-quick-reply:hover{
        border-color:rgba(51,0,32,.26);
        transform:translateY(-1px);
      }
      .phab-admin-bottom-sheet{
        position:fixed;
        inset:0;
        z-index:2147483005;
        display:flex;
        align-items:flex-end;
        justify-content:center;
      }
      .phab-admin-bottom-sheet-backdrop{
        position:absolute;
        inset:0;
        border:0;
        padding:0;
        background:rgba(18,8,26,.34);
        cursor:pointer;
      }
      .phab-admin-bottom-sheet-panel{
        position:relative;
        width:min(100%,560px);
        max-height:min(78dvh,640px);
        border-radius:24px 24px 0 0;
        background:linear-gradient(180deg,rgba(255,255,255,.98) 0%,rgba(245,249,255,.98) 100%);
        box-shadow:0 -18px 42px rgba(51,0,32,.24);
        padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px));
        display:flex;
        flex-direction:column;
        gap:12px;
        overflow:hidden;
      }
      .phab-admin-bottom-sheet-handle{
        width:46px;
        height:5px;
        border-radius:999px;
        margin:0 auto;
        background:rgba(51,0,32,.18);
      }
      .phab-admin-bottom-sheet-head{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
      }
      .phab-admin-bottom-sheet-title{
        font-size:15px;
        font-family:var(--cup-font-heading);
        color:var(--cup-wine);
        letter-spacing:.04em;
        text-transform:uppercase;
      }
      .phab-admin-bottom-sheet-subtitle{
        font-size:11px;
        color:rgba(51,0,32,.66);
      }
      .phab-admin-bottom-sheet-body{
        display:flex;
        flex-direction:column;
        gap:12px;
        overflow:auto;
        min-height:0;
      }
      .phab-admin-bottom-sheet-section{
        display:flex;
        flex-direction:column;
        gap:8px;
      }
      .phab-admin-bottom-sheet-section-title{
        font-size:11px;
        font-weight:800;
        letter-spacing:.04em;
        text-transform:uppercase;
        color:rgba(51,0,32,.72);
      }
      .phab-admin-bottom-sheet-actions{
        display:flex;
        gap:10px;
      }
      .phab-admin-bottom-sheet-actions .phab-admin-btn,
      .phab-admin-bottom-sheet-actions .phab-admin-btn-secondary{
        flex:1 1 0;
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
      .phab-admin-analytics-subtabs{
        display:flex;
        align-items:center;
        gap:8px;
        margin-bottom:10px;
        flex-wrap:wrap;
      }
      .phab-admin-analytics-pane{
        display:block;
      }
      .phab-admin-analytics-export-format{
        min-width:120px;
        width:auto;
      }
      .phab-admin-analytics-export-summary{
        margin-top:8px;
        padding:10px 12px;
        border:1px solid rgba(51,0,32,.14);
        border-radius:12px;
        background:rgba(255,255,255,.84);
        font-size:12px;
        color:var(--cup-wine);
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
        .phab-admin-communities-grid{
          grid-template-columns:1fr;
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
        .phab-admin-community-toolbar{grid-template-columns:repeat(2,minmax(0,1fr))}
        .phab-admin-community-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
        .phab-admin-community-overview-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
        .phab-admin-community-form-grid{grid-template-columns:1fr}
        .phab-admin-community-main-head{
          flex-direction:column;
        }
        .phab-admin-community-main-actions{
          justify-content:flex-start;
          max-width:none;
        }
        .phab-admin-community-section-card-fill{
          min-height:calc(100dvh - 300px);
        }
        .phab-admin-community-lk-news-body{
          grid-template-columns:1fr;
        }
        .phab-admin-community-lk-inline-image{
          width:100%;
        }
        .phab-admin-community-lk-inline-image img{
          height:180px;
        }
        .phab-admin-community-lk-game-footer{
          flex-direction:column;
          align-items:flex-start;
        }
        .phab-admin-community-lk-ad-footer{
          flex-direction:column;
          align-items:flex-start;
        }
        .phab-admin-settings-grid{grid-template-columns:1fr}
        .phab-admin-modal-body{grid-template-columns:1fr}
        .phab-admin-detail-span-2{grid-column:auto}
        .phab-admin-header{padding:14px}
      }
      @media (max-width:1440px), (max-height:900px){
        .phab-admin-header{
          padding:12px 14px 11px;
        }
        .phab-admin-brand-logo{
          width:30px;
          height:30px;
          border-radius:9px;
        }
        .phab-admin-title{
          font-size:16px;
        }
        .phab-admin-subtitle{
          margin-top:2px;
          font-size:11px;
        }
        .phab-admin-btn,
        .phab-admin-btn-secondary{
          padding:7px 11px;
          border-radius:11px;
          font-size:11px;
        }
        .phab-admin-tabs{
          gap:6px;
          padding:8px 10px 9px;
        }
        .phab-admin-tab{
          padding:7px 11px;
          font-size:10px;
        }
        .phab-admin-content{
          padding:8px;
        }
        .phab-admin-communities-grid{
          grid-template-columns:minmax(262px,300px) minmax(0,1.15fr) minmax(292px,.9fr);
          gap:8px;
        }
        .phab-admin-community-pane{
          border-radius:16px;
        }
        .phab-admin-community-pane-head{
          padding:12px 12px 10px;
        }
        .phab-admin-community-pane-head-light{
          padding:12px;
        }
        .phab-admin-community-pane-title{
          font-size:12px;
        }
        .phab-admin-community-pane-subtitle{
          margin-top:4px;
          font-size:10px;
        }
        .phab-admin-community-search{
          margin-top:10px;
          padding:8px 10px;
          border-radius:12px;
        }
        .phab-admin-community-toolbar{
          gap:6px;
          padding:8px 8px 0;
        }
        .phab-admin-community-toolbar-select{
          padding:7px 9px;
          border-radius:10px;
          font-size:10px;
        }
        .phab-admin-community-list-body{
          padding:8px;
        }
        .phab-admin-community-card{
          gap:6px;
          padding:8px;
          border-radius:14px;
        }
        .phab-admin-community-card-head{
          grid-template-columns:40px minmax(0,1fr) auto;
          gap:8px;
        }
        .phab-admin-community-avatar{
          width:40px;
          height:40px;
        }
        .phab-admin-community-avatar-media{
          border-radius:14px;
          font-size:12px;
        }
        .phab-admin-community-avatar-verified{
          width:18px;
          height:18px;
          right:-3px;
          bottom:-3px;
        }
        .phab-admin-community-card-title{
          font-size:16px;
        }
        .phab-admin-community-status-badge{
          padding:5px 9px;
          font-size:9px;
        }
        .phab-admin-community-mini-chip,
        .phab-admin-community-signal,
        .phab-admin-community-risk{
          padding:4px 8px;
          font-size:9px;
        }
        .phab-admin-community-card-action,
        .phab-admin-community-main-action,
        .phab-admin-community-preview-action{
          padding:7px 10px;
          border-radius:12px;
          font-size:10px;
        }
        .phab-admin-community-main-head{
          gap:10px;
          padding:10px 12px;
        }
        .phab-admin-community-main-lead{
          grid-template-columns:52px minmax(0,1fr);
          gap:10px;
        }
        .phab-admin-community-main-avatar{
          width:52px;
          height:52px;
        }
        .phab-admin-community-main-avatar .phab-admin-community-avatar-media{
          border-radius:16px;
        }
        .phab-admin-community-main-title{
          font-size:18px;
        }
        .phab-admin-community-main-meta{
          margin-top:4px;
          font-size:11px;
        }
        .phab-admin-community-main-actions{
          gap:6px;
          max-width:260px;
        }
        .phab-admin-community-main-tags{
          gap:4px;
          margin-top:6px;
        }
        .phab-admin-community-summary{
          grid-template-columns:repeat(8,minmax(0,1fr));
          gap:6px;
          padding:8px 10px;
        }
        .phab-admin-community-stat{
          padding:5px 6px;
          border-radius:10px;
        }
        .phab-admin-community-stat-value{
          margin-top:2px;
          font-size:13px;
        }
        .phab-admin-community-tabs{
          gap:6px;
          padding:10px 12px 8px;
        }
        .phab-admin-community-tab,
        .phab-admin-community-segment,
        .phab-admin-community-lk-segment{
          padding:7px 11px;
          font-size:11px;
        }
        .phab-admin-community-main-body,
        .phab-admin-community-preview-body{
          padding:10px;
        }
        .phab-admin-community-stack{
          gap:10px;
        }
        .phab-admin-community-section-card,
        .phab-admin-community-preview-card{
          padding:12px;
          border-radius:16px;
        }
        .phab-admin-community-section-card-fill{
          min-height:calc(100dvh - 330px);
        }
        .phab-admin-community-preview-frame{
          padding:10px;
          border-radius:20px;
        }
        .phab-admin-community-lk-head{
          grid-template-columns:52px minmax(0,1fr);
          gap:10px;
          padding:2px 2px 12px;
        }
        .phab-admin-community-lk-head .phab-admin-community-avatar{
          width:52px;
          height:52px;
        }
        .phab-admin-community-lk-name{
          font-size:16px;
        }
        .phab-admin-community-lk-subtitle{
          margin-top:4px;
          font-size:11px;
        }
        .phab-admin-community-lk-segments,
        .phab-admin-community-preview-tabs{
          gap:6px;
          margin-bottom:10px;
        }
        .phab-admin-community-lk-segment{
          min-width:36px;
          min-height:36px;
          padding:7px;
        }
        .phab-admin-community-lk-segment-active{
          padding:7px 11px;
        }
        .phab-admin-community-lk-segment-icon,
        .phab-admin-community-lk-segment-icon svg{
          width:16px;
          height:16px;
          flex-basis:16px;
        }
        .phab-admin-community-lk-date-badge{
          flex-basis:48px;
          padding:7px 5px;
          border-radius:12px;
        }
        .phab-admin-community-lk-date-badge strong{
          font-size:20px;
        }
        .phab-admin-community-lk-side-action{
          width:36px;
          height:36px;
          border-radius:12px;
        }
        .phab-admin-community-feed-media{
          margin-top:10px;
          min-height:130px;
          border-radius:14px;
        }
        .phab-admin-community-feed-media img{
          max-height:180px;
        }
        .phab-admin-community-feed-chip{
          padding:5px 9px;
          font-size:10px;
        }
        .phab-admin-community-lk-game-meta,
        .phab-admin-community-preview-text,
        .phab-admin-community-lk-engagement{
          margin-top:8px;
          font-size:12px;
        }
        .phab-admin-community-preview-title{
          margin-top:4px;
          font-size:18px;
        }
        .phab-admin-community-lk-primary-cta{
          padding:10px 14px;
          border-radius:14px;
          font-size:12px;
        }
        .phab-admin-community-about-item{
          padding:10px;
          border-radius:14px;
        }
        .phab-admin-community-about-item strong{
          margin-top:5px;
          font-size:13px;
        }
      }
      @media (max-height:860px){
        .phab-admin-communities-grid{
          overflow:auto;
        }
        .phab-admin-community-main,
        .phab-admin-community-preview-shell{
          overflow:auto;
        }
        .phab-admin-community-main-body,
        .phab-admin-community-preview-body{
          overflow:visible;
          flex:0 0 auto;
        }
        .phab-admin-community-section-card-fill{
          min-height:auto;
        }
      }
      @media (max-width:767px){
        .phab-admin-header{
          padding:10px 12px;
          gap:8px;
        }
        .phab-admin-heading-top{
          gap:8px;
        }
        .phab-admin-brand-logo{
          width:28px;
          height:28px;
          border-radius:8px;
          padding:3px;
        }
        .phab-admin-title{
          font-size:14px;
        }
        .phab-admin-title-full,
        .phab-admin-subtitle,
        .phab-admin-tabs{
          display:none;
        }
        .phab-admin-title-short,
        .phab-admin-mobile-tab-select{
          display:block;
        }
        .phab-admin-title-wrap{
          gap:8px;
        }
        .phab-admin-community-section-card-fill{
          min-height:calc(100dvh - 250px);
        }
        .phab-admin-community-lk-head{
          grid-template-columns:52px minmax(0,1fr);
        }
        .phab-admin-mobile-tab-select{
          max-width:140px;
          font-size:11px;
          padding-top:8px;
          padding-bottom:8px;
        }
        .phab-admin-toolbar{
          flex-wrap:nowrap;
          gap:6px;
          margin-left:auto;
        }
        .phab-admin-toolbar .phab-admin-btn,
        .phab-admin-toolbar .phab-admin-btn-secondary,
        .phab-admin-toolbar .phab-admin-status{
          width:38px;
          height:38px;
          min-width:38px;
          padding:0;
          border-radius:12px;
          justify-content:center;
        }
        .phab-admin-toolbar .phab-admin-btn-label,
        .phab-admin-toolbar .phab-admin-status-label{
          display:none;
        }
        .phab-admin-toolbar .phab-admin-btn-icon,
        .phab-admin-toolbar .phab-admin-status-icon{
          width:18px;
          height:18px;
        }
        .phab-admin-dialog-filters-inline{
          display:none !important;
        }
        .phab-admin-content{
          padding:8px;
        }
        .phab-admin-chat-mobile .phab-admin-msg-grid{
          display:block;
          height:100%;
          min-height:0;
        }
        .phab-admin-chat-mobile .phab-admin-pane{
          height:100%;
          min-height:0;
          border-radius:18px;
        }
        .phab-admin-chat-mobile .phab-admin-pane-mobile-hidden{
          display:none;
        }
        .phab-admin-chat-mobile .phab-admin-pane-head{
          padding:10px 12px;
          gap:8px;
          align-items:flex-start;
          flex-wrap:wrap;
        }
        .phab-admin-chat-mobile .phab-admin-pane-head-title{
          font-size:12px;
        }
        .phab-admin-chat-mobile .phab-admin-pane-head-actions{
          width:100%;
          justify-content:flex-start;
        }
        .phab-admin-chat-mobile .phab-admin-pane-head-search{
          max-width:none;
        }
        .phab-admin-chat-mobile .phab-admin-mobile-filter-btn{
          display:inline-flex;
          align-items:center;
          justify-content:center;
        }
        .phab-admin-chat-mobile .phab-admin-dialog-filters-wrap{
          flex-wrap:nowrap;
          overflow:auto hidden;
          gap:8px;
          padding:10px 12px;
          scrollbar-width:none;
        }
        .phab-admin-chat-mobile .phab-admin-dialog-filters-wrap::-webkit-scrollbar{
          display:none;
        }
        .phab-admin-chat-mobile .phab-admin-dialog-filter{
          flex:0 0 auto;
          white-space:nowrap;
          padding:8px 12px;
          font-size:11px;
        }
        .phab-admin-chat-mobile .phab-admin-pane-body{
          padding:10px;
        }
        .phab-admin-chat-mobile .phab-admin-list{
          gap:8px;
        }
        .phab-admin-chat-mobile .phab-admin-list-btn{
          padding:10px 11px;
          border-radius:16px;
        }
        .phab-admin-chat-mobile .phab-admin-list-title{
          font-size:15px;
        }
        .phab-admin-chat-mobile .phab-admin-list-meta{
          margin-top:4px;
          font-size:11px;
        }
        .phab-admin-chat-mobile .phab-admin-chat-preview{
          margin-top:4px;
          font-size:12px;
          -webkit-line-clamp:1;
        }
        .phab-admin-chat-mobile .phab-admin-chat-item-time{
          font-size:11px;
        }
        .phab-admin-chat-mobile .phab-admin-dialog-wrap{
          background:
            radial-gradient(circle at 14% 4%,rgba(207,255,182,.58),transparent 24%),
            radial-gradient(circle at 100% 10%,rgba(221,200,252,.62),transparent 26%),
            linear-gradient(180deg,rgba(255,255,255,.95) 0%,rgba(245,249,255,.95) 100%);
        }
        .phab-admin-chat-mobile .phab-admin-dialog-head{
          grid-template-columns:40px minmax(0,1fr) 38px;
          column-gap:12px;
          row-gap:6px;
          padding:12px;
          position:sticky;
          top:0;
          z-index:3;
          background:rgba(255,255,255,.86);
          backdrop-filter:blur(14px);
        }
        .phab-admin-chat-mobile .phab-admin-mobile-back{
          display:inline-flex;
          grid-column:1;
          grid-row:1 / span 3;
        }
        .phab-admin-chat-mobile .phab-admin-dialog-title,
        .phab-admin-chat-mobile .phab-admin-dialog-meta{
          grid-column:2;
        }
        .phab-admin-chat-mobile .phab-admin-dialog-title{
          font-size:15px;
          text-transform:none;
          letter-spacing:0;
        }
        .phab-admin-chat-mobile .phab-admin-dialog-meta{
          font-size:12px;
        }
        .phab-admin-chat-mobile .phab-admin-dialog-source-row{
          display:flex;
          grid-column:3;
          grid-row:1 / span 2;
          justify-self:end;
          align-self:start;
          justify-content:flex-end;
          gap:0;
          min-height:38px;
        }
        .phab-admin-chat-mobile .phab-admin-dialog-source-meta{
          display:none;
        }
        .phab-admin-chat-mobile .phab-admin-dialog-tags{
          display:none;
        }
        .phab-admin-chat-mobile .phab-admin-dialog-options{
          grid-column:1 / -1;
          width:100%;
          justify-self:stretch;
          flex-direction:row;
          align-items:stretch;
          gap:8px;
          margin-top:2px;
        }
        .phab-admin-chat-mobile .phab-admin-dialog-option{
          flex:1 1 0;
          width:auto;
          min-width:0;
          gap:8px;
          padding:8px 10px;
          border-radius:14px;
          border:1px solid rgba(51,0,32,.1);
          background:rgba(255,255,255,.88);
          align-items:center;
        }
        .phab-admin-chat-mobile .phab-admin-dialog-option .phab-admin-switch{
          margin-left:auto;
        }
        .phab-admin-chat-mobile .phab-admin-dialog-option .phab-admin-switch-text{
          min-width:0;
          font-size:11px;
          line-height:1.2;
          text-align:left;
        }
        .phab-admin-chat-mobile .phab-admin-dialog-body{
          grid-template-columns:1fr;
          grid-template-rows:minmax(0,1fr);
          padding:0;
          gap:0;
        }
        .phab-admin-chat-mobile .phab-admin-dialog-cabinet{
          display:none;
        }
        .phab-admin-chat-mobile .phab-admin-messages{
          border:0;
          border-radius:0;
          box-shadow:none;
          background:
            radial-gradient(circle at 5% 8%,rgba(182,253,255,.42),transparent 24%),
            radial-gradient(circle at 92% 12%,rgba(255,232,145,.38),transparent 26%),
            linear-gradient(180deg,rgba(255,255,255,.38),rgba(255,255,255,.22));
          padding:14px 12px 18px;
        }
        .phab-admin-chat-mobile .phab-admin-message{
          max-width:88%;
          padding:10px 12px;
          font-size:13px;
          line-height:1.45;
          border-radius:18px;
          margin:0 0 10px;
        }
        .phab-admin-chat-mobile .phab-admin-message-client{
          background:linear-gradient(135deg,rgba(240,255,199,.98) 0%,rgba(221,252,170,.92) 100%);
          border-color:rgba(145,181,43,.24);
          border-bottom-left-radius:6px;
        }
        .phab-admin-chat-mobile .phab-admin-message-staff{
          border-bottom-right-radius:6px;
        }
        .phab-admin-chat-mobile .phab-admin-message-system{
          max-width:94%;
        }
        .phab-admin-chat-mobile .phab-admin-quick-replies{
          display:flex;
        }
        .phab-admin-chat-mobile .phab-admin-compose{
          position:sticky;
          bottom:0;
          z-index:4;
          padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));
          background:linear-gradient(180deg,rgba(255,255,255,.78) 0%,rgba(255,255,255,.96) 32%);
          backdrop-filter:blur(14px);
        }
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
        .phab-admin-analytics-subtabs{
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
        .phab-admin-community-toolbar{grid-template-columns:1fr}
        .phab-admin-community-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
        .phab-admin-community-overview-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
        .phab-admin-community-about-grid{grid-template-columns:1fr}
        .phab-admin-community-main-body,
        .phab-admin-community-preview-body{padding:10px}
      }
    `;
    document.head.appendChild(style);
  }

  function createApi(cfg) {
    var roleHeader = cfg.roles.join(',');
    var stationHeader = cfg.stationIds.join(',');
    var connectorHeader = cfg.connectorRoutes.join(',');

    function buildHeaders(extraHeaders) {
      var headers = Object.assign(
        {
          'x-user-id': cfg.userId,
          'x-user-roles': roleHeader,
          'x-station-ids': stationHeader,
          'x-connector-routes': connectorHeader
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

    async function requestDirectJson(path) {
      var response = await fetch(path, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store'
      });

      if (!response.ok) {
        var text = await response.text().catch(function () {
          return '';
        });
        throw new Error('HTTP ' + response.status + ': ' + text);
      }

      var contentType = response.headers.get('content-type') || '';
      if (contentType.indexOf('application/json') === -1) {
        throw new Error('Источник вернул неожиданный формат вместо JSON.');
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
      sendMessage: function (dialogId, text, attachments) {
        return request('/support/dialogs/' + encodeURIComponent(dialogId) + '/reply', 'POST', {
          text: text,
          attachments: normalizeMessageAttachments(attachments)
        });
      },
      sendLegacyMessage: function (threadId, text, attachments) {
        return request('/messenger/dialogs/' + encodeURIComponent(threadId) + '/messages', 'POST', {
          text: text,
          attachments: normalizeMessageAttachments(attachments)
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
      getDialogsAnalyticsExport: function () {
        var query = arguments[0] || {};
        var params = new URLSearchParams();
        if (query.from) {
          params.set('from', String(query.from));
        }
        if (query.to) {
          params.set('to', String(query.to));
        }
        if (query.includeService === true) {
          params.set('includeService', 'true');
        }
        var suffix = params.toString() ? '?' + params.toString() : '';
        return request('/support/analytics/dialogs' + suffix, 'GET');
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
      getCommunities: function () {
        return request('/communities', 'GET');
      },
      getCommunityFeed: function (communityId, query) {
        var params = new URLSearchParams();
        if (query && query.phone) {
          params.set('phone', String(query.phone));
        }
        if (query && query.clientId) {
          params.set('clientId', String(query.clientId));
        }
        if (query && query.limit !== undefined && query.limit !== null) {
          params.set('limit', String(query.limit));
        }
        if (query && query.beforeTs !== undefined && query.beforeTs !== null) {
          params.set('beforeTs', String(query.beforeTs));
        }
        params.set('_ts', String(Date.now()));
        return requestDirectJson(
          '/lk/communities/' +
            encodeURIComponent(communityId) +
            '/feed?' +
            params.toString()
        );
      },
      getCommunityChatMessages: function (communityId, query) {
        var params = new URLSearchParams();
        if (query && query.phone) {
          params.set('phone', String(query.phone));
        }
        if (query && query.clientId) {
          params.set('clientId', String(query.clientId));
        }
        if (query && query.limit !== undefined && query.limit !== null) {
          params.set('limit', String(query.limit));
        }
        if (query && query.beforeTs !== undefined && query.beforeTs !== null) {
          params.set('beforeTs', String(query.beforeTs));
        }
        params.set('_ts', String(Date.now()));
        return requestDirectJson(
          '/lk/communities/' +
            encodeURIComponent(communityId) +
            '/messages?' +
            params.toString()
        );
      },
      getCommunityManagedFeed: function (communityId) {
        return request('/communities/' + encodeURIComponent(communityId) + '/feed-items', 'GET');
      },
      createCommunityFeedItem: function (communityId, payload) {
        return request('/communities/' + encodeURIComponent(communityId) + '/feed-items', 'POST', payload);
      },
      updateCommunityFeedItem: function (communityId, feedItemId, payload) {
        return request(
          '/communities/' + encodeURIComponent(communityId) + '/feed-items/' + encodeURIComponent(feedItemId),
          'PATCH',
          payload
        );
      },
      deleteCommunityFeedItem: function (communityId, feedItemId) {
        return request(
          '/communities/' + encodeURIComponent(communityId) + '/feed-items/' + encodeURIComponent(feedItemId),
          'DELETE'
        );
      },
      getCommunityRanking: function (communityId, query) {
        var params = new URLSearchParams();
        if (query && query.phone) {
          params.set('phone', String(query.phone));
        }
        if (query && query.clientId) {
          params.set('clientId', String(query.clientId));
        }
        params.set('_ts', String(Date.now()));
        return requestDirectJson(
          '/lk/communities/' +
            encodeURIComponent(communityId) +
            '/ranking?' +
            params.toString()
        );
      },
      updateCommunity: function (communityId, payload) {
        return request('/communities/' + encodeURIComponent(communityId), 'PATCH', payload);
      },
      deleteCommunity: function (communityId) {
        return request('/communities/' + encodeURIComponent(communityId), 'DELETE');
      },
      manageCommunityMember: function (communityId, payload) {
        return request(
          '/communities/' + encodeURIComponent(communityId) + '/members/manage',
          'POST',
          payload
        );
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
    heading.className = 'phab-admin-heading';
    header.appendChild(heading);

    var headingTop = document.createElement('div');
    headingTop.className = 'phab-admin-heading-top';
    heading.appendChild(headingTop);

    var brandLogo = document.createElement('img');
    brandLogo.className = 'phab-admin-brand-logo';
    brandLogo.src = '/api/ui/favicon.svg';
    brandLogo.alt = 'Дворотека';
    headingTop.appendChild(brandLogo);

    var titleWrap = document.createElement('div');
    titleWrap.className = 'phab-admin-title-wrap';
    headingTop.appendChild(titleWrap);

    var title = document.createElement('div');
    title.className = 'phab-admin-title';
    titleWrap.appendChild(title);

    var titleFull = document.createElement('span');
    titleFull.className = 'phab-admin-title-full';
    titleFull.textContent = cfg.title;
    title.appendChild(titleFull);

    var titleShort = document.createElement('span');
    titleShort.className = 'phab-admin-title-short';
    titleShort.textContent = 'ЦУП';
    title.appendChild(titleShort);

    var mobileTabSelect = document.createElement('select');
    mobileTabSelect.className = 'phab-admin-mobile-tab-select';
    mobileTabSelect.setAttribute('aria-label', 'Раздел панели');
    titleWrap.appendChild(mobileTabSelect);

    var subtitle = document.createElement('div');
    subtitle.className = 'phab-admin-subtitle';
    subtitle.textContent = 'Центр управления пространством';
    heading.appendChild(subtitle);

    var toolbar = document.createElement('div');
    toolbar.className = 'phab-admin-toolbar';
    header.appendChild(toolbar);

    var status = document.createElement('span');
    status.className = 'phab-admin-status';
    status.title = 'Готово';
    status.setAttribute('aria-label', 'Готово');
    var statusIcon = document.createElement('span');
    statusIcon.className = 'phab-admin-status-icon';
    status.appendChild(statusIcon);
    var statusLabel = document.createElement('span');
    statusLabel.className = 'phab-admin-status-label';
    statusLabel.textContent = 'Готово';
    status.appendChild(statusLabel);
    toolbar.appendChild(status);

    var logoutBtn = document.createElement('button');
    logoutBtn.className = 'phab-admin-btn-secondary phab-admin-toolbar-btn';
    logoutBtn.type = 'button';
    logoutBtn.setAttribute('aria-label', 'Выйти');
    logoutBtn.title = 'Выйти';
    var logoutIcon = document.createElement('span');
    logoutIcon.className = 'phab-admin-btn-icon';
    logoutIcon.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/>' +
      '<path d="M10 17l5-5-5-5"/>' +
      '<path d="M15 12H4"/>' +
      '</svg>';
    logoutBtn.appendChild(logoutIcon);
    var logoutLabel = document.createElement('span');
    logoutLabel.className = 'phab-admin-btn-label';
    logoutLabel.textContent = 'Выйти';
    logoutBtn.appendChild(logoutLabel);
    toolbar.appendChild(logoutBtn);

    var refreshBtn = document.createElement('button');
    refreshBtn.className = 'phab-admin-btn phab-admin-toolbar-btn';
    refreshBtn.type = 'button';
    refreshBtn.setAttribute('aria-label', 'Обновить');
    refreshBtn.title = 'Обновить';
    var refreshIcon = document.createElement('span');
    refreshIcon.className = 'phab-admin-btn-icon';
    refreshIcon.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M20 6v5h-5"/>' +
      '<path d="M20 11a8 8 0 1 0 2.1 5.4"/>' +
      '</svg>';
    refreshBtn.appendChild(refreshIcon);
    var refreshLabel = document.createElement('span');
    refreshLabel.className = 'phab-admin-btn-label';
    refreshLabel.textContent = 'Обновить';
    refreshBtn.appendChild(refreshLabel);
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

    var tabCommunities = document.createElement('button');
    tabCommunities.className = 'phab-admin-tab';
    tabCommunities.type = 'button';
    tabCommunities.textContent = 'Сообщества';
    tabs.appendChild(tabCommunities);

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

    var communitiesSection = document.createElement('div');
    communitiesSection.className = 'phab-admin-hidden';
    communitiesSection.style.flex = '1';
    communitiesSection.style.minHeight = '0';
    communitiesSection.style.display = 'flex';
    communitiesSection.style.flexDirection = 'column';
    content.appendChild(communitiesSection);

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

    var leftHeadActions = document.createElement('div');
    leftHeadActions.className = 'phab-admin-pane-head-actions';
    leftHead.appendChild(leftHeadActions);

    var dialogSearchInput = document.createElement('input');
    dialogSearchInput.className = 'phab-admin-input phab-admin-pane-head-search';
    dialogSearchInput.type = 'search';
    dialogSearchInput.placeholder = 'Поиск по имени или номеру...';
    dialogSearchInput.setAttribute('aria-label', 'Поиск диалогов');
    leftHeadActions.appendChild(dialogSearchInput);

    var dialogFiltersBtn = document.createElement('button');
    dialogFiltersBtn.className = 'phab-admin-btn-secondary phab-admin-mobile-filter-btn';
    dialogFiltersBtn.type = 'button';
    dialogFiltersBtn.textContent = 'Фильтры';
    dialogFiltersBtn.setAttribute('aria-label', 'Открыть расширенные фильтры');
    leftHeadActions.appendChild(dialogFiltersBtn);

    var dialogFiltersWrap = document.createElement('div');
    dialogFiltersWrap.className =
      'phab-admin-dialog-filters-wrap phab-admin-dialog-filters-inline phab-admin-hidden';
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

    var dialogBackBtn = document.createElement('button');
    dialogBackBtn.className = 'phab-admin-mobile-back';
    dialogBackBtn.type = 'button';
    dialogBackBtn.textContent = '←';
    dialogBackBtn.setAttribute('aria-label', 'Назад к списку чатов');
    dialogHead.appendChild(dialogBackBtn);

    var dialogTitle = document.createElement('div');
    dialogTitle.className = 'phab-admin-dialog-title';
    dialogTitle.textContent = 'Диалоги';
    dialogHead.appendChild(dialogTitle);

    var dialogMeta = document.createElement('div');
    dialogMeta.className = 'phab-admin-dialog-meta';
    dialogMeta.textContent = 'Выберите чат, чтобы открыть переписку и будущую ленту действий';
    dialogHead.appendChild(dialogMeta);

    var dialogSourceRow = document.createElement('div');
    dialogSourceRow.className = 'phab-admin-dialog-source-row';
    dialogHead.appendChild(dialogSourceRow);

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

    var quickReplies = document.createElement('div');
    quickReplies.className = 'phab-admin-quick-replies';
    compose.appendChild(quickReplies);

    var pendingAttachments = document.createElement('div');
    pendingAttachments.className = 'phab-admin-compose-attachments';
    compose.appendChild(pendingAttachments);

    var attachmentInput = document.createElement('input');
    attachmentInput.className = 'phab-admin-file-input-hidden';
    attachmentInput.type = 'file';
    attachmentInput.accept = 'image/*';
    attachmentInput.multiple = true;
    compose.appendChild(attachmentInput);

    var composeRow = document.createElement('div');
    composeRow.className = 'phab-admin-compose-row';
    compose.appendChild(composeRow);

    var attachBtn = document.createElement('button');
    attachBtn.className = 'phab-admin-btn-secondary';
    attachBtn.type = 'button';
    attachBtn.textContent = 'Фото';
    composeRow.appendChild(attachBtn);

    var input = document.createElement('input');
    input.className = 'phab-admin-input';
    input.type = 'text';
    input.placeholder = 'Ответ сотрудника...';
    input.maxLength = 2000;
    composeRow.appendChild(input);

    var sendBtn = document.createElement('button');
    sendBtn.className = 'phab-admin-btn';
    sendBtn.type = 'button';
    sendBtn.textContent = 'Отправить';
    composeRow.appendChild(sendBtn);

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

    var analyticsSubtabs = document.createElement('div');
    analyticsSubtabs.className = 'phab-admin-analytics-subtabs';
    analyticsSection.appendChild(analyticsSubtabs);

    var analyticsGamesTabBtn = document.createElement('button');
    analyticsGamesTabBtn.className = 'phab-admin-dialog-filter phab-admin-dialog-filter-active';
    analyticsGamesTabBtn.type = 'button';
    analyticsGamesTabBtn.textContent = 'Игры';
    analyticsSubtabs.appendChild(analyticsGamesTabBtn);

    var analyticsDialogsTabBtn = document.createElement('button');
    analyticsDialogsTabBtn.className = 'phab-admin-dialog-filter';
    analyticsDialogsTabBtn.type = 'button';
    analyticsDialogsTabBtn.textContent = 'Диалоги';
    analyticsSubtabs.appendChild(analyticsDialogsTabBtn);

    var analyticsGamesPane = document.createElement('div');
    analyticsGamesPane.className = 'phab-admin-analytics-pane';
    analyticsSection.appendChild(analyticsGamesPane);

    var analyticsControls = document.createElement('div');
    analyticsControls.className = 'phab-admin-logs-controls';
    analyticsGamesPane.appendChild(analyticsControls);

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
    analyticsGamesPane.appendChild(analyticsTableWrap);

    var analyticsTable = document.createElement('table');
    analyticsTable.className = 'phab-admin-games-table';
    analyticsTableWrap.appendChild(analyticsTable);

    var analyticsDialogsPane = document.createElement('div');
    analyticsDialogsPane.className = 'phab-admin-analytics-pane phab-admin-hidden';
    analyticsSection.appendChild(analyticsDialogsPane);

    var analyticsDialogsControls = document.createElement('div');
    analyticsDialogsControls.className = 'phab-admin-logs-controls';
    analyticsDialogsPane.appendChild(analyticsDialogsControls);

    var analyticsDialogsFilters = document.createElement('div');
    analyticsDialogsFilters.className = 'phab-admin-logs-filters';
    analyticsDialogsControls.appendChild(analyticsDialogsFilters);

    var analyticsDialogsFromWrap = document.createElement('label');
    analyticsDialogsFromWrap.className = 'phab-admin-logs-filter';
    analyticsDialogsFilters.appendChild(analyticsDialogsFromWrap);

    var analyticsDialogsFromLabel = document.createElement('span');
    analyticsDialogsFromLabel.className = 'phab-admin-settings-label';
    analyticsDialogsFromLabel.textContent = 'С даты';
    analyticsDialogsFromWrap.appendChild(analyticsDialogsFromLabel);

    var analyticsDialogsFromInput = document.createElement('input');
    analyticsDialogsFromInput.className = 'phab-admin-settings-input';
    analyticsDialogsFromInput.type = 'date';
    analyticsDialogsFromInput.style.width = '160px';
    analyticsDialogsFromWrap.appendChild(analyticsDialogsFromInput);

    var analyticsDialogsToWrap = document.createElement('label');
    analyticsDialogsToWrap.className = 'phab-admin-logs-filter';
    analyticsDialogsFilters.appendChild(analyticsDialogsToWrap);

    var analyticsDialogsToLabel = document.createElement('span');
    analyticsDialogsToLabel.className = 'phab-admin-settings-label';
    analyticsDialogsToLabel.textContent = 'По дату';
    analyticsDialogsToWrap.appendChild(analyticsDialogsToLabel);

    var analyticsDialogsToInput = document.createElement('input');
    analyticsDialogsToInput.className = 'phab-admin-settings-input';
    analyticsDialogsToInput.type = 'date';
    analyticsDialogsToInput.style.width = '160px';
    analyticsDialogsToWrap.appendChild(analyticsDialogsToInput);

    var analyticsDialogsFormatWrap = document.createElement('label');
    analyticsDialogsFormatWrap.className = 'phab-admin-logs-filter';
    analyticsDialogsFilters.appendChild(analyticsDialogsFormatWrap);

    var analyticsDialogsFormatLabel = document.createElement('span');
    analyticsDialogsFormatLabel.className = 'phab-admin-settings-label';
    analyticsDialogsFormatLabel.textContent = 'Формат';
    analyticsDialogsFormatWrap.appendChild(analyticsDialogsFormatLabel);

    var analyticsDialogsFormatInput = document.createElement('select');
    analyticsDialogsFormatInput.className =
      'phab-admin-settings-input phab-admin-analytics-export-format';
    var analyticsDialogsFormatJson = document.createElement('option');
    analyticsDialogsFormatJson.value = 'json';
    analyticsDialogsFormatJson.textContent = 'JSON';
    analyticsDialogsFormatInput.appendChild(analyticsDialogsFormatJson);
    var analyticsDialogsFormatCsv = document.createElement('option');
    analyticsDialogsFormatCsv.value = 'csv';
    analyticsDialogsFormatCsv.textContent = 'CSV';
    analyticsDialogsFormatInput.appendChild(analyticsDialogsFormatCsv);
    analyticsDialogsFormatWrap.appendChild(analyticsDialogsFormatInput);

    var analyticsDialogsExportBtn = document.createElement('button');
    analyticsDialogsExportBtn.className = 'phab-admin-btn';
    analyticsDialogsExportBtn.type = 'button';
    analyticsDialogsExportBtn.textContent = 'Выгрузить';
    analyticsDialogsFilters.appendChild(analyticsDialogsExportBtn);

    var analyticsDialogsSummary = document.createElement('div');
    analyticsDialogsSummary.className = 'phab-admin-analytics-export-summary';
    analyticsDialogsSummary.textContent =
      'Выберите период и формат, затем нажмите «Выгрузить».';
    analyticsDialogsPane.appendChild(analyticsDialogsSummary);

    var tournamentsTable = document.createElement('table');
    tournamentsTable.className = 'phab-admin-games-table';
    tournamentsSection.appendChild(tournamentsTable);

    var communitiesGrid = document.createElement('div');
    communitiesGrid.className = 'phab-admin-communities-grid';
    communitiesSection.appendChild(communitiesGrid);

    var communitiesListPane = document.createElement('div');
    communitiesListPane.className = 'phab-admin-community-pane';
    communitiesGrid.appendChild(communitiesListPane);

    var communitiesListHead = document.createElement('div');
    communitiesListHead.className = 'phab-admin-community-pane-head';
    communitiesListPane.appendChild(communitiesListHead);

    var communitiesListHeadTitle = document.createElement('div');
    communitiesListHeadTitle.className = 'phab-admin-community-pane-title';
    communitiesListHeadTitle.textContent = 'Сообщества';
    communitiesListHead.appendChild(communitiesListHeadTitle);

    var communitySearchInput = document.createElement('input');
    communitySearchInput.className = 'phab-admin-input phab-admin-community-search';
    communitySearchInput.type = 'search';
    communitySearchInput.placeholder = 'Поиск по названию, станции, тегам...';
    communitySearchInput.setAttribute('aria-label', 'Поиск сообществ');
    communitiesListHead.appendChild(communitySearchInput);

    var communitiesListBody = document.createElement('div');
    communitiesListBody.className = 'phab-admin-community-list-body';
    communitiesListPane.appendChild(communitiesListBody);

    var communitiesList = document.createElement('ul');
    communitiesList.className = 'phab-admin-list';
    communitiesListBody.appendChild(communitiesList);

    var communitiesDetailPane = document.createElement('div');
    communitiesDetailPane.className = 'phab-admin-community-pane phab-admin-community-main';
    communitiesGrid.appendChild(communitiesDetailPane);

    var communityHead = document.createElement('div');
    communityHead.className = 'phab-admin-community-main-head';
    communitiesDetailPane.appendChild(communityHead);

    var communityHeadLead = document.createElement('div');
    communityHeadLead.className = 'phab-admin-community-main-lead';
    communityHead.appendChild(communityHeadLead);

    var communityAvatar = document.createElement('div');
    communityAvatar.className = 'phab-admin-community-avatar phab-admin-community-main-avatar';
    communityAvatar.textContent = 'CM';
    communityHeadLead.appendChild(communityAvatar);

    var communityHeadInfo = document.createElement('div');
    communityHeadLead.appendChild(communityHeadInfo);

    var communityTitle = document.createElement('div');
    communityTitle.className = 'phab-admin-community-pane-title phab-admin-community-main-title';
    communityTitle.textContent = 'Сообщество не выбрано';
    communityHeadInfo.appendChild(communityTitle);

    var communityMeta = document.createElement('div');
    communityMeta.className = 'phab-admin-community-main-meta';
    communityMeta.textContent =
      'Выберите сообщество слева, чтобы открыть модераторский интерфейс и параметры.';
    communityHeadInfo.appendChild(communityMeta);

    var communityTags = document.createElement('div');
    communityTags.className = 'phab-admin-community-main-tags';
    communityHeadInfo.appendChild(communityTags);

    var communityLinks = document.createElement('div');
    communityLinks.className = 'phab-admin-community-main-tags';
    communityLinks.style.display = 'none';
    communityHeadInfo.appendChild(communityLinks);

    var communityActions = document.createElement('div');
    communityActions.className = 'phab-admin-community-main-actions';
    communityHead.appendChild(communityActions);

    var communityStats = document.createElement('div');
    communityStats.className = 'phab-admin-community-summary';
    communitiesDetailPane.appendChild(communityStats);

    var communityTabs = document.createElement('div');
    communityTabs.className = 'phab-admin-community-tabs';
    communitiesDetailPane.appendChild(communityTabs);

    var communityAdminGrid = document.createElement('div');
    communityAdminGrid.className = 'phab-admin-community-main-body';
    communitiesDetailPane.appendChild(communityAdminGrid);

    var communitiesPreviewPane = document.createElement('div');
    communitiesPreviewPane.className = 'phab-admin-community-pane phab-admin-community-preview-shell';
    communitiesGrid.appendChild(communitiesPreviewPane);

    var communityPreviewHead = document.createElement('div');
    communityPreviewHead.className = 'phab-admin-community-pane-head-light';
    communitiesPreviewPane.appendChild(communityPreviewHead);

    var communityPreviewTitle = document.createElement('div');
    communityPreviewTitle.className = 'phab-admin-community-pane-title';
    communityPreviewTitle.textContent = 'Модерация сообщества';
    communityPreviewHead.appendChild(communityPreviewTitle);

    var communityPreviewMeta = document.createElement('div');
    communityPreviewMeta.className = 'phab-admin-community-pane-subtitle';
    communityPreviewMeta.textContent =
      'Живой режим просмотра: лента, чат, рейтинг и карточка сообщества.';
    communityPreviewHead.appendChild(communityPreviewMeta);

    var communityPreviewBody = document.createElement('div');
    communityPreviewBody.className = 'phab-admin-community-preview-body';
    communitiesPreviewPane.appendChild(communityPreviewBody);

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
    accessRoutesInput.placeholder = 'TG_BOT, MAX_BOT, MAX_ACADEMY_BOT, PROMO_WEB_MESSENGER';
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

    var communityFeedEditorModal = document.createElement('div');
    communityFeedEditorModal.className = 'phab-admin-modal phab-admin-hidden';
    overlayHost.appendChild(communityFeedEditorModal);

    var communityFeedEditorCard = document.createElement('div');
    communityFeedEditorCard.className = 'phab-admin-modal-card';
    communityFeedEditorModal.appendChild(communityFeedEditorCard);

    var communityFeedEditorHead = document.createElement('div');
    communityFeedEditorHead.className = 'phab-admin-modal-head';
    communityFeedEditorCard.appendChild(communityFeedEditorHead);

    var communityFeedEditorTitle = document.createElement('div');
    communityFeedEditorTitle.className = 'phab-admin-modal-title';
    communityFeedEditorTitle.textContent = 'Редактировать публикацию';
    communityFeedEditorHead.appendChild(communityFeedEditorTitle);

    var communityFeedEditorActions = document.createElement('div');
    communityFeedEditorActions.className = 'phab-admin-modal-actions';
    communityFeedEditorHead.appendChild(communityFeedEditorActions);

    var communityFeedEditorSaveBtn = document.createElement('button');
    communityFeedEditorSaveBtn.className = 'phab-admin-btn';
    communityFeedEditorSaveBtn.type = 'button';
    communityFeedEditorSaveBtn.textContent = 'Сохранить';
    communityFeedEditorActions.appendChild(communityFeedEditorSaveBtn);

    var communityFeedEditorCloseBtn = document.createElement('button');
    communityFeedEditorCloseBtn.className = 'phab-admin-modal-close';
    communityFeedEditorCloseBtn.type = 'button';
    communityFeedEditorCloseBtn.textContent = '×';
    communityFeedEditorActions.appendChild(communityFeedEditorCloseBtn);

    var communityFeedEditorBody = document.createElement('div');
    communityFeedEditorBody.className = 'phab-admin-modal-body';
    communityFeedEditorCard.appendChild(communityFeedEditorBody);

    var mobileFiltersSheet = document.createElement('div');
    mobileFiltersSheet.className = 'phab-admin-bottom-sheet phab-admin-hidden';
    overlayHost.appendChild(mobileFiltersSheet);

    var mobileFiltersBackdrop = document.createElement('button');
    mobileFiltersBackdrop.className = 'phab-admin-bottom-sheet-backdrop';
    mobileFiltersBackdrop.type = 'button';
    mobileFiltersBackdrop.setAttribute('aria-label', 'Закрыть фильтры');
    mobileFiltersSheet.appendChild(mobileFiltersBackdrop);

    var mobileFiltersPanel = document.createElement('div');
    mobileFiltersPanel.className = 'phab-admin-bottom-sheet-panel';
    mobileFiltersSheet.appendChild(mobileFiltersPanel);

    var mobileFiltersHandle = document.createElement('div');
    mobileFiltersHandle.className = 'phab-admin-bottom-sheet-handle';
    mobileFiltersPanel.appendChild(mobileFiltersHandle);

    var mobileFiltersHead = document.createElement('div');
    mobileFiltersHead.className = 'phab-admin-bottom-sheet-head';
    mobileFiltersPanel.appendChild(mobileFiltersHead);

    var mobileFiltersTitleWrap = document.createElement('div');
    mobileFiltersHead.appendChild(mobileFiltersTitleWrap);

    var mobileFiltersTitle = document.createElement('div');
    mobileFiltersTitle.className = 'phab-admin-bottom-sheet-title';
    mobileFiltersTitle.textContent = 'Фильтры';
    mobileFiltersTitleWrap.appendChild(mobileFiltersTitle);

    var mobileFiltersSubtitle = document.createElement('div');
    mobileFiltersSubtitle.className = 'phab-admin-bottom-sheet-subtitle';
    mobileFiltersSubtitle.textContent = 'Быстрые фильтры и служебные настройки чатов';
    mobileFiltersTitleWrap.appendChild(mobileFiltersSubtitle);

    var mobileFiltersCloseBtn = document.createElement('button');
    mobileFiltersCloseBtn.className = 'phab-admin-btn-secondary';
    mobileFiltersCloseBtn.type = 'button';
    mobileFiltersCloseBtn.textContent = 'Закрыть';
    mobileFiltersHead.appendChild(mobileFiltersCloseBtn);

    var mobileFiltersBody = document.createElement('div');
    mobileFiltersBody.className = 'phab-admin-bottom-sheet-body';
    mobileFiltersPanel.appendChild(mobileFiltersBody);

    var mobileFiltersStationsSection = document.createElement('div');
    mobileFiltersStationsSection.className = 'phab-admin-bottom-sheet-section';
    mobileFiltersBody.appendChild(mobileFiltersStationsSection);

    var mobileFiltersStationsTitle = document.createElement('div');
    mobileFiltersStationsTitle.className = 'phab-admin-bottom-sheet-section-title';
    mobileFiltersStationsTitle.textContent = 'Станции';
    mobileFiltersStationsSection.appendChild(mobileFiltersStationsTitle);

    var mobileFiltersStations = document.createElement('div');
    mobileFiltersStations.className = 'phab-admin-dialog-filters-wrap';
    mobileFiltersStationsSection.appendChild(mobileFiltersStations);

    var mobileFiltersOptionsSection = document.createElement('div');
    mobileFiltersOptionsSection.className = 'phab-admin-bottom-sheet-section';
    mobileFiltersBody.appendChild(mobileFiltersOptionsSection);

    var mobileFiltersOptionsTitle = document.createElement('div');
    mobileFiltersOptionsTitle.className = 'phab-admin-bottom-sheet-section-title';
    mobileFiltersOptionsTitle.textContent = 'Дополнительно';
    mobileFiltersOptionsSection.appendChild(mobileFiltersOptionsTitle);

    var mobileFiltersOptions = document.createElement('div');
    mobileFiltersOptionsSection.appendChild(mobileFiltersOptions);

    var mobileFiltersActions = document.createElement('div');
    mobileFiltersActions.className = 'phab-admin-bottom-sheet-actions';
    mobileFiltersPanel.appendChild(mobileFiltersActions);

    var mobileFiltersResetBtn = document.createElement('button');
    mobileFiltersResetBtn.className = 'phab-admin-btn-secondary';
    mobileFiltersResetBtn.type = 'button';
    mobileFiltersResetBtn.textContent = 'Сбросить';
    mobileFiltersActions.appendChild(mobileFiltersResetBtn);

    var mobileFiltersDoneBtn = document.createElement('button');
    mobileFiltersDoneBtn.className = 'phab-admin-btn';
    mobileFiltersDoneBtn.type = 'button';
    mobileFiltersDoneBtn.textContent = 'Показать';
    mobileFiltersActions.appendChild(mobileFiltersDoneBtn);

    return {
      root: root,
      status: status,
      statusIcon: statusIcon,
      statusLabel: statusLabel,
      logoutBtn: logoutBtn,
      refreshBtn: refreshBtn,
      mobileTabSelect: mobileTabSelect,
      tabMessages: tabMessages,
      tabGames: tabGames,
      tabLogs: tabLogs,
      tabTournaments: tabTournaments,
      tabCommunities: tabCommunities,
      tabAnalytics: tabAnalytics,
      tabSettings: tabSettings,
      messagesSection: messagesSection,
      gamesSection: gamesSection,
      logsSection: logsSection,
      tournamentsSection: tournamentsSection,
      communitiesSection: communitiesSection,
      analyticsSection: analyticsSection,
      settingsSection: settingsSection,
      messagesGrid: messagesGrid,
      leftPane: leftPane,
      rightPane: rightPane,
      dialogSearchInput: dialogSearchInput,
      dialogFiltersBtn: dialogFiltersBtn,
      dialogFiltersWrap: dialogFiltersWrap,
      dialogFilters: dialogFilters,
      dialogsScrollBody: leftBody,
      dialogsList: dialogsList,
      dialogBackBtn: dialogBackBtn,
      dialogTitle: dialogTitle,
      dialogMeta: dialogMeta,
      dialogSourceRow: dialogSourceRow,
      dialogLinks: dialogLinks,
      dialogOptions: dialogOptions,
      messageModeToggle: messageModeToggle,
      messageModeToggleText: messageModeToggleText,
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
      quickReplies: quickReplies,
      pendingAttachments: pendingAttachments,
      attachmentInput: attachmentInput,
      attachBtn: attachBtn,
      input: input,
      sendBtn: sendBtn,
      mobileFiltersSheet: mobileFiltersSheet,
      mobileFiltersBackdrop: mobileFiltersBackdrop,
      mobileFiltersCloseBtn: mobileFiltersCloseBtn,
      mobileFiltersBody: mobileFiltersBody,
      mobileFiltersStations: mobileFiltersStations,
      mobileFiltersOptions: mobileFiltersOptions,
      mobileFiltersResetBtn: mobileFiltersResetBtn,
      mobileFiltersDoneBtn: mobileFiltersDoneBtn,
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
      communityFeedEditorModal: communityFeedEditorModal,
      communityFeedEditorCard: communityFeedEditorCard,
      communityFeedEditorTitle: communityFeedEditorTitle,
      communityFeedEditorBody: communityFeedEditorBody,
      communityFeedEditorSaveBtn: communityFeedEditorSaveBtn,
      communityFeedEditorCloseBtn: communityFeedEditorCloseBtn,
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
      analyticsGamesTabBtn: analyticsGamesTabBtn,
      analyticsDialogsTabBtn: analyticsDialogsTabBtn,
      analyticsGamesPane: analyticsGamesPane,
      analyticsDialogsPane: analyticsDialogsPane,
      analyticsFromInput: analyticsFromInput,
      analyticsToInput: analyticsToInput,
      analyticsApplyBtn: analyticsApplyBtn,
      analyticsResetBtn: analyticsResetBtn,
      analyticsTable: analyticsTable,
      analyticsDialogsFromInput: analyticsDialogsFromInput,
      analyticsDialogsToInput: analyticsDialogsToInput,
      analyticsDialogsFormatInput: analyticsDialogsFormatInput,
      analyticsDialogsExportBtn: analyticsDialogsExportBtn,
      analyticsDialogsSummary: analyticsDialogsSummary,
      tournamentsTable: tournamentsTable,
      communitySearchInput: communitySearchInput,
      communitiesList: communitiesList,
      communitiesDetailPane: communitiesDetailPane,
      communitiesPreviewPane: communitiesPreviewPane,
      communityAvatar: communityAvatar,
      communityTitle: communityTitle,
      communityMeta: communityMeta,
      communityTags: communityTags,
      communityLinks: communityLinks,
      communityActions: communityActions,
      communityStats: communityStats,
      communityTabs: communityTabs,
      communityAdminGrid: communityAdminGrid,
      communityPreviewTitle: communityPreviewTitle,
      communityPreviewMeta: communityPreviewMeta,
      communityPreviewBody: communityPreviewBody,
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

  function createTextChip(text, tone) {
    var chip = document.createElement('span');
    chip.className =
      'phab-admin-chip' +
      (tone === 'alert'
        ? ' phab-admin-chip-alert'
        : tone === 'warn'
          ? ' phab-admin-chip-warn'
          : '');
    chip.textContent = String(text || '').trim();
    return chip;
  }

  function formatStationScope(stationIds) {
    if (!Array.isArray(stationIds) || stationIds.length === 0) {
      return 'все станции';
    }
    return stationIds.join(', ');
  }

  function formatConnectorScope(connectorRoutes) {
    if (!Array.isArray(connectorRoutes) || connectorRoutes.length === 0) {
      return 'все коннекторы';
    }
    return connectorRoutes.join(', ');
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

  function canAccessCommunities(cfg) {
    return hasAnyRole(cfg, [
      'SUPER_ADMIN',
      'MANAGER',
      'SUPPORT',
      'GAME_MANAGER',
      'TOURNAMENT_MANAGER'
    ]);
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
    var windowResizeHandler = null;
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
      pendingMessageAttachments: [],
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
      analyticsSubtab: 'games',
      analyticsFilterFrom: getMonthStartDateInputValue(),
      analyticsFilterTo: getTodayDateInputValue(),
      analyticsDialogsFilterFrom: getMonthStartDateInputValue(),
      analyticsDialogsFilterTo: getTodayDateInputValue(),
      analyticsDialogsExportFormat: 'json',
      tournaments: [],
      communities: [],
      selectedCommunityId: null,
      communitiesSearchQuery: '',
      communitiesStationFilter: 'ALL',
      communitiesStatusFilter: 'ALL',
      communitiesLevelFilter: 'ALL',
      communitiesAccessFilter: 'ALL',
      communitiesActivityFilter: 'ALL',
      communitiesSortField: 'activity',
      communityCenterTab: 'overview',
      communityPreviewTab: 'feed',
      communityPreviewFeedSegment: 'ALL',
      communityMembersSegment: 'ALL',
      communityFeedById: Object.create(null),
      communityManagedFeedById: Object.create(null),
      communityManagedFeedLoadedById: Object.create(null),
      communityManagedFeedErrorById: Object.create(null),
      communityManagedFeedLoadingId: null,
      communityFeedModerationById: Object.create(null),
      communityFeedLoadedById: Object.create(null),
      communityFeedErrorById: Object.create(null),
      communityFeedLoadingId: null,
      communityFeedHasMoreById: Object.create(null),
      communityFeedNextBeforeTsById: Object.create(null),
      communityFeedLoadingMoreId: null,
      communityChatById: Object.create(null),
      communityChatLoadedById: Object.create(null),
      communityChatErrorById: Object.create(null),
      communityChatLoadingId: null,
      communityRankingById: Object.create(null),
      communityRankingLoadedById: Object.create(null),
      communityRankingErrorById: Object.create(null),
      communityRankingLoadingId: null,
      communityFeedCreatingId: null,
      communityFeedEditor: null,
      communityFeedEditingKey: null,
      communitySavingId: null,
      communityDeletingId: null,
      communityManagingKey: null,
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
      mobileConversationOpen: false,
      mobileFiltersSheetOpen: false,
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
    dom.analyticsDialogsFromInput.value = state.analyticsDialogsFilterFrom;
    dom.analyticsDialogsToInput.value = state.analyticsDialogsFilterTo;
    dom.analyticsDialogsFormatInput.value = state.analyticsDialogsExportFormat;
    dom.communitySearchInput.value = state.communitiesSearchQuery;

    function getStatusIconMarkup(isError) {
      if (isError) {
        return (
          '<svg viewBox="0 0 24 24" aria-hidden="true">' +
          '<circle cx="12" cy="12" r="9"/>' +
          '<path d="M9 9l6 6"/>' +
          '<path d="M15 9l-6 6"/>' +
          '</svg>'
        );
      }
      return (
        '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="9"/>' +
        '<path d="M8 12.5l2.5 2.5L16 9.5"/>' +
        '</svg>'
      );
    }

    function setStatus(text, isError) {
      var message = String(text || '').trim() || (isError ? 'Ошибка' : 'Готово');
      dom.statusIcon.innerHTML = getStatusIconMarkup(isError);
      dom.statusLabel.textContent = message;
      dom.status.title = message;
      dom.status.setAttribute('aria-label', message);
      dom.status.className = isError
        ? 'phab-admin-status phab-admin-status-error'
        : 'phab-admin-status';
    }

    function resetPendingMessageAttachments() {
      state.pendingMessageAttachments = [];
      dom.attachmentInput.value = '';
      renderPendingMessageAttachments();
    }

    function removePendingMessageAttachment(index) {
      state.pendingMessageAttachments = state.pendingMessageAttachments.filter(function (_item, itemIndex) {
        return itemIndex !== index;
      });
      renderPendingMessageAttachments();
    }

    function renderPendingMessageAttachments() {
      clearNode(dom.pendingAttachments);
      normalizeMessageAttachments(state.pendingMessageAttachments).forEach(function (attachment, index) {
        var chip = document.createElement('span');
        chip.className = 'phab-admin-attachment-chip';

        var label = document.createElement('span');
        label.textContent =
          (attachment.name || 'Фото') +
          (attachment.size ? ' · ' + formatFileSize(attachment.size) : '');
        chip.appendChild(label);

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.setAttribute('aria-label', 'Убрать фото');
        removeBtn.addEventListener('click', function () {
          removePendingMessageAttachment(index);
        });
        chip.appendChild(removeBtn);

        dom.pendingAttachments.appendChild(chip);
      });
    }

    async function appendPendingMessageAttachmentsFromFiles(files) {
      var fileList = Array.prototype.slice.call(files || []);
      if (fileList.length === 0) {
        return;
      }

      var existing = normalizeMessageAttachments(state.pendingMessageAttachments);
      for (var i = 0; i < fileList.length; i += 1) {
        if (existing.length >= 10) {
          break;
        }
        var attachment = await compressImageFileAttachment(fileList[i]);
        var nextTotalSize = getMessageAttachmentsTotalSize(existing) + Math.max(0, Number(attachment.size || 0));
        if (nextTotalSize > MAX_MESSAGE_ATTACHMENTS_TOTAL_BYTES) {
          throw new Error('Слишком большой общий объем фото в сообщении. Оставьте до ' + formatFileSize(MAX_MESSAGE_ATTACHMENTS_TOTAL_BYTES) + '.');
        }
        existing.push(attachment);
      }
      state.pendingMessageAttachments = existing;
      dom.attachmentInput.value = '';
      renderPendingMessageAttachments();
    }

    function populateMobileTabSelect() {
      clearNode(dom.mobileTabSelect);
      var hideCommunitiesTab = !canAccessCommunities(cfg);
      [
        { value: 'messages', label: 'Диалоги' },
        { value: 'games', label: 'Игры' },
        { value: 'logs', label: 'Логи', hidden: isRestrictedStationAdmin },
        { value: 'tournaments', label: 'Турниры' },
        { value: 'communities', label: 'Сообщества', hidden: hideCommunitiesTab },
        { value: 'analytics', label: 'Аналитика', hidden: isRestrictedStationAdmin },
        { value: 'settings', label: 'Настройки', hidden: isRestrictedStationAdmin }
      ]
        .filter(function (item) {
          return item.hidden !== true;
        })
        .forEach(function (item) {
          var option = document.createElement('option');
          option.value = item.value;
          option.textContent = item.label;
          dom.mobileTabSelect.appendChild(option);
        });
      dom.mobileTabSelect.value = state.activeTab;
      if (dom.mobileTabSelect.value !== state.activeTab) {
        dom.mobileTabSelect.value = 'messages';
      }
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

    function isMobileChatViewport() {
      if (typeof window === 'undefined') {
        return false;
      }
      if (typeof window.matchMedia === 'function') {
        return window.matchMedia('(max-width:' + String(MOBILE_CHAT_BREAKPOINT_PX) + 'px)').matches;
      }
      return Number(window.innerWidth || 0) <= MOBILE_CHAT_BREAKPOINT_PX;
    }

    function isMobileChatMode() {
      return state.activeTab === 'messages' && isMobileChatViewport();
    }

    function toggleMobileFiltersSheet(nextOpen) {
      var shouldOpen = isMobileChatMode() && nextOpen === true;
      state.mobileFiltersSheetOpen = shouldOpen;
      if (shouldOpen) {
        dom.mobileFiltersSheet.classList.remove('phab-admin-hidden');
      } else {
        dom.mobileFiltersSheet.classList.add('phab-admin-hidden');
      }
    }

    function syncResponsiveChatLayout() {
      var mobileMode = isMobileChatMode();
      dom.root.classList.toggle('phab-admin-chat-mobile', mobileMode);

      if (!mobileMode) {
        dom.leftPane.classList.remove('phab-admin-pane-mobile-hidden');
        dom.rightPane.classList.remove('phab-admin-pane-mobile-hidden');
        toggleMobileFiltersSheet(false);
        return;
      }

      var hasDialogOpen = state.mobileConversationOpen === true && Boolean(state.selectedThreadId);
      dom.leftPane.classList.toggle('phab-admin-pane-mobile-hidden', hasDialogOpen);
      dom.rightPane.classList.toggle('phab-admin-pane-mobile-hidden', !hasDialogOpen);
      if (hasDialogOpen) {
        toggleMobileFiltersSheet(false);
      }
    }

    function closeMobileConversationView() {
      state.mobileConversationOpen = false;
      syncResponsiveChatLayout();
    }

    function openDialogFromList(dialogId) {
      if (!dialogId) {
        return;
      }
      var wasSelected = state.selectedThreadId === dialogId;
      if (!wasSelected) {
        resetPendingMessageAttachments();
      }
      state.selectedThreadId = dialogId;
      if (isMobileChatMode()) {
        state.mobileConversationOpen = true;
        syncResponsiveChatLayout();
      }
      if (wasSelected && !isMobileChatMode()) {
        return;
      }
      openSelectedDialog().catch(handleError);
    }

    function getDialogSourceDescriptor(dialog) {
      var connector = resolveDialogConnector(dialog);
      if (!connector) {
        return null;
      }

      var brand =
        connector.indexOf('ACADEMY') >= 0
          ? {
              key: 'ffc',
              name: 'FFC',
              faviconUrl: FFC_FAVICON_URL,
              fallback: 'F'
            }
          : {
              key: 'padlhub',
              name: 'PadlHub',
              faviconUrl: PADLHUB_FAVICON_URL,
              fallback: 'P'
            };

      if (connector === 'TG_BOT') {
        return {
          messengerKey: 'telegram',
          messengerLabel: 'Telegram',
          brand: brand
        };
      }
      if (connector === 'MAX_BOT' || connector === 'MAX_ACADEMY_BOT') {
        return {
          messengerKey: 'max',
          messengerLabel: 'MAX',
          brand: brand
        };
      }
      if (
        connector === 'LK_WEB_MESSENGER' ||
        connector === 'LK_ACADEMY_WEB_MESSENGER' ||
        connector === 'PROMO_WEB_MESSENGER'
      ) {
        return {
          messengerKey: 'web',
          messengerLabel: 'Web',
          brand: brand
        };
      }
      return null;
    }

    function getSourceIconSvg(messengerKey) {
      if (messengerKey === 'telegram') {
        return (
          '<svg class="phab-admin-source-icon-svg" viewBox="0 0 24 24" aria-hidden="true">' +
          '<path d="M20.55 4.52 3.98 10.9c-1.13.45-1.12 1.08-.2 1.36l4.25 1.33 1.64 5.09c.2.62.1.86.76.86.51 0 .74-.24 1.02-.53l2.3-2.24 4.78 3.52c.88.49 1.51.24 1.73-.82l2.83-13.34c.32-1.3-.5-1.89-1.54-1.41Z"/></svg>'
        );
      }
      if (messengerKey === 'max') {
        return (
          '<svg class="phab-admin-source-icon-svg" viewBox="0 0 24 24" aria-hidden="true">' +
          '<path fill="#fff" d="M12.28 2.1c5.56 0 9.52 4.02 9.52 9.66 0 5.77-4.03 9.84-9.73 9.84-2.29 0-4.36-.58-5.98-1.67l-1.63 1.53c-.9.85-2.4.2-2.4-1.03V11.2c0-5.5 4.32-9.1 10.22-9.1Zm0 4.2c-3 0-5.08 2.17-5.08 5.4 0 3.2 2.08 5.4 5.08 5.4s5.08-2.2 5.08-5.4c0-3.23-2.08-5.4-5.08-5.4Z"/>' +
          '<circle cx="12.28" cy="11.7" r="3.86" fill="#5a60f4"/></svg>'
        );
      }
      if (messengerKey === 'web') {
        return (
          '<svg class="phab-admin-source-icon-svg" viewBox="0 0 24 24" aria-hidden="true">' +
          '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-13Zm2.5-.5a.5.5 0 0 0-.5.5V8h12V5.5a.5.5 0 0 0-.5-.5h-11Zm-.5 5v8.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V10H6Zm2 2h8v1.6H8V12Zm0 3h5.5v1.6H8V15Z"/></svg>'
        );
      }
      return '';
    }

    function SourceIcon(dialog, options) {
      var opts = options || {};
      var descriptor = getDialogSourceDescriptor(dialog);
      if (!descriptor) {
        return null;
      }

      var wrap = document.createElement('span');
      wrap.className =
        'phab-admin-source-icon phab-admin-source-icon--' + descriptor.messengerKey;
      wrap.title = descriptor.messengerLabel + ' · ' + descriptor.brand.name;
      wrap.setAttribute('aria-label', descriptor.messengerLabel + ' · ' + descriptor.brand.name);

      var svgMarkup = getSourceIconSvg(descriptor.messengerKey);
      if (svgMarkup) {
        wrap.innerHTML = svgMarkup;
      } else {
        var label = document.createElement('span');
        label.className = 'phab-admin-source-icon-label';
        label.textContent = descriptor.messengerLabel;
        wrap.appendChild(label);
      }

      var badge = document.createElement('span');
      badge.className = 'phab-admin-source-badge';
      wrap.appendChild(badge);

      var fallback = document.createElement('span');
      fallback.className = 'phab-admin-source-badge-fallback';
      fallback.textContent = descriptor.brand.fallback;
      badge.appendChild(fallback);

      if (descriptor.brand.faviconUrl) {
        var badgeIcon = document.createElement('img');
        badgeIcon.alt = descriptor.brand.name;
        badgeIcon.src = descriptor.brand.faviconUrl;
        badgeIcon.loading = opts.lazy === false ? 'eager' : 'lazy';
        badgeIcon.decoding = 'async';
        badgeIcon.referrerPolicy = 'no-referrer';
        badgeIcon.addEventListener('load', function () {
          fallback.style.display = 'none';
        });
        badgeIcon.addEventListener('error', function () {
          badgeIcon.remove();
          fallback.style.display = 'flex';
        });
        badge.appendChild(badgeIcon);
      }

      return wrap;
    }

    function renderDialogSourceRow(dialog) {
      clearNode(dom.dialogSourceRow);
      if (!dialog) {
        return;
      }

      var descriptor = getDialogSourceDescriptor(dialog);
      var sourceIcon = SourceIcon(dialog, { lazy: false });
      if (!descriptor || !sourceIcon) {
        return;
      }

      dom.dialogSourceRow.appendChild(sourceIcon);

      var meta = document.createElement('span');
      meta.className = 'phab-admin-dialog-source-meta';
      dom.dialogSourceRow.appendChild(meta);

      var title = document.createElement('span');
      title.className = 'phab-admin-dialog-source-title';
      title.textContent = descriptor.messengerLabel + ' · ' + descriptor.brand.name;
      meta.appendChild(title);

      var subtitle = document.createElement('span');
      subtitle.className = 'phab-admin-dialog-source-subtitle';
      subtitle.textContent =
        dialog.authStatus === 'VERIFIED' ? 'Клиент авторизован' : 'Ожидает подтверждение';
      meta.appendChild(subtitle);
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
      renderDialogSourceRow(dialog);
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
      if (isMobileChatMode()) {
        dom.dialogMeta.textContent =
          (dialog.stationName || dialog.stationId || 'Без станции') +
          ' · ' +
          formatDialogListTime(dialog.lastMessageAt);
      } else {
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
      }
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

    function normalizeMessageAttachments(value) {
      return normalizeArray(value)
        .map(function (item) {
          var attachment = normalizeObject(item);
          var type = String(attachment.type || '').trim().toUpperCase();
          var url = String(attachment.url || '').trim();
          if (type !== 'IMAGE' || !url) {
            return null;
          }
          return {
            id: String(attachment.id || 'attachment-' + Math.random().toString(36).slice(2, 10)),
            type: 'IMAGE',
            url: url,
            name: String(attachment.name || '').trim() || undefined,
            mimeType: String(attachment.mimeType || '').trim() || undefined,
            size: Number.isFinite(Number(attachment.size))
              ? Math.max(0, Math.floor(Number(attachment.size)))
              : undefined
          };
        })
        .filter(Boolean)
        .slice(0, 10);
    }

    function formatAttachmentPreview(attachments) {
      var normalized = normalizeMessageAttachments(attachments);
      if (normalized.length === 0) {
        return '';
      }
      var first = normalized[0];
      var label = first.name ? 'Фото: ' + first.name : 'Фото';
      return normalized.length > 1 ? label + ' (+' + String(normalized.length - 1) + ')' : label;
    }

    function getMessageAttachmentsTotalSize(attachments) {
      return normalizeMessageAttachments(attachments).reduce(function (sum, attachment) {
        return sum + Math.max(0, Number(attachment.size || 0));
      }, 0);
    }

    function readImageFileAsDataUrl(file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () {
          resolve(String(reader.result || ''));
        };
        reader.onerror = function () {
          reject(new Error('Не удалось прочитать фото'));
        };
        reader.readAsDataURL(file);
      });
    }

    function loadImageFromDataUrl(dataUrl) {
      return new Promise(function (resolve, reject) {
        var image = new Image();
        image.onload = function () {
          resolve(image);
        };
        image.onerror = function () {
          reject(new Error('Не удалось обработать фото'));
        };
        image.src = dataUrl;
      });
    }

    async function compressImageFileAttachment(file) {
      if (!file || !String(file.type || '').toLowerCase().startsWith('image/')) {
        throw new Error('Можно прикреплять только изображения');
      }

      if (Number(file.size || 0) > MAX_MESSAGE_SOURCE_IMAGE_BYTES) {
        throw new Error('Фото "' + String(file.name || 'image') + '" слишком тяжелое. Выберите файл до ' + formatFileSize(MAX_MESSAGE_SOURCE_IMAGE_BYTES) + '.');
      }

      var originalDataUrl = await readImageFileAsDataUrl(file);
      var image = await loadImageFromDataUrl(originalDataUrl);
      var maxSide = 1400;
      var width = image.naturalWidth || image.width || 0;
      var height = image.naturalHeight || image.height || 0;
      if (!width || !height) {
        if (Number(file.size || 0) > MAX_MESSAGE_ATTACHMENT_SIZE_BYTES) {
          throw new Error('Фото "' + String(file.name || 'image') + '" слишком большое для отправки. Максимум ' + formatFileSize(MAX_MESSAGE_ATTACHMENT_SIZE_BYTES) + '.');
        }
        return {
          id: 'img-' + Math.random().toString(36).slice(2, 10),
          type: 'IMAGE',
          url: originalDataUrl,
          name: String(file.name || 'photo'),
          mimeType: String(file.type || 'image/jpeg'),
          size: Number(file.size || 0)
        };
      }

      var scale = Math.min(1, maxSide / Math.max(width, height));
      var targetWidth = Math.max(1, Math.round(width * scale));
      var targetHeight = Math.max(1, Math.round(height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      var context = canvas.getContext('2d');
      if (!context) {
        return {
          id: 'img-' + Math.random().toString(36).slice(2, 10),
          type: 'IMAGE',
          url: originalDataUrl,
          name: String(file.name || 'photo'),
          mimeType: String(file.type || 'image/jpeg'),
          size: Number(file.size || 0)
        };
      }
      context.drawImage(image, 0, 0, targetWidth, targetHeight);
      var mimeType = String(file.type || '').toLowerCase() === 'image/png'
        ? 'image/png'
        : 'image/jpeg';
      var dataUrl = canvas.toDataURL(mimeType, 0.84);
      var estimatedSize = Math.round((dataUrl.length * 3) / 4);
      if (estimatedSize > MAX_MESSAGE_ATTACHMENT_SIZE_BYTES) {
        throw new Error('Фото "' + String(file.name || 'image') + '" слишком большое даже после сжатия. Максимум ' + formatFileSize(MAX_MESSAGE_ATTACHMENT_SIZE_BYTES) + '.');
      }
      return {
        id: 'img-' + Math.random().toString(36).slice(2, 10),
        type: 'IMAGE',
        url: dataUrl,
        name: String(file.name || 'photo'),
        mimeType: mimeType,
        size: estimatedSize
      };
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
      var mobileMode = isMobileChatMode();
      if (!canToggleMessages && !canToggleResolved) {
        dom.dialogOptions.style.display = 'none';
        return;
      }

      dom.dialogOptions.style.display = 'flex';
      dom.messageModeToggle.checked = shouldIncludeServiceMessages();
      dom.messageModeToggleText.textContent = mobileMode
        ? 'Служебные сообщения'
        : 'Показывать служебные сообщения';
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
        dom.resolutionToggleText.textContent = mobileMode
          ? 'Вопрос решен'
          : dialog.isResolved === true
            ? 'Вопрос пользователя решен'
            : 'Вопрос пользователя не решен';
      } else {
        dom.resolutionWrap.style.display = 'none';
        dom.resolutionToggle.checked = false;
        dom.resolutionToggle.disabled = true;
        dom.resolutionToggleText.textContent = mobileMode
          ? 'Вопрос решен'
          : 'Вопрос пользователя решен';
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
      clearNode(dom.mobileFiltersStations);
      clearNode(dom.mobileFiltersOptions);

      var canFilterByStation = canFilterDialogsByStation();
      var canToggleMessages = canToggleSystemMessages(cfg);
      var options = Array.isArray(state.dialogFilterOptions) ? state.dialogFilterOptions : [];

      if (!canFilterByStation || options.length === 0) {
        dom.dialogFiltersWrap.className =
          'phab-admin-dialog-filters-wrap phab-admin-dialog-filters-inline phab-admin-hidden';
      } else {
        dom.dialogFiltersWrap.className =
          'phab-admin-dialog-filters-wrap phab-admin-dialog-filters-inline';
      }

      if (canFilterByStation && options.length > 0) {
        appendDialogFilterButton(dom.dialogFilters, {
          label: 'Все',
          active: (state.dialogStationFilters || []).length === 0,
          onClick: function () {
            setDialogStationFilters([]).catch(handleError);
          }
        });

        appendDialogFilterButton(dom.mobileFiltersStations, {
          label: 'Все',
          active: (state.dialogStationFilters || []).length === 0,
          onClick: function () {
            setDialogStationFilters([]).catch(handleError);
          }
        });

        options.forEach(function (option) {
          var handleToggle = function () {
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
          };

          appendDialogFilterButton(dom.dialogFilters, {
            label: option.label + ' · ' + option.count,
            active: (state.dialogStationFilters || []).indexOf(option.key) >= 0,
            onClick: handleToggle
          });

          appendDialogFilterButton(dom.mobileFiltersStations, {
            label: option.label + ' · ' + option.count,
            active: (state.dialogStationFilters || []).indexOf(option.key) >= 0,
            onClick: handleToggle
          });
        });
      }

      if (state.dialogSearchQuery) {
        appendDialogFilterButton(dom.mobileFiltersOptions, {
          label: 'Сбросить поиск',
          active: true,
          onClick: function () {
            dom.dialogSearchInput.value = '';
            setDialogSearchQuery('').catch(handleError);
          }
        });
      }

      if (canToggleMessages) {
        appendDialogFilterButton(dom.mobileFiltersOptions, {
          label:
            shouldIncludeServiceMessages() ? 'Служебные: вкл' : 'Служебные: выкл',
          active: shouldIncludeServiceMessages(),
          onClick: function () {
            setIncludeServiceMessages(!shouldIncludeServiceMessages()).catch(handleError);
          }
        });
      }

      var hasAdvancedFilters =
        (canFilterByStation && options.length > 0) ||
        Boolean(state.dialogSearchQuery) ||
        canToggleMessages;
      dom.dialogFiltersBtn.disabled = !hasAdvancedFilters;
      dom.dialogFiltersBtn.style.opacity = hasAdvancedFilters ? '1' : '.55';
      dom.mobileFiltersDoneBtn.textContent = 'Показать ' + String(state.dialogs.length || 0);
      if (!hasAdvancedFilters) {
        toggleMobileFiltersSheet(false);
      }
    }

    function appendDialogFilterButton(container, options) {
      if (!container) {
        return null;
      }
      var opts = options || {};
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'phab-admin-dialog-filter' + (opts.active ? ' phab-admin-dialog-filter-active' : '');
      btn.textContent = String(opts.label || '');
      btn.addEventListener('click', function () {
        if (typeof opts.onClick === 'function') {
          opts.onClick();
        }
      });
      container.appendChild(btn);
      return btn;
    }

    async function resetMobileDialogFilters() {
      dom.dialogSearchInput.value = '';
      await setDialogSearchQuery('');
      await setDialogStationFilters([]);
      if (canToggleSystemMessages(cfg) && shouldIncludeServiceMessages()) {
        await setIncludeServiceMessages(false);
      }
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

    function formatDialogListTime(value) {
      if (!value) {
        return '--:--';
      }
      var date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return '--:--';
      }

      var now = new Date();
      var isSameDay =
        now.getFullYear() === date.getFullYear() &&
        now.getMonth() === date.getMonth() &&
        now.getDate() === date.getDate();

      if (isSameDay) {
        return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
      }

      return String(date.getDate()).padStart(2, '0') + '.' + String(date.getMonth() + 1).padStart(2, '0');
    }

    function resolveDialogListStationLabel(dialog) {
      var stationLabel = String(
        resolveDialogStationLabel(dialog && dialog.stationId, dialog && dialog.stationName) ||
          'Без станции'
      );
      var currentStationLabel = String(
        resolveDialogStationLabel(dialog && dialog.currentStationId, dialog && dialog.currentStationName)
      ).trim();

      if (
        currentStationLabel &&
        String(dialog && dialog.stationId || '').trim().toUpperCase() === 'UNASSIGNED' &&
        currentStationLabel !== stationLabel
      ) {
        return stationLabel + ' → ' + currentStationLabel;
      }

      return stationLabel;
    }

    function ChatItem(item) {
      var li = document.createElement('li');
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
        openDialogFromList(item.dialogId);
      });
      li.appendChild(btn);

      var lead = document.createElement('div');
      lead.className = 'phab-admin-chat-item-lead';
      btn.appendChild(lead);

      var sourceNode = SourceIcon(item);
      if (sourceNode) {
        lead.appendChild(sourceNode);
      }

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

      var timeEl = document.createElement('span');
      timeEl.className = 'phab-admin-chat-item-time';
      timeEl.textContent = formatDialogListTime(item.lastMessageAt);
      side.appendChild(timeEl);

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
        resolveDialogListStationLabel(item) +
        (item.isActiveForUser === false ? ' · неактивен' : '');
      main.appendChild(meta);

      var preview = document.createElement('div');
      preview.className = 'phab-admin-chat-preview';
      preview.textContent = String(item.lastMessageText || 'Сообщений пока нет');
      main.appendChild(preview);

      return li;
    }

    function ChatList(dialogs) {
      var fragment = document.createDocumentFragment();
      (Array.isArray(dialogs) ? dialogs : []).forEach(function (item) {
        fragment.appendChild(ChatItem(item));
      });
      return fragment;
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
        syncResponsiveChatLayout();
        return;
      }

      dom.dialogsList.appendChild(ChatList(state.dialogs));

      if (state.dialogs.length > 0 && (state.hasMoreDialogs || state.dialogsLoadingMore)) {
        var more = document.createElement('li');
        more.className = 'phab-admin-list-more';
        more.textContent = state.dialogsLoadingMore
          ? 'Загружаем ещё диалоги...'
          : 'Прокрутите вниз, чтобы загрузить ещё';
        dom.dialogsList.appendChild(more);
      }

      dialogsScrollBody.scrollTop = previousScrollTop;
      syncResponsiveChatLayout();
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
        if (isMobileChatMode() && !state.mobileConversationOpen) {
          await loadMessages({ forceRender: true, forceScrollBottom: true, forceRefresh: true });
        } else {
          await openSelectedDialog();
        }
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
        if (isMobileChatMode() && !state.mobileConversationOpen) {
          await loadMessages({ forceRender: true, forceScrollBottom: true, forceRefresh: true });
        } else {
          await openSelectedDialog();
        }
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
        if (isMobileChatMode() && !state.mobileConversationOpen) {
          await loadMessages({ forceRender: true, forceScrollBottom: true, forceRefresh: true });
          return;
        }
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
        var attachments = normalizeMessageAttachments(message.attachments);
        return Object.assign(
          { dataSource: 'support' },
          message,
          {
            text: String(message.text || '').trim() || formatAttachmentPreview(attachments),
            attachments: attachments.length > 0 ? attachments : undefined,
            kind: String(message.kind || '').trim().toUpperCase() || (attachments.length > 0 ? 'MEDIA' : 'TEXT')
          }
        );
      });
    }

    function normalizeLegacyMessages(messages) {
      return (Array.isArray(messages) ? messages : []).map(function (message) {
        var senderRole = String(message.senderRole || '').toUpperCase();
        var senderRoleRaw = String(message.senderRoleRaw || senderRole || '').toUpperCase();
        var direction = String(message.direction || '').toUpperCase();
        var isSystem = direction === 'SYSTEM' || senderRoleRaw === 'SYSTEM';
        var senderName = String(message.senderName || '').trim();
        var attachments = normalizeMessageAttachments(message.attachments);
        var text = String(message.text || '').trim() || formatAttachmentPreview(attachments);
        return {
          id: message.id,
          dataSource: 'messenger',
          text: text,
          attachments: attachments.length > 0 ? attachments : undefined,
          createdAt: message.createdAt,
          connector: '',
          kind: String(message.kind || '').trim().toUpperCase() || (attachments.length > 0 ? 'MEDIA' : 'TEXT'),
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

    function getQuickReplyOptions(dialog) {
      var text = String(
        dialog && (dialog.subject || dialog.lastMessageText || '') || ''
      ).toLowerCase();

      if (text.indexOf('сертифик') >= 0) {
        return [
          { label: 'Сертификат', text: 'Сертификат' },
          { label: 'Активация', text: 'Активация' },
          { label: 'Оплата', text: 'Оплата' },
          { label: 'Спасибо!', text: 'Спасибо!' }
        ];
      }

      if (text.indexOf('оплат') >= 0 || text.indexOf('чек') >= 0) {
        return [
          { label: 'Оплата', text: 'Оплата' },
          { label: 'Чек', text: 'Чек' },
          { label: 'Возврат', text: 'Возврат' },
          { label: 'Спасибо!', text: 'Спасибо!' }
        ];
      }

      if (text.indexOf('адрес') >= 0 || text.indexOf('как пройти') >= 0) {
        return [
          { label: 'Адрес', text: 'Адрес' },
          { label: 'Как пройти', text: 'Как пройти' },
          { label: 'Режим', text: 'Режим работы' },
          { label: 'Спасибо!', text: 'Спасибо!' }
        ];
      }

      return DEFAULT_QUICK_REPLY_OPTIONS.slice();
    }

    function applyQuickReply(text) {
      var value = String(text || '').trim();
      if (!value) {
        return;
      }
      var current = String(dom.input.value || '').trim();
      dom.input.value = current ? current + ' ' + value : value;
      dom.input.focus();
    }

    function QuickReplies(dialog) {
      var fragment = document.createDocumentFragment();
      getQuickReplyOptions(dialog).forEach(function (item) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'phab-admin-quick-reply';
        btn.textContent = item.label;
        btn.addEventListener('click', function () {
          applyQuickReply(item.text);
        });
        fragment.appendChild(btn);
      });
      return fragment;
    }

    function renderQuickReplies(dialog) {
      clearNode(dom.quickReplies);
      if (!dialog || dialog.isActiveForUser === false) {
        return;
      }
      dom.quickReplies.appendChild(QuickReplies(dialog));
    }

    function MessageBubble(message) {
      var isSystem = message.direction === 'SYSTEM' || message.senderRole === 'SYSTEM';
      var own = !isSystem && message.direction !== 'INBOUND' && message.senderRole !== 'CLIENT';
      var attachments = normalizeMessageAttachments(message && message.attachments);
      var div = document.createElement('div');
      div.className =
        'phab-admin-message ' +
        (isSystem
          ? 'phab-admin-message-system phab-admin-message-bubble-system'
          : own
            ? 'phab-admin-message-staff'
            : 'phab-admin-message-client');

      if (attachments.length > 0) {
        var attachmentsWrap = document.createElement('div');
        attachmentsWrap.className = 'phab-admin-message-attachments';
        attachments.forEach(function (attachment) {
          var link = document.createElement('a');
          link.className = 'phab-admin-message-image-link';
          link.href = attachment.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';

          var image = document.createElement('img');
          image.className = 'phab-admin-message-image';
          image.src = attachment.url;
          image.alt = attachment.name || 'Фото';
          image.loading = 'lazy';
          link.appendChild(image);

          attachmentsWrap.appendChild(link);
        });
        div.appendChild(attachmentsWrap);
      }

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
      var metaParts = [sender];
      if (!isSystem && own && roleLabel && sender !== roleLabel) {
        metaParts.push(roleLabel);
      }
      if (message.connector) {
        metaParts.push(message.connector);
      }
      if (message.kind && message.kind !== 'TEXT') {
        metaParts.push(message.kind);
      }
      metaParts.push(formatTime(message.createdAt));
      meta.textContent = metaParts.join(' · ');
      div.appendChild(meta);

      return div;
    }

    function ChatView(dialog, messages) {
      var fragment = document.createDocumentFragment();
      renderQuickReplies(dialog);
      (Array.isArray(messages) ? messages : []).forEach(function (message) {
        fragment.appendChild(MessageBubble(message));
      });
      return fragment;
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
        dom.attachBtn.disabled = true;
        dom.input.placeholder = 'Выберите чат слева...';
        renderQuickReplies(null);
        resetPendingMessageAttachments();
        var hint = document.createElement('div');
        hint.className = 'phab-admin-empty';
        hint.textContent = 'Выберите чат слева, чтобы открыть переписку';
        dom.messagesBox.appendChild(hint);
        syncResponsiveChatLayout();
        return;
      }

      if (!selectedDialog) {
        renderDialogHeader();
      }

      if (selectedDialog) {
        var dialogIsActiveForUser = selectedDialog.isActiveForUser !== false;
        dom.input.disabled = !dialogIsActiveForUser;
        dom.sendBtn.disabled = !dialogIsActiveForUser;
        dom.attachBtn.disabled = !dialogIsActiveForUser;
        dom.input.placeholder = dialogIsActiveForUser
          ? 'Ответ сотрудника...'
          : 'Чат неактивен для вашей станции';
        renderQuickReplies(selectedDialog);

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
          syncResponsiveChatLayout();
          return;
        }

        var empty = document.createElement('div');
        empty.className = 'phab-admin-empty';
        empty.textContent =
          state.rawMessages && state.rawMessages.length > 0
            ? 'Сообщения скрыты текущими настройками'
            : 'Сообщений пока нет';
        dom.messagesBox.appendChild(empty);
        syncResponsiveChatLayout();
        return;
      }

      dom.messagesBox.appendChild(ChatView(selectedDialog, messages));
      syncResponsiveChatLayout();

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

    function setAnalyticsSubtab(nextSubtab) {
      var target = nextSubtab === 'dialogs' ? 'dialogs' : 'games';
      state.analyticsSubtab = target;
      var isGames = target === 'games';
      dom.analyticsGamesTabBtn.className =
        'phab-admin-dialog-filter' + (isGames ? ' phab-admin-dialog-filter-active' : '');
      dom.analyticsDialogsTabBtn.className =
        'phab-admin-dialog-filter' + (!isGames ? ' phab-admin-dialog-filter-active' : '');
      dom.analyticsGamesPane.className = isGames
        ? 'phab-admin-analytics-pane'
        : 'phab-admin-analytics-pane phab-admin-hidden';
      dom.analyticsDialogsPane.className = isGames
        ? 'phab-admin-analytics-pane phab-admin-hidden'
        : 'phab-admin-analytics-pane';
    }

    function escapeCsvCell(value) {
      var text = value == null ? '' : String(value);
      if (/[",\r\n]/.test(text)) {
        return '"' + text.replace(/"/g, '""') + '"';
      }
      return text;
    }

    function buildDialogsExportRows(payload) {
      var rows = [];
      var period = isObject(payload && payload.period) ? payload.period : {};
      var dialogs = Array.isArray(payload && payload.dialogs) ? payload.dialogs : [];

      dialogs.forEach(function (dialog) {
        var connectors = Array.isArray(dialog && dialog.connectors)
          ? dialog.connectors.join('|')
          : '';
        var messages = Array.isArray(dialog && dialog.messages) ? dialog.messages : [];

        if (messages.length === 0) {
          rows.push({
            periodFrom: String(period.from || ''),
            periodTo: String(period.to || ''),
            dialogId: String(dialog && dialog.dialogId ? dialog.dialogId : ''),
            clientId: String(dialog && dialog.clientId ? dialog.clientId : ''),
            clientDisplayName: String(dialog && dialog.clientDisplayName ? dialog.clientDisplayName : ''),
            stationId: String(dialog && dialog.stationId ? dialog.stationId : ''),
            stationName: String(dialog && dialog.stationName ? dialog.stationName : ''),
            connectors: connectors,
            authStatus: String(dialog && dialog.authStatus ? dialog.authStatus : ''),
            dialogStatus: String(dialog && dialog.status ? dialog.status : ''),
            isResolved: dialog && dialog.isResolved === true ? 'true' : 'false',
            subject: String(dialog && dialog.subject ? dialog.subject : ''),
            dialogCreatedAt: String(dialog && dialog.createdAt ? dialog.createdAt : ''),
            dialogUpdatedAt: String(dialog && dialog.updatedAt ? dialog.updatedAt : ''),
            dialogLastMessageAt: String(dialog && dialog.lastMessageAt ? dialog.lastMessageAt : ''),
            responseCount: String(
              Number(dialog && dialog.responseCount ? dialog.responseCount : 0)
            ),
            averageFirstResponseMs:
              dialog && dialog.averageFirstResponseMs != null
                ? String(dialog.averageFirstResponseMs)
                : '',
            lastFirstResponseMs:
              dialog && dialog.lastFirstResponseMs != null
                ? String(dialog.lastFirstResponseMs)
                : '',
            messageId: '',
            messageCreatedAt: '',
            messageConnector: '',
            messageDirection: '',
            messageKind: '',
            senderRole: '',
            senderId: '',
            senderName: '',
            messageText: '',
            messagePhone: '',
            messageEmail: '',
            aiTopic: '',
            aiPriority: '',
            aiSentiment: '',
            aiSummary: '',
            aiTags: '',
            messageMetaJson: ''
          });
          return;
        }

        messages.forEach(function (message) {
          var ai = isObject(message && message.ai) ? message.ai : {};
          rows.push({
            periodFrom: String(period.from || ''),
            periodTo: String(period.to || ''),
            dialogId: String(dialog && dialog.dialogId ? dialog.dialogId : ''),
            clientId: String(dialog && dialog.clientId ? dialog.clientId : ''),
            clientDisplayName: String(dialog && dialog.clientDisplayName ? dialog.clientDisplayName : ''),
            stationId: String(dialog && dialog.stationId ? dialog.stationId : ''),
            stationName: String(dialog && dialog.stationName ? dialog.stationName : ''),
            connectors: connectors,
            authStatus: String(dialog && dialog.authStatus ? dialog.authStatus : ''),
            dialogStatus: String(dialog && dialog.status ? dialog.status : ''),
            isResolved: dialog && dialog.isResolved === true ? 'true' : 'false',
            subject: String(dialog && dialog.subject ? dialog.subject : ''),
            dialogCreatedAt: String(dialog && dialog.createdAt ? dialog.createdAt : ''),
            dialogUpdatedAt: String(dialog && dialog.updatedAt ? dialog.updatedAt : ''),
            dialogLastMessageAt: String(dialog && dialog.lastMessageAt ? dialog.lastMessageAt : ''),
            responseCount: String(
              Number(dialog && dialog.responseCount ? dialog.responseCount : 0)
            ),
            averageFirstResponseMs:
              dialog && dialog.averageFirstResponseMs != null
                ? String(dialog.averageFirstResponseMs)
                : '',
            lastFirstResponseMs:
              dialog && dialog.lastFirstResponseMs != null
                ? String(dialog.lastFirstResponseMs)
                : '',
            messageId: String(message && message.messageId ? message.messageId : ''),
            messageCreatedAt: String(message && message.createdAt ? message.createdAt : ''),
            messageConnector: String(message && message.connector ? message.connector : ''),
            messageDirection: String(message && message.direction ? message.direction : ''),
            messageKind: String(message && message.kind ? message.kind : ''),
            senderRole: String(message && message.senderRole ? message.senderRole : ''),
            senderId: String(message && message.senderId ? message.senderId : ''),
            senderName: String(message && message.senderName ? message.senderName : ''),
            messageText: String(message && message.text ? message.text : ''),
            messagePhone: String(message && message.phone ? message.phone : ''),
            messageEmail: String(message && message.email ? message.email : ''),
            aiTopic: String(ai.topic || ''),
            aiPriority: String(ai.priority || ''),
            aiSentiment: String(ai.sentiment || ''),
            aiSummary: String(ai.summary || ''),
            aiTags: Array.isArray(ai.tags) ? ai.tags.join('|') : '',
            messageMetaJson:
              message && isObject(message.meta) ? JSON.stringify(message.meta) : ''
          });
        });
      });

      return rows;
    }

    function buildDialogsExportCsv(payload) {
      var headers = [
        'periodFrom',
        'periodTo',
        'dialogId',
        'clientId',
        'clientDisplayName',
        'stationId',
        'stationName',
        'connectors',
        'authStatus',
        'dialogStatus',
        'isResolved',
        'subject',
        'dialogCreatedAt',
        'dialogUpdatedAt',
        'dialogLastMessageAt',
        'responseCount',
        'averageFirstResponseMs',
        'lastFirstResponseMs',
        'messageId',
        'messageCreatedAt',
        'messageConnector',
        'messageDirection',
        'messageKind',
        'senderRole',
        'senderId',
        'senderName',
        'messageText',
        'messagePhone',
        'messageEmail',
        'aiTopic',
        'aiPriority',
        'aiSentiment',
        'aiSummary',
        'aiTags',
        'messageMetaJson'
      ];
      var rows = buildDialogsExportRows(payload);
      var lines = [headers.join(',')];
      rows.forEach(function (row) {
        var line = headers
          .map(function (header) {
            return escapeCsvCell(row[header]);
          })
          .join(',');
        lines.push(line);
      });
      return lines.join('\n');
    }

    function buildDialogsExportFileName(format) {
      var fromPart = state.analyticsDialogsFilterFrom || 'from';
      var toPart = state.analyticsDialogsFilterTo || 'to';
      var extension = format === 'csv' ? 'csv' : 'json';
      return 'dialogs-export-' + fromPart + '_to_' + toPart + '.' + extension;
    }

    function downloadTextFile(fileName, content, mimeType) {
      var blob = new Blob([content], {
        type: mimeType || 'text/plain;charset=utf-8'
      });
      var url = window.URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      window.setTimeout(function () {
        window.URL.revokeObjectURL(url);
        if (link.parentNode) {
          link.parentNode.removeChild(link);
        }
      }, 0);
    }

    function renderDialogsExportSummary(payload) {
      if (!isObject(payload)) {
        dom.analyticsDialogsSummary.textContent = 'Нет данных для выгрузки.';
        return;
      }

      var period = isObject(payload.period) ? payload.period : {};
      var summary = isObject(payload.summary) ? payload.summary : {};
      dom.analyticsDialogsSummary.textContent =
        'Период: ' +
        String(period.from || '-') +
        ' — ' +
        String(period.to || '-') +
        '. Диалогов: ' +
        String(Number(summary.dialogsCount || 0)) +
        ', сообщений: ' +
        String(Number(summary.messagesCount || 0)) +
        ' (входящих: ' +
        String(Number(summary.inboundMessagesCount || 0)) +
        ', исходящих: ' +
        String(Number(summary.outboundMessagesCount || 0)) +
        ').';
    }

    async function exportDialogsAnalytics() {
      state.analyticsDialogsFilterFrom = String(dom.analyticsDialogsFromInput.value || '').trim();
      state.analyticsDialogsFilterTo = String(dom.analyticsDialogsToInput.value || '').trim();
      state.analyticsDialogsExportFormat = String(dom.analyticsDialogsFormatInput.value || 'json')
        .trim()
        .toLowerCase();

      if (!state.analyticsDialogsFilterFrom || !state.analyticsDialogsFilterTo) {
        setStatus('Выберите период для выгрузки диалогов', true);
        return;
      }
      if (state.analyticsDialogsFilterTo < state.analyticsDialogsFilterFrom) {
        setStatus('Дата "По дату" должна быть не раньше "С даты"', true);
        return;
      }

      dom.analyticsDialogsExportBtn.disabled = true;
      try {
        setStatus('Формируем выгрузку диалогов...', false);
        var payload =
          (await api.getDialogsAnalyticsExport({
            from: state.analyticsDialogsFilterFrom || undefined,
            to: state.analyticsDialogsFilterTo || undefined
          })) || {};
        if (!isObject(payload)) {
          throw new Error('Сервис выгрузки вернул пустой ответ');
        }

        renderDialogsExportSummary(payload);
        var format = state.analyticsDialogsExportFormat === 'csv' ? 'csv' : 'json';
        var fileName = buildDialogsExportFileName(format);
        if (format === 'csv') {
          downloadTextFile(fileName, buildDialogsExportCsv(payload), 'text/csv;charset=utf-8');
        } else {
          downloadTextFile(
            fileName,
            JSON.stringify(payload, null, 2),
            'application/json;charset=utf-8'
          );
        }

        var exportedDialogsCount = Number(payload.summary && payload.summary.dialogsCount ? payload.summary.dialogsCount : 0);
        var exportedMessagesCount = Number(payload.summary && payload.summary.messagesCount ? payload.summary.messagesCount : 0);
        setStatus(
          'Выгрузка готова: ' +
            String(exportedDialogsCount) +
            ' диалогов, ' +
            String(exportedMessagesCount) +
            ' сообщений',
          false
        );
      } finally {
        dom.analyticsDialogsExportBtn.disabled = false;
      }
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

    function getCommunityTimestampValue(community) {
      var raw =
        (community && (community.lastActivityAt || community.updatedAt || community.createdAt)) ||
        '';
      var timestamp = Date.parse(raw);
      return Number.isNaN(timestamp) ? 0 : timestamp;
    }

    function sortCommunities(items) {
      return (Array.isArray(items) ? items.slice() : []).sort(function (left, right) {
        return getCommunityTimestampValue(right) - getCommunityTimestampValue(left);
      });
    }

    function getSelectedCommunity() {
      if (!state.selectedCommunityId) {
        return null;
      }
      return (
        state.communities.find(function (community) {
          return community && community.id === state.selectedCommunityId;
        }) || null
      );
    }

    function normalizeCommunityMemberList(value) {
      return Array.isArray(value) ? value.filter(Boolean) : [];
    }

    function getCommunityFocusTags(community) {
      var focusTags = normalizeArray(community && community.focusTags);
      if (focusTags.length > 0) {
        return focusTags;
      }
      return normalizeArray(community && community.tags);
    }

    function normalizeCommunitySettingsText(value) {
      return String(value || '').trim();
    }

    function normalizeCommunitySettingsLogo(value) {
      var normalized = normalizeCommunitySettingsText(value);
      return normalized || null;
    }

    function normalizeCommunitySettingsTags(value) {
      return String(value || '')
        .split(',')
        .map(function (item) {
          return String(item || '').trim();
        })
        .filter(Boolean);
    }

    function areCommunitySettingsArraysEqual(left, right) {
      var normalizedLeft = normalizeArray(left);
      var normalizedRight = normalizeArray(right);
      if (normalizedLeft.length !== normalizedRight.length) {
        return false;
      }
      for (var index = 0; index < normalizedLeft.length; index += 1) {
        if (String(normalizedLeft[index]) !== String(normalizedRight[index])) {
          return false;
        }
      }
      return true;
    }

    function buildCommunitySettingsPayload(community, values) {
      var payload = {};
      var nextStatus = String(values.status || 'ACTIVE').trim().toUpperCase();
      var nextVisibility =
        nextStatus === 'HIDDEN' || nextStatus === 'PRIVATE' || nextStatus === 'PAUSED'
          ? 'CLOSED'
          : String(values.visibility || 'OPEN').trim().toUpperCase();
      var nextName = normalizeCommunitySettingsText(values.name);
      var nextCity = normalizeCommunitySettingsText(values.city);
      var nextJoinRule = String(values.joinRule || 'INSTANT').trim().toUpperCase();
      var nextMinimumLevel = normalizeCommunitySettingsText(values.minimumLevel);
      var nextVerified = Boolean(values.isVerified);
      var nextTags = normalizeCommunitySettingsTags(values.focusTags);
      var nextLogo = normalizeCommunitySettingsLogo(values.logo);
      var nextDescription = normalizeCommunitySettingsText(values.description);
      var nextRules = normalizeCommunitySettingsText(values.rules);

      if (nextName !== normalizeCommunitySettingsText(community && community.name)) {
        payload.name = nextName;
      }
      if (nextStatus !== String((community && community.status) || 'ACTIVE').trim().toUpperCase()) {
        payload.status = nextStatus;
      }
      if (
        nextVisibility !== String((community && community.visibility) || 'OPEN').trim().toUpperCase()
      ) {
        payload.visibility = nextVisibility;
      }
      if (nextCity !== normalizeCommunitySettingsText(community && community.city)) {
        payload.city = nextCity;
      }
      if (
        nextJoinRule !== String((community && community.joinRule) || 'INSTANT').trim().toUpperCase()
      ) {
        payload.joinRule = nextJoinRule;
      }
      if (
        nextMinimumLevel !==
        normalizeCommunitySettingsText(community && community.minimumLevel)
      ) {
        payload.minimumLevel = nextMinimumLevel;
      }
      if (nextVerified !== isCommunityVerified(community)) {
        payload.isVerified = nextVerified;
      }
      if (!areCommunitySettingsArraysEqual(nextTags, getCommunityFocusTags(community))) {
        payload.focusTags = nextTags;
      }
      if (nextLogo !== normalizeCommunitySettingsLogo(community && community.logo)) {
        payload.logo = nextLogo;
      }
      if (
        nextDescription !== normalizeCommunitySettingsText(community && community.description)
      ) {
        payload.description = nextDescription;
      }
      if (nextRules !== normalizeCommunitySettingsText(community && community.rules)) {
        payload.rules = nextRules;
      }
      return payload;
    }

    function getCommunityMemberKey(member) {
      if (!member) {
        return 'unknown';
      }
      if (member.id) {
        return 'id:' + String(member.id);
      }
      if (member.phone) {
        return 'phone:' + String(member.phone);
      }
      return 'name:' + String(member.name || 'member').trim().toLowerCase();
    }

    function buildCommunityManageKey(communityId, action, member) {
      return [communityId, action, getCommunityMemberKey(member)].join(':');
    }

    function replaceCommunityRecord(updatedCommunity) {
      if (!updatedCommunity || !updatedCommunity.id) {
        return;
      }
      var replaced = false;
      state.communities = sortCommunities(
        state.communities.map(function (community) {
          if (community && community.id === updatedCommunity.id) {
            replaced = true;
            return updatedCommunity;
          }
          return community;
        })
      );
      if (!replaced) {
        state.communities = sortCommunities(state.communities.concat([updatedCommunity]));
      }
      state.selectedCommunityId = updatedCommunity.id;
    }

    function clearCommunityCachedState(communityId) {
      var key = String(communityId || '');
      if (!key) {
        return;
      }
      delete state.communityFeedById[key];
      delete state.communityManagedFeedById[key];
      delete state.communityManagedFeedLoadedById[key];
      delete state.communityManagedFeedErrorById[key];
      delete state.communityFeedModerationById[key];
      delete state.communityFeedLoadedById[key];
      delete state.communityFeedErrorById[key];
      delete state.communityFeedHasMoreById[key];
      delete state.communityFeedNextBeforeTsById[key];
      delete state.communityChatById[key];
      delete state.communityChatLoadedById[key];
      delete state.communityChatErrorById[key];
      delete state.communityRankingById[key];
      delete state.communityRankingLoadedById[key];
      delete state.communityRankingErrorById[key];
    }

    function removeCommunityRecord(communityId) {
      var key = String(communityId || '');
      if (!key) {
        return;
      }
      state.communities = sortCommunities(
        state.communities.filter(function (community) {
          return String(community && community.id || '') !== key;
        })
      );
      clearCommunityCachedState(key);
      if (state.selectedCommunityId === key) {
        state.selectedCommunityId = state.communities.length > 0
          ? String(state.communities[0].id || '')
          : null;
      }
    }

    async function saveCommunitySettings(communityId, payload) {
      state.communitySavingId = communityId;
      renderCommunityDetails();
      try {
        var updatedCommunity = await api.updateCommunity(communityId, payload);
        replaceCommunityRecord(updatedCommunity);
        renderCommunities();
        setStatus('Параметры сообщества сохранены', false);
      } finally {
        state.communitySavingId = null;
        renderCommunityDetails();
      }
    }

    async function deleteCommunity(community) {
      var communityId = String(community && community.id || '');
      if (!communityId) {
        return;
      }
      var communityName = String(community && community.name || 'сообщество');
      if (!window.confirm('Удалить сообщество "' + communityName + '"? Это действие необратимо.')) {
        return;
      }
      state.communityDeletingId = communityId;
      renderCommunities();
      try {
        await api.deleteCommunity(communityId);
        removeCommunityRecord(communityId);
        setStatus('Сообщество удалено', false);
      } finally {
        if (state.communityDeletingId === communityId) {
          state.communityDeletingId = null;
        }
        renderCommunities();
      }
    }

    function extractManagedCommunityFeedItems(payload, community) {
      var items = Array.isArray(payload)
        ? payload
        : extractCommunityResponseArray(payload, ['items', 'data', 'result']);
      return normalizeArray(items)
        .map(function (item, index) {
          return normalizeCommunityFeedPostEntry(item, index, community);
        })
        .filter(Boolean);
    }

    function mergeCommunityFeedCollections(communityId, primary, secondary) {
      var map = Object.create(null);
      var suppressed = Object.create(null);
      normalizeArray(primary).forEach(function (item) {
        if (item && item.id) {
          if (isSuppressedCommunityFeedPost(item)) {
            suppressed[String(item.id)] = true;
            delete map[String(item.id)];
            return;
          }
          map[String(item.id)] = item;
        }
      });
      normalizeArray(secondary).forEach(function (item) {
        if (item && item.id && !map[String(item.id)] && !suppressed[String(item.id)]) {
          map[String(item.id)] = item;
        }
      });
      return Object.keys(map).map(function (key) {
        return map[key];
      });
    }

    async function refreshCommunityManagedFeed(community) {
      if (!community || !community.id) {
        return [];
      }
      var communityId = String(community.id);
      state.communityManagedFeedLoadingId = communityId;
      delete state.communityManagedFeedErrorById[communityId];
      renderCommunityDetails();
      try {
        var response = await api.getCommunityManagedFeed(communityId);
        var items = extractManagedCommunityFeedItems(response, community);
        state.communityManagedFeedById[communityId] = items;
        state.communityManagedFeedLoadedById[communityId] = true;
        delete state.communityManagedFeedErrorById[communityId];
        return items;
      } catch (error) {
        state.communityManagedFeedLoadedById[communityId] = true;
        state.communityManagedFeedErrorById[communityId] =
          error && error.message ? String(error.message) : 'Не удалось загрузить feed-карточки админки.';
        return [];
      } finally {
        if (state.communityManagedFeedLoadingId === communityId) {
          state.communityManagedFeedLoadingId = null;
        }
        renderCommunityDetails();
      }
    }

    async function createCommunityFeedItem(community, payload) {
      var communityId = String(community && community.id || '');
      if (!communityId) {
        return;
      }
      state.communityFeedCreatingId = communityId;
      renderCommunityDetails();
      try {
        await api.createCommunityFeedItem(communityId, payload);
        await refreshCommunityManagedFeed(community);
        setStatus('Карточка добавлена в админскую ленту сообщества', false);
      } finally {
        state.communityFeedCreatingId = null;
        renderCommunityDetails();
      }
    }

    function formatDateTimeLocalInputValue(value) {
      if (!value) {
        return '';
      }
      var d = new Date(value);
      if (Number.isNaN(d.getTime())) {
        return '';
      }
      var year = String(d.getFullYear());
      var month = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      var hours = String(d.getHours()).padStart(2, '0');
      var minutes = String(d.getMinutes()).padStart(2, '0');
      return year + '-' + month + '-' + day + 'T' + hours + ':' + minutes;
    }

    function collectCommunityFeedParticipants(rawValue) {
      return String(rawValue || '')
        .split(',')
        .map(function (item) {
          return String(item || '').trim();
        })
        .filter(Boolean)
        .map(function (name) {
          return { name: name };
        });
    }

    function collectCommunityFeedTags(rawValue) {
      return String(rawValue || '')
        .split(',')
        .map(function (item) {
          return String(item || '').trim();
        })
        .filter(Boolean);
    }

    function buildCommunityFeedFormPayload(fields) {
      return {
        kind: String(fields.kind.value || 'NEWS').trim().toUpperCase(),
        title: String(fields.title.value || '').trim(),
        body: String(fields.body.value || '').trim(),
        previewLabel: String(fields.preview.value || '').trim(),
        ctaLabel: String(fields.cta.value || '').trim(),
        imageUrl: String(fields.image.value || '').trim() || null,
        startAt: fields.start.value ? new Date(fields.start.value).toISOString() : undefined,
        endAt: fields.end.value ? new Date(fields.end.value).toISOString() : undefined,
        stationName: String(fields.station.value || '').trim(),
        courtName: String(fields.court.value || '').trim(),
        levelLabel: String(fields.level.value || '').trim(),
        authorName: String(fields.author.value || '').trim(),
        participants: collectCommunityFeedParticipants(fields.participants.value),
        tags: collectCommunityFeedTags(fields.tags.value)
      };
    }

    function isSameCommunityFeedFormValue(left, right) {
      if (Array.isArray(left) || Array.isArray(right)) {
        return JSON.stringify(normalizeArray(left)) === JSON.stringify(normalizeArray(right));
      }
      return left === right;
    }

    function buildCommunityFeedFormDiffPayload(initialPayload, nextPayload) {
      var payload = {};
      var keys = Object.keys(nextPayload);
      for (var i = 0; i < keys.length; i += 1) {
        var key = keys[i];
        if (!isSameCommunityFeedFormValue(initialPayload ? initialPayload[key] : undefined, nextPayload[key])) {
          payload[key] = nextPayload[key];
        }
      }
      return payload;
    }

    function closeCommunityFeedEditorModal() {
      state.communityFeedEditor = null;
      state.communityFeedEditingKey = null;
      dom.communityFeedEditorSaveBtn.disabled = false;
      dom.communityFeedEditorSaveBtn.textContent = 'Сохранить';
      dom.communityFeedEditorTitle.textContent = 'Редактировать публикацию';
      clearNode(dom.communityFeedEditorBody);
      dom.communityFeedEditorModal.classList.add('phab-admin-hidden');
    }

    function openCommunityFeedEditor(community, post) {
      if (!community || !post) {
        return;
      }
      if (isSyntheticCommunityFeedPost(post)) {
        state.communityCenterTab = 'settings';
        renderCommunityDetails();
        setStatus('Системные карточки редактируются через настройки сообщества.', false);
        return;
      }

      var feedItemId = getCommunityFeedPostPersistenceId(post);
      if (!feedItemId) {
        setStatus('Не удалось определить id публикации для редактирования.', true);
        return;
      }

      clearNode(dom.communityFeedEditorBody);
      dom.communityFeedEditorTitle.textContent = 'Редактировать публикацию';

      var form = document.createElement('div');
      form.className = 'phab-admin-community-form-grid';
      dom.communityFeedEditorBody.appendChild(form);

      var kindSelect = document.createElement('select');
      kindSelect.className = 'phab-admin-input';
      [
        { value: 'NEWS', label: 'Новость' },
        { value: 'GAME', label: 'Игра' },
        { value: 'TOURNAMENT', label: 'Турнир' },
        { value: 'EVENT', label: 'Событие' },
        { value: 'AD', label: 'Реклама / промо' }
      ].forEach(function (item) {
        var option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        kindSelect.appendChild(option);
      });
      kindSelect.value = String(post.kind || 'NEWS').trim().toUpperCase();
      appendCommunityFormField(form, 'Тип карточки', kindSelect);

      var titleInput = document.createElement('input');
      titleInput.className = 'phab-admin-input';
      titleInput.value = String(post.title || '');
      appendCommunityFormField(form, 'Заголовок', titleInput);

      var previewInput = document.createElement('input');
      previewInput.className = 'phab-admin-input';
      previewInput.value = String(post.previewLabel || '');
      appendCommunityFormField(form, 'Подпись / превью', previewInput);

      var ctaInput = document.createElement('input');
      ctaInput.className = 'phab-admin-input';
      ctaInput.value = String(post.ctaLabel || '');
      appendCommunityFormField(form, 'Текст CTA', ctaInput);

      var imageInput = document.createElement('input');
      imageInput.className = 'phab-admin-input';
      imageInput.value = String(post.imageUrl || '');
      appendCommunityFormField(form, 'Изображение', imageInput);

      var startInput = document.createElement('input');
      startInput.type = 'datetime-local';
      startInput.className = 'phab-admin-input';
      startInput.value = formatDateTimeLocalInputValue(post.startAt || post.publishedAt);
      appendCommunityFormField(form, 'Начало', startInput);

      var endInput = document.createElement('input');
      endInput.type = 'datetime-local';
      endInput.className = 'phab-admin-input';
      endInput.value = formatDateTimeLocalInputValue(post.endAt);
      appendCommunityFormField(form, 'Конец', endInput);

      var stationInput = document.createElement('input');
      stationInput.className = 'phab-admin-input';
      stationInput.value = String(post.stationName || community.stationName || community.stationId || '');
      appendCommunityFormField(form, 'Станция / клуб', stationInput);

      var courtInput = document.createElement('input');
      courtInput.className = 'phab-admin-input';
      courtInput.value = String(post.courtName || '');
      appendCommunityFormField(form, 'Корт / площадка', courtInput);

      var levelInput = document.createElement('input');
      levelInput.className = 'phab-admin-input';
      levelInput.value = String(post.levelLabel || '');
      appendCommunityFormField(form, 'Уровень', levelInput);

      var authorInput = document.createElement('input');
      authorInput.className = 'phab-admin-input';
      authorInput.value = String(post.authorName || '');
      appendCommunityFormField(form, 'Автор', authorInput);

      var participantsInput = document.createElement('textarea');
      participantsInput.className = 'phab-admin-input';
      participantsInput.rows = 3;
      participantsInput.value = normalizeArray(post.participants)
        .map(function (participant) {
          return String(participant && participant.name || '').trim();
        })
        .filter(Boolean)
        .join(', ');
      appendCommunityFormField(form, 'Участники', participantsInput, true);

      var tagsInput = document.createElement('input');
      tagsInput.className = 'phab-admin-input';
      tagsInput.value = normalizeArray(post.tags).join(', ');
      appendCommunityFormField(form, 'Теги', tagsInput, true);

      var bodyInput = document.createElement('textarea');
      bodyInput.className = 'phab-admin-input';
      bodyInput.rows = 6;
      bodyInput.value = String(post.body || '');
      appendCommunityFormField(form, 'Описание', bodyInput, true);

      state.communityFeedEditor = {
        communityId: String(community.id || ''),
        feedItemId: feedItemId,
        initialPayload: buildCommunityFeedFormPayload({
          kind: kindSelect,
          title: titleInput,
          preview: previewInput,
          cta: ctaInput,
          image: imageInput,
          start: startInput,
          end: endInput,
          station: stationInput,
          court: courtInput,
          level: levelInput,
          author: authorInput,
          participants: participantsInput,
          tags: tagsInput,
          body: bodyInput
        }),
        form: {
          kind: kindSelect,
          title: titleInput,
          preview: previewInput,
          cta: ctaInput,
          image: imageInput,
          start: startInput,
          end: endInput,
          station: stationInput,
          court: courtInput,
          level: levelInput,
          author: authorInput,
          participants: participantsInput,
          tags: tagsInput,
          body: bodyInput
        }
      };

      dom.communityFeedEditorModal.classList.remove('phab-admin-hidden');
      window.setTimeout(function () {
        titleInput.focus();
        titleInput.select();
      }, 0);
    }

    async function saveCommunityFeedEditor() {
      var editor = state.communityFeedEditor;
      if (!editor || !editor.form) {
        return;
      }

      var communityId = String(editor.communityId || '');
      var feedItemId = String(editor.feedItemId || '');
      var community = state.communities.find(function (item) {
        return String(item && item.id || '') === communityId;
      }) || null;
      if (!communityId || !feedItemId || !community) {
        throw new Error('Не удалось определить сообщество или публикацию для сохранения.');
      }

      var nextPayload = buildCommunityFeedFormPayload(editor.form);
      if (!nextPayload.title) {
        throw new Error('Укажите заголовок публикации.');
      }
      var payload = buildCommunityFeedFormDiffPayload(editor.initialPayload || {}, nextPayload);
      if (!Object.keys(payload).length) {
        setStatus('Изменений нет', false);
        return;
      }

      var editingKey = communityId + ':' + feedItemId;
      state.communityFeedEditingKey = editingKey;
      dom.communityFeedEditorSaveBtn.disabled = true;
      dom.communityFeedEditorSaveBtn.textContent = 'Сохраняем...';
      try {
        await api.updateCommunityFeedItem(communityId, feedItemId, payload);
        await refreshCommunityManagedFeed(community);
        setStatus('Публикация обновлена', false);
        closeCommunityFeedEditorModal();
        renderCommunityDetails();
      } finally {
        if (state.communityFeedEditingKey === editingKey) {
          state.communityFeedEditingKey = null;
        }
        if (!state.communityFeedEditor) {
          return;
        }
        dom.communityFeedEditorSaveBtn.disabled = false;
        dom.communityFeedEditorSaveBtn.textContent = 'Сохранить';
      }
    }

    function getCommunityFeedPostPersistenceId(post) {
      return String(
        (post && (post.persistedId || post.id)) || ''
      ).trim();
    }

    function isSuppressedCommunityFeedPost(post) {
      var raw = normalizeObject(post && post.raw);
      var details = normalizeObject(raw.details);
      var status = String((post && post.status) || raw.status || '').trim().toUpperCase();
      return Boolean(
        raw.suppressed === true ||
        details.suppressed === true ||
        details.moderationAction === 'DELETE' ||
        (status === 'HIDDEN' &&
          (raw.source === 'COMMUNITY_MODERATION' || details.source === 'COMMUNITY_MODERATION'))
      );
    }

    function isSyntheticCommunityFeedPost(post) {
      if (!post) {
        return true;
      }
      if (post.synthetic === true) {
        return true;
      }
      return !getCommunityFeedPostPersistenceId(post);
    }

    function isAdminManagedCommunityPost(community, post) {
      var raw = normalizeObject(post && post.raw);
      var communityId = String(community && community.id || '');
      var postId = String(post && post.id || '');
      var managedFeed = normalizeArray(state.communityManagedFeedById[communityId]);
      var existsInManagedFeed = managedFeed.some(function (item) {
        return item && String(item.id || '') === postId;
      });
      return Boolean(
        existsInManagedFeed ||
        raw.source === 'ADMIN_PANEL' ||
        raw.createdBy ||
        raw.feedItemId ||
        raw.itemId ||
        (raw.details && raw.details.source === 'ADMIN_PANEL')
      );
    }

    async function deleteCommunityFeedItem(community, post) {
      var communityId = String(community && community.id || '');
      var postId = getCommunityFeedPostPersistenceId(post);
      var localPostId = String(post && post.id || '');
      if (!communityId || !postId) {
        return;
      }
      state.communityFeedCreatingId = communityId;
      renderCommunityDetails();
      try {
        var response = await api.deleteCommunityFeedItem(communityId, postId);
        if (Array.isArray(state.communityManagedFeedById[communityId])) {
          state.communityManagedFeedById[communityId] = state.communityManagedFeedById[communityId].filter(function (item) {
            return String(item && item.id || '') !== localPostId;
          });
        }
        if (Array.isArray(state.communityFeedById[communityId])) {
          state.communityFeedById[communityId] = state.communityFeedById[communityId].filter(function (item) {
            return String(item && item.id || '') !== localPostId;
          });
        }
        if (state.communityFeedModerationById[communityId]) {
          delete state.communityFeedModerationById[communityId][localPostId];
        }
        await refreshCommunityManagedFeed(community);
        setStatus(
          response && response.mode === 'suppressed'
            ? 'Карточка скрыта модерацией из ленты сообщества'
            : 'Карточка удалена из сообщества',
          false
        );
      } finally {
        state.communityFeedCreatingId = null;
        renderCommunityDetails();
      }
    }

    function getCommunityFeedModerationBucket(communityId) {
      var key = String(communityId || '');
      if (!key) {
        return Object.create(null);
      }
      if (!state.communityFeedModerationById[key]) {
        state.communityFeedModerationById[key] = Object.create(null);
      }
      return state.communityFeedModerationById[key];
    }

    function getCommunityFeedModerationState(communityId, postId) {
      var bucket = getCommunityFeedModerationBucket(communityId);
      return normalizeObject(bucket[String(postId || '')]);
    }

    function setCommunityFeedModerationState(communityId, postId, patch, statusText) {
      var bucket = getCommunityFeedModerationBucket(communityId);
      var key = String(postId || '');
      var current = normalizeObject(bucket[key]);
      bucket[key] = Object.assign({}, current, patch || {});
      renderCommunityDetails();
      if (statusText) {
        setStatus(statusText + ' в окне модерации', false);
      }
    }

    function applyCommunityFeedModeration(communityId, posts) {
      return normalizeArray(posts)
        .map(function (post) {
          var moderation = getCommunityFeedModerationState(communityId, post && post.id);
          return Object.assign({}, post, { moderation: moderation });
        })
        .filter(function (post) {
          return normalizeObject(post && post.moderation).removed !== true;
        })
        .sort(function (left, right) {
          var leftState = normalizeObject(left.moderation);
          var rightState = normalizeObject(right.moderation);
          var leftWeight =
            (Number(left.priority || 0) * 24) +
            (leftState.pinned ? 1000 : 0) +
            (leftState.promoted ? 240 : 0) +
            (Number(leftState.rank || 0) * 12) -
            (leftState.hidden ? 2000 : 0) -
            (leftState.removed ? 4000 : 0);
          var rightWeight =
            (Number(right.priority || 0) * 24) +
            (rightState.pinned ? 1000 : 0) +
            (rightState.promoted ? 240 : 0) +
            (Number(rightState.rank || 0) * 12) -
            (rightState.hidden ? 2000 : 0) -
            (rightState.removed ? 4000 : 0);
          if (rightWeight !== leftWeight) {
            return rightWeight - leftWeight;
          }
          return getCommunityTimestampValue({ lastActivityAt: right.publishedAt }) -
            getCommunityTimestampValue({ lastActivityAt: left.publishedAt });
        });
    }

    async function submitCommunityMemberAction(communityId, action, member, successText) {
      var managingKey = buildCommunityManageKey(communityId, action, member);
      state.communityManagingKey = managingKey;
      renderCommunityDetails();
      try {
        var updatedCommunity = await api.manageCommunityMember(communityId, {
          action: action,
          member: {
            id: member && member.id ? String(member.id) : undefined,
            phone: member && member.phone ? String(member.phone) : undefined,
            name: member && member.name ? String(member.name) : undefined,
            avatar:
              member && Object.prototype.hasOwnProperty.call(member, 'avatar')
                ? member.avatar
                : undefined,
            role: member && member.role ? String(member.role) : undefined,
            status: member && member.status ? String(member.status) : undefined,
            levelScore:
              member && typeof member.levelScore === 'number'
                ? Number(member.levelScore)
                : undefined,
            levelLabel: member && member.levelLabel ? String(member.levelLabel) : undefined,
            joinedAt: member && member.joinedAt ? String(member.joinedAt) : undefined
          }
        });
        replaceCommunityRecord(updatedCommunity);
        renderCommunities();
        setStatus(successText, false);
      } finally {
        state.communityManagingKey = null;
        renderCommunityDetails();
      }
    }

    function matchCommunitySearch(community, query) {
      var normalizedQuery = String(query || '').trim().toLowerCase();
      if (!normalizedQuery) {
        return true;
      }

      var haystack = [
        community && community.name,
        community && community.slug,
        community && community.description,
        community && community.stationName,
        community && community.stationId,
        community && community.visibility,
        community && community.rawStatus,
        community && community.status,
        Array.isArray(community && community.focusTags) ? community.focusTags.join(' ') : '',
        Array.isArray(community && community.tags) ? community.tags.join(' ') : ''
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.indexOf(normalizedQuery) >= 0;
    }

    function normalizeCommunityCount(value) {
      var parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function normalizeCommunityFeedPhone(value) {
      var digits = String(value || '').replace(/\D+/g, '');
      if (!digits) {
        return '';
      }
      if (digits.length === 10) {
        return '7' + digits;
      }
      if (digits.length === 11 && digits.charAt(0) === '8') {
        return '7' + digits.slice(1);
      }
      return digits;
    }

    function toCommunityText(value) {
      if (typeof value === 'string') {
        var normalized = value.trim();
        return normalized || null;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
      return null;
    }

    function toCommunityNumber(value) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string') {
        var normalized = value.trim().replace(',', '.');
        if (!normalized) {
          return null;
        }
        var parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    }

    function pickCommunityRecordText(source, keys) {
      var record = normalizeObject(source);
      for (var i = 0; i < keys.length; i += 1) {
        var candidate = toCommunityText(record[keys[i]]);
        if (candidate) {
          return candidate;
        }
      }
      return null;
    }

    function pickCommunityRecordNumber(source, keys) {
      var record = normalizeObject(source);
      for (var i = 0; i < keys.length; i += 1) {
        var candidate = toCommunityNumber(record[keys[i]]);
        if (candidate !== null) {
          return candidate;
        }
      }
      return null;
    }

    function pickCommunityRecordsText(sources, keys) {
      var list = normalizeArray(sources);
      for (var i = 0; i < list.length; i += 1) {
        var candidate = pickCommunityRecordText(list[i], keys);
        if (candidate) {
          return candidate;
        }
      }
      return null;
    }

    function pickCommunityRecordsNumber(sources, keys) {
      var list = normalizeArray(sources);
      for (var i = 0; i < list.length; i += 1) {
        var candidate = pickCommunityRecordNumber(list[i], keys);
        if (candidate !== null) {
          return candidate;
        }
      }
      return null;
    }

    function extractCommunityResponseArray(payload, keys) {
      if (Array.isArray(payload)) {
        return payload;
      }
      var record = normalizeObject(payload);
      for (var i = 0; i < keys.length; i += 1) {
        var value = record[keys[i]];
        if (Array.isArray(value)) {
          return value;
        }
      }
      return [];
    }

    function getCommunityPostKindLabel(kind) {
      var normalized = String(kind || '').trim().toUpperCase();
      if (
        normalized === 'AD' ||
        normalized === 'ADS' ||
        normalized === 'PROMO' ||
        normalized === 'ADVERTISEMENT' ||
        normalized === 'BANNER'
      ) {
        return 'Реклама';
      }
      if (normalized === 'NEWS') {
        return 'Новости';
      }
      if (normalized === 'GAME') {
        return 'Игра';
      }
      if (normalized === 'TOURNAMENT') {
        return 'Турнир';
      }
      if (normalized === 'EVENT') {
        return 'Событие';
      }
      if (normalized === 'PHOTO') {
        return 'Публикация';
      }
      if (normalized === 'SYSTEM') {
        return 'Новости';
      }
      return toCommunityText(kind) || 'Лента';
    }

    function normalizeCommunityFeedKind(kind) {
      var normalized = String(kind || '').trim().toUpperCase();
      if (
        normalized === 'AD' ||
        normalized === 'ADS' ||
        normalized === 'PROMO' ||
        normalized === 'ADVERTISEMENT' ||
        normalized === 'BANNER'
      ) {
        return 'AD';
      }
      if (
        normalized === 'PHOTO' ||
        normalized === 'POST' ||
        normalized === 'SYSTEM' ||
        normalized === 'NEWS'
      ) {
        return 'NEWS';
      }
      if (normalized === 'GAME' || normalized === 'TOURNAMENT' || normalized === 'EVENT') {
        return normalized;
      }
      return 'NEWS';
    }

    function isCommunityMemberJoinFeedEntry(source, title, body) {
      var record = normalizeObject(source);
      var normalizedAction = String(
        pickCommunityRecordText(record, [
          'actionType',
          'eventType',
          'systemType',
          'notificationType',
          'activityType',
          'type',
          'kind'
        ]) || ''
      )
        .trim()
        .toUpperCase();

      if (
        normalizedAction === 'MEMBER_JOINED' ||
        normalizedAction === 'JOINED_COMMUNITY' ||
        normalizedAction === 'COMMUNITY_MEMBER_JOINED' ||
        normalizedAction === 'NEW_MEMBER' ||
        normalizedAction === 'NEW_PARTICIPANT'
      ) {
        return true;
      }

      var normalizedText = String([title, body].filter(Boolean).join(' ')).toLowerCase();
      return (
        normalizedText.indexOf('новый участник') !== -1 ||
        normalizedText.indexOf('вступил в сообщество') !== -1 ||
        normalizedText.indexOf('вступила в сообщество') !== -1 ||
        normalizedText.indexOf('присоединился к сообществу') !== -1 ||
        normalizedText.indexOf('присоединилась к сообществу') !== -1
      );
    }

    function normalizeCommunityPreviewParticipants(value) {
      return normalizeArray(value)
        .map(function (item, index) {
          if (!item) {
            return null;
          }
          if (typeof item === 'string') {
            return {
              id: 'participant-' + String(index),
              name: item,
              avatar: '',
              shortName: getCommunityIdentityLetter({ name: item })
            };
          }
          var source = normalizeObject(item);
          var name =
            pickCommunityRecordText(source, ['name', 'displayName', 'fullName']) ||
            pickCommunityRecordText(source.user, ['name', 'displayName', 'fullName']) ||
            pickCommunityRecordText(source.member, ['name', 'displayName', 'fullName']);
          if (!name) {
            return null;
          }
          return {
            id:
              pickCommunityRecordText(source, ['id', 'clientId', 'userId', 'uuid']) ||
              'participant-' + String(index),
            name: name,
            avatar:
              pickCommunityRecordText(source, ['avatar', 'avatarUrl', 'photo']) ||
              pickCommunityRecordText(source.user, ['avatar', 'avatarUrl', 'photo']) ||
              '',
            shortName: getCommunityIdentityLetter({ name: name })
          };
        })
        .filter(Boolean)
        .slice(0, 4);
    }

    function normalizeCommunityFeedPostEntry(value, index, community) {
      var source = normalizeObject(value);
      var eventSource = normalizeObject(source.event || source.game || source.match || source.tournament);
      var venueSource = normalizeObject(source.venue || source.location || source.place);
      var sources = [source, eventSource, venueSource];
      var persistedId =
        pickCommunityRecordText(source, ['id', 'postId', 'uuid', 'feedItemId', 'itemId']) || '';
      var kindSource =
        pickCommunityRecordText(source, ['kind', 'type', 'cardType', 'module', 'placementType']) ||
        (source.isAdvertisement === true || source.ad === true || source.promo === true ? 'AD' : null) ||
        'PHOTO';
      var kind = normalizeCommunityFeedKind(kindSource);
      var title =
        pickCommunityRecordsText(sources, ['title', 'name', 'header']) ||
        pickCommunityRecordsText(sources, ['body', 'text', 'description']) ||
        'Публикация сообщества';
      var body =
        pickCommunityRecordsText(sources, ['body', 'text', 'description', 'content']) || '';
      if (isCommunityMemberJoinFeedEntry(source, title, body)) {
        kind = 'EVENT';
      }
      var author =
        pickCommunityRecordsText(sources, ['authorName', 'memberName']) ||
        pickCommunityRecordText(source.author, ['name', 'displayName']) ||
        pickCommunityRecordText(source.memberPreview, ['name', 'displayName']) ||
        (community.createdBy && (community.createdBy.name || community.createdBy.phone || community.createdBy.id)) ||
        'Участник';
      var participants = normalizeCommunityPreviewParticipants(source.participants);
      if (participants.length === 0) {
        participants = normalizeCommunityPreviewParticipants(source.players);
      }
      if (participants.length === 0) {
        participants = normalizeCommunityPreviewParticipants(eventSource.participants);
      }
      if (participants.length === 0) {
        participants = normalizeCommunityPreviewParticipants(source.members);
      }
      return {
        id: persistedId || String((community && community.id) || 'community') + ':post:' + String(index),
        persistedId: persistedId || undefined,
        kind: kind,
        status: pickCommunityRecordText(source, ['status']) || undefined,
        kicker: getCommunityPostKindLabel(kind),
        title: title,
        body: body,
        authorName: String(author),
        publishedAt:
          pickCommunityRecordsText(sources, ['publishedAt', 'createdAt', 'updatedAt']) ||
          String((community && (community.updatedAt || community.createdAt)) || ''),
        startAt:
          pickCommunityRecordsText(sources, ['startAt', 'startsAt', 'eventAt', 'beginsAt']) ||
          '',
        endAt:
          pickCommunityRecordsText(sources, ['endAt', 'endsAt', 'finishAt', 'endsOn']) ||
          '',
        stationName:
          pickCommunityRecordsText(sources, ['stationName', 'clubName', 'locationName']) ||
          String((community && (community.stationName || community.stationId)) || ''),
        courtName:
          pickCommunityRecordsText(sources, ['courtName', 'court', 'courtLabel', 'venueName']) || '',
        levelLabel:
          pickCommunityRecordsText(sources, ['levelLabel', 'rating', 'level']) || '',
        priority:
          normalizeCommunityCount(
            pickCommunityRecordsNumber(sources, ['priority', 'sortOrder', 'weight'])
          ) || 0,
        reportsCount:
          normalizeCommunityCount(
            pickCommunityRecordsNumber(sources, [
              'reportsCount',
              'complaintsCount',
              'flagsCount'
            ])
          ) || 0,
        likesCount:
          normalizeCommunityCount(
            pickCommunityRecordsNumber(sources, [
              'likesCount',
              'likes',
              'reactionsCount',
              'heartsCount'
            ])
          ) || 0,
        commentsCount:
          normalizeCommunityCount(
            pickCommunityRecordsNumber(sources, [
              'commentsCount',
              'comments',
              'repliesCount',
              'messagesCount'
            ])
          ) || 0,
        isAdvertisement:
          source.isAdvertisement === true ||
          source.ad === true ||
          source.promo === true ||
          kind === 'AD',
        imageUrl: pickCommunityRecordText(source, ['imageUrl', 'image', 'photo']),
        previewLabel: pickCommunityRecordText(source, ['previewLabel', 'preview', 'label']),
        ctaLabel:
          pickCommunityRecordText(source, ['ctaLabel', 'actionLabel', 'buttonLabel']) ||
          (kind === 'GAME'
            ? 'Внести результаты игры'
            : kind === 'TOURNAMENT' || kind === 'EVENT'
              ? 'Открыть событие'
              : kind === 'AD'
                ? 'Открыть'
              : 'Открыть'),
        participants: participants,
        raw: source
      };
    }

    function normalizeCommunityRankingEntry(value, index) {
      var source = normalizeObject(value);
      var name =
        pickCommunityRecordText(source, ['name', 'playerName', 'displayName']) || null;
      if (!name) {
        return null;
      }
      return {
        id: pickCommunityRecordText(source, ['id', 'clientId', 'userId', 'uuid']) || 'row-' + index,
        name: name,
        role: pickCommunityRecordText(source, ['role']) || 'MEMBER',
        levelLabel: pickCommunityRecordText(source, ['levelLabel', 'rating', 'level']) || 'C',
        score:
          normalizeCommunityCount(
            pickCommunityRecordNumber(source, [
              'score',
              'ratingScore',
              'overallPlace',
              'place',
              'position',
              'levelScore'
            ])
          ) || 0
      };
    }

    function extractCommunityFeedPosts(payload, community) {
      return extractCommunityResponseArray(payload, ['posts', 'items', 'data', 'result'])
        .map(function (item, index) {
          return normalizeCommunityFeedPostEntry(item, index, community);
        })
        .filter(Boolean)
        .sort(function (left, right) {
          return getCommunityTimestampValue({ lastActivityAt: right.publishedAt }) -
            getCommunityTimestampValue({ lastActivityAt: left.publishedAt });
        });
    }

    function extractCommunityFeedMeta(payload, posts, requestedLimit) {
      var record = normalizeObject(payload);
      var explicitHasMore = typeof record.hasMore === 'boolean' ? record.hasMore : null;
      var explicitNextBeforeTs =
        normalizeCommunityCount(record.nextBeforeTs) ||
        normalizeCommunityCount(record.nextBefore) ||
        null;
      var inferredNextBeforeTs = null;
      if (Array.isArray(posts) && posts.length > 0) {
        inferredNextBeforeTs = getCommunityTimestampValue({
          lastActivityAt: posts[posts.length - 1].publishedAt || posts[posts.length - 1].createdAt || ''
        });
        if (!inferredNextBeforeTs) {
          inferredNextBeforeTs = null;
        }
      }
      var fallbackHasMore =
        Array.isArray(posts) &&
        posts.length >= Math.max(1, Number(requestedLimit || COMMUNITY_FEED_PREVIEW_LIMIT));
      return {
        hasMore: explicitHasMore !== null ? explicitHasMore : Boolean(fallbackHasMore && inferredNextBeforeTs),
        nextBeforeTs: explicitNextBeforeTs || inferredNextBeforeTs || null
      };
    }

    function mergeCommunityFeedPages(existing, incoming) {
      var byId = Object.create(null);
      normalizeArray(existing).forEach(function (item) {
        if (item && item.id) {
          byId[String(item.id)] = item;
        }
      });
      normalizeArray(incoming).forEach(function (item) {
        if (!item || !item.id) {
          return;
        }
        byId[String(item.id)] = item;
      });
      return Object.keys(byId)
        .map(function (key) {
          return byId[key];
        })
        .sort(function (left, right) {
          return getCommunityTimestampValue({ lastActivityAt: right.publishedAt }) -
            getCommunityTimestampValue({ lastActivityAt: left.publishedAt });
        });
    }

    function normalizeCommunityChatMessageEntry(value, index, community) {
      var source = normalizeObject(value);
      var author = normalizeObject(source.author || source.sender);
      var text =
        pickCommunityRecordText(source, ['text', 'body', 'message', 'description']) || '';
      if (!text) {
        return null;
      }
      return {
        id: pickCommunityRecordText(source, ['id', 'messageId', 'uuid']) || 'msg-' + index,
        communityId:
          pickCommunityRecordText(source, ['communityId']) || String((community && community.id) || ''),
        authorId:
          pickCommunityRecordText(source, ['authorId']) ||
          pickCommunityRecordText(author, ['id', 'clientId', 'userId', 'uuid']) ||
          '',
        authorPhone:
          normalizeCommunityFeedPhone(
            source.authorPhone || author.phone || author.phoneNorm || author.phoneNumber || author.mobile
          ) || '',
        authorName:
          pickCommunityRecordText(source, ['authorName']) ||
          pickCommunityRecordText(author, ['name', 'displayName', 'fullName']) ||
          'Игрок',
        authorAvatar:
          pickCommunityRecordText(source, ['authorAvatar']) ||
          pickCommunityRecordText(author, ['avatar', 'photo', 'imageUrl']) ||
          '',
        text: text,
        createdAt:
          pickCommunityRecordText(source, ['createdAt', 'publishedAt']) ||
          String((community && (community.updatedAt || community.createdAt)) || ''),
        flagged: Boolean(source.flagged || source.reported || source.suspicious),
        reportsCount:
          normalizeCommunityCount(
            pickCommunityRecordNumber(source, ['reportsCount', 'complaintsCount', 'flagsCount'])
          ) || 0,
        raw: source
      };
    }

    function extractCommunityChatMessages(payload, community) {
      return extractCommunityResponseArray(payload, ['messages', 'items', 'data', 'result'])
        .map(function (item, index) {
          return normalizeCommunityChatMessageEntry(item, index, community);
        })
        .filter(Boolean)
        .sort(function (left, right) {
          return getCommunityTimestampValue({ lastActivityAt: left.createdAt }) -
            getCommunityTimestampValue({ lastActivityAt: right.createdAt });
        });
    }

    function extractCommunityRankingRows(payload) {
      var rowsSource = normalizeObject(payload).rows || payload;
      return extractCommunityResponseArray(rowsSource, ['rows', 'items', 'data', 'result'])
        .map(function (item, index) {
          return normalizeCommunityRankingEntry(item, index);
        })
        .filter(Boolean);
    }

    function resolveCommunityAccessIdentity(community) {
      var createdBy = normalizeObject(community && community.createdBy);
      var createdByPhone = normalizeCommunityFeedPhone(createdBy.phone);
      var createdById = toCommunityText(createdBy.id);
      if (createdByPhone || createdById) {
        return {
          phone: createdByPhone || undefined,
          clientId: createdById || undefined
        };
      }

      var members = normalizeCommunityMemberList(community && community.members);
      var preferredMember = members.find(function (member) {
        var role = String(member.role || '').toUpperCase();
        return role === 'OWNER' || role === 'ADMIN';
      }) || members[0];

      if (!preferredMember) {
        return null;
      }

      var memberPhone = normalizeCommunityFeedPhone(preferredMember.phone);
      var memberId = toCommunityText(preferredMember.id);
      if (!memberPhone && !memberId) {
        return null;
      }

      return {
        phone: memberPhone || undefined,
        clientId: memberId || undefined
      };
    }

    async function ensureCommunityLiveData(community) {
      if (!community || !community.id) {
        return;
      }

      var communityId = String(community.id);
      var needsFeed =
        !state.communityFeedLoadedById[communityId] && state.communityFeedLoadingId !== communityId;
      var needsChat =
        !state.communityChatLoadedById[communityId] && state.communityChatLoadingId !== communityId;
      var needsManagedFeed =
        !state.communityManagedFeedLoadedById[communityId] &&
        state.communityManagedFeedLoadingId !== communityId;
      var needsRanking =
        !state.communityRankingLoadedById[communityId] &&
        state.communityRankingLoadingId !== communityId;

      if (!needsFeed && !needsChat && !needsRanking && !needsManagedFeed) {
        return;
      }

      var identity = resolveCommunityAccessIdentity(community);
      var hasIdentity = Boolean(identity && (identity.phone || identity.clientId));
      if (!hasIdentity && !needsManagedFeed) {
        if (needsFeed) {
          state.communityFeedLoadedById[communityId] = true;
          state.communityFeedErrorById[communityId] =
            'Не удалось определить phone/clientId для загрузки живой ленты.';
        }
        if (needsChat) {
          state.communityChatLoadedById[communityId] = true;
          state.communityChatErrorById[communityId] =
            'Не удалось определить phone/clientId для загрузки чата сообщества.';
        }
        if (needsRanking) {
          state.communityRankingLoadedById[communityId] = true;
          state.communityRankingErrorById[communityId] =
            'Не удалось определить phone/clientId для загрузки рейтинга.';
        }
        renderCommunityDetails();
        return;
      }

      if (needsFeed) {
        state.communityFeedLoadingId = communityId;
        delete state.communityFeedErrorById[communityId];
      }
      if (needsChat) {
        state.communityChatLoadingId = communityId;
        delete state.communityChatErrorById[communityId];
      }
      if (needsManagedFeed) {
        state.communityManagedFeedLoadingId = communityId;
        delete state.communityManagedFeedErrorById[communityId];
      }
      if (needsRanking) {
        state.communityRankingLoadingId = communityId;
        delete state.communityRankingErrorById[communityId];
      }
      renderCommunityDetails();

      try {
        var feedPromise = needsFeed
          ? hasIdentity
            ? api.getCommunityFeed(communityId, {
                phone: identity.phone,
                clientId: identity.clientId,
                limit: COMMUNITY_FEED_PREVIEW_LIMIT
              })
            : Promise.reject(new Error('Не удалось определить phone/clientId для загрузки живой ленты.'))
          : Promise.resolve(null);
        var chatPromise = needsChat
          ? hasIdentity
            ? api.getCommunityChatMessages(communityId, {
                phone: identity.phone,
                clientId: identity.clientId,
                limit: COMMUNITY_CHAT_PREVIEW_LIMIT
              })
            : Promise.reject(new Error('Не удалось определить phone/clientId для загрузки чата сообщества.'))
          : Promise.resolve(null);
        var rankingPromise = needsRanking
          ? hasIdentity
            ? api.getCommunityRanking(communityId, {
                phone: identity.phone,
                clientId: identity.clientId
              })
            : Promise.reject(new Error('Не удалось определить phone/clientId для загрузки рейтинга.'))
          : Promise.resolve(null);
        var managedFeedPromise = needsManagedFeed
          ? api.getCommunityManagedFeed(communityId)
          : Promise.resolve(null);

        var results = await Promise.allSettled([
          feedPromise,
          chatPromise,
          rankingPromise,
          managedFeedPromise
        ]);
        var feedResult = results[0];
        var chatResult = results[1];
        var rankingResult = results[2];
        var managedFeedResult = results[3];

        if (needsFeed) {
          state.communityFeedLoadedById[communityId] = true;
          if (feedResult.status === 'fulfilled') {
            var feedPosts = extractCommunityFeedPosts(feedResult.value, community);
            var feedMeta = extractCommunityFeedMeta(
              feedResult.value,
              feedPosts,
              COMMUNITY_FEED_PREVIEW_LIMIT
            );
            state.communityFeedById[communityId] = feedPosts;
            state.communityFeedHasMoreById[communityId] = feedMeta.hasMore;
            state.communityFeedNextBeforeTsById[communityId] = feedMeta.nextBeforeTs;
            delete state.communityFeedErrorById[communityId];
          } else {
            state.communityFeedErrorById[communityId] =
              feedResult.reason && feedResult.reason.message
                ? String(feedResult.reason.message)
                : 'Не удалось загрузить живую ленту сообщества.';
          }
        }

        if (needsChat) {
          state.communityChatLoadedById[communityId] = true;
          if (chatResult.status === 'fulfilled') {
            state.communityChatById[communityId] = extractCommunityChatMessages(chatResult.value, community);
            delete state.communityChatErrorById[communityId];
          } else {
            state.communityChatErrorById[communityId] =
              chatResult.reason && chatResult.reason.message
                ? String(chatResult.reason.message)
                : 'Не удалось загрузить чат сообщества.';
          }
        }

        if (needsRanking) {
          state.communityRankingLoadedById[communityId] = true;
          if (rankingResult.status === 'fulfilled') {
            state.communityRankingById[communityId] = extractCommunityRankingRows(rankingResult.value);
            delete state.communityRankingErrorById[communityId];
          } else {
            state.communityRankingErrorById[communityId] =
              rankingResult.reason && rankingResult.reason.message
                ? String(rankingResult.reason.message)
                : 'Не удалось загрузить рейтинг сообщества.';
          }
        }

        if (needsManagedFeed) {
          state.communityManagedFeedLoadedById[communityId] = true;
          if (managedFeedResult.status === 'fulfilled') {
            state.communityManagedFeedById[communityId] =
              extractManagedCommunityFeedItems(managedFeedResult.value, community);
            delete state.communityManagedFeedErrorById[communityId];
          } else {
            state.communityManagedFeedErrorById[communityId] =
              managedFeedResult.reason && managedFeedResult.reason.message
                ? String(managedFeedResult.reason.message)
                : 'Не удалось загрузить карточки админской ленты.';
          }
        }
      } finally {
        if (state.communityFeedLoadingId === communityId) {
          state.communityFeedLoadingId = null;
        }
        if (state.communityChatLoadingId === communityId) {
          state.communityChatLoadingId = null;
        }
        if (state.communityManagedFeedLoadingId === communityId) {
          state.communityManagedFeedLoadingId = null;
        }
        if (state.communityRankingLoadingId === communityId) {
          state.communityRankingLoadingId = null;
        }
        renderCommunityDetails();
      }
    }

    async function loadMoreCommunityFeed(community) {
      if (!community || !community.id) {
        return;
      }
      var communityId = String(community.id);
      if (
        state.communityFeedLoadingId === communityId ||
        state.communityFeedLoadingMoreId === communityId ||
        state.communityFeedHasMoreById[communityId] !== true
      ) {
        return;
      }

      var beforeTs = Number(state.communityFeedNextBeforeTsById[communityId] || 0);
      if (!Number.isFinite(beforeTs) || beforeTs <= 0) {
        state.communityFeedHasMoreById[communityId] = false;
        return;
      }

      var identity = resolveCommunityAccessIdentity(community);
      if (!identity || (!identity.phone && !identity.clientId)) {
        state.communityFeedErrorById[communityId] =
          'Не удалось определить phone/clientId для догрузки ленты.';
        renderCommunityDetails();
        return;
      }

      state.communityFeedLoadingMoreId = communityId;
      renderCommunityDetails();
      try {
        var response = await api.getCommunityFeed(communityId, {
          phone: identity.phone,
          clientId: identity.clientId,
          limit: COMMUNITY_FEED_PREVIEW_LIMIT,
          beforeTs: beforeTs
        });
        var nextPosts = extractCommunityFeedPosts(response, community);
        var meta = extractCommunityFeedMeta(response, nextPosts, COMMUNITY_FEED_PREVIEW_LIMIT);
        state.communityFeedById[communityId] = mergeCommunityFeedPages(
          state.communityFeedById[communityId],
          nextPosts
        );
        state.communityFeedHasMoreById[communityId] = meta.hasMore;
        state.communityFeedNextBeforeTsById[communityId] = meta.nextBeforeTs;
        delete state.communityFeedErrorById[communityId];
      } catch (error) {
        state.communityFeedErrorById[communityId] =
          error && error.message ? String(error.message) : 'Не удалось догрузить ленту сообщества.';
      } finally {
        if (state.communityFeedLoadingMoreId === communityId) {
          state.communityFeedLoadingMoreId = null;
        }
        renderCommunityDetails();
      }
    }

    function maybeLoadMoreCommunityFeedFromScroll(container) {
      if (!container || state.activeTab !== 'communities') {
        return;
      }
      var community = getSelectedCommunity();
      if (!community) {
        return;
      }
      var allowPreview =
        (container === dom.communityPreviewBody || container === dom.communitiesPreviewPane) &&
        String(state.communityPreviewTab || 'feed') === 'feed';
      var allowCenter =
        (container === dom.communityAdminGrid || container === dom.communitiesDetailPane) &&
        String(state.communityCenterTab || 'overview') === 'content';
      if (!allowPreview && !allowCenter) {
        return;
      }
      var distanceToBottom =
        container.scrollHeight - container.clientHeight - container.scrollTop;
      if (distanceToBottom > 220) {
        return;
      }
      loadMoreCommunityFeed(community).catch(handleError);
    }

    function pickCommunityStringValue(community, keys) {
      var details = normalizeObject(community && community.details);
      var nested = [
        normalizeObject(details.summary),
        normalizeObject(details.preview),
        normalizeObject(details.moderation),
        normalizeObject(details.feed),
        normalizeObject(details.chat),
        normalizeObject(details.rating)
      ];
      for (var i = 0; i < keys.length; i += 1) {
        var key = keys[i];
        var candidates = [community && community[key], details[key]];
        nested.forEach(function (entry) {
          candidates.push(entry[key]);
        });
        for (var j = 0; j < candidates.length; j += 1) {
          var candidate = candidates[j];
          if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
          }
        }
      }
      return null;
    }

    function pickCommunityNumericValue(community, keys) {
      var details = normalizeObject(community && community.details);
      var nested = [
        normalizeObject(details.summary),
        normalizeObject(details.preview),
        normalizeObject(details.moderation),
        normalizeObject(details.feed),
        normalizeObject(details.chat),
        normalizeObject(details.rating)
      ];
      for (var i = 0; i < keys.length; i += 1) {
        var key = keys[i];
        var candidates = [community && community[key], details[key]];
        nested.forEach(function (entry) {
          candidates.push(entry[key]);
        });
        for (var j = 0; j < candidates.length; j += 1) {
          var parsed = normalizeCommunityCount(candidates[j]);
          if (parsed !== null) {
            return parsed;
          }
        }
      }
      return null;
    }

    function readArrayLike(value) {
      if (Array.isArray(value)) {
        return value;
      }
      if (isObject(value)) {
        if (Array.isArray(value.items)) {
          return value.items;
        }
        if (Array.isArray(value.rows)) {
          return value.rows;
        }
        if (Array.isArray(value.posts)) {
          return value.posts;
        }
        if (Array.isArray(value.messages)) {
          return value.messages;
        }
        if (Array.isArray(value.list)) {
          return value.list;
        }
      }
      return [];
    }

    function pickCommunityArrayValue(community, keys) {
      var details = normalizeObject(community && community.details);
      var nested = [
        normalizeObject(details.summary),
        normalizeObject(details.preview),
        normalizeObject(details.moderation),
        normalizeObject(details.feed),
        normalizeObject(details.chat),
        normalizeObject(details.rating)
      ];
      for (var i = 0; i < keys.length; i += 1) {
        var key = keys[i];
        var candidates = [community && community[key], details[key]];
        nested.forEach(function (entry) {
          candidates.push(entry[key]);
        });
        for (var j = 0; j < candidates.length; j += 1) {
          var list = readArrayLike(candidates[j]);
          if (list.length > 0) {
            return list;
          }
        }
      }
      return [];
    }

    function getCommunityIdentityLetter(community) {
      var source = String((community && community.name) || 'C').trim();
      return (source.charAt(0) || 'C').toUpperCase();
    }

    function isCommunityVerified(community) {
      if (!community) {
        return false;
      }
      if (community.isVerified === true) {
        return true;
      }
      if (community.isVerified === false) {
        return false;
      }

      var details = normalizeObject(community.details);
      var candidates = [
        community.verified,
        details.isVerified,
        details.verified,
        details.isOfficial,
        details.official
      ];

      for (var i = 0; i < candidates.length; i += 1) {
        var value = candidates[i];
        if (value === true) {
          return true;
        }
        if (value === false) {
          return false;
        }
        var normalized = String(value || '').trim().toLowerCase();
        if (!normalized) {
          continue;
        }
        if (['true', '1', 'yes', 'on', 'verified'].indexOf(normalized) >= 0) {
          return true;
        }
        if (['false', '0', 'no', 'off', 'unverified'].indexOf(normalized) >= 0) {
          return false;
        }
      }

      return false;
    }

    function renderCommunityAvatarNode(node, community) {
      clearNode(node);
      var media = document.createElement('div');
      media.className = 'phab-admin-community-avatar-media';
      var logo = String((community && community.logo) || '').trim();
      if (logo) {
        var img = document.createElement('img');
        img.alt = String((community && community.name) || 'Сообщество');
        img.src = logo;
        media.appendChild(img);
      } else {
        media.textContent = getCommunityIdentityLetter(community);
      }
      node.appendChild(media);

      if (isCommunityVerified(community)) {
        var badge = document.createElement('span');
        badge.className = 'phab-admin-community-avatar-verified';
        badge.setAttribute('aria-label', 'Верифицировано');
        badge.title = 'Верифицировано';
        badge.innerHTML =
          '<svg viewBox="0 0 16 16" aria-hidden="true">' +
          '<path d="M3.5 8.5l2.4 2.4L12.5 4.8"/>' +
          '</svg>';
        node.appendChild(badge);
      }
    }

    function getCommunityStatusDescriptor(community) {
      var raw = String((community && (community.rawStatus || community.status)) || '')
        .trim()
        .toUpperCase();
      if (raw === 'PAUSED' || raw === 'ON_PAUSE' || raw === 'FROZEN') {
        return { key: 'PAUSED', label: 'На паузе', tone: 'warn' };
      }
      if (raw === 'HIDDEN' || raw === 'ARCHIVED') {
        return { key: 'HIDDEN', label: 'Скрыто', tone: 'muted' };
      }
      if (raw === 'MODERATION' || raw === 'REVIEW' || raw === 'PENDING_REVIEW') {
        return { key: 'MODERATION', label: 'На проверке', tone: 'warn' };
      }
      if (raw === 'PRIVATE' || raw === 'CLOSED' || String(community && community.visibility).toUpperCase() === 'CLOSED') {
        return { key: 'CLOSED', label: 'Закрыто', tone: 'muted' };
      }
      return { key: 'OPEN', label: 'Открыто', tone: 'good' };
    }

    function getCommunityVisibilityLabel(value) {
      return String(value || '').toUpperCase() === 'CLOSED' ? 'Скрыто из каталога' : 'Видимо всем';
    }

    function getCommunityJoinRuleLabel(value) {
      var normalized = String(value || '').toUpperCase();
      if (normalized === 'MODERATED') {
        return 'Через заявку';
      }
      if (normalized === 'INVITE_ONLY') {
        return 'Только по инвайту';
      }
      return 'Свободный вход';
    }

    function getCommunityActivityTypes(community) {
      var raw = normalizeArray(pickCommunityArrayValue(community, ['activityTypes', 'allowedPostTypes']))
        .concat(getCommunityFocusTags(community));
      var joined = raw
        .map(function (item) {
          return String(item || '').toLowerCase();
        })
        .join(' ');
      var result = [];

      if (/игр|game|match|padel|падл/.test(joined) || normalizeCommunityCount(community.postsCount) > 0) {
        result.push('Игры');
      }
      if (/турнир|tournament|cup|league/.test(joined)) {
        result.push('Турниры');
      }
      if (/новост|news|feed|post/.test(joined) || normalizeCommunityCount(community.postsCount) > 0) {
        result.push('Новости');
      }
      if ((normalizeCommunityCount(community.membersCount) || 0) > 0) {
        result.push('Чат');
      }

      if (result.length === 0) {
        result = ['Новости', 'Чат'];
      }

      return Array.from(new Set(result)).slice(0, 4);
    }

    function communityLevelRank(level) {
      var map = {
        D: 1,
        'D+': 2,
        C: 3,
        'C+': 4,
        B: 5,
        'B+': 6,
        A: 7
      };
      return map[String(level || '').trim().toUpperCase()] || 0;
    }

    function createCommunityStatCard(label, value) {
      var card = document.createElement('div');
      card.className = 'phab-admin-community-stat';

      var labelNode = document.createElement('span');
      labelNode.className = 'phab-admin-community-stat-label';
      labelNode.textContent = label;
      card.appendChild(labelNode);

      var valueNode = document.createElement('span');
      valueNode.className = 'phab-admin-community-stat-value';
      valueNode.textContent = value;
      card.appendChild(valueNode);

      return card;
    }

    function isCommunitySectionTitleDuplicated(title) {
      var activeLabelByTab = {
        overview: 'Обзор',
        settings: 'Настройки',
        participants: 'Участники',
        applications: 'Заявки',
        content: 'Контент',
        chat: 'Чат',
        rating: 'Рейтинг'
      };
      return String(title || '') === String(activeLabelByTab[state.communityCenterTab] || '');
    }

    function createCommunitySectionCard(title, subtitle) {
      var card = document.createElement('section');
      card.className = 'phab-admin-community-section-card';

      var head = null;
      var shouldRenderTitle = !isCommunitySectionTitleDuplicated(title);
      var shouldRenderSubtitle = Boolean(subtitle);

      if (shouldRenderTitle || shouldRenderSubtitle) {
        head = document.createElement('div');
        head.className = 'phab-admin-community-section-head';
        card.appendChild(head);

        var textWrap = document.createElement('div');
        head.appendChild(textWrap);

        if (shouldRenderTitle) {
          var titleNode = document.createElement('div');
          titleNode.className = 'phab-admin-community-section-title';
          titleNode.textContent = title;
          textWrap.appendChild(titleNode);
        }

        if (shouldRenderSubtitle) {
          var subtitleNode = document.createElement('div');
          subtitleNode.className = 'phab-admin-community-section-subtitle';
          subtitleNode.textContent = subtitle;
          textWrap.appendChild(subtitleNode);
        }
      }

      var body = document.createElement('div');
      card.appendChild(body);

      return {
        card: card,
        head: head,
        body: body
      };
    }

    function appendCommunityFormField(container, label, control, wide) {
      var field = document.createElement('div');
      field.className =
        'phab-admin-community-form-field' + (wide ? ' phab-admin-community-form-field-wide' : '');
      container.appendChild(field);

      var title = document.createElement('label');
      title.className = 'phab-admin-settings-label';
      title.textContent = label;
      field.appendChild(title);

      field.appendChild(control);
      return control;
    }

    function appendCommunityListEmpty(container, text) {
      var empty = document.createElement('div');
      empty.className = 'phab-admin-empty phab-admin-community-list-empty';
      empty.textContent = text;
      container.appendChild(empty);
    }

    function getCommunityFeedPosts(community, model) {
      var liveFeed = state.communityFeedById[community.id];
      var managedFeed = state.communityManagedFeedById[community.id];
      if (Array.isArray(liveFeed)) {
        return mergeCommunityFeedCollections(community.id, managedFeed, liveFeed);
      }
      if (state.communityFeedLoadedById[community.id]) {
        return Array.isArray(managedFeed) ? managedFeed.slice() : [];
      }

      var list = pickCommunityArrayValue(community, ['feedPreview', 'previewPosts', 'feedPosts', 'posts', 'feed'])
        .map(function (item, index) {
          return normalizeCommunityFeedPostEntry(item, index, community);
        })
        .filter(function (item) {
          return item.title || item.body;
        });

      if (list.length > 0) {
        return mergeCommunityFeedCollections(
          community.id,
          managedFeed,
          list.slice(0, COMMUNITY_FEED_PREVIEW_LIMIT)
        );
      }

      var synthetic = [];
      if (String(community.description || '').trim()) {
        synthetic.push({
          id: community.id + ':desc',
          synthetic: true,
          kicker: 'Новости',
          title: 'О сообществе',
          body: String(community.description || '').trim(),
          authorName: String((community.createdBy && community.createdBy.name) || 'Владелец сообщества'),
          publishedAt: String(community.updatedAt || community.createdAt || ''),
          reportsCount: 0
        });
      }
      if (String(community.rules || '').trim()) {
        synthetic.push({
          id: community.id + ':rules',
          synthetic: true,
          kicker: 'Закреп',
          title: 'Правила сообщества',
          body: String(community.rules || '').trim(),
          authorName: 'Система',
          publishedAt: String(community.updatedAt || community.createdAt || ''),
          reportsCount: model.reportCount > 0 ? Math.min(model.reportCount, 2) : 0
        });
      }
      if (model.pendingMembers.length > 0) {
        synthetic.push({
          id: community.id + ':pending',
          synthetic: true,
          kind: 'EVENT',
          kicker: 'Новый участник',
          title: String(model.pendingMembers[0].name || 'Новая заявка'),
          body: 'Ожидает решения модератора.',
          authorName: String(model.pendingMembers[0].name || 'Игрок'),
          publishedAt: String(model.pendingMembers[0].joinedAt || community.updatedAt || ''),
          reportsCount: 0
        });
      }

      if (synthetic.length === 0) {
        synthetic.push({
          id: community.id + ':empty',
          synthetic: true,
          kicker: 'Лента',
          title: 'Пока без контента',
          body: 'Как только появятся публикации или превью из ЛК, здесь будет живой модераторский просмотр.',
          authorName: 'Система',
          publishedAt: String(community.updatedAt || community.createdAt || ''),
          reportsCount: 0
        });
      }

      return mergeCommunityFeedCollections(
        community.id,
        managedFeed,
        synthetic.slice(0, COMMUNITY_FEED_PREVIEW_LIMIT)
      );
    }

    function getCommunityPreviewPosts(community, model) {
      return getCommunityFeedPosts(community, model).slice(0, 3);
    }

    function getCommunityChatMessages(community, model) {
      var liveChat = state.communityChatById[community.id];
      if (Array.isArray(liveChat)) {
        return liveChat.slice();
      }
      if (state.communityChatLoadedById[community.id]) {
        return [];
      }

      var list = pickCommunityArrayValue(community, [
        'chatPreview',
        'previewMessages',
        'chatMessages',
        'messages',
        'events'
      ])
        .map(function (item, index) {
          var source = normalizeObject(item);
          return {
            id: String(source.id || source.messageId || 'msg-' + index),
            authorName: String(
              source.authorName ||
                source.name ||
                (isObject(source.author) && source.author.name) ||
                'Участник'
            ),
            text: String(source.text || source.body || source.description || '').trim(),
            createdAt: String(source.createdAt || source.publishedAt || community.updatedAt || ''),
            flagged: Boolean(source.flagged || source.reported || source.suspicious),
            reportsCount:
              normalizeCommunityCount(source.reportsCount || source.complaintsCount || source.flagsCount) || 0
          };
        })
        .filter(function (item) {
          return item.text;
        });

      if (list.length > 0) {
        return list.slice();
      }

      var synthetic = [];
      if (model.members.length > 0) {
        synthetic.push({
          id: community.id + ':hello',
          authorName: String(model.members[0].name || 'Участник'),
          text: 'Проверьте ближайшие игры и новости сообщества.',
          createdAt: String(model.members[0].lastActiveAt || community.lastActivityAt || community.updatedAt || ''),
          flagged: false,
          reportsCount: 0
        });
      }
      if (model.pendingMembers.length > 0) {
        synthetic.push({
          id: community.id + ':pending-chat',
          authorName: String(model.pendingMembers[0].name || 'Новый участник'),
          text: 'Добрый день! Хочу присоединиться к сообществу.',
          createdAt: String(model.pendingMembers[0].joinedAt || community.updatedAt || ''),
          flagged: model.reportCount > 2,
          reportsCount: model.reportCount > 2 ? 1 : 0
        });
      }
      if (synthetic.length === 0) {
        synthetic.push({
          id: community.id + ':idle',
          authorName: 'Система',
          text: 'Чат пока тихий. Как только подтянем живые сообщения, здесь появится модераторский слой.',
          createdAt: String(community.updatedAt || community.createdAt || ''),
          flagged: false,
          reportsCount: 0
        });
      }
      return synthetic.slice(0, 6);
    }

    function getCommunityPreviewMessages(community, model) {
      var messages = getCommunityChatMessages(community, model);
      return messages.length > 4 ? messages.slice(messages.length - 4) : messages;
    }

    function getCommunityRankingRows(community, model) {
      var liveRanking = state.communityRankingById[community.id];
      if (Array.isArray(liveRanking)) {
        return liveRanking.slice();
      }
      if (state.communityRankingLoadedById[community.id]) {
        return [];
      }

      var list = pickCommunityArrayValue(community, ['rankingRows', 'ranking', 'ratingRows', 'table'])
        .map(function (item, index) {
          return normalizeCommunityRankingEntry(item, index);
        })
        .filter(Boolean);

      if (list.length > 0) {
        return list.slice();
      }

      return model.members
        .slice()
        .sort(function (left, right) {
          return Number(right.levelScore || 0) - Number(left.levelScore || 0);
        })
        .slice(0, 5)
        .map(function (member) {
          return {
            name: String(member.name || 'Игрок'),
            role: String(member.role || 'MEMBER'),
            levelLabel: String(member.levelLabel || 'C'),
            score: Math.round(Number(member.levelScore || 0) * 20)
          };
        });
    }

    function getCommunityPreviewRanking(community, model) {
      return getCommunityRankingRows(community, model).slice(0, 5);
    }

    function getCommunityHistoryEntries(community, model) {
      var list = pickCommunityArrayValue(community, ['moderationLog', 'history', 'auditLog', 'actions'])
        .map(function (item, index) {
          var source = normalizeObject(item);
          return {
            id: String(source.id || 'history-' + index),
            title: String(source.title || source.action || source.type || 'Действие'),
            meta: [
              source.actorName || source.by || source.moderator,
              source.reason || source.subject,
              source.createdAt || source.at
            ]
              .filter(Boolean)
              .join(' · ')
          };
        })
        .filter(function (item) {
          return item.title;
        });

      if (list.length > 0) {
        return list.slice(0, 6);
      }

      var fallback = [];
      if (community.createdAt) {
        fallback.push({
          id: community.id + ':created',
          title: 'Сообщество создано',
          meta: [
            (community.createdBy && (community.createdBy.name || community.createdBy.phone)) || 'Система',
            formatDateTimeFull(community.createdAt)
          ]
            .filter(Boolean)
            .join(' · ')
        });
      }
      if (community.updatedAt) {
        fallback.push({
          id: community.id + ':updated',
          title: 'Карточка обновлена',
          meta: formatDateTimeFull(community.updatedAt)
        });
      }
      if (model.pendingCount > 0) {
        fallback.push({
          id: community.id + ':pending',
          title: 'Есть новые заявки',
          meta: 'Ожидают проверки: ' + String(model.pendingCount)
        });
      }
      return fallback.slice(0, 5);
    }

    function buildCommunityModeratorModel(community) {
      var members = normalizeCommunityMemberList(community && community.members);
      var pendingMembers = normalizeCommunityMemberList(community && community.pendingMembers);
      var bannedMembers = normalizeCommunityMemberList(community && community.bannedMembers);
      var membersCount = normalizeCommunityCount(community && community.membersCount) || members.length;
      var moderatorsCount =
        normalizeCommunityCount(community && community.moderatorsCount) ||
        members.filter(function (member) {
          var role = String(member.role || '').toUpperCase();
          return role === 'OWNER' || role === 'ADMIN';
        }).length;
      var pendingCount =
        normalizeCommunityCount(community && community.pendingRequestsCount) || pendingMembers.length;
      var bannedCount =
        normalizeCommunityCount(community && community.bannedMembersCount) ||
        bannedMembers.length ||
        pickCommunityNumericValue(community, ['bannedCount', 'blockedCount']) ||
        0;
      var postsCount = normalizeCommunityCount(community && community.postsCount) || 0;
      var posts7d =
        pickCommunityNumericValue(community, ['posts7d', 'postsLast7Days', 'publications7d']) ||
        Math.min(postsCount, Math.max(1, Math.round(postsCount * 0.65)));
      var reportCount =
        pickCommunityNumericValue(community, ['reportsCount', 'complaintsCount', 'flagsCount', 'claimsCount']) ||
        0;
      var unreadEventsCount =
        pickCommunityNumericValue(community, ['unreadEventsCount', 'newEventsCount', 'eventsUnread']) ||
        0;
      var rating =
        pickCommunityNumericValue(community, ['ratingScore', 'communityRating', 'qualityScore', 'score']) ||
        Math.max(
          42,
          Math.min(
            95,
            Math.round(
              ((members.reduce(function (sum, member) {
                return sum + Number(member.levelScore || 0);
              }, 0) /
                Math.max(members.length, 1)) *
                17 || 0) +
                38 -
                reportCount * 3
            )
          )
        );
      var engagement =
        pickCommunityNumericValue(community, ['engagementScore', 'engagement']) ||
        Math.max(28, Math.min(96, Math.round((posts7d + pendingCount + membersCount / 14) * 4)));
      var chatActivity =
        pickCommunityNumericValue(community, ['chatActivityCount', 'messages7d', 'chat7d']) ||
        Math.max(0, Math.round(membersCount * 0.6 + posts7d * 2 + pendingCount));
      var status = getCommunityStatusDescriptor(community);
      var activityTypes = getCommunityActivityTypes(community);
      var riskFlags = [];

      if (reportCount >= 4) {
        riskFlags.push({ label: 'Много жалоб', tone: 'danger' });
      }
      if (bannedCount >= 2) {
        riskFlags.push({ label: 'Конфликт', tone: 'warn' });
      }
      if (rating <= 58) {
        riskFlags.push({ label: 'Низкий рейтинг', tone: 'danger' });
      }
      if (pendingCount >= 5) {
        riskFlags.push({ label: 'Спам / наплыв', tone: 'warn' });
      }
      if (status.key === 'PAUSED' || status.key === 'HIDDEN') {
        riskFlags.push({ label: status.label, tone: 'warn' });
      }

      return {
        status: status,
        members: members,
        pendingMembers: pendingMembers,
        bannedMembers: bannedMembers,
        membersCount: membersCount,
        moderatorsCount: moderatorsCount,
        pendingCount: pendingCount,
        bannedCount: bannedCount,
        postsCount: postsCount,
        posts7d: posts7d,
        reportCount: reportCount,
        unreadEventsCount: unreadEventsCount,
        rating: rating,
        engagement: engagement,
        chatActivity: chatActivity,
        activityTypes: activityTypes,
        riskFlags: riskFlags,
        growthScore: pendingCount * 4 + posts7d * 3 + Math.round(membersCount / 12),
        activityScore:
          chatActivity + posts7d * 3 + unreadEventsCount * 2 + Math.round(getCommunityTimestampValue(community) / 86400000),
        feedPosts: [],
        chatMessages: [],
        previewPosts: [],
        previewMessages: [],
        rankingRows: [],
        previewRankingRows: [],
        historyEntries: []
      };
    }

    function getCommunityPostVariant(post) {
      var normalized = String(post && post.kind || '').trim().toUpperCase();
      if (normalized === 'AD') {
        return 'ad';
      }
      if (normalized === 'GAME') {
        return 'game';
      }
      if (normalized === 'TOURNAMENT') {
        return 'tournament';
      }
      if (normalized === 'EVENT') {
        return 'event';
      }
      if (normalized === 'SYSTEM') {
        return 'system';
      }
      return 'news';
    }

    function formatCommunityPreviewDateParts(value) {
      var date = value ? new Date(value) : null;
      if (!date || Number.isNaN(date.getTime())) {
        return {
          month: 'ЛК',
          day: '00',
          weekday: '--'
        };
      }
      var months = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];
      var weekdays = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
      return {
        month: months[date.getMonth()] || 'ЛК',
        day: String(date.getDate()),
        weekday: weekdays[date.getDay()] || '--'
      };
    }

    function formatCommunityPreviewTimeRange(post) {
      var start = post && post.startAt ? new Date(post.startAt) : null;
      var end = post && post.endAt ? new Date(post.endAt) : null;
      if (!start || Number.isNaN(start.getTime())) {
        start = post && post.publishedAt ? new Date(post.publishedAt) : null;
      }
      if (!start || Number.isNaN(start.getTime())) {
        return 'Время уточняется';
      }
      var startText =
        String(start.getHours()).padStart(2, '0') + ':' + String(start.getMinutes()).padStart(2, '0');
      if (!end || Number.isNaN(end.getTime())) {
        return startText;
      }
      var endText =
        String(end.getHours()).padStart(2, '0') + ':' + String(end.getMinutes()).padStart(2, '0');
      return startText + '–' + endText;
    }

    function buildCommunityPreviewLocation(post, community) {
      var parts = [
        post && post.courtName ? String(post.courtName) : null,
        post && post.stationName ? String(post.stationName) : community && (community.stationName || community.stationId),
        community && community.city ? String(community.city) : null
      ].filter(Boolean);
      if (parts.length === 0 && post && post.previewLabel) {
        parts.push(String(post.previewLabel));
      }
      return parts.join(' • ') || 'Локация уточняется';
    }

    function getCommunityPreviewFeedSegmentKey(post) {
      var variant = getCommunityPostVariant(post);
      if (variant === 'ad') {
        return 'AD';
      }
      if (variant === 'game') {
        return 'GAME';
      }
      if (variant === 'tournament') {
        return 'TOURNAMENT';
      }
      if (variant === 'event') {
        return 'EVENT';
      }
      return 'NEWS';
    }

    function getCommunityPreviewFeedSegmentIconMarkup(segmentKey) {
      var key = String(segmentKey || 'ALL').toUpperCase();
      if (key === 'GAME') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12h8M12 8v8"/><path d="M7.5 7.5c1.3-.9 2.8-1.5 4.5-1.5s3.2.6 4.5 1.5c1.9 1.4 3.5 4 3.5 7.2 0 1.8-1.1 3.3-2.8 3.3-.9 0-1.7-.4-2.3-1.1l-1.2-1.4H10.3l-1.2 1.4c-.6.7-1.4 1.1-2.3 1.1C5.1 18 4 16.5 4 14.7c0-3.2 1.6-5.8 3.5-7.2Z"/></svg>';
      }
      if (key === 'TOURNAMENT') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h8v4c0 2.2-1.8 4-4 4s-4-1.8-4-4V5Z"/><path d="M10 17h4M12 13v4"/><path d="M8 7H5c0 2.6 1.6 4 3.4 4.6M16 7h3c0 2.6-1.6 4-3.4 4.6"/></svg>';
      }
      if (key === 'EVENT') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M5 9h14"/><path d="M6.5 5h11A1.5 1.5 0 0 1 19 6.5v11A1.5 1.5 0 0 1 17.5 19h-11A1.5 1.5 0 0 1 5 17.5v-11A1.5 1.5 0 0 1 6.5 5Z"/><path d="M9 13h3M9 16h5"/></svg>';
      }
      if (key === 'NEWS') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8h10M7 12h10M7 16h6"/><path d="M6.5 4h11A1.5 1.5 0 0 1 19 5.5v13A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5v-13A1.5 1.5 0 0 1 6.5 4Z"/></svg>';
      }
      if (key === 'AD') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11v2c0 .8.6 1.4 1.4 1.5L11 15l5 3V6l-5 3-4.6.5C5.6 9.6 5 10.2 5 11Z"/><path d="M9 15.5 10 20"/><path d="M19 10.5v3"/></svg>';
      }
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h4v4H7V7ZM13 7h4v4h-4V7ZM7 13h4v4H7v-4ZM13 13h4v4h-4v-4Z"/></svg>';
    }

    function filterCommunityPreviewFeedPosts(posts) {
      var segment = String(state.communityPreviewFeedSegment || 'ALL').toUpperCase();
      if (segment === 'ALL') {
        return normalizeArray(posts);
      }
      return normalizeArray(posts).filter(function (post) {
        return getCommunityPreviewFeedSegmentKey(post) === segment;
      });
    }

    function createCommunityParticipantAvatar(participant, index) {
      var avatar = document.createElement('div');
      avatar.className = 'phab-admin-community-lk-participant';
      avatar.style.zIndex = String(10 - index);
      if (participant && participant.avatar) {
        var image = document.createElement('img');
        image.alt = String(participant.name || 'Участник');
        image.src = String(participant.avatar);
        avatar.appendChild(image);
      } else {
        avatar.textContent = String((participant && participant.shortName) || 'C');
      }
      return avatar;
    }

    function createCommunityFeedActionItems(community, post) {
      var moderation = normalizeObject(post && post.moderation);
      var variant = getCommunityPostVariant(post);
      var items = [
        {
          label: Number(moderation.rank || 0) > 0 ? 'Опустить' : 'Поднять',
          className: 'phab-admin-community-preview-action',
          onClick: function () {
            var current = Number(getCommunityFeedModerationState(community.id, post.id).rank || 0);
            setCommunityFeedModerationState(
              community.id,
              post.id,
              { rank: current > 0 ? current - 1 : current + 1 },
              current > 0 ? 'Карточка опущена ниже' : 'Карточка поднята выше'
            );
          }
        },
        {
          label: moderation.pinned ? 'Открепить' : 'Закрепить',
          className: 'phab-admin-community-preview-action',
          onClick: function () {
            setCommunityFeedModerationState(
              community.id,
              post.id,
              { pinned: !moderation.pinned },
              moderation.pinned ? 'Карточка откреплена' : 'Карточка закреплена'
            );
          }
        }
      ];

      if (variant === 'game' || variant === 'tournament' || variant === 'event' || variant === 'ad') {
        items.push({
          label: moderation.promoted ? 'Снять буст' : 'Продвинуть',
          className: 'phab-admin-community-preview-action phab-admin-community-preview-action-accent',
          onClick: function () {
            setCommunityFeedModerationState(
              community.id,
              post.id,
              { promoted: !moderation.promoted },
              moderation.promoted ? 'Продвижение снято' : 'Карточка продвигается'
            );
          }
        });
      }

      items.push({
        label: moderation.authorLimited ? 'Снять ограничение' : 'Огр. автора',
        className: 'phab-admin-community-preview-action',
        onClick: function () {
          setCommunityFeedModerationState(
            community.id,
            post.id,
            { authorLimited: !moderation.authorLimited },
            moderation.authorLimited ? 'Ограничение автора снято' : 'Автор ограничен'
          );
        }
      });
      items.push({
        label: moderation.hidden ? 'Показать' : 'Скрыть',
        className: 'phab-admin-community-preview-action',
        onClick: function () {
          setCommunityFeedModerationState(
            community.id,
            post.id,
            { hidden: !moderation.hidden, removed: false },
            moderation.hidden ? 'Карточка возвращена в ленту' : 'Карточка скрыта из ленты'
          );
        }
      });
      items.push({
        label: isSyntheticCommunityFeedPost(post)
          ? (moderation.removed ? 'Вернуть' : 'Удалить')
          : 'Удалить',
        className: 'phab-admin-community-preview-action phab-admin-community-preview-action-danger',
        onClick: function () {
          if (!isSyntheticCommunityFeedPost(post)) {
            deleteCommunityFeedItem(community, post).catch(handleError);
            return;
          }
          setCommunityFeedModerationState(
            community.id,
            post.id,
            { removed: !moderation.removed, hidden: moderation.removed ? moderation.hidden : true },
            moderation.removed ? 'Карточка восстановлена' : 'Карточка удалена'
          );
        }
      });

      return items;
    }

    function createCommunityFeedCard(post, actionItems, community) {
      var variant = getCommunityPostVariant(post);
      var moderation = normalizeObject(post && post.moderation);
      var dateParts = formatCommunityPreviewDateParts(post.startAt || post.publishedAt);
      var preview = document.createElement('div');
      preview.className =
        'phab-admin-community-preview-card phab-admin-community-feed-card phab-admin-community-feed-card--' + variant +
        (moderation.hidden || moderation.removed ? ' phab-admin-community-feed-card-muted' : '') +
        (moderation.promoted ? ' phab-admin-community-feed-card-promoted' : '');

      var top = document.createElement('div');
      top.className = 'phab-admin-community-lk-card-top';
      preview.appendChild(top);

      if (variant === 'game' || variant === 'tournament' || variant === 'event') {
        var dateBadge = document.createElement('div');
        dateBadge.className = 'phab-admin-community-lk-date-badge';
        dateBadge.innerHTML =
          '<span>' + dateParts.month + '</span>' +
          '<strong>' + dateParts.day + '</strong>' +
          '<em>' + dateParts.weekday + '</em>';
        top.appendChild(dateBadge);
      }

      var content = document.createElement('div');
      content.className = 'phab-admin-community-lk-card-content';
      top.appendChild(content);

      var head = document.createElement('div');
      head.className = 'phab-admin-community-preview-post-top';
      content.appendChild(head);

      var left = document.createElement('div');
      var kicker = document.createElement('div');
      kicker.className = 'phab-admin-community-preview-kicker';
      kicker.textContent = String(post.kicker || 'Публикация') + ' · ' + formatDateTimeFull(post.publishedAt);
      var title = document.createElement('div');
      title.className = 'phab-admin-community-preview-title';
      title.style.fontSize = variant === 'game' || variant === 'tournament' || variant === 'event' ? '20px' : '18px';
      title.textContent = post.title;
      left.appendChild(kicker);
      left.appendChild(title);
      head.appendChild(left);

      var sideAction = document.createElement('button');
      sideAction.type = 'button';
      sideAction.className = 'phab-admin-community-lk-side-action';
      sideAction.setAttribute('aria-label', 'Редактировать публикацию');
      sideAction.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M12 20h9"/>' +
        '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>' +
        '</svg>';
      sideAction.addEventListener('click', function () {
        openCommunityFeedEditor(community, post);
      });
      head.appendChild(sideAction);

      var chips = document.createElement('div');
      chips.className = 'phab-admin-community-feed-meta';
      [
        variant === 'ad'
          ? (post.previewLabel || post.placement || 'Рекламный блок')
          : buildCommunityPreviewLocation(post, community),
        post.authorName ? 'Автор: ' + String(post.authorName) : null,
        post.levelLabel ? 'Уровень: ' + String(post.levelLabel) : null,
        post.ctaLabel ? 'CTA: ' + String(post.ctaLabel) : null
      ]
        .filter(Boolean)
        .forEach(function (item) {
          chips.appendChild(createCommunityPill(String(item), 'phab-admin-community-feed-chip'));
        });
      if (post.reportsCount > 0) {
        chips.appendChild(
          createCommunityPill(
            'Жалобы: ' + String(post.reportsCount),
            'phab-admin-community-feed-chip phab-admin-community-feed-chip-strong'
          )
        );
      }
      if (moderation.pinned) {
        chips.appendChild(
          createCommunityPill('Закреплено', 'phab-admin-community-feed-chip phab-admin-community-feed-chip-strong')
        );
      }
      if (moderation.promoted) {
        chips.appendChild(
          createCommunityPill('Продвигается', 'phab-admin-community-feed-chip phab-admin-community-feed-chip-accent')
        );
      }
      if (moderation.authorLimited) {
        chips.appendChild(
          createCommunityPill('Автор ограничен', 'phab-admin-community-feed-chip')
        );
      }
      if (moderation.hidden) {
        chips.appendChild(
          createCommunityPill('Скрыто из ленты', 'phab-admin-community-feed-chip')
        );
      }
      if (moderation.removed) {
        chips.appendChild(
          createCommunityPill('Удалено модератором', 'phab-admin-community-feed-chip phab-admin-community-feed-chip-strong')
        );
      }
      if (chips.childNodes.length > 0) {
        content.appendChild(chips);
      }

      if (variant === 'game' || variant === 'tournament' || variant === 'event') {
        var schedule = document.createElement('div');
        schedule.className = 'phab-admin-community-lk-game-meta';
        schedule.textContent =
          formatCommunityPreviewTimeRange(post) + ' • ' + buildCommunityPreviewLocation(post, community);
        content.appendChild(schedule);

        if (post.previewLabel) {
          var previewLine = document.createElement('div');
          previewLine.className = 'phab-admin-community-preview-text';
          previewLine.style.marginTop = '10px';
          previewLine.textContent = String(post.previewLabel);
          content.appendChild(previewLine);
        }

        var footer = document.createElement('div');
        footer.className = 'phab-admin-community-lk-game-footer';
        content.appendChild(footer);

        var participants = document.createElement('div');
        participants.className = 'phab-admin-community-lk-participants';
        if (normalizeArray(post.participants).length > 0) {
          normalizeArray(post.participants).forEach(function (participant, index) {
            participants.appendChild(createCommunityParticipantAvatar(participant, index));
          });
        } else {
          participants.appendChild(createCommunityPill('Состав уточняется', 'phab-admin-community-feed-chip'));
        }
        footer.appendChild(participants);

        var cta = document.createElement('button');
        cta.type = 'button';
        cta.className = 'phab-admin-community-lk-primary-cta';
        cta.textContent = String(post.ctaLabel || 'Открыть');
        cta.addEventListener('click', function () {
          setCommunityPreviewActionNotice(post.ctaLabel || 'Открыть');
        });
        footer.appendChild(cta);
      } else if (variant === 'ad') {
        var adBody = document.createElement('div');
        adBody.className = 'phab-admin-community-lk-ad-body';
        content.appendChild(adBody);

        if (post.imageUrl) {
          var hero = document.createElement('div');
          hero.className = 'phab-admin-community-lk-ad-hero';
          var heroImage = document.createElement('img');
          heroImage.alt = String(post.title || 'Рекламная карточка');
          heroImage.src = String(post.imageUrl);
          hero.appendChild(heroImage);
          adBody.appendChild(hero);
        }

        var adText = document.createElement('div');
        adText.className = 'phab-admin-community-preview-text';
        adText.textContent = post.body || 'Промо-блок сообщества';
        adBody.appendChild(adText);

        var adFooter = document.createElement('div');
        adFooter.className = 'phab-admin-community-lk-ad-footer';
        content.appendChild(adFooter);

        var engagement = document.createElement('div');
        engagement.className = 'phab-admin-community-lk-engagement';
        engagement.textContent =
          '♥ ' + String(post.likesCount || 0) + ' • 💬 ' + String(post.commentsCount || 0);
        adFooter.appendChild(engagement);

        var adCta = document.createElement('button');
        adCta.type = 'button';
        adCta.className = 'phab-admin-community-lk-primary-cta';
        adCta.textContent = String(post.ctaLabel || 'Открыть');
        adCta.addEventListener('click', function () {
          setCommunityPreviewActionNotice(post.ctaLabel || 'Открыть');
        });
        adFooter.appendChild(adCta);
      } else {
        var newsBody = document.createElement('div');
        newsBody.className = 'phab-admin-community-lk-news-body';
        content.appendChild(newsBody);

        var textBlock = document.createElement('div');
        newsBody.appendChild(textBlock);

        var text = document.createElement('div');
        text.className = 'phab-admin-community-preview-text';
        text.textContent = post.body || 'Без текста';
        textBlock.appendChild(text);

        if (post.imageUrl) {
          var imageWrap = document.createElement('div');
          imageWrap.className = 'phab-admin-community-lk-inline-image';
          var image = document.createElement('img');
          image.alt = String(post.title || 'Публикация сообщества');
          image.src = String(post.imageUrl);
          imageWrap.appendChild(image);
          newsBody.appendChild(imageWrap);
        }

        var engagement = document.createElement('div');
        engagement.className = 'phab-admin-community-lk-engagement';
        engagement.textContent =
          '♥ ' + String(post.likesCount || 0) + ' • 💬 ' + String(post.commentsCount || 0);
        content.appendChild(engagement);
      }

      var actions = document.createElement('div');
      actions.className = 'phab-admin-community-preview-actions phab-admin-community-preview-actions-moderation';
      normalizeArray(actionItems).forEach(function (item) {
        actions.appendChild(
          createCommunityActionButton(item.label, item.className, item.onClick || function () {
            setCommunityPreviewActionNotice(item.label);
          })
        );
      });
      preview.appendChild(actions);

      return preview;
    }

    function buildCommunityPreview(community) {
      var model = buildCommunityModeratorModel(community);
      var parts = [];

      parts.push('Участники: ' + String(model.membersCount));
      parts.push('Заявки: ' + String(model.pendingCount));
      if (model.reportCount > 0) {
        parts.push('Жалобы: ' + String(model.reportCount));
      }

      return parts.join(' · ');
    }

    function getCommunityMemberFilters(model) {
      var owners = model.members.filter(function (member) {
        return String(member.role || '').toUpperCase() === 'OWNER';
      });
      var admins = model.members.filter(function (member) {
        return String(member.role || '').toUpperCase() === 'ADMIN';
      });
      var regular = model.members.filter(function (member) {
        return String(member.role || '').toUpperCase() === 'MEMBER';
      });
      return {
        ALL: model.members,
        OWNERS: owners,
        MODS: admins,
        MEMBERS: regular,
        NEW: model.pendingMembers,
        BANNED: model.bannedMembers
      };
    }

    function buildCommunityMemberMeta(member) {
      var parts = [];
      if (member.role) {
        parts.push(String(member.role));
      }
      if (member.status) {
        parts.push(String(member.status));
      }
      if (member.phone) {
        parts.push(String(member.phone));
      }
      if (member.levelLabel || typeof member.levelScore === 'number') {
        parts.push(
          [
            member.levelLabel ? String(member.levelLabel) : null,
            typeof member.levelScore === 'number' ? String(member.levelScore) : null
          ]
            .filter(Boolean)
            .join(' · ')
        );
      }
      if (member.joinedAt) {
        parts.push('с ' + formatDateTimeFull(member.joinedAt));
      }
      if (member.lastActiveAt) {
        parts.push('активен ' + formatDateTimeFull(member.lastActiveAt));
      }
      if (normalizeCommunityCount(member.complaintsCount) > 0) {
        parts.push('жалобы: ' + String(normalizeCommunityCount(member.complaintsCount)));
      }
      if (normalizeCommunityCount(member.warningsCount) > 0) {
        parts.push('предупр.: ' + String(normalizeCommunityCount(member.warningsCount)));
      }
      return parts.filter(Boolean).join(' · ') || 'Без дополнительных данных';
    }

    function appendCommunityMemberRow(container, community, member, actions) {
      var row = document.createElement('div');
      row.className = 'phab-admin-settings-row';
      container.appendChild(row);

      var main = document.createElement('div');
      main.className = 'phab-admin-settings-row-main';
      row.appendChild(main);

      var title = document.createElement('div');
      title.className = 'phab-admin-settings-row-title';
      title.textContent = String(member.name || member.phone || member.id || 'Участник');
      main.appendChild(title);

      var meta = document.createElement('div');
      meta.className = 'phab-admin-settings-row-meta';
      meta.textContent = buildCommunityMemberMeta(member);
      main.appendChild(meta);

      if (!Array.isArray(actions) || actions.length === 0) {
        return;
      }

      var actionsWrap = document.createElement('div');
      actionsWrap.className = 'phab-admin-community-member-actions';
      row.appendChild(actionsWrap);

      actions.forEach(function (actionDef) {
        var actionKey = buildCommunityManageKey(community.id, actionDef.action, member);
        var isBusy = state.communityManagingKey === actionKey;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          actionDef.tone === 'danger' ? 'phab-admin-btn-danger' : 'phab-admin-btn-secondary';
        btn.disabled = Boolean(state.communityManagingKey) || actionDef.disabled === true;
        btn.textContent = isBusy ? actionDef.loadingLabel : actionDef.label;
        btn.addEventListener('click', function () {
          submitCommunityMemberAction(
            community.id,
            actionDef.action,
            member,
            actionDef.successText
          ).catch(handleError);
        });
        actionsWrap.appendChild(btn);
      });
    }

    function ensureCommunitySelectOptions(select, items, currentValue) {
      clearNode(select);
      items.forEach(function (item) {
        var option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        select.appendChild(option);
      });
      select.value = currentValue;
      if (select.value !== currentValue && items.length > 0) {
        select.value = items[0].value;
      }
    }

    function filterCommunitiesForModeration(community) {
      var model = buildCommunityModeratorModel(community);
      var stationValue = String(state.communitiesStationFilter || 'ALL');
      var statusValue = String(state.communitiesStatusFilter || 'ALL');
      var levelValue = String(state.communitiesLevelFilter || 'ALL');
      var accessValue = String(state.communitiesAccessFilter || 'ALL');
      var activityValue = String(state.communitiesActivityFilter || 'ALL');

      if (!matchCommunitySearch(community, state.communitiesSearchQuery)) {
        return false;
      }
      if (
        stationValue !== 'ALL' &&
        stationValue !== String(community.stationName || community.stationId || 'NONE')
      ) {
        return false;
      }
      if (statusValue !== 'ALL' && statusValue !== model.status.key) {
        return false;
      }
      if (
        levelValue !== 'ALL' &&
        String(community.minimumLevel || '').trim().toUpperCase() !== levelValue
      ) {
        return false;
      }
      if (accessValue !== 'ALL') {
        var visibility = String(community.visibility || '').toUpperCase();
        var joinRule = String(community.joinRule || '').toUpperCase();
        if (accessValue === 'OPEN' || accessValue === 'CLOSED') {
          if (visibility !== accessValue) {
            return false;
          }
        } else if (joinRule !== accessValue) {
          return false;
        }
      }
      if (
        activityValue !== 'ALL' &&
        model.activityTypes.indexOf(activityValue) === -1
      ) {
        return false;
      }
      return true;
    }

    function sortCommunitiesForModeration(items) {
      var sortField = String(state.communitiesSortField || 'activity');
      return sortCommunities(items).sort(function (left, right) {
        var leftModel = buildCommunityModeratorModel(left);
        var rightModel = buildCommunityModeratorModel(right);
        if (sortField === 'pending') {
          return rightModel.pendingCount - leftModel.pendingCount;
        }
        if (sortField === 'reports') {
          return rightModel.reportCount - leftModel.reportCount;
        }
        if (sortField === 'growth') {
          return rightModel.growthScore - leftModel.growthScore;
        }
        return rightModel.activityScore - leftModel.activityScore;
      });
    }

    function setCommunityPreviewActionNotice(label) {
      setStatus(label + ': для синхронизации с боевым ЛК нужен отдельный moderation API.', false);
    }

    function createCommunityStatusBadge(descriptor) {
      var badge = document.createElement('span');
      badge.className =
        'phab-admin-community-status-badge phab-admin-community-status-' +
        String(descriptor.tone || 'muted');
      badge.textContent = descriptor.label;
      return badge;
    }

    function createCommunityPill(label, className) {
      var pill = document.createElement('span');
      pill.className = className || 'phab-admin-community-mini-chip';
      pill.textContent = label;
      return pill;
    }

    function createCommunityActionButton(label, className, onClick, disabled) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.disabled = disabled === true;
      button.textContent = label;
      button.addEventListener('click', onClick);
      return button;
    }

    function buildCommunityMemberActions(community, member, isPending) {
      var isOwner = String(member.role || '').toUpperCase() === 'OWNER';
      var isBanned = String(member.status || '').toUpperCase() === 'BANNED';
      if (isPending || String(member.status || '').toUpperCase() === 'PENDING') {
        return [
          {
            action: 'APPROVE',
            label: 'Одобрить',
            loadingLabel: 'Одобряем...',
            successText: 'Заявка одобрена'
          },
          {
            action: 'REMOVE',
            label: 'Отклонить',
            loadingLabel: 'Отклоняем...',
            successText: 'Заявка отклонена'
          },
          {
            action: 'BAN',
            label: 'В бан',
            loadingLabel: 'Баним...',
            successText: 'Пользователь заблокирован',
            tone: 'danger'
          }
        ];
      }

      if (isBanned) {
        return [
          {
            action: 'UNBAN',
            label: 'Вернуть',
            loadingLabel: 'Возвращаем...',
            successText: 'Участник возвращён из бана'
          },
          {
            action: 'WARN',
            label: 'Предупредить',
            loadingLabel: 'Фиксируем...',
            successText: 'Предупреждение записано'
          },
          {
            action: 'REMOVE',
            label: 'Удалить',
            loadingLabel: 'Удаляем...',
            successText: 'Участник удалён окончательно',
            tone: 'danger'
          }
        ];
      }

      return [
        {
          action: String(member.role || '').toUpperCase() === 'ADMIN' ? 'DEMOTE' : 'PROMOTE',
          label: String(member.role || '').toUpperCase() === 'ADMIN' ? 'Понизить' : 'В модераторы',
          loadingLabel: 'Обновляем...',
          successText:
            String(member.role || '').toUpperCase() === 'ADMIN'
              ? 'Роль понижена до участника'
              : 'Участник назначен модератором',
          disabled: isOwner
        },
        {
          action: 'WARN',
          label: 'Предупредить',
          loadingLabel: 'Фиксируем...',
          successText: 'Предупреждение записано'
        },
        {
          action: 'REMOVE',
          label: 'Удалить',
          loadingLabel: 'Удаляем...',
          successText: 'Участник удалён',
          disabled: isOwner
        },
        {
          action: 'BAN',
          label: 'В бан',
          loadingLabel: 'Баним...',
          successText: 'Пользователь заблокирован',
          tone: 'danger',
          disabled: isOwner
        }
      ];
    }

    function renderCommunityOverviewTab(community, model) {
      var stack = document.createElement('div');
      stack.className = 'phab-admin-community-stack';
      dom.communityAdminGrid.appendChild(stack);

      var summaryCard = createCommunitySectionCard('Обзор', 'Главный экран модерации сообщества');
      stack.appendChild(summaryCard.card);
      var overviewGrid = document.createElement('div');
      overviewGrid.className = 'phab-admin-community-overview-grid';
      summaryCard.body.appendChild(overviewGrid);
      [
        { value: model.membersCount, label: 'участников' },
        { value: model.moderatorsCount, label: 'модераторов' },
        { value: model.pendingCount, label: 'новых заявок' },
        { value: model.bannedCount, label: 'заблокированы' },
        { value: model.posts7d, label: 'публикаций за 7 дней' },
        { value: model.chatActivity, label: 'активность в чате' },
        { value: model.reportCount, label: 'жалобы' },
        { value: model.rating + '%', label: 'рейтинг сообщества' },
        { value: model.engagement + '%', label: 'вовлечённость' }
      ].forEach(function (item) {
        var card = document.createElement('div');
        card.className = 'phab-admin-community-overview-card';
        var value = document.createElement('strong');
        value.textContent = String(item.value);
        var label = document.createElement('span');
        label.textContent = item.label;
        card.appendChild(value);
        card.appendChild(label);
        overviewGrid.appendChild(card);
      });

      var risksCard = createCommunitySectionCard('Риски и сигналы', 'Что требует внимания прямо сейчас');
      stack.appendChild(risksCard.card);
      var risksWrap = document.createElement('div');
      risksWrap.className = 'phab-admin-community-risk-row';
      risksCard.body.appendChild(risksWrap);
      if (model.riskFlags.length === 0) {
        risksWrap.appendChild(createCommunityPill('Критичных рисков нет', 'phab-admin-community-risk'));
      } else {
        model.riskFlags.forEach(function (risk) {
          risksWrap.appendChild(
            createCommunityPill(
              risk.label,
              'phab-admin-community-risk' +
                (risk.tone === 'danger' ? ' phab-admin-community-risk-danger' : '')
            )
          );
        });
      }

      var scenariosCard = createCommunitySectionCard('Быстрые сценарии', 'MVP для системных действий модератора');
      stack.appendChild(scenariosCard.card);
      var actionsWrap = document.createElement('div');
      actionsWrap.className = 'phab-admin-community-card-actions';
      scenariosCard.body.appendChild(actionsWrap);
      actionsWrap.appendChild(
        createCommunityActionButton(
          'Заморозить сообщество',
          'phab-admin-community-card-action',
          function () {
            saveCommunitySettings(community.id, {
              status: 'PAUSED',
              visibility: 'CLOSED'
            }).catch(handleError);
          },
          state.communitySavingId === community.id
        )
      );
      actionsWrap.appendChild(
        createCommunityActionButton(
          'Ограничить новых участников',
          'phab-admin-community-card-action',
          function () {
            saveCommunitySettings(community.id, {
              joinRule: 'MODERATED'
            }).catch(handleError);
          },
          state.communitySavingId === community.id
        )
      );
      actionsWrap.appendChild(
        createCommunityActionButton(
          'Включить премодерацию',
          'phab-admin-community-card-action',
          function () {
            saveCommunitySettings(community.id, {
              status: 'MODERATION',
              joinRule: 'MODERATED'
            }).catch(handleError);
          },
          state.communitySavingId === community.id
        )
      );
      actionsWrap.appendChild(
        createCommunityActionButton(
          'Очистить чат от спама',
          'phab-admin-community-card-action',
          function () {
            setCommunityPreviewActionNotice('Очистка чата');
          }
        )
      );

      var historyCard = createCommunitySectionCard('История действий', 'Кто и когда менял состояние сообщества');
      stack.appendChild(historyCard.card);
      var historyList = document.createElement('div');
      historyList.className = 'phab-admin-community-history-list';
      historyCard.body.appendChild(historyList);
      model.historyEntries.forEach(function (entry) {
        var row = document.createElement('div');
        row.className = 'phab-admin-community-history-row';
        var left = document.createElement('div');
        var title = document.createElement('strong');
        title.textContent = entry.title;
        var meta = document.createElement('span');
        meta.textContent = entry.meta || 'Без деталей';
        left.appendChild(title);
        left.appendChild(meta);
        row.appendChild(left);
        historyList.appendChild(row);
      });
    }

    function renderCommunitySettingsTab(community, model) {
      var settingsCard = createCommunitySectionCard('Настройки', 'Конфигурация сообщества и базовые ограничения');
      dom.communityAdminGrid.appendChild(settingsCard.card);

      var form = document.createElement('div');
      form.className = 'phab-admin-community-form-grid';
      settingsCard.body.appendChild(form);

      var nameInput = document.createElement('input');
      nameInput.className = 'phab-admin-input';
      nameInput.value = String(community.name || '');
      appendCommunityFormField(form, 'Название', nameInput);

      var statusSelect = document.createElement('select');
      statusSelect.className = 'phab-admin-input';
      [
        { value: 'ACTIVE', label: 'Открыто' },
        { value: 'PRIVATE', label: 'Закрыто' },
        { value: 'HIDDEN', label: 'Скрыто' },
        { value: 'PAUSED', label: 'На паузе' },
        { value: 'MODERATION', label: 'Ограничить публикации' }
      ].forEach(function (item) {
        var option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        statusSelect.appendChild(option);
      });
      statusSelect.value =
        model.status.key === 'OPEN'
          ? 'ACTIVE'
          : model.status.key === 'CLOSED'
            ? 'PRIVATE'
            : model.status.key;
      appendCommunityFormField(form, 'Статус', statusSelect);

      var cityInput = document.createElement('input');
      cityInput.className = 'phab-admin-input';
      cityInput.value = String(community.city || '');
      appendCommunityFormField(form, 'Город', cityInput);

      var visibilitySelect = document.createElement('select');
      visibilitySelect.className = 'phab-admin-input';
      [
        { value: 'OPEN', label: 'Показывать в каталоге' },
        { value: 'CLOSED', label: 'Скрыть из каталога' }
      ].forEach(function (item) {
        var option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        visibilitySelect.appendChild(option);
      });
      visibilitySelect.value = String(community.visibility || 'OPEN').toUpperCase();
      appendCommunityFormField(form, 'Видимость', visibilitySelect);

      var joinRuleSelect = document.createElement('select');
      joinRuleSelect.className = 'phab-admin-input';
      [
        { value: 'INSTANT', label: 'Свободный вход' },
        { value: 'MODERATED', label: 'После модерации' },
        { value: 'INVITE_ONLY', label: 'Только по приглашению' }
      ].forEach(function (item) {
        var option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        joinRuleSelect.appendChild(option);
      });
      joinRuleSelect.value = String(community.joinRule || 'INSTANT').toUpperCase();
      appendCommunityFormField(form, 'Правило вступления', joinRuleSelect);

      var levelInput = document.createElement('input');
      levelInput.className = 'phab-admin-input';
      levelInput.value = String(community.minimumLevel || '');
      appendCommunityFormField(form, 'Мин. уровень', levelInput);

      var slugInput = document.createElement('input');
      slugInput.className = 'phab-admin-input';
      slugInput.value = String(community.slug || '');
      slugInput.disabled = true;
      appendCommunityFormField(form, 'Slug', slugInput);

      var verifiedInput = document.createElement('input');
      verifiedInput.type = 'checkbox';
      verifiedInput.checked = isCommunityVerified(community);
      appendCommunityFormField(form, 'Верификация', verifiedInput);

      var tagsInput = document.createElement('input');
      tagsInput.className = 'phab-admin-input';
      tagsInput.value = getCommunityFocusTags(community).join(', ');
      appendCommunityFormField(form, 'Активности / теги', tagsInput);

      var logoInput = document.createElement('input');
      logoInput.className = 'phab-admin-input';
      logoInput.value = String(community.logo || '');
      appendCommunityFormField(form, 'Лого / обложка', logoInput);

      var descriptionInput = document.createElement('textarea');
      descriptionInput.className = 'phab-admin-input';
      descriptionInput.rows = 4;
      descriptionInput.value = String(community.description || '');
      appendCommunityFormField(form, 'Описание', descriptionInput, true);

      var rulesInput = document.createElement('textarea');
      rulesInput.className = 'phab-admin-input';
      rulesInput.rows = 5;
      rulesInput.value = String(community.rules || '');
      appendCommunityFormField(form, 'Правила', rulesInput, true);

      var metaInfo = createCommunitySectionCard('Модераторские правила', 'Что уже считается системным поведением');
      dom.communityAdminGrid.appendChild(metaInfo.card);
      var infoWrap = document.createElement('div');
      infoWrap.className = 'phab-admin-community-risk-row';
      metaInfo.body.appendChild(infoWrap);
      [
        'Публикации: ' + (statusSelect.value === 'MODERATION' ? 'на проверке' : 'свободно'),
        'Чат: ' + (joinRuleSelect.value === 'MODERATED' ? 'под вниманием' : 'открыт участникам'),
        'Уровень: от ' + String(levelInput.value || 'любого'),
        'Рейтинг: ' + String(model.rating) + '%'
      ].forEach(function (item) {
        infoWrap.appendChild(createCommunityPill(item, 'phab-admin-community-mini-chip'));
      });

      var saveActions = document.createElement('div');
      saveActions.className = 'phab-admin-community-form-actions';
      settingsCard.body.appendChild(saveActions);

      var saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'phab-admin-btn-secondary';
      saveBtn.disabled = state.communitySavingId === community.id;
      saveBtn.textContent =
        state.communitySavingId === community.id ? 'Сохраняем...' : 'Сохранить настройки';
      saveBtn.addEventListener('click', function () {
        var payload = buildCommunitySettingsPayload(community, {
          name: String(nameInput.value || '').trim(),
          status: statusSelect.value,
          city: String(cityInput.value || '').trim(),
          visibility: visibilitySelect.value,
          joinRule: joinRuleSelect.value,
          minimumLevel: String(levelInput.value || '').trim(),
          isVerified: Boolean(verifiedInput.checked),
          focusTags: tagsInput.value,
          logo: String(logoInput.value || '').trim() || null,
          description: String(descriptionInput.value || '').trim(),
          rules: String(rulesInput.value || '').trim()
        });
        if (!Object.keys(payload).length) {
          setStatus('Изменений нет', false);
          return;
        }
        saveCommunitySettings(community.id, payload).catch(handleError);
      });
      saveActions.appendChild(saveBtn);
    }

    function renderCommunityMembersTab(community, model) {
      var card = createCommunitySectionCard('Участники', 'Владельцы, модераторы, обычные участники и новые');
      card.card.classList.add('phab-admin-community-section-card-fill');
      card.body.classList.add('phab-admin-community-section-body-fill');
      dom.communityAdminGrid.appendChild(card.card);

      var segments = document.createElement('div');
      segments.className = 'phab-admin-community-segments';
      card.body.appendChild(segments);

      var segmentMap = getCommunityMemberFilters(model);
      [
        { key: 'ALL', label: 'Все' },
        { key: 'OWNERS', label: 'Владельцы' },
        { key: 'MODS', label: 'Модераторы' },
        { key: 'MEMBERS', label: 'Участники' },
        { key: 'NEW', label: 'Новые' },
        { key: 'BANNED', label: 'В бане' }
      ].forEach(function (item) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className =
          'phab-admin-community-segment' +
          (state.communityMembersSegment === item.key ? ' phab-admin-community-segment-active' : '');
        button.textContent =
          item.label + ' (' + String((segmentMap[item.key] || []).length) + ')';
        button.addEventListener('click', function () {
          state.communityMembersSegment = item.key;
          renderCommunityDetails();
        });
        segments.appendChild(button);
      });

      var list = document.createElement('div');
      list.className = 'phab-admin-settings-list phab-admin-community-members-list';
      card.body.appendChild(list);
      var currentSegment = segmentMap[state.communityMembersSegment]
        ? state.communityMembersSegment
        : 'ALL';
      var members = segmentMap[currentSegment] || segmentMap.ALL || [];
      if (members.length === 0) {
        appendCommunityListEmpty(
          list,
          currentSegment === 'BANNED'
            ? 'Сейчас в бане никого нет'
            : 'Нет участников для выбранного сегмента'
        );
      } else {
        members
          .slice()
          .sort(function (left, right) {
            return String(left.name || '').localeCompare(String(right.name || ''), 'ru');
          })
          .forEach(function (member) {
            appendCommunityMemberRow(
              list,
              community,
              member,
              buildCommunityMemberActions(
                community,
                member,
                currentSegment === 'NEW'
              )
            );
          });
      }
    }

    function renderCommunityApplicationsTab(community, model) {
      var card = createCommunitySectionCard('Заявки', 'Люди, которые ждут решения модератора');
      dom.communityAdminGrid.appendChild(card.card);

      var intro = document.createElement('div');
      intro.className = 'phab-admin-community-risk-row';
      intro.appendChild(
        createCommunityPill(
          'Новых заявок: ' + String(model.pendingCount),
          model.pendingCount > 0
            ? 'phab-admin-community-signal phab-admin-community-signal-strong'
            : 'phab-admin-community-signal'
        )
      );
      intro.appendChild(
        createCommunityPill(
          'Режим доступа: ' + getCommunityJoinRuleLabel(community.joinRule),
          'phab-admin-community-mini-chip'
        )
      );
      card.body.appendChild(intro);

      var list = document.createElement('div');
      list.className = 'phab-admin-settings-list';
      card.body.appendChild(list);
      if (model.pendingMembers.length === 0) {
        appendCommunityListEmpty(list, 'Новых заявок нет');
      } else {
        model.pendingMembers.forEach(function (member) {
          appendCommunityMemberRow(list, community, member, buildCommunityMemberActions(community, member, true));
        });
      }

      var note = createCommunitySectionCard('Комментарий модератора', 'Дополнительные сценарии пока идут как следующий этап API');
      dom.communityAdminGrid.appendChild(note.card);
      var noteWrap = document.createElement('div');
      noteWrap.className = 'phab-admin-community-risk-row';
      [
        'Запросить уточнение',
        'Тестовый доступ',
        'Взаимные контакты',
        'Рекомендации'
      ].forEach(function (item) {
        noteWrap.appendChild(createCommunityPill(item, 'phab-admin-community-mini-chip'));
      });
      note.body.appendChild(noteWrap);
    }

    function renderCommunityContentTab(community, model) {
      var composerCard = createCommunitySectionCard(
        'Новая карточка',
        'Создание news / game / tournament / ad карточек для ленты сообщества'
      );
      dom.communityAdminGrid.appendChild(composerCard.card);

      var composerForm = document.createElement('div');
      composerForm.className = 'phab-admin-community-form-grid';
      composerCard.body.appendChild(composerForm);

      var kindSelect = document.createElement('select');
      kindSelect.className = 'phab-admin-input';
      [
        { value: 'NEWS', label: 'Новость' },
        { value: 'GAME', label: 'Игра' },
        { value: 'TOURNAMENT', label: 'Турнир' },
        { value: 'AD', label: 'Реклама / промо' }
      ].forEach(function (item) {
        var option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        kindSelect.appendChild(option);
      });
      appendCommunityFormField(composerForm, 'Тип карточки', kindSelect);

      var titleInput = document.createElement('input');
      titleInput.className = 'phab-admin-input';
      titleInput.placeholder = 'Например: Игра в Дурака';
      appendCommunityFormField(composerForm, 'Заголовок', titleInput);

      var previewInput = document.createElement('input');
      previewInput.className = 'phab-admin-input';
      previewInput.placeholder = 'Терехово • Корт №9 панорамик';
      appendCommunityFormField(composerForm, 'Подпись / превью', previewInput);

      var ctaInput = document.createElement('input');
      ctaInput.className = 'phab-admin-input';
      ctaInput.placeholder = 'Открыть / Внести результаты игры';
      appendCommunityFormField(composerForm, 'Текст CTA', ctaInput);

      var imageInput = document.createElement('input');
      imageInput.className = 'phab-admin-input';
      imageInput.placeholder = 'https://... или data:image/...';
      appendCommunityFormField(composerForm, 'Изображение', imageInput);

      var startInput = document.createElement('input');
      startInput.type = 'datetime-local';
      startInput.className = 'phab-admin-input';
      appendCommunityFormField(composerForm, 'Начало', startInput);

      var endInput = document.createElement('input');
      endInput.type = 'datetime-local';
      endInput.className = 'phab-admin-input';
      appendCommunityFormField(composerForm, 'Конец', endInput);

      var stationInput = document.createElement('input');
      stationInput.className = 'phab-admin-input';
      stationInput.value = String(community.stationName || community.stationId || '');
      appendCommunityFormField(composerForm, 'Станция / клуб', stationInput);

      var courtInput = document.createElement('input');
      courtInput.className = 'phab-admin-input';
      courtInput.placeholder = 'Корт №5 панорамик';
      appendCommunityFormField(composerForm, 'Корт / площадка', courtInput);

      var levelInput = document.createElement('input');
      levelInput.className = 'phab-admin-input';
      levelInput.placeholder = 'D+, C, C+';
      appendCommunityFormField(composerForm, 'Уровень', levelInput);

      var authorInput = document.createElement('input');
      authorInput.className = 'phab-admin-input';
      authorInput.placeholder = 'Alexey Sergeev';
      appendCommunityFormField(composerForm, 'Автор', authorInput);

      var participantsInput = document.createElement('textarea');
      participantsInput.className = 'phab-admin-input';
      participantsInput.rows = 3;
      participantsInput.placeholder = 'Имена участников через запятую';
      appendCommunityFormField(composerForm, 'Участники', participantsInput, true);

      var tagsInput = document.createElement('input');
      tagsInput.className = 'phab-admin-input';
      tagsInput.placeholder = 'игра, сообщество, турнир';
      appendCommunityFormField(composerForm, 'Теги', tagsInput, true);

      var bodyInput = document.createElement('textarea');
      bodyInput.className = 'phab-admin-input';
      bodyInput.rows = 4;
      bodyInput.placeholder = 'Описание карточки';
      appendCommunityFormField(composerForm, 'Описание', bodyInput, true);

      var composerActions = document.createElement('div');
      composerActions.className = 'phab-admin-community-form-actions';
      composerCard.body.appendChild(composerActions);

      var createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.className = 'phab-admin-btn-secondary';
      createBtn.disabled = state.communityFeedCreatingId === community.id;
      createBtn.textContent =
        state.communityFeedCreatingId === community.id ? 'Создаём...' : 'Создать карточку';
      createBtn.addEventListener('click', function () {
        var kind = String(kindSelect.value || 'NEWS').toUpperCase();
        createCommunityFeedItem(community, {
          kind: kind,
          title: String(titleInput.value || '').trim(),
          body: String(bodyInput.value || '').trim(),
          previewLabel: String(previewInput.value || '').trim(),
          ctaLabel: String(ctaInput.value || '').trim(),
          imageUrl: String(imageInput.value || '').trim() || null,
          startAt: startInput.value ? new Date(startInput.value).toISOString() : undefined,
          endAt: endInput.value ? new Date(endInput.value).toISOString() : undefined,
          stationName: String(stationInput.value || '').trim(),
          courtName: String(courtInput.value || '').trim(),
          levelLabel: String(levelInput.value || '').trim(),
          authorName: String(authorInput.value || '').trim(),
          participants: String(participantsInput.value || '')
            .split(',')
            .map(function (item) {
              return String(item || '').trim();
            })
            .filter(Boolean)
            .map(function (name) {
              return { name: name };
            }),
          tags: String(tagsInput.value || '')
            .split(',')
            .map(function (item) {
              return String(item || '').trim();
            })
            .filter(Boolean)
        }).catch(handleError);
      });
      composerActions.appendChild(createBtn);

      var card = createCommunitySectionCard('Контент', 'Превью публикаций и быстрые модераторские действия');
      dom.communityAdminGrid.appendChild(card.card);
      var feedIntro = document.createElement('div');
      feedIntro.className = 'phab-admin-community-risk-row';
      if (state.communityFeedLoadingId === community.id) {
        feedIntro.appendChild(createCommunityPill('Загружаем живую ленту...', 'phab-admin-community-signal'));
      } else if (state.communityFeedErrorById[community.id]) {
        feedIntro.appendChild(
          createCommunityPill(
            'Лента: ' + String(state.communityFeedErrorById[community.id]),
            'phab-admin-community-signal phab-admin-community-signal-strong'
          )
        );
      } else if (state.communityFeedLoadedById[community.id]) {
        feedIntro.appendChild(createCommunityPill('Источник: live feed', 'phab-admin-community-mini-chip'));
      }
      if (state.communityManagedFeedLoadingId === community.id) {
        feedIntro.appendChild(createCommunityPill('Подтягиваем карточки админки...', 'phab-admin-community-signal'));
      } else if (state.communityManagedFeedErrorById[community.id]) {
        feedIntro.appendChild(
          createCommunityPill(
            'Админка: ' + String(state.communityManagedFeedErrorById[community.id]),
            'phab-admin-community-signal phab-admin-community-signal-strong'
          )
        );
      } else if (state.communityManagedFeedLoadedById[community.id]) {
        feedIntro.appendChild(
          createCommunityPill(
            'Карточек из админки: ' + String((state.communityManagedFeedById[community.id] || []).length),
            'phab-admin-community-mini-chip'
          )
        );
      }
      if (state.communityFeedLoadingMoreId === community.id) {
        feedIntro.appendChild(
          createCommunityPill('Подгружаем ещё события и публикации...', 'phab-admin-community-signal')
        );
      } else if (state.communityFeedHasMoreById[community.id]) {
        feedIntro.appendChild(
          createCommunityPill('Листайте ниже для следующей страницы', 'phab-admin-community-mini-chip')
        );
      }
      card.body.appendChild(feedIntro);

      if (model.feedPosts.length === 0) {
        appendCommunityListEmpty(card.body, 'В ленте пока нет публикаций');
        return;
      }

      model.feedPosts.forEach(function (post) {
        card.body.appendChild(createCommunityFeedCard(post, createCommunityFeedActionItems(community, post), community));
      });
    }

    function renderCommunityChatTab(community, model) {
      var card = createCommunitySectionCard('Чат', 'Подозрительные сообщения и live preview');
      dom.communityAdminGrid.appendChild(card.card);
      var chatIntro = document.createElement('div');
      chatIntro.className = 'phab-admin-community-risk-row';
      if (state.communityChatLoadingId === community.id) {
        chatIntro.appendChild(createCommunityPill('Загружаем live chat...', 'phab-admin-community-signal'));
      } else if (state.communityChatErrorById[community.id]) {
        chatIntro.appendChild(
          createCommunityPill(
            'Чат: ' + String(state.communityChatErrorById[community.id]),
            'phab-admin-community-signal phab-admin-community-signal-strong'
          )
        );
      } else if (state.communityChatLoadedById[community.id]) {
        chatIntro.appendChild(createCommunityPill('Источник: live chat', 'phab-admin-community-mini-chip'));
      }
      card.body.appendChild(chatIntro);

      if (model.chatMessages.length === 0) {
        appendCommunityListEmpty(card.body, 'Сообщений сообщества пока нет');
        return;
      }

      model.chatMessages.forEach(function (message) {
        var preview = document.createElement('div');
        preview.className = 'phab-admin-community-preview-card';
        var top = document.createElement('div');
        top.className = 'phab-admin-community-preview-message-top';
        var left = document.createElement('div');
        var kicker = document.createElement('div');
        kicker.className = 'phab-admin-community-preview-kicker';
        kicker.textContent = message.authorName;
        var text = document.createElement('div');
        text.className = 'phab-admin-community-preview-text';
        text.style.marginTop = '6px';
        text.textContent = message.text;
        left.appendChild(kicker);
        left.appendChild(text);
        top.appendChild(left);
        preview.appendChild(top);
        var actions = document.createElement('div');
        actions.className = 'phab-admin-community-preview-actions';
        [
          { label: 'Удалить', className: 'phab-admin-community-preview-action' },
          { label: 'Скрыть', className: 'phab-admin-community-preview-action' },
          { label: 'Мут 1 день', className: 'phab-admin-community-preview-action' },
          { label: 'Забанить', className: 'phab-admin-community-preview-action phab-admin-community-preview-action-danger' }
        ].forEach(function (item) {
          actions.appendChild(
            createCommunityActionButton(item.label, item.className, function () {
              setCommunityPreviewActionNotice(item.label);
            })
          );
        });
        preview.appendChild(actions);
        card.body.appendChild(preview);
      });
    }

    function renderCommunityRatingTab(community, model) {
      var card = createCommunitySectionCard('Рейтинг', 'Как сейчас выглядит качество сообщества');
      dom.communityAdminGrid.appendChild(card.card);
      var ratingIntro = document.createElement('div');
      ratingIntro.className = 'phab-admin-community-risk-row';
      if (state.communityRankingLoadingId === community.id) {
        ratingIntro.appendChild(createCommunityPill('Загружаем live ranking...', 'phab-admin-community-signal'));
      } else if (state.communityRankingErrorById[community.id]) {
        ratingIntro.appendChild(
          createCommunityPill(
            'Рейтинг: ' + String(state.communityRankingErrorById[community.id]),
            'phab-admin-community-signal phab-admin-community-signal-strong'
          )
        );
      } else if (state.communityRankingLoadedById[community.id]) {
        ratingIntro.appendChild(createCommunityPill('Источник: live ranking', 'phab-admin-community-mini-chip'));
      }
      card.body.appendChild(ratingIntro);
      var ratingList = document.createElement('div');
      ratingList.className = 'phab-admin-community-rating-list';
      card.body.appendChild(ratingList);
      if (model.rankingRows.length === 0) {
        appendCommunityListEmpty(ratingList, 'Рейтинг пока пуст');
        return;
      }
      model.rankingRows.forEach(function (row, index) {
        var ratingRow = document.createElement('div');
        ratingRow.className = 'phab-admin-community-rating-row';
        var left = document.createElement('div');
        var title = document.createElement('strong');
        title.textContent = String(index + 1) + '. ' + row.name;
        var meta = document.createElement('span');
        meta.textContent =
          [row.role, row.levelLabel ? 'уровень ' + row.levelLabel : null]
            .filter(Boolean)
            .join(' · ');
        left.appendChild(title);
        left.appendChild(meta);
        var score = document.createElement('strong');
        score.textContent = String(row.score);
        ratingRow.appendChild(left);
        ratingRow.appendChild(score);
        ratingList.appendChild(ratingRow);
      });
    }

    function renderCommunityCenterTab(community, model) {
      clearNode(dom.communityAdminGrid);
      if (state.communityCenterTab === 'settings') {
        renderCommunitySettingsTab(community, model);
        return;
      }
      if (state.communityCenterTab === 'participants') {
        renderCommunityMembersTab(community, model);
        return;
      }
      if (state.communityCenterTab === 'applications') {
        renderCommunityApplicationsTab(community, model);
        return;
      }
      if (state.communityCenterTab === 'content') {
        renderCommunityContentTab(community, model);
        return;
      }
      if (state.communityCenterTab === 'chat') {
        renderCommunityChatTab(community, model);
        return;
      }
      if (state.communityCenterTab === 'rating') {
        renderCommunityRatingTab(community, model);
        return;
      }
      renderCommunityOverviewTab(community, model);
    }

    function renderCommunityPreview(community, model) {
      clearNode(dom.communityPreviewBody);
      dom.communityPreviewTitle.textContent = 'Модерация сообщества';
      dom.communityPreviewMeta.textContent = String(community.name || 'Сообщество');

      var shell = document.createElement('div');
      shell.className = 'phab-admin-community-preview-frame';
      dom.communityPreviewBody.appendChild(shell);

      var mobileHead = document.createElement('div');
      mobileHead.className = 'phab-admin-community-lk-head';
      shell.appendChild(mobileHead);

      var avatar = document.createElement('div');
      avatar.className = 'phab-admin-community-avatar';
      renderCommunityAvatarNode(avatar, community);
      mobileHead.appendChild(avatar);

      var mobileHeadMain = document.createElement('div');
      mobileHeadMain.className = 'phab-admin-community-lk-head-main';
      mobileHead.appendChild(mobileHeadMain);

      var mobileName = document.createElement('div');
      mobileName.className = 'phab-admin-community-lk-name';
      mobileName.textContent = String(community.name || 'Сообщество');
      mobileHeadMain.appendChild(mobileName);

      var mobileSubtitle = document.createElement('div');
      mobileSubtitle.className = 'phab-admin-community-lk-subtitle';
      mobileSubtitle.textContent = [
        community.stationName || community.stationId || 'Станция не указана',
        community.city || null,
        isCommunityVerified(community) ? 'верифицировано' : null
      ]
        .filter(Boolean)
        .join(' • ');
      mobileHeadMain.appendChild(mobileSubtitle);

      var previewTabs = document.createElement('div');
      previewTabs.className = 'phab-admin-community-preview-tabs';
      shell.appendChild(previewTabs);
      [
        { key: 'feed', label: 'Лента' },
        { key: 'chat', label: 'Чат' },
        { key: 'rating', label: 'Рейтинг' },
        { key: 'about', label: 'О сообществе' }
      ].forEach(function (item) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className =
          'phab-admin-community-tab' +
          (state.communityPreviewTab === item.key ? ' phab-admin-community-tab-active' : '');
        button.textContent = item.label;
        button.addEventListener('click', function () {
          state.communityPreviewTab = item.key;
          renderCommunityDetails();
        });
        previewTabs.appendChild(button);
      });

      if (state.communityPreviewTab === 'feed') {
        var segments = document.createElement('div');
        segments.className = 'phab-admin-community-lk-segments';
        shell.appendChild(segments);
        [
          { key: 'ALL', label: 'Все' },
          { key: 'GAME', label: 'Игры' },
          { key: 'TOURNAMENT', label: 'Турниры' },
          { key: 'EVENT', label: 'События' },
          { key: 'NEWS', label: 'Новости' },
          { key: 'AD', label: 'Реклама' }
        ].forEach(function (item) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className =
            'phab-admin-community-lk-segment' +
            (String(state.communityPreviewFeedSegment || 'ALL') === item.key
              ? ' phab-admin-community-lk-segment-active'
              : '');
          button.setAttribute('aria-label', item.label);
          button.title = item.label;

          var iconNode = document.createElement('span');
          iconNode.className = 'phab-admin-community-lk-segment-icon';
          iconNode.innerHTML = getCommunityPreviewFeedSegmentIconMarkup(item.key);
          button.appendChild(iconNode);

          var labelNode = document.createElement('span');
          labelNode.className = 'phab-admin-community-lk-segment-label';
          labelNode.textContent = item.label;
          button.appendChild(labelNode);

          button.addEventListener('click', function () {
            state.communityPreviewFeedSegment = item.key;
            renderCommunityDetails();
          });
          segments.appendChild(button);
        });
      }

      if (state.communityPreviewTab === 'chat') {
        if (state.communityChatLoadingId === community.id) {
          shell.appendChild(
            createCommunityPill('Подтягиваем живые сообщения сообщества...', 'phab-admin-community-signal')
          );
        } else if (state.communityChatErrorById[community.id]) {
          shell.appendChild(
            createCommunityPill(
              String(state.communityChatErrorById[community.id]),
              'phab-admin-community-signal phab-admin-community-signal-strong'
            )
          );
        }
        if (model.previewMessages.length === 0) {
          appendCommunityListEmpty(shell, 'Сообщений для превью пока нет');
          return;
        }
        model.previewMessages.forEach(function (message) {
          var card = document.createElement('div');
          card.className = 'phab-admin-community-preview-card';
          var kicker = document.createElement('div');
          kicker.className = 'phab-admin-community-preview-kicker';
          kicker.textContent = message.authorName + ' · ' + formatDateTimeFull(message.createdAt);
          card.appendChild(kicker);
          var text = document.createElement('div');
          text.className = 'phab-admin-community-preview-text';
          text.textContent = message.text;
          card.appendChild(text);
          var actions = document.createElement('div');
          actions.className = 'phab-admin-community-preview-actions';
          ['Удалить', 'Скрыть', 'Предупредить', 'Забанить'].forEach(function (label) {
            actions.appendChild(
              createCommunityActionButton(
                label,
                'phab-admin-community-preview-action' +
                  (label === 'Забанить' ? ' phab-admin-community-preview-action-danger' : ''),
                function () {
                  setCommunityPreviewActionNotice(label);
                }
              )
            );
          });
          card.appendChild(actions);
          shell.appendChild(card);
        });
        return;
      }

      if (state.communityPreviewTab === 'rating') {
        var ratingCard = document.createElement('div');
        ratingCard.className = 'phab-admin-community-preview-card';
        var title = document.createElement('div');
        title.className = 'phab-admin-community-preview-title';
        title.style.fontSize = '18px';
        title.textContent = 'Общий балл: ' + String(model.rating) + '%';
        ratingCard.appendChild(title);
        if (state.communityRankingLoadingId === community.id) {
          ratingCard.appendChild(
            createCommunityPill('Обновляем live ranking...', 'phab-admin-community-signal')
          );
        } else if (state.communityRankingErrorById[community.id]) {
          ratingCard.appendChild(
            createCommunityPill(
              String(state.communityRankingErrorById[community.id]),
              'phab-admin-community-signal phab-admin-community-signal-strong'
            )
          );
        }
        var ratingList = document.createElement('div');
        ratingList.className = 'phab-admin-community-rating-list';
        ratingCard.appendChild(ratingList);
        if (model.previewRankingRows.length === 0) {
          appendCommunityListEmpty(ratingList, 'Рейтинг сообщества пока недоступен');
        }
        model.previewRankingRows.forEach(function (row, index) {
          var rowNode = document.createElement('div');
          rowNode.className = 'phab-admin-community-rating-row';
          var left = document.createElement('div');
          var leftTitle = document.createElement('strong');
          leftTitle.textContent = String(index + 1) + '. ' + row.name;
          var meta = document.createElement('span');
          meta.textContent = [row.role, row.levelLabel].filter(Boolean).join(' · ');
          left.appendChild(leftTitle);
          left.appendChild(meta);
          var value = document.createElement('strong');
          value.textContent = String(row.score);
          rowNode.appendChild(left);
          rowNode.appendChild(value);
          ratingList.appendChild(rowNode);
        });
        shell.appendChild(ratingCard);
        return;
      }

      if (state.communityPreviewTab === 'about') {
        var aboutCard = document.createElement('div');
        aboutCard.className = 'phab-admin-community-preview-card';
        var aboutGrid = document.createElement('div');
        aboutGrid.className = 'phab-admin-community-about-grid';
        aboutCard.appendChild(aboutGrid);
        [
          ['Статус', model.status.label],
          ['Верификация', isCommunityVerified(community) ? 'Подтверждено' : 'Не подтверждено'],
          ['Видимость', getCommunityVisibilityLabel(community.visibility)],
          ['Вступление', getCommunityJoinRuleLabel(community.joinRule)],
          ['Мин. уровень', String(community.minimumLevel || 'Не задан')],
          ['Рейтинг', String(model.rating) + '%'],
          ['Жалобы', String(model.reportCount)]
        ].forEach(function (item) {
          var box = document.createElement('div');
          box.className = 'phab-admin-community-about-item';
          var label = document.createElement('label');
          label.textContent = item[0];
          var value = document.createElement('strong');
          value.textContent = item[1];
          box.appendChild(label);
          box.appendChild(value);
          aboutGrid.appendChild(box);
        });
        if (String(community.description || '').trim()) {
          var text = document.createElement('div');
          text.className = 'phab-admin-community-preview-text';
          text.textContent = String(community.description || '');
          aboutCard.appendChild(text);
        }
        shell.appendChild(aboutCard);
        return;
      }

      var previewPosts = filterCommunityPreviewFeedPosts(model.feedPosts);

      if (state.communityFeedLoadingId === community.id) {
        shell.appendChild(
          createCommunityPill('Подтягиваем живую ленту сообщества...', 'phab-admin-community-signal')
        );
      } else if (state.communityFeedLoadingMoreId === community.id) {
        shell.appendChild(
          createCommunityPill('Подгружаем следующую страницу...', 'phab-admin-community-signal')
        );
      } else if (state.communityFeedErrorById[community.id]) {
        shell.appendChild(
          createCommunityPill(
            String(state.communityFeedErrorById[community.id]),
            'phab-admin-community-signal phab-admin-community-signal-strong'
          )
        );
      } else if (state.communityFeedHasMoreById[community.id]) {
        shell.appendChild(
          createCommunityPill('Прокрутите ниже, чтобы догрузить ещё', 'phab-admin-community-mini-chip')
        );
      }

      if (previewPosts.length === 0) {
        appendCommunityListEmpty(shell, 'Лента сообщества пока пуста');
        return;
      }

      previewPosts.forEach(function (post) {
        shell.appendChild(createCommunityFeedCard(post, createCommunityFeedActionItems(community, post), community));
      });
    }

    function renderCommunityDetails() {
      var community = getSelectedCommunity();
      clearNode(dom.communityTags);
      clearNode(dom.communityLinks);
      clearNode(dom.communityStats);
      clearNode(dom.communityTabs);
      clearNode(dom.communityActions);
      clearNode(dom.communityAdminGrid);
      clearNode(dom.communityPreviewBody);

      if (!community) {
        dom.communityTitle.textContent = 'Сообщество не выбрано';
        dom.communityMeta.textContent =
          'Выберите сообщество слева, чтобы открыть модераторский интерфейс и параметры.';
        dom.communityPreviewTitle.textContent = 'Модерация сообщества';
        dom.communityPreviewMeta.textContent = 'Выберите карточку слева';
        renderCommunityAvatarNode(dom.communityAvatar, { name: 'CM', logo: '' });
        appendCommunityListEmpty(dom.communityAdminGrid, 'Слева выберите сообщество для модерации.');
        appendCommunityListEmpty(dom.communityPreviewBody, 'Превью появится после выбора сообщества.');
        return;
      }

      ensureCommunityLiveData(community).catch(handleError);

      var model = buildCommunityModeratorModel(community);
      model.feedPosts = applyCommunityFeedModeration(community.id, getCommunityFeedPosts(community, model));
      model.previewPosts = model.feedPosts.slice(0, 3);
      model.chatMessages = getCommunityChatMessages(community, model);
      model.previewMessages = getCommunityPreviewMessages(community, model);
      model.rankingRows = getCommunityRankingRows(community, model);
      model.previewRankingRows = model.rankingRows.slice(0, 5);
      model.historyEntries = getCommunityHistoryEntries(community, model);

      renderCommunityAvatarNode(dom.communityAvatar, community);
      dom.communityTitle.textContent = String(community.name || 'Сообщество');
      dom.communityMeta.textContent = [
        community.stationName || community.stationId || 'Без станции',
        community.city || null,
        community.lastActivityAt
          ? 'активность: ' + formatDateTimeFull(community.lastActivityAt)
          : community.updatedAt
            ? 'обновлено: ' + formatDateTimeFull(community.updatedAt)
            : null
      ]
        .filter(Boolean)
        .join(' · ');

      dom.communityTags.appendChild(createCommunityStatusBadge(model.status));
      if (isCommunityVerified(community)) {
        dom.communityTags.appendChild(
          createCommunityPill('Верифицировано', 'phab-admin-community-mini-chip phab-admin-community-mini-chip-verified')
        );
      }
      dom.communityTags.appendChild(
        createCommunityPill(
          getCommunityVisibilityLabel(community.visibility),
          'phab-admin-community-mini-chip'
        )
      );
      dom.communityTags.appendChild(
        createCommunityPill(
          getCommunityJoinRuleLabel(community.joinRule),
          'phab-admin-community-mini-chip'
        )
      );
      if (community.minimumLevel) {
        dom.communityTags.appendChild(
          createCommunityPill('Уровень ' + String(community.minimumLevel), 'phab-admin-community-mini-chip')
        );
      }
      getCommunityFocusTags(community).slice(0, 4).forEach(function (tag) {
        dom.communityTags.appendChild(createCommunityPill(String(tag), 'phab-admin-community-mini-chip'));
      });

      var externalLinks = [];
      if (community.moderationUrl) {
        externalLinks.push({ href: community.moderationUrl, label: 'Открыть модерацию' });
      }
      if (community.inviteLink) {
        externalLinks.push({ href: community.inviteLink, label: 'Инвайт' });
      }
      if (externalLinks.length > 0) {
        externalLinks.forEach(function (item) {
          var link = document.createElement('a');
          link.className = 'phab-admin-dialog-link';
          link.href = String(item.href);
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = item.label;
          dom.communityLinks.appendChild(link);
        });
        dom.communityLinks.style.display = 'flex';
      } else {
        dom.communityLinks.style.display = 'none';
      }

      [
        ['Участники', model.membersCount],
        ['Заявки', model.pendingCount],
        ['Жалобы', model.reportCount],
        ['Рейтинг', String(model.rating) + '%'],
        ['Чат', model.chatActivity],
        ['Публикации 7д', model.posts7d],
        ['Непросмотрено', model.unreadEventsCount],
        ['В бане', model.bannedCount]
      ].forEach(function (item) {
        dom.communityStats.appendChild(createCommunityStatCard(item[0], String(item[1])));
      });

      dom.communityActions.appendChild(
        createCommunityActionButton(
          model.status.key === 'HIDDEN' ? 'Показать' : 'Скрыть',
          'phab-admin-community-main-action phab-admin-community-main-action-danger',
          function () {
            saveCommunitySettings(community.id, {
              status: model.status.key === 'HIDDEN' ? 'ACTIVE' : 'HIDDEN',
              visibility: model.status.key === 'HIDDEN' ? 'OPEN' : 'CLOSED'
            }).catch(handleError);
          },
          state.communitySavingId === community.id
        )
      );
      dom.communityActions.appendChild(
        createCommunityActionButton(
          model.status.key === 'PAUSED' ? 'Разморозить' : 'Заморозить',
          'phab-admin-community-main-action phab-admin-community-main-action-warn',
          function () {
            saveCommunitySettings(community.id, {
              status: model.status.key === 'PAUSED' ? 'ACTIVE' : 'PAUSED',
              visibility: model.status.key === 'PAUSED' ? 'OPEN' : 'CLOSED'
            }).catch(handleError);
          },
          state.communitySavingId === community.id
        )
      );
      dom.communityActions.appendChild(
        createCommunityActionButton(
          state.communityDeletingId === community.id ? 'Удаляем...' : 'Удалить сообщество',
          'phab-admin-community-main-action phab-admin-community-main-action-danger',
          function () {
            deleteCommunity(community).catch(handleError);
          },
          state.communityDeletingId === community.id
        )
      );
      dom.communityActions.appendChild(
        createCommunityActionButton(
          'Ограничить публикации',
          'phab-admin-community-main-action',
          function () {
            saveCommunitySettings(community.id, {
              status: 'MODERATION',
              joinRule: 'MODERATED'
            }).catch(handleError);
          },
          state.communitySavingId === community.id
        )
      );
      dom.communityActions.appendChild(
        createCommunityActionButton(
          isCommunityVerified(community) ? 'Снять галочку' : 'Верифицировать',
          'phab-admin-community-main-action phab-admin-community-main-action-accent',
          function () {
            saveCommunitySettings(community.id, {
              isVerified: !isCommunityVerified(community)
            }).catch(handleError);
          },
          state.communitySavingId === community.id
        )
      );
      dom.communityActions.appendChild(
        createCommunityActionButton(
          'Назначить модератора',
          'phab-admin-community-main-action',
          function () {
            state.communityCenterTab = 'participants';
            state.communityMembersSegment = 'MEMBERS';
            renderCommunityDetails();
            setStatus('Выберите участника в центральной колонке и назначьте модератором.', false);
          }
        )
      );

      [
        { key: 'overview', label: 'Обзор' },
        { key: 'settings', label: 'Настройки' },
        { key: 'participants', label: 'Участники' },
        { key: 'applications', label: 'Заявки' },
        { key: 'content', label: 'Контент' },
        { key: 'chat', label: 'Чат' },
        { key: 'rating', label: 'Рейтинг' }
      ].forEach(function (item) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className =
          'phab-admin-community-tab' +
          (state.communityCenterTab === item.key ? ' phab-admin-community-tab-active' : '');
        button.textContent = item.label;
        button.addEventListener('click', function () {
          state.communityCenterTab = item.key;
          renderCommunityDetails();
        });
        dom.communityTabs.appendChild(button);
      });

      renderCommunityCenterTab(community, model);
      renderCommunityPreview(community, model);
    }

    function renderCommunities() {
      clearNode(dom.communitiesList);

      var filteredCommunities = sortCommunitiesForModeration(state.communities).filter(function (community) {
        return filterCommunitiesForModeration(community);
      });

      if (filteredCommunities.length === 0) {
        var emptyItem = document.createElement('li');
        var empty = document.createElement('div');
        empty.className = 'phab-admin-empty';
        empty.textContent = state.communitiesSearchQuery
          ? 'По вашему запросу сообщества не найдены'
          : 'Нет сообществ под выбранные фильтры';
        emptyItem.appendChild(empty);
        dom.communitiesList.appendChild(emptyItem);
        state.selectedCommunityId = null;
        renderCommunityDetails();
        return;
      }

      if (
        !filteredCommunities.some(function (community) {
          return community && community.id === state.selectedCommunityId;
        })
      ) {
        state.selectedCommunityId = filteredCommunities[0].id;
      }

      filteredCommunities.forEach(function (community) {
        var model = buildCommunityModeratorModel(community);
        var li = document.createElement('li');
        var article = document.createElement('article');
        article.className =
          'phab-admin-community-card' +
          (state.selectedCommunityId === community.id ? ' phab-admin-community-card-active' : '');
        li.appendChild(article);

        var selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'phab-admin-community-card-btn';
        selectBtn.addEventListener('click', function () {
          state.selectedCommunityId = community.id;
          renderCommunities();
        });
        article.appendChild(selectBtn);

        var head = document.createElement('div');
        head.className = 'phab-admin-community-card-head';
        selectBtn.appendChild(head);

        var avatar = document.createElement('div');
        avatar.className = 'phab-admin-community-avatar';
        renderCommunityAvatarNode(avatar, community);
        head.appendChild(avatar);

        var identity = document.createElement('div');
        var title = document.createElement('div');
        title.className = 'phab-admin-community-card-title';
        title.textContent = String(community.name || 'Сообщество');
        var meta = document.createElement('div');
        meta.className = 'phab-admin-community-card-meta';
        meta.textContent = [
          community.stationName || community.stationId || 'Без станции',
          community.city || null
        ]
          .filter(Boolean)
          .join(' · ');
        identity.appendChild(title);
        identity.appendChild(meta);
        head.appendChild(identity);
        head.appendChild(createCommunityStatusBadge(model.status));

        var activityRow = document.createElement('div');
        activityRow.className = 'phab-admin-community-activity-row';
        model.activityTypes.forEach(function (type) {
          if (String(type || '').trim() === 'Чат') {
            return;
          }
          activityRow.appendChild(createCommunityPill(type, 'phab-admin-community-mini-chip'));
        });
        if (activityRow.childNodes.length > 0) {
          selectBtn.appendChild(activityRow);
        }

        var signalRow = document.createElement('div');
        signalRow.className = 'phab-admin-community-signal-row';
        signalRow.appendChild(createCommunityPill('Участники ' + String(model.membersCount), 'phab-admin-community-signal'));
        signalRow.appendChild(
          createCommunityPill(
            'Заявки ' + String(model.pendingCount),
            'phab-admin-community-signal' +
              (model.pendingCount > 0 ? ' phab-admin-community-signal-strong' : '')
          )
        );
        signalRow.appendChild(
          createCommunityPill(
            'Жалобы ' + String(model.reportCount),
            'phab-admin-community-signal' +
              (model.reportCount > 0 ? ' phab-admin-community-signal-strong' : '')
          )
        );
        if (model.unreadEventsCount > 0) {
          signalRow.appendChild(
            createCommunityPill(
              'Новые события ' + String(model.unreadEventsCount),
              'phab-admin-community-signal'
            )
          );
        }
        selectBtn.appendChild(signalRow);

        var riskRow = document.createElement('div');
        riskRow.className = 'phab-admin-community-risk-row';
        if (model.riskFlags.length > 0) {
          model.riskFlags.slice(0, 3).forEach(function (risk) {
            riskRow.appendChild(
              createCommunityPill(
                risk.label,
                'phab-admin-community-risk' +
                  (risk.tone === 'danger' ? ' phab-admin-community-risk-danger' : '')
              )
            );
          });
        }
        if (riskRow.childNodes.length > 0) {
          selectBtn.appendChild(riskRow);
        }

        var actions = document.createElement('div');
        actions.className = 'phab-admin-community-card-actions';
        article.appendChild(actions);
        actions.appendChild(
          createCommunityActionButton('Открыть', 'phab-admin-community-card-action', function () {
            state.selectedCommunityId = community.id;
            state.communityCenterTab = 'overview';
            renderCommunities();
          })
        );
        actions.appendChild(
          createCommunityActionButton('В чат', 'phab-admin-community-card-action', function () {
            state.selectedCommunityId = community.id;
            state.communityPreviewTab = 'chat';
            renderCommunities();
          })
        );
        actions.appendChild(
          createCommunityActionButton(
            'Скрыть',
            'phab-admin-community-card-action phab-admin-community-card-action-danger',
            function () {
              saveCommunitySettings(community.id, {
                status: 'HIDDEN',
                visibility: 'CLOSED'
              }).catch(handleError);
            },
            state.communitySavingId === community.id
          )
        );
        actions.appendChild(
          createCommunityActionButton(
            'Заморозить',
            'phab-admin-community-card-action',
            function () {
              saveCommunitySettings(community.id, {
                status: 'PAUSED',
                visibility: 'CLOSED'
              }).catch(handleError);
            },
            state.communitySavingId === community.id
          )
        );

        dom.communitiesList.appendChild(li);
      });

      renderCommunityDetails();
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
            formatStationScope(user.stationIds) +
            ' · коннекторы: ' +
            formatConnectorScope(user.connectorRoutes);
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

    async function loadCommunities() {
      if (!canAccessCommunities(cfg)) {
        state.communities = [];
        state.selectedCommunityId = null;
        if (state.activeTab === 'communities') {
          switchTab('messages');
        }
        return;
      }
      state.communities = sortCommunities((await api.getCommunities()) || []);
      if (
        state.selectedCommunityId &&
        !state.communities.some(function (community) {
          return community && community.id === state.selectedCommunityId;
        })
      ) {
        state.selectedCommunityId = null;
      }
      if (!state.selectedCommunityId && state.communities.length > 0) {
        state.selectedCommunityId = state.communities[0].id;
      }
      dom.communitySearchInput.value = state.communitiesSearchQuery;
      renderCommunities();
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
      var attachments = normalizeMessageAttachments(state.pendingMessageAttachments);
      if ((!text && attachments.length === 0) || !state.selectedThreadId) {
        return;
      }

      dom.sendBtn.disabled = true;
      dom.attachBtn.disabled = true;
      try {
        await api.sendLegacyMessage(state.selectedThreadId, text, attachments);
        dom.input.value = '';
        resetPendingMessageAttachments();
        await loadDialogs();
        await loadMessages({ forceRender: true, forceScrollBottom: true });
        setStatus('Сообщение отправлено', false);
      } finally {
        dom.sendBtn.disabled = false;
        var selectedDialog = getSelectedDialog();
        dom.attachBtn.disabled = selectedDialog ? selectedDialog.isActiveForUser === false : !state.selectedThreadId;
      }
    }

    function switchTab(nextTab) {
      if (isRestrictedStationAdmin && ['logs', 'analytics', 'settings'].indexOf(nextTab) >= 0) {
        nextTab = 'messages';
      }
      if (!canAccessCommunities(cfg) && nextTab === 'communities') {
        nextTab = 'messages';
      }
      state.activeTab = nextTab;
      var isMessages = nextTab === 'messages';
      var isGames = nextTab === 'games';
      var isLogs = nextTab === 'logs';
      var isTournaments = nextTab === 'tournaments';
      var isCommunities = nextTab === 'communities';
      var isAnalytics = nextTab === 'analytics';
      var isSettings = nextTab === 'settings';
      var hideLogsTab = isRestrictedStationAdmin;
      var hideCommunitiesTab = !canAccessCommunities(cfg);
      var hideAnalyticsTab = isRestrictedStationAdmin;
      var hideSettingsTab = isRestrictedStationAdmin;

      dom.tabMessages.className = 'phab-admin-tab' + (isMessages ? ' phab-admin-tab-active' : '');
      dom.tabGames.className = 'phab-admin-tab' + (isGames ? ' phab-admin-tab-active' : '');
      dom.tabLogs.className =
        'phab-admin-tab' +
        (isLogs ? ' phab-admin-tab-active' : '') +
        (hideLogsTab ? ' phab-admin-hidden' : '');
      dom.tabTournaments.className =
        'phab-admin-tab' + (isTournaments ? ' phab-admin-tab-active' : '');
      dom.tabCommunities.className =
        'phab-admin-tab' +
        (isCommunities ? ' phab-admin-tab-active' : '') +
        (hideCommunitiesTab ? ' phab-admin-hidden' : '');
      dom.tabAnalytics.className =
        'phab-admin-tab' +
        (isAnalytics ? ' phab-admin-tab-active' : '') +
        (hideAnalyticsTab ? ' phab-admin-hidden' : '');
      dom.tabSettings.className =
        'phab-admin-tab' +
        (isSettings ? ' phab-admin-tab-active' : '') +
        (hideSettingsTab ? ' phab-admin-hidden' : '');
      dom.mobileTabSelect.value = nextTab;
      dom.messagesSection.className = isMessages ? '' : 'phab-admin-hidden';
      dom.gamesSection.className = isGames ? '' : 'phab-admin-hidden';
      dom.logsSection.className = isLogs ? '' : 'phab-admin-hidden';
      dom.tournamentsSection.className = isTournaments ? '' : 'phab-admin-hidden';
      dom.communitiesSection.className = isCommunities ? '' : 'phab-admin-hidden';
      dom.analyticsSection.className = isAnalytics ? '' : 'phab-admin-hidden';
      dom.settingsSection.className = isSettings ? '' : 'phab-admin-hidden';
      if (isAnalytics) {
        setAnalyticsSubtab(state.analyticsSubtab);
      }
      if (!isMessages) {
        toggleMobileFiltersSheet(false);
      }
      syncResponsiveChatLayout();
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
          if (state.analyticsSubtab === 'games') {
            await loadGameAnalytics();
          }
        } else if (state.activeTab === 'communities') {
          await loadCommunities();
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
      dom.mobileTabSelect.addEventListener('change', function () {
        var nextTab = String(dom.mobileTabSelect.value || 'messages');
        switchTab(nextTab);
        if (nextTab === 'messages') {
          refreshDialogsView().catch(handleError);
          return;
        }
        if (nextTab === 'games') {
          loadGames().catch(handleError);
          return;
        }
        if (nextTab === 'logs') {
          loadGameEvents().catch(handleError);
          return;
        }
        if (nextTab === 'communities') {
          loadCommunities().catch(handleError);
          return;
        }
        if (nextTab === 'analytics') {
          if (state.analyticsSubtab === 'games') {
            loadGameAnalytics().catch(handleError);
          } else {
            setAnalyticsSubtab(state.analyticsSubtab);
          }
          return;
        }
        if (nextTab === 'tournaments') {
          loadTournaments().catch(handleError);
          return;
        }
        loadSettings().catch(handleError);
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
        if (state.analyticsSubtab === 'games') {
          loadGameAnalytics().catch(handleError);
        } else {
          setAnalyticsSubtab(state.analyticsSubtab);
        }
      });
      dom.analyticsGamesTabBtn.addEventListener('click', function () {
        setAnalyticsSubtab('games');
        if (state.activeTab === 'analytics') {
          loadGameAnalytics().catch(handleError);
        }
      });
      dom.analyticsDialogsTabBtn.addEventListener('click', function () {
        setAnalyticsSubtab('dialogs');
      });
      dom.tabTournaments.addEventListener('click', function () {
        switchTab('tournaments');
        loadTournaments().catch(handleError);
      });
      dom.tabCommunities.addEventListener('click', function () {
        switchTab('communities');
        loadCommunities().catch(handleError);
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
      dom.communitySearchInput.addEventListener('input', function () {
        state.communitiesSearchQuery = String(dom.communitySearchInput.value || '').trim();
        renderCommunities();
      });
      dom.communitySearchInput.addEventListener('search', function () {
        state.communitiesSearchQuery = String(dom.communitySearchInput.value || '').trim();
        renderCommunities();
      });
      dom.communitySearchInput.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') {
          return;
        }
        event.preventDefault();
        state.communitiesSearchQuery = String(dom.communitySearchInput.value || '').trim();
        renderCommunities();
      });
      dom.dialogFiltersBtn.addEventListener('click', function () {
        if (dom.dialogFiltersBtn.disabled) {
          return;
        }
        toggleMobileFiltersSheet(true);
      });
      dom.mobileFiltersBackdrop.addEventListener('click', function () {
        toggleMobileFiltersSheet(false);
      });
      dom.mobileFiltersCloseBtn.addEventListener('click', function () {
        toggleMobileFiltersSheet(false);
      });
      dom.mobileFiltersDoneBtn.addEventListener('click', function () {
        toggleMobileFiltersSheet(false);
      });
      dom.mobileFiltersResetBtn.addEventListener('click', function () {
        resetMobileDialogFilters()
          .then(function () {
            toggleMobileFiltersSheet(false);
          })
          .catch(handleError);
      });
      dom.dialogBackBtn.addEventListener('click', function () {
        closeMobileConversationView();
      });
      dom.dialogsScrollBody.addEventListener('scroll', function () {
        loadMoreDialogsIfNeeded().catch(handleError);
      });
      dom.communityAdminGrid.addEventListener('scroll', function () {
        maybeLoadMoreCommunityFeedFromScroll(dom.communityAdminGrid);
      });
      dom.communitiesDetailPane.addEventListener('scroll', function () {
        maybeLoadMoreCommunityFeedFromScroll(dom.communitiesDetailPane);
      });
      dom.communityPreviewBody.addEventListener('scroll', function () {
        maybeLoadMoreCommunityFeedFromScroll(dom.communityPreviewBody);
      });
      dom.communitiesPreviewPane.addEventListener('scroll', function () {
        maybeLoadMoreCommunityFeedFromScroll(dom.communitiesPreviewPane);
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
      dom.analyticsDialogsExportBtn.addEventListener('click', function () {
        exportDialogsAnalytics().catch(handleError);
      });
      dom.analyticsDialogsFormatInput.addEventListener('change', function () {
        state.analyticsDialogsExportFormat = String(dom.analyticsDialogsFormatInput.value || 'json')
          .trim()
          .toLowerCase();
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
      [dom.analyticsDialogsFromInput, dom.analyticsDialogsToInput].forEach(function (input) {
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') {
            event.preventDefault();
            exportDialogsAnalytics().catch(handleError);
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
      dom.attachBtn.addEventListener('click', function () {
        if (!state.selectedThreadId || dom.attachBtn.disabled) {
          return;
        }
        dom.attachmentInput.click();
      });
      dom.attachmentInput.addEventListener('change', function () {
        appendPendingMessageAttachmentsFromFiles(dom.attachmentInput.files).catch(handleError);
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
      dom.communityFeedEditorCloseBtn.addEventListener('click', function () {
        closeCommunityFeedEditorModal();
      });
      dom.communityFeedEditorModal.addEventListener('click', function (event) {
        if (event.target === dom.communityFeedEditorModal) {
          closeCommunityFeedEditorModal();
        }
      });
      dom.communityFeedEditorSaveBtn.addEventListener('click', function () {
        saveCommunityFeedEditor().catch(handleError);
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
        if (!dom.communityFeedEditorModal.classList.contains('phab-admin-hidden')) {
          closeCommunityFeedEditorModal();
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
          return;
        }
        if (!dom.mobileFiltersSheet.classList.contains('phab-admin-hidden')) {
          toggleMobileFiltersSheet(false);
          return;
        }
        if (isMobileChatMode() && state.mobileConversationOpen) {
          closeMobileConversationView();
        }
      };
      document.addEventListener('keydown', documentKeydownHandler);
      windowResizeHandler = function () {
        syncResponsiveChatLayout();
      };
      window.addEventListener('resize', windowResizeHandler);
      applyConnectorConfigTemplateForRoute(dom.connectorRouteInput.value, false);
    }

    async function init() {
      populateMobileTabSelect();
      setStatus('Готово', false);
      bindEvents();
      setAnalyticsSubtab(state.analyticsSubtab);
      await refreshDialogsView();
      syncResponsiveChatLayout();
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
      if (windowResizeHandler) {
        window.removeEventListener('resize', windowResizeHandler);
      }
      [
        dom.gameModal,
        dom.eventModal,
        dom.gameChatModal,
        dom.communityFeedEditorModal,
        dom.mobileFiltersSheet
      ].forEach(function (node) {
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
