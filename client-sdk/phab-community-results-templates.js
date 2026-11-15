(function () {
  'use strict';
  var VERSION = 'vnd-results-figma-v2';
  function paginate(rows) {
    if (!Array.isArray(rows) || rows.length > 50) throw new Error('Максимум 50 мест.');
    var pages = [];
    for (var i = 0; i < rows.length; i += 10) pages.push(rows.slice(i, i + 10));
    return pages;
  }
  function prepare(input, assets) {
    var key = input.design + '_' + input.division;
    if (!assets || assets.version !== VERSION || !/^figma_(start|rokot|smash)$/.test(key) ||
        !assets.html || !Object.prototype.hasOwnProperty.call(assets.html, key)) throw new Error('Неизвестный макет.');
    if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 10 ||
        input.rows.some(function (row) { return !Number.isInteger(row.rank) || row.rank < 1 ||
          typeof row.name !== 'string' || !row.name.trim() || typeof row.score !== 'number' || !Number.isFinite(row.score); })) {
      throw new Error('Некорректные строки результатов.');
    }
    if (!Number.isFinite(new Date(input.dataAsOf).getTime())) throw new Error('Неизвестна дата результатов.');
    var doc = new DOMParser().parseFromString(assets.html[key], 'text/html');
    if (doc.querySelector('script,iframe,object,embed,link')) throw new Error('Недопустимое содержимое макета.');
    var root = doc.body.firstElementChild;
    if (!root) throw new Error('Пустой макет.');
    var fontsCss = doc.querySelector('style').textContent.replace(/url\(([^)]+)\)/g, function (_, path) {
      var resource = path.replace(/["']/g, '').replace(/^\.\.\//, '');
      if (!assets.resources[resource]) throw new Error('В макете отсутствует ресурс.');
      return 'url("' + assets.resources[resource] + '")';
    });
    root.querySelector('[data-community-name]').textContent = String(input.communityName);
    root.querySelector('[data-period]').textContent = '· ' + String(input.periodLabel);
    var rowTemplate = root.querySelector('template[data-row]');
    var rowsRoot = root.querySelector('[data-rows]');
    ['tournamentsPlayed', 'tournamentsWon'].forEach(function (field) {
      if (!input.rows.some(function (row) { return row.statistics && Number.isInteger(row.statistics[field]) && row.statistics[field] >= 0; })) {
        root.querySelector('[data-heading="' + field + '"]').textContent = '';
      }
    });
    input.rows.forEach(function (row, index) {
      var element = rowTemplate.content.firstElementChild.cloneNode(true);
      element.style.top = (435 + index * 87) + 'px';
      element.setAttribute('data-export-rank', row.rank);
      var leader = row.rank === 1;
      var position = element.querySelector('[data-position]');
      position.textContent = leader ? '' : String(row.rank);
      element.querySelector('[data-highlight]').hidden = !leader;
      element.querySelector('[data-crown]').hidden = !leader;
      if (leader) {position.style.background = '#8766eb'; position.style.borderColor = '#8766eb';}
      element.querySelector('[data-name]').textContent = row.name;
      // The export contract has no nickname. Preserve its space without inventing one.
      element.querySelector('[data-nickname]').remove();
      Array.from(element.querySelectorAll('[data-stat]')).forEach(function (metric) {
        var value = row.statistics && row.statistics[metric.dataset.stat];
        metric.textContent = Number.isInteger(value) && value >= 0 ? String(value) : '';
        if (leader) {metric.style.color = '#8766eb'; metric.style.fontWeight = '800';}
      });
      element.querySelector('[data-export-score]').textContent = row.score.toLocaleString('ru-RU', {maximumFractionDigits: 3});
      element.querySelector('[data-star]').setAttribute('src', '../img/' + (leader ? 'star.svg' : 'star-purple.svg'));
      if (leader) {
        var pill = element.querySelector('[data-score-pill]');
        pill.style.background = '#8766eb'; pill.style.color = '#fff';
        element.querySelector('[data-export-score]').style.fontWeight = '800';
      }
      if (leader || index === input.rows.length - 1) element.querySelector('[data-separator]').remove();
      rowsRoot.appendChild(element);
    });
    rowTemplate.remove();
    Array.from(root.querySelectorAll('img')).forEach(function (image) {
      var resource = image.getAttribute('src').replace(/^\.\.\//, '');
      if (!assets.resources[resource]) throw new Error('Не загружена графика шаблона.');
      image.setAttribute('src', assets.resources[resource]);
    });
    // Measure with the exact loaded fonts; preserve all numeric digits and column positions.
    var holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-100000px;top:0;width:1080px;height:1350px;pointer-events:none';
    holder.setAttribute('aria-hidden', 'true');
    var shadow = holder.attachShadow({mode: 'closed'});
    var style = document.createElement('style'); style.textContent = fontsCss;
    shadow.appendChild(style); shadow.appendChild(root);
    document.body.appendChild(holder);
    var overflowingScores = 0;
    try {
      Array.from(root.querySelectorAll('[data-export-score], [data-stat]')).forEach(function (element) {
        var size = parseFloat(getComputedStyle(element).fontSize);
        while (element.scrollWidth > element.clientWidth && size > 12) element.style.fontSize = (--size) + 'px';
        if (element.hasAttribute('data-export-score') && element.scrollWidth > element.clientWidth) overflowingScores++;
      });
    } finally {holder.remove();}
    if (overflowingScores) throw new Error('Очки не помещаются в выбранный макет.');
    root.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    return {html: new XMLSerializer().serializeToString(root), fontsCss: fontsCss, overflowingScores: overflowingScores};
  }
  var fontPromise;
  function loadFonts(assets) {
    if (!fontPromise) {
      fontPromise = Promise.all(Object.keys(assets.resources).filter(function (key) {return key.indexOf('fonts/') === 0;}).map(function (key) {
        var family = key.indexOf('InterDisplay') >= 0 ? 'Inter Display' : key.indexOf('RFDewi') >= 0 ? 'RF Dewi' : 'Source Code Pro';
        var weight = /Ultrabold/.test(key) ? '800 900' : /Semi[Bb]old/.test(key) ? '600' : /Bold/.test(key) ? '700' : /Medium/.test(key) ? '500' : '400';
        var face = new FontFace(family, 'url(' + assets.resources[key] + ')', {weight: weight});
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
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    var canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
    var context = canvas.getContext('2d');
    if (!context) throw new Error('Браузер не поддерживает создание PNG.');
    context.drawImage(image, 0, 0); image.src = '';
    return canvas;
  }
  window.PHABCommunityResultsTemplates = { paginate: paginate, prepare: prepare, render: render };
})();
