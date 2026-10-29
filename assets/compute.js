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

  /* 单笔订单对利润的「不含投流」贡献，供维度分组与每日盈亏复用 */
  function orderContrib(o, taxRate, set) {
    var gmv = U.num(o.pay) + U.num(o.platDisc);
    var r = { gmv: gmv, validGmv: 0, cost: 0, freight: 0, ins: 0, platformFee: 0, talentFee: 0, tax: 0, postRefund: 0, qty: U.num(o.qty) };
    if (isRefunded(o)) return r;
    var p = STORE.getParam(o.pid, o.skuKey);
    var qty = r.qty;
    var pr = U.num(p.pr) / 100;
    var tr = U.num(p.tr) / 100;
    var unionAmt = set.talentUnionOnly && o.traffic !== '精选联盟' ? 0 : gmv;
    var postRate = STORE.linkPostRefundRate(o.pid) / 100;
    r.validGmv = gmv;
    r.cost = qty * U.num(p.cost);
    r.freight = qty * U.num(p.freight);
    r.ins = qty * U.num(p.ins);
    r.platformFee = gmv * pr;
    r.talentFee = unionAmt * tr;
    r.tax = gmv * taxRate;
    r.postRefund = gmv * postRate;
    return r;
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

  /* 「流量来源」→「自卖/合作」桶的映射 */
  function coopOfSource(src) {
    if (src === '精选联盟') return '合作';
    if (src === '小店自卖') return '自卖';
    return null;   // 空值 / 其他来源：商品经营数据里没有对应桶
  }

  /* 从「商品经营数据」取该商品在所选筛选下的消耗（按 载体 × 自卖合作 分桶）。
     返回 null 表示这个商品没有经营数据，需要回退旧推广表。
     forceCoop 用于达人维度：已确认是店铺自卖账号时，只取自卖桶。 */
  function bucketSpend(pid, filter, forceCoop) {
    var all = S.adBucket && S.adBucket[pid];
    if (!all) return null;
    var f = filter || {};
    var self = 0, talent = 0, total = 0, matched = [];
    for (var k in all) {
      var parts = k.split('|');
      var carrier = parts[0], coop = parts[1];
      if (f.format && f.format !== '__ALL__' && carrier !== f.format) continue;
      if (f.source && f.source !== '__ALL__') {
        var want = coopOfSource(f.source);
        if (!want || coop !== want) continue;
      }
      if (forceCoop && coop !== forceCoop) continue;
      var v = U.num(all[k]);
      matched.push({ carrier: carrier, coop: coop, spend: v });
      total += v;
      if (coop === '合作') talent += v; else self += v;
    }
    return { total: total, self: self, talent: talent, buckets: matched, hasData: true };
  }

  /* 商品经营数据只有整段统计周期汇总，没有按天。
     按该商品在周期内的「每日有效GMV」占比摊到所选区间（ROI 不失真）。
     注意：订单数据可能只覆盖周期的一部分（比如订单只有 8 天、周期是 30 天），
     没被订单覆盖的日子用「已覆盖日的日均GMV」估权重，否则整段消耗会被压进那几天。
     若该商品在覆盖日内完全没有有效成交，则退回按天数平均摊，避免白烧的钱被摊成 0。 */
  function allocateByDay(pid, amount, range, pidDayValid) {
    var out = { spend: 0, daily: {}, mode: 'none' };
    if (!amount) return out;
    var br = S.adBucketRange;
    if (!br) { out.spend = amount; out.mode = 'range-unknown'; return out; }

    var s = range.start > br.start ? range.start : br.start;
    var e = range.end < br.end ? range.end : br.end;
    if (s > e) return out;                     // 所选区间与统计周期没有交集

    var days = U.eachDay(br.start, br.end);
    var covered = S.orderDates || {};
    var knownSum = 0, knownN = 0, i, d;
    for (i = 0; i < days.length; i++) {
      d = days[i];
      if (covered[d]) { knownSum += U.num(pidDayValid[pid + '|' + d]); knownN++; }
    }
    var avg = knownN > 0 ? knownSum / knownN : 0;

    var w = [], totalW = 0, inW = 0;
    for (i = 0; i < days.length; i++) {
      d = days[i];
      var v = covered[d] ? U.num(pidDayValid[pid + '|' + d]) : avg;
      w.push(v);
      totalW += v;
      if (d >= s && d <= e) inW += v;
    }

    if (totalW > 0 && inW > 0) {
      out.spend = amount * inW / totalW;
      for (i = 0; i < days.length; i++) {
        d = days[i];
        if (d < s || d > e) continue;
        if (w[i] > 0) out.daily[d] = amount * w[i] / totalW;
      }
      out.mode = 'gmv';
    } else {
      var n = U.eachDay(s, e).length;
      out.spend = amount * n / days.length;
      out.mode = 'avg';
    }
    return out;
  }

  /* 某达人在所选区间的投放消耗（达人消耗表按天精确，缺失则用「全部」汇总）。
     known = 这张表里到底有没有这个达人；没有的话（比如店铺自己的自卖账号）
     就不能用达人表，要回退到经营数据的自卖桶。 */
  function talentSpendInRange(talent, range) {
    var days = U.eachDay(range.start, range.end);
    var sum = 0, hit = 0, daily = {};
    for (var i = 0; i < days.length; i++) {
      var v = U.num(S.talentAd[talent + '|' + days[i]]);
      if (v) { sum += v; hit++; daily[days[i]] = v; }
    }
    var known = hit > 0 || (S.talentAdAll && S.talentAdAll[talent] != null);
    if (hit === 0 && S.talentAdAll[talent]) {
      var all = U.num(S.talentAdAll[talent]);
      if (all > 0) { sum = all; }
    }
    return { spend: sum, daily: daily, hitDay: hit, known: known };
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
      /* 投流拆分：自卖 vs 达人（合作）。只有导入了「商品经营数据」才有值，
         否则 adSelf/adTalent 都为 0，ad 走旧推广表口径 */
      adSelf: 0, adTalent: 0, adMode: '',
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
      adSelf: 0, adTalent: 0,
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
    var f = S.filter || { format: '__ALL__', talent: '__ALL__', source: '__ALL__' };

    var linkMap = {};
    var totals = emptyLink('__TOTAL__');
    var missingDaysOrders = false;
    var daily = {};            // date -> 每日盈亏累计（用于每日盈亏图）
    /* 摊分权重：该商品「每日有效GMV」。刻意不受所选日期区间限制，
       因为商品经营数据的消耗是整段统计周期汇总，需要在整个周期内按权重摊。 */
    var pidDayValid = {};
    /* 达人筛选时，用来判断被筛选的是一个「真达人（合作）」还是店铺自己的自卖账号 */
    var talentSrc = { union: 0, self: 0 };

    var orders = S.orders;
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (shop !== '__ALL__' && o.shop !== shop) continue;
      /* 维度筛选：流量体裁 / 达人昵称 / 流量来源 */
      if (f.format !== '__ALL__' && o.trafficFormat !== f.format) continue;
      if (f.talent !== '__ALL__' && o.talentName !== f.talent) continue;
      if (f.source !== '__ALL__' && o.traffic !== f.source) continue;

      /* 权重累计要放在区间判断之前 */
      if (isDeal(o) && !isRefunded(o)) {
        var wk = o.pid + '|' + o.date;
        pidDayValid[wk] = (pidDayValid[wk] || 0) + U.num(o.pay) + U.num(o.platDisc);
      }

      if (o.date < range.start || o.date > range.end) continue;
      missingDaysOrders = true;

      if (f.talent !== '__ALL__') {
        if (o.traffic === '精选联盟') talentSrc.union++;
        else if (o.traffic === '小店自卖') talentSrc.self++;
      }

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
      /* 成交 GMV = 订单应付金额 + 平台实际承担优惠金额 */
      var gmv = U.num(o.pay) + U.num(o.platDisc);
      var refunded = isRefunded(o);
      var price = U.num(o.price);
      if (!K.price) K.price = price;

      L.gmv += gmv;
      L.qty += qty;
      K.gmv += gmv;
      K.qty += qty;

      if (refunded) {
        L.refund += gmv;
        L.refundQty += qty;
        K.refund += gmv;
        K.refundQty += qty;
        if (o.after === AFTER_OK) {
          if (o.shipAt) { L.refundPost += gmv; } else { L.refundPre += gmv; }
        } else {
          L.refundPending += gmv;
        }
      } else {
        var p = STORE.getParam(o.pid, sk);
        if (U.num(p.cost) === 0) { L.missingCost += qty; K.missing = true; }
        L.validGmv += gmv;
        L.validQty += qty;
        L.cost += qty * U.num(p.cost);
        L.freight += qty * U.num(p.freight);
        L.ins += qty * U.num(p.ins);
        if (o.traffic === '精选联盟') L.unionGmv += gmv;

        K.validGmv += gmv;
        K.validQty += qty;
        K.cost += qty * U.num(p.cost);
        K.freight += qty * U.num(p.freight);
        K.ins += qty * U.num(p.ins);
        if (o.traffic === '精选联盟') K.unionGmv += gmv;
      }

      /* 每日盈亏累计（不含广告的部分，广告在下方按天补进来） */
      var dt = o.date;
      var db = daily[dt] || (daily[dt] = { gmv: 0, validGmv: 0, cost: 0, freight: 0, ins: 0, platformFee: 0, talentFee: 0, tax: 0, postRefund: 0, ad: 0, net: 0 });
      db.gmv += gmv;
      if (!refunded) {
        var oc = orderContrib(o, taxRate, set);
        db.validGmv += oc.validGmv;
        db.cost += oc.cost; db.freight += oc.freight; db.ins += oc.ins;
        db.platformFee += oc.platformFee; db.talentFee += oc.talentFee;
        db.tax += oc.tax; db.postRefund += oc.postRefund;
      }
    }

    /* 推广消耗：区间内花了钱但没出单的链接也要进来，否则这笔亏损会凭空消失
       单店视图下只进该店的商品，避免别店的链接和花费漏进来。
       优先级：商品经营数据（可拆 自卖/达人）> 旧全域/乘方按天表 > 「全部」兜底 */
    var adIndex = S.adIndex || {};
    var adAll = S.adAll || {};
    var pidShop = S.pidShop || {};
    var adPidSet = {};
    var kk;
    for (kk in (S.adPids || {})) adPidSet[kk] = 1;
    for (kk in (S.adBucket || {})) adPidSet[kk] = 1;
    var adPidList = Object.keys(adPidSet);
    var bucketModeCount = 0;

    /* 筛选了具体达人时：如果这个达人在「达人消耗表」里有数据，就用它的真实消耗
       （商品经营数据/旧推广表都给不出单个达人的消耗）；如果表里没有（典型是店铺
       自己的自卖账号），说明它是自卖流量，仍然走经营数据的桶口径。 */
    var talentFilter = f.talent && f.talent !== '__ALL__' ? f.talent : '';
    var talentInfo = talentFilter ? talentSpendInRange(talentFilter, range) : null;
    var useTalentAd = !!(talentInfo && talentInfo.known);
    /* 不在达人消耗表里 → 看订单的流量来源：以小店自卖为主就是店铺自己的账号 */
    var talentIsSelf = !!(talentFilter && !useTalentAd && talentSrc.self >= talentSrc.union && talentSrc.self > 0);
    var talentNoAd = !!(talentFilter && !useTalentAd && !talentIsSelf);

    for (var ai = 0; ai < adPidList.length && !useTalentAd && !talentNoAd; ai++) {
      var apid = adPidList[ai];
      if (shop !== '__ALL__' && pidShop[apid] !== shop) continue;

      var spend = 0, splitSelf = 0, splitTalent = 0, mode = '', dailyMap = null, hitDay = 0;
      var bk = bucketSpend(apid, f, talentIsSelf ? '自卖' : null);

      if (bk) {
        /* 有商品经营数据 → 用它，可按 载体/自卖合作 精确拆；不再叠加旧推广表 */
        var al = allocateByDay(apid, bk.total, range, pidDayValid);
        if (al.spend > 0) {
          spend = al.spend;
          splitSelf = bk.self > 0 ? allocateByDay(apid, bk.self, range, pidDayValid).spend : 0;
          splitTalent = bk.talent > 0 ? allocateByDay(apid, bk.talent, range, pidDayValid).spend : 0;
          dailyMap = al.daily;
          mode = 'bucket:' + al.mode;
        }
      } else {
        /* 没有经营数据的老店铺 → 回退旧全域/乘方按天表 */
        var aa = adSpendFor(apid, range, adIndex, adAll);
        if (aa.spend > 0) { spend = aa.spend; mode = 'legacy'; hitDay = aa.hitDay; }
      }

      if (spend <= 0) continue;

      var aL = linkMap[apid];
      if (!aL) {
        aL = linkMap[apid] = emptyLink(apid);
        aL.pname = (S.pidName && S.pidName[apid]) || (S.adNames && S.adNames[apid]) || apid;
        aL.link = 'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=' + apid;
        aL.adOnly = true;
      }
      aL.ad = spend;
      aL.adSelf = splitSelf;
      aL.adTalent = splitTalent;
      aL.adMode = mode;
      aL.adHitDay = hitDay;

      /* 把这笔推广按天拆进每日盈亏累计里 */
      if (dailyMap) {
        for (var dk in dailyMap) {
          if (daily[dk]) daily[dk].ad += dailyMap[dk];
        }
      } else {
        var days = U.eachDay(range.start, range.end);
        for (var di = 0; di < days.length; di++) {
          var dv = U.num(adIndex[apid + '|' + days[di]]);
          if (dv > 0 && daily[days[di]]) daily[days[di]].ad += dv;
        }
      }
    }

    /* 达人筛选：把该达人的真实投放消耗按各链接的有效GMV占比分摊到链接 */
    if (useTalentAd) {
      var ts = talentInfo;
      var sumValid = 0, pk;
      for (pk in linkMap) sumValid += linkMap[pk].validGmv;
      if (ts.spend > 0 && sumValid > 0) {
        for (pk in linkMap) {
          var lk0 = linkMap[pk];
          lk0.ad = ts.spend * lk0.validGmv / sumValid;
          lk0.adTalent = lk0.ad;     // 达人消耗全部计入「达人」列
          lk0.adSelf = 0;
          lk0.adMode = 'talent';
        }
      }
      for (var tdk in ts.daily) {
        if (daily[tdk]) daily[tdk].ad += ts.daily[tdk];
      }
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
      totals.adSelf += L2.adSelf; totals.adTalent += L2.adTalent;
      totals.talentFee += L2.talentFee; totals.tax += L2.tax;
      totals.postRefund += L2.postRefund;
      totals.gross += L2.gross; totals.net += L2.net;
      totals.missingCost += L2.missingCost;
    }
    finalizeTotals(totals, taxRate);

    var warns = [];
    /* 有商品经营数据时是全周期汇总口径，不存在「缺天」的问题 */
    var hasBucketData = !!(S.adBucket && Object.keys(S.adBucket).length);
    var miss = hasBucketData ? [] : adCoverage(range, S.adDates || {});
    if (miss.length) {
      warns.push('推广数据缺少 ' + miss.length + ' 天（' + miss[0] + (miss.length > 1 ? ' 等' : '') + '），这些天的广告消耗按 0 计，ROI 会偏高。');
    }
    if (talentNoAd) {
      warns.push('达人「' + talentFilter + '」在达人消耗表里没有记录，且订单来源不是小店自卖，其投流按 0 计（视为自然流量）。');
    } else if (talentIsSelf) {
      warns.push('「' + talentFilter + '」不在达人消耗表里、订单主要来自小店自卖，已按「自卖」桶计投流。');
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

    /* 每日盈亏数组（按日期排序，用于顶部每日盈亏图） */
    var dailyArr = Object.keys(daily).sort().map(function (d) {
      var x = daily[d];
      x.date = d;
      x.net = x.validGmv - x.cost - x.freight - x.ins - x.platformFee - x.talentFee - x.tax - x.postRefund - x.ad;
      return x;
    });

    return { totals: totals, links: linkList, warns: warns, skuMap: skuMap, daily: dailyArr };
  }

  function finalizeLink(lk, taxRate) {
    finalizeSkuFee(lk, taxRate);

    /* SKU 级：广告按有效GMV占比分摊 */
    var keys = Object.keys(lk.skus);
    for (var i = 0; i < keys.length; i++) {
      var K = lk.skus[keys[i]];
      var share = lk.validGmv > 0 ? K.validGmv / lk.validGmv : 0;
      K.ad = lk.ad * share;
      K.adSelf = lk.adSelf * share;
      K.adTalent = lk.adTalent * share;

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
