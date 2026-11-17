/* Freezer.Craft — reacomodá los imanes de tu heladera.
 * El escenario trabaja en unidades del "mundo" (775 de alto); se escala con CSS
 * para llenar la pantalla. Siempre se juega en horizontal: en un celular en vertical
 * el juego aparece girado (CSS) para que la persona gire el teléfono.
 */
(() => {
  'use strict';

  // ---------- fondo y geometría (en píxeles de assets/fridge.jpg) ----------
  const BG_TALL = {
    src: 'assets/fridge.jpg', w: 2538, h: 1592, bleed: 0,
    doors: [{ x1: 72, y1: 62, x2: 2495, y2: 1592 }],            // la chapa donde pegan los imanes
    handles: [{ x1: 38, y1: 1024, x2: 256, y2: 1592 }],         // la manija
    overlay: { src: 'assets/handle.png', x: 30, y: 1015, w: 232, h: 577 }, // recorte de la manija (va por encima)
  };
  // Pantallas muy apaisadas (celular acostado): chapa de punta a punta, sin el marco de la heladera.
  // Los imanes pueden salirse apenas del cuadro (bleed).
  const BG_WIDE = {
    src: 'assets/fridge_wide.jpg', w: 2144, h: 756, bleed: 10,
    doors: [{ x1: -10, y1: -10, x2: 2154, y2: 766 }],
    handles: [{ x1: 0, y1: 486, x2: 152, y2: 756 }],
    overlay: { src: 'assets/handle_wide.png', x: 0, y: 480, w: 156, h: 276 },
  };
  const WIDE_FROM = 2.15;       // a partir de esta proporción (ancho / alto) se usa BG_WIDE
  let BG = BG_TALL;
  const WORLD = 830;            // alto del mundo en pantallas muy anchas: más chico = imanes más grandes en pantalla
  const WORLD_PHONE = 1060;     // celular en vertical (el juego se ve girado)
  const WORLD_TALL = 960;       // alto del mundo en las demás pantallas (así entran todos los imanes sin encimarse)
  let WW = 1300, WH = WORLD, DOORS = [], HANDLES = [];
  let bgBox = { x: 0, y: 0, w: 1, h: 1, k: 1 };
  let itemsWW = null;      // ancho del mundo para el que está armado el acomodo actual
  let itemsWH = null;      // y su alto
  let pristine = false;    // true mientras el acomodo inicial no fue tocado
  let keepPristine = false;

  // Título del medio, escrito con imanes de letras
  const TITLE = [
    ['a44', 'c31', 'a41', 'c07', 'a56', 'c30', 'c32'],  // F R E E Z E R
    ['a31', 'wood_R', 'a29', 'c22', 'a59'],             // C R A F T
  ];
  const HOLDER_BALLS = ['ball_red_1', 'ball_blue_1', 'ball_gold_1'];  // sostienen los papeles al empezar
  const HAND_FONT = '"Marker Felt", "Chalkboard SE", "Comic Sans MS", "Segoe Print", cursive';
  const MUSIC_VOLUME = 0.25;

  const BY_ID = Object.fromEntries(window.MAGNETS.map(m => [m.id, m]));
  const SAVE_KEY = 'freezercraft:v6';
  const DRAG_THRESHOLD = 5;

  // ---------- estado ----------
  let items = [];             // {uid, id, x, y, r, z, photo?, drawing?, text?, flag?}
  let nextUid = 1;
  const sel = new Set();      // uids seleccionados
  let base = 1, zoom = 1, scale = 1, offX = 0, offY = 0, viewCX = null, viewCY = null;
  const els = new Map();
  const sliding = new Map();
  let introPos = null;

  const $ = id => document.getElementById(id);
  const stageWrap = $('stageWrap'), stage = $('stage'), itemsEl = $('items');
  const toolbar = $('toolbar'), filePick = $('filePick'), introEl = $('intro');
  const bgEl = document.querySelector('.stage-bg'), handleEl = document.querySelector('.handle-overlay');

  // ---------- utilidades ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const def = item => BY_ID[item.id];
  const src = id => `assets/magnets/${(BY_ID[id] && BY_ID[id].img) || id}.png`;
  const topZ = () => items.reduce((z, it) => Math.max(z, it.z), 0) + 1;
  const bottomZ = () => items.reduce((z, it) => Math.min(z, it.z), Infinity) - 1;
  const isPaper = it => def(it).type === 'paper';
  const isFrame = it => def(it).type === 'frame';
  const isFlag = it => def(it).type === 'flag';
  const isSheet = it => !!def(it).draw;
  const hasLabel = it => !!def(it).label;
  const byUid = uid => items.find(i => i.uid === uid);
  const inRect = (x, y, r) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
  const overlap = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
  const typing = e => /^(INPUT|TEXTAREA)$/.test((e.target && e.target.tagName) || '');
  function box(item, k = 0.5) {
    const d = def(item);
    const rad = (item.r || 0) * Math.PI / 180, c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
    const w = d.w * c + d.h * s, h = d.w * s + d.h * c;
    return { x1: item.x - w * k, y1: item.y - h * k, x2: item.x + w * k, y2: item.y + h * k };
  }
  function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
  const measureCtx = document.createElement('canvas').getContext('2d');
  function fitFont(text, w, h) {
    measureCtx.font = `100px ${HAND_FONT}`;
    const tw = measureCtx.measureText(text || ' ').width || 1;
    return Math.max(4, Math.min(h * 0.8, 100 * w * 0.94 / tw));
  }

  // ---------- avisos (con "Deshacer" opcional) ----------
  let toastTimer;
  function say(msg, undo) {
    $('toastText').textContent = msg;
    const b = $('toastUndo');
    b.hidden = !undo;
    b.onclick = undo ? () => { undo(); $('toast').classList.remove('show'); } : null;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), undo ? 6000 : 2600);
  }

  // ---------- banderas (emoji de Twemoji, con el emoji del sistema como respaldo) ----------
  const FLAG_CODES = 'AR UY CL BR PY BO PE CO VE EC MX US CA ES IT FR DE PT GB IE NL BE CH AT SE NO DK FI IS PL CZ GR TR IL UA RU CU DO PR PA CR GT HN SV NI JM HT JP KR CN TW IN AU NZ ZA EG MA NG GH SN KE ET CM CI DZ TN SA AE QA LB IR IQ PK BD LK TH VN PH ID MY SG HU RO BG RS HR SI SK LT LV EE BY GE AM AZ KZ UZ MN NP AF AL BA MK ME MD LU MC MT CY AD LI SM VA BS BB TT BZ GY SR HK MO KH LA MM BT MV BN TL PG FJ WS TO VU SB KI TV NR PW FM MH CV GW GN SL LR ML BF NE TD CF CG CD GA GQ ST AO ZM ZW MW MZ MG MU SC KM DJ SO ER SD SS UG RW BI TZ NA BW LS SZ LY JO SY KW BH OM YE TJ KG TM KP GL FO GI IM JE GG AW CW SX BQ VG VI KY BM TC AI MS KN LC VC GD DM AG GU AS MP NC PF WF CK NU TK PN SH FK GS IO AQ EU UN'.split(' ');
  const flagEmoji = c => String.fromCodePoint(...[...c].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
  const flagURL = c => `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/${[...c].map(ch => (0x1F1E6 + ch.charCodeAt(0) - 65).toString(16)).join('-')}.svg`;
  // ¿El sistema dibuja emojis de banderas? (Windows no: ahí se usan las imágenes de Twemoji)
  const nativeFlags = (() => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 40;
      const x = c.getContext('2d'); x.font = '32px sans-serif'; x.textBaseline = 'top'; x.fillText('\u{1F1E6}\u{1F1F7}', 0, 0);
      const d = x.getImageData(0, 0, 40, 40).data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i + 2] > 150 && d[i + 2] > d[i] + 40) return true; // celeste de la bandera
    } catch {}
    return false;
  })();
  const flagHTML = (c, cls) => nativeFlags
    ? `<span class="${cls}-emo">${flagEmoji(c)}</span>`
    : `<img class="${cls}-img" src="${flagURL(c)}" alt="" draggable="false" data-c="${c}">`;
  // si la imagen no carga, se muestra el emoji del sistema
  function flagFallbacks(root, cls) {
    root.querySelectorAll(`img.${cls}-img`).forEach(im => {
      im.onerror = () => { const s = document.createElement('span'); s.className = `${cls}-emo`; s.textContent = flagEmoji(im.dataset.c); im.replaceWith(s); };
    });
  }
  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(['es'], { type: 'region' }); } catch {}
  const flagName = c => ({ EU: 'Unión Europea', UN: 'Naciones Unidas' }[c]) || (regionNames && regionNames.of(c)) || c;

  // ---------- sonido y música ----------
  let actx;
  function audio() {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function noise(a, len, shape) {
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * len), a.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * shape(i / ch.length);
    const n = a.createBufferSource(); n.buffer = buf; return n;
  }
  // "toc" seco y grave de imán contra la chapa
  function clack(strength = 1) {
    const a = audio(); if (!a) return;
    const t = a.currentTime;
    const n = noise(a, 0.03, p => Math.pow(1 - p, 4));
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100;
    const g = a.createGain(); g.gain.value = 0.55 * strength;
    const o = a.createOscillator();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.05);
    const g2 = a.createGain(); g2.gain.setValueAtTime(0.5 * strength, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    n.connect(f).connect(g).connect(a.destination); o.connect(g2).connect(a.destination);
    n.start(t); o.start(t); o.stop(t + 0.07);
  }
  // despegar: un roce suave y corto
  function peel() {
    const a = audio(); if (!a) return;
    const n = noise(a, 0.04, p => Math.sin(Math.PI * p));
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.7;
    const g = a.createGain(); g.gain.value = 0.12;
    n.connect(f).connect(g).connect(a.destination); n.start();
  }
  function swoosh() {
    const a = audio(); if (!a) return;
    const t = a.currentTime, n = noise(a, 0.4, p => Math.sin(Math.PI * p) * 0.5);
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.4);
    const g = a.createGain(); g.gain.value = 0.12;
    n.connect(f).connect(g).connect(a.destination); n.start(t);
  }
  function shutter() {
    const a = audio(); if (!a) return;
    const t = a.currentTime;
    [0, 0.09].forEach(d => {
      const n = noise(a, 0.06, p => Math.pow(1 - p, 3));
      const f = a.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500;
      const g = a.createGain(); g.gain.value = 0.35;
      n.connect(f).connect(g).connect(a.destination); n.start(t + d);
    });
  }
  // Música de fondo: arranca con el primer toque (los navegadores no dejan antes), a mitad de volumen.
  const music = $('music');
  let musicOn = false, musicNode = null;
  function startMusic() {
    if (musicOn) return;
    musicOn = true;
    const a = audio();
    if (a && !musicNode && location.protocol !== 'file:') {
      // con WebAudio el volumen también funciona en iPhone (donde audio.volume no tiene efecto)
      try {
        musicNode = a.createMediaElementSource(music);
        const g = a.createGain(); g.gain.value = MUSIC_VOLUME;
        musicNode.connect(g).connect(a.destination);
      } catch { music.volume = MUSIC_VOLUME; }
    } else if (!musicNode) music.volume = MUSIC_VOLUME;
    music.play().catch(() => { musicOn = false; });
  }
  window.addEventListener('pointerdown', startMusic, true);
  window.addEventListener('keydown', startMusic, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) music.pause(); else if (musicOn) music.play().catch(() => {});
  });

  // ---------- encuadre, zoom y paneo ----------
  function setWorld() {
    const W = stageWrap.clientWidth || 1, H = stageWrap.clientHeight || 1;
    // en el celular los botones ocupan más lugar: un poco más de mundo para que entre todo sin encimarse
    WH = W / H >= WIDE_FROM ? WORLD : (matchMedia('(pointer: coarse)').matches && Math.min(W, H) < 520 ? WORLD_PHONE : WORLD_TALL); WW = Math.max(Math.round(WH * W / H), 900);
    // fondo tipo "cover", pegado arriba a la izquierda (esquina de la puerta y manija)
    const nextBG = WW / WH >= WIDE_FROM ? BG_WIDE : BG_TALL;
    if (nextBG !== BG || !bgEl.getAttribute('data-bg')) {
      BG = nextBG; bgEl.src = BG.src; handleEl.src = BG.overlay.src; bgEl.setAttribute('data-bg', BG.src);
    }
    const k = Math.max(WW / BG.w, WH / BG.h);
    bgBox = { w: BG.w * k, h: BG.h * k, x: 0, y: 0, k };
    Object.assign(bgEl.style, { width: bgBox.w + 'px', height: bgBox.h + 'px' });
    const map = r => ({ x1: r.x1 * k, y1: r.y1 * k, x2: Math.min(r.x2 * k, WW + BG.bleed), y2: Math.min(r.y2 * k, WH + BG.bleed) });
    HANDLES = BG.handles.map(map);
    DOORS = BG.doors.map(map);
    const ov = BG.overlay;
    Object.assign(handleEl.style, { left: ov.x * k + 'px', top: ov.y * k + 'px', width: ov.w * k + 'px', height: ov.h * k + 'px' });
    stage.style.width = WW + 'px'; stage.style.height = WH + 'px';
  }
  function layout() {
    setWorld();
    const W = stageWrap.clientWidth, H = stageWrap.clientHeight;
    base = Math.min(W / WW, H / WH);
    scale = base * zoom;
    if (viewCX === null || zoom === 1) { viewCX = WW / 2; viewCY = WH / 2; }
    offX = WW * scale <= W ? (W - WW * scale) / 2 : clamp(W / 2 - viewCX * scale, W - WW * scale, 0);
    offY = WH * scale <= H ? (H - WH * scale) / 2 : clamp(H / 2 - viewCY * scale, H - WH * scale, 0);
    viewCX = (W / 2 - offX) / scale; viewCY = (H / 2 - offY) / scale;
    stage.style.transform = `translate(${offX}px, ${offY}px) scale(${scale})`;
    placeIntro();
    placeToolbar();
  }
  let fitTimer;
  function onResize() {
    layout();
    clearTimeout(fitTimer);
    fitTimer = setTimeout(refit, 150);
  }
  // Si cambia la forma de la pantalla (por ejemplo al girar el teléfono), los objetos se reparten
  // para ocupar todo el ancho: si nadie tocó nada, se rearma el acomodo inicial; si no, se estira.
  function refit() {
    if (itemsWW && (Math.abs(WW - itemsWW) > 2 || (itemsWH && itemsWH !== WH))) {
      if (pristine) { initialLayout(); return; }
      const fx = WW / itemsWW, fy = WH / (itemsWH || WH);
      items.forEach(it => { it.x *= fx; it.y *= fy; });
      if (introPos) { introPos.x *= fx; introPos.y *= fy; }
      itemsWW = WW; itemsWH = WH;
    }
    items.forEach(it => { settle(it); render(it); }); checkPapers(); placeIntro();
    keepPristine = true; save(); keepPristine = false;
  }
  function toStage(cx, cy) {
    const r = stageWrap.getBoundingClientRect();
    return { x: (cx - r.left - offX) / scale, y: (cy - r.top - offY) / scale };
  }
  function zoomAt(newZoom, cx, cy) {
    const r = stageWrap.getBoundingClientRect();
    const p = toStage(cx, cy);
    zoom = clamp(newZoom, 1, 4);
    const s = base * zoom;
    viewCX = (r.width / 2 - (cx - r.left - p.x * s)) / s;
    viewCY = (r.height / 2 - (cy - r.top - p.y * s)) / s;
    layout();
  }

  // ---------- fondo: tocar para deseleccionar, Shift+arrastrar para seleccionar un área,
  //            pellizcar para zoom, arrastrar para moverse con zoom ----------
  const touches = new Map();
  let pinch = null, pan = null, marquee = null;
  const marqueeEl = $('marquee');
  stageWrap.addEventListener('pointerdown', e => {
    if (e.target.closest('.item')) return;
    if (e.shiftKey && e.pointerType === 'mouse') {
      marquee = { x: e.clientX, y: e.clientY, id: e.pointerId };
      stageWrap.setPointerCapture(e.pointerId);
      return;
    }
    select(null);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stageWrap.setPointerCapture(e.pointerId);
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom }; pan = null;
    } else if (touches.size === 1) pan = { x: e.clientX, y: e.clientY };
  });
  stageWrap.addEventListener('pointermove', e => {
    if (marquee && e.pointerId === marquee.id) {
      const x1 = Math.min(marquee.x, e.clientX), y1 = Math.min(marquee.y, e.clientY);
      Object.assign(marqueeEl.style, { left: x1 + 'px', top: y1 + 'px', width: Math.abs(e.clientX - marquee.x) + 'px', height: Math.abs(e.clientY - marquee.y) + 'px' });
      marqueeEl.hidden = false;
      return;
    }
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      zoomAt(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (pan && zoom > 1) {
      viewCX -= (e.clientX - pan.x) / scale; viewCY -= (e.clientY - pan.y) / scale;
      pan = { x: e.clientX, y: e.clientY };
      layout();
    }
  });
  const endTouch = e => {
    if (marquee && e.pointerId === marquee.id) {
      const r = { x1: Math.min(marquee.x, e.clientX), y1: Math.min(marquee.y, e.clientY), x2: Math.max(marquee.x, e.clientX), y2: Math.max(marquee.y, e.clientY) };
      marquee = null; marqueeEl.hidden = true;
      for (const it of items) {
        const b = els.get(it.uid).getBoundingClientRect();
        if (inRect(b.left + b.width / 2, b.top + b.height / 2, r)) sel.add(it.uid);
      }
      refreshSelection();
      return;
    }
    touches.delete(e.pointerId); if (touches.size < 2) pinch = null; if (!touches.size) pan = null;
  };
  stageWrap.addEventListener('pointerup', endTouch);
  stageWrap.addEventListener('pointercancel', endTouch);
  stageWrap.addEventListener('wheel', e => {
    if (e.target.closest('.item') && sel.size) return; // la rueda sobre lo seleccionado lo gira
    e.preventDefault();
    zoomAt(zoom * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
  }, { passive: false });

  // ---------- dibujar los imanes ----------
  const UPLOAD_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 4h9.5l-2 2H5v10.6l3.5-4.1 2.6 3 3.6-4.6L19 16.3V11h2v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm13-2 4 4h-3v4h-2V6h-3l4-4ZM8.5 7.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z"/></svg>';
  const PEN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m14.06 6.19 3.75 3.75L7.75 20H4v-3.75L14.06 6.19Zm1.41-1.41 1.83-1.83a1 1 0 0 1 1.41 0l2.34 2.34a1 1 0 0 1 0 1.41l-1.83 1.83-3.75-3.75Z"/></svg>';
  const rectStyle = (d, win) => `left:${win[0] * d.w}px;top:${win[1] * d.h}px;width:${win[2] * d.w}px;height:${win[3] * d.h}px`;
  function placeholder(d, win, icon, text) {
    const fs = Math.max(8, Math.min(win[2] * d.w, win[3] * d.h) * (d.draw ? 0.07 : 0.12));
    return `<div class="placeholder" style="${rectStyle(d, win)};font-size:${fs}px">${icon}<span>${text}</span></div>`;
  }
  function buildEl(item) {
    const d = def(item);
    const el = document.createElement('div');
    el.className = 'item';
    el.style.width = d.w + 'px'; el.style.height = d.h + 'px';
    let inner = '';
    if (d.type === 'flag') inner = flagHTML(item.flag || d.flag, 'flag');
    else inner = `<img src="${src(d.id)}" alt="" draggable="false">`;
    if (d.type === 'frame') inner += `<img class="photo" alt="" draggable="false" style="${rectStyle(d, d.win)}">` + placeholder(d, d.win, UPLOAD_SVG, 'Subir foto');
    if (d.draw) inner += `<img class="drawing" alt="" draggable="false" style="${rectStyle(d, d.draw)}">` + placeholder(d, d.draw, PEN_SVG, 'Tocá para dibujar');
    if (d.label) inner += `<div class="tape-label" style="${rectStyle(d, d.label)}"></div>`;
    // .body es la capa que se anima (así la animación nunca mueve la posición del imán)
    el.innerHTML = `<div class="body">${inner}</div>`;
    if (d.type === 'flag') flagFallbacks(el, 'flag');
    el.addEventListener('pointerdown', e => startDrag(e, item));
    el.addEventListener('wheel', e => {
      if (!sel.has(item.uid)) return;
      e.preventDefault(); selItems().forEach(it => rotateItem(it, e.deltaY > 0 ? 5 : -5)); afterChange();
    }, { passive: false });
    return el;
  }
  function render(item) {
    let el = els.get(item.uid);
    if (!el) { el = buildEl(item); els.set(item.uid, el); itemsEl.appendChild(el); }
    const d = def(item);
    el.style.transform = `translate(${item.x - d.w / 2}px, ${item.y - d.h / 2}px) rotate(${item.r || 0}deg)`;
    el.style.zIndex = item.dragging ? 200000 + item.z : item.z;
    el.classList.toggle('selected', sel.has(item.uid));
    if (d.type === 'frame') {
      const p = el.querySelector('.photo');
      if (item.photo && p.getAttribute('src') !== item.photo) p.src = item.photo;
      p.hidden = !item.photo; el.querySelector('.placeholder').hidden = !!item.photo;
    }
    if (d.draw) {
      const p = el.querySelector('.drawing');
      if (item.drawing && p.getAttribute('src') !== item.drawing) p.src = item.drawing;
      p.hidden = !item.drawing; el.querySelector('.placeholder').hidden = !!item.drawing;
    }
    if (d.label) {
      const lb = el.querySelector('.tape-label');
      const t = item.text !== undefined ? item.text : d.text;
      if (lb.textContent !== t) {
        lb.textContent = t;
        lb.style.fontSize = fitFont(t, d.label[2] * d.w, d.label[3] * d.h) + 'px';
      }
    }
  }
  function removeEl(uid) { const el = els.get(uid); if (el) el.remove(); els.delete(uid); }
  function clearAll() { els.forEach(el => el.remove()); els.clear(); items = []; sliding.clear(); sel.clear(); placeToolbar(); }

  // ---------- reglas de pegado ----------
  // El imán se pega donde lo soltás; solo si cae fuera de la chapa se acerca al borde.
  // Puede quedar por debajo de la manija.
  function settle(item) {
    let best = null, bd = Infinity;
    for (const d of DOORS) {
      const x = clamp(item.x, d.x1 + 4, d.x2 - 4), y = clamp(item.y, d.y1 + 4, d.y2 - 4);
      const dd = Math.hypot(x - item.x, y - item.y);
      if (dd < bd) { bd = dd; best = { x, y }; }
    }
    if (best) { item.x = best.x; item.y = best.y; }
    return item;
  }

  // ---------- papeles: se sostienen solo con un imán encima ----------
  function holders(paper) {
    const b = box(paper, 0.46);
    return items.filter(o => o !== paper && !isPaper(o) && !o.dragging && o.z > paper.z && inRect(o.x, o.y, b));
  }
  const floorY = p => DOORS[DOORS.length - 1].y2 + def(p).h * 0.5 - def(p).h * 0.38;
  function checkPapers() {
    for (const p of items) {
      if (!isPaper(p) || p.dragging) continue;
      if (holders(p).length || p.y >= floorY(p) - 1) { sliding.delete(p.uid); continue; }
      if (!sliding.has(p.uid)) { sliding.set(p.uid, 0); say('El papel se resbala… ¡ponele un imán encima!'); }
    }
    if (sliding.size) startPhysics();
  }
  let physRunning = false, lastT = 0;
  function startPhysics() {
    if (physRunning) return;
    physRunning = true; lastT = performance.now(); requestAnimationFrame(tick);
  }
  function tick(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
    for (const [uid, v] of sliding) {
      const p = byUid(uid);
      if (!p || p.dragging) { sliding.delete(uid); continue; }
      if (holders(p).length) { sliding.delete(uid); clack(0.5); continue; }
      const nv = Math.min(v + 420 * dt, 1300);
      sliding.set(uid, nv);
      p.y += nv * dt;
      p.r = (p.r || 0) + Math.sin(t / 200 + uid) * 3 * dt;
      if (p.y >= floorY(p)) { p.y = floorY(p); sliding.delete(uid); swoosh(); say('Se cayó hasta abajo. Subilo y sostenelo con un imán.'); }
      render(p);
    }
    if (sliding.size) requestAnimationFrame(tick); else { physRunning = false; save(); }
  }

  // ---------- selección y opciones ----------
  const selItems = () => items.filter(it => sel.has(it.uid));
  function select(uid, additive = false) {
    if (!additive) sel.clear();
    if (uid !== null && uid !== undefined) {
      if (additive && sel.has(uid)) sel.delete(uid); else sel.add(uid);
    }
    refreshSelection();
  }
  function refreshSelection() {
    for (const [uid, el] of els) el.classList.toggle('selected', sel.has(uid));
    placeToolbar();
  }
  function placeToolbar() {
    const list = selItems();
    if (!list.length || list.some(it => it.dragging)) { toolbar.hidden = true; return; }
    const one = list.length === 1 ? list[0] : null;
    const show = { photo: one && isFrame(one), draw: one && isSheet(one), text: one && hasLabel(one), flag: one && isFlag(one) };
    for (const b of toolbar.querySelectorAll('button')) b.hidden = b.dataset.act in show && !show[b.dataset.act];
    toolbar.hidden = false;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const it of list) {
      const r = els.get(it.uid).getBoundingClientRect();
      x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
    }
    const tw = toolbar.offsetWidth, th = toolbar.offsetHeight;
    const x = clamp((x1 + x2) / 2, tw / 2 + 6, window.innerWidth - tw / 2 - 6);
    let y = y1 - 10;
    if (y - th < 50) y = Math.min(y2 + th + 10, window.innerHeight - 8);
    toolbar.style.left = x + 'px'; toolbar.style.top = y + 'px';
  }
  function rotateItem(it, deg) { it.r = ((it.r || 0) + deg) % 360; render(it); }
  function afterChange() { placeToolbar(); checkPapers(); save(); }
  toolbar.addEventListener('pointerdown', e => e.stopPropagation());
  toolbar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const list = selItems(); if (!list.length) return;
    const act = b.dataset.act;
    if (act === 'rotate') { list.forEach(it => rotateItem(it, 15)); peel(); afterChange(); }
    if (act === 'front') { list.sort((a, c) => a.z - c.z).forEach(it => { it.z = topZ(); render(it); }); peel(); afterChange(); }
    if (act === 'back') { list.sort((a, c) => c.z - a.z).forEach(it => { it.z = bottomZ(); render(it); }); peel(); afterChange(); }
    if (act === 'delete') deleteItems(list);
    if (act === 'photo') pickPhoto(list[0]);
    if (act === 'draw') openDraw(list[0]);
    if (act === 'text') openText(list[0]);
    if (act === 'flag') openFlags(list[0]);
  });

  // ---------- eliminar (con deshacer) ----------
  function deleteItems(list) {
    if (!list.length) return;
    const removed = list.map(it => it);
    removed.forEach(it => { removeEl(it.uid); sliding.delete(it.uid); });
    items = items.filter(it => !removed.includes(it));
    sel.clear(); placeToolbar(); swoosh(); checkPapers(); save();
    lastDeleted = removed;
    say(removed.length === 1 ? 'Objeto eliminado' : `${removed.length} objetos eliminados`, undoDelete);
  }
  let lastDeleted = null;
  function undoDelete() {
    if (!lastDeleted) return;
    lastDeleted.forEach(it => { items.push(it); render(it); });
    lastDeleted = null; clack(0.7); checkPapers(); save();
  }

  // ---------- arrastrar (uno o varios) ----------
  let drag = null;
  function startDrag(e, item) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    drag = { item, sx: e.clientX, sy: e.clientY, shift: e.shiftKey, started: false, pointerId: e.pointerId };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }
  function beginDrag() {
    const it = drag.item;
    const group = sel.has(it.uid) && sel.size > 1 ? selItems() : [it];
    if (group.length === 1) select(null);
    const p0 = toStage(drag.sx, drag.sy);
    drag.group = group.map(g => ({ it: g, dx: g.x - p0.x, dy: g.y - p0.y }));
    for (const { it: g } of drag.group) {
      g.dragging = true; sliding.delete(g.uid);
      render(g);
      const el = els.get(g.uid), body = el.querySelector('.body');
      el.classList.add('dragging');
      body.classList.remove('snap'); void body.offsetWidth; body.classList.add('lifted');
    }
    placeToolbar(); hideIntro(); checkPapers(); peel();
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < DRAG_THRESHOLD) return;
      drag.started = true; beginDrag();
    }
    e.preventDefault();
    const p = toStage(e.clientX, e.clientY);
    for (const { it, dx, dy } of drag.group) { it.x = p.x + dx; it.y = p.y + dy; render(it); }
  }
  function endListeners() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  }
  function finishDrag() {
    const group = drag.group.map(g => g.it).sort((a, b) => a.z - b.z);
    drag = null;
    for (const it of group) { it.dragging = false; settle(it); it.z = topZ(); }
    for (const it of group) {
      if (isPaper(it)) {
        // el papel queda debajo de los imanes que ya están encima suyo
        const b = box(it, 0.46);
        const over = items.filter(o => !isPaper(o) && !group.includes(o) && inRect(o.x, o.y, b));
        if (over.length) it.z = Math.min(...over.map(o => o.z)) - 1;
      }
      render(it);
      const el = els.get(it.uid), body = el.querySelector('.body');
      el.classList.remove('dragging');
      body.classList.remove('lifted'); void body.offsetWidth; body.classList.add('snap');
    }
    clack(group.every(isPaper) ? 0.5 : 1);
    afterChange();
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endListeners();
    if (drag.started) { finishDrag(); return; }
    // fue un toque
    const it = drag.item, shift = drag.shift; drag = null;
    hideIntro();
    if (shift) { select(it.uid, true); return; }
    const already = sel.size === 1 && sel.has(it.uid);
    if (isFrame(it) && !it.photo) { select(it.uid); pickPhoto(it); return; }
    if (isSheet(it) && !it.drawing) { select(it.uid); openDraw(it); return; }
    if (isFlag(it) && !already) { select(it.uid); openFlags(it); return; }
    select(already ? null : it.uid);
  }
  function onCancel(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endListeners();
    if (drag.started) finishDrag(); else drag = null;
  }

  // ---------- fotos en los portarretratos ----------
  let photoTarget = null;
  function pickPhoto(item) { photoTarget = item; filePick.value = ''; filePick.click(); }
  filePick.addEventListener('change', async () => {
    const file = filePick.files && filePick.files[0];
    const item = photoTarget; photoTarget = null;
    if (!file || !item) return;
    try { item.photo = await shrinkImage(file, 700); render(item); save(); clack(0.5); }
    catch { say('No pude abrir esa imagen 😕'); }
  });
  function shrinkImage(file, max) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(); };
      img.src = url;
    });
  }

  // ---------- dibujar en la hoja ----------
  const COLORS = ['#1d1d1f', '#e63946', '#1d6fd8', '#2a9d55', '#f4c430', '#f77f00', '#ff6fae', '#7b3fbf', '#8b5a2b'];
  const dCanvas = $('drawCanvas'), dctx = dCanvas.getContext('2d');
  let drawTarget = null, penColor = COLORS[0], penSize = 10, erasing = false, history = [], stroke = null;
  $('drawColors').innerHTML = COLORS.map((c, i) => `<button data-c="${c}" style="background:${c}"${i ? '' : ' class="on"'}></button>`).join('');
  $('drawColors').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    penColor = b.dataset.c; erasing = false; $('drawEraser').classList.remove('on');
    $('drawColors').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  };
  document.querySelector('.sizes').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    penSize = +b.dataset.size;
    document.querySelectorAll('.sizes button').forEach(x => x.classList.toggle('on', x === b));
  };
  $('drawEraser').onclick = () => { erasing = !erasing; $('drawEraser').classList.toggle('on', erasing); };
  const snapshot = () => { history.push(dctx.getImageData(0, 0, dCanvas.width, dCanvas.height)); if (history.length > 25) history.shift(); };
  $('drawUndo').onclick = () => { const h = history.pop(); if (h) dctx.putImageData(h, 0, 0); };
  $('drawClear').onclick = () => { snapshot(); dctx.clearRect(0, 0, dCanvas.width, dCanvas.height); };
  function openDraw(item) {
    const d = def(item), [wx, wy, ww, wh] = d.draw;
    drawTarget = item; history = [];
    Object.assign(dCanvas.style, { left: wx * 100 + '%', top: wy * 100 + '%', width: ww * 100 + '%', height: wh * 100 + '%' });
    dCanvas.width = 1000; dCanvas.height = Math.round(1000 * (wh * d.h) / (ww * d.w));
    dctx.clearRect(0, 0, dCanvas.width, dCanvas.height);
    if (item.drawing) { const im = new Image(); im.onload = () => dctx.drawImage(im, 0, 0, dCanvas.width, dCanvas.height); im.src = item.drawing; }
    $('drawModal').hidden = false;
  }
  function canvasPoint(e) {
    const r = dCanvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * dCanvas.width / r.width, y: (e.clientY - r.top) * dCanvas.height / r.height };
  }
  dCanvas.addEventListener('pointerdown', e => {
    e.preventDefault(); dCanvas.setPointerCapture(e.pointerId); snapshot();
    const p = canvasPoint(e);
    stroke = { last: p, mid: p };
    dctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
    dctx.strokeStyle = dctx.fillStyle = penColor;
    dctx.lineWidth = penSize * (erasing ? 2.2 : 1) * dCanvas.width / 600;
    dctx.lineCap = dctx.lineJoin = 'round';
    dctx.beginPath(); dctx.arc(p.x, p.y, dctx.lineWidth / 2, 0, Math.PI * 2); dctx.fill();
  });
  dCanvas.addEventListener('pointermove', e => {
    if (!stroke) return;
    const p = canvasPoint(e), mid = { x: (stroke.last.x + p.x) / 2, y: (stroke.last.y + p.y) / 2 };
    dctx.beginPath(); dctx.moveTo(stroke.mid.x, stroke.mid.y); dctx.quadraticCurveTo(stroke.last.x, stroke.last.y, mid.x, mid.y); dctx.stroke();
    stroke.last = p; stroke.mid = mid;
  });
  const endStroke = () => { stroke = null; dctx.globalCompositeOperation = 'source-over'; };
  dCanvas.addEventListener('pointerup', endStroke);
  dCanvas.addEventListener('pointercancel', endStroke);
  $('drawCancel').onclick = () => { $('drawModal').hidden = true; drawTarget = null; };
  $('drawDone').onclick = () => {
    const it = drawTarget; $('drawModal').hidden = true; drawTarget = null;
    if (!it) return;
    const px = dctx.getImageData(0, 0, dCanvas.width, dCanvas.height).data;
    let empty = true; for (let i = 3; i < px.length; i += 16) if (px[i]) { empty = false; break; }
    it.drawing = empty ? null : dCanvas.toDataURL('image/png');
    render(it); save(); clack(0.5);
  };

  // ---------- escribir en el cassette ----------
  let textTarget = null;
  function openText(item) {
    textTarget = item;
    $('textInput').value = item.text !== undefined ? item.text : def(item).text;
    $('textModal').hidden = false;
    setTimeout(() => { $('textInput').focus(); $('textInput').select(); }, 30);
  }
  function closeText(ok) {
    const it = textTarget; $('textModal').hidden = true; textTarget = null;
    if (ok && it) { it.text = $('textInput').value.trim(); render(it); save(); }
  }
  $('textOk').onclick = () => closeText(true);
  $('textCancel').onclick = () => closeText(false);
  $('textInput').addEventListener('keydown', e => { if (e.key === 'Enter') closeText(true); });

  // ---------- elegir bandera ----------
  let flagTarget = null, flagsBuilt = false;
  function buildFlags() {
    flagsBuilt = true;
    const list = FLAG_CODES.map(c => ({ c, n: flagName(c) })).sort((a, b) => (a.c === 'AR' ? -1 : b.c === 'AR' ? 1 : a.n.localeCompare(b.n, 'es')));
    $('flagGrid').innerHTML = list.map(({ c, n }) => `<button data-c="${c}" data-n="${n.toLowerCase()} ${c.toLowerCase()}">${flagHTML(c, 'pick')}<span>${n}</span></button>`).join('');
    flagFallbacks($('flagGrid'), 'pick');
  }
  function openFlags(item) {
    flagTarget = item;
    if (!flagsBuilt) buildFlags();
    $('flagSearch').value = ''; filterFlags();
    $('flagModal').hidden = false;
  }
  function filterFlags() {
    const q = $('flagSearch').value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    $('flagGrid').querySelectorAll('button').forEach(b => { b.hidden = q && !b.dataset.n.normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q); });
  }
  $('flagSearch').addEventListener('input', filterFlags);
  $('flagClose').onclick = () => { $('flagModal').hidden = true; flagTarget = null; };
  $('flagGrid').onclick = e => {
    const b = e.target.closest('button'); if (!b || !flagTarget) return;
    const it = flagTarget; flagTarget = null; $('flagModal').hidden = true;
    it.flag = b.dataset.c; removeEl(it.uid); render(it); refreshSelection(); save(); clack(0.7);
  };

  // ---------- texto de bienvenida debajo del título ----------
  function placeIntro() {
    if (!introPos) return;
    Object.assign(introEl.style, { left: introPos.x + 'px', top: introPos.y + 'px', fontSize: Math.max(14, 10.5 / scale) + 'px' });
  }
  function showIntro() { introEl.hidden = false; introEl.classList.remove('gone'); placeIntro(); }
  function hideIntro() { if (!introEl.hidden) { introEl.classList.add('gone'); setTimeout(() => { introEl.hidden = true; }, 500); } }

  // ---------- acomodo inicial: todo alrededor, "FREEZER CRAFT" en el medio ----------
  function initialLayout() {
    clearAll();
    nextUid = 1;
    const rand = rng(20261116);
    const add = (id, x, y, r) => { const it = { uid: nextUid++, id, x, y, r, z: nextUid }; items.push(it); return it; };
    const hx = HANDLES.length ? HANDLES[0].x2 : 0;
    const top = DOORS[0];
    const CX = WW / 2, CY = (Math.max(0, top.y1) + Math.min(WH, top.y2)) / 2 - 22;   // centrado en la pantalla

    // 1) el título
    const used = new Set(), titleBoxes = [];
    const rowGap = 64, letterGap = 7;
    TITLE.forEach((row, ri) => {
      const ws = row.map(id => BY_ID[id].w);
      const total = ws.reduce((a, b) => a + b, 0) + letterGap * (row.length - 1);
      let x = CX - total / 2;
      const y = CY + (ri - (TITLE.length - 1) / 2) * rowGap;
      row.forEach((id, i) => {
        const it = add(id, x + ws[i] / 2, y + (rand() - 0.5) * 6, Math.round((rand() - 0.5) * 12));
        x += ws[i] + letterGap; used.add(id); titleBoxes.push(box(it, 0.45));
      });
    });
    introPos = { x: CX, y: CY + rowGap / 2 + 38 };

    // 2) grilla de ocupación por el CUERPO de cada imán (sin la sombra), en celdas de 2 unidades:
    //    0 = libre, 1 = imán, 2 = prohibido, 3 = papel (se puede poner un imán encima)
    const C = 2, GW = Math.ceil(WW / C), GH = Math.ceil(WH / C);
    const occ = new Uint8Array(GW * GH);
    const span = r => [Math.max(0, Math.floor(r.x1 / C)), Math.max(0, Math.floor(r.y1 / C)), Math.min(GW, Math.ceil(r.x2 / C)), Math.min(GH, Math.ceil(r.y2 / C))];
    const mark = (r, v = 1) => {
      const [x0, y0, x1, y1] = span(r);
      for (let gy = y0; gy < y1; gy++) for (let gx = x0; gx < x1; gx++) {
        const i = gy * GW + gx, o = occ[i];
        if (v === 2 || o === 0 || (v === 1 && o === 3)) occ[i] = v;
      }
      satDirty = true;
    };
    const inDoor = r => DOORS.some(d => r.x1 >= d.x1 + 2 && r.y1 >= d.y1 + 2 && r.x2 <= d.x2 - 2 && r.y2 <= d.y2 - 2);
    // sumas acumuladas de celdas ocupadas (A: cualquier cosa; B: todo menos papeles)
    const SW = GW + 1, satA = new Int32Array(SW * (GH + 1)), satB = new Int32Array(SW * (GH + 1));
    let satDirty = true;
    const buildSat = () => {
      for (let gy = 0; gy < GH; gy++) {
        let ra = 0, rb = 0;
        for (let gx = 0; gx < GW; gx++) {
          const o = occ[gy * GW + gx]; ra += o ? 1 : 0; rb += (o === 1 || o === 2) ? 1 : 0;
          const k = (gy + 1) * SW + gx + 1; satA[k] = satA[k - SW] + ra; satB[k] = satB[k - SW] + rb;
        }
      }
      satDirty = false;
    };
    const free = (r, overPaper) => {
      if (!inDoor(r)) return false;
      if (satDirty) buildSat();
      const [x0, y0, x1, y1] = span(r), t = overPaper ? satB : satA;
      return t[y1 * SW + x1] - t[y0 * SW + x1] - t[y1 * SW + x0] + t[y0 * SW + x0] === 0;
    };
    const cost = r => {
      if (!inDoor(r)) return Infinity;
      const [x0, y0, x1, y1] = span(r); let n = 0;
      for (let gy = y0; gy < y1; gy++) for (let gx = x0; gx < x1; gx++) { const o = occ[gy * GW + gx]; if (o === 2) return Infinity; if (o === 1) n++; }
      return n;
    };
    // cuerpo real del imán (sin sombra), girado
    const bodyBox = (it, pad = 0) => {
      const d = def(it), bb = d.body || [0.08, 0.08, 0.92, 0.92];
      const rad = (it.r || 0) * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const [fx, fy] of [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]]) {
        const lx = (fx - 0.5) * d.w, ly = (fy - 0.5) * d.h, X = it.x + lx * cs - ly * sn, Y = it.y + lx * sn + ly * cs;
        x1 = Math.min(x1, X); y1 = Math.min(y1, Y); x2 = Math.max(x2, X); y2 = Math.max(y2, Y);
      }
      return { x1: x1 - pad, y1: y1 - pad, x2: x2 + pad, y2: y2 + pad };
    };

    // lo que no se tapa: el título, el texto de bienvenida y los botones (debajo de la manija SÍ se puede)
    items.forEach(it => mark(bodyBox(it, 6), 2));
    showIntro();
    const iw = introEl.offsetWidth || 360, ih = introEl.offsetHeight || 60;
    mark({ x1: introPos.x - iw / 2 - 8, y1: introPos.y - 4, x2: introPos.x + iw / 2 + 8, y2: introPos.y + ih + 6 }, 2);
    const markEl = (el, pad = 6) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const p = toStage(r.left, r.top), q = toStage(r.right, r.bottom), e = pad / scale;
      mark({ x1: p.x - e, y1: p.y - e, x2: q.x + e, y2: q.y + e }, 2);
    };
    if (matchMedia('(orientation: portrait) and (pointer: coarse)').matches) {
      // juego girado (celular en vertical): las medidas de pantalla vienen giradas, se usan franjas fijas
      const u = 1 / base;
      mark({ x1: 0, y1: 0, x2: 200 * u, y2: 52 * u }, 2);
      mark({ x1: WW - 330 * u, y1: 0, x2: WW, y2: 52 * u }, 2);
      mark({ x1: 0, y1: WH - 62 * u, x2: 130 * u, y2: WH }, 2);
      mark({ x1: WW - 90 * u, y1: WH - 90 * u, x2: WW, y2: WH }, 2);
    } else ['.logo', '.actions', '#btnGallery', '#btnCamera'].forEach(q => markEl(document.querySelector(q)));

    // 3) lugares candidatos, de afuera hacia adentro, con un poco de azar
    const cand = [];
    for (let y = 6; y < WH; y += 6) for (let x = 6; x < WW; x += 6) {
      cand.push({ x, y, k: Math.hypot((x - CX) / (WW * 0.5), (y - CY) / (WH * 0.5)) + rand() * 0.18 });
    }
    cand.sort((a, b) => b.k - a.k);

    // 4) papeles y portarretratos primero, después los grandes, después todo mezclado.
    //    Ningún imán encima de otro; solo pueden quedar encima de los papeles (que se caen sin imán).
    const rest = window.MAGNETS.filter(m => !used.has(m.id) && !HOLDER_BALLS.includes(m.id));
    const special = rest.filter(m => m.type === 'paper' || m.type === 'frame');
    const normal = rest.filter(m => !special.includes(m)).sort((a, b) => b.w * b.h - a.w * a.h);
    const big = normal.slice(0, 24), small = normal.slice(24);
    for (let i = small.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [small[i], small[j]] = [small[j], small[i]]; }
    const holderQueue = [...HOLDER_BALLS];
    let overlaps = 0, onPaper = 0;

    for (const m of [...special, ...big, ...small]) {
      const isSpecial = special.includes(m), r0 = Math.round((rand() - 0.5) * 16), pad = 0.5;
      let spot = null;
      for (const overPaper of isSpecial ? [false] : [false, true]) {
        for (const r of [r0, 0, -r0 * 0.5]) {
          for (const c of cand) {
            const bx = bodyBox({ id: m.id, x: c.x, y: c.y, r }, pad);
            if (free(bx, overPaper)) { spot = { c, r, b: bodyBox({ id: m.id, x: c.x, y: c.y, r }) }; if (overPaper) onPaper++; break; }
          }
          if (spot) break;
        }
        if (spot) break;
      }
      if (!spot) {  // no entra en ningún lado: donde menos tape
        overlaps++;
        let best = Infinity;
        for (let i = 0; i < cand.length; i += 2) {
          const c = cand[i], bx = bodyBox({ id: m.id, x: c.x, y: c.y, r: r0 }), k = cost(bx);
          if (k < best) { best = k; spot = { c, r: r0, b: bx }; }
        }
      }
      const c = spot ? spot.c : cand[Math.floor(rand() * 400)];
      const it = settle(add(m.id, c.x, c.y, spot ? spot.r : r0));
      if (spot) mark(spot.b, m.type === 'paper' ? 3 : m.type === 'frame' ? 2 : 1);
      if (m.type === 'paper' && holderQueue.length) {
        const ball = add(holderQueue.shift(), it.x + (rand() - 0.5) * 16, it.y - m.h * 0.27, 0);
        mark(bodyBox(ball), 1);
      }
    }
    holderQueue.forEach(id => { const c = cand[Math.floor(rand() * 300)]; settle(add(id, c.x, c.y, 0)); });
    window.__pnjOverlaps = overlaps;
    window.__pnjOnPaper = onPaper;
    items.forEach(render);
    showIntro();
    itemsWW = WW; itemsWH = WH;
    keepPristine = true; save(); keepPristine = false;
    pristine = true;
  }

  // ---------- guardar / cargar ----------
  let saveTimer;
  function saveNow() {
    clearTimeout(saveTimer);
    try {
      const data = items.map(({ id, x, y, r, z, photo, drawing, text, flag }) => ({ id, x: Math.round(x), y: Math.round(y), r, z, photo, drawing, text, flag }));
      localStorage.setItem(SAVE_KEY, JSON.stringify({ items: data, intro: introPos, ww: itemsWW, wh: itemsWH, pristine }));
    } catch { say('No entra más nada en la memoria de este navegador (probá con fotos o dibujos más simples).'); }
  }
  function save() { if (!keepPristine) pristine = false; clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); }
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!data || !data.items || !data.items.length) return false;
      items = data.items.filter(i => BY_ID[i.id]).map(i => ({ ...i, uid: nextUid++ }));
      introPos = data.intro || null;
      itemsWW = data.ww || WW;
      itemsWH = data.wh || 775;
      pristine = !!data.pristine;
      items.forEach(settle);
      return true;
    } catch { return false; }
  }

  // ---------- foto de la tapa de la heladera ----------
  const loadImg = (s, cors) => new Promise((res, rej) => {
    const i = new Image(); if (cors) i.crossOrigin = 'anonymous';
    i.onload = () => res(i); i.onerror = rej; i.src = s;
  });
  async function renderShot() {
    const R = 1.5;
    const c = document.createElement('canvas'); c.width = Math.round(WW * R); c.height = Math.round(WH * R);
    const g = c.getContext('2d');
    g.scale(R, R);
    g.drawImage(await loadImg(BG.src), 0, 0, bgBox.w, bgBox.h);
    const fillRect = async (s, d, win) => {
      const p = await loadImg(s);
      const [wx, wy, ww, wh] = win, W = ww * d.w, H = wh * d.h;
      g.drawImage(p, -d.w / 2 + wx * d.w, -d.h / 2 + wy * d.h, W, H);
    };
    for (const it of [...items].sort((a, b) => a.z - b.z)) {
      const d = def(it);
      g.save();
      g.translate(it.x, it.y); g.rotate((it.r || 0) * Math.PI / 180);
      g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 2; g.shadowOffsetY = 1;
      if (d.type === 'flag') {
        const emo = () => { g.font = `${d.h * 0.86}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(flagEmoji(it.flag || d.flag), 0, d.h * 0.04); };
        if (nativeFlags) emo();
        else { try { g.drawImage(await loadImg(flagURL(it.flag || d.flag), true), -d.w / 2, -d.h / 2, d.w, d.h); } catch { emo(); } }
      } else g.drawImage(await loadImg(src(d.id)), -d.w / 2, -d.h / 2, d.w, d.h);
      g.shadowColor = 'transparent';
      if (d.type === 'frame' && it.photo) {
        const p = await loadImg(it.photo);
        const [wx, wy, ww, wh] = d.win;
        const W = ww * d.w, H = wh * d.h, k = Math.max(W / p.naturalWidth, H / p.naturalHeight);
        const sw = W / k, sh = H / k;
        g.drawImage(p, (p.naturalWidth - sw) / 2, (p.naturalHeight - sh) / 2, sw, sh, -d.w / 2 + wx * d.w, -d.h / 2 + wy * d.h, W, H);
      }
      if (d.draw && it.drawing) await fillRect(it.drawing, d, d.draw);
      if (d.label) {
        const t = it.text !== undefined ? it.text : d.text;
        const [lx, ly, lw, lh] = d.label;
        g.font = `${fitFont(t, lw * d.w, lh * d.h)}px ${HAND_FONT}`;
        g.fillStyle = '#f4efe2'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(t, -d.w / 2 + (lx + lw / 2) * d.w, -d.h / 2 + (ly + lh / 2) * d.h);
      }
      g.restore();
    }
    g.save();
    g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 10; g.shadowOffsetX = 6; g.shadowOffsetY = 4;
    const ov = BG.overlay, kk = bgBox.k;
    g.drawImage(await loadImg(ov.src), ov.x * kk, ov.y * kk, ov.w * kk, ov.h * kk);
    g.restore();
    return new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
  }
  function download(url, name) {
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  const slug = t => (t || 'mi-heladera').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'mi-heladera';

  let shotBlob = null, shotURL = null;
  $('btnCamera').onclick = async () => {
    select(null);
    const fl = $('flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
    shutter();
    try {
      shotBlob = await renderShot();
      if (shotURL) URL.revokeObjectURL(shotURL);
      shotURL = URL.createObjectURL(shotBlob);
      $('shotImg').src = shotURL;
      $('shotUpload').disabled = false; $('shotUpload').textContent = 'Subir a la galería';
      $('shotModal').hidden = false;
      setTimeout(() => $('shotName').focus(), 50);
    } catch { say('No pude sacar la foto. Abrí el juego desde un servidor (ver README).'); }
  };
  $('shotCancel').onclick = () => { $('shotModal').hidden = true; };
  $('shotDownload').onclick = () => download(shotURL, slug($('shotName').value) + '.jpg');
  $('shotUpload').onclick = async () => {
    const b = $('shotUpload'); b.disabled = true; b.textContent = 'Subiendo…';
    try {
      await window.Gallery.add(shotBlob, $('shotName').value.trim());
      $('shotModal').hidden = true; $('shotName').value = '';
      say('¡Tu heladera ya está en la galería! 🎉');
      openGallery('recent');
    } catch {
      b.disabled = false; b.textContent = 'Reintentar';
      say('No se pudo subir. Probá de nuevo en un rato.');
    }
  };

  // ---------- galería ----------
  // Mundial (Supabase): pestañas Recientes / Top 10 y un corazón para votar cada heladera.
  let viewing = null, galleryView = 'recent';
  const esc = t => String(t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const heartHTML = p => `<span class="h">♥</span> <span class="n">${p.votes || 0}</span>`;
  async function vote(p, btns) {
    btns.forEach(b => b.disabled = true);
    try {
      const r = await window.Gallery.vote(p.id);
      p.votes = r.votes; p.voted = r.voted;
      btns.forEach(b => { b.innerHTML = heartHTML(p); b.classList.toggle('voted', p.voted); b.classList.remove('pop'); void b.offsetWidth; if (p.voted) b.classList.add('pop'); });
    } catch { say('No se pudo votar. Probá de nuevo.'); }
    btns.forEach(b => b.disabled = false);
  }
  async function openGallery(view) {
    if (view) galleryView = view;
    $('galleryModal').hidden = false;
    $('galleryKind').textContent = window.Gallery.shared ? 'de todo el mundo' : 'en este dispositivo';
    $('galleryTabs').hidden = !window.Gallery.shared;
    document.querySelectorAll('#galleryTabs button').forEach(b => b.classList.toggle('on', b.dataset.view === galleryView));
    const grid = $('galleryGrid'); grid.innerHTML = '';
    grid.classList.toggle('ranked', galleryView === 'top');
    let list = [];
    try { list = await window.Gallery.list(galleryView === 'top' ? { top: 10 } : {}); } catch { say('No pude cargar la galería.'); }
    $('galleryEmpty').hidden = list.length > 0;
    list.forEach((p, i) => {
      const f = document.createElement('figure');
      const when = p.created ? new Date(p.created).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      f.innerHTML = (galleryView === 'top' ? `<span class="rank">#${i + 1}</span>` : '') +
        `<img src="${p.url}" alt="" loading="lazy"><figcaption>${p.name ? `<b>${esc(p.name)}</b>` : ''}<small>${when}</small></figcaption>`;
      if (window.Gallery.shared) {
        const h = document.createElement('button');
        h.className = 'heart' + (p.voted ? ' voted' : ''); h.title = 'Votar'; h.innerHTML = heartHTML(p);
        h.onclick = e => { e.stopPropagation(); vote(p, [h]); };
        f.querySelector('figcaption').appendChild(h);
        p._cardHeart = h;
      }
      f.onclick = () => openViewer(p);
      grid.appendChild(f);
    });
  }
  function openViewer(p) {
    viewing = p;
    $('viewerImg').src = p.url;
    $('viewerName').textContent = p.name || '';
    $('viewerDelete').hidden = !p.canDelete;
    const vb = $('viewerVote');
    vb.hidden = !window.Gallery.shared;
    if (window.Gallery.shared) { vb.innerHTML = heartHTML(p); vb.classList.toggle('voted', !!p.voted); }
    $('viewer').hidden = false;
  }
  $('viewerVote').onclick = () => { if (viewing) vote(viewing, [$('viewerVote'), viewing._cardHeart].filter(Boolean)); };
  document.querySelectorAll('#galleryTabs button').forEach(b => { b.onclick = () => openGallery(b.dataset.view); });
  $('btnGallery').onclick = () => openGallery();
  $('galleryClose').onclick = () => { $('galleryModal').hidden = true; };
  $('viewerClose').onclick = () => { $('viewer').hidden = true; };
  $('viewerDownload').onclick = async () => {
    if (!viewing) return;
    try { const b = await (await fetch(viewing.url)).blob(); const u = URL.createObjectURL(b); download(u, slug(viewing.name) + '.jpg'); setTimeout(() => URL.revokeObjectURL(u), 2000); }
    catch { window.open(viewing.url, '_blank'); }
  };
  $('viewerDelete').onclick = async () => {
    if (!viewing) return;
    await window.Gallery.remove(viewing.id);
    $('viewer').hidden = true; openGallery();
  };

  // ---------- empezar de nuevo ----------
  const btnReset = $('btnReset'); let resetArmed;
  btnReset.onclick = () => {
    const label = btnReset.querySelector('span');
    if (!btnReset.classList.contains('armed')) {
      btnReset.classList.add('armed'); label.textContent = '¿Seguro? Tocá de nuevo';
      clearTimeout(resetArmed);
      resetArmed = setTimeout(() => { btnReset.classList.remove('armed'); label.textContent = 'Empezar de nuevo'; }, 2600);
      return;
    }
    clearTimeout(resetArmed); btnReset.classList.remove('armed'); label.textContent = 'Empezar de nuevo';
    zoom = 1; layout(); initialLayout(); swoosh();
  };

  // ---------- teclado ----------
  window.addEventListener('keydown', e => {
    if (typing(e)) return;
    const openModal = ['viewer', 'drawModal', 'textModal', 'flagModal', 'shotModal', 'galleryModal'].find(id => !$(id).hidden);
    if (e.key === 'Escape') { if (openModal) $(openModal).hidden = true; else select(null); return; }
    if (openModal) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoDelete(); return; }
    const list = selItems(); if (!list.length) return;
    const step = e.shiftKey ? 20 : 4;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteItems(list); }
    else if (e.key === 'r' || e.key === 'R') { list.forEach(it => rotateItem(it, e.shiftKey ? -15 : 15)); afterChange(); }
    else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      list.forEach(it => { it.x += dx; it.y += dy; settle(it); render(it); });
      afterChange();
    }
  });

  // ---------- arranque ----------
  window.addEventListener('resize', onResize);
  const lateResize = () => [60, 250, 600, 1200].forEach(t => setTimeout(onResize, t));
  window.addEventListener('orientationchange', lateResize);
  if (window.visualViewport) visualViewport.addEventListener('resize', onResize);
  matchMedia('(orientation: portrait)').addEventListener?.('change', lateResize);
  new ResizeObserver(onResize).observe(stageWrap);
  layout();
  if (load()) { items.forEach(render); refit(); }
  else initialLayout();
})();
