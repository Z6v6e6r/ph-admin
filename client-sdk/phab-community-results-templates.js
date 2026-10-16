(function () {
  'use strict';
  function paginate(rows) {
    if (!Array.isArray(rows) || rows.length > 50) throw new Error('Максимум 50 мест.');
    var pages = [];
    for (var i = 0; i < rows.length; i += 10) pages.push(rows.slice(i, i + 10));
    return pages;
  }
  function prepare(input, assets) {
    var key = input.design + '_' + input.division;
    if (!assets || assets.version !== 'vnd-results-templates-v1' ||
        !/^(01_klassika|02_temnaya_arena|03_podium|04_tablo|05_oblozhka)_(start|rokot|smash)$/.test(key) ||
        !Object.prototype.hasOwnProperty.call(assets.html, key)) throw new Error('Неизвестный макет.');
    if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 10 ||
        input.rows.some(function (row) { return !Number.isInteger(row.rank) || row.rank < 1 ||
          typeof row.name !== 'string' || !row.name.trim() || typeof row.score !== 'number' || !Number.isFinite(row.score); })) {
      throw new Error('Некорректные строки результатов.');
    }
    var doc = new DOMParser().parseFromString(assets.html[key], 'text/html');
    if (doc.querySelector('script,iframe,object,embed,link')) throw new Error('Недопустимое содержимое макета.');
    var root = doc.body.firstElementChild;
    if (!root) throw new Error('Пустой макет.');
    var fontsCss = doc.querySelector('style').textContent.replace(/url\(([^)]+)\)/g, function (_, path) {
      var resource = path.replace(/["']/g, '').replace(/^\.\.\//, '');
      if (!assets.resources[resource]) throw new Error('В макете отсутствует ресурс.');
      return 'url("' + assets.resources[resource] + '")';
    });
    Array.from(root.querySelectorAll('img')).forEach(function (image) {
      var resource = image.getAttribute('src').replace(/^\.\.\//, '');
      if (!assets.resources[resource]) throw new Error('Не загружен логотип.');
      image.setAttribute('src', assets.resources[resource]);
    });
    var playedKnown = input.rows.some(function (row) { return row.statistics && Number.isInteger(row.statistics.tournamentsPlayed) && row.statistics.tournamentsPlayed >= 0; });
    var winsKnown = input.rows.some(function (row) { return row.statistics && Number.isInteger(row.statistics.tournamentsWon) && row.statistics.tournamentsWon >= 0; });
    function count(row, field) {
      var value = row.statistics && row.statistics[field];
      return Number.isInteger(value) && value >= 0 ? String(value) : '';
    }
    function setName(element, name) {
      if (element.firstElementChild) {
        var original = element.firstElementChild.style;
        ['fontFamily', 'fontWeight', 'fontSize', 'textTransform'].forEach(function (key) {
          if (original[key]) element.style[key] = original[key];
        });
      }
      element.textContent = name;
      element.style.display = 'block';
      element.style.minWidth = '0';
      element.style.maxWidth = '100%';
      element.style.whiteSpace = 'nowrap';
      element.style.overflow = 'hidden';
      element.style.textOverflow = 'ellipsis';
    }
    function statistics(row) {
      var parts = [];
      if (count(row, 'tournamentsPlayed')) parts.push(count(row, 'tournamentsPlayed') + ' турн');
      if (count(row, 'tournamentsWon')) parts.push(count(row, 'tournamentsWon') + ' первых мест');
      return parts.join(' · ');
    }
    function mark(element, row) {
      element.setAttribute('data-export-rank', row.rank);
      // Inline sample arrows must not survive. No comparable historical snapshot exists.
      Array.from(element.querySelectorAll('span')).forEach(function (span) {
        if (/^[▲▼]/.test(span.textContent.trim())) span.remove();
      });
    }
    var grids = Array.from(root.querySelectorAll('div')).filter(function (element) {
      return element.style.display === 'grid';
    });
    grids.forEach(function (grid) {
      var children = Array.from(grid.children);
      var sampleRank = children.length && /^\d+$/.test(children[0].textContent.trim()) ? Number(children[0].textContent.trim()) : 0;
      if ((children.length === 5 || children.length === 3) && sampleRank >= 1 && sampleRank <= 10) {
        var row = input.rows[sampleRank - 1];
        if (!row) { grid.remove(); return; }
        mark(grid, row);
        children[0].textContent = String(row.rank).padStart(2, '0');
        if (children.length === 5) {
          setName(children[1], row.name);
          children[2].textContent = count(row, 'tournamentsPlayed');
          children[3].textContent = count(row, 'tournamentsWon');
          children[4].textContent = row.score.toLocaleString('ru-RU', {maximumFractionDigits: 3});
          children[4].setAttribute('data-export-score', '');
          children[4].style.maxWidth = 'calc(100% - 8px)';
          children[4].style.boxSizing = 'border-box';
          children[4].style.justifySelf = 'end';
        } else {
          setName(children[1].children[0], row.name);
          children[1].children[1].textContent = statistics(row);
          children[2].textContent = row.score.toLocaleString('ru-RU', {maximumFractionDigits: 3});
          children[2].setAttribute('data-export-score', '');
        }
      }
      if (children.length === 5) {
        // Keep unknown metrics absent, including when an older server supplies no statistics.
        grid.style.columnGap = '12px';
        var columns = grid.style.gridTemplateColumns.split(/\s+(?![^()]*\))/);
        if (!winsKnown) { children[3].remove(); columns.splice(3, 1); }
        if (!playedKnown) { children[2].remove(); columns.splice(2, 1); }
        grid.style.gridTemplateColumns = columns.join(' ');
      }
      if (/repeat\(3,/.test(grid.style.gridTemplateColumns)) {
        children.forEach(function (card, index) {
          var row = input.rows[[1, 0, 2][index]];
          if (!row) { card.replaceChildren(); card.style.visibility = 'hidden'; return; }
          mark(card, row);
          var parts = Array.from(card.children);
          var podium = input.design === '03_podium';
          if (podium) {
            var initials = row.name.trim().split(/\s+/).slice(0, 2).map(function (part) {return Array.from(part)[0];}).join('');
            parts[0].children[0].textContent = initials;
            parts[0].children[1].textContent = row.rank;
          } else {
            var rankCell = parts[0];
            if (rankCell.children.length) {
              rankCell.children[0].textContent = row.rank;
              if (row.rank !== 1) rankCell.children[1].remove();
            } else rankCell.textContent = row.rank;
          }
          setName(parts[1], row.name);
          parts[2].textContent = statistics(row);
          var score = podium ? parts[3].children[0] : parts[3];
          score.textContent = row.score.toLocaleString('ru-RU', {maximumFractionDigits: 3});
          score.setAttribute('data-export-score', '');
        });
      }
    });
    Array.from(root.querySelectorAll('div')).forEach(function (element) {
      if (element.children.length === 2 && element.firstElementChild.textContent.trim() === 'СЛЕДУЮЩИЙ ТУР') element.remove();
    });
    var walker = doc.createTreeWalker(root, 4);
    var textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    var date = new Date(input.dataAsOf);
    if (!Number.isFinite(date.getTime())) throw new Error('Неизвестна дата результатов.');
    var stamp = date.toLocaleString('ru-RU', {timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short'});
    textNodes.forEach(function (node) {
      var value = node.textContent.trim();
      if (!value) return;
      if (node.parentElement.closest('[data-export-rank]')) return;
      var league = /Лига|ЛИГА/.test(value) && /ВНД|Время на друзей/.test(value);
      if (league) {
        node.textContent = String(input.communityName) + (/\[N\]/.test(value) ? '\n' + input.periodLabel : '');
        if (/\[N\]/.test(value)) {
          node.parentElement.style.whiteSpace = 'pre-line';
          node.parentElement.style.fontSize = '14px';
          node.parentElement.style.maxWidth = '700px';
        }
      } else if (/\[N\]/.test(value)) node.textContent = String(input.periodLabel);
      if (/Обновлено|ОБНОВЛЕНО/.test(value)) node.textContent = 'Данные на ' + stamp + ' · Москва';
      if (value === 'ТОП-3') node.textContent = input.page > 0 ? 'МЕСТА ' + input.rows[0].rank + '–' + input.rows[Math.min(2, input.rows.length - 1)].rank : 'ТОП-' + Math.min(3, input.rows.length);
      if (/^(?:■\s*)?4[–-]10 МЕСТО$/.test(value)) {
        if (input.rows.length > 3) node.textContent = '■ ' + input.rows[3].rank + '–' + input.rows[input.rows.length - 1].rank + ' МЕСТО';
        else node.parentElement.remove();
      }
      if (/\[ДД|\[ЛОКАЦИЯ/.test(node.textContent)) node.textContent = '';
    });
    // Keep the supplied composition; the footer makes metric semantics and pagination explicit.
    var footer = root.lastElementChild;
    if (input.design === '03_podium' || input.design === '05_oblozhka') footer = footer.lastElementChild;
    if (footer && footer.children.length >= 2) {
      footer.lastElementChild.textContent = (winsKnown ? 'Победы — 1-е места · ' : '') + (Number(input.page) + 1) + '/' + input.pageCount;
      footer.style.fontSize = '14px';
    }
    if (input.page > 0 && input.design === '03_podium') {
      Array.from(root.querySelectorAll('div')).forEach(function (element) {
        if (!element.children.length && /^МЕСТА /.test(element.textContent)) element.style.fontSize = '64px';
      });
    }
    root.style.flexShrink = '0';
    root.style.overflow = 'hidden';
    root.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    // Measure the real supplied fonts in an isolated, offscreen tree. Never shorten
    // numeric results; reduce only overflowing score type, retaining every digit.
    var holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-100000px;top:0;width:1080px;height:1350px;pointer-events:none';
    holder.setAttribute('aria-hidden', 'true');
    holder.attachShadow({mode: 'closed'}).appendChild(root);
    document.body.appendChild(holder);
    var scores = Array.from(root.querySelectorAll('[data-export-score]'));
    var overflowingScores = 0;
    try {
      scores.forEach(function (element) {
        element.style.minWidth = '0';
        element.style.whiteSpace = 'nowrap';
        var size = parseFloat(getComputedStyle(element).fontSize);
        while (element.scrollWidth > element.clientWidth && size > 12) {
          element.style.fontSize = (--size) + 'px';
        }
        if (element.scrollWidth > element.clientWidth) overflowingScores++;
      });
    } finally {holder.remove();}
    if (overflowingScores) throw new Error('Очки не помещаются в выбранный макет.');
    var html = new XMLSerializer().serializeToString(root);
    return {html: html, fontsCss: fontsCss, overflowingScores: overflowingScores};
  }
  var fontPromise;
  function loadFonts(assets) {
    if (!fontPromise) {
      fontPromise = Promise.all(Object.keys(assets.resources).filter(function (key) {return key.indexOf('fonts/') === 0;}).map(function (key) {
        var expanded = key.indexOf('RFDewiExpanded') >= 0;
        var weight = /Black/.test(key) ? '900' : /Semi[Bb]old|Semibold/.test(key) ? '600' : /Bold/.test(key) ? '700' : /Medium/.test(key) ? '500' : '400';
        var face = new FontFace(expanded ? 'RF Dewi Expanded' : 'Source Code Pro', 'url(' + assets.resources[key] + ')', {weight: weight});
        return face.load().then(function (loaded) {document.fonts.add(loaded);});
      })).catch(function () {fontPromise = null; throw new Error('Не удалось загрузить шрифты шаблона.');});
    }
    return fontPromise;
  }
  async function render(input, assets) {
    await loadFonts(assets);
    var prepared = prepare(input, assets);
    var style = '<style xmlns="http://www.w3.org/1999/xhtml">' + prepared.fontsCss.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</style>';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><foreignObject width="1080" height="1350">' +
      '<div xmlns="http://www.w3.org/1999/xhtml">' + style + prepared.html + '</div></foreignObject></svg>';
    var image = new Image();
    await new Promise(function (resolve, reject) {
      var timeout = setTimeout(function () {image.src = ''; reject(new Error('Превышено время отрисовки шаблона.'));}, 15000);
      image.onload = function () {clearTimeout(timeout); resolve();};
      image.onerror = function () {clearTimeout(timeout); reject(new Error('Браузер не смог отрисовать шаблон.'));};
      // A self-contained data SVG keeps the canvas origin-clean; no foreign resource is fetched.
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    var canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1350;
    var context = canvas.getContext('2d');
    if (!context) throw new Error('Браузер не поддерживает создание PNG.');
    context.drawImage(image, 0, 0);
    image.src = '';
    return canvas;
  }
  window.PHABCommunityResultsTemplates = { paginate: paginate, prepare: prepare, render: render };
})();
