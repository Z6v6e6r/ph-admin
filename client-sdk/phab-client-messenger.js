(function () {
  var DEFAULTS = {
    apiBaseUrl: '',
    connectorRoute: 'LK_WEB_MESSENGER',
    hideStationSelect: false,
    hideLauncher: false,
    pollIntervalMs: 5000,
    title: 'Поддержка PadelHub',
    launcherText: 'Чат',
    storageKey: 'phab_messenger_widget_session',
    stations: [],
    enableWebPush: true,
    webPushServiceWorkerUrl: ''
  };

  var STYLE_ID = 'phab-messenger-widget-style';
  var MAX_MESSAGE_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
  var MAX_MESSAGE_ATTACHMENT_SIZE_BYTES = 4 * 1024 * 1024;
  var MAX_MESSAGE_ATTACHMENTS_TOTAL_BYTES = 12 * 1024 * 1024;

  function nowIso() {
    return new Date().toISOString();
  }

  function parseIso(value) {
    if (!value) {
      return 0;
    }
    var ts = Date.parse(value);
    return Number.isNaN(ts) ? 0 : ts;
  }

  function normalizeBoolean(value, fallback) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      var normalized = value.trim().toLowerCase();
      if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
        return true;
      }
      if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
        return false;
      }
    }
    return fallback;
  }

  function base64UrlToUint8Array(base64Url) {
    var padded = String(base64Url || '').replace(/-/g, '+').replace(/_/g, '/');
    var remainder = padded.length % 4;
    if (remainder === 2) {
      padded += '==';
    } else if (remainder === 3) {
      padded += '=';
    } else if (remainder !== 0) {
      return null;
    }
    var raw = window.atob(padded);
    var output = new Uint8Array(raw.length);
    for (var index = 0; index < raw.length; index += 1) {
      output[index] = raw.charCodeAt(index);
    }
    return output;
  }

  function normalizeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function isPromoConnectorRoute(connectorRoute) {
    return String(connectorRoute || '').trim().toUpperCase() === 'PROMO_WEB_MESSENGER';
  }

  function formatFileSize(size) {
    var bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '';
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

  function mergeConfig(input) {
    var cfg = Object.assign({}, DEFAULTS, input || {});
    if (!cfg.apiBaseUrl) {
      throw new Error('PHAB widget: apiBaseUrl is required');
    }
    cfg.apiBaseUrl = String(cfg.apiBaseUrl).replace(/\/+$/, '');
    cfg.connectorRoute = String(cfg.connectorRoute || DEFAULTS.connectorRoute)
      .trim()
      .toUpperCase() || DEFAULTS.connectorRoute;
    cfg.hideStationSelect = normalizeBoolean(cfg.hideStationSelect, DEFAULTS.hideStationSelect);
    cfg.launcherText = String(cfg.launcherText || '').trim();
    cfg.hideLauncher = normalizeBoolean(cfg.hideLauncher, DEFAULTS.hideLauncher) || !cfg.launcherText;
    if (!cfg.launcherText) {
      cfg.launcherText = DEFAULTS.launcherText;
    }
    cfg.pollIntervalMs = Math.max(2000, Number(cfg.pollIntervalMs || DEFAULTS.pollIntervalMs));
    cfg.enableWebPush = normalizeBoolean(cfg.enableWebPush, DEFAULTS.enableWebPush);
    cfg.webPushServiceWorkerUrl = String(cfg.webPushServiceWorkerUrl || '').trim();
    if (!Array.isArray(cfg.stations)) {
      cfg.stations = [];
    }
    if (isPromoConnectorRoute(cfg.connectorRoute)) {
      cfg.stations = [{ id: 'promo', name: 'PROMO' }];
      cfg.hideStationSelect = true;
      if (!String(cfg.title || '').trim() || cfg.title === DEFAULTS.title) {
        cfg.title = 'TEAMO × PADLHUB';
      }
      if (!String(cfg.launcherText || '').trim() || cfg.launcherText === DEFAULTS.launcherText) {
        cfg.launcherText = 'Teamo × PadlHub';
      }
    }
    return cfg;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.phab-launcher{position:fixed;right:20px;bottom:20px;z-index:2147483000;border:none;border-radius:999px;padding:12px 18px;background:#116149;color:#fff;font:600 14px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;cursor:pointer;box-shadow:0 10px 24px rgba(0,0,0,.18)}' +
      '.phab-launcher-hidden{display:none}' +
      '.phab-launcher-badge{display:inline-block;min-width:18px;height:18px;padding:0 5px;margin-left:8px;border-radius:10px;background:#d1362a;color:#fff;font-size:11px;line-height:18px;text-align:center}' +
      '.phab-panel{position:fixed;right:20px;bottom:74px;width:360px;max-width:calc(100vw - 20px);height:520px;max-height:70vh;background:#fff;border:1px solid #d8e0dc;border-radius:14px;display:flex;flex-direction:column;z-index:2147483001;box-shadow:0 20px 48px rgba(0,0,0,.18)}' +
      '.phab-panel-hidden{display:none}' +
      '.phab-header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid #e6ece8;background:#f3f7f5}' +
      '.phab-title-wrap{display:flex;flex-direction:column;gap:2px;min-width:0}' +
      '.phab-title{font:700 14px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;color:#17352d}' +
      '.phab-subtitle{display:none;font:600 12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;color:#4b5e58}' +
      '.phab-header-right{display:flex;align-items:center;gap:8px;flex:0 0 auto}' +
      '.phab-status{font:500 12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;color:#39564d}' +
      '.phab-close{border:none;background:transparent;color:#39564d;font:700 22px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;cursor:pointer;padding:0 2px 2px}' +
      '.phab-body{flex:1;display:flex;flex-direction:column;min-height:0}' +
      '.phab-station-wrap{padding:12px 14px;border-bottom:1px solid #eef2f0;background:#fafcfa}' +
      '.phab-select,.phab-input{width:100%;min-width:0;box-sizing:border-box;border:1px solid #c6d3cd;border-radius:9px;padding:9px 10px;font:500 13px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif}' +
      '.phab-messages{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:12px 12px 8px;background:#fff}' +
      '.phab-msg{max-width:82%;margin:0 0 8px;padding:8px 10px;border-radius:10px;font:500 13px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;white-space:pre-wrap;word-break:break-word}' +
      '.phab-msg-client{margin-left:auto;background:#106f52;color:#fff;border-bottom-right-radius:4px}' +
      '.phab-msg-staff{margin-right:auto;background:#eef4f1;color:#1c342d;border-bottom-left-radius:4px}' +
      '.phab-msg-attachments{display:grid;gap:8px;margin-bottom:8px}' +
      '.phab-msg-image-link{display:block;border-radius:10px;overflow:hidden;text-decoration:none}' +
      '.phab-msg-image{display:block;width:min(240px,100%);max-height:260px;object-fit:cover;border-radius:10px}' +
      '.phab-msg-meta{display:block;margin-top:3px;font-size:10px;opacity:.7}' +
      '.phab-attachments{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px 0;background:#fafcfa;border-top:1px solid #e6ece8}' +
      '.phab-attachment-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border-radius:999px;border:1px solid #d8e0dc;background:#fff;color:#17352d;font:600 11px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif}' +
      '.phab-attachment-chip button{border:none;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:0 2px}' +
      '.phab-footer{padding:10px;border-top:1px solid #e6ece8;display:flex;gap:8px;background:#fafcfa}' +
      '.phab-attach{border:1px solid #c6d3cd;border-radius:9px;padding:0 10px;background:#fff;color:#17352d;font:600 13px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;cursor:pointer}' +
      '.phab-file-hidden{display:none}' +
      '.phab-send{border:none;border-radius:9px;padding:0 14px;background:#116149;color:#fff;font:600 13px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;cursor:pointer}' +
      '.phab-hint{padding:8px 12px;color:#4b5e58;font:500 12px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif}' +
      '.phab-body-lock{overflow:hidden!important;overscroll-behavior:none!important;touch-action:none!important}' +
      '.phab-promo-intro{display:none}' +
      '.phab-launcher-promo{padding:14px 24px;background:linear-gradient(90deg,#ef7683 0%,#67d0e6 100%);font:700 15px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;box-shadow:0 14px 34px rgba(82,112,132,.28)}' +
      '.phab-panel-promo{width:390px;max-width:calc(100vw - 16px);height:min(640px,calc(100dvh - 96px));max-height:calc(100dvh - 96px);border:1px solid rgba(255,255,255,.9);border-radius:28px;background:linear-gradient(180deg,#fff8f4 0%,#f8f0ed 46%,#f3f8fb 100%);overflow:hidden;box-shadow:0 24px 70px rgba(79,88,113,.24)}' +
      '.phab-panel-promo .phab-header{padding:18px 18px 14px;border-bottom:none;background:linear-gradient(135deg,#f7c2ba 0%,#fce9dd 38%,#b9eef5 100%)}' +
      '.phab-panel-promo .phab-title{font:800 16px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;color:#773b3d;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.phab-panel-promo .phab-subtitle{display:block;font:600 14px/1.25 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;color:#4e4240}' +
      '.phab-panel-promo .phab-status{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:rgba(255,255,255,.65);color:#587066;font:700 11px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif}' +
      '.phab-panel-promo .phab-status::before{content:"";width:8px;height:8px;border-radius:50%;background:#92cda6;display:inline-block}' +
      '.phab-panel-promo .phab-close{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.42);color:#7d6460;font-size:22px}' +
      '.phab-panel-promo .phab-body{background:linear-gradient(180deg,#fff6f2 0%,#f9f2ee 100%)}' +
      '.phab-panel-promo .phab-hint{display:none;margin:8px 14px 0;padding:10px 14px;border-radius:14px;background:rgba(255,255,255,.74);color:#725f59}' +
      '.phab-panel-promo .phab-messages{padding:12px 12px 10px;background:transparent}' +
      '.phab-panel-promo .phab-promo-intro{display:block;margin-bottom:14px}' +
      '.phab-promo-greeting{padding:14px 16px;border-radius:18px;background:rgba(255,255,255,.82);color:#564843;font:600 14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;box-shadow:0 8px 20px rgba(120,91,85,.08)}' +
      '.phab-promo-quick-grid{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 14px}' +
      '.phab-promo-chip{border:none;border-radius:999px;padding:11px 16px;color:#fff;font:700 13px/1.1 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;cursor:pointer;box-shadow:0 10px 22px rgba(95,106,129,.18)}' +
      '.phab-promo-chip-pink{background:linear-gradient(90deg,#ef7482 0%,#f5a0a2 100%)}' +
      '.phab-promo-chip-blue{background:linear-gradient(90deg,#57bdcf 0%,#6fd7e5 100%)}' +
      '.phab-promo-chip-wide{background:linear-gradient(90deg,#5eaecf 0%,#61d1df 100%)}' +
      '.phab-promo-showcase{padding:10px;border-radius:24px;background:rgba(255,255,255,.64);border:1px solid rgba(244,205,195,.7);box-shadow:0 12px 26px rgba(120,91,85,.08)}' +
      '.phab-promo-showcase-visual{position:relative;display:flex;gap:14px;align-items:center;padding:16px;border-radius:20px;background:linear-gradient(135deg,#fbd3c3 0%,#fff2e4 42%,#b8e9f3 100%);overflow:hidden}' +
      '.phab-promo-showcase-visual::after{content:"";position:absolute;inset:auto -30px -40px auto;width:120px;height:120px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.75) 0%,rgba(255,255,255,0) 70%)}' +
      '.phab-promo-avatar{width:92px;height:92px;flex:0 0 auto;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff7f2 0 18%,transparent 19%),radial-gradient(circle at 64% 30%,#fff7f2 0 18%,transparent 19%),radial-gradient(circle at 50% 70%,#6db0d7 0 26%,transparent 27%),linear-gradient(145deg,#ffb7b7 0%,#f7d8be 45%,#a8e8ef 100%);border:4px solid rgba(255,255,255,.82);box-shadow:0 10px 20px rgba(99,97,112,.16)}' +
      '.phab-promo-card-copy{position:relative;z-index:1;min-width:0}' +
      '.phab-promo-card-brand{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:14px;background:rgba(255,255,255,.74);color:#6b4f4a;font:800 13px/1.1 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;letter-spacing:.03em;text-transform:uppercase}' +
      '.phab-promo-card-text{margin-top:12px;color:#5a514f;font:700 15px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif}' +
      '.phab-promo-cta{width:100%;margin-top:14px;border:none;border-radius:999px;padding:14px 20px;background:linear-gradient(90deg,#ef7482 0%,#66d0e6 100%);color:#fff;font:700 15px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;cursor:pointer;box-shadow:0 12px 28px rgba(115,102,118,.2)}' +
      '.phab-promo-links{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;margin-top:12px}' +
      '.phab-promo-link{border:1px solid rgba(220,205,197,.82);border-radius:14px;padding:9px 8px;background:rgba(255,255,255,.66);color:#655d5b;font:600 11px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;cursor:pointer;text-align:center}' +
      '.phab-panel-promo .phab-msg{max-width:88%;padding:10px 14px;border-radius:18px;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;box-shadow:0 8px 20px rgba(120,91,85,.08)}' +
      '.phab-panel-promo .phab-msg-client{background:linear-gradient(90deg,#ef7f89 0%,#6ccde4 100%);color:#fff;border-bottom-right-radius:8px}' +
      '.phab-panel-promo .phab-msg-staff{background:rgba(255,255,255,.84);color:#574944;border-bottom-left-radius:8px}' +
      '.phab-panel-promo .phab-msg-image{width:min(220px,100%);max-height:220px}' +
      '.phab-panel-promo .phab-attachments{padding:8px 14px 0;background:transparent;border-top:none}' +
      '.phab-panel-promo .phab-attachment-chip{border-color:rgba(220,205,197,.82);background:rgba(255,255,255,.74);color:#655d5b}' +
      '.phab-panel-promo .phab-footer{padding:10px 12px calc(12px + env(safe-area-inset-bottom,0px));border-top:none;background:transparent;align-items:center}' +
      '.phab-panel-promo .phab-attach{height:44px;padding:0 13px;border-radius:16px;border:1px solid rgba(220,205,197,.82);background:rgba(255,255,255,.74);color:#7d706c;font-size:0}' +
      '.phab-panel-promo .phab-attach::before{content:"📷";font-size:18px;line-height:1}' +
      '.phab-panel-promo .phab-input{height:44px;border-radius:18px;border-color:rgba(220,205,197,.82);background:rgba(255,255,255,.78);padding:11px 14px;color:#5b4f4c;font-size:16px;line-height:1.2}' +
      '.phab-panel-promo .phab-input::placeholder{color:#897d79}' +
      '.phab-panel-promo .phab-send{height:44px;border-radius:999px;padding:0 18px;background:linear-gradient(90deg,#ef7482 0%,#66d0e6 100%);box-shadow:0 10px 22px rgba(115,102,118,.18)}' +
      '@media(max-width:640px){.phab-launcher-promo{right:12px;left:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));padding:16px 22px;font-size:16px}.phab-panel-promo{left:8px;right:8px;bottom:8px;top:auto;width:auto;height:calc(100dvh - 16px);max-height:calc(100dvh - 16px);border-radius:24px}.phab-panel-promo .phab-header{padding:16px 14px 12px}.phab-panel-promo .phab-title{font-size:15px}.phab-panel-promo .phab-subtitle{font-size:13px}.phab-panel-promo .phab-status{padding:7px 10px;font-size:10px}.phab-panel-promo .phab-close{width:34px;height:34px;font-size:24px}.phab-panel-promo .phab-messages{padding:10px 10px 8px}.phab-panel-promo .phab-promo-intro{margin-bottom:12px}.phab-promo-greeting{padding:12px 14px;font-size:13px}.phab-promo-quick-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0 12px}.phab-promo-chip{width:100%;padding:12px 10px;font-size:12px}.phab-promo-chip-wide{grid-column:1/-1}.phab-promo-showcase{padding:8px;border-radius:22px}.phab-promo-showcase-visual{gap:12px;padding:14px;border-radius:18px}.phab-promo-avatar{width:76px;height:76px}.phab-promo-card-brand{padding:7px 10px;font-size:12px}.phab-promo-card-text{margin-top:10px;font-size:14px}.phab-promo-cta{margin-top:12px;padding:14px 18px;font-size:14px}.phab-promo-links{grid-template-columns:1fr;gap:8px;margin-top:8px}.phab-promo-link{padding:12px 10px;font-size:12px}.phab-panel-promo .phab-msg{max-width:90%;padding:10px 12px;font-size:13px}.phab-panel-promo .phab-msg-image{width:min(220px,100%);max-height:200px}.phab-panel-promo .phab-footer{padding:10px 10px calc(10px + env(safe-area-inset-bottom,0px))}.phab-panel-promo .phab-attach{width:44px;min-width:44px;height:44px;padding:0}.phab-panel-promo .phab-send{height:44px;padding:0 14px;font-size:14px}}' +
      '@media(max-width:520px){.phab-panel{left:10px;right:10px;bottom:70px;width:auto;height:65vh;max-height:calc(100dvh - 90px)}.phab-panel-promo{left:0;right:0;bottom:0;height:100dvh;max-height:100dvh;border-radius:22px 22px 0 0;border-left:none;border-right:none;border-bottom:none}.phab-panel-promo .phab-header{padding-top:calc(14px + env(safe-area-inset-top,0px))}.phab-promo-showcase-visual{align-items:flex-start}.phab-promo-avatar{width:68px;height:68px}.phab-promo-card-text{font-size:13px}.phab-panel-promo .phab-input{height:46px}.phab-panel-promo .phab-send{height:46px}}' +
      '@media(max-width:380px){.phab-panel-promo .phab-title{font-size:14px;letter-spacing:.06em}.phab-panel-promo .phab-subtitle{font-size:12px}.phab-panel-promo .phab-status{padding:6px 9px;font-size:9px}.phab-promo-greeting{font-size:12px}.phab-promo-chip{padding:11px 8px;font-size:11px}.phab-promo-showcase-visual{gap:10px;padding:12px}.phab-promo-avatar{width:60px;height:60px}.phab-promo-card-brand{padding:6px 8px;font-size:10px}.phab-promo-card-text{margin-top:8px;font-size:12px}.phab-promo-cta{padding:13px 16px;font-size:13px}.phab-panel-promo .phab-msg{max-width:94%;font-size:12px}.phab-panel-promo .phab-send{padding:0 12px;font-size:13px}}' +
      '@media(max-height:620px) and (max-width:640px){.phab-panel-promo{height:100dvh;max-height:100dvh;border-radius:20px 20px 0 0}.phab-panel-promo .phab-messages{padding-top:8px}.phab-panel-promo .phab-promo-intro{margin-bottom:10px}.phab-promo-greeting{padding:10px 12px}.phab-promo-quick-grid{margin:8px 0 10px}.phab-promo-showcase-visual{padding:12px}.phab-promo-cta{margin-top:10px;padding:12px 16px}.phab-promo-link{padding:10px 8px}}';
    document.head.appendChild(style);
  }

  function createWidgetDom(cfg) {
    var promoMode = isPromoConnectorRoute(cfg.connectorRoute);

    var launcher = document.createElement('button');
    launcher.className = 'phab-launcher' + (promoMode ? ' phab-launcher-promo' : '');
    launcher.type = 'button';
    launcher.textContent = cfg.launcherText;
    launcher.setAttribute('data-phab-launcher', 'true');
    if (cfg.hideLauncher) {
      launcher.className += ' phab-launcher-hidden';
    }

    var badge = document.createElement('span');
    badge.className = 'phab-launcher-badge';
    badge.style.display = 'none';
    badge.textContent = '0';
    launcher.appendChild(badge);

    var panel = document.createElement('section');
    panel.className = 'phab-panel phab-panel-hidden' + (promoMode ? ' phab-panel-promo' : '');
    panel.setAttribute('data-phab-panel', 'true');

    var header = document.createElement('div');
    header.className = 'phab-header';
    panel.appendChild(header);

    var titleWrap = document.createElement('div');
    titleWrap.className = 'phab-title-wrap';
    header.appendChild(titleWrap);

    var title = document.createElement('div');
    title.className = 'phab-title';
    title.textContent = cfg.title;
    titleWrap.appendChild(title);

    var subtitle = document.createElement('div');
    subtitle.className = 'phab-subtitle';
    subtitle.textContent = promoMode ? 'Найдите общий ритм' : '';
    titleWrap.appendChild(subtitle);

    var headerRight = document.createElement('div');
    headerRight.className = 'phab-header-right';
    header.appendChild(headerRight);

    var status = document.createElement('div');
    status.className = 'phab-status';
    status.textContent = promoMode ? 'На связи' : 'Ожидание';
    headerRight.appendChild(status);

    var close = document.createElement('button');
    close.className = 'phab-close';
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Закрыть чат');
    headerRight.appendChild(close);

    var body = document.createElement('div');
    body.className = 'phab-body';
    panel.appendChild(body);

    var stationWrap = document.createElement('div');
    stationWrap.className = 'phab-station-wrap';
    body.appendChild(stationWrap);

    var stationSelect = document.createElement('select');
    stationSelect.className = 'phab-select';
    stationWrap.appendChild(stationSelect);

    var hint = document.createElement('div');
    hint.className = 'phab-hint';
    hint.textContent = 'Выберите станцию и начните диалог';
    body.appendChild(hint);

    var messages = document.createElement('div');
    messages.className = 'phab-messages';
    body.appendChild(messages);

    var attachments = document.createElement('div');
    attachments.className = 'phab-attachments';
    attachments.style.display = 'none';
    panel.appendChild(attachments);

    var fileInput = document.createElement('input');
    fileInput.className = 'phab-file-hidden';
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    panel.appendChild(fileInput);

    var footer = document.createElement('div');
    footer.className = 'phab-footer';
    panel.appendChild(footer);

    var attach = document.createElement('button');
    attach.className = 'phab-attach';
    attach.type = 'button';
    attach.textContent = 'Фото';
    footer.appendChild(attach);

    var input = document.createElement('input');
    input.className = 'phab-input';
    input.type = 'text';
    input.placeholder = promoMode
      ? 'Напишите, что вам ближе: знакомство, игра или событие'
      : 'Введите сообщение...';
    input.maxLength = 2000;
    input.setAttribute('data-phab-input', 'true');
    footer.appendChild(input);

    var send = document.createElement('button');
    send.className = 'phab-send';
    send.type = 'button';
    send.textContent = 'Отправить';
    footer.appendChild(send);

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    return {
      launcher: launcher,
      badge: badge,
      panel: panel,
      status: status,
      close: close,
      stationWrap: stationWrap,
      stationSelect: stationSelect,
      hint: hint,
      messages: messages,
      attachments: attachments,
      fileInput: fileInput,
      attach: attach,
      input: input,
      send: send
    };
  }

  function formatTime(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    var hh = String(date.getHours()).padStart(2, '0');
    var mm = String(date.getMinutes()).padStart(2, '0');
    return hh + ':' + mm;
  }

  function createApi(cfg, clientId) {
    return {
      async request(path, options) {
        var headers = Object.assign(
          {
            'Content-Type': 'application/json',
            'x-user-id': clientId,
            'x-user-role': 'CLIENT'
          },
          cfg.authHeaders || {},
          options && options.headers ? options.headers : {}
        );

        var response = await fetch(cfg.apiBaseUrl + path, Object.assign({}, options, { headers: headers }));
        if (!response.ok) {
          var text = await response.text().catch(function () {
            return '';
          });
          throw new Error('HTTP ' + response.status + ': ' + text);
        }

        var contentType = response.headers.get('content-type') || '';
        if (contentType.indexOf('application/json') === -1) {
          return null;
        }
        return response.json();
      },

      async createThread(payload) {
        return this.request('/messenger/threads', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      },

      async getThread(threadId) {
        return this.request('/messenger/threads/' + encodeURIComponent(threadId), { method: 'GET' });
      },

      async listMessages(threadId) {
        return this.request('/messenger/threads/' + encodeURIComponent(threadId) + '/messages', {
          method: 'GET'
        });
      },

      async sendMessage(threadId, text, attachments) {
        var payload = {
          attachments: normalizeMessageAttachments(attachments)
        };
        var messageText = String(text || '').trim();
        if (messageText) {
          payload.text = messageText;
        }
        return this.request('/messenger/threads/' + encodeURIComponent(threadId) + '/messages', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      },

      async getWebPushConfig() {
        return this.request('/messenger/web-push/config', { method: 'GET' });
      },

      async upsertWebPushSubscription(subscription, threadId) {
        return this.request('/messenger/web-push/subscriptions', {
          method: 'POST',
          body: JSON.stringify({
            subscription: subscription,
            threadId: threadId || undefined
          })
        });
      },

      async removeWebPushSubscription(endpoint) {
        return this.request('/messenger/web-push/subscriptions', {
          method: 'DELETE',
          body: JSON.stringify({ endpoint: endpoint })
        });
      }
    };
  }

  function widgetInstance(rawConfig) {
    var cfg = mergeConfig(rawConfig);
    var promoMode = isPromoConnectorRoute(cfg.connectorRoute);
    ensureStyle();

    var state = {
      open: false,
      loading: false,
      clientId: String(cfg.clientId || 'client-' + Math.random().toString(36).slice(2, 10)),
      threadId: null,
      stationId: null,
      stationName: null,
      lastSeenAt: null,
      lastBadgeMessageAt: null,
      pushEndpoint: null,
      unreadCount: 0,
      pendingAttachments: [],
      disposed: false
    };

    var dom = createWidgetDom(cfg);
    var api = createApi(cfg, state.clientId);
    var pollTimer = null;
    var push = {
      supported: false,
      registration: null,
      serverConfig: null,
      syncPromise: null
    };
    var mobileViewportQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 640px)')
      : null;
    var visualViewportTarget = window.visualViewport || null;
    var bodyScrollLockState = null;

    function setStatus(text) {
      dom.status.textContent = text;
    }

    function showHint(text) {
      var value = String(text || '').trim();
      dom.hint.textContent = value;
      if (promoMode) {
        dom.hint.style.display = value ? 'block' : 'none';
      }
    }

    function isMobileViewport() {
      if (mobileViewportQuery) {
        return mobileViewportQuery.matches === true;
      }
      return Number(window.innerWidth || 0) <= 640;
    }

    function resetPanelViewport() {
      dom.panel.style.top = '';
      dom.panel.style.bottom = '';
      dom.panel.style.height = '';
      dom.panel.style.maxHeight = '';
    }

    function syncPanelViewport() {
      if (!promoMode || !isMobileViewport() || !state.open) {
        resetPanelViewport();
        return;
      }

      if (!visualViewportTarget) {
        return;
      }

      var viewportHeight = Math.max(320, Math.round(Number(visualViewportTarget.height || 0)));
      var offsetTop = Math.max(0, Math.round(Number(visualViewportTarget.offsetTop || 0)));
      if (!viewportHeight) {
        resetPanelViewport();
        return;
      }

      dom.panel.style.top = offsetTop + 'px';
      dom.panel.style.bottom = 'auto';
      dom.panel.style.height = viewportHeight + 'px';
      dom.panel.style.maxHeight = viewportHeight + 'px';
    }

    function lockBodyScroll() {
      if (bodyScrollLockState || !document.body || !document.body.style) {
        return;
      }

      var root = document.documentElement;
      var bodyStyle = document.body.style;
      var rootStyle = root && root.style ? root.style : null;
      var scrollY = Math.max(
        0,
        Math.round(
          Number(
            window.scrollY ||
              window.pageYOffset ||
              (root ? root.scrollTop : 0) ||
              document.body.scrollTop ||
              0
          )
        )
      );

      bodyScrollLockState = {
        scrollY: scrollY,
        body: {
          position: bodyStyle.position,
          top: bodyStyle.top,
          left: bodyStyle.left,
          right: bodyStyle.right,
          width: bodyStyle.width,
          overflow: bodyStyle.overflow,
          touchAction: bodyStyle.touchAction
        },
        root: rootStyle
          ? {
              overflow: rootStyle.overflow,
              overscrollBehavior: rootStyle.overscrollBehavior
            }
          : null
      };

      document.body.classList.add('phab-body-lock');
      bodyStyle.position = 'fixed';
      bodyStyle.top = '-' + scrollY + 'px';
      bodyStyle.left = '0';
      bodyStyle.right = '0';
      bodyStyle.width = '100%';
      bodyStyle.overflow = 'hidden';
      bodyStyle.touchAction = 'none';
      if (rootStyle) {
        rootStyle.overflow = 'hidden';
        rootStyle.overscrollBehavior = 'none';
      }
    }

    function unlockBodyScroll() {
      if (!document.body || !document.body.style) {
        bodyScrollLockState = null;
        return;
      }

      document.body.classList.remove('phab-body-lock');

      if (!bodyScrollLockState) {
        return;
      }

      var bodyStyle = document.body.style;
      var root = document.documentElement;
      var rootStyle = root && root.style ? root.style : null;
      var restoreScrollY = Math.max(0, Number(bodyScrollLockState.scrollY || 0));

      bodyStyle.position = bodyScrollLockState.body.position;
      bodyStyle.top = bodyScrollLockState.body.top;
      bodyStyle.left = bodyScrollLockState.body.left;
      bodyStyle.right = bodyScrollLockState.body.right;
      bodyStyle.width = bodyScrollLockState.body.width;
      bodyStyle.overflow = bodyScrollLockState.body.overflow;
      bodyStyle.touchAction = bodyScrollLockState.body.touchAction;

      if (rootStyle && bodyScrollLockState.root) {
        rootStyle.overflow = bodyScrollLockState.root.overflow;
        rootStyle.overscrollBehavior = bodyScrollLockState.root.overscrollBehavior;
      }

      bodyScrollLockState = null;
      window.scrollTo(0, restoreScrollY);
    }

    function syncBodyLock() {
      if (!promoMode || !document.body || !document.body.classList) {
        syncPanelViewport();
        return;
      }
      if (state.open && isMobileViewport()) {
        lockBodyScroll();
      } else {
        unlockBodyScroll();
      }
      syncPanelViewport();
    }

    function setBadge(count) {
      var safeCount = Math.max(0, Number(count || 0));
      state.unreadCount = safeCount;
      if (safeCount <= 0) {
        dom.badge.style.display = 'none';
        return;
      }
      dom.badge.style.display = '';
      dom.badge.textContent = safeCount > 99 ? '99+' : String(safeCount);
    }

    function loadSession() {
      try {
        var raw = localStorage.getItem(cfg.storageKey);
        if (!raw) {
          return;
        }
        var parsed = JSON.parse(raw);
        if (parsed && parsed.clientId === state.clientId) {
          state.threadId = parsed.threadId || null;
          state.stationId = parsed.stationId || null;
          state.stationName = sanitizeStationName(parsed.stationName, parsed.stationId) || null;
          state.lastSeenAt = parsed.lastSeenAt || null;
          state.lastBadgeMessageAt = parsed.lastBadgeMessageAt || null;
          state.pushEndpoint = parsed.pushEndpoint || null;
        }
      } catch (_err) {}
    }

    function saveSession() {
      try {
        localStorage.setItem(
          cfg.storageKey,
          JSON.stringify({
            clientId: state.clientId,
            threadId: state.threadId,
            stationId: state.stationId,
            stationName: state.stationName,
            lastSeenAt: state.lastSeenAt,
            lastBadgeMessageAt: state.lastBadgeMessageAt,
            pushEndpoint: state.pushEndpoint
          })
        );
      } catch (_err) {}
    }

    function resetPendingAttachments() {
      state.pendingAttachments = [];
      dom.fileInput.value = '';
      renderPendingAttachments();
    }

    function removePendingAttachment(index) {
      state.pendingAttachments = state.pendingAttachments.filter(function (_item, itemIndex) {
        return itemIndex !== index;
      });
      renderPendingAttachments();
    }

    function renderPendingAttachments() {
      dom.attachments.innerHTML = '';
      var attachments = normalizeMessageAttachments(state.pendingAttachments);
      dom.attachments.style.display = attachments.length > 0 ? '' : 'none';

      attachments.forEach(function (attachment, index) {
        var chip = document.createElement('span');
        chip.className = 'phab-attachment-chip';

        var label = document.createElement('span');
        label.textContent =
          (attachment.name || 'Фото') +
          (attachment.size ? ' · ' + formatFileSize(attachment.size) : '');
        chip.appendChild(label);

        var remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', 'Убрать фото');
        remove.addEventListener('click', function () {
          removePendingAttachment(index);
        });
        chip.appendChild(remove);

        dom.attachments.appendChild(chip);
      });
    }

    async function appendPendingAttachmentsFromFiles(files) {
      var fileList = Array.prototype.slice.call(files || []);
      if (fileList.length === 0) {
        return;
      }

      var next = normalizeMessageAttachments(state.pendingAttachments);
      for (var i = 0; i < fileList.length; i += 1) {
        if (next.length >= 10) {
          break;
        }
        var attachment = await compressImageFileAttachment(fileList[i]);
        var nextTotalSize = getMessageAttachmentsTotalSize(next) + Math.max(0, Number(attachment.size || 0));
        if (nextTotalSize > MAX_MESSAGE_ATTACHMENTS_TOTAL_BYTES) {
          throw new Error('Слишком большой общий объем фото в сообщении. Оставьте до ' + formatFileSize(MAX_MESSAGE_ATTACHMENTS_TOTAL_BYTES) + '.');
        }
        next.push(attachment);
      }
      state.pendingAttachments = next;
      dom.fileInput.value = '';
      renderPendingAttachments();
    }

    function shouldHideStationSelect() {
      return cfg.hideStationSelect === true || cfg.stations.length <= 1;
    }

    function renderStations() {
      var stations = cfg.stations.slice();
      dom.stationSelect.innerHTML = '';
      dom.stationWrap.style.display = shouldHideStationSelect() ? 'none' : '';

      if (stations.length === 1 && !state.stationId) {
        state.stationId = String(stations[0].id || '').trim() || null;
        state.stationName = sanitizeStationName(stations[0].name, state.stationId) || null;
        saveSession();
      }

      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Выберите станцию...';
      dom.stationSelect.appendChild(placeholder);

      stations.forEach(function (station) {
        var option = document.createElement('option');
        option.value = String(station.id);
        option.textContent = String(station.name || station.id);
        dom.stationSelect.appendChild(option);
      });

      if (state.stationId) {
        dom.stationSelect.value = state.stationId;
      }
    }

    function createPromoDraftButton(className, text, draftText) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.textContent = text;
      button.addEventListener('click', function () {
        setDraft(draftText);
        showHint('');
      });
      return button;
    }

    function appendPromoIntro() {
      if (!promoMode) {
        return;
      }

      var intro = document.createElement('div');
      intro.className = 'phab-promo-intro';

      var greeting = document.createElement('div');
      greeting.className = 'phab-promo-greeting';
      greeting.textContent =
        'Привет! Чтобы получить ссылку на регистрацию в турнире, пришли скрин своего профиля в Teamo.';
      intro.appendChild(greeting);

      var links = document.createElement('div');
      links.className = 'phab-promo-links';
      links.appendChild(
        createPromoDraftButton(
          'phab-promo-link',
          'Условия участия',
          'Подскажите условия участия в промо Teamo × PadlHub.'
        )
      );
      intro.appendChild(links);
      dom.messages.appendChild(intro);
    }

    function renderMessages(messages) {
      dom.messages.innerHTML = '';
      appendPromoIntro();
      messages.forEach(function (message) {
        var item = document.createElement('div');
        var own = message.senderRole === 'CLIENT';
        var attachments = normalizeMessageAttachments(message.attachments);
        item.className = 'phab-msg ' + (own ? 'phab-msg-client' : 'phab-msg-staff');

        if (attachments.length > 0) {
          var attachmentsWrap = document.createElement('div');
          attachmentsWrap.className = 'phab-msg-attachments';
          attachments.forEach(function (attachment) {
            var link = document.createElement('a');
            link.className = 'phab-msg-image-link';
            link.href = attachment.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';

            var image = document.createElement('img');
            image.className = 'phab-msg-image';
            image.src = attachment.url;
            image.alt = attachment.name || 'Фото';
            image.loading = 'lazy';
            link.appendChild(image);

            attachmentsWrap.appendChild(link);
          });
          item.appendChild(attachmentsWrap);
        }

        var text = document.createElement('div');
        text.textContent =
          String(message.text || '').trim() || formatAttachmentPreview(attachments);
        item.appendChild(text);

        var meta = document.createElement('span');
        meta.className = 'phab-msg-meta';
        var roleLabel = own ? 'Вы' : message.origin === 'AI' ? 'AI' : 'Поддержка';
        meta.textContent = roleLabel + ' • ' + formatTime(message.createdAt);
        item.appendChild(meta);

        dom.messages.appendChild(item);
      });
      dom.messages.scrollTop = dom.messages.scrollHeight;
    }

    function getStationById(stationId) {
      for (var i = 0; i < cfg.stations.length; i += 1) {
        if (String(cfg.stations[i].id) === String(stationId)) {
          return cfg.stations[i];
        }
      }
      return null;
    }

    function isUuidLike(value) {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(value || '').trim()
      );
    }

    function sanitizeStationName(stationName, stationId) {
      var candidate = String(stationName || '').trim();
      if (!candidate) {
        return '';
      }
      var normalizedStationId = String(stationId || '').trim();
      if (normalizedStationId && candidate.toLowerCase() === normalizedStationId.toLowerCase()) {
        return '';
      }
      if (isUuidLike(candidate)) {
        return '';
      }
      return candidate;
    }

    function resolveStationNameById(stationId) {
      var station = getStationById(stationId);
      return sanitizeStationName(station && station.name, stationId);
    }

    function resolveStationLabel(stationId, stationName) {
      return (
        sanitizeStationName(stationName, stationId) ||
        resolveStationNameById(stationId) ||
        String(stationId || '').trim()
      );
    }

    function resolveApiOrigin() {
      try {
        return new URL(cfg.apiBaseUrl, window.location.href).origin;
      } catch (_err) {
        return '';
      }
    }

    function resolvePushServiceWorkerUrl() {
      if (cfg.webPushServiceWorkerUrl) {
        try {
          return new URL(cfg.webPushServiceWorkerUrl, window.location.href).toString();
        } catch (_err) {
          return '';
        }
      }

      try {
        return new URL(cfg.apiBaseUrl + '/client-script/messenger-push-sw.js', window.location.href).toString();
      } catch (_err) {
        return '';
      }
    }

    function canUseWebPush() {
      if (!cfg.enableWebPush) {
        return false;
      }
      if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        return false;
      }
      if (!window.isSecureContext) {
        return false;
      }
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        return false;
      }
      var apiOrigin = resolveApiOrigin();
      if (!apiOrigin || apiOrigin !== window.location.origin) {
        return false;
      }
      return true;
    }

    function serializePushSubscription(subscription) {
      if (!subscription) {
        return null;
      }

      if (typeof subscription.toJSON === 'function') {
        var json = subscription.toJSON();
        if (json && json.endpoint) {
          return json;
        }
      }

      var endpoint = String(subscription.endpoint || '').trim();
      if (!endpoint) {
        return null;
      }

      var p256dh = '';
      var auth = '';
      if (typeof subscription.getKey === 'function') {
        var p256dhRaw = subscription.getKey('p256dh');
        var authRaw = subscription.getKey('auth');
        if (p256dhRaw) {
          p256dh = btoa(String.fromCharCode.apply(null, new Uint8Array(p256dhRaw)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');
        }
        if (authRaw) {
          auth = btoa(String.fromCharCode.apply(null, new Uint8Array(authRaw)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');
        }
      }

      if (!p256dh || !auth) {
        return null;
      }

      return {
        endpoint: endpoint,
        expirationTime: subscription.expirationTime,
        keys: {
          p256dh: p256dh,
          auth: auth
        }
      };
    }

    async function ensureWebPushSubscription(interactive) {
      if (!push.supported || state.disposed) {
        return;
      }
      if (push.syncPromise) {
        return push.syncPromise;
      }

      push.syncPromise = (async function () {
        try {
          if (!push.serverConfig) {
            push.serverConfig = await api.getWebPushConfig().catch(function () {
              return null;
            });
          }

          if (!push.serverConfig || !push.serverConfig.enabled || !push.serverConfig.publicKey) {
            return;
          }

          if (Notification.permission === 'denied') {
            return;
          }

          if (!push.registration) {
            var serviceWorkerUrl = resolvePushServiceWorkerUrl();
            if (!serviceWorkerUrl) {
              return;
            }
            push.registration = await navigator.serviceWorker.register(serviceWorkerUrl, {
              scope: '/'
            });
          }

          var subscription = await push.registration.pushManager.getSubscription();

          if (!subscription) {
            if (Notification.permission !== 'granted') {
              if (!interactive) {
                return;
              }
              var permission = await Notification.requestPermission();
              if (permission !== 'granted') {
                return;
              }
            }

            var applicationServerKey = base64UrlToUint8Array(push.serverConfig.publicKey);
            if (!applicationServerKey) {
              return;
            }

            subscription = await push.registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: applicationServerKey
            });
          }

          var serializedSubscription = serializePushSubscription(subscription);
          if (!serializedSubscription || !serializedSubscription.endpoint) {
            return;
          }

          var previousEndpoint = state.pushEndpoint;
          if (previousEndpoint && previousEndpoint !== serializedSubscription.endpoint) {
            api.removeWebPushSubscription(previousEndpoint).catch(function () {});
          }

          await api.upsertWebPushSubscription(serializedSubscription, state.threadId);
          state.pushEndpoint = serializedSubscription.endpoint;
          saveSession();
        } catch (_err) {}
      })();

      try {
        await push.syncPromise;
      } finally {
        push.syncPromise = null;
      }
    }

    async function ensureThread() {
      if (state.threadId) {
        return state.threadId;
      }

      var selectedStationId = state.stationId || dom.stationSelect.value;
      if (!selectedStationId) {
        throw new Error('Станция не выбрана');
      }

      var stationName = resolveStationNameById(selectedStationId);
      var createPayload = {
        connector: cfg.connectorRoute,
        stationId: selectedStationId,
        clientId: state.clientId,
        aiMode: 'SUGGEST'
      };
      if (stationName) {
        createPayload.stationName = stationName;
      }

      var thread = await api.createThread(createPayload);

      state.threadId = thread.id;
      state.stationId = selectedStationId;
      state.stationName =
        sanitizeStationName(thread && thread.stationName, selectedStationId) || stationName || null;
      saveSession();
      return thread.id;
    }

    async function syncMessages(markSeen) {
      if (!state.threadId) {
        renderMessages([]);
        return;
      }

      var messages = await api.listMessages(state.threadId);
      renderMessages(messages || []);

      if (markSeen) {
        state.lastSeenAt = nowIso();
        state.lastBadgeMessageAt = null;
        setBadge(0);
        saveSession();
      }
    }

    async function refreshUnreadOnly() {
      if (!state.threadId || state.open) {
        return;
      }
      try {
        var thread = await api.getThread(state.threadId);
        var lastSeen = parseIso(state.lastSeenAt);
        var lastMessage = parseIso(thread && thread.lastMessageAt);
        var lastBadgeMessage = parseIso(state.lastBadgeMessageAt);
        if (lastMessage > lastSeen) {
          if (lastMessage > lastBadgeMessage) {
            state.lastBadgeMessageAt = thread.lastMessageAt || nowIso();
            setBadge(Math.min(99, state.unreadCount + 1));
            saveSession();
          }
        }
      } catch (_err) {}
    }

    async function sendCurrentMessage() {
      var text = String(dom.input.value || '').trim();
      var attachments = normalizeMessageAttachments(state.pendingAttachments);
      if (!text && attachments.length === 0) {
        return;
      }
      if (state.loading) {
        return;
      }

      state.loading = true;
      dom.send.disabled = true;
      dom.attach.disabled = true;
      setStatus('Отправка...');

      try {
        var threadId = await ensureThread();
        await ensureWebPushSubscription(true);
        await api.sendMessage(threadId, text, attachments);
        dom.input.value = '';
        resetPendingAttachments();
        await syncMessages(true);
        setStatus(promoMode ? 'На связи' : 'Онлайн');
        showHint(
          promoMode
            ? ''
            : 'Диалог активен: ' + (resolveStationLabel(state.stationId, state.stationName) || 'станция')
        );
      } catch (err) {
        setStatus('Ошибка');
        showHint(err && err.message ? err.message : 'Не удалось отправить сообщение');
      } finally {
        state.loading = false;
        dom.send.disabled = false;
        dom.attach.disabled = false;
      }
    }

    async function validateSavedThread() {
      if (!state.threadId) {
        return;
      }
      try {
        var thread = await api.getThread(state.threadId);
        if (!thread || !thread.id) {
          state.threadId = null;
          saveSession();
          return;
        }
        state.stationId = thread.stationId || state.stationId;
        state.stationName =
          sanitizeStationName(thread && thread.stationName, state.stationId) ||
          resolveStationNameById(state.stationId) ||
          state.stationName;
        saveSession();
      } catch (_err) {
        state.threadId = null;
        saveSession();
      }
    }

    function setDraft(text) {
      dom.input.value = String(text || '').trim();
      if (state.open) {
        dom.input.focus();
      }
    }

    function setPanelOpen(nextOpen) {
      state.open = nextOpen === true;
      if (state.open) {
        dom.panel.classList.remove('phab-panel-hidden');
        syncMessages(true).catch(function () {});
        ensureWebPushSubscription(true).catch(function () {});
        setStatus(promoMode ? 'На связи' : 'Онлайн');
        window.setTimeout(function () {
          if (!state.disposed && state.open) {
            dom.input.focus();
          }
        }, 0);
      } else {
        dom.panel.classList.add('phab-panel-hidden');
      }
      syncBodyLock();
    }

    function openPanel() {
      setPanelOpen(true);
    }

    function closePanel() {
      setPanelOpen(false);
    }

    function togglePanel() {
      setPanelOpen(!state.open);
    }

    async function init() {
      loadSession();
      renderStations();
      await validateSavedThread();

      if (state.stationId) {
        dom.stationSelect.value = state.stationId;
        if (shouldHideStationSelect()) {
          showHint(promoMode ? '' : 'Напишите сообщение, и мы ответим здесь');
        } else {
          showHint('Станция: ' + resolveStationLabel(state.stationId, state.stationName));
        }
      } else if (promoMode) {
        showHint('');
      }

      push.supported = canUseWebPush();
      if (push.supported) {
        ensureWebPushSubscription(false).catch(function () {});
      }

      dom.launcher.addEventListener('click', function () {
        togglePanel();
      });

      dom.close.addEventListener('click', function () {
        closePanel();
      });

      dom.send.addEventListener('click', function () {
        sendCurrentMessage().catch(function () {});
      });

      dom.attach.addEventListener('click', function () {
        if (state.loading) {
          return;
        }
        dom.fileInput.click();
      });

      dom.fileInput.addEventListener('change', function () {
        appendPendingAttachmentsFromFiles(dom.fileInput.files).catch(function (err) {
          setStatus('Ошибка');
          showHint(err && err.message ? err.message : 'Не удалось прикрепить фото');
        });
      });

      dom.input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          sendCurrentMessage().catch(function () {});
        }
      });

      dom.input.addEventListener('focus', function () {
        window.setTimeout(syncBodyLock, 50);
        window.setTimeout(syncBodyLock, 250);
      });

      dom.input.addEventListener('blur', function () {
        window.setTimeout(syncBodyLock, 50);
        window.setTimeout(syncBodyLock, 250);
      });

      dom.stationSelect.addEventListener('change', function () {
        if (shouldHideStationSelect()) {
          return;
        }
        if (!state.threadId) {
          var station = getStationById(dom.stationSelect.value);
          state.stationId = dom.stationSelect.value || null;
          state.stationName = sanitizeStationName(station ? station.name : null, state.stationId) || null;
          saveSession();
          if (state.stationId) {
            showHint('Станция выбрана: ' + resolveStationLabel(state.stationId, state.stationName));
          }
        }
      });

      pollTimer = window.setInterval(function () {
        if (state.disposed) {
          return;
        }
        if (state.open) {
          syncMessages(true).catch(function () {});
        } else {
          refreshUnreadOnly().catch(function () {});
        }
      }, cfg.pollIntervalMs);

      window.addEventListener('resize', syncBodyLock);
      window.addEventListener('orientationchange', syncBodyLock);
      if (visualViewportTarget) {
        visualViewportTarget.addEventListener('resize', syncBodyLock);
        visualViewportTarget.addEventListener('scroll', syncBodyLock);
      }
      syncBodyLock();
    }

    function destroy() {
      closePanel();
      state.disposed = true;
      if (pollTimer) {
        window.clearInterval(pollTimer);
      }
      window.removeEventListener('resize', syncBodyLock);
      window.removeEventListener('orientationchange', syncBodyLock);
      if (visualViewportTarget) {
        visualViewportTarget.removeEventListener('resize', syncBodyLock);
        visualViewportTarget.removeEventListener('scroll', syncBodyLock);
      }
      dom.launcher.remove();
      dom.panel.remove();
      syncBodyLock();
    }

    init().catch(function (err) {
      setStatus('Ошибка');
      showHint(err && err.message ? err.message : 'Ошибка инициализации');
    });

    return {
      open: openPanel,
      close: closePanel,
      toggle: togglePanel,
      setDraft: setDraft,
      destroy: destroy,
      getState: function () {
        return Object.assign({}, state);
      }
    };
  }

  var activeWidgetInstance = null;

  window.PHABMessengerWidget = {
    init: function (config) {
      if (activeWidgetInstance && typeof activeWidgetInstance.destroy === 'function') {
        activeWidgetInstance.destroy();
      }
      activeWidgetInstance = widgetInstance(config || {});
      return activeWidgetInstance;
    },
    open: function () {
      if (activeWidgetInstance && typeof activeWidgetInstance.open === 'function') {
        activeWidgetInstance.open();
      }
      return activeWidgetInstance;
    },
    close: function () {
      if (activeWidgetInstance && typeof activeWidgetInstance.close === 'function') {
        activeWidgetInstance.close();
      }
      return activeWidgetInstance;
    },
    toggle: function () {
      if (activeWidgetInstance && typeof activeWidgetInstance.toggle === 'function') {
        activeWidgetInstance.toggle();
      }
      return activeWidgetInstance;
    },
    setDraft: function (text) {
      if (activeWidgetInstance && typeof activeWidgetInstance.setDraft === 'function') {
        activeWidgetInstance.setDraft(text);
      }
      return activeWidgetInstance;
    },
    getState: function () {
      return activeWidgetInstance && typeof activeWidgetInstance.getState === 'function'
        ? activeWidgetInstance.getState()
        : null;
    },
    destroy: function () {
      if (activeWidgetInstance && typeof activeWidgetInstance.destroy === 'function') {
        activeWidgetInstance.destroy();
      }
      activeWidgetInstance = null;
    }
  };
})();
