/* 渲染与交互 */
(function (global) {
  'use strict';

  var S = STORE.S;
  var $ = function (id) { return document.getElementById(id); };

  var ACTIVE = { overview: null, links: null, skus: null };
  var expanded = {};        // links tab: pid -> true
  var skuPage = 1, skuFilter = '', skuOnlySold = false;
  var keepCell = null;      // Tab3 重绘后要还原焦点的格子
  var keepSearchFocus = null; // Tab3 搜索触发重绘后，要把焦点还原回搜索框

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

    /* 吸顶的两个全局参数：不要覆盖正在输入的值 */
    var tt = $('taxTop'), pt = $('prTop');
    if (tt && document.activeElement !== tt) tt.value = U.num(S.settings.taxRate);
    if (pt && document.activeElement !== pt) pt.value = U.num(S.settings.postRefundRate);

    var chips = document.querySelectorAll('.chip');
    for (var j = 0; j < chips.length; j++) chips[j].classList.remove('on');

    syncFilterSelects();
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
      kpi('预估发货后退款（' + U.num(S.settings.postRefundRate) + '%）', '¥' + U.money(t.postRefund),
        '预估金额 ¥' + U.money(t.postRefund) + '，独立显示', t.postRefund > 0 ? 'neg' : '') +
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

    /* 维度分析看板：按流量体裁 / 达人 / 流量来源 拆分有效GMV与净毛利 */
    var gb = res.groups || {};
    h += '<div class="cols3">' +
      breakdownHtml('按流量体裁', gb.format, 8) +
      breakdownHtml('按达人', gb.talent, 10) +
      breakdownHtml('按流量来源', gb.source, 8) +
      '</div>';

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

  /* ================= 吸顶维度筛选 ================= */
  function fillSelect(sel, map, cur, allLabel) {
    if (!sel) return;
    var keys = Object.keys(map).sort();
    var html = '<option value="__ALL__">' + allLabel + '</option>';
    for (var i = 0; i < keys.length; i++) {
      html += '<option value="' + U.esc(keys[i]) + '">' + U.esc(keys[i]) + '</option>';
    }
    sel.innerHTML = html;
    var key = sel.id === 'fltFormat' ? 'format' : sel.id === 'fltTalent' ? 'talent' : 'source';
    sel.value = (cur && map[cur]) ? cur : '__ALL__';
    if (sel.value === '__ALL__') S.filter[key] = '__ALL__';
  }

  function syncFilterSelects() {
    var fm = {}, tn = {}, src = {};
    for (var i = 0; i < S.orders.length; i++) {
      var o = S.orders[i];
      if (S.shop !== '__ALL__' && o.shop !== S.shop) continue;
      if (o.trafficFormat) fm[o.trafficFormat] = 1;
      if (o.talentName) tn[o.talentName] = 1;
      if (o.traffic) src[o.traffic] = 1;
    }
    fillSelect($('fltFormat'), fm, S.filter.format, '全部流量体裁');
    fillSelect($('fltTalent'), tn, S.filter.talent, '全部达人');
    fillSelect($('fltSource'), src, S.filter.source, '全部流量来源');
  }

  /* ================= 维度分析看板 ================= */
  function breakdownHtml(title, rows, maxRows) {
    if (!rows || !rows.length) return '';
    var show = rows;
    if (maxRows && rows.length > maxRows) {
      show = rows.slice(0, maxRows - 1);
      var other = { name: '其他（' + (rows.length - show.length) + '项）', gmv: 0, validGmv: 0, cost: 0, freight: 0, ins: 0, platformFee: 0, talentFee: 0, tax: 0, postRefund: 0, net: 0, qty: 0 };
      for (var x = maxRows - 1; x < rows.length; x++) {
        var rr = rows[x];
        other.gmv += rr.gmv; other.validGmv += rr.validGmv; other.cost += rr.cost; other.freight += rr.freight;
        other.ins += rr.ins; other.platformFee += rr.platformFee; other.talentFee += rr.talentFee;
        other.tax += rr.tax; other.postRefund += rr.postRefund; other.net += rr.net; other.qty += rr.qty;
      }
      show = show.concat([other]);
    }
    var max = 1;
    for (var i = 0; i < show.length; i++) max = Math.max(max, Math.abs(show[i].net));
    var totalValid = 0;
    for (var j = 0; j < show.length; j++) totalValid += show[j].validGmv;
    totalValid = totalValid || 1;
    var h = '<div class="panel"><div class="panel-head"><span class="panel-title">' + title + '</span>' +
      '<span class="panel-sub">净毛利不含投流</span></div><div class="brk">';
    for (var k = 0; k < show.length; k++) {
      var r = show[k];
      var w = Math.round(Math.abs(r.net) / max * 100);
      var cls = r.net >= 0 ? 'pos' : 'neg';
      var share = (r.validGmv / totalValid * 100);
      h += '<div class="brk-item">' +
        '<div class="brk-name" title="' + U.esc(r.name) + '">' + U.esc(r.name) + '</div>' +
        '<div class="brk-bar ' + (r.net >= 0 ? 'pos' : 'neg') + '"><i style="width:' + w + '%"></i></div>' +
        '<div class="brk-val"><span class="' + cls + '">¥' + U.money(r.net) + '</span>' +
        ' <span class="muted">有效GMV ¥' + U.money(r.validGmv) + ' · ' + share.toFixed(1) + '%</span></div>' +
        '</div>';
    }
    h += '</div></div>';
    return h;
  }

  /* 紧凑每日盈亏柱状图（红涨绿跌，含投流） */
  function dailyChartHtml(daily) {
    if (!daily || !daily.length) return '';
    var W = 680, H = 132, pad = 16;
    var n = daily.length;
    var maxAbs = 1;
    for (var i = 0; i < n; i++) maxAbs = Math.max(maxAbs, Math.abs(daily[i].net));
    var mid = H / 2;
    var bw = (W - pad * 2) / n;
    var barW = Math.max(2, bw * 0.62);
    var svg = '<svg class="daily-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';
    svg += '<line x1="0" y1="' + mid + '" x2="' + W + '" y2="' + mid + '" stroke="#e3e6ee" stroke-width="1"/>';
    for (var d = 0; d < n; d++) {
      var x = pad + bw * d + (bw - barW) / 2;
      var hh = Math.abs(daily[d].net) / maxAbs * (mid - pad);
      var y = daily[d].net >= 0 ? mid - hh : mid;
      var col = daily[d].net >= 0 ? '#e23b3b' : '#1faa59';
      svg += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) +
        '" height="' + Math.max(0.5, hh).toFixed(1) + '" fill="' + col + '">' +
        '<title>' + daily[d].date + ' 净盈亏 ¥' + U.money(daily[d].net) + '（有效GMV ¥' + U.money(daily[d].validGmv) + '）</title></rect>';
    }
    svg += '</svg>';
    var tot = 0;
    for (var t = 0; t < n; t++) tot += daily[t].net;
    return '<div class="panel"><div class="panel-head"><span class="panel-title">每日盈亏</span>' +
      '<span class="panel-sub">红涨绿跌 · 含投流 · 合计 ¥' + U.money(tot) + '</span></div>' +
      '<div class="daily-chart">' + svg + '</div></div>';
  }

  /* ================= Tab2 链接利润 ================= */
  function renderLinks(res) {
    var links = res.links.slice().sort(function (a, b) { return b.validGmv - a.validGmv; });
    var h = dailyChartHtml(res.daily) +
      '<div class="panel"><div class="panel-head">' +
      '<span class="panel-title">全部链接利润</span>' +
      '<span class="link-expand-btns">' +
      '<button class="btn btn-sm" id="btnExpandAll">全部展开</button>' +
      '<button class="btn btn-sm" id="btnCollapseAll">全部收起</button>' +
      '</span></div>' +
      '<div class="tbl-wrap">' + linkTableHtml(links, true) + '</div>' +
      '<div class="panel-foot">点击任意一行即可展开／收起该链接的 SKU 明细。' +
      '「预估发货后退款率」可单独改，留空则跟随顶部全局值；' +
      '<b>改顶部全局值时，所有链接（含单独改过的）都会跟着变</b>。' +
      'SKU 行投流 = 链接投流 × 该 SKU <b>有效GMV占比</b>（加粗那个）。</div></div>';
    $('tab-links').innerHTML = h;
    bindExpand();

    var ea = $('btnExpandAll');
    if (ea) ea.onclick = function () {
      for (var i = 0; i < links.length; i++) expanded[links[i].pid] = true;
      renderLinks(ACTIVE.links);
    };
    var ca = $('btnCollapseAll');
    if (ca) ca.onclick = function () {
      expanded = {};
      renderLinks(ACTIVE.links);
    };
  }

  function linkTableHtml(links, expandable) {
    var h = '<table class="tbl compact"><thead><tr>' +
      '<th class="th-l">商品名称</th>' +
      '<th>销量</th><th>成交GMV</th><th>退款率</th><th>投流费用</th><th>商品成本</th>' +
      '<th>运费</th><th>运费险</th>' +
      '<th>ROI</th><th>保本ROI</th>' +
      '<th>预估发货后<br>退款率</th>' +
      '<th>达人佣金</th><th>平台扣点</th>' +
      '<th>净毛利</th><th>净利润</th><th>净利率</th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      var open = expanded[l.pid];
      var roi = CALC.linkRoi(l);
      var be = CALC.linkBreakeven(l);
      var netCls = l.net >= 0 ? 'pos' : 'neg';
      var lp = STORE.getLinkParam(l.pid);

      h += '<tr class="grp-row' + (open ? ' open' : '') + '" data-pid="' + U.esc(l.pid) + '">' +
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
        '<td>¥' + U.money(l.freight) + '</td>' +
        '<td>¥' + U.money(l.ins) + '</td>' +
        '<td>' + (l.ad > 0 ? roi.toFixed(2) : '<span class="muted">自然</span>') + '</td>' +
        '<td class="' + (l.ad > 0 && roi < be ? 'neg' : '') + '">' + (isFinite(be) ? be.toFixed(2) : '—') + '</td>' +
        '<td>' +
        '<input class="cell-input cell-input-xs" data-pr="' + U.esc(l.pid) + '" type="number" step="0.01" ' +
        'value="' + (lp.postRefund === null ? '' : lp.postRefund) + '" ' +
        'placeholder="' + U.num(S.settings.postRefundRate) + '" ' +
        'title="留空则跟随全局（当前 ' + U.num(S.settings.postRefundRate) + '%）；单独填值只改这一条链接；改顶部全局值会重置所有链接">' +
        '<div class="muted" style="font-size:11px">¥' + U.money(l.postRefund) + '</div>' +
        '</td>' +
        '<td>¥' + U.money(l.talentFee) + '</td>' +
        '<td>¥' + U.money(l.platformFee) + '</td>' +
        '<td>¥' + U.money(l.gross) + '</td>' +
        '<td class="' + netCls + '">¥' + U.money(l.net) + '</td>' +
        '<td class="' + netCls + '">' + U.pct(U.ratio(l.net, l.validGmv), 1) + '</td>' +
        '</tr>';

      if (expandable && open) {
        for (var j = 0; j < l.skuList.length; j++) {
          var K = l.skuList[j];
          /* 投流按有效GMV占比分摊；销量占比另外给出，避免两种占比混为一谈 */
          var qtyShare = l.validQty > 0 ? K.validQty / l.validQty : 0;
          var gmvShare = l.validGmv > 0 ? K.validGmv / l.validGmv : 0;
          h += '<tr class="sub-row"><td class="l" style="padding-left:34px">' +
            '<span class="sname" title="' + U.esc(K.spec) + '">' + U.esc(K.spec || K.key) + '</span></td>' +
            '<td>' + U.money0(K.validQty) + '</td>' +
            '<td>¥' + U.money(K.validGmv) + '</td>' +
            '<td title="投流费用按有效GMV占比 ' + (gmvShare * 100).toFixed(2) + '% 分摊；销量占比 ' + (qtyShare * 100).toFixed(2) + '%">' +
            '<b>' + U.pct(gmvShare, 1) + '</b><span class="muted"> GMV</span>' +
            '<br><span class="muted" style="font-size:11px">' + U.pct(qtyShare, 1) + ' 销量</span></td>' +
            '<td>¥' + U.money(K.ad) + '</td>' +
            '<td>¥' + U.money(K.cost) + '</td>' +
            '<td>¥' + U.money(K.freight) + '</td>' +
            '<td>¥' + U.money(K.ins) + '</td>' +
            '<td class="muted" colspan="2">售价 ¥' + U.money(K.price) + '</td>' +
            '<td class="muted">¥' + U.money(K.postRefund) + '</td>' +
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
    /* 点整行的任意位置都能展开／收起；点输入框不触发 */
    var rows = document.querySelectorAll('.grp-row[data-pid]');
    for (var i = 0; i < rows.length; i++) {
      rows[i].onclick = function (e) {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.classList.contains('exp'))) {
          if (e.target.classList.contains('exp')) {
            expanded[this.getAttribute('data-pid')] = !expanded[this.getAttribute('data-pid')];
            renderLinks(ACTIVE.links);
          }
          return;
        }
        expanded[this.getAttribute('data-pid')] = !expanded[this.getAttribute('data-pid')];
        renderLinks(ACTIVE.links);
      };
    }

    /* 每条链接的预估发货后退款率 */
    var prs = document.querySelectorAll('[data-pr]');
    for (var j = 0; j < prs.length; j++) {
      prs[j].onchange = function () {
        var pid = this.getAttribute('data-pr');
        var v = this.value;
        STORE.setLinkParam(pid, 'postRefund', (v === '' ? null : v));
        renderAll();
      };
    }
  }

  /* ================= Tab3 SKU 成本 ================= */
  function renderSkus(res) {
    var tax = U.num(S.settings.taxRate);
    var skuMap = res.skuMap || {};

    /* 重绘前先记下表格内滚动位置和页面滚动位置 */
    var wrap = $('tab-skus').querySelector ? $('tab-skus').querySelector('.tbl-wrap') : null;
    var keepTop = wrap ? wrap.scrollTop : 0;
    var keepWin = window.pageYOffset || 0;

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
      '<input type="text" id="skuSearch" class="input" style="width:240px" placeholder="搜索名称/规格/SKU编码（回车筛选）" value="' + U.esc(skuFilter) + '">' +
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

    /* 还原滚动位置 + 焦点，填成本时不会被顶回第一行 */
    if (keepTop || keepWin) {
      var w2 = $('tab-skus').querySelector('.tbl-wrap');
      if (w2) w2.scrollTop = keepTop;
      if (keepWin) window.scrollTo(0, keepWin);
    }
    if (keepCell) {
      var sel = '[data-pid="' + keepCell.pid + '"][data-k="' + keepCell.k + '"][data-f="' + keepCell.f + '"]';
      var el = $('tab-skus').querySelector(sel);
      if (el) { el.focus(); el.select(); }
      keepCell = null;
    }

    /* 搜索触发重绘后，把焦点和光标还原回搜索框，避免输入被打断 */
    if (keepSearchFocus) {
      var sf = $('skuSearch');
      if (sf) {
        sf.focus();
        var p = Math.min(keepSearchFocus.pos, sf.value.length);
        try { sf.setSelectionRange(p, p); } catch (e) {}
      }
      keepSearchFocus = null;
    }
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
        var pid = this.getAttribute('data-pid');
        var k = this.getAttribute('data-k');
        var f = this.getAttribute('data-f');
        STORE.setParam(pid, k, f, this.value);
        /* 记录刚编辑的格子，重绘后把滚动位置和焦点还原回去，不会跳回顶部 */
        keepCell = { pid: pid, k: k, f: f };
        renderAll();
      };
    }

    var se = $('skuSearch');
    if (se) {
      se.onkeydown = function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) {
          e.preventDefault();
          var self = this;
          skuFilter = self.value;
          skuPage = 1;
          keepSearchFocus = { pos: self.value.length };
          renderSkus(ACTIVE.skus);
        }
      };
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
      /* 多带一列「参数键」保证回填时对得上（商家编码常为空，光靠它定位会失败） */
      var aoa = [['商品ID', '商品名称', '规格', 'SKU编码', '参数键(勿改)', '售价', '商品成本', '运费', '运费险', '平台扣点(%)', '达人佣金(%)']];
      for (var i = 0; i < src.length; i++) {
        var s = src[i];
        var key = STORE.skuKeyOf(s);
        var p = STORE.getParam(s.pid, key);
        aoa.push([s.pid, s.pname, s.spec, s.skuCode, key, s.price,
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

      var hdr = rows[0];
      for (var hc = 0; hc < hdr.length; hc++) hdr[hc] = U.clean(hdr[hc]);

      /* 按列名定位，兼容列顺序被打乱或列数不同 */
      var idx = { pid: 0, pname: 1, spec: 2, skuCode: 3, pkey: -1, price: 4, cost: 5, freight: 6, ins: 7, pr: 8, tr: 9 };
      for (var hc2 = 0; hc2 < hdr.length; hc2++) {
        var nm = hdr[hc2];
        if (nm === '商品ID') idx.pid = hc2;
        else if (nm === '商品名称') idx.pname = hc2;
        else if (nm === '规格') idx.spec = hc2;
        else if (nm === 'SKU编码' || nm === '商家编码' || nm === '商家SKU编码') idx.skuCode = hc2;
        else if (nm.indexOf('参数键') >= 0) idx.pkey = hc2;
        else if (nm === '售价' || nm === '商品价格') idx.price = hc2;
        else if (nm === '商品成本') idx.cost = hc2;
        else if (nm === '运费' || nm === '单件运费') idx.freight = hc2;
        else if (nm === '运费险') idx.ins = hc2;
        else if (nm.indexOf('平台扣点') >= 0) idx.pr = hc2;
        else if (nm.indexOf('达人佣金') >= 0) idx.tr = hc2;
      }

      var hasHdr = /商品ID/.test(hdr.join(''));
      var i0 = hasHdr ? 1 : 0;

      /* 商品ID → (规格 → 内部参数键) 索引，供 SKU编码 为空时兜底匹配 */
      var bySpec = {};
      for (var s = 0; s < S.skus.length; s++) {
        var sk = S.skus[s];
        var k1 = bySpec[sk.pid] || (bySpec[sk.pid] = {});
        k1[U.normSpec(sk.spec) || U.clean(sk.spec)] = STORE.skuKeyOf(sk);
      }

      var parsed = [];
      var noPid = 0, noKey = 0;
      for (var i = i0; i < rows.length; i++) {
        var r = rows[i];
        var pid = U.clean(r[idx.pid]);
        if (!pid) { noPid++; continue; }

        var key = '';
        if (idx.pkey >= 0) key = U.clean(r[idx.pkey]);
        if (!key && idx.skuCode >= 0) key = U.clean(r[idx.skuCode]);
        if (!key) {
          /* SKU编码整列为空时用「商品ID + 规格」定位 */
          var spec = idx.spec >= 0 ? U.clean(r[idx.spec]) : '';
          var m = bySpec[pid];
          if (m) key = m[U.normSpec(spec) || spec] || '';
        }
        if (!key) { noKey++; continue; }

        parsed.push({
          pid: pid, skuCode: key,
          cost: U.num(r[idx.cost]), freight: U.num(r[idx.freight]),
          ins: U.num(r[idx.ins]), pr: U.pctNum(r[idx.pr]), tr: U.pctNum(r[idx.tr])
        });
      }

      if (!parsed.length) {
        U.toast('未识别到数据行（缺商品ID ' + noPid + ' 行；定位不到 SKU ' + noKey + ' 行）');
        return;
      }
      for (var j = 0; j < parsed.length; j++) {
        var o = parsed[j];
        var p = STORE.getParam(o.pid, o.skuCode);
        p.cost = o.cost; p.freight = o.freight; p.ins = o.ins;
        p.pr = o.pr; p.tr = o.tr;
        p.dirty = 1;
      }
      STORE.saveParams();
      renderAll();
      U.toast('已导入 ' + parsed.length + ' 条 SKU 参数' + (noKey ? '（' + noKey + ' 行未匹配，已跳过）' : ''));
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
    $('setPostRefund').value = s.postRefundRate;
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
    var oldPr = U.num(S.settings.postRefundRate);
    S.settings.taxRate = U.num($('setTax').value);
    S.settings.postRefundRate = U.num($('setPostRefund').value);
    var clearedPr = Math.abs(oldPr - S.settings.postRefundRate) > 0.000001
      ? STORE.resetLinkPostRefund() : 0;
    S.settings.platformRate = U.num($('setPlatform').value);
    S.settings.talentRate = U.num($('setTalent').value);
    S.settings.freight = U.num($('setFreight').value);
    S.settings.freightIns = U.num($('setIns').value);
    S.settings.excludeCancelled = $('setExcludeCancel').checked;
    S.settings.talentUnionOnly = $('setUnionOnly').checked;
    S.settings.includePendingRefund = $('setPendingRefund').checked;
    S.settings.adFallback = $('setAdFallback').checked;
    /* 关键：把新的默认值刷进 SKU 参数表，否则看板数字不会变 */
    var r = STORE.applyDefaults();
    STORE.saveParams();
    $('settingsModal').classList.add('hidden');
    renderAll();
    var msg = '设置已保存并重算：' + U.money0(r.updated) + ' 个 SKU 已按新默认值更新';
    if (r.kept) msg += '，' + U.money0(r.kept) + ' 个单独改过的保持不变';
    if (clearedPr) msg += '；' + clearedPr + ' 条链接的预估退款率已重置为跟随全局';
    U.toast(msg);
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

    $('taxTop').onchange = function () {
      S.settings.taxRate = U.num(this.value);
      STORE.saveParams();
      renderAll();
    };
    $('prTop').onchange = function () {
      var old = U.num(S.settings.postRefundRate);
      S.settings.postRefundRate = U.num(this.value);
      /* 全局一改，所有链接无条件跟随（含之前单独改过的） */
      var cleared = Math.abs(old - S.settings.postRefundRate) > 0.000001
        ? STORE.resetLinkPostRefund() : 0;
      STORE.saveParams();
      renderAll();
      U.toast('预估发货后退款率已设为 ' + U.num(S.settings.postRefundRate) + '%' +
        (cleared ? '，' + cleared + ' 条链接的单独设置已重置为跟随全局' : ''));
    };

    $('shopSel').onchange = function () { S.shop = this.value; renderAll(); };
    $('dateStart').onchange = function () { S.range.start = this.value; clampRange(); renderAll(); };
    $('dateEnd').onchange = function () { S.range.end = this.value; clampRange(); renderAll(); };

    $('fltFormat').onchange = function () { S.filter.format = this.value; renderAll(); };
    $('fltTalent').onchange = function () { S.filter.talent = this.value; renderAll(); };
    $('fltSource').onchange = function () { S.filter.source = this.value; renderAll(); };

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
