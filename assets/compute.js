/* 利润计算引擎 */
(function (global) {
  'use strict';

  var S = STORE.S;

  var AFTER_OK = '退款成功';
  var AFTER_PENDING = ['待退货', '待收退货'];

  function isRefunded(o) {
    if (o.after === AFTER_OK) return true;
    if (S.settings.includePendingRefund && AFTER_PENDING.indexOf(o.after) >= 0) return true;
    return false;
  }

  function isDeal(o) {
    if (S.settings.excludeCancelled && o.status === '已关闭' && o.after === '-') return false;
    return true;
  }

  function inRange(d, r) {
    return d >= r.start && d <= r.end;
  }

  /* 某链接在所选区间的推广消耗 */
  function adSpendFor(pid, range, adIndex, adAll) {
    var total = 0;
    var days = U.eachDay(range.start, range.end);
    var hitDay = 0;
    for (var i = 0; i < days.length; i++) {
      var v = U.num(adIndex[pid + '|' + days[i]]);
      if (v) hitDay++;
      total += v;
    }
    if (total === 0 && S.settings.adFallback && adAll[pid]) {
      total = U.num(adAll[pid]);
    }
    return { spend: total, hitDay: hitDay };
  }

  /* 区间是否被推广表覆盖 */
  function adCoverage(range, adDates) {
    var days = U.eachDay(range.start, range.end);
    var miss = [];
    for (var i = 0; i < days.length; i++) {
      if (!adDates[days[i]]) miss.push(days[i]);
    }
    return miss;
  }

  function emptyLink(pid) {
    return {
      pid: pid, pname: '', link: '',
      gmv: 0, qty: 0,
      refund: 0, refundQty: 0, refundPre: 0, refundPost: 0, refundPending: 0,
      validGmv: 0, validQty: 0, unionGmv: 0,
      cost: 0, freight: 0, ins: 0,
      ad: 0, adHitDay: 0,
      platformFee: 0, talentFee: 0, tax: 0,
      prRate: 0, postRefund: 0,
      gross: 0, net: 0,
      skus: {}, missingCost: 0,
      skuList: []
    };
  }

  function emptySku(key) {
    return {
      key: key, spec: '', skuCode: '', pname: '', price: 0,
      gmv: 0, qty: 0, refund: 0, refundQty: 0,
      validGmv: 0, validQty: 0, unionGmv: 0,
      cost: 0, freight: 0, ins: 0, ad: 0,
      platformFee: 0, talentFee: 0, tax: 0,
      postRefund: 0,
      net: 0, missing: false
    };
  }

  function run(opts) {
    var range = S.range;
    var shop = S.shop;
    var set = S.settings;
    var taxRate = U.num(set.taxRate) / 100;

    var linkMap = {};
    var totals = emptyLink('__TOTAL__');
    var missingDaysOrders = false;

    var orders = S.orders;
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (shop !== '__ALL__' && o.shop !== shop) continue;
      if (o.date < range.start || o.date > range.end) continue;
      missingDaysOrders = true;

      if (!isDeal(o)) continue;

      var L = linkMap[o.pid];
      if (!L) { L = linkMap[o.pid] = emptyLink(o.pid); L.pname = o.pname; L.link = o.link || ''; }

      var sk = o.skuKey;
      var K = L.skus[sk];
      if (!K) {
        K = L.skus[sk] = emptySku(sk);
        K.spec = o.spec || '';
        K.skuCode = o.skuCode || '';
        K.pname = o.pname;
      }

      var qty = U.num(o.qty);
      var pay = U.num(o.pay);
      var refunded = isRefunded(o);
      var price = U.num(o.price);
      if (!K.price) K.price = price;

      L.gmv += pay;
      L.qty += qty;
      K.gmv += pay;
      K.qty += qty;

      if (refunded) {
        L.refund += pay;
        L.refundQty += qty;
        K.refund += pay;
        K.refundQty += qty;
        if (o.after === AFTER_OK) {
          if (o.shipAt) { L.refundPost += pay; } else { L.refundPre += pay; }
        } else {
          L.refundPending += pay;
        }
      } else {
        var p = STORE.getParam(o.pid, sk);
        if (U.num(p.cost) === 0) { L.missingCost += qty; K.missing = true; }
        L.validGmv += pay;
        L.validQty += qty;
        L.cost += qty * U.num(p.cost);
        L.freight += qty * U.num(p.freight);
        L.ins += qty * U.num(p.ins);
        if (o.traffic === '精选联盟') L.unionGmv += pay;

        K.validGmv += pay;
        K.validQty += qty;
        K.cost += qty * U.num(p.cost);
        K.freight += qty * U.num(p.freight);
        K.ins += qty * U.num(p.ins);
        if (o.traffic === '精选联盟') K.unionGmv += pay;
      }
    }

    /* 推广消耗：区间内花了钱但没出单的链接也要进来，否则这笔亏损会凭空消失
       单店视图下只进该店的商品，避免别店的链接和花费漏进来 */
    var adIndex = S.adIndex || {};
    var adAll = S.adAll || {};
    var pidShop = S.pidShop || {};
    var adPidList = Object.keys(S.adPids || {});
    for (var ai = 0; ai < adPidList.length; ai++) {
      var apid = adPidList[ai];
      if (shop !== '__ALL__' && pidShop[apid] !== shop) continue;
      var aa = adSpendFor(apid, range, adIndex, adAll);
      if (aa.spend <= 0) continue;
      var aL = linkMap[apid];
      if (!aL) {
        aL = linkMap[apid] = emptyLink(apid);
        aL.pname = (S.pidName && S.pidName[apid]) || (S.adNames && S.adNames[apid]) || apid;
        aL.link = 'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=' + apid;
        aL.adOnly = true;
      }
      aL.ad = aa.spend;
      aL.adHitDay = aa.hitDay;
    }
    var pids = Object.keys(linkMap);

    /* 费用与利润 */
    var linkList = [];
    for (var k = 0; k < pids.length; k++) {
      var lk = linkMap[pids[k]];
      finalizeLink(lk, taxRate);
      linkList.push(lk);
    }

    /* 汇总 */
    for (var m = 0; m < linkList.length; m++) {
      var L2 = linkList[m];
      totals.gmv += L2.gmv; totals.qty += L2.qty;
      totals.refund += L2.refund; totals.refundQty += L2.refundQty;
      totals.refundPre += L2.refundPre; totals.refundPost += L2.refundPost;
      totals.refundPending += L2.refundPending;
      totals.validGmv += L2.validGmv; totals.validQty += L2.validQty;
      totals.unionGmv += L2.unionGmv;
      totals.cost += L2.cost; totals.freight += L2.freight; totals.ins += L2.ins;
      totals.ad += L2.ad; totals.platformFee += L2.platformFee;
      totals.talentFee += L2.talentFee; totals.tax += L2.tax;
      totals.postRefund += L2.postRefund;
      totals.gross += L2.gross; totals.net += L2.net;
      totals.missingCost += L2.missingCost;
    }
    finalizeTotals(totals, taxRate);

    var warns = [];
    var miss = adCoverage(range, S.adDates || {});
    if (miss.length) {
      warns.push('推广数据缺少 ' + miss.length + ' 天（' + miss[0] + (miss.length > 1 ? ' 等' : '') + '），这些天的广告消耗按 0 计，ROI 会偏高。');
    }
    var missCost = 0;
    for (var mc = 0; mc < linkList.length; mc++) missCost += linkList[mc].missingCost;
    if (missCost > 0) {
      warns.push('有 ' + U.money0(missCost) + ' 件商品的「商品成本」还没填，暂按 0 计，利润被高估。去 SKU 成本页补全。');
    }
    if (!missingDaysOrders) {
      warns.push('所选区间内没有任何订单。');
    }

    var skuMap = {};
    for (var sl = 0; sl < linkList.length; sl++) {
      var LK = linkList[sl];
      for (var sk2 = 0; sk2 < LK.skuList.length; sk2++) {
        var KK = LK.skuList[sk2];
        skuMap[LK.pid + '|' + KK.key] = {
          qty: KK.qty, validQty: KK.validQty, gmv: KK.gmv,
          validGmv: KK.validGmv, net: KK.net, ad: KK.ad
        };
      }
    }

    return { totals: totals, links: linkList, warns: warns, skuMap: skuMap };
  }

  function finalizeLink(lk, taxRate) {
    finalizeSkuFee(lk, taxRate);

    /* SKU 级：广告按有效GMV占比分摊 */
    var keys = Object.keys(lk.skus);
    for (var i = 0; i < keys.length; i++) {
      var K = lk.skus[keys[i]];
      var share = lk.validGmv > 0 ? K.validGmv / lk.validGmv : 0;
      K.ad = lk.ad * share;

      var rate = K.validGmv > 0 ? K.validGmv / lk.validGmv : 0;
      var p = STORE.getParam(lk.pid, K.key);
      var pr = U.num(p.pr) / 100;
      var tr = U.num(p.tr) / 100;
      var unionAmt = S.settings.talentUnionOnly ? K.unionGmv : K.validGmv;
      K.platformFee = K.validGmv * pr;
      K.talentFee = unionAmt * tr;
      K.tax = K.validGmv * taxRate;
      K.postRefund = K.validGmv * (STORE.linkPostRefundRate(lk.pid) / 100);
      K.net = K.validGmv - K.cost - K.freight - K.ins - K.platformFee - K.talentFee - K.ad - K.tax - K.postRefund;
      lk.skuList.push(K);
    }
    lk.skuList.sort(function (a, b) { return b.validGmv - a.validGmv; });
  }

  function finalizeSkuFee(lk, taxRate) {
    lk.refundRate = U.ratio(lk.refund, lk.gmv);
    /* 链接级佣金率取该链接下 SKU 的加权（按有效GMV） */
    var keys = Object.keys(lk.skus);
    var used = 0, prSum = 0, trSum = 0;
    for (var i = 0; i < keys.length; i++) {
      var K = lk.skus[keys[i]];
      if (K.validGmv <= 0) continue;
      var p = STORE.getParam(lk.pid, K.key);
      prSum += K.validGmv * U.num(p.pr) / 100;
      trSum += (S.settings.talentUnionOnly ? K.unionGmv : K.validGmv) * U.num(p.tr) / 100;
      used += K.validGmv;
    }
    /* 链接级直接用加总金额，保持与 SKU 合计一致 */
    lk.platformFee = prSum;
    lk.talentFee = trSum;
    lk.tax = lk.validGmv * taxRate;
    lk.prRate = STORE.linkPostRefundRate(lk.pid);
    lk.postRefund = lk.validGmv * (lk.prRate / 100);
    lk.gross = lk.validGmv - lk.cost - lk.freight - lk.ins - lk.platformFee - lk.talentFee - lk.ad;
    lk.net = lk.gross - lk.tax - lk.postRefund;
  }

  function finalizeTotals(t, taxRate) {
    t.refundRate = U.ratio(t.refund, t.gmv);
    t.netRate = U.ratio(t.net, t.validGmv);
    t.grossRate = U.ratio(t.gross, t.validGmv);
    t.roi = t.ad > 0 ? t.validGmv / t.ad : 0;
    t.roiRaw = t.ad > 0 ? t.gmv / t.ad : 0;
    t.postRefundRate = U.ratio(t.postRefund, t.validGmv);
    var varCost = t.cost + t.freight + t.ins + t.platformFee + t.talentFee + t.tax + t.postRefund;
    var margin = t.validGmv - varCost;
    t.breakeven = margin > 0 ? t.validGmv / margin : Infinity;
    t.marginRate = U.ratio(margin, t.validGmv);
  }

  function linkRoi(lk) {
    return lk.ad > 0 ? lk.validGmv / lk.ad : 0;
  }

  function linkBreakeven(lk) {
    var varCost = lk.cost + lk.freight + lk.ins + lk.platformFee + lk.talentFee + lk.tax + lk.postRefund;
    var margin = lk.validGmv - varCost;
    return margin > 0 ? lk.validGmv / margin : Infinity;
  }

  global.CALC = {
    run: run,
    linkRoi: linkRoi,
    linkBreakeven: linkBreakeven
  };
})(window);
