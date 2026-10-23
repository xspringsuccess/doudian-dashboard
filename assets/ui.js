/* 渲染与交互 */
(function (global) {
  'use strict';

  var S = STORE.S;
  var $ = function (id) { return document.getElementById(id); };

  var ACTIVE = { overview: null, links: null, skus: null };
  var expanded = {};        // links tab: pid -> true
  var skuPage = 1, skuFilter = '', skuOnlySold = false;

  /* ================= 基础 ================= */
  function clampRange() {
    if (S.range.start > S.range.end) S.range.end = S.range.start;
  }

  function autoFit() {
    var od = Object.keys(S.orderDates).sort();
    if (!od.length) return;
    var inter = od.filter(function (d) { return S.adDates[d]; });
    var use = inter.length ? inter : od;
    S.range.start = use[0];
    S.range.end = use[use.length - 1];
  }

  function syncFilterBar() {
    var sel = $('shopSel');
    var cur = S.shop;
    var html = '<option value="__ALL__">全部店铺（汇总）</option>';
    for (var i = 0; i < S.shops.length; i++) {
      html += '<option value="' + U.esc(S.shops[i]) + '">' + U.esc(S.shops[i]) + '</option>';
    }
    sel.innerHTML = html;
    sel.value = (cur === '__ALL__' || S.shops.indexOf(cur) >= 0) ? cur : '__ALL__';
    S.shop = sel.value;

    $('dateStart').value = S.range.start;
    $('dateEnd').value = S.range.end;

    var chips = document.querySelectorAll('.chip');
    for (var j = 0; j < chips.length; j++) chips[j].classList.remove('on');
  }

  /* ================= 渲染入口 ================= */
  function renderAll() {
    syncFilterBar();

    if (!S.orders.length) {
      var e = '<div class="panel"><div class="empty">还没有订单数据。点击右上角「数据导入」上传抖店订单、商品表与推广数据。</div></div>';
      $('tab-overview').innerHTML = e;
      $('tab-links').innerHTML = e;
      $('tab-skus').innerHTML = '<div class="panel"><div class="empty">导入商品表后可在此批量维护 SKU 成本。</div></div>';
      $('rangeWarn').classList.add('hidden');
      return;
    }

    var res = CALC.run();
    ACTIVE.overview = res;
    ACTIVE.links = res;
    ACTIVE.skus = res;

    var w = $('rangeWarn');
    if (res.warns.length) {
      w.textContent = res.warns.join(' ');
      w.classList.remove('hidden');
    } else {
      w.classList.add('hidden');
    }

    if (S.tab === 'overview') renderOverview(res);
    else if (S.tab === 'links') renderLinks(res);
    else renderSkus(res);
  }

  /* ================= Tab1 净利润总览 ================= */
  function kpi(label, value, sub, cls) {
    return '<div class="kpi ' + (cls || '') + '">' +
      '<div class="kpi-label">' + label + '</div>' +
      '<div class="kpi-value">' + value + '</div>' +
      (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') +
      '</div>';
  }

  function renderOverview(res) {
    var t = res.totals;
    var netCls = t.net >= 0 ? 'pos' : 'neg';

    var h = '<div class="kpis">' +
      kpi('销量（件）', U.money0(t.qty), '有效 ' + U.money0(t.validQty) + ' 件') +
      kpi('成交 GMV', '¥' + U.money(t.gmv), '有效 ¥' + U.money(t.validGmv)) +
      kpi('退款金额', '¥' + U.money(t.refund), '发货前 ¥' + U.money(t.refundPre) + ' / 发货后 ¥' + U.money(t.refundPost)) +
      kpi('退款率', U.pct(t.refundRate), '退款 ' + U.money0(t.refundQty) + ' 件') +
      kpi('商品成本', '¥' + U.money(t.cost), t.missingCost ? U.money0(t.missingCost) + ' 件未填成本' : '') +
      kpi('投流费用', '¥' + U.money(t.ad), 'ROI ' + (t.ad > 0 ? t.roi.toFixed(2) : '—')) +
      kpi('平台佣金', '¥' + U.money(t.platformFee), '') +
      kpi('达人佣金', '¥' + U.money(t.talentFee), S.settings.talentUnionOnly ? '仅精选联盟订单' : '全部订单') +
      kpi('运费 + 运费险', '¥' + U.money(t.freight + t.ins), '¥' + U.money(t.freight) + ' + ¥' + U.money(t.ins)) +
      kpi('税务（' + U.num(S.settings.taxRate) + '%）', '¥' + U.money(t.tax), '独立显示，不并入净毛利') +
      kpi('净毛利（税前）', '¥' + U.money(t.gross), '净毛利率 ' + U.pct(t.grossRate), t.gross >= 0 ? 'pos' : 'neg') +
      kpi('净利润', '¥' + U.money(t.net), '净利率 ' + U.pct(t.netRate), 'hl ' + netCls) +
      kpi('ROI（净成交）', t.ad > 0 ? t.roi.toFixed(2) : '—', t.ad > 0 ? '成交口径 ' + t.roiRaw.toFixed(2) : '无投流') +
      kpi('保本 ROI', isFinite(t.breakeven) ? t.breakeven.toFixed(2) : '不可达', '净毛利率 ' + U.pct(t.marginRate)) +
      '</div>';

    /* TOP 榜 */
    var sorted = res.links.slice().sort(function (a, b) { return b.net - a.net; });
    var top = sorted.filter(function (l) { return l.net > 0; }).slice(0, 10);
    var bottom = sorted.filter(function (l) { return l.net < 0; }).sort(function (a, b) { return a.net - b.net; }).slice(0, 10);

    var maxTop = top.length ? Math.abs(top[0].net) : 1;
    var maxBot = bottom.length ? Math.abs(bottom[0].net) : 1;

    h += '<div class="cols2">';
    h += '<div class="panel"><div class="panel-head"><span class="panel-title">盈利链接 TOP</span><span class="panel-sub">按净利润</span></div>' +
      '<div class="rank">' + rankHtml(top, maxTop, false) + '</div></div>';
    h += '<div class="panel"><div class="panel-head"><span class="panel-title">亏损链接 TOP</span><span class="panel-sub">按净利润</span></div>' +
      '<div class="rank">' + rankHtml(bottom, maxBot, true) + '</div></div>';
    h += '</div>';

    /* 明细 */
    var adOnly = res.links.filter(function (l) { return l.adOnly; });
    var adOnlySpend = 0;
    for (var ao = 0; ao < adOnly.length; ao++) adOnlySpend += adOnly[ao].ad;
    var sortedAll = res.links.slice().sort(function (a, b) { return b.net - a.net; });

    h += '<div class="panel"><div class="panel-head"><span class="panel-title">链接明细</span>' +
      '<span class="panel-sub">共 ' + res.links.length + ' 条链接' +
      (adOnly.length ? '，其中 ' + adOnly.length + ' 条只花钱没出单，白烧 ¥' + U.money(adOnlySpend) : '') +
      '</span></div>' +
      '<div class="tbl-wrap">' + linkTableHtml(sortedAll, false) + '</div></div>';

    $('tab-overview').innerHTML = h;
  }

  function rankHtml(list, max, negative) {
    if (!list.length) return '<div class="empty">暂无数据</div>';
    var h = '';
    for (var i = 0; i < list.length; i++) {
      var l = list[i];
      var v = Math.abs(l.net);
      var w = max > 0 ? Math.round(v / max * 100) : 0;
      h += '<div class="rank-item">' +
        '<div class="rank-idx">' + (i + 1) + '</div>' +
        '<div><div class="rank-name" title="' + U.esc(l.pname) + '">' + U.esc(l.pname || l.pid) + '</div>' +
        '<div class="rank-bar' + (negative ? ' neg' : '') + '"><i style="width:' + w + '%"></i></div></div>' +
        '<div class="rank-sub">ROI ' + (l.ad > 0 ? CALC.linkRoi(l).toFixed(2) : '—') + '</div>' +
        '<div class="rank-val ' + (negative ? 'neg' : 'pos') + '">¥' + U.money(l.net) + '</div>' +
        '</div>';
    }
    return h;
  }

  /* ================= Tab2 链接利润 ================= */
  function renderLinks(res) {
    var links = res.links.slice().sort(function (a, b) { return b.validGmv - a.validGmv; });
    var h = '<div class="panel"><div class="panel-head">' +
      '<span class="panel-title">全部链接利润</span>' +
      '<span class="panel-sub">点击左侧箭头展开该链接下的各 SKU 明细</span></div>' +
      '<div class="tbl-wrap">' + linkTableHtml(links, true) + '</div></div>';
    $('tab-links').innerHTML = h;
    bindExpand();
  }

  function linkTableHtml(links, expandable) {
    var h = '<table class="tbl"><thead><tr>' +
      '<th class="th-l">商品名称</th>' +
      '<th>销量</th><th>成交GMV</th><th>退款率</th><th>投流费用</th><th>商品成本</th>' +
      '<th>ROI</th><th>保本ROI</th><th>达人佣金</th><th>平台扣点</th>' +
      '<th>净毛利</th><th>净利润</th><th>净利率</th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      var open = expanded[l.pid];
      var roi = CALC.linkRoi(l);
      var be = CALC.linkBreakeven(l);
      var netCls = l.net >= 0 ? 'pos' : 'neg';

      h += '<tr class="grp-row" data-pid="' + U.esc(l.pid) + '">' +
        '<td class="l">' +
        (expandable ? '<span class="exp" data-toggle="' + U.esc(l.pid) + '">' + (open ? '−' : '+') + '</span>' : '') +
        '<span class="pname" title="' + U.esc(l.pname) + '">' + U.esc(l.pname || l.pid) + '</span>' +
        (l.adOnly ? ' <span class="muted" style="font-size:11px">（无成交）</span>' : '') +
        '</td>' +
        '<td>' + U.money0(l.validQty) + '</td>' +
        '<td>¥' + U.money(l.validGmv) + '</td>' +
        '<td class="' + (l.refundRate > 0.25 ? 'neg' : '') + '">' + U.pct(l.refundRate, 1) + '</td>' +
        '<td>¥' + U.money(l.ad) + '</td>' +
        '<td>¥' + U.money(l.cost) + '</td>' +
        '<td>' + (l.ad > 0 ? roi.toFixed(2) : '<span class="muted">自然</span>') + '</td>' +
        '<td class="' + (l.ad > 0 && roi < be ? 'neg' : '') + '">' + (isFinite(be) ? be.toFixed(2) : '—') + '</td>' +
        '<td>¥' + U.money(l.talentFee) + '</td>' +
        '<td>¥' + U.money(l.platformFee) + '</td>' +
        '<td>¥' + U.money(l.gross) + '</td>' +
        '<td class="' + netCls + '">¥' + U.money(l.net) + '</td>' +
        '<td class="' + netCls + '">' + U.pct(U.ratio(l.net, l.validGmv), 1) + '</td>' +
        '</tr>';

      if (expandable && open) {
        for (var j = 0; j < l.skuList.length; j++) {
          var K = l.skuList[j];
          var share = l.validQty > 0 ? K.validQty / l.validQty : 0;
          h += '<tr class="sub-row"><td class="l" style="padding-left:34px">' +
            '<span class="sname" title="' + U.esc(K.spec) + '">' + U.esc(K.spec || K.key) + '</span></td>' +
            '<td>' + U.money0(K.validQty) + '</td>' +
            '<td>¥' + U.money(K.validGmv) + '</td>' +
            '<td>' + U.pct(share, 1) + '<span class="muted"> 占比</span></td>' +
            '<td>¥' + U.money(K.ad) + '</td>' +
            '<td>¥' + U.money(K.cost) + '</td>' +
            '<td class="muted" colspan="2">售价 ¥' + U.money(K.price) + '</td>' +
            '<td>¥' + U.money(K.talentFee) + '</td>' +
            '<td>¥' + U.money(K.platformFee) + '</td>' +
            '<td class="muted">税 ¥' + U.money(K.tax) + '</td>' +
            '<td class="' + (K.net >= 0 ? 'pos' : 'neg') + '">¥' + U.money(K.net) + '</td>' +
            '<td class="muted">单件 ¥' + (K.validQty ? U.money(K.net / K.validQty) : '0.00') + '</td>' +
            '</tr>';
        }
      }
    }
    h += '</tbody></table>';
    return h;
  }

  function bindExpand() {
    var toggles = document.querySelectorAll('[data-toggle]');
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].onclick = function (e) {
        e.stopPropagation();
        var pid = this.getAttribute('data-toggle');
        expanded[pid] = !expanded[pid];
        renderLinks(ACTIVE.links);
      };
    }
  }

  /* ================= Tab3 SKU 成本 ================= */
  function renderSkus(res) {
    var tax = U.num(S.settings.taxRate);
    var skuMap = res.skuMap || {};

    var rows = S.skus.map(function (s) {
      var key = STORE.skuKeyOf(s);
      var st = skuMap[s.pid + '|' + key] || { qty: 0, validQty: 0, net: 0, ad: 0 };
      s._qty = st.validQty;
      s._net = st.net;
      s._key = key;
      return s;
    });

    /* 单店视图下只列出归属该店铺的 SKU */
    if (S.shop !== '__ALL__') {
      rows = rows.filter(function (s) { return S.pidShop[s.pid] === S.shop; });
    }

    var kw = skuFilter.trim().toLowerCase();
    if (kw) {
      rows = rows.filter(function (s) {
        return (s.pname + ' ' + s.spec + ' ' + s.skuCode + ' ' + s.pid).toLowerCase().indexOf(kw) >= 0;
      });
    }
    if (skuOnlySold) rows = rows.filter(function (s) { return s._qty > 0; });

    rows.sort(function (a, b) { return b._qty - a._qty; });

    var per = 100;
    var pages = Math.max(1, Math.ceil(rows.length / per));
    if (skuPage > pages) skuPage = pages;
    var start = (skuPage - 1) * per;
    var page = rows.slice(start, start + per);

    var h = '';

    h += '<div class="panel"><div class="panel-body" style="padding:11px 14px">' +
      '<div class="taxline">' +
      '<span class="tx">全局税率</span>' +
      '<input type="number" step="0.01" id="taxInline" class="input input-sm" value="' + tax + '">' +
      '<span class="tx">%　所有 SKU 的税务成本 = 有效销售额 × 该税率，退款订单不计入。修改后立即生效。</span>' +
      '</div></div></div>';

    h += '<div class="panel">';
    h += '<div class="sku-toolbar">' +
      '<input type="text" id="skuSearch" class="input" style="width:230px" placeholder="搜索商品名称 / 规格 / SKU编码" value="' + U.esc(skuFilter) + '">' +
      '<label class="tx" style="display:flex;align-items:center;gap:5px;font-size:12px"><input type="checkbox" id="skuOnlySold"' + (skuOnlySold ? ' checked' : '') + '> 只看有销量</label>' +
      '<div class="grow"></div>' +
      '<button class="btn btn-sm" id="btnExportTpl">导出 Excel 模板</button>' +
      '<button class="btn btn-sm" id="btnImportTpl">上传模板</button>' +
      '<input type="file" id="tplInput" accept=".xlsx,.xls" hidden>' +
      '</div>';

    h += '<div class="batch">' +
      '<span class="batch-label">批量设置</span>' +
      '<select class="input input-sm" id="bkField" style="width:100px">' +
      '<option value="cost">商品成本</option>' +
      '<option value="freight">运费</option>' +
      '<option value="ins">运费险</option>' +
      '<option value="pr">平台扣点</option>' +
      '<option value="tr">达人佣金</option>' +
      '</select>' +
      '<select class="input input-sm" id="bkMode" style="width:120px">' +
      '<option value="abs">固定金额/比例</option>' +
      '<option value="pct">按售价的 %</option>' +
      '</select>' +
      '<input type="number" step="0.01" id="bkVal" class="input input-sm" style="width:96px" placeholder="数值">' +
      '<button class="btn btn-sm btn-primary" id="bkApply">应用到筛选结果</button>' +
      '<button class="btn btn-sm" id="bkApplyAll">应用到全部 SKU</button>' +
      '<span class="tx" style="font-size:12px;color:var(--text-3)">当前筛选 ' + rows.length + ' 个 SKU</span>' +
      '</div>';

    h += '<div class="tbl-wrap" style="max-height:60vh"><table class="tbl"><thead><tr>' +
      '<th class="th-l">商品名称</th><th class="th-l">规格</th><th class="th-l">SKU编码</th>' +
      '<th>售价</th><th>销量</th>' +
      '<th>商品成本</th><th>运费</th><th>运费险</th><th>平台扣点%</th><th>达人佣金%</th>' +
      '<th>税务%</th><th>单件净利</th><th>净利润</th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < page.length; i++) {
      var s = page[i];
      var p = STORE.getParam(s.pid, s._key);
      var unit = s._qty ? s._net / s._qty : 0;
      h += '<tr>' +
        '<td class="l"><span class="pname" title="' + U.esc(s.pname) + '">' + U.esc(s.pname) + '</span></td>' +
        '<td class="l"><span class="sname" title="' + U.esc(s.spec) + '">' + U.esc(s.spec) + '</span></td>' +
        '<td class="l muted">' + U.esc(s.skuCode || '—') + '</td>' +
        '<td>¥' + U.money(s.price) + '</td>' +
        '<td>' + U.money0(s._qty) + '</td>' +
        '<td><input class="cell-input" data-f="cost" data-pid="' + U.esc(s.pid) + '" data-k="' + U.esc(s._key) + '" value="' + U.num(p.cost).toFixed(2) + '"></td>' +
        '<td><input class="cell-input" data-f="freight" data-pid="' + U.esc(s.pid) + '" data-k="' + U.esc(s._key) + '" value="' + U.num(p.freight).toFixed(2) + '"></td>' +
        '<td><input class="cell-input" data-f="ins" data-pid="' + U.esc(s.pid) + '" data-k="' + U.esc(s._key) + '" value="' + U.num(p.ins).toFixed(2) + '"></td>' +
        '<td><input class="cell-input" data-f="pr" data-pid="' + U.esc(s.pid) + '" data-k="' + U.esc(s._key) + '" value="' + U.num(p.pr).toFixed(2) + '"></td>' +
        '<td><input class="cell-input" data-f="tr" data-pid="' + U.esc(s.pid) + '" data-k="' + U.esc(s._key) + '" value="' + U.num(p.tr).toFixed(2) + '"></td>' +
        '<td class="muted">' + tax.toFixed(2) + '</td>' +
        '<td class="' + (unit >= 0 ? 'pos' : 'neg') + '">¥' + U.money(unit) + '</td>' +
        '<td class="' + (s._net >= 0 ? 'pos' : 'neg') + '">¥' + U.money(s._net) + '</td>' +
        '</tr>';
    }
    h += '</tbody></table></div>';

    h += '<div class="sku-toolbar">' +
      '<div class="pager">' +
      '<button class="btn btn-sm" id="pgPrev"' + (skuPage <= 1 ? ' disabled' : '') + '>上一页</button>' +
      '<span>第 ' + skuPage + ' / ' + pages + ' 页，共 ' + rows.length + ' 个 SKU</span>' +
      '<button class="btn btn-sm" id="pgNext"' + (skuPage >= pages ? ' disabled' : '') + '>下一页</button>' +
      '</div><div class="grow"></div>' +
      '<span class="tx" style="font-size:12px;color:var(--text-3)">销量与利润为当前所选时间段的数据</span>' +
      '</div>';

    h += '</div>';
    $('tab-skus').innerHTML = h;
    bindSkuEvents();
  }

  function bindSkuEvents() {
    var ti = $('taxInline');
    if (ti) {
      ti.onchange = function () {
        S.settings.taxRate = U.num(this.value);
        STORE.saveParams();
        renderAll();
      };
    }

    var inputs = document.querySelectorAll('.cell-input');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].onchange = function () {
        STORE.setParam(this.getAttribute('data-pid'), this.getAttribute('data-k'), this.getAttribute('data-f'), this.value);
        renderAll();
      };
    }

    var se = $('skuSearch');
    if (se) {
      se.oninput = U.debounce(function () {
        skuFilter = this.value;
        skuPage = 1;
        renderSkus(ACTIVE.skus);
      }, 260);
    }

    var os = $('skuOnlySold');
    if (os) {
      os.onchange = function () { skuOnlySold = this.checked; skuPage = 1; renderSkus(ACTIVE.skus); };
    }

    var pp = $('pgPrev'), pn = $('pgNext');
    if (pp) pp.onclick = function () { if (skuPage > 1) { skuPage--; renderSkus(ACTIVE.skus); } };
    if (pn) pn.onclick = function () { skuPage++; renderSkus(ACTIVE.skus); };

    var ba = $('bkApply');
    if (ba) ba.onclick = function () { batchApply(false); };
    var baa = $('bkApplyAll');
    if (baa) baa.onclick = function () { batchApply(true); };

    var bt = $('btnExportTpl');
    if (bt) bt.onclick = exportTpl;
    var bi = $('btnImportTpl');
    if (bi) bi.onclick = function () { $('tplInput').click(); };
    var ti2 = $('tplInput');
    if (ti2) ti2.onchange = function () { if (this.files[0]) importTpl(this.files[0]); this.value = ''; };
  }

  function batchApply(all) {
    var field = $('bkField').value;
    var mode = $('bkMode').value;
    var val = U.num($('bkVal').value);
    var res = ACTIVE.skus;
    var skuMap = res ? (res.skuMap || {}) : {};
    var kw = skuFilter.trim().toLowerCase();

    var list = S.skus;
    if (S.shop !== '__ALL__') {
      list = list.filter(function (s) { return S.pidShop[s.pid] === S.shop; });
    }
    if (!all) {
      list = list.filter(function (s) {
        var key = STORE.skuKeyOf(s);
        var st = skuMap[s.pid + '|' + key];
        if (kw && (s.pname + ' ' + s.spec + ' ' + s.skuCode + ' ' + s.pid).toLowerCase().indexOf(kw) < 0) return false;
        if (skuOnlySold && !(st && st.validQty > 0)) return false;
        return true;
      });
    }
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var key = STORE.skuKeyOf(s);
      var v = mode === 'pct' ? s.price * val / 100 : val;
      STORE.setParam(s.pid, key, field, v);
      n++;
    }
    U.toast('已设置 ' + n + ' 个 SKU 的「' + $('bkField').selectedOptions[0].text + '」');
    renderAll();
  }

  function exportTpl() {
    U.loading(true, '生成模板中…');
    setTimeout(function () {
      /* 单店视图下只导出该店铺的 SKU，避免两家店的成本参数混在一个表里 */
      var src = S.skus;
      if (S.shop !== '__ALL__') src = src.filter(function (s) { return S.pidShop[s.pid] === S.shop; });
      var aoa = [['商品ID', '商品名称', '规格', 'SKU编码', '售价', '商品成本', '运费', '运费险', '平台扣点(%)', '达人佣金(%)']];
      for (var i = 0; i < src.length; i++) {
        var s = src[i];
        var key = STORE.skuKeyOf(s);
        var p = STORE.getParam(s.pid, key);
        aoa.push([s.pid, s.pname, s.spec, s.skuCode, s.price,
        U.num(p.cost), U.num(p.freight), U.num(p.ins), U.num(p.pr), U.num(p.tr)]);
      }
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'SKU参数');
      var d = new Date();
      var name = 'SKU成本参数模板_' + d.getFullYear() + U.pad(d.getMonth() + 1) + U.pad(d.getDate()) + '.xlsx';
      XLSX.writeFile(wb, name);
      U.loading(false);
      U.toast('已导出 ' + (aoa.length - 1) + ' 个 SKU');
    }, 60);
  }

  function importTpl(file) {
    U.loading(true, '解析模板…');
    IMP.readAny(file).then(function (rows) {
      U.loading(false);
      if (!rows.length) { U.toast('模板为空'); return; }
      var parsed = [];
      var hdr = rows[0];
      for (var hc = 0; hc < hdr.length; hc++) hdr[hc] = U.clean(hdr[hc]);
      var idx = { pid: 0, pname: 1, spec: 2, skuCode: 3, price: 4, cost: 5, freight: 6, ins: 7, pr: 8, tr: 9 };
      if (hdr.join('').indexOf('商品ID') >= 0) {
        for (var hc2 = 0; hc2 < hdr.length; hc2++) {
          if (hdr[hc2] === '商品ID') idx.pid = hc2;
          else if (hdr[hc2] === '商品名称') idx.pname = hc2;
          else if (hdr[hc2] === '规格') idx.spec = hc2;
          else if (hdr[hc2] === 'SKU编码') idx.skuCode = hc2;
          else if (hdr[hc2] === '售价') idx.price = hc2;
          else if (hdr[hc2] === '商品成本') idx.cost = hc2;
          else if (hdr[hc2] === '运费') idx.freight = hc2;
          else if (hdr[hc2] === '运费险') idx.ins = hc2;
          else if (hdr[hc2] === '平台扣点(%)') idx.pr = hc2;
          else if (hdr[hc2] === '达人佣金(%)') idx.tr = hc2;
        }
      }
      var hasHdr = /商品ID/.test(hdr.join(''));
      var i0 = hasHdr ? 1 : 0;
      for (var i = i0; i < rows.length; i++) {
        var r = rows[i];
        if (!r[idx.pid] || !r[idx.skuCode]) continue;
        parsed.push({
          pid: r[idx.pid], skuCode: r[idx.skuCode],
          cost: U.num(r[idx.cost]), freight: U.num(r[idx.freight]),
          ins: U.num(r[idx.ins]), pr: U.pctNum(r[idx.pr]), tr: U.pctNum(r[idx.tr])
        });
      }
      if (!parsed.length) { U.toast('未识别到数据行'); return; }
      for (var j = 0; j < parsed.length; j++) {
        var o = parsed[j];
        var p = STORE.getParam(o.pid, o.skuCode);
        p.cost = o.cost; p.freight = o.freight; p.ins = o.ins;
        p.pr = o.pr; p.tr = o.tr;
      }
      STORE.saveParams();
      renderAll();
      U.toast('已导入 ' + parsed.length + ' 条 SKU 参数');
    }).catch(function () { U.loading(false); U.toast('解析失败'); });
  }

  /* ================= 导入弹窗 ================= */
  var pending = null;

  function openImport() {
    $('importModal').classList.remove('hidden');
    renderImpList();
  }

  function renderImpList() {
    var h = '';
    if (!S.files.length) {
      h = '<div class="empty">还没有导入任何文件</div>';
    } else {
      var tagMap = { orders: '订单', products: '商品', ad: '推广', params: '参数' };
      var unitMap = { orders: '行订单', products: '个SKU', ad: '行推广', params: '条参数' };
      for (var i = 0; i < S.files.length; i++) {
        var f = S.files[i];
        h += '<div class="imp-item">' +
          '<span class="imp-tag">' + (tagMap[f.type] || f.type) + '</span>' +
          '<span class="imp-name">' + U.esc(f.name) +
          (f.shop ? '<b class="imp-shop">「' + U.esc(f.shop) + '」</b>' : '') +
          (f.n ? '<i class="imp-cnt">' + U.money0(f.n) + ' ' + (unitMap[f.type] || '') + '</i>' : '') +
          '</span>' +
          '<button class="btn btn-sm btn-del" data-delfile="' + U.esc(f.id) + '" data-dfname="' + U.esc(f.name) + '">删除</button>' +
          '</div>';
      }
    }
    $('impList').innerHTML = h;

    var dels = document.querySelectorAll('[data-delfile]');
    for (var d = 0; d < dels.length; d++) {
      dels[d].onclick = function () {
        var id = this.getAttribute('data-delfile');
        var nm = this.getAttribute('data-dfname');
        if (!confirm('确定删除「' + nm + '」？\n它带来的订单 / 商品 / 推广数据会一并移除，其他文件不受影响。')) return;
        var r = IMP.removeFile(id);
        STORE.saveCore();
        renderAll();
        renderImpList();
        var extra = [];
        if (r && r.orders) extra.push(r.orders + ' 行订单');
        if (r && r.skus) extra.push(r.skus + ' 个 SKU');
        if (r && r.ad) extra.push(r.ad + ' 条推广');
        U.toast('已删除「' + nm + '」' + (extra.length ? '，移除 ' + extra.join('、') : ''));
      };
    }
  }

  function handleFiles(files) {
    if (!files || !files.length) return;
    U.loading(true, '解析文件中…');
    IMP.sniff(files).then(function (items) {
      U.loading(false);
      var orderFiles = items.filter(function (it) { return it.type === 'orders'; });
      var defaultShop = orderFiles.length
        ? IMP.baseName(orderFiles[0].file.name)
        : IMP.baseName(items[0].file.name);
      if (!items.length) return;
      pending = items;
      var typeTag = { orders: '订单', products: '商品', ad: '推广', params: '参数' };
      var h = '<div class="sa-note">多个店铺请分开上传并各自命名。同一店铺的订单、商品表、推广表填<b>同一个店铺名</b>即可。</div>';
      for (var i = 0; i < items.length; i++) {
        var nm = items[i].file.name;
        h += '<div class="sa-row"><span class="imp-tag">' + (typeTag[items[i].type] || '?') + '</span>' +
          '<span>' + U.esc(nm) + '</span>' +
          '<input class="input" data-shopfor="' + U.esc(nm) + '" value="' + U.esc(defaultShop) + '"></div>';
      }
      $('saList').innerHTML = h;
      $('shopAssign').classList.remove('hidden');
    });
  }

  function finishIngest(items, shopOf) {
    U.loading(true, '写入数据中…');
    setTimeout(function () {
      var msgs = IMP.ingest(items, shopOf);
      STORE.saveCore();
      U.loading(false);
      $('shopAssign').classList.add('hidden');
      pending = null;
      autoFit();
      renderAll();
      renderImpList();
      $('importModal').classList.add('hidden');
      U.toast(msgs.length ? msgs.join('；') : '导入完成');
    }, 40);
  }

  /* ================= 设置 ================= */
  function openSettings() {
    var s = S.settings;
    $('setTax').value = s.taxRate;
    $('setPlatform').value = s.platformRate;
    $('setTalent').value = s.talentRate;
    $('setFreight').value = s.freight;
    $('setIns').value = s.freightIns;
    $('setExcludeCancel').checked = s.excludeCancelled;
    $('setUnionOnly').checked = s.talentUnionOnly;
    $('setPendingRefund').checked = s.includePendingRefund;
    $('setAdFallback').checked = s.adFallback;
    $('settingsModal').classList.remove('hidden');
  }

  function saveSettings() {
    S.settings.taxRate = U.num($('setTax').value);
    S.settings.platformRate = U.num($('setPlatform').value);
    S.settings.talentRate = U.num($('setTalent').value);
    S.settings.freight = U.num($('setFreight').value);
    S.settings.freightIns = U.num($('setIns').value);
    S.settings.excludeCancelled = $('setExcludeCancel').checked;
    S.settings.talentUnionOnly = $('setUnionOnly').checked;
    S.settings.includePendingRefund = $('setPendingRefund').checked;
    S.settings.adFallback = $('setAdFallback').checked;
    STORE.saveParams();
    $('settingsModal').classList.add('hidden');
    renderAll();
    U.toast('设置已保存并重算');
  }

  /* ================= 快捷时间 ================= */
  function quick(kind) {
    var t = U.todayStr();
    var r = { start: t, end: t };
    if (kind === 'yesterday') { r.start = r.end = U.addDays(t, -1); }
    else if (kind === '3d') { r.start = U.addDays(t, -2); r.end = t; }
    else if (kind === '7d') { r.start = U.addDays(t, -6); r.end = t; }
    else if (kind === 'month') {
      var d = new Date();
      r.start = d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-01';
      r.end = t;
    } else if (kind === 'lastmonth') {
      var d2 = new Date();
      var y = d2.getFullYear(), m = d2.getMonth();
      if (m === 0) { y--; m = 12; }
      r.start = y + '-' + U.pad(m) + '-01';
      var last = new Date(y, m, 0).getDate();
      r.end = y + '-' + U.pad(m) + '-' + last;
    } else if (kind === 'alldata') {
      var od = Object.keys(S.orderDates).sort();
      if (od.length) { r.start = od[0]; r.end = od[od.length - 1]; }
    }
    S.range = r;
    markChip(kind);
    renderAll();
  }

  function markChip(kind) {
    var chips = document.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('on', chips[i].getAttribute('data-quick') === kind);
    }
  }

  /* ================= 事件绑定 ================= */
  function bind() {
    var segs = document.querySelectorAll('.seg-btn');
    for (var i = 0; i < segs.length; i++) {
      segs[i].onclick = function () {
        var t = this.getAttribute('data-tab');
        S.tab = t;
        for (var j = 0; j < segs.length; j++) segs[j].classList.toggle('active', segs[j] === this);
        $('tab-overview').classList.toggle('hidden', t !== 'overview');
        $('tab-links').classList.toggle('hidden', t !== 'links');
        $('tab-skus').classList.toggle('hidden', t !== 'skus');
        renderAll();
      };
    }

    $('shopSel').onchange = function () { S.shop = this.value; renderAll(); };
    $('dateStart').onchange = function () { S.range.start = this.value; clampRange(); renderAll(); };
    $('dateEnd').onchange = function () { S.range.end = this.value; clampRange(); renderAll(); };

    var chips = document.querySelectorAll('.chip');
    for (var c = 0; c < chips.length; c++) {
      chips[c].onclick = function () { quick(this.getAttribute('data-quick')); };
    }

    $('btnImport').onclick = openImport;
    $('btnSettings').onclick = openSettings;
    $('setSave').onclick = saveSettings;

    var closers = document.querySelectorAll('[data-close]');
    for (var k = 0; k < closers.length; k++) {
      closers[k].onclick = function () {
        $(this.getAttribute('data-close')).classList.add('hidden');
      };
    }

    var dz = $('dz'), fi = $('fileInput');
    dz.onclick = function () { fi.click(); };
    fi.onchange = function () { handleFiles(this.files); this.value = ''; };
    dz.ondragover = function (e) { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = function () { dz.classList.remove('over'); };
    dz.ondrop = function (e) {
      e.preventDefault();
      dz.classList.remove('over');
      handleFiles(e.dataTransfer.files);
    };

    $('saConfirm').onclick = function () {
      if (!pending) return;
      var map = {};
      var ins = document.querySelectorAll('[data-shopfor]');
      for (var i = 0; i < ins.length; i++) {
        map[ins[i].getAttribute('data-shopfor')] = ins[i].value.trim() || IMP.baseName(ins[i].getAttribute('data-shopfor'));
      }
      finishIngest(pending, map);
    };

    $('btnClearAll').onclick = function () {
      if (!confirm('确定清空全部已导入数据？此操作不可撤销。')) return;
      STORE.clearAll();
      renderAll();
      renderImpList();
      U.toast('已清空');
    };
  }

  /* ================= 启动 ================= */
  function boot() {
    STORE.load().then(function () {
      $('boot').remove();
      $('app').classList.remove('hidden');
      bind();
      if (S.orders.length) autoFit();
      else quick('7d');
      renderAll();
    });
  }

  global.UI = { boot: boot, renderAll: renderAll, quick: quick };
})(window);

window.addEventListener('DOMContentLoaded', function () { UI.boot(); });
