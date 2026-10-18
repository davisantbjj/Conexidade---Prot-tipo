/* Conexidade — runtime leve que executa as telas .dc.html do canvas fora dele.
   Converte o template de cada tela em elementos React a cada render e
   adiciona o componente <vb-map> (mapa real de Aracaju com Leaflet). */
(function () {
  'use strict';
  const h = React.createElement;

  // ---------- DCLogic (mesma API usada pelas telas) ----------
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(patch) {
      const p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
      this.state = Object.assign({}, this.state, p);
      if (this.__view) this.__view.forceUpdate();
    }
    renderVals() { return {}; }
  }
  window.DCLogic = DCLogic;
  window.VB_APP = true;

  // ---------- Parse das telas ----------
  const cache = {};
  function parseScreen(name) {
    if (cache[name]) return cache[name];
    const src = (window.VB_SCREENS || {})[name];
    if (!src) return null;
    const doc = new DOMParser().parseFromString(src, 'text/html');
    const xdc = doc.querySelector('x-dc');
    const helmet = xdc.querySelector('helmet');
    const helmetHTML = helmet ? helmet.innerHTML : '';
    if (helmet) helmet.remove();
    const root = xdc.firstElementChild;
    const scriptEl = doc.querySelector('script[data-dc-script]');
    let Logic = DCLogic, defaults = {};
    if (scriptEl) {
      Logic = new Function('DCLogic', scriptEl.textContent + '\nreturn Component;')(DCLogic);
      try {
        const props = JSON.parse(scriptEl.getAttribute('data-props') || '{}');
        Object.keys(props).forEach((k) => { if (k[0] !== '$' && props[k] && 'default' in props[k]) defaults[k] = props[k].default; });
      } catch (e) { /* sem props */ }
    }
    const titleEl = doc.querySelector('title');
    cache[name] = { name, root, helmetHTML, Logic, defaults, title: titleEl ? titleEl.textContent : 'Conexidade' };
    return cache[name];
  }

  // ---------- Holes {{...}} ----------
  function lookup(path, ctx) {
    const parts = path.trim().split('.');
    let v = Object.prototype.hasOwnProperty.call(ctx.scope, parts[0]) ? ctx.scope[parts[0]] : ctx.vals[parts[0]];
    for (let i = 1; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }
  const ONLY = /^\s*\{\{([^}]+)\}\}\s*$/;
  function interp(str, ctx) {
    const m = str.match(ONLY);
    if (m) return lookup(m[1], ctx);
    return str.replace(/\{\{([^}]+)\}\}/g, (_, p) => { const v = lookup(p, ctx); return v == null ? '' : String(v); });
  }

  // ---------- Atributos -> props React ----------
  const EVENTS = ['onClick', 'onClickCapture', 'onDoubleClick', 'onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel',
    'onPointerLeave', 'onPointerEnter', 'onScroll', 'onInput', 'onChange', 'onKeyDown', 'onKeyUp', 'onFocus', 'onBlur', 'onSubmit',
    'onAnimationEnd', 'onTransitionEnd', 'onTouchStart', 'onTouchEnd', 'onMouseDown', 'onMouseUp', 'onWheel', 'onLoad', 'onError',
    'onContextMenu', 'onDragStart'];
  const EV = {}; EVENTS.forEach((e) => { EV[e.toLowerCase()] = e; });
  const RENAME = { class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength',
    minlength: 'minLength', autocomplete: 'autoComplete', enterkeyhint: 'enterKeyHint', inputmode: 'inputMode', spellcheck: 'spellCheck',
    autofocus: 'autoFocus', colspan: 'colSpan', rowspan: 'rowSpan', srcset: 'srcSet', crossorigin: 'crossOrigin', 'xlink:href': 'xlinkHref',
    contenteditable: 'contentEditable', novalidate: 'noValidate', accesskey: 'accessKey' };
  const BOOL = { checked: 1, disabled: 1, selected: 1, hidden: 1, required: 1, multiple: 1, open: 1, readonly: 1, autofocus: 1, novalidate: 1 };
  const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  function parseStyle(str) {
    const out = {};
    let depth = 0, cur = '';
    const decls = [];
    for (const ch of str) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ';' && depth === 0) { decls.push(cur); cur = ''; } else cur += ch;
    }
    decls.push(cur);
    decls.forEach((d) => {
      const i = d.indexOf(':');
      if (i < 0) return;
      const k = d.slice(0, i).trim();
      const v = d.slice(i + 1).trim();
      if (!k) return;
      if (k.startsWith('--')) { out[k] = v; return; }
      let key = camel(k);
      if (k.startsWith('-webkit-')) key = 'Webkit' + camel(k.slice(8)).replace(/^./, (c) => c.toUpperCase());
      if (k.startsWith('-moz-')) key = 'Moz' + camel(k.slice(5)).replace(/^./, (c) => c.toUpperCase());
      out[key] = v;
    });
    return out;
  }
  const truthyBool = (v) => (v === '' ? true : v === 'false' ? false : Boolean(v));

  function toProps(node, ctx, key) {
    const props = { key };
    const hasChange = node.hasAttribute('onchange') || node.hasAttribute('oninput');
    for (const a of Array.from(node.attributes)) {
      let name = a.name;
      if (name.startsWith('hint-') || name.startsWith('sc-')) continue;
      let val = a.value.indexOf('{{') >= 0 ? interp(a.value, ctx) : a.value;
      if (EV[name]) { if (typeof val === 'function') props[EV[name]] = val; continue; }
      if (name === 'style') { props.style = parseStyle(val == null ? '' : String(val)); continue; }
      if (BOOL[name]) {
        const b = truthyBool(val);
        if (name === 'checked' && !hasChange) props.defaultChecked = b; else props[RENAME[name] || name] = b;
        continue;
      }
      if (name === 'value' && (node.localName === 'input' || node.localName === 'select')) {
        if (a.value.indexOf('{{') >= 0 && hasChange) props.value = val == null ? '' : val; else props.defaultValue = val;
        continue;
      }
      if (RENAME[name]) name = RENAME[name];
      else if (name.indexOf('-') > 0 && !name.startsWith('data-') && !name.startsWith('aria-')) name = camel(name);
      if (val === undefined) continue;
      if ((name === 'src' || name === 'poster') && typeof val === 'string' && val.startsWith('/_blob/')) {
        const id = val.slice(7);
        val = 'assets/' + ((window.VB_ASSETS || {})[id] || id + '.jpg');
      }
      props[name] = typeof val === 'boolean' ? String(val) : val;
    }
    return props;
  }

  const DROP_WS = { select: 1, ul: 1, ol: 1, table: 1, tbody: 1, thead: 1, tr: 1, svg: 1, g: 1, datalist: 1, optgroup: 1 };
  const VOID = { img: 1, input: 1, br: 1, hr: 1, meta: 1, link: 1, source: 1, area: 1, col: 1, wbr: 1 };

  function kids(node, ctx) {
    const out = [];
    const drop = DROP_WS[node.localName];
    Array.from(node.childNodes).forEach((c, i) => {
      if (c.nodeType === 3 && drop && !c.nodeValue.trim()) return;
      const r = conv(c, ctx, i);
      if (r !== null && r !== undefined) out.push(r);
    });
    return out;
  }

  function conv(node, ctx, key) {
    if (node.nodeType === 3) {
      const t = node.nodeValue;
      if (t.indexOf('{{') < 0) return t;
      const v = interp(t, ctx);
      return v == null || typeof v === 'object' || typeof v === 'function' ? '' : String(v);
    }
    if (node.nodeType !== 1) return null;
    const tag = node.localName;
    if (tag === 'sc-for') {
      const list = interp(node.getAttribute('list') || '', ctx) || [];
      const as = node.getAttribute('as') || 'item';
      return h(React.Fragment, { key }, (Array.isArray(list) ? list : []).map((item, i) =>
        h(React.Fragment, { key: i }, kids(node, { vals: ctx.vals, scope: Object.assign({}, ctx.scope, { [as]: item }) }))));
    }
    if (tag === 'sc-if') {
      const v = interp(node.getAttribute('value') || '', ctx);
      return v ? h(React.Fragment, { key }, kids(node, ctx)) : null;
    }
    if (tag === 'vb-map') {
      const p = { key };
      for (const a of Array.from(node.attributes)) p[a.name] = a.value.indexOf('{{') >= 0 ? interp(a.value, ctx) : a.value;
      return h(VBMap, p);
    }
    const props = toProps(node, ctx, key);
    if (tag === 'textarea') { props.defaultValue = node.textContent; return h('textarea', props); }
    if (VOID[tag]) return h(tag, props);
    return h(tag, props, ...kids(node, ctx));
  }

  // ---------- Dados das ocorrências (Aracaju-SE) ----------
  const ARACAJU = [-10.9265, -37.0625];
  const CATS = {
    limpeza: { label: 'Limpeza urbana', cor: '#E8892F', fundo: '#FDEEDF', orgao: 'EMSURB' },
    iluminacao: { label: 'Iluminação', cor: '#C99A06', fundo: '#FBF3D6', orgao: 'EMURB' },
    agua: { label: 'Água e esgoto', cor: '#2F6FDB', fundo: '#E3ECFA', orgao: 'DESO / Iguá' },
    vias: { label: 'Vias e calçadas', cor: '#D7282F', fundo: '#FDE8E8', orgao: 'EMURB' }
  };
  const STATUS = {
    'Em análise': { bg: '#FDEEDF', cor: '#A0510F', dot: '#E8892F' },
    'Encaminhada': { bg: '#E3ECFA', cor: '#1D5BB8', dot: '#2F6FDB' },
    'Em andamento': { bg: '#E3E9EF', cor: '#1B2B3A', dot: '#1B2B3A' },
    'Resolvida': { bg: '#E3F3E8', cor: '#146E40', dot: '#2DAE5F' }
  };
  const OC = [
    ['lixo-suissa', 'limpeza', 'Lixo acumulado na calçada', 'Av. Hermes Fontes, 1284', 'Suíssa', 'Em análise', 47, -10.9262, -37.0612],
    ['poste-salgado', 'iluminacao', 'Poste apagado há uma semana', 'R. Riachão', 'Salgado Filho', 'Resolvida', 12, -10.9336, -37.0561],
    ['vaz-13julho', 'agua', 'Vazamento na calçada', 'Av. Beira Mar', '13 de Julho', 'Encaminhada', 8, -10.9292, -37.0478],
    ['cratera-hermes', 'vias', 'Cratera na pista após a chuva', 'Av. Hermes Fontes', 'Suíssa', 'Encaminhada', 112, -10.9301, -37.0598],
    ['entulho-centro', 'limpeza', 'Entulho bloqueando a rua', 'R. de Laranjeiras', 'Centro', 'Em andamento', 21, -10.9114, -37.0519],
    ['calcada-sj', 'vias', 'Calçada danificada perto da escola', 'R. Pacatuba', 'São José', 'Em análise', 33, -10.9183, -37.0556],
    ['poste-grageru', 'iluminacao', 'Rua escura há 3 dias', 'Av. Pedro Paes Azevedo', 'Grageru', 'Em análise', 18, -10.9446, -37.0573],
    ['esgoto-jardins', 'agua', 'Esgoto a céu aberto', 'R. Rafael de Aguiar', 'Jardins', 'Encaminhada', 41, -10.9449, -37.0522],
    ['lixo-luzia', 'limpeza', 'Coleta atrasada', 'Av. Desembargador Maynard', 'Luzia', 'Resolvida', 9, -10.9433, -37.0668],
    ['buraco-siqueira', 'vias', 'Buraco em cruzamento', 'R. Bahia', 'Siqueira Campos', 'Em análise', 27, -10.9181, -37.0702],
    ['agua-gv', 'agua', 'Falta d’água recorrente', 'R. Itabaiana', 'Getúlio Vargas', 'Em andamento', 64, -10.9127, -37.0609],
    ['poste-pontonovo', 'iluminacao', 'Lâmpada piscando', 'Av. Augusto Franco', 'Ponto Novo', 'Encaminhada', 6, -10.9343, -37.0761],
    ['lixo-ib', 'limpeza', 'Lixo em terreno baldio', 'R. Delmiro Gouveia', 'Inácio Barbosa', 'Em análise', 15, -10.9622, -37.0618],
    ['buraco-farol', 'vias', 'Asfalto cedendo', 'Av. Murilo Dantas', 'Farolândia', 'Encaminhada', 52, -10.9701, -37.0640],
    ['agua-coroa', 'agua', 'Vazamento em adutora', 'Av. Santos Dumont', 'Coroa do Meio', 'Em andamento', 29, -10.9598, -37.0451],
    ['poste-atalaia', 'iluminacao', 'Orla sem iluminação', 'Av. Santos Dumont', 'Atalaia', 'Em análise', 38, -10.9846, -37.0452],
    ['lixo-americas', 'limpeza', 'Contêiner quebrado', 'R. Jasmim', 'América', 'Encaminhada', 11, -10.9257, -37.0805],
    ['calcada-13', 'vias', 'Calçada sem acessibilidade', 'R. Guilhermino Rezende', '13 de Julho', 'Em análise', 19, -10.9318, -37.0503]
  ].map((o) => ({ id: o[0], cat: o[1], titulo: o[2], rua: o[3], bairro: o[4], status: o[5], apoios: o[6], lat: o[7], lng: o[8] }));
  window.VB_DATA = { ARACAJU, CATS, STATUS, OC };

  // ---------- Geocodificação (OpenStreetMap / Nominatim) ----------
  window.VB_GEO = {
    dentroDeAracaju(lat, lng) { return Math.abs(lat - ARACAJU[0]) < 0.25 && Math.abs(lng - ARACAJU[1]) < 0.25; },
    async reverso(lat, lng) {
      const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=pt-BR&lat=' + lat + '&lon=' + lng);
      const j = await r.json();
      const a = j.address || {};
      const rua = [a.road || a.pedestrian || a.footway || 'Local sem nome', a.house_number].filter(Boolean).join(', ');
      const bairro = [a.suburb || a.neighbourhood || a.city_district || a.quarter, (a.city || a.town || 'Aracaju') + ' - SE'].filter(Boolean).join(' · ');
      return { rua, bairro };
    },
    async buscar(q) {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&accept-language=pt-BR&viewbox=-37.20,-10.80,-36.98,-11.10&bounded=1&q=' + encodeURIComponent(q + ', Aracaju'));
      const j = await r.json();
      return j && j[0] ? { lat: +j[0].lat, lng: +j[0].lon } : null;
    },
    posicao() {
      return new Promise((res) => {
        if (!navigator.geolocation) return res(null);
        navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { enableHighAccuracy: true, timeout: 8000 });
      });
    }
  };

  // ---------- <vb-map>: mapa real com Leaflet ----------
  const PIN_SVG = {
    limpeza: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    iluminacao: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    agua: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
    vias: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'
  };
  function pinIcon(o) {
    const c = CATS[o.cat];
    const html = '<div class="vb-pin" style="--c:' + c.cor + '">' +
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + PIN_SVG[o.cat] + '</svg></div>';
    return L.divIcon({ className: 'vb-pin-wrap', html, iconSize: [36, 36], iconAnchor: [18, 36] });
  }

  class VBMap extends React.Component {
    componentDidMount() {
      if (!window.L) { this.el.innerHTML = '<div class="vb-map-off">Sem conexão para carregar o mapa.</div>'; return; }
      const p = this.props;
      const center = p.center ? p.center.split(',').map(Number) : ARACAJU;
      this.map = L.map(this.el, { zoomControl: false, attributionControl: false, center, zoom: +(p.zoom || 14), zoomSnap: 0.5, tap: true });
      const arquivo = location.protocol === 'file:';
      const tiles = arquivo
        ? ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', '© Esri · © OpenStreetMap', 19]
        : ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', '© OpenStreetMap', 19];
      L.tileLayer(tiles[0], { maxZoom: tiles[2], className: 'vb-tiles' }).addTo(this.map);
      L.control.attribution({ position: p['attr-pos'] || 'bottomleft', prefix: false }).addAttribution(tiles[1]).addTo(this.map);
      this.offsetY = +(p['offset-y'] || 0);
      if (this.offsetY) this.map.panBy([0, this.offsetY], { animate: false });
      if (p.mode === 'ocorrencias') {
        this.markers = {};
        OC.forEach((o) => {
          const m = L.marker([o.lat, o.lng], { icon: pinIcon(o), keyboard: true, title: o.titulo, riseOnHover: true });
          m.on('click', () => { if (typeof this.props['on-pick'] === 'function') this.props['on-pick'](o.id); });
          m.addTo(this.map);
          this.markers[o.id] = m;
        });
        this.map.on('click', () => { if (typeof this.props['on-pick'] === 'function') this.props['on-pick'](''); });
        this.refreshPins();
      }
      this.map.on('movestart', () => { if (typeof this.props['on-movestart'] === 'function') this.props['on-movestart'](); });
      this.map.on('moveend', () => {
        const c = this.map.containerPointToLatLng(this.map.getSize().divideBy(2).subtract([0, this.offsetY]));
        if (typeof this.props['on-moveend'] === 'function') this.props['on-moveend'](c.lat, c.lng);
      });
      setTimeout(() => {
        if (!this.map) return;
        this.map.invalidateSize();
        if (p.mode === 'local') this.map.fire('moveend'); // já mostra o endereço real do ponto inicial
      }, 60);
    }
    refreshPins() {
      if (!this.markers) return;
      const f = this.props.filter || 'todos';
      OC.forEach((o, i) => {
        const hidden = !(f === 'todos' || f === o.cat);
        const sel = this.props.selected === o.id;
        const m = this.markers[o.id];
        const el = m.getElement() && m.getElement().firstChild;
        if (el) {
          el.style.transitionDelay = hidden ? '0s' : (i % 6) * 0.03 + 's';
          el.classList.toggle('is-hidden', hidden);
          el.classList.toggle('is-sel', sel);
          m.getElement().style.pointerEvents = hidden ? 'none' : '';
        }
        m.setZIndexOffset(sel ? 1000 : hidden ? -1000 : 0);
      });
    }
    flyTo(lat, lng, z) {
      if (!this.map) return;
      const zoom = z || this.map.getZoom();
      const pt = this.map.project([lat, lng], zoom).add([0, this.offsetY]);
      this.map.flyTo(this.map.unproject(pt, zoom), zoom, { duration: 0.8 });
    }
    componentDidUpdate(prev) {
      if (prev.filter !== this.props.filter || prev.selected !== this.props.selected) this.refreshPins();
      if (this.props.recenter && prev.recenter !== this.props.recenter) {
        const [la, ln, z] = String(this.props.recenter).split(',').map(Number);
        this.flyTo(la, ln, z);
      }
      if (this.props.selected && prev.selected !== this.props.selected) {
        const o = OC.find((x) => x.id === this.props.selected);
        if (o) this.flyTo(o.lat, o.lng, Math.max(this.map.getZoom(), 15));
      }
    }
    componentWillUnmount() { if (this.map) this.map.remove(); this.map = null; }
    shouldComponentUpdate() { return true; }
    render() {
      const style = parseStyle(this.props.style || '');
      return h('div', { ref: (el) => { this.el = el; }, className: 'vb-map', style, role: 'application', 'aria-label': this.props.label || 'Mapa de Aracaju' });
    }
  }

  // ---------- Tela ----------
  class ScreenView extends React.Component {
    constructor(p) {
      super(p);
      this.logic = new p.screen.Logic(Object.assign({}, p.screen.defaults));
      this.logic.__view = this;
    }
    componentDidMount() { if (this.logic.componentDidMount) this.logic.componentDidMount(); }
    componentDidUpdate() { if (this.logic.componentDidUpdate) this.logic.componentDidUpdate(); }
    componentWillUnmount() { this.logic.__view = null; if (this.logic.componentWillUnmount) this.logic.componentWillUnmount(); }
    render() {
      let vals = {};
      try { vals = this.logic.renderVals() || {}; } catch (e) { console.error(e); }
      return conv(this.props.screen.root, { vals, scope: {} }, 'root');
    }
  }

  // ---------- Botão de emergência flutuante (acompanha todas as telas) ----------
  const SOS_OCULTO = { 'Main.dc.html': 1, 'Login.dc.html': 1 };
  const NUDGE = h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', className: 'vb-nudge' }, h('path', { d: 'm9 18 6-6-6-6' }));
  const ALERTA = (s) => h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.1, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    h('path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }), h('path', { d: 'M12 9v4' }), h('path', { d: 'M12 17h.01' }));
  const FONE = (s) => h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    h('path', { d: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z' }));
  const FECHA = h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', 'aria-hidden': 'true' }, h('path', { d: 'M18 6 6 18' }), h('path', { d: 'm6 6 12 12' }));

  class SOSFab extends React.Component {
    constructor(p) { super(p); this.state = { fase: 'fechado', x: 0, arrastando: false, base: 108 }; this.trilho = 270; }
    componentDidMount() {
      this.medir();
      // some enquanto a tela tiver uma folha/diálogo modal aberto (compartilhar, stories, menu…)
      this.obs = new MutationObserver(() => {
        const modal = !!document.querySelector('#screen [aria-modal="true"]');
        if (modal !== !!this.state.modal) this.setState({ modal });
      });
      this.obs.observe(document.getElementById('screen'), { childList: true, subtree: true });
    }
    componentWillUnmount() { if (this.obs) this.obs.disconnect(); }
    componentDidUpdate(prev) { if (prev.tela !== this.props.tela) { this.medir(); if (this.state.fase === 'aberto') this.setState({ fase: 'fechado', x: 0 }); } }
    medir() {
      requestAnimationFrame(() => {
        const raiz = document.querySelector('#screen > div');
        let alt = 0;
        if (raiz) Array.from(raiz.children).forEach((c) => {
          const cs = getComputedStyle(c);
          if (cs.position === 'absolute' && cs.bottom === '0px' && c.offsetHeight < 260 && c.offsetHeight > 40 && cs.pointerEvents !== 'none') alt = Math.max(alt, c.offsetHeight);
        });
        const base = (alt || 24) + 16;
        if (base !== this.state.base) this.setState({ base });
      });
    }
    escala() { const r = document.querySelector('[data-vb-root]'); return r ? r.getBoundingClientRect().width / 390 : 1; }
    down(e) {
      e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
      this.ini = { x: e.clientX, k: this.escala(), mov: 0 };
      this.setState({ arrastando: true });
    }
    move(e) {
      if (!this.ini) return;
      const dx = (e.clientX - this.ini.x) / this.ini.k;
      this.ini.mov = Math.max(this.ini.mov, Math.abs(dx));
      this.setState({ x: Math.max(0, Math.min(this.trilho, dx)) });
    }
    up() {
      if (!this.ini) return;
      this.ini = null;
      if (this.state.x > this.trilho * 0.82) { this.setState({ arrastando: false, x: this.trilho }); setTimeout(() => this.setState({ fase: 'acionado', x: 0 }), 180); }
      else this.setState({ arrastando: false, x: 0 });
    }
    render() {
      const { fase, x, arrastando, base } = this.state;
      if ((SOS_OCULTO[this.props.tela] || this.state.modal) && fase !== 'acionado') return null;
      const prog = x / this.trilho;
      const kids = [];
      if (fase !== 'fechado') kids.push(h('div', { key: 'dim', className: 'vb-sos-dim', onClick: () => fase === 'aberto' && this.setState({ fase: 'fechado', x: 0 }) }));
      if (fase === 'aberto') {
        kids.push(h('div', { key: 'p', role: 'dialog', 'aria-label': 'Emergência', className: 'vb-sos-panel', style: { bottom: base } },
          h('div', { className: 'vb-sos-head' },
            h('span', { className: 'vb-sos-ico' }, ALERTA(20)),
            h('span', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2 } },
              h('b', { style: { fontSize: 17 } }, 'Emergência'),
              h('span', { style: { fontSize: 13, color: '#5E6B78' } }, 'Deslize para pedir ajuda imediata')),
            h('button', { type: 'button', className: 'vb-sos-x', 'aria-label': 'Fechar', onClick: () => this.setState({ fase: 'fechado', x: 0 }) }, FECHA)),
          h('div', { className: 'vb-sos-track' },
            h('span', { className: 'vb-sos-fill', style: { width: 64 + x, transition: arrastando ? 'none' : 'width .45s var(--vb-ease)' } }),
            h('span', { className: 'vb-sos-label', style: { opacity: 1 - prog * 1.4 } }, 'Arraste para acionar', h('span', { className: 'vb-sos-chev', 'aria-hidden': 'true' }, [0, 1, 2].map((i) => h('i', { key: i, style: { animationDelay: i * 0.18 + 's' } }, '›')))),
            h('button', { type: 'button', className: 'vb-sos-knob', 'aria-label': 'Arraste para a direita para acionar a emergência',
              style: { transform: 'translateX(' + x + 'px)', transition: arrastando ? 'none' : 'transform .45s var(--vb-ease)' },
              onPointerDown: (e) => this.down(e), onPointerMove: (e) => this.move(e), onPointerUp: () => this.up(), onPointerCancel: () => this.up(),
              onKeyDown: (e) => { if (e.key === 'Enter' || e.key === 'ArrowRight') this.setState({ fase: 'acionado', x: 0 }); } }, NUDGE)),
          h('div', { className: 'vb-sos-tels' },
            ['Polícia 190', 'SAMU 192', 'Bombeiros 193'].map((t) => h('a', { key: t, href: 'tel:' + t.split(' ')[1], className: 'vb-sos-tel' }, FONE(14), t)))));
      }
      if (fase === 'acionado') {
        kids.push(h('div', { key: 'a', role: 'status', className: 'vb-sos-panel is-on', style: { bottom: base } },
          h('span', { className: 'vb-sos-ring' }),
          h('div', { className: 'vb-sos-head' },
            h('span', { className: 'vb-sos-ico is-on' }, FONE(20)),
            h('span', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2 } },
              h('b', { style: { fontSize: 17 } }, 'Ajuda acionada'),
              h('span', { style: { fontSize: 13, opacity: 0.9 } }, 'Central avisada · localização enviada')),
            h('button', { type: 'button', className: 'vb-sos-cancel', onClick: () => this.setState({ fase: 'fechado', x: 0 }) }, 'Cancelar'))));
      }
      if (fase === 'fechado') {
        kids.push(h('button', { key: 'fab', type: 'button', className: 'vb-sos-fab', style: { bottom: base }, 'aria-label': 'Emergência', 'aria-haspopup': 'dialog',
          onClick: () => this.setState({ fase: 'aberto', x: 0 }) }, h('span', { className: 'vb-sos-pulse' }), ALERTA(24), h('span', { className: 'vb-sos-tag' }, 'SOS')));
      }
      return h(React.Fragment, null, kids);
    }
  }

  // ---------- Navegação ----------
  let helmetNodes = [];
  function applyHelmet(html) {
    helmetNodes.forEach((n) => n.remove());
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    helmetNodes = Array.from(tmp.children).filter((n) => n.tagName === 'STYLE' || n.tagName === 'LINK');
    helmetNodes.forEach((n) => document.head.appendChild(n));
  }
  const reactRoot = ReactDOM.createRoot(document.getElementById('screen'));
  const sosRoot = ReactDOM.createRoot(document.getElementById('sos'));
  function nameFromHash() {
    const n = decodeURIComponent((location.hash || '').replace(/^#\/?/, ''));
    return n ? (n.endsWith('.dc.html') ? n : n + '.dc.html') : 'Main.dc.html';
  }
  function logado() { try { return localStorage.getItem('vb-logado') === '1'; } catch (e) { return false; } }
  function render() {
    let name = nameFromHash();
    if (name === 'Perfil.dc.html' && logado()) name = 'PerfilLogado.dc.html';
    const scr = parseScreen(name) || parseScreen('Main.dc.html');
    applyHelmet(scr.helmetHTML);
    document.title = scr.title;
    reactRoot.render(h(ScreenView, { key: scr.name + ':' + Date.now(), screen: scr }));
    // o SOS agora vem de cada tela (arrastável); a camada global fica desligada
    if (window.VB_GLOBAL_SOS) sosRoot.render(h(SOSFab, { tela: scr.name }));
  }
  window.addEventListener('hashchange', render);
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href === '#') { e.preventDefault(); return; }
    if (!/\.dc\.html$/.test(href)) return;
    e.preventDefault();
    try {
      if (a.dataset.auth === 'login') localStorage.setItem('vb-logado', '1');
      if (a.dataset.auth === 'logout') localStorage.removeItem('vb-logado');
    } catch (err) { /* sem storage */ }
    const alvo = '#/' + href.replace(/\.dc\.html$/, '');
    if (location.hash === alvo) render(); else location.hash = alvo;
  });
  render();
})();
