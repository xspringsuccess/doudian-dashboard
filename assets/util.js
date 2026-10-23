/* 通用工具 */
(function (global) {
  'use strict';

  var U = {};

  U.pad = function (n) { return n < 10 ? '0' + n : '' + n; };

  U.todayStr = function () {
    var d = new Date();
    return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate());
  };

  U.dateStr = function (d) {
    return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate());
  };

  U.parseDate = function (s) {
    if (!s) return null;
    var m = String(s).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  };

  U.addDays = function (s, n) {
    var d = U.parseDate(s) || new Date();
    d.setDate(d.getDate() + n);
    return U.dateStr(d);
  };

  U.daysBetween = function (a, b) {
    var d1 = U.parseDate(a), d2 = U.parseDate(b);
    if (!d1 || !d2) return 0;
    return Math.round((d2 - d1) / 86400000);
  };

  U.eachDay = function (a, b) {
    var out = [], d = U.parseDate(a), e = U.parseDate(b);
    if (!d || !e) return out;
    while (d <= e && out.length < 400) {
      out.push(U.dateStr(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  };

  /* 兼容 2026-10-23 / 2026-10-23 22:45:45 / 10/23/26 / 10/23/2026 / Excel 序列 */
  U.toDate = function (v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    var m = s.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return m[1] + '-' + U.pad(+m[2]) + '-' + U.pad(+m[3]);
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
    if (m) {
      var y = m[3];
      if (y.length === 2) y = (+y >= 70 ? '19' : '20') + y;
      return y + '-' + U.pad(+m[1]) + '-' + U.pad(+m[2]);
    }
    if (/^\d{5}(\.\d+)?$/.test(s)) {
      var n = parseFloat(s);
      var d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return d.getUTCFullYear() + '-' + U.pad(d.getUTCMonth() + 1) + '-' + U.pad(d.getUTCDate());
    }
    return '';
  };

  U.num = function (v) {
    if (v === null || v === undefined) return 0;
    var t = String(v).replace(/[,¥\s]/g, '');
    if (t === '' || t === '-') return 0;
    var n = parseFloat(t);
    return isNaN(n) ? 0 : n;
  };

  U.pctNum = function (v) {
    var t = String(v == null ? '' : v).replace(/%/g, '').replace(/[,¥\s]/g, '');
    if (t === '' || t === '-') return 0;
    var n = parseFloat(t);
    return isNaN(n) ? 0 : n;
  };

  U.clean = function (v) {
    return String(v == null ? '' : v).replace(/\t/g, '').trim();
  };

  /* 商家编码为 0 / 00 / - 时视为缺失 */
  U.code = function (v) {
    var s = U.clean(v);
    if (!s || s === '-' || /^0+$/.test(s)) return '';
    return s;
  };

  /* 规格文本归一化：{颜色:红, 尺寸:50x80cm} -> 红|50x80cm */
  U.normSpec = function (v) {
    var s = U.clean(v).replace(/[{}]/g, '');
    var parts = s.split(/[;,，、]/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var at = p.indexOf(':');
      var at2 = p.indexOf('：');
      var at3 = (at >= 0 && at2 >= 0) ? Math.min(at, at2) : (at >= 0 ? at : at2);
      if (at3 >= 0) p = p.slice(at3 + 1);
      p = p.replace(/\s/g, '');
      if (p) out.push(p);
    }
    out.sort();
    return out.join('|');
  };

  U.money = function (v) {
    var n = U.num(v);
    var neg = n < 0;
    var s = Math.abs(n).toFixed(2);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + parts.join('.');
  };

  U.money0 = function (v) {
    var n = U.num(v);
    var neg = n < 0;
    var s = Math.abs(Math.round(n)).toString();
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s;
  };

  U.pct = function (v, digits) {
    var d = digits === undefined ? 2 : digits;
    if (!isFinite(v)) return '-';
    return (v * 100).toFixed(d) + '%';
  };

  U.ratio = function (a, b) {
    var bb = U.num(b);
    return bb === 0 ? 0 : U.num(a) / bb;
  };

  U.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  U.debounce = function (fn, ms) {
    var t;
    return function () {
      var a = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, a); }, ms);
    };
  };

  U.toast = function (msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.add('hidden'); }, 2600);
  };

  U.loading = function (on, text) {
    var el = document.getElementById('ld');
    if (on) {
      if (!el) {
        el = document.createElement('div');
        el.id = 'ld';
        el.className = 'loading';
        document.body.appendChild(el);
      }
      el.textContent = text || '处理中…';
      el.classList.remove('hidden');
    } else if (el) {
      el.remove();
    }
  };

  U.download = function (blob, filename) {
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  };

  U.csvEscape = function (v) {
    var s = String(v == null ? '' : v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };

  global.U = U;
})(window);
