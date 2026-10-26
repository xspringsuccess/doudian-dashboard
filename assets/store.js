/* 全局状态与持久化 */
(function (global) {
  'use strict';

  var DB_NAME = 'dp_profit_v1';
  var STORE = 'kv';
  var db = null;

  function openDB() {
    return new Promise(function (res) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = function (e) { res(e.target.result); };
      req.onerror = function () { res(null); };
    });
  }

  function idbGet(key) {
    return new Promise(function (res) {
      if (!db) return res(null);
      try {
        var tx = db.transaction(STORE, 'readonly');
        var r = tx.objectStore(STORE).get(key);
        r.onsuccess = function () { res(r.result || null); };
        r.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }

  function idbSet(key, val) {
    return new Promise(function (res) {
      if (!db) return res(false);
      try {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      } catch (e) { res(false); }
    });
  }

  function idbDel(key) {
    return new Promise(function (res) {
      if (!db) return res(false);
      try {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      } catch (e) { res(false); }
    });
  }

  var DEFAULT_SETTINGS = {
    taxRate: 0,
    platformRate: 5,
    talentRate: 20,
    freight: 3,
    freightIns: 0.5,
    excludeCancelled: true,
    talentUnionOnly: true,
    includePendingRefund: false,
    adFallback: false,
    postRefundRate: 0
  };

  var S = {
    tab: 'overview',
    shop: '__ALL__',
    shops: [],
    range: { start: U.todayStr(), end: U.todayStr() },
    filter: { format: '__ALL__', talent: '__ALL__', source: '__ALL__' }, // 吸顶维度筛选（流量体裁/达人/流量来源），不持久化
    settings: Object.assign({}, DEFAULT_SETTINGS),

    orders: [],            // {shop, pid, skuCode, spec, pname, qty, price, pay, platDisc, date, status, after, shipAt, traffic, trafficFormat, talentName}
    skus: [],              // {pid, pname, skuId, skuCode, spec, price, link}
    adIndex: {},           // pid|date -> spend
    adAll: {},             // pid -> 「全部」行消耗
    adNames: {},           // pid -> 推广表里的商品名
    pidName: {},           // pid -> 商品名
    pidShop: {},           // pid -> 所属店铺（决定单店视图里出现哪些链接）
    adPids: {},            // pid -> 1
    adDates: {},           // date -> 1
    orderDates: {},        // date -> 1
    params: {},            // pid|skuKey -> {cost,freight,ins,pr,tr}
    linkParams: {},        // pid -> {postRefund: 率} null 表示用全局
    files: [],             // 已导入文件登记
    fileHashes: {},        // 文件指纹，防重复上传

    ready: false,
    ordersStale: false,     // 存在旧格式订单（缺 trafficFormat/talentName/platDisc），需要重新导入
    ordersStaleN: 0         // 旧格式订单行数
  };

  /* 老版本导入的订单没有「流量体裁 / 达人昵称 / 平台承担优惠」三个字段，
     出现这种情况要明确告诉用户去重导，否则筛选器只会显示「全部」。 */
  function checkOrdersSchema() {
    var bad = 0;
    for (var i = 0; i < S.orders.length; i++) {
      var o = S.orders[i];
      if (!('trafficFormat' in o) || !('talentName' in o) || !('platDisc' in o)) bad++;
    }
    S.ordersStaleN = bad;
    S.ordersStale = bad > 0;
    return S.ordersStale;
  }

  /* ---------- 参数读写 ---------- */
  function skuKeyOf(sku) {
    var c = U.code(sku.skuCode);
    if (c) return c;
    if (sku.skuId) return 'skuid:' + sku.skuId;
    return 'spec:' + (U.normSpec(sku.spec) || U.clean(sku.spec));
  }

  function paramKey(pid, skuKey) { return pid + '|' + skuKey; }

  function getParam(pid, skuKey) {
    var k = paramKey(pid, skuKey);
    var p = S.params[k];
    if (p) return p;
    p = {
      cost: 0,
      freight: S.settings.freight,
      ins: S.settings.freightIns,
      pr: S.settings.platformRate,
      tr: S.settings.talentRate
    };
    S.params[k] = p;
    return p;
  }

  function setParam(pid, skuKey, field, val) {
    var p = getParam(pid, skuKey);
    p[field] = U.num(val);
    p.dirty = 1;                     // 用户单独改过，之后不再被全局默认值覆盖
    saveParams();
  }

  /* ---------- 链接级参数：预估发货后退款率 ---------- */
  function getLinkParam(pid) {
    var lp = S.linkParams[pid];
    if (!lp) lp = S.linkParams[pid] = { postRefund: null };
    return lp;
  }

  function setLinkParam(pid, field, val) {
    var lp = getLinkParam(pid);
    lp[field] = (val === null || val === '' || val === undefined) ? null : U.num(val);
    saveParams();
  }

  /* 单链接优先，没单独设置就用全局 */
  function linkPostRefundRate(pid) {
    var lp = S.linkParams[pid];
    if (lp && lp.postRefund !== null && lp.postRefund !== undefined) return U.num(lp.postRefund);
    return U.num(S.settings.postRefundRate);
  }

  /* 改全局值时把所有链接的单独设置清掉，让它们无条件跟随新的全局值 */
  function resetLinkPostRefund() {
    var n = 0;
    for (var pid in S.linkParams) {
      if (S.linkParams[pid].postRefund !== null) { S.linkParams[pid].postRefund = null; n++; }
    }
    if (n) saveParams();
    return n;
  }

  /* 现在有多少条链接是单独设置过的 */
  function countLinkOverride() {
    var n = 0;
    for (var pid in S.linkParams) if (S.linkParams[pid].postRefund !== null) n++;
    return n;
  }

  /* 把设置里的默认值同步到 SKU 参数表。
     只覆盖用户没有单独改过的，避免冲掉手工调过的成本。 */
  function applyDefaults() {
    var updated = 0, kept = 0;
    for (var k in S.params) {
      var p = S.params[k];
      if (p.dirty) { kept++; continue; }
      p.freight = U.num(S.settings.freight);
      p.ins = U.num(S.settings.freightIns);
      p.pr = U.num(S.settings.platformRate);
      p.tr = U.num(S.settings.talentRate);
      updated++;
    }
    return { updated: updated, kept: kept };
  }

  /* ---------- 持久化 ---------- */
  var saveTimer = null;
  function saveParams() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      idbSet('params', S.params);
      idbSet('settings', S.settings);
      idbSet('files', S.files);
      idbSet('fileHashes', S.fileHashes);
      idbSet('linkParams', S.linkParams);
    }, 400);
  }

  function saveCore() {
    idbSet('orders', S.orders);
    idbSet('skus', S.skus);
    idbSet('adIndex', S.adIndex);
    idbSet('adAll', S.adAll);
    idbSet('adNames', S.adNames);
    idbSet('pidName', S.pidName);
    idbSet('pidShop', S.pidShop);
    idbSet('adPids', S.adPids);
    idbSet('adDates', S.adDates);
    idbSet('orderDates', S.orderDates);
    idbSet('shops', S.shops);
    idbSet('files', S.files);
    idbSet('fileHashes', S.fileHashes);
    idbSet('linkParams', S.linkParams);
    idbSet('params', S.params);
    idbSet('settings', S.settings);
  }

  function clearAll() {
    ['orders', 'skus', 'adIndex', 'adAll', 'adNames', 'pidName', 'adPids', 'adDates', 'orderDates', 'shops', 'files', 'fileHashes', 'linkParams', 'params'].forEach(idbDel);
    S.orders = []; S.skus = []; S.adIndex = {}; S.adAll = {}; S.adNames = {}; S.pidName = {}; S.adPids = {}; S.adDates = {};
    S.orderDates = {}; S.params = {}; S.shops = []; S.files = []; S.fileHashes = {}; S.linkParams = {}; S.shop = '__ALL__';
  }

  async function load() {
    db = await openDB();
    var [orders, skus, adIndex, adAll, adNames, pidName, pidShop, adPids, adDates, orderDates, shops, files, fileHashes, linkParams, params, settings] =
      await Promise.all([
        idbGet('orders'), idbGet('skus'), idbGet('adIndex'), idbGet('adAll'),
        idbGet('adNames'), idbGet('pidName'), idbGet('pidShop'), idbGet('adPids'), idbGet('adDates'),
        idbGet('orderDates'), idbGet('shops'),
        idbGet('files'), idbGet('fileHashes'), idbGet('linkParams'), idbGet('params'), idbGet('settings')
      ]);
    if (orders) S.orders = orders;
    if (skus) S.skus = skus;
    if (adIndex) S.adIndex = adIndex;
    if (adAll) S.adAll = adAll;
    if (adNames) S.adNames = adNames;
    if (pidName) S.pidName = pidName;
    if (pidShop) S.pidShop = pidShop;
    if (adPids) S.adPids = adPids;
    if (adDates) S.adDates = adDates;
    if (orderDates) S.orderDates = orderDates;
    if (shops) S.shops = shops;
    if (files) S.files = files;
    if (fileHashes) S.fileHashes = fileHashes;
    if (linkParams) S.linkParams = linkParams;
    if (params) S.params = params;
    if (settings) S.settings = Object.assign({}, DEFAULT_SETTINGS, settings);
    checkOrdersSchema();
    S.ready = true;
  }

  global.STORE = {
    S: S,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    load: load,
    checkOrdersSchema: checkOrdersSchema,
    saveCore: saveCore,
    saveParams: saveParams,
    clearAll: clearAll,
    skuKeyOf: skuKeyOf,
    paramKey: paramKey,
    getParam: getParam,
    setParam: setParam,
    applyDefaults: applyDefaults,
    getLinkParam: getLinkParam,
    setLinkParam: setLinkParam,
    linkPostRefundRate: linkPostRefundRate,
    resetLinkPostRefund: resetLinkPostRefund,
    countLinkOverride: countLinkOverride
  };
})(window);
