(function () {
  'use strict';
  var DATA = window.APP_DATA;
  var I18N = DATA.i18n;
  var H = 5;            // 参考半衰期（小时）
  var THETA = 10;       // 参考值 θ（mg）
  var COMPARE_MAX = 3;
  var HOUR = 3600000, MIN = 60000, SEOUL = 9 * HOUR;
  var LS = { lang: 'bcv_lang', bedtime: 'bcv_bedtime', records: 'bcv_records', compare: 'bcv_compare_ids' };
  var LOCALES = { zh: 'zh-CN', ko: 'ko-KR', en: 'en-US' };

  var CAT_KEY = {
    '咖啡及含咖啡饮品': 'cat_coffee', '抹茶／绿茶饮品': 'cat_matcha', '奶茶／茶拿铁': 'cat_milk_tea',
    '巧克力／可可饮品': 'cat_chocolate', '茶及调味茶饮': 'cat_tea', '其他含咖啡因饮品': 'cat_other',
    '能量饮料': 'cat_energy', '杯装即饮咖啡': 'cat_rtd_cup', '瓶装即饮咖啡': 'cat_rtd_bottle',
    '提神类产品（医药外品）': 'cat_tonic'
  };
  var TEMP_KEY = { 'HOT': 'hot', 'ICED': 'iced', '官网单一版本': 'single_variant', '包装饮料': 'packaged' };
  var RETAIL_BRANDS = ['cantata', 'hot6', 'letsbe'];

  // ---------- 数据索引 ----------
  var products = DATA.products;
  var byId = {};
  products.forEach(function (p) { byId[p.id] = p; });
  var brands = DATA.brands;
  var brandById = {};
  brands.forEach(function (b) { brandById[b.brand_id] = b; });
  var logoBrands = brands.filter(function (b) { return b.logo_path; });
  // 产品分组：同品牌同官方原名 → 不同规格/冷热版本
  var groups = [], groupByKey = {};
  products.forEach(function (p) {
    var k = p.brand_id + '|' + p.product_ko;
    var g = groupByKey[k];
    if (!g) { g = groupByKey[k] = { key: k, brand_id: p.brand_id, name: p.product_ko, channel: p.channel, variants: [], cats: {} }; groups.push(g); }
    g.variants.push(p);
    g.cats[p.category] = true;
  });
  var categories = [];
  products.forEach(function (p) { if (categories.indexOf(p.category) < 0) categories.push(p.category); });

  // ---------- 存储 ----------
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  function detectLang() {
    var list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < list.length; i++) {
      var l = String(list[i]).toLowerCase();
      if (l.indexOf('zh') === 0) return 'zh';
      if (l.indexOf('ko') === 0) return 'ko';
      if (l.indexOf('en') === 0) return 'en';
    }
    return 'en';
  }
  var state = {
    lang: (function () { var l = lsGet(LS.lang); return I18N[l] ? l : detectLang(); })(),
    bedtime: (function () { var b = lsGet(LS.bedtime); return /^([01]\d|2[0-3]):[0-5]\d$/.test(b || '') ? b : ''; })(),
    records: (function () { try { var r = JSON.parse(lsGet(LS.records) || '[]'); return Array.isArray(r) ? r : []; } catch (e) { return []; } })(),
    compare: (function () { try { var r = JSON.parse(lsGet(LS.compare) || '[]'); return Array.isArray(r) ? r.filter(function (id) { return byId[id]; }).slice(0, COMPARE_MAX) : []; } catch (e) { return []; } })(),
    view: 'add',
    brand: null,          // 选中的品牌 id 或 'retail'
    retailBrand: 'all',
    groupKey: null,
    variantId: null,
    day: null,
    editing: null
  };

  function saveRecords() {
    var ok = lsSet(LS.records, JSON.stringify(state.records));
    if (!ok) toast(t('save_failed'));
    return ok;
  }

  // ---------- 文案与格式 ----------
  function t(key, vars) {
    var s = (I18N[state.lang] && I18N[state.lang][key]);
    if (s == null) s = I18N.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  function loc() { return LOCALES[state.lang]; }
  function brandName(id) {
    var b = brandById[id];
    if (!b) return id;
    return b['name_' + state.lang] || b.name_en;
  }
  function catLabel(c) { return CAT_KEY[c] ? t(CAT_KEY[c]) : c; }
  function tempLabel(v) { return TEMP_KEY[v] ? t(TEMP_KEY[v]) : v; }
  function fmtNum(n, maxFrac) {
    return new Intl.NumberFormat(loc(), { maximumFractionDigits: maxFrac == null ? 1 : maxFrac }).format(n);
  }
  function fmtMg(n) {
    if (n > 0 && n < 0.1) return '<' + fmtNum(0.1) + ' mg';
    return fmtNum(Math.round(n * 10) / 10) + ' mg';
  }
  function fmtQty(q) { return fmtNum(q, 2); }
  function fmtTime(ms) {
    return new Intl.DateTimeFormat(loc(), { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  }
  function fmtDate(ms, withWeekday) {
    var o = { timeZone: 'Asia/Seoul', year: 'numeric', month: 'short', day: 'numeric' };
    if (withWeekday) o.weekday = 'short';
    return new Intl.DateTimeFormat(loc(), o).format(new Date(ms));
  }
  function fmtDateTime(ms) {
    return new Intl.DateTimeFormat(loc(), { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  }
  // 与“现在”同一天只显示时分，否则带日期
  function fmtSmart(ms) { return seoulDay(ms) === seoulDay(Date.now()) ? fmtTime(ms) : fmtDateTime(ms); }

  // ---------- Asia/Seoul 时间工具（UTC+9，无夏令时） ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function seoulParts(ms) {
    var d = new Date(ms + SEOUL);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
  }
  function seoulDay(ms) { var p = seoulParts(ms); return p.y + '-' + pad(p.m) + '-' + pad(p.d); }
  function seoulHM(ms) { var p = seoulParts(ms); return pad(p.h) + ':' + pad(p.mi); }
  function fromSeoul(dateStr, timeStr) {
    var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
    var tm = /^(\d{2}):(\d{2})/.exec(timeStr || '');
    if (!dm || !tm) return NaN;
    return Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]) - SEOUL;
  }
  function isoSeoul(ms) {
    var p = seoulParts(ms), s = new Date(ms + SEOUL).getUTCSeconds();
    return p.y + '-' + pad(p.m) + '-' + pad(p.d) + 'T' + pad(p.h) + ':' + pad(p.mi) + ':' + pad(s) + '+09:00';
  }
  function dayStartMs(dayStr) { return fromSeoul(dayStr, '00:00'); }
  function shiftDay(dayStr, n) { return seoulDay(dayStartMs(dayStr) + n * 24 * HOUR + 2 * HOUR); }

  // ---------- 计算 ----------
  function recTime(r) { return Date.parse(r.consumed_at); }
  function isKnown(r) { return typeof r.caffeine_mg === 'number' && isFinite(r.caffeine_mg); }
  function dose(r) { return r.caffeine_mg * r.quantity; }
  function knownRecords() { return state.records.filter(isKnown); }
  function R(T, recs) {
    var s = 0;
    (recs || knownRecords()).forEach(function (r) {
      var tt = recTime(r);
      if (tt <= T) s += dose(r) * Math.pow(2, -(T - tt) / (H * HOUR));
    });
    return s;
  }
  function bedtimeMs(now) {
    if (!state.bedtime) return null;
    var B = fromSeoul(seoulDay(now), state.bedtime);
    if (B < now) B += 24 * HOUR;
    return B;
  }
  function validQty(v) {
    if (!/^\d+(\.\d{1,2})?$/.test(String(v).trim())) return null;
    var q = parseFloat(v);
    return q > 0 && isFinite(q) ? q : null;
  }
  // 最晚饮用时间
  function latestDrink(now) {
    var B = bedtimeMs(now);
    if (B == null) return { kind: 'nobed' };
    var p = state.variantId ? byId[state.variantId] : null;
    if (!p) return { kind: 'nodrink' };
    var q = validQty(el('qtyInput').value);
    if (q == null) return { kind: 'badqty' };
    var D1 = p.caffeine_mg * q;
    var R0 = R(B);
    var basis = p.product_ko + ' · ' + p.serving_label + ' · ' + tempLabel(p.temperature) + ' × ' + fmtQty(q) + ' = ' + fmtMg(D1);
    if (R0 >= THETA) return { kind: 'over', basis: basis };
    if (D1 <= THETA - R0) return { kind: 'ok', basis: basis };
    var x = B - H * HOUR * (Math.log(D1 / (THETA - R0)) / Math.LN2);
    x = Math.floor(x / MIN) * MIN;
    if (x < now) return { kind: 'late', basis: basis };
    return { kind: 'time', x: x, basis: basis };
  }

  // ---------- DOM 工具 ----------
  function el(id) { return document.getElementById(id); }
  function h(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }
  function drinkImg(path, alt, cls) {
    var wrap = h('div', { class: 'img-box ' + (cls || '') });
    var img = h('img', { src: path, alt: alt, loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', function () {
      clear(wrap).appendChild(h('span', { class: 'img-fail', text: t('drink_image_unavailable') }));
    });
    wrap.appendChild(img);
    return wrap;
  }
  function shortUrl(u) {
    try { var x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname.length > 1 ? x.pathname.slice(0, 28) + (x.pathname.length > 28 ? '…' : '') : ''); } catch (e) { return u; }
  }
  function link(u, text) { return h('a', { href: u, target: '_blank', rel: 'noopener', text: text || shortUrl(u) }); }
  var toastTimer;
  function toast(msg) {
    var e = el('toast'); e.textContent = msg; e.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { e.classList.remove('show'); }, 2200);
  }

  // ---------- 语言 ----------
  function applyStatic() {
    document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : state.lang;
    document.title = t('app_name');
    document.querySelectorAll('[data-t]').forEach(function (e) { e.textContent = t(e.getAttribute('data-t')); });
    el('searchInput').placeholder = t('search_hint');
    el('cmpSearch').placeholder = t('search_hint');
    el('langSelect').value = state.lang;
    fillCatSelect(el('catFilter'));
    fillCatSelect(el('cmpCat'));
    var cb = el('cmpBrand'), cur = cb.value || 'all';
    clear(cb).appendChild(h('option', { value: 'all', text: t('all') }));
    brands.forEach(function (b) {
      if (!products.some(function (p) { return p.brand_id === b.brand_id; })) return;
      cb.appendChild(h('option', { value: b.brand_id, text: brandName(b.brand_id) }));
    });
    cb.value = cur;
  }
  function fillCatSelect(sel) {
    var cur = sel.value || 'all';
    clear(sel).appendChild(h('option', { value: 'all', text: t('all') }));
    categories.forEach(function (c) { sel.appendChild(h('option', { value: c, text: catLabel(c) })); });
    sel.value = cur;
  }

  // ---------- 视图切换 ----------
  function setView(v) {
    state.view = v;
    document.querySelectorAll('.view').forEach(function (s) { s.classList.toggle('active', s.id === 'view-' + v); });
    document.querySelectorAll('#tabs button').forEach(function (b) {
      var on = b.getAttribute('data-view') === v;
      b.classList.toggle('active', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    if (v === 'curve') renderCurve();
  }

  // ---------- 顶部摘要 ----------
  function renderSummary() {
    var now = Date.now(), box = clear(el('summary'));
    var today = seoulDay(now);
    var todays = state.records.filter(function (r) { return seoulDay(recTime(r)) === today; });
    var intake = todays.filter(isKnown).reduce(function (s, r) { return s + dose(r); }, 0);
    function tile(label, value, sub) {
      return h('div', { class: 'tile' }, [h('div', { class: 'tile-label', text: label }), h('div', { class: 'tile-value', text: value }), sub ? h('div', { class: 'tile-sub', text: sub }) : null]);
    }
    box.appendChild(tile(t('estimated_remaining') + ' · ' + t('now'), fmtMg(R(now)), fmtTime(now)));
    box.appendChild(tile(t('today_intake'), fmtMg(intake), t('total_servings') + ' ' + fmtQty(todays.reduce(function (s, r) { return s + r.quantity; }, 0))));
    var B = bedtimeMs(now);
    box.appendChild(B == null ? tile(t('remaining_at_bedtime'), '—', t('bedtime_not_set'))
      : tile(t('remaining_at_bedtime'), fmtMg(R(B)), t('bedtime') + ' ' + fmtSmart(B)));
    var hasUnknown = state.records.some(function (r) { return !isKnown(r); });
    var foot = h('p', { class: 'summary-note' }, [t('estimate_notice') + ' · ' + t('reference_disclaimer')]);
    box.appendChild(foot);
    if (hasUnknown) box.appendChild(h('p', { class: 'unknown-banner', text: '⚠ ' + t('unknown_notice') }));
  }

  // ---------- 1. 睡眠设置 ----------
  function renderBedtime() {
    el('bedtimeInput').value = state.bedtime || '';
    var s = clear(el('bedtimeStatus')), now = Date.now();
    if (!state.bedtime) {
      s.appendChild(h('p', { class: 'muted', text: t('bedtime_not_set') }));
      s.appendChild(h('p', { class: 'muted', text: t('set_bedtime_prompt') }));
      return;
    }
    var B = bedtimeMs(now);
    s.appendChild(h('p', { class: 'big' }, [t('bedtime') + ': ', h('strong', { text: fmtDateTime(B) })]));
    s.appendChild(bedtimeVerdict(now));
  }
  function bedtimeVerdict(now) {
    var B = bedtimeMs(now);
    var RB = R(B);
    var wrap = h('div', { class: 'verdict ' + (RB > THETA ? 'over' : 'under') });
    wrap.appendChild(h('p', null, [t('remaining_at_bedtime') + ': ', h('strong', { text: fmtMg(RB) })]));
    wrap.appendChild(h('p', { text: RB <= THETA ? t('bedtime_below_reference', { threshold: fmtNum(THETA) }) : t('bedtime_above_reference', { threshold: fmtNum(THETA) }) }));
    wrap.appendChild(h('p', { class: 'note', text: t('estimate_notice') }));
    return wrap;
  }

  // ---------- 2. 记录饮用：品牌区 ----------
  function renderBrandGrid() {
    var g = clear(el('brandGrid'));
    logoBrands.forEach(function (b) {
      var name = brandName(b.brand_id);
      var btn = h('button', { class: 'brand-tile' + (state.brand === b.brand_id ? ' active' : '') + (b.brand_id === 'bluebottle' ? ' dark-logo' : ''), 'aria-pressed': state.brand === b.brand_id ? 'true' : 'false', title: name }, [
        h('span', { class: 'logo-box' }, [h('img', { src: b.logo_path, alt: name + ' — ' + t('brand_logo') })]),
        h('span', { class: 'brand-name', text: name })
      ]);
      btn.addEventListener('click', function () { selectBrand(b.brand_id); });
      g.appendChild(btn);
    });
    var r = h('button', { class: 'brand-tile retail-tile' + (state.brand === 'retail' ? ' active' : ''), 'aria-pressed': state.brand === 'retail' ? 'true' : 'false' }, [
      h('span', { class: 'logo-box text-box', text: t('retail') }),
      h('span', { class: 'brand-name', text: t('retail') })
    ]);
    r.addEventListener('click', function () { selectBrand('retail'); });
    g.appendChild(r);

    var rb = el('retailBrands');
    rb.hidden = state.brand !== 'retail';
    clear(rb);
    if (state.brand === 'retail') {
      ['all'].concat(RETAIL_BRANDS).forEach(function (id) {
        var label = id === 'all' ? t('all') : brandName(id);
        var b = h('button', { class: 'chip' + (state.retailBrand === id ? ' active' : ''), 'aria-pressed': state.retailBrand === id ? 'true' : 'false', text: label });
        b.addEventListener('click', function () { state.retailBrand = id; renderBrandGrid(); renderProductList(); });
        rb.appendChild(b);
      });
    }
  }
  function selectBrand(id) {
    state.brand = state.brand === id ? null : id;
    state.retailBrand = 'all';
    el('searchInput').value = '';
    renderBrandGrid(); renderProductList();
    if (state.brand) el('productListCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }
  function brandSearchText(id) { var b = brandById[id]; return b ? norm(b.name_zh + b.name_ko + b.name_en + id) : ''; }
  function groupMatches(g, q, cat) {
    if (cat !== 'all' && !g.cats[cat]) return false;
    if (!q) return true;
    var catText = Object.keys(g.cats).map(function (c) { return c + (CAT_KEY[c] ? ['zh', 'ko', 'en'].map(function (l) { return I18N[l][CAT_KEY[c]]; }).join('') : ''); }).join('');
    return (norm(g.name) + brandSearchText(g.brand_id) + norm(catText)).indexOf(q) >= 0;
  }

  // ---------- 产品列表 ----------
  function renderProductList() {
    var q = norm(el('searchInput').value), cat = el('catFilter').value || 'all';
    var card = el('productListCard'), list = clear(el('productList'));
    var scope;
    if (q) scope = groups;
    else if (state.brand === 'retail') scope = groups.filter(function (g) { return g.channel === 'retail' && (state.retailBrand === 'all' || g.brand_id === state.retailBrand); });
    else if (state.brand) scope = groups.filter(function (g) { return g.brand_id === state.brand; });
    else if (cat !== 'all') scope = groups;
    else { card.hidden = true; return; }
    card.hidden = false;
    if (state.brand && state.brand !== 'retail' && !q && !groups.some(function (g) { return g.brand_id === state.brand; })) {
      list.appendChild(h('p', { class: 'muted', text: brandName(state.brand) + ' — ' + t('no_verified_products') }));
      return;
    }
    var items = scope.filter(function (g) { return groupMatches(g, q, cat); });
    if (!items.length) { list.appendChild(h('p', { class: 'muted', text: t('no_results') })); return; }
    items.forEach(function (g) {
      var first = g.variants[0];
      var mgs = g.variants.map(function (v) { return v.caffeine_mg; });
      var lo = Math.min.apply(null, mgs), hi = Math.max.apply(null, mgs);
      var btn = h('button', { class: 'product-card' + (state.groupKey === g.key ? ' active' : '') }, [
        drinkImg(first.img, g.name, 'thumb'),
        h('span', { class: 'pc-name', text: g.name }),
        h('span', { class: 'pc-brand', text: brandName(g.brand_id) }),
        h('span', { class: 'pc-mg', text: lo === hi ? fmtMg(lo) : fmtMg(lo) + ' – ' + fmtMg(hi) })
      ]);
      btn.addEventListener('click', function () { selectGroup(g.key, null, true); });
      list.appendChild(btn);
    });
  }

  function selectGroup(key, variantId, scroll) {
    var g = groupByKey[key];
    if (!g) return;
    state.groupKey = key;
    state.variantId = variantId || (g.variants.length === 1 ? g.variants[0].id : null);
    document.querySelectorAll('.product-card.active').forEach(function (e) { e.classList.remove('active'); });
    renderDetail(); renderSelectedSummary(); renderLatest();
    if (scroll) el('detailCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function sourceBlock(p) {
    var box = h('div', { class: 'source-block' });
    box.appendChild(h('div', null, [h('span', { class: 'k', text: t('source') + ': ' }), link(p.source_url)]));
    if (p.source_label_url) box.appendChild(h('div', null, [h('span', { class: 'k', text: '+ ' }), link(p.source_label_url)]));
    if (p.secondary_source_url) box.appendChild(h('div', null, [h('span', { class: 'k', text: '+ ' }), link(p.secondary_source_url)]));
    box.appendChild(h('div', null, [h('span', { class: 'k', text: t('checked_date') + ': ' }), p.checked_date]));
    if (p.source_evidence) box.appendChild(h('div', { class: 'evidence', text: p.source_evidence }));
    if (p.notes) box.appendChild(h('div', { class: 'evidence', text: p.notes }));
    return box;
  }
  function imageCredit(p) {
    return h('p', { class: 'img-credit' }, [h('a', { href: p.img_page, target: '_blank', rel: 'noopener', text: t('image_credit') })]);
  }

  function renderDetail() {
    var card = el('detailCard'), box = clear(el('productDetail'));
    var g = state.groupKey ? groupByKey[state.groupKey] : null;
    card.hidden = !g;
    if (!g) return;
    var sel = state.variantId ? byId[state.variantId] : null;
    var shown = sel || g.variants[0];
    var head = h('div', { class: 'detail-head' }, [
      drinkImg(shown.img, g.name, 'large'),
      h('div', { class: 'detail-text' }, [
        h('div', { class: 'k', text: t('official_product_name') }),
        h('h3', { class: 'detail-name', text: g.name }),
        h('div', { class: 'tags' }, [
          h('span', { class: 'tag', text: brandName(g.brand_id) }),
          h('span', { class: 'tag', text: t(g.channel === 'retail' ? 'retail' : 'cafe') }),
          h('span', { class: 'tag', text: catLabel(shown.category) })
        ]),
        imageCredit(shown)
      ])
    ]);
    box.appendChild(head);
    box.appendChild(h('div', { class: 'k', text: t('specification') + ' / ' + t('temperature') }));
    var vlist = h('div', { class: 'variants', role: 'radiogroup' });
    g.variants.forEach(function (v) {
      var on = state.variantId === v.id;
      var b = h('button', { class: 'variant' + (on ? ' active' : ''), role: 'radio', 'aria-checked': on ? 'true' : 'false' }, [
        h('span', { class: 'v-temp', text: tempLabel(v.temperature) }),
        h('span', { class: 'v-spec', text: v.serving_label }),
        h('span', { class: 'v-mg', text: fmtMg(v.caffeine_mg) })
      ]);
      b.addEventListener('click', function () { state.variantId = v.id; renderDetail(); renderSelectedSummary(); renderLatest(); });
      vlist.appendChild(b);
    });
    box.appendChild(vlist);
    if (sel) {
      box.appendChild(h('dl', { class: 'facts' }, [
        h('dt', { text: t('caffeine_per_serving') }), h('dd', { text: fmtMg(sel.caffeine_mg) }),
        h('dt', { text: t('specification') }), h('dd', { text: sel.serving_label }),
        h('dt', { text: t('temperature') }), h('dd', { text: tempLabel(sel.temperature) })
      ]));
      box.appendChild(sourceBlock(sel));
      var inCmp = state.compare.indexOf(sel.id) >= 0;
      var cb = h('button', { class: 'ghost', text: inCmp ? t('remove_from_compare') : t('add_to_compare') });
      cb.addEventListener('click', function () { toggleCompare(sel.id); renderDetail(); });
      box.appendChild(cb);
    } else {
      box.appendChild(h('p', { class: 'muted', text: t('required_product') }));
    }
  }

  function renderSelectedSummary() {
    var s = clear(el('selectedSummary'));
    var p = state.variantId ? byId[state.variantId] : null;
    if (!p) { s.appendChild(h('p', { class: 'muted', text: t('required_product') })); return; }
    s.appendChild(drinkImg(p.img, p.product_ko, 'mini'));
    s.appendChild(h('div', null, [
      h('div', { class: 'ss-name', text: p.product_ko }),
      h('div', { class: 'muted', text: brandName(p.brand_id) + ' · ' + p.serving_label + ' · ' + tempLabel(p.temperature) + ' · ' + t('caffeine_per_serving') + ' ' + fmtMg(p.caffeine_mg) })
    ]));
  }

  function setNowInputs(dateId, timeId) {
    var now = Date.now();
    el(dateId).value = seoulDay(now);
    el(timeId).value = seoulHM(now);
    el(dateId).max = seoulDay(now);
  }

  function snapshot(p) {
    return {
      product_id: p.id, product_ko: p.product_ko, brand_id: p.brand_id, brand_ko: p.brand_ko, brand_en: p.brand_en,
      channel: p.channel, category: p.category, serving_label: p.serving_label, temperature: p.temperature,
      caffeine_mg: p.caffeine_mg, source_url: p.source_url, source_label_url: p.source_label_url,
      checked_date: p.checked_date, image_path: p.img, image_page_url: p.img_page
    };
  }
  function newId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function saveProductRecord() {
    var msg = el('formMsg'); msg.textContent = ''; msg.className = 'msg';
    var p = state.variantId ? byId[state.variantId] : null;
    if (!p) return fail(msg, t('required_product'));
    var q = validQty(el('qtyInput').value);
    if (q == null) return fail(msg, t('invalid_quantity'));
    var ms = fromSeoul(el('dateInput').value, el('timeInput').value);
    if (isNaN(ms)) return fail(msg, t('future_time_error'));
    if (ms > Date.now()) return fail(msg, t('future_time_error'));
    var nowIso = new Date().toISOString();
    var r = snapshot(p);
    r.record_id = newId(); r.consumed_at = isoSeoul(ms); r.quantity = q; r.created_at = nowIso; r.updated_at = nowIso;
    state.records.push(r);
    if (saveRecords()) { toast(t('saved')); msg.textContent = t('saved'); msg.className = 'msg ok'; }
    state.day = seoulDay(ms);
    refreshAll();
  }
  function saveManualRecord() {
    var msg = el('manualMsg'); msg.textContent = ''; msg.className = 'msg';
    var name = el('manualName').value.trim();
    if (!name) return fail(msg, t('required_name'));
    var q = validQty(el('manualQty').value);
    if (q == null) return fail(msg, t('invalid_quantity'));
    var ms = fromSeoul(el('manualDate').value, el('manualTime').value);
    if (isNaN(ms) || ms > Date.now()) return fail(msg, t('future_time_error'));
    var nowIso = new Date().toISOString();
    state.records.push({ record_id: newId(), product_id: null, manual_name: name, caffeine_mg: null, consumed_at: isoSeoul(ms), quantity: q, created_at: nowIso, updated_at: nowIso });
    if (saveRecords()) { toast(t('saved')); msg.textContent = t('saved'); msg.className = 'msg ok'; el('manualName').value = ''; }
    state.day = seoulDay(ms);
    refreshAll();
  }
  function fail(msgEl, text) { msgEl.textContent = text; msgEl.className = 'msg err'; }

  // ---------- 最晚饮用时间 ----------
  function latestNode() {
    var now = Date.now(), r = latestDrink(now);
    var box = h('div', { class: 'latest' });
    var th = { threshold: fmtNum(THETA) };
    if (r.kind === 'nobed') {
      box.appendChild(h('p', { class: 'muted', text: t('bedtime_not_set') + ' — ' + t('set_bedtime_prompt') }));
      return box;
    }
    if (r.kind === 'nodrink') { box.appendChild(h('p', { class: 'muted', text: t('select_known_drink') })); return box; }
    if (r.kind === 'badqty') { box.appendChild(h('p', { class: 'muted', text: t('invalid_quantity') })); return box; }
    var main;
    if (r.kind === 'over') main = t('bedtime_above_reference', th);
    else if (r.kind === 'ok') main = t('drink_now_ok', th);
    else if (r.kind === 'late') main = t('drink_now_too_late', th);
    else main = t('latest_drink_time', { time: fmtSmart(r.x) });
    box.className = 'latest ' + r.kind;
    box.appendChild(h('p', { class: 'latest-main', text: main }));
    box.appendChild(h('p', { class: 'latest-basis', text: t('latest_drink_basis', { amount: r.basis, threshold: fmtNum(THETA) }) }));
    box.appendChild(h('p', { class: 'note', text: t('estimate_notice') + ' · ' + t('reference_disclaimer') }));
    return box;
  }
  function renderLatest() {
    clear(el('latestBoxForm')).appendChild(latestNode());
    clear(el('latestBoxCurve')).appendChild(latestNode());
  }

  // ---------- 3. 咖啡因曲线 ----------
  function renderCurve() {
    var now = Date.now();
    var ub = clear(el('unknownBanner'));
    if (state.records.some(function (r) { return !isKnown(r); })) ub.appendChild(h('p', { class: 'unknown-banner', text: '⚠ ' + t('unknown_notice') }));
    var known = knownRecords();
    var B = bedtimeMs(now);
    var info = clear(el('curveInfo'));
    var wrap = clear(el('chartWrap'));
    if (!known.length) wrap.appendChild(h('p', { class: 'muted empty', text: t('empty_calculation') }));

    var start = now - 12 * HOUR;
    var end = Math.max(B != null ? B : now, now + 8 * HOUR) + HOUR;
    // 采样点：每10分钟，加上每条记录的前后两点（瞬时摄入）
    var pts = [];
    for (var x = start; x <= end; x += 10 * MIN) pts.push(x);
    known.forEach(function (r) { var tt = recTime(r); if (tt > start && tt < end) { pts.push(tt - 1); pts.push(tt); } });
    pts.push(now); if (B != null) pts.push(B);
    pts.sort(function (a, b) { return a - b; });
    var series = pts.map(function (x) { return [x, R(x, known)]; });
    var ymax = Math.max(THETA * 2, series.reduce(function (m, p) { return Math.max(m, p[1]); }, 0));
    ymax = niceMax(ymax);

    var W = Math.max(320, Math.min(980, wrap.clientWidth || 760)), Hh = W < 520 ? 260 : 320, ml = 44, mr = 16, mt = 28, mb = 36;
    var pw = W - ml - mr, ph = Hh - mt - mb;
    function sx(x) { return ml + (x - start) / (end - start) * pw; }
    function sy(y) { return mt + ph - y / ymax * ph; }
    var NS = 'http://www.w3.org/2000/svg';
    function s(tag, attrs, text) {
      var e = document.createElementNS(NS, tag);
      Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      if (text != null) e.textContent = text;
      return e;
    }
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + Hh, class: 'chart', role: 'img', 'aria-label': t('caffeine_curve') });
    // 网格与 y 轴
    var ticks = 4;
    for (var i = 0; i <= ticks; i++) {
      var v = ymax / ticks * i, y = sy(v);
      svg.appendChild(s('line', { x1: ml, x2: W - mr, y1: y, y2: y, class: 'grid' }));
      svg.appendChild(s('text', { x: ml - 6, y: y + 4, class: 'axis', 'text-anchor': 'end' }, fmtNum(v, 0)));
    }
    svg.appendChild(s('text', { x: ml - 6, y: mt - 12, class: 'axis', 'text-anchor': 'end' }, 'mg'));
    // x 轴刻度：每6小时整点（首尔）
    var first = Math.ceil((start + SEOUL) / (6 * HOUR)) * 6 * HOUR - SEOUL;
    for (var tx = first; tx <= end; tx += 6 * HOUR) {
      var X = sx(tx);
      svg.appendChild(s('line', { x1: X, x2: X, y1: mt + ph, y2: mt + ph + 4, class: 'tick' }));
      var lbl = seoulParts(tx).h === 0 ? fmtDate(tx) : fmtTime(tx);
      svg.appendChild(s('text', { x: X, y: mt + ph + 18, class: 'axis', 'text-anchor': 'middle' }, lbl));
    }
    svg.appendChild(s('line', { x1: ml, x2: W - mr, y1: mt + ph, y2: mt + ph, class: 'baseline' }));
    // 参考值 θ
    var yT = sy(THETA);
    svg.appendChild(s('line', { x1: ml, x2: W - mr, y1: yT, y2: yT, class: 'ref' }));
    svg.appendChild(s('text', { x: W - mr - 4, y: yT - 6, class: 'ref-label', 'text-anchor': 'end' }, t('reference_line', { threshold: fmtNum(THETA) })));
    // 面积与折线
    var d = series.map(function (p, i) { return (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1); }).join(' ');
    svg.appendChild(s('path', { d: d + ' L' + sx(end) + ' ' + sy(0) + ' L' + sx(start) + ' ' + sy(0) + ' Z', class: 'area' }));
    svg.appendChild(s('path', { d: d, class: 'line' }));
    // 现在
    var xn = sx(now);
    svg.appendChild(s('line', { x1: xn, x2: xn, y1: mt - 4, y2: mt + ph, class: 'now' }));
    var bedClose = B != null && Math.abs(sx(B) - xn) < 130;
    svg.appendChild(s('text', { x: bedClose ? xn - 6 : xn, y: mt - 10, class: 'mark-label now-label', 'text-anchor': bedClose ? 'end' : 'middle' }, t('now') + ' ' + fmtTime(now)));
    svg.appendChild(s('circle', { cx: xn, cy: sy(R(now, known)), r: 4.5, class: 'dot now-dot' }));
    // 睡觉时间
    if (B != null) {
      var xb = sx(B);
      svg.appendChild(s('line', { x1: xb, x2: xb, y1: mt - 4, y2: mt + ph, class: 'bed' }));
      var anchor = bedClose ? 'start' : (xb > W - 120 ? 'end' : 'middle');
      svg.appendChild(s('text', { x: bedClose ? xb + 6 : xb, y: mt - 10, class: 'mark-label bed-label', 'text-anchor': anchor }, t('bedtime') + ' ' + fmtSmart(B)));
      svg.appendChild(s('circle', { cx: xb, cy: sy(R(B, known)), r: 4.5, class: 'dot bed-dot' }));
    }
    // 悬停层
    var cross = s('line', { x1: 0, x2: 0, y1: mt, y2: mt + ph, class: 'cross', visibility: 'hidden' });
    var hdot = s('circle', { r: 4, class: 'dot', visibility: 'hidden' });
    svg.appendChild(cross); svg.appendChild(hdot);
    var hit = s('rect', { x: ml, y: mt, width: pw, height: ph, fill: 'transparent' });
    svg.appendChild(hit);
    var tip = el('tooltip');
    function move(ev) {
      var rect = svg.getBoundingClientRect();
      var px = (ev.clientX - rect.left) / rect.width * W;
      var tm = start + (px - ml) / pw * (end - start);
      if (tm < start || tm > end) return leave();
      var val = R(tm, known);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      hdot.setAttribute('cx', px); hdot.setAttribute('cy', sy(val)); hdot.setAttribute('visibility', 'visible');
      tip.hidden = false;
      clear(tip).appendChild(h('div', { class: 'tt-time', text: fmtDateTime(tm) }));
      tip.appendChild(h('div', null, [t('estimated_remaining') + ': ', h('strong', { text: fmtMg(val) })]));
      var tx2 = ev.clientX + 14, ty2 = ev.clientY + 14;
      if (tx2 + 200 > window.innerWidth) tx2 = ev.clientX - 210;
      tip.style.left = tx2 + 'px'; tip.style.top = ty2 + 'px';
    }
    function leave() { cross.setAttribute('visibility', 'hidden'); hdot.setAttribute('visibility', 'hidden'); tip.hidden = true; }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
    wrap.appendChild(svg);

    // 信息
    var today = seoulDay(now);
    var todays = state.records.filter(function (r) { return seoulDay(recTime(r)) === today; });
    var intake = todays.filter(isKnown).reduce(function (a, r) { return a + dose(r); }, 0);
    var last = state.records.reduce(function (m, r) { return Math.max(m, recTime(r)); }, -Infinity);
    var dl = h('dl', { class: 'facts' }, [
      h('dt', { text: t('estimated_remaining') + ' (' + t('now') + ')' }), h('dd', { text: fmtMg(R(now, known)) }),
      h('dt', { text: t('today_intake') }), h('dd', { text: fmtMg(intake) }),
      h('dt', { text: t('last_consumed') }), h('dd', { text: isFinite(last) ? fmtDateTime(last) : '—' })
    ]);
    info.appendChild(dl);
    if (B == null) {
      info.appendChild(h('p', { class: 'muted', text: t('bedtime_not_set') + ' — ' + t('set_bedtime_prompt') }));
    } else info.appendChild(bedtimeVerdict(now));
  }
  function niceMax(v) {
    var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), n = v / p;
    var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * p;
  }

  // ---------- 4. 饮品对比 ----------
  function toggleCompare(id) {
    var msg = el('compareMsg');
    var i = state.compare.indexOf(id);
    if (i >= 0) state.compare.splice(i, 1);
    else {
      if (state.compare.length >= COMPARE_MAX) { var m = t('compare_limit', { count: COMPARE_MAX }); toast(m); msg.textContent = m; msg.className = 'msg err'; return false; }
      state.compare.push(id);
    }
    msg.textContent = ''; msg.className = 'msg';
    lsSet(LS.compare, JSON.stringify(state.compare));
    renderCompare(); renderCmpList();
    return true;
  }
  function renderCompare() {
    var box = clear(el('compareTable'));
    el('clearCompare').hidden = !state.compare.length;
    if (!state.compare.length) { box.appendChild(h('p', { class: 'muted', text: t('compare_empty') })); return; }
    var items = state.compare.map(function (id) { return byId[id]; });
    var max = Math.max.apply(null, items.map(function (p) { return p.caffeine_mg; }));
    var grid = h('div', { class: 'cmp-grid' });
    items.forEach(function (p) {
      var rm = h('button', { class: 'ghost small', text: t('remove_from_compare') });
      rm.addEventListener('click', function () { toggleCompare(p.id); });
      var rec = h('button', { class: 'primary small', text: t('record_this') });
      rec.addEventListener('click', function () { goRecord(p.id); });
      grid.appendChild(h('div', { class: 'cmp-col' }, [
        drinkImg(p.img, p.product_ko, 'cmp-img'),
        h('div', { class: 'k', text: t('official_product_name') }),
        h('div', { class: 'cmp-name', text: p.product_ko }),
        h('div', { class: 'muted', text: brandName(p.brand_id) }),
        h('div', { class: 'cmp-bar-wrap', title: fmtMg(p.caffeine_mg) }, [
          h('div', { class: 'cmp-bar', style: 'width:' + Math.max(2, p.caffeine_mg / max * 100) + '%' })
        ]),
        h('dl', { class: 'facts' }, [
          h('dt', { text: t('caffeine_per_serving') }), h('dd', { class: 'mg-strong', text: fmtMg(p.caffeine_mg) }),
          h('dt', { text: t('specification') }), h('dd', { text: p.serving_label }),
          h('dt', { text: t('temperature') }), h('dd', { text: tempLabel(p.temperature) }),
          h('dt', { text: t('category') }), h('dd', { text: catLabel(p.category) })
        ]),
        sourceBlock(p),
        imageCredit(p),
        h('div', { class: 'btn-row' }, [rec, rm])
      ]));
    });
    box.appendChild(grid);
  }
  function renderCmpList() {
    var q = norm(el('cmpSearch').value), b = el('cmpBrand').value || 'all', c = el('cmpCat').value || 'all';
    var list = clear(el('cmpList'));
    if (!q && b === 'all' && c === 'all') return;
    var items = products.filter(function (p) {
      if (b !== 'all' && p.brand_id !== b) return false;
      if (c !== 'all' && p.category !== c) return false;
      if (q) {
        var txt = norm(p.product_ko) + brandSearchText(p.brand_id) + norm(p.category + (CAT_KEY[p.category] ? ['zh', 'ko', 'en'].map(function (l) { return I18N[l][CAT_KEY[p.category]]; }).join('') : ''));
        if (txt.indexOf(q) < 0) return false;
      }
      return true;
    });
    if (!items.length) { list.appendChild(h('p', { class: 'muted', text: t('no_results') })); return; }
    items.forEach(function (p) {
      var on = state.compare.indexOf(p.id) >= 0;
      var btn = h('button', { class: on ? 'ghost small' : 'primary small', text: on ? t('remove_from_compare') : t('add_to_compare') });
      btn.addEventListener('click', function () { toggleCompare(p.id); });
      list.appendChild(h('div', { class: 'cmp-row' }, [
        drinkImg(p.img, p.product_ko, 'mini'),
        h('div', { class: 'cmp-row-text' }, [
          h('div', { class: 'ss-name', text: p.product_ko }),
          h('div', { class: 'muted', text: brandName(p.brand_id) + ' · ' + tempLabel(p.temperature) + ' · ' + p.serving_label })
        ]),
        h('div', { class: 'cmp-row-mg', text: fmtMg(p.caffeine_mg) }),
        btn
      ]));
    });
  }
  function goRecord(id) {
    var p = byId[id];
    state.brand = p.channel === 'retail' ? 'retail' : p.brand_id;
    state.retailBrand = 'all';
    el('searchInput').value = '';
    renderBrandGrid(); renderProductList();
    selectGroup(p.brand_id + '|' + p.product_ko, id, false);
    setView('add');
    el('formCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- 5. 饮用记录 ----------
  function renderRecords() {
    var now = Date.now();
    if (!state.day) state.day = seoulDay(now);
    el('dayInput').value = state.day;
    el('dayInput').max = seoulDay(now);
    el('dayNext').disabled = state.day >= seoulDay(now);
    // 有记录的日期
    var days = {};
    state.records.forEach(function (r) {
      var d = seoulDay(recTime(r));
      if (!days[d]) days[d] = { mg: 0, n: 0 };
      if (isKnown(r)) days[d].mg += dose(r);
      days[d].n += r.quantity;
    });
    var chips = clear(el('dayChips'));
    Object.keys(days).sort().reverse().forEach(function (d) {
      var c = h('button', { class: 'chip' + (d === state.day ? ' active' : ''), text: fmtDate(dayStartMs(d) + HOUR) + ' · ' + fmtMg(days[d].mg) });
      c.addEventListener('click', function () { state.day = d; state.editing = null; renderRecords(); });
      chips.appendChild(c);
    });

    var recs = state.records.filter(function (r) { return seoulDay(recTime(r)) === state.day; })
      .sort(function (a, b) { return recTime(a) - recTime(b); });
    var stats = clear(el('dayStats'));
    var intake = recs.filter(isKnown).reduce(function (a, r) { return a + dose(r); }, 0);
    var servings = recs.reduce(function (a, r) { return a + r.quantity; }, 0);
    stats.appendChild(h('div', { class: 'day-head' }, [
      h('h3', { text: fmtDate(dayStartMs(state.day) + HOUR, true) }),
      h('dl', { class: 'facts inline' }, [
        h('dt', { text: t('caffeine_intake') }), h('dd', { class: 'mg-strong', text: fmtMg(intake) }),
        h('dt', { text: t('total_servings') }), h('dd', { text: fmtQty(servings) })
      ])
    ]));
    if (recs.some(function (r) { return !isKnown(r); })) stats.appendChild(h('p', { class: 'unknown-banner', text: '⚠ ' + t('unknown_notice') }));

    var list = clear(el('dayRecords'));
    if (!recs.length) { list.appendChild(h('p', { class: 'muted empty', text: t('empty_records') })); return; }
    recs.forEach(function (r) { list.appendChild(state.editing === r.record_id ? editRow(r) : recordRow(r)); });
  }
  function recordRow(r) {
    var known = isKnown(r);
    var name = known ? r.product_ko : r.manual_name;
    var meta = known
      ? brandName(r.brand_id) + ' · ' + r.serving_label + ' · ' + tempLabel(r.temperature) + ' · ' + t('caffeine_per_serving') + ' ' + fmtMg(r.caffeine_mg)
      : t('manual_unknown');
    var eb = h('button', { class: 'ghost small', text: t('edit') });
    eb.addEventListener('click', function () { state.editing = r.record_id; renderRecords(); });
    var db = h('button', { class: 'danger small', text: t('delete') });
    db.addEventListener('click', function () {
      if (!window.confirm(t('delete_confirmation'))) return;
      state.records = state.records.filter(function (x) { return x.record_id !== r.record_id; });
      if (saveRecords()) toast(t('deleted'));
      refreshAll();
    });
    var img = known && r.image_path ? drinkImg(r.image_path, name, 'mini') : h('div', { class: 'img-box mini unknown-box', text: '?' });
    return h('div', { class: 'rec' }, [
      img,
      h('div', { class: 'rec-body' }, [
        h('div', { class: 'rec-top' }, [h('span', { class: 'rec-time', text: fmtTime(recTime(r)) }), h('span', { class: 'ss-name', text: name })]),
        h('div', { class: 'muted', text: meta }),
        known && r.source_url ? h('div', { class: 'muted small' }, [t('source') + ': ', link(r.source_url), ' · ' + t('checked_date') + ': ' + r.checked_date]) : null
      ]),
      h('div', { class: 'rec-nums' }, [
        h('div', { text: t('quantity') + ' ' + fmtQty(r.quantity) }),
        h('div', { class: 'mg-strong', text: known ? fmtMg(dose(r)) : t('unknown') })
      ]),
      h('div', { class: 'btn-row' }, [eb, db])
    ]);
  }
  function editRow(r) {
    var known = isKnown(r), ms = recTime(r);
    var di = h('input', { type: 'date', value: seoulDay(ms), max: seoulDay(Date.now()) });
    var ti = h('input', { type: 'time', value: seoulHM(ms) });
    var qi = h('input', { type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', value: String(r.quantity) });
    var ni = known ? null : h('input', { type: 'text', value: r.manual_name, maxlength: '80' });
    var msg = h('p', { class: 'msg' });
    var save = h('button', { class: 'primary small', text: t('save') });
    var cancel = h('button', { class: 'ghost small', text: t('cancel') });
    cancel.addEventListener('click', function () { state.editing = null; renderRecords(); });
    save.addEventListener('click', function () {
      if (ni && !ni.value.trim()) return fail(msg, t('required_name'));
      var q = validQty(qi.value);
      if (q == null) return fail(msg, t('invalid_quantity'));
      var nm = fromSeoul(di.value, ti.value);
      if (isNaN(nm) || nm > Date.now()) return fail(msg, t('future_time_error'));
      r.quantity = q; r.consumed_at = isoSeoul(nm); r.updated_at = new Date().toISOString();
      if (ni) r.manual_name = ni.value.trim();
      state.editing = null; state.day = seoulDay(nm);
      if (saveRecords()) toast(t('saved'));
      refreshAll();
    });
    return h('div', { class: 'rec editing' }, [
      h('div', { class: 'rec-body' }, [
        h('div', { class: 'ss-name', text: known ? r.product_ko : r.manual_name }),
        ni ? h('label', { class: 'field' }, [h('span', { text: t('manual_name') }), ni]) : null,
        h('div', { class: 'row' }, [
          h('label', { class: 'field' }, [h('span', { text: t('quantity') }), qi]),
          h('label', { class: 'field' }, [h('span', { text: t('consumed_at') }), h('span', { class: 'dt' }, [di, ti])])
        ]),
        msg,
        h('div', { class: 'btn-row' }, [save, cancel])
      ])
    ]);
  }

  // ---------- 来源 ----------
  function renderBrandSources() {
    var ul = clear(el('brandSources'));
    brands.forEach(function (b) {
      ul.appendChild(h('li', null, [h('strong', { text: brandName(b.brand_id) }), ' — ', link(b.official_website)]));
    });
  }

  // ---------- 全局刷新 ----------
  function refreshAll() {
    renderSummary(); renderBedtime(); renderLatest(); renderRecords(); renderCompare();
    if (state.view === 'curve') renderCurve();
  }
  function rerenderLang() {
    applyStatic(); renderBrandGrid(); renderProductList(); renderDetail(); renderSelectedSummary();
    renderCmpList(); renderBrandSources(); refreshAll(); renderCurve();
  }

  // ---------- 事件 ----------
  el('langSelect').addEventListener('change', function () {
    state.lang = this.value; lsSet(LS.lang, state.lang); rerenderLang();
  });
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.getAttribute('data-view')); window.scrollTo({ top: 0 }); });
  });
  el('bedtimeSave').addEventListener('click', function () {
    var v = el('bedtimeInput').value, msg = el('bedtimeMsg');
    if (!/^([01]\d|2[0-3]):[0-5]\d/.test(v)) return fail(msg, t('invalid_bedtime'));
    state.bedtime = v.slice(0, 5);
    if (!lsSet(LS.bedtime, state.bedtime)) { fail(msg, t('save_failed')); }
    else { msg.textContent = t('bedtime_saved'); msg.className = 'msg ok'; toast(t('bedtime_saved')); }
    refreshAll();
  });
  el('searchInput').addEventListener('input', renderProductList);
  el('catFilter').addEventListener('change', renderProductList);
  el('qtyInput').addEventListener('input', renderLatest);
  el('saveRecord').addEventListener('click', saveProductRecord);
  el('saveManual').addEventListener('click', saveManualRecord);
  el('cmpSearch').addEventListener('input', renderCmpList);
  el('cmpBrand').addEventListener('change', renderCmpList);
  el('cmpCat').addEventListener('change', renderCmpList);
  el('clearCompare').addEventListener('click', function () {
    state.compare = []; lsSet(LS.compare, '[]'); renderCompare(); renderCmpList(); renderDetail();
    el('compareMsg').textContent = '';
  });
  el('dayInput').addEventListener('change', function () { if (this.value) { state.day = this.value; state.editing = null; renderRecords(); } });
  el('dayPrev').addEventListener('click', function () { state.day = shiftDay(state.day, -1); state.editing = null; renderRecords(); });
  el('dayNext').addEventListener('click', function () { state.day = shiftDay(state.day, 1); state.editing = null; renderRecords(); });
  var rz; window.addEventListener('resize', function () { el('tooltip').hidden = true; clearTimeout(rz); rz = setTimeout(function () { if (state.view === 'curve') renderCurve(); }, 150); });
  // 其他标签页修改记录时同步
  window.addEventListener('storage', function (e) {
    if (e.key === LS.records) { try { state.records = JSON.parse(e.newValue || '[]'); } catch (x) {} refreshAll(); }
    if (e.key === LS.bedtime) { state.bedtime = e.newValue || ''; refreshAll(); }
  });

  // ---------- 启动 ----------
  setNowInputs('dateInput', 'timeInput');
  setNowInputs('manualDate', 'manualTime');
  rerenderLang();
  setView('add');
  // 每分钟按真实时钟重算
  setInterval(function () {
    renderSummary(); renderLatest(); renderBedtime();
    if (state.view === 'curve') renderCurve();
    el('dateInput').max = el('manualDate').max = seoulDay(Date.now());
  }, 60000);
})();
