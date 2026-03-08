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
  var CONNECTOR_ROUTES = ['TG_BOT', 'MAX_BOT', 'LK_WEB_MESSENGER'];
  var ROLE_OPTIONS = [
    'SUPER_ADMIN',
    'TOURNAMENT_MANAGER',
    'GAME_MANAGER',
    'STATION_ADMIN',
    'MANAGER',
    'SUPPORT',
    'CLIENT'
  ];

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
      }
      .phab-admin-hidden{
        display:none !important;
      }
      .phab-admin-msg-grid{
        display:grid;
        grid-template-columns:310px 1fr;
        gap:12px;
        min-height:470px;
      }
      .phab-admin-pane{
        background:rgba(255,255,255,.88);
        border:1px solid rgba(51,0,32,.15);
        border-radius:16px;
        overflow:hidden;
        box-shadow:0 12px 28px rgba(51,0,32,.09);
      }
      .phab-admin-pane-head{
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
      .phab-admin-pane-body{
        padding:8px;
        overflow:auto;
        max-height:410px;
      }
      .phab-admin-list{
        list-style:none;
        margin:0;
        padding:0;
        display:flex;
        flex-direction:column;
        gap:7px;
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
        grid-template-rows:auto auto 1fr auto;
        height:468px;
      }
      .phab-admin-dialog-head{
        padding:10px 12px;
        border-bottom:1px solid rgba(51,0,32,.12);
        background:linear-gradient(90deg,rgba(207,255,182,.78) 0%,rgba(255,255,255,.96) 100%);
      }
      .phab-admin-dialog-title{
        font-size:14px;
        font-family:var(--cup-font-heading);
        font-weight:700;
        letter-spacing:.04em;
        text-transform:uppercase;
        color:var(--cup-wine);
      }
      .phab-admin-dialog-meta{
        margin-top:3px;
        font-size:11px;
        color:rgba(51,0,32,.72);
      }
      .phab-admin-messages{
        padding:12px;
        overflow:auto;
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
      .phab-admin-message-meta{
        display:block;
        margin-top:4px;
        font-size:10px;
        opacity:.78;
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
        align-items:center;
        justify-content:center;
        padding:18px;
        background:rgba(24,10,22,.42);
        backdrop-filter:blur(2px);
      }
      .phab-admin-modal-card{
        width:min(980px,95vw);
        max-height:90vh;
        display:flex;
        flex-direction:column;
        border-radius:18px;
        background:linear-gradient(180deg,rgba(255,255,255,.97) 0%,rgba(255,250,242,.97) 100%);
        border:1px solid rgba(51,0,32,.2);
        box-shadow:0 22px 52px rgba(28,4,24,.28);
        overflow:hidden;
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
      .phab-admin-modal-body{
        padding:12px;
        overflow:auto;
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:10px;
      }
      .phab-admin-detail-card{
        border:1px solid rgba(51,0,32,.14);
        border-radius:12px;
        background:rgba(255,255,255,.92);
        overflow:hidden;
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
        .phab-admin-msg-grid{grid-template-columns:1fr}
        .phab-admin-dialog-wrap{height:410px}
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
        .phab-admin-tabs{padding:8px 8px 9px}
        .phab-admin-tab{font-size:10px;padding:7px 10px}
        .phab-admin-modal{padding:8px}
        .phab-admin-modal-card{max-height:94vh}
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
      getConnectors: function () {
        return request('/messenger/connectors', 'GET');
      },
      getStations: function (connector) {
        return request('/messenger/connectors/' + encodeURIComponent(connector) + '/stations', 'GET');
      },
      getDialogs: function (connector, stationId) {
        return request(
          '/messenger/connectors/' +
            encodeURIComponent(connector) +
            '/stations/' +
            encodeURIComponent(stationId) +
            '/dialogs',
          'GET'
        );
      },
      getMessages: function (threadId) {
        return request('/messenger/threads/' + encodeURIComponent(threadId) + '/messages', 'GET');
      },
      sendMessage: function (threadId, text) {
        return request('/messenger/threads/' + encodeURIComponent(threadId) + '/messages', 'POST', {
          text: text
        });
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
      getTournaments: function () {
        return request('/tournaments', 'GET');
      },
      getSettings: function () {
        return request('/messenger/settings', 'GET');
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
    tabMessages.textContent = 'Переписка';
    tabs.appendChild(tabMessages);

    var tabGames = document.createElement('button');
    tabGames.className = 'phab-admin-tab';
    tabGames.type = 'button';
    tabGames.textContent = 'Игры';
    tabs.appendChild(tabGames);

    var tabTournaments = document.createElement('button');
    tabTournaments.className = 'phab-admin-tab';
    tabTournaments.type = 'button';
    tabTournaments.textContent = 'Турниры';
    tabs.appendChild(tabTournaments);

    var tabSettings = document.createElement('button');
    tabSettings.className = 'phab-admin-tab';
    tabSettings.type = 'button';
    tabSettings.textContent = 'Настройки';
    tabs.appendChild(tabSettings);

    var content = document.createElement('div');
    content.className = 'phab-admin-content';
    root.appendChild(content);

    var messagesSection = document.createElement('div');
    content.appendChild(messagesSection);

    var gamesSection = document.createElement('div');
    gamesSection.className = 'phab-admin-hidden';
    content.appendChild(gamesSection);

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
    leftHead.textContent = 'Маршруты и станции';
    leftPane.appendChild(leftHead);

    var leftBody = document.createElement('div');
    leftBody.className = 'phab-admin-pane-body';
    leftPane.appendChild(leftBody);

    var connectorsTitle = document.createElement('div');
    connectorsTitle.className = 'phab-admin-list-title';
    connectorsTitle.textContent = 'Коннекторы';
    leftBody.appendChild(connectorsTitle);

    var connectorsList = document.createElement('ul');
    connectorsList.className = 'phab-admin-list';
    leftBody.appendChild(connectorsList);

    var stationsTitle = document.createElement('div');
    stationsTitle.className = 'phab-admin-list-title';
    stationsTitle.style.marginTop = '10px';
    stationsTitle.textContent = 'Станции';
    leftBody.appendChild(stationsTitle);

    var stationsList = document.createElement('ul');
    stationsList.className = 'phab-admin-list';
    leftBody.appendChild(stationsList);

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
    dialogMeta.textContent = 'Выберите станцию';
    dialogHead.appendChild(dialogMeta);

    var dialogsList = document.createElement('ul');
    dialogsList.className = 'phab-admin-list phab-admin-pane-body';
    dialogWrap.appendChild(dialogsList);

    var messagesBox = document.createElement('div');
    messagesBox.className = 'phab-admin-messages';
    dialogWrap.appendChild(messagesBox);

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

    var gamesTable = document.createElement('table');
    gamesTable.className = 'phab-admin-games-table';
    gamesSection.appendChild(gamesTable);

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
    accessRoutesInput.placeholder = 'TG_BOT, MAX_BOT';
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

    var gameModal = document.createElement('div');
    gameModal.className = 'phab-admin-modal phab-admin-hidden';
    root.appendChild(gameModal);

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

    var gameChatModal = document.createElement('div');
    gameChatModal.className = 'phab-admin-modal phab-admin-hidden';
    root.appendChild(gameChatModal);

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
      refreshBtn: refreshBtn,
      tabMessages: tabMessages,
      tabGames: tabGames,
      tabTournaments: tabTournaments,
      tabSettings: tabSettings,
      messagesSection: messagesSection,
      gamesSection: gamesSection,
      tournamentsSection: tournamentsSection,
      settingsSection: settingsSection,
      connectorsList: connectorsList,
      stationsList: stationsList,
      dialogsList: dialogsList,
      dialogTitle: dialogTitle,
      dialogMeta: dialogMeta,
      messagesBox: messagesBox,
      input: input,
      sendBtn: sendBtn,
      gameModal: gameModal,
      gameModalCard: gameModalCard,
      gameModalTitle: gameModalTitle,
      gameModalBody: gameModalBody,
      gameModalCloseBtn: gameModalCloseBtn,
      gameChatModal: gameChatModal,
      gameChatCard: gameChatCard,
      gameChatTitle: gameChatTitle,
      gameChatMeta: gameChatMeta,
      gameChatBox: gameChatBox,
      gameChatCloseBtn: gameChatCloseBtn,
      gameChatInput: gameChatInput,
      gameChatSendBtn: gameChatSendBtn,
      gamesTable: gamesTable,
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
      connectorActiveInput: connectorActiveInput,
      connectorCreateBtn: connectorCreateBtn,
      accessList: accessList,
      accessRoleInput: accessRoleInput,
      accessStationsInput: accessStationsInput,
      accessRoutesInput: accessRoutesInput,
      accessReadInput: accessReadInput,
      accessWriteInput: accessWriteInput,
      accessCreateBtn: accessCreateBtn
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

  function panelInstance(rawConfig) {
    var cfg = normalizeConfig(rawConfig);
    ensureStyle();

    var root = createRoot(cfg);
    var dom = createLayout(root, cfg);
    var api = createApi(cfg);
    var pollTimer = null;
    var documentKeydownHandler = null;

    var state = {
      activeTab: 'messages',
      loading: false,
      connectors: [],
      stations: [],
      dialogs: [],
      messages: [],
      games: [],
      gamesSortField: 'createdAt',
      gamesSortDirection: 'desc',
      gamesColumnWidths: {},
      tournaments: [],
      tournamentsColumnWidths: {},
      settings: {
        stations: [],
        connectors: [],
        accessRules: []
      },
      selectedGameId: null,
      selectedGame: null,
      gameChatGameId: null,
      gameChatThreadId: null,
      selectedConnector: null,
      selectedStationId: null,
      selectedThreadId: null
    };

    function setStatus(text, isError) {
      dom.status.textContent = text;
      dom.status.className = isError
        ? 'phab-admin-status phab-admin-status-error'
        : 'phab-admin-status';
    }

    function getSelectedDialog() {
      for (var i = 0; i < state.dialogs.length; i += 1) {
        if (state.dialogs[i].threadId === state.selectedThreadId) {
          return state.dialogs[i];
        }
      }
      return null;
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

    function createDetailCard(title, spanTwo) {
      var card = document.createElement('section');
      card.className = 'phab-admin-detail-card' + (spanTwo ? ' phab-admin-detail-span-2' : '');

      var head = document.createElement('div');
      head.className = 'phab-admin-detail-head';
      head.textContent = title;
      card.appendChild(head);

      var body = document.createElement('div');
      body.className = 'phab-admin-detail-body';
      card.appendChild(body);

      return { card: card, body: body };
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

    function appendJsonCard(title, payload) {
      var card = createDetailCard(title, true);
      var pre = document.createElement('pre');
      pre.className = 'phab-admin-detail-json';
      pre.textContent = JSON.stringify(payload || {}, null, 2);
      card.body.appendChild(pre);
      dom.gameModalBody.appendChild(card.card);
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

      dom.gameModalTitle.textContent = 'Игра ' + game.id;

      var mainCard = createDetailCard('Основное');
      appendDetailRow(mainCard.body, 'ID', game.id);
      appendDetailRow(mainCard.body, 'Источник', game.source);
      appendDetailRow(mainCard.body, 'Название', game.name);
      appendDetailRow(mainCard.body, 'Статус', game.rawStatus || game.status);
      appendDetailRow(mainCard.body, 'Создана', formatDateTimeFull(game.createdAt));
      appendDetailRow(mainCard.body, 'Обновлена', formatDateTimeFull(game.updatedAt));
      appendDetailRow(mainCard.body, 'Дата игры', game.gameDate);
      appendDetailRow(mainCard.body, 'Время игры', game.gameTime);
      appendDetailRow(mainCard.body, 'Старт (ISO)', game.startsAt);
      appendDetailRow(mainCard.body, 'Локация', game.locationName || game.name);
      dom.gameModalBody.appendChild(mainCard.card);

      var organizerCard = createDetailCard('Организатор');
      appendDetailRow(
        organizerCard.body,
        'Имя',
        organizer.name || game.organizerName || '-'
      );
      appendDetailRow(organizerCard.body, 'Телефон', organizer.phone || '-');
      appendDetailRow(organizerCard.body, 'Рейтинг', organizer.rating || '-');
      appendDetailRow(organizerCard.body, 'ID', organizer.id || '-');
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
        var own = message.senderRole !== 'CLIENT';
        var div = document.createElement('div');
        div.className =
          'phab-admin-message ' +
          (own ? 'phab-admin-message-staff' : 'phab-admin-message-client');
        div.textContent = message.text || '';

        var meta = document.createElement('span');
        meta.className = 'phab-admin-message-meta';
        var sender = own ? (message.origin === 'AI' ? 'AI' : 'Сотрудник') : 'Клиент';
        meta.textContent = sender + ' · ' + formatTime(message.createdAt);
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
      var threadId = state.gameChatThreadId;
      if (!threadId) {
        return;
      }
      var messages = (await api.getMessages(threadId)) || [];
      if (threadId !== state.gameChatThreadId) {
        return;
      }
      renderGameChatMessages(messages);
    }

    async function openGameChat(game) {
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
        if (!payload || !payload.thread || !payload.thread.id) {
          throw new Error('Не удалось открыть чат игры');
        }

        state.gameChatThreadId = payload.thread.id;
        dom.gameChatMeta.textContent =
          (payload.thread.stationName || payload.thread.stationId || '-') +
          ' · ' +
          (payload.thread.connector || '-') +
          ' · thread ' +
          payload.thread.id.slice(0, 8);
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
      var threadId = state.gameChatThreadId;
      if (!text || !threadId) {
        return;
      }

      dom.gameChatSendBtn.disabled = true;
      try {
        await api.sendMessage(threadId, text);
        dom.gameChatInput.value = '';
        await reloadGameChatMessages();
        setStatus('Сообщение отправлено в чат игры', false);
      } finally {
        dom.gameChatSendBtn.disabled = false;
      }
    }

    function renderConnectors() {
      clearNode(dom.connectorsList);
      if (state.connectors.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'phab-admin-empty';
        empty.textContent = 'Нет доступных коннекторов';
        dom.connectorsList.appendChild(empty);
        return;
      }

      state.connectors.forEach(function (item) {
        dom.connectorsList.appendChild(
          createListButton(
            item.connector,
            'Станций: ' +
              item.stationsCount +
              ' · Диалогов: ' +
              item.dialogsCount +
              ' · Непрочитано: ' +
              item.unreadMessagesCount,
            function () {
              if (state.selectedConnector === item.connector) {
                return;
              }
              state.selectedConnector = item.connector;
              state.selectedStationId = null;
              state.selectedThreadId = null;
              refreshMessageHierarchy().catch(handleError);
            },
            state.selectedConnector === item.connector
          )
        );
      });
    }

    function renderStations() {
      clearNode(dom.stationsList);
      if (!state.selectedConnector) {
        var hint = document.createElement('div');
        hint.className = 'phab-admin-empty';
        hint.textContent = 'Выберите коннектор';
        dom.stationsList.appendChild(hint);
        return;
      }
      if (state.stations.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'phab-admin-empty';
        empty.textContent = 'Нет станций';
        dom.stationsList.appendChild(empty);
        return;
      }

      state.stations.forEach(function (item) {
        var title = item.stationName ? item.stationName + ' (' + item.stationId + ')' : item.stationId;
        var meta =
          'Диалогов: ' +
          item.dialogsCount +
          ' · Непрочит. диалогов: ' +
          item.unreadDialogsCount +
          ' · Сообщений: ' +
          item.unreadMessagesCount +
          ' · ' +
          formatTime(item.lastMessageAt);

        dom.stationsList.appendChild(
          createListButton(
            title,
            meta,
            function () {
              if (state.selectedStationId === item.stationId) {
                return;
              }
              state.selectedStationId = item.stationId;
              state.selectedThreadId = null;
              loadDialogs().catch(handleError);
            },
            state.selectedStationId === item.stationId
          )
        );
      });
    }

    function renderDialogs() {
      clearNode(dom.dialogsList);
      if (!state.selectedStationId) {
        dom.dialogTitle.textContent = 'Диалоги';
        dom.dialogMeta.textContent = 'Выберите станцию';
      } else {
        dom.dialogTitle.textContent = 'Диалоги станции';
        dom.dialogMeta.textContent = state.selectedConnector + ' · ' + state.selectedStationId;
      }

      if (state.dialogs.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'phab-admin-empty';
        empty.textContent = 'Нет диалогов';
        dom.dialogsList.appendChild(empty);
        renderMessages([]);
        return;
      }

      state.dialogs.forEach(function (item) {
        var title = item.subject || 'Диалог ' + item.threadId;
        var meta =
          'client=' +
          item.clientId +
          ' · unread=' +
          item.unreadMessagesCount +
          ' · last=' +
          formatTime(item.lastMessageAt) +
          ' · avgRT=' +
          (item.averageStaffResponseTimeMs != null ? item.averageStaffResponseTimeMs + 'ms' : '-');

        dom.dialogsList.appendChild(
          createListButton(
            title,
            meta,
            function () {
              state.selectedThreadId = item.threadId;
              loadMessages().catch(handleError);
            },
            state.selectedThreadId === item.threadId
          )
        );
      });
    }

    function renderMessages(messages) {
      clearNode(dom.messagesBox);
      if (!state.selectedThreadId) {
        var hint = document.createElement('div');
        hint.className = 'phab-admin-empty';
        hint.textContent = 'Выберите диалог, чтобы видеть сообщения';
        dom.messagesBox.appendChild(hint);
        return;
      }

      if (!messages || messages.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'phab-admin-empty';
        empty.textContent = 'Сообщений пока нет';
        dom.messagesBox.appendChild(empty);
        return;
      }

      messages.forEach(function (message) {
        var own = message.senderRole !== 'CLIENT';
        var div = document.createElement('div');
        div.className =
          'phab-admin-message ' +
          (own ? 'phab-admin-message-staff' : 'phab-admin-message-client');
        div.textContent = message.text || '';

        var meta = document.createElement('span');
        meta.className = 'phab-admin-message-meta';
        var sender = own ? (message.origin === 'AI' ? 'AI' : 'Сотрудник') : 'Клиент';
        meta.textContent = sender + ' · ' + formatTime(message.createdAt);
        div.appendChild(meta);

        dom.messagesBox.appendChild(div);
      });

      dom.messagesBox.scrollTop = dom.messagesBox.scrollHeight;
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
      renderGames();
    }

    function getGameParticipantLines(game) {
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

    function applyColumnWidth(columnNode, width) {
      if (!columnNode) {
        return;
      }
      if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
        columnNode.style.width = String(Math.round(width)) + 'px';
      }
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

      var columns = [
        { key: 'organizer', label: 'Организатор', sortField: 'organizer', minWidth: 170 },
        { key: 'participants', label: 'Состав', minWidth: 220 },
        { key: 'createdAt', label: 'Создана', sortField: 'createdAt', minWidth: 150 },
        { key: 'gameDate', label: 'Дата игры', sortField: 'gameDate', minWidth: 160 },
        { key: 'location', label: 'Локация', minWidth: 180 },
        { key: 'chat', label: 'Чат', minWidth: 110 },
        { key: 'status', label: 'Статус', minWidth: 140 }
      ];
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
        td.colSpan = 7;
        td.textContent = 'Нет игр';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      sortGames(state.games).forEach(function (game) {
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

        var locationCell = document.createElement('td');
        locationCell.textContent = String(game.locationName || game.name || '-');
        tr.appendChild(locationCell);

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

        var statusCell = document.createElement('td');
        statusCell.textContent = String(game.rawStatus || game.status || '-');
        tr.appendChild(statusCell);

        tbody.appendChild(tr);
      });
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
            : 'all');
        main.appendChild(meta);

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

    function renderSettings() {
      renderSettingsStations();
      renderSettingsConnectors();
      renderSettingsAccessRules();
    }

    async function loadConnectors() {
      state.connectors = (await api.getConnectors()) || [];
      if (!state.selectedConnector && state.connectors.length > 0) {
        state.selectedConnector = state.connectors[0].connector;
      }
      renderConnectors();
    }

    async function loadStations() {
      if (!state.selectedConnector) {
        state.stations = [];
        renderStations();
        return;
      }
      state.stations = (await api.getStations(state.selectedConnector)) || [];
      if (state.stations.length > 0) {
        var exists = state.stations.some(function (station) {
          return station.stationId === state.selectedStationId;
        });
        if (!exists) {
          state.selectedStationId = state.stations[0].stationId;
        }
      } else {
        state.selectedStationId = null;
      }
      renderStations();
    }

    async function loadDialogs() {
      if (!state.selectedConnector || !state.selectedStationId) {
        state.dialogs = [];
        state.selectedThreadId = null;
        renderDialogs();
        return;
      }
      state.dialogs =
        (await api.getDialogs(state.selectedConnector, state.selectedStationId)) || [];
      if (state.dialogs.length > 0) {
        var exists = state.dialogs.some(function (dialog) {
          return dialog.threadId === state.selectedThreadId;
        });
        if (!exists) {
          state.selectedThreadId = state.dialogs[0].threadId;
        }
      } else {
        state.selectedThreadId = null;
      }
      renderDialogs();
      await loadMessages();
    }

    async function loadMessages() {
      if (!state.selectedThreadId) {
        state.messages = [];
        renderMessages([]);
        return;
      }
      state.messages = (await api.getMessages(state.selectedThreadId)) || [];
      renderMessages(state.messages);
    }

    async function loadGames() {
      state.games = (await api.getGames()) || [];
      renderGames();
    }

    async function loadTournaments() {
      state.tournaments = (await api.getTournaments()) || [];
      renderTournaments();
    }

    async function loadSettings() {
      var settings = (await api.getSettings()) || {};
      state.settings = {
        stations: settings.stations || [],
        connectors: settings.connectors || [],
        accessRules: settings.accessRules || []
      };
      renderSettings();
    }

    async function refreshMessageHierarchy() {
      await loadConnectors();
      await loadStations();
      await loadDialogs();
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
        await refreshMessageHierarchy();
        setStatus('Станция добавлена', false);
      } finally {
        dom.stationCreateBtn.disabled = false;
      }
    }

    async function toggleStation(station) {
      await api.updateStation(station.stationId, { isActive: !station.isActive });
      await loadSettings();
      await refreshMessageHierarchy();
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
        await api.createConnector({
          name: name,
          route: dom.connectorRouteInput.value,
          stationIds: parseCsvInput(dom.connectorStationsInput.value),
          isActive: Boolean(dom.connectorActiveInput.checked)
        });
        dom.connectorNameInput.value = '';
        dom.connectorStationsInput.value = '';
        dom.connectorActiveInput.checked = true;
        await loadSettings();
        await refreshMessageHierarchy();
        setStatus('Коннектор добавлен', false);
      } finally {
        dom.connectorCreateBtn.disabled = false;
      }
    }

    async function toggleConnector(connector) {
      await api.updateConnector(connector.id, { isActive: !connector.isActive });
      await loadSettings();
      await refreshMessageHierarchy();
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
        await refreshMessageHierarchy();
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
        await api.sendMessage(state.selectedThreadId, text);
        dom.input.value = '';
        await loadMessages();
        await loadDialogs();
        await loadStations();
        setStatus('Сообщение отправлено', false);
      } finally {
        dom.sendBtn.disabled = false;
      }
    }

    function switchTab(nextTab) {
      state.activeTab = nextTab;
      var isMessages = nextTab === 'messages';
      var isGames = nextTab === 'games';
      var isTournaments = nextTab === 'tournaments';
      var isSettings = nextTab === 'settings';

      dom.tabMessages.className = 'phab-admin-tab' + (isMessages ? ' phab-admin-tab-active' : '');
      dom.tabGames.className = 'phab-admin-tab' + (isGames ? ' phab-admin-tab-active' : '');
      dom.tabTournaments.className =
        'phab-admin-tab' + (isTournaments ? ' phab-admin-tab-active' : '');
      dom.tabSettings.className =
        'phab-admin-tab' + (isSettings ? ' phab-admin-tab-active' : '');
      dom.messagesSection.className = isMessages ? '' : 'phab-admin-hidden';
      dom.gamesSection.className = isGames ? '' : 'phab-admin-hidden';
      dom.tournamentsSection.className = isTournaments ? '' : 'phab-admin-hidden';
      dom.settingsSection.className = isSettings ? '' : 'phab-admin-hidden';
    }

    function handleError(error) {
      setStatus(error && error.message ? error.message : 'Ошибка', true);
      if (window.console && console.error) {
        console.error('[PHAB admin panel]', error);
      }
    }

    async function refreshActiveTab() {
      try {
        setStatus('Обновление...', false);
        if (state.activeTab === 'messages') {
          await refreshMessageHierarchy();
        } else if (state.activeTab === 'games') {
          await loadGames();
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
      dom.tabMessages.addEventListener('click', function () {
        switchTab('messages');
      });
      dom.tabGames.addEventListener('click', function () {
        switchTab('games');
        loadGames().catch(handleError);
      });
      dom.tabTournaments.addEventListener('click', function () {
        switchTab('tournaments');
        loadTournaments().catch(handleError);
      });
      dom.tabSettings.addEventListener('click', function () {
        switchTab('settings');
        loadSettings().catch(handleError);
      });
      dom.refreshBtn.addEventListener('click', function () {
        refreshActiveTab().catch(handleError);
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
      dom.accessCreateBtn.addEventListener('click', function () {
        createAccessRule().catch(handleError);
      });
      dom.gameModalCloseBtn.addEventListener('click', function () {
        closeGameModal();
      });
      dom.gameModal.addEventListener('click', function (event) {
        if (event.target === dom.gameModal) {
          closeGameModal();
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
        if (!dom.gameModal.classList.contains('phab-admin-hidden')) {
          closeGameModal();
        }
      };
      document.addEventListener('keydown', documentKeydownHandler);
    }

    async function init() {
      bindEvents();
      await refreshMessageHierarchy();
      pollTimer = window.setInterval(function () {
        if (state.activeTab === 'messages') {
          refreshMessageHierarchy().catch(handleError);
        }
      }, cfg.pollIntervalMs);
      setStatus('Готово', false);
    }

    function destroy() {
      if (pollTimer) {
        window.clearInterval(pollTimer);
      }
      if (documentKeydownHandler) {
        document.removeEventListener('keydown', documentKeydownHandler);
      }
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
