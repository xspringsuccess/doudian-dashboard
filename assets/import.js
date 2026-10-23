/* 文件导入与解析 */
(function (global) {
  'use strict';

  var S = STORE.S;

  function normHdr(h) { return U.clean(h); }

  function sheetToRows(sheet) {
    var aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    var rows = [];
    for (var i = 0; i < aoa.length; i++) {
      var r = aoa[i];
      if (!r || !r.length) continue;
      var out = [];
      var empty = true;
      for (var j = 0; j < r.length; j++) {
        var v = U.clean(r[j]);
        if (v !== '') empty = false;
        out[j] = v;
      }
      if (!empty) rows.push(out);
    }
    return rows;
  }

  function findCol(hdr, names) {
    for (var n = 0; n < names.length; n++) {
      for (var i = 0; i < hdr.length; i++) {
        if (hdr[i] === names[n]) return i;
      }
    }
    for (var n2 = 0; n2 < names.length; n2++) {
      for (var i2 = 0; i2 < hdr.length; i2++) {
        if (hdr[i2].indexOf(names[n2]) >= 0) return i2;
      }
    }
    return -1;
  }

  /* 文件指纹：同一份文件重复上传时直接跳过，避免数据翻倍 */
  function fingerprint(rows) {
    var h = 5381;
    var n = Math.min(rows.length, 4000);
    for (var i = 0; i < n; i++) {
      var r = rows[i];
      var m = Math.min(r.length, 30);
      for (var j = 0; j < m; j++) {
        var v = String(r[j]);
        h = ((h * 33) ^ (v.length || 0)) & 0x7fffffff;
        if (v) {
          h = ((h * 33) ^ (v.charCodeAt(0) || 0)) & 0x7fffffff;
          h = ((h * 33) ^ (v.charCodeAt(v.length - 1) || 0)) & 0x7fffffff;
        }
      }
      h = ((h * 33) ^ r.length) & 0x7fffffff;
    }
    return h + ':' + rows.length;
  }

  function readAny(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onerror = function () { rej(new Error('读取失败')); };
      fr.onload = function (e) {
        try {
          var buf = e.target.result;
          var wb = XLSX.read(buf, { type: 'array', cellDates: false });
          var name = wb.SheetNames[0];
          res(sheetToRows(wb.Sheets[name]));
        } catch (err) { rej(err); }
      };
      fr.readAsArrayBuffer(file);
    });
  }

  /* ---------------- 类型识别 ---------------- */
  function detect(rows) {
    if (!rows.length) return 'unknown';
    var hdr = rows[0];
    for (var i = 0; i < hdr.length; i++) hdr[i] = normHdr(hdr[i]);
    var joined = hdr.join('|');
    if (joined.indexOf('主订单编号') >= 0 || joined.indexOf('订单提交时间') >= 0) return 'orders';
    if (joined.indexOf('商品成本') >= 0) return 'params';
    if (joined.indexOf('整体消耗') >= 0 && joined.indexOf('日期') >= 0) return 'ad';
    if (joined.indexOf('规格ID') >= 0 || joined.indexOf('商家SKU编码') >= 0) return 'products';
    return 'unknown';
  }

  /* ---------------- 解析 ---------------- */
  function parseOrders(rows, shop) {
    var hdr = rows[0];
    var c = {
      oid: findCol(hdr, ['主订单编号']),
      pid: findCol(hdr, ['商品ID']),
      skuCode: findCol(hdr, ['商家编码']),
      spec: findCol(hdr, ['商品规格']),
      pname: findCol(hdr, ['选购商品', '商品名称']),
      qty: findCol(hdr, ['商品数量']),
      price: findCol(hdr, ['商品单价']),
      pay: findCol(hdr, ['订单应付金额']),
      submit: findCol(hdr, ['订单提交时间']),
      status: findCol(hdr, ['订单状态']),
      after: findCol(hdr, ['售后状态']),
      ship: findCol(hdr, ['发货时间']),
      traffic: findCol(hdr, ['流量来源'])
    };
    if (c.pid < 0 || c.submit < 0) return { err: '缺少 商品ID 或 订单提交时间 列' };

    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var g = function (k) { return c[k] >= 0 ? (r[c[k]] || '') : ''; };
      var pid = g('pid');
      if (!pid || pid === '-') continue;
      var d = U.toDate(g('submit'));
      if (!d) continue;
      var skuCode = U.code(g('skuCode'));
      var spec = g('spec');
      var o = {
        shop: shop,
        oid: g('oid'),
        pid: pid,
        skuCode: skuCode,
        skuKey: skuCode || ('spec:' + (U.normSpec(spec) || spec)),
        spec: spec,
        pname: g('pname'),
        qty: U.num(g('qty')),
        price: U.num(g('price')),
        pay: U.num(g('pay')),
        date: d,
        status: g('status'),
        after: g('after') || '-',
        shipAt: g('ship'),
        traffic: g('traffic')
      };
      if (o.qty === 0 && o.pay === 0) continue;
      out.push(o);
    }
    return { rows: out };
  }

  function parseProducts(rows, shop) {
    var hdr = rows[0];
    var c = {
      pid: findCol(hdr, ['商品ID']),
      pname: findCol(hdr, ['商品名称']),
      skuId: findCol(hdr, ['规格ID']),
      skuCode: findCol(hdr, ['商家SKU编码']),
      spec: findCol(hdr, ['商品规格']),
      price: findCol(hdr, ['商品价格']),
      link: findCol(hdr, ['商品链接'])
    };
    if (c.pid < 0) return { err: '缺少 商品ID 列' };
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var g = function (k) { return c[k] >= 0 ? (r[c[k]] || '') : ''; };
      var pid = g('pid');
      if (!pid) continue;
      out.push({
        pid: pid,
        pname: g('pname'),
        skuId: g('skuId'),
        skuCode: U.code(g('skuCode')),
        spec: g('spec'),
        price: U.num(g('price')),
        link: g('link'),
        shop: shop || ''
      });
    }
    return { rows: out };
  }

  function keyOnly(s) {
    var c = U.code(s.skuCode);
    if (c) return c;
    if (s.skuId) return 'skuid:' + s.skuId;
    return 'spec:' + (U.normSpec(s.spec) || U.clean(s.spec));
  }

  function prodKey(s) { return s.pid + '|' + keyOnly(s); }

  function parseAd(rows, shop) {
    var hdr = rows[0];
    var c = {
      pid: findCol(hdr, ['商品ID']),
      pname: findCol(hdr, ['商品名称']),
      date: findCol(hdr, ['日期']),
      spend: findCol(hdr, ['整体消耗'])
    };
    if (c.pid < 0 || c.spend < 0) return { err: '缺少 商品ID 或 整体消耗 列' };
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var g = function (k) { return c[k] >= 0 ? (r[c[k]] || '') : ''; };
      var pid = g('pid');
      if (!pid) continue;
      var raw = U.clean(g('date'));
      var d = raw === '全部' ? '全部' : U.toDate(raw);
      if (!d) continue;
      out.push({ pid: pid, pname: g('pname'), date: d, spend: U.num(g('spend')), shop: shop || '' });
    }
    return { rows: out };
  }

  function parseParams(rows) {
    var hdr = rows[0];
    var c = {
      pid: findCol(hdr, ['商品ID']),
      skuCode: findCol(hdr, ['SKU编码', '商家编码', '商家SKU编码']),
      cost: findCol(hdr, ['商品成本']),
      freight: findCol(hdr, ['运费成本', '单件运费', '运费']),
      ins: findCol(hdr, ['运费险']),
      pr: findCol(hdr, ['平台扣点']),
      tr: findCol(hdr, ['达人佣金'])
    };
    if (c.pid < 0 || c.skuCode < 0) return { err: '缺少 商品ID 或 SKU编码 列' };
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var g = function (k) { return c[k] >= 0 ? (r[c[k]] || '') : ''; };
      var o = {
        pid: g('pid'), skuCode: g('skuCode'),
        cost: U.num(g('cost')), freight: U.num(g('freight')),
        ins: U.num(g('ins')), pr: U.pctNum(g('pr')), tr: U.pctNum(g('tr'))
      };
      if (!o.pid || !o.skuCode) continue;
      out.push(o);
    }
    return { rows: out };
  }

  /* ---------------- 合并 ---------------- */
  function mergeOrders(list, shop, fid) {
    for (var i = 0; i < list.length; i++) {
      list[i].fid = fid;
      S.orders.push(list[i]);
    }
    if (S.shops.indexOf(shop) < 0) S.shops.push(shop);
  }

  function mergeProducts(list, fid) {
    var idx = {};
    var pids = {};
    for (var i = 0; i < S.skus.length; i++) idx[prodKey(S.skus[i])] = i;
    for (var j = 0; j < list.length; j++) {
      var s = list[j];
      var k = prodKey(s);
      pids[s.pid] = 1;
      if (k in idx) {
        var t = S.skus[idx[k]];
        if (s.skuId) t.skuId = s.skuId;
        if (s.price) t.price = s.price;
        if (s.link) t.link = s.link;
        if (s.pname) t.pname = s.pname;
      } else {
        s.fid = fid;
        idx[k] = S.skus.length;
        S.skus.push(s);
      }
    }
    return Object.keys(pids);
  }

  /* 返回本次文件对推广数据的增量，供单独删除时精确回滚 */
  function mergeAd(list) {
    var delta = {};
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      S.adPids[a.pid] = 1;
      if (a.date === '全部') {
        S.adAll[a.pid] = (S.adAll[a.pid] || 0) + a.spend;
        delta['ALL|' + a.pid] = (delta['ALL|' + a.pid] || 0) + a.spend;
        continue;
      }
      if (!a.date) continue;
      var k = a.pid + '|' + a.date;
      S.adIndex[k] = (S.adIndex[k] || 0) + a.spend;
      S.adDates[a.date] = 1;
      delta[k] = (delta[k] || 0) + a.spend;
    }
    return delta;
  }

  function mergeParams(list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      var p = STORE.getParam(o.pid, o.skuCode);
      p.cost = o.cost;
      p.freight = o.freight;
      p.ins = o.ins;
      if (o.pr) p.pr = o.pr;
      if (o.tr) p.tr = o.tr;
      p.dirty = 1;              // 模板导入的视为单独设置，不被全局默认值覆盖
      n++;
    }
    return n;
  }

  /* 从文件清单重算所有派生数据：删掉任一文件后调用即可，不留残渣 */
  function rebuildDerived() {
    var newPidShop = {};
    var newOrderDates = {};
    var newAdDates = {};
    var newShops = [];

    /* 1) 推广表（归属最低优先级） */
    for (var a = 0; a < S.files.length; a++) {
      var fa = S.files[a];
      if (fa.type !== 'ad' || !fa.shop) continue;
      var pidsA = fa.pids || [];
      for (var pa = 0; pa < pidsA.length; pa++) {
        if (!newPidShop[pidsA[pa]]) newPidShop[pidsA[pa]] = fa.shop;
      }
    }
    /* 2) 商品表 */
    for (var b = 0; b < S.files.length; b++) {
      var fb = S.files[b];
      if (fb.type !== 'products' || !fb.shop) continue;
      var pidsB = fb.pids || [];
      for (var pb = 0; pb < pidsB.length; pb++) {
        if (!newPidShop[pidsB[pb]]) newPidShop[pidsB[pb]] = fb.shop;
      }
    }
    /* 3) 订单（最可靠，直接覆盖） */
    for (var c = 0; c < S.orders.length; c++) {
      var o = S.orders[c];
      newPidShop[o.pid] = o.shop;
      newOrderDates[o.date] = 1;
      if (newShops.indexOf(o.shop) < 0) newShops.push(o.shop);
    }
    /* 3.5) 商品表/推广表标过店铺的，即使暂时没订单也要能单独查看 */
    for (var s = 0; s < S.files.length; s++) {
      if (!S.files[s].shop) continue;
      if (newShops.indexOf(S.files[s].shop) < 0) newShops.push(S.files[s].shop);
    }
    /* 4) 推广日期 */
    for (var k in S.adIndex) {
      var d = k.split('|')[1];
      if (d) newAdDates[d] = 1;
    }

    S.pidShop = newPidShop;
    S.orderDates = newOrderDates;
    S.adDates = newAdDates;
    S.shops = newShops;
    if (S.shops.indexOf(S.shop) < 0) S.shop = '__ALL__';
  }

  /* 单独删除某份已导入文件，精确回滚它的全部贡献 */
  function removeFile(id) {
    var target = null;
    var rest = [];
    for (var i = 0; i < S.files.length; i++) {
      if (S.files[i].id === id) target = S.files[i];
      else rest.push(S.files[i]);
    }
    if (!target) return null;

    var removed = { orders: 0, skus: 0, ad: 0 };

    if (target.type === 'orders') {
      var keep = [];
      for (var j = 0; j < S.orders.length; j++) {
        if (S.orders[j].fid === id) removed.orders++;
        else keep.push(S.orders[j]);
      }
      S.orders = keep;
    }

    if (target.type === 'products') {
      var keepS = [];
      for (var m = 0; m < S.skus.length; m++) {
        if (S.skus[m].fid === id) removed.skus++;
        else keepS.push(S.skus[m]);
      }
      S.skus = keepS;
    }

    if (target.type === 'ad' && target.adDelta) {
      for (var k in target.adDelta) {
        var v = target.adDelta[k];
        removed.ad++;
        if (k.slice(0, 4) === 'ALL|') {
          var ap = k.slice(4);
          S.adAll[ap] = (S.adAll[ap] || 0) - v;
          if (S.adAll[ap] <= 0.000001) delete S.adAll[ap];
        } else {
          S.adIndex[k] = (S.adIndex[k] || 0) - v;
          if (S.adIndex[k] <= 0.000001) delete S.adIndex[k];
        }
      }
      /* 该推广表独有的商品ID 一并移除 */
      var tp = target.pids || [];
      for (var q = 0; q < tp.length; q++) {
        var pid = tp[q];
        var still = false;
        for (var kk in S.adIndex) { if (kk.split('|')[0] === pid) { still = true; break; } }
        if (!still && !S.adAll[pid]) delete S.adPids[pid];
      }
    }

    /* 允许重新导入同一份文件 */
    if (target.hash) delete S.fileHashes[target.hash];

    S.files = rest;
    relink();
    rebuildDerived();
    return removed;
  }

  /* 订单与商品表关联，补齐链接/售价/名称 */
  function relink() {
    var map = {};
    var specIdx = {};
    for (var i = 0; i < S.skus.length; i++) {
      var s = S.skus[i];
      map[s.pid + '|' + keyOnly(s)] = s;
      var ns = U.normSpec(s.spec);
      if (ns) specIdx[s.pid + '|' + ns] = s;
      if (s.pname && !S.pidName[s.pid]) S.pidName[s.pid] = s.pname;
    }
    var seen = {};
    for (var j = 0; j < S.orders.length; j++) {
      var o = S.orders[j];
      var k = o.pid + '|' + o.skuKey;
      var m = map[k];
      if (!m) {
        /* 退回按规格文本匹配（商品表编码为 0 或缺失时） */
        m = specIdx[o.pid + '|' + U.normSpec(o.spec)];
      }
      if (m) {
        if (m.link) o.link = m.link;
        if (!o.price) o.price = m.price;
        if (!m.price && o.price) m.price = o.price;
        if (!o.pname) o.pname = m.pname;
        if (!m.pname && o.pname) m.pname = o.pname;
        o.skuKey = keyOnly(m);
      } else if (!seen[k]) {
        seen[k] = 1;
        var vx = {
          pid: o.pid, pname: o.pname, skuId: '', skuCode: o.skuCode,
          spec: o.spec, price: o.price, link: ''
        };
        map[k] = vx;
        S.skus.push(vx);
      }
      if (o.pname && !S.pidName[o.pid]) S.pidName[o.pid] = o.pname;
      o.link = m && m.link ? m.link : o.link || ('https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=' + o.pid);
    }
    for (var q = 0; q < S.skus.length; q++) {
      S.skus[q].link = S.skus[q].link ||
        'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=' + S.skus[q].pid;
    }
  }

  /* ---------------- 对外 ---------------- */
  function baseName(f) {
    var n = f.replace(/\.(csv|xlsx|xls)$/i, '');
    n = n.replace(/_\d{4}-\d{2}-\d{2}[^_]*$/, '').replace(/[_-]\d{10,}$/, '');
    return n.trim() || '未命名店铺';
  }

  function sniff(files) {
    return Promise.all(Array.prototype.map.call(files, function (f) {
      return readAny(f).then(function (rows) {
        return { file: f, rows: rows, type: detect(rows) };
      }).catch(function (e) {
        return { file: f, rows: [], type: 'unknown', err: e.message };
      });
    }));
  }

  function ingest(items, shopOf) {
    var msgs = [];
    if (!S.fileHashes) S.fileHashes = {};
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var name = it.file.name;
      if (it.type === 'unknown') { msgs.push(name + '：无法识别，已跳过'); continue; }

      var fp = fingerprint(it.rows);
      if (S.fileHashes[fp]) {
        msgs.push(name + '：内容与已导入文件相同，已跳过（避免重复计入）');
        continue;
      }
      S.fileHashes[fp] = 1;
      var fid = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      var rec = { id: fid, name: name, type: it.type, shop: '', at: Date.now(), hash: fp, n: 0 };

      if (it.type === 'orders') {
        var shop = (shopOf && shopOf[name]) || baseName(name);
        var r1 = parseOrders(it.rows, shop);
        if (r1.err) { msgs.push(name + '：' + r1.err); continue; }
        mergeOrders(r1.rows, shop, fid);
        rec.shop = shop;
        rec.n = r1.rows.length;
        msgs.push(name + '：订单 ' + r1.rows.length + ' 行（店铺「' + shop + '」）');
      } else if (it.type === 'products') {
        var pshop = (shopOf && shopOf[name]) || '';
        var r2 = parseProducts(it.rows, pshop);
        if (r2.err) { msgs.push(name + '：' + r2.err); continue; }
        rec.pids = mergeProducts(r2.rows, fid);
        rec.shop = pshop;
        rec.n = r2.rows.length;
        msgs.push(name + '：商品 ' + r2.rows.length + ' 个 SKU' + (pshop ? '（归属「' + pshop + '」）' : ''));
      } else if (it.type === 'ad') {
        var ashop = (shopOf && shopOf[name]) || '';
        var r3 = parseAd(it.rows, ashop);
        if (r3.err) { msgs.push(name + '：' + r3.err); continue; }
        var dt = mergeAd(r3.rows);
        rec.adDelta = dt;
        rec.pids = adPidsFromDelta(dt);
        rec.shop = ashop;
        rec.n = r3.rows.length;
        msgs.push(name + '：推广 ' + r3.rows.length + ' 行' + (ashop ? '（归属「' + ashop + '」）' : ''));
      } else if (it.type === 'params') {
        var r4 = parseParams(it.rows);
        if (r4.err) { msgs.push(name + '：' + r4.err); continue; }
        var n = mergeParams(r4.rows);
        rec.n = n;
        msgs.push(name + '：SKU 参数 ' + n + ' 条');
      }
      S.files.push(rec);
    }
    relink();
    rebuildDerived();
    return msgs;
  }

  function adPidsFromDelta(delta) {
    var set = {};
    for (var k in delta) {
      var part = k.split('|');
      set[part[0] === 'ALL' ? part[1] : part[0]] = 1;
    }
    return Object.keys(set);
  }

  global.IMP = {
    sniff: sniff,
    ingest: ingest,
    baseName: baseName,
    readAny: readAny,
    removeFile: removeFile,
    rebuildDerived: rebuildDerived
  };
})(window);
