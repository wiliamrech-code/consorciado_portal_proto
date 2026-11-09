/* HS Consórcios · portal web — runtime standalone (renderiza as telas .dc.html exportadas) */
(function () {
  'use strict';
  var SCREENS = window.__HS_SCREENS;
  var START = window.__HS_START || 'Main';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (u) {
    var patch = typeof u === 'function' ? u(this.state, this.props) : u;
    this.state = Object.assign({}, this.state, patch || {});
    schedule();
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };

  var classes = {};
  function getClass(name) {
    if (!classes[name]) {
      var src = SCREENS[name].src;
      /* class Component extends DCLogic precisa de uma "classe" de verdade */
      classes[name] = new Function('DCLogic', src + '\n;return Component;')(BaseClass);
    }
    return classes[name];
  }
  class BaseClass {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(u) { DCLogic.prototype.setState.call(this, u); }
    forceUpdate() { schedule(); }
  }

  /* ---------- holes ---------- */
  var WHOLE = /^\s*\{\{([^}]+)\}\}\s*$/;
  function lookup(expr, scope) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    if (/^'.*'$|^".*"$/.test(expr)) return expr.slice(1, -1);
    var parts = expr.split('.'), v;
    for (var i = scope.length - 1; i >= 0; i--) {
      if (scope[i] && Object.prototype.hasOwnProperty.call(scope[i], parts[0])) { v = scope[i][parts[0]]; break; }
    }
    for (var j = 1; j < parts.length; j++) { if (v == null) return undefined; v = v[parts[j]]; }
    return v;
  }
  function interp(str, scope) {
    return str.replace(/\{\{([^}]+)\}\}/g, function (m, e) { var v = lookup(e, scope); return v == null ? '' : String(v); });
  }
  function attrVal(str, scope) { var m = str.match(WHOLE); return m ? lookup(m[1], scope) : interp(str, scope); }
  function camel(s) { return s.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); }); }

  /* ---------- instâncias ---------- */
  function defaultsOf(name) { return SCREENS[name].defaults || {}; }
  function makeInst(name, props) {
    var C = getClass(name);
    var comp = new C(Object.assign({}, defaultsOf(name), props));
    if (!comp.state) comp.state = {};
    return { name: name, comp: comp, kids: new Map(), fresh: true };
  }
  function unmount(inst) {
    inst.kids.forEach(unmount);
    if (inst.comp.componentWillUnmount) { try { inst.comp.componentWillUnmount(); } catch (e) { console.error(e); } }
  }
  function mountFresh(inst) {
    inst.kids.forEach(mountFresh);
    if (inst.fresh) {
      inst.fresh = false;
      if (inst.comp.componentDidMount) { try { inst.comp.componentDidMount(); } catch (e) { console.error(e); } }
    }
  }

  function renderInst(inst, parent, inSvg) {
    var used = new Set();
    var vals = inst.comp.renderVals ? inst.comp.renderVals() : {};
    var ctr = { n: 0 };
    renderList(SCREENS[inst.name].ast, [vals], parent, inst, ctr, used, inSvg);
    inst.kids.forEach(function (k, key) { if (!used.has(key)) { unmount(k); inst.kids.delete(key); } });
  }
  function renderList(nodes, scope, out, inst, ctr, used, inSvg) {
    for (var i = 0; i < nodes.length; i++) renderNode(nodes[i], scope, out, inst, ctr, used, inSvg);
  }
  function renderNode(n, scope, out, inst, ctr, used, inSvg) {
    if (typeof n === 'string') {
      out.appendChild(document.createTextNode(n.indexOf('{{') >= 0 ? interp(n, scope) : n));
      return;
    }
    var tag = n.t, a = n.a, i;
    if (tag === 'helmet') return;
    if (tag === 'sc-if') {
      if (attrVal(getA(a, 'value') || '', scope)) renderList(n.c, scope, out, inst, ctr, used, inSvg);
      return;
    }
    if (tag === 'sc-for') {
      var list = attrVal(getA(a, 'list') || '', scope) || [];
      var as = getA(a, 'as') || 'item';
      for (i = 0; i < list.length; i++) {
        var s = {}; s[as] = list[i]; s.$index = i;
        renderList(n.c, scope.concat([s]), out, inst, ctr, used, inSvg);
      }
      return;
    }
    if (tag === 'dc-import') {
      var name = getA(a, 'name'), props = {};
      for (i = 0; i < a.length; i++) {
        if (a[i][0] === 'name' || a[i][0].indexOf('hint-') === 0) continue;
        props[camel(a[i][0])] = attrVal(a[i][1], scope);
      }
      var key = name + '#' + (ctr.n++);
      var kid = inst.kids.get(key);
      if (!kid) { kid = makeInst(name, props); inst.kids.set(key, kid); }
      else kid.comp.props = Object.assign({}, defaultsOf(name), props);
      used.add(key);
      renderInst(kid, out, inSvg);
      return;
    }
    var svg = inSvg || tag === 'svg';
    var el = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    for (i = 0; i < a.length; i++) {
      var nm = a[i][0], raw = a[i][1];
      if (/^on[A-Za-z]/.test(nm)) {
        var fn = attrVal(raw, scope);
        if (typeof fn === 'function') (el.__on || (el.__on = {}))[nm.slice(2).toLowerCase()] = fn;
        continue;
      }
      var v = raw.indexOf('{{') >= 0 ? attrVal(raw, scope) : raw;
      if (nm === 'checked' || nm === 'disabled' || nm === 'selected') {
        (el.__props || (el.__props = {}))[nm] = raw.indexOf('{{') >= 0 ? !!v : true;
        continue;
      }
      if (v === false || v == null) continue;
      el.setAttribute(nm, v === true ? '' : String(v));
    }
    renderList(n.c, scope, el, inst, ctr, used, svg);
    if (el.__props) for (var k in el.__props) el[k] = el.__props[k];
    out.appendChild(el);
  }
  function getA(a, name) { for (var i = 0; i < a.length; i++) if (a[i][0] === name) return a[i][1]; return null; }

  /* ---------- morph: atualiza o DOM sem perder foco e valores digitados ---------- */
  function morph(oldP, newP) {
    var o = Array.prototype.slice.call(oldP.childNodes), nn = Array.prototype.slice.call(newP.childNodes), i;
    for (i = 0; i < nn.length; i++) {
      var a = o[i], b = nn[i];
      if (!a) { oldP.appendChild(b); continue; }
      if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { oldP.replaceChild(b, a); continue; }
      if (a.nodeType === 3) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; continue; }
      if (a.nodeType !== 1) continue;
      syncAttrs(a, b);
      a.__on = b.__on;
      if (b.__props) for (var k in b.__props) if (a[k] !== b.__props[k]) a[k] = b.__props[k];
      morph(a, b);
    }
    for (i = nn.length; i < o.length; i++) oldP.removeChild(o[i]);
  }
  function syncAttrs(a, b) {
    var i, at;
    for (i = a.attributes.length - 1; i >= 0; i--) { at = a.attributes[i]; if (!b.hasAttribute(at.name)) a.removeAttribute(at.name); }
    for (i = 0; i < b.attributes.length; i++) { at = b.attributes[i]; if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value); }
  }

  /* ---------- app / navegação ---------- */
  var root, app, current, scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(function () { scheduled = false; renderApp(); });
  }
  function renderApp() {
    if (!app) return;
    var tmp = document.createElement('div');
    renderInst(app, tmp, false);
    if (!root.firstChild) { while (tmp.firstChild) root.appendChild(tmp.firstChild); }
    else morph(root, tmp);
    mountFresh(app);
  }
  function go(name) {
    if (!SCREENS[name]) name = START;
    if (app) unmount(app);
    current = name;
    app = makeInst(name, {});
    root.innerHTML = '';
    document.title = SCREENS[name].title || 'HS Consórcios';
    renderApp();
    window.scrollTo(0, 0);
  }
  function fromHash() { var m = location.hash.match(/^#\/?([\w-]+)/); return m ? m[1] : START; }

  function delegate(type) {
    document.addEventListener(type, function (e) {
      var t = e.target;
      while (t && t !== document) {
        if (t.__on && t.__on[type]) { t.__on[type].call(t, e); }
        t = t.parentNode;
      }
      if (type === 'click') {
        var link = e.target.closest && e.target.closest('a[href]');
        if (!link) return;
        var href = link.getAttribute('href');
        if (href === '#' || href === '') { e.preventDefault(); return; }
        var m = href.match(/^\/?([\w-]+)\.dc\.html$/);
        if (m) {
          e.preventDefault();
          if (location.hash !== '#/' + m[1]) location.hash = '#/' + m[1];
          else go(m[1]);
        }
      }
    }, false);
  }

  document.addEventListener('DOMContentLoaded', function () {
    root = document.getElementById('app');
    ['click', 'change', 'input'].forEach(delegate);
    window.addEventListener('hashchange', function () { var n = fromHash(); if (n !== current) go(n); });
    go(fromHash());
  });
})();
