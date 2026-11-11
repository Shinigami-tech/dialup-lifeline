// Dial-Up Lifeline UI (spec: .kiro/specs/lifeline-app).
import './style.css';
import { transmit, listen, type Listener } from './audio/io';
import { encodeMsg, decodeMsg, newId, urgency, distanceBearing, FLAGS, type Flag, type Msg } from './ui/sos';
import { t, setLang, lang, LANGS, LANG_NAMES, type Lang } from './i18n';
import { saveMsg, loadMsgs } from './store';

type Case = Msg & { status?: 'onway' | 'resolved' };
const NAV_ICON = { home: '🏠', inbox: '📻', rescue: '🚑', settings: '⚙️' } as const;
const ICON: Record<Flag, string> = { injured: '🩸', trapped: '🧱', water: '💧', medicine: '💊', fire: '🔥', children: '🧒', elderly: '🧓' };
const pref = (k: string, d: boolean) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
const setPref = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* ignore */ } };

const state = {
  tab: 'home' as 'home' | 'builder' | 'inbox' | 'rescue' | 'settings',
  chosen: new Set<Flag>(),
  people: 1,
  note: '',
  cases: new Map<string, Case>(),
  acked: new Set<string>(), // our SOS ids that got an ACK
  mine: new Set<string>(),
  sending: null as null | { msg: Msg; timer: number },
  listener: null as Listener | null,
  pos: null as null | { lat: number; lon: number },
  rescue: pref('rescue', false),
  drill: pref('drill', false),
  plain: pref('plain', false),
};
const logLines: { text: string; cls: string }[] = ['ATZ', 'OK', 'ATDT 0-LIFELINE … READY'].map((text) => ({ text, cls: '' }));
function log(text: string, cls = '') {
  logLines.push({ text, cls });
  while (logLines.length > 5) logLines.shift();
  paintLog();
}
function paintLog() {
  const term = document.getElementById('term');
  if (term) term.innerHTML = logLines.map((l) => `<div class="l ${l.cls}">${esc(l.text)}</div>`).join('');
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// ---------- scope ----------
let scopeData: Float32Array = new Float32Array(256);
function drawScope() {
  const c = document.getElementById('scope') as HTMLCanvasElement | null;
  if (!c) return;
  const g = c.getContext('2d')!;
  const w = (c.width = c.clientWidth * devicePixelRatio), h = (c.height = c.clientHeight * devicePixelRatio);
  const col = state.plain ? '#ffffff' : '#33ff66';
  g.clearRect(0, 0, w, h);
  g.strokeStyle = col; g.lineWidth = 2 * devicePixelRatio; g.shadowColor = col; g.shadowBlur = state.plain ? 0 : 8;
  g.beginPath();
  const n = Math.min(scopeData.length, 1024);
  for (let i = 0; i < n; i++) {
    const x = (i / n) * w, y = h / 2 - (scopeData[i] ?? 0) * h * 0.45;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.stroke();
}
const onSamples = (s: Float32Array) => { scopeData = s; requestAnimationFrame(drawScope); };

// ---------- radio ----------
async function position(): Promise<{ lat?: number; lon?: number }> {
  return new Promise((res) => {
    if (!navigator.geolocation) return res({});
    navigator.geolocation.getCurrentPosition(
      (p) => { state.pos = { lat: p.coords.latitude, lon: p.coords.longitude }; res(state.pos); },
      () => res({}), { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 });
  });
}

let txBusy = false;
async function sendRaw(m: Msg) {
  while (txBusy) await new Promise((r) => setTimeout(r, 200));
  txBusy = true;
  if (state.listener) state.listener.muted = true;
  try {
    await transmit(encodeMsg(m), onSamples);
  } finally {
    if (state.listener) state.listener.muted = false;
    txBusy = false;
  }
}

async function sendSos(kind: 'SOS' | 'OK') {
  await ensureListening();
  const pos = await position();
  const msg: Msg = { kind, id: newId(), flags: kind === 'SOS' ? [...state.chosen] : [], people: state.people, ...pos,
    note: state.note || undefined, drill: state.drill, hop: 0, time: Date.now() };
  state.mine.add(msg.id);
  stopSending();
  const once = async (n: number) => {
    log(`ATDT ${kind} #${msg.id} …`, 'warn');
    for (let i = 0; i < 2; i++) {
      await sendRaw(msg);
      log(`CONNECT 1200 · PACKET ${i + 1}/2`);
      await new Promise((r) => setTimeout(r, 400));
    }
    log(n === 0 && kind === 'SOS' ? t().repeating : 'NO CARRIER');
  };
  await once(0);
  if (kind === 'SOS') {
    let n = 1;
    const timer = window.setInterval(() => { if (!state.acked.has(msg.id)) void once(n++); else stopSending(); }, 60000);
    state.sending = { msg, timer };
  }
  state.tab = 'home';
  render();
}
function stopSending() {
  if (state.sending) clearInterval(state.sending.timer);
  state.sending = null;
}

async function ensureListening() {
  if (state.listener) return;
  try {
    state.listener = await listen(onFrame, onSamples);
    log('MIC OPEN · WAITING FOR CARRIER');
  } catch {
    log(t().micBlocked, 'err');
  }
  render();
}

function onFrame(payload: Uint8Array) {
  const m = decodeMsg(payload);
  if (!m) return;
  if (m.kind === 'ACK' && m.ref && state.mine.has(m.ref)) {
    if (!state.acked.has(m.ref)) {
      state.acked.add(m.ref);
      stopSending();
      log(`ACK · ${t().heardYou.toUpperCase()}`, 'ok');
      navigator.vibrate?.([300, 120, 300, 120, 600]);
      render();
    }
    return;
  }
  if (m.kind === 'INFO' && m.ref) {
    const c = state.cases.get(m.ref);
    if (c) { c.status = (m.note === 'resolved' ? 'resolved' : 'onway'); void saveMsg(c); render(); }
    if (state.mine.has(m.ref)) { state.acked.add(m.ref); stopSending(); render(); }
    return;
  }
  if (m.kind !== 'SOS' && m.kind !== 'OK') return;
  if (state.mine.has(m.id) || state.cases.has(m.id)) return;
  state.cases.set(m.id, m);
  void saveMsg(m);
  log(`CARRIER DETECT · ${m.kind} #${m.id}`, m.kind === 'SOS' ? 'err' : 'ok');
  navigator.vibrate?.([200, 100, 200]);
  if (state.rescue && m.kind === 'SOS') {
    void sendRaw({ kind: 'ACK', id: newId(), ref: m.id, flags: [], people: 0, hop: 0, drill: m.drill, time: Date.now() });
    log(`ACK SENT → #${m.id}`, 'ok');
  }
  render();
}

function setCaseStatus(id: string, status: 'onway' | 'resolved') {
  const c = state.cases.get(id);
  if (!c) return;
  c.status = status;
  void saveMsg(c);
  void sendRaw({ kind: 'INFO', id: newId(), ref: id, flags: [], people: 0, hop: 0, note: status, drill: c.drill, time: Date.now() });
  render();
}

// ---------- views ----------
function fmtDist(m: number) { return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`; }
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function where(c: Case): string {
  if (state.pos && c.lat !== undefined && c.lon !== undefined) {
    const { m, deg } = distanceBearing(state.pos.lat, state.pos.lon, c.lat, c.lon);
    const i = Math.round(deg / 45) % 8;
    return t().away(fmtDist(m), `${['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][i]} ${DIRS[i]}`);
  }
  if (c.lat !== undefined && c.lon !== undefined) return `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`;
  return '';
}
function card(c: Case, actions: boolean) {
  const T = t();
  const age = Math.max(0, Math.round((Date.now() - c.time) / 60000));
  const st = c.status === 'resolved' ? `<span class="tag ok">${T.resolved}</span>` : c.status === 'onway' ? `<span class="tag warn">${T.onTheWay}</span>` : '';
  return `<div class="card ${c.kind === 'SOS' ? 'sos' : ''} ${c.status === 'resolved' ? 'done' : ''}">
    <h3>${c.kind === 'SOS' ? '🆘 ' + T.sosCard : '✅ ' + T.okCard} <span class="icons">${c.flags.map((f) => ICON[f]).join(' ')}</span></h3>
    <div>${T.peopleN(c.people)}${c.note ? ' · ' + esc(c.note) : ''}</div>
    <div class="meta">${c.drill ? `<span class="tag">${T.drillTag}</span> ` : ''}#${c.id} · ${age} min · ${T.hops(c.hop)} ${where(c) ? '· ' + where(c) : ''} ${st}</div>
    ${actions && c.kind === 'SOS' && c.status !== 'resolved' ? `<div class="row act">
      <button class="mini" data-act="onway" data-id="${c.id}">🚑 ${T.onTheWay}</button>
      <button class="mini" data-act="resolved" data-id="${c.id}">✔ ${T.resolved}</button></div>` : ''}
  </div>`;
}

function radar(cases: Case[]) {
  const c = document.getElementById('radar') as HTMLCanvasElement | null;
  if (!c) return;
  const g = c.getContext('2d')!;
  const side = c.clientWidth;

  const w = (c.width = side * devicePixelRatio), h = (c.height = side * devicePixelRatio);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 8;
  const fg = state.plain ? '#ffffff' : '#33ff66';
  g.clearRect(0, 0, w, h);
  g.strokeStyle = fg; g.globalAlpha = 0.35; g.lineWidth = devicePixelRatio;
  for (const k of [1, 2, 3]) { g.beginPath(); g.arc(cx, cy, (r * k) / 3, 0, Math.PI * 2); g.stroke(); }
  g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.stroke();
  g.globalAlpha = 1;
  const pts = cases.filter((k) => k.lat !== undefined && k.lon !== undefined && state.pos)
    .map((k) => ({ k, ...distanceBearing(state.pos!.lat, state.pos!.lon, k.lat!, k.lon!) }));
  const max = Math.max(200, ...pts.map((p) => p.m));
  g.font = `${11 * devicePixelRatio}px monospace`; g.fillStyle = fg;
  g.fillText(fmtDist(max), cx + 4, cy - r + 12 * devicePixelRatio);
  for (const p of pts) {
    const rad = (p.deg * Math.PI) / 180, d = (p.m / max) * r;
    const x = cx + Math.sin(rad) * d, y = cy - Math.cos(rad) * d;
    g.fillStyle = p.k.status === 'resolved' ? '#888' : p.k.kind === 'SOS' ? '#ff3b3b' : fg;
    g.beginPath(); g.arc(x, y, 7 * devicePixelRatio, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = fg; g.beginPath(); g.arc(cx, cy, 4 * devicePixelRatio, 0, Math.PI * 2); g.fill();
}

function render() {
  const T = t();
  document.body.classList.toggle('plain', state.plain);
  const app = document.getElementById('app')!;
  const cases = [...state.cases.values()];
  const sos = cases.filter((c) => c.kind === 'SOS');
  const myAck = [...state.mine].some((id) => state.acked.has(id));
  const tabs = (['home', 'inbox', 'rescue', 'settings'] as const).map((k) =>
    `<button class="${state.tab === k || (k === 'home' && state.tab === 'builder') ? 'on' : ''}" data-tab="${k}"><span class="ni">${NAV_ICON[k]}${k === 'inbox' && sos.length ? `<b class="badge">${sos.length}</b>` : ''}</span><span class="nl">${T[k]}</span></button>`).join('');

  let body = '';
  if (state.tab === 'home') {
    body = `
      ${myAck ? `<div class="heard">📡 ${T.heardYou}</div>` : ''}
      ${state.sending ? `<button class="stop" data-do="stop">■ ${T.stop}</button><p class="hint">${T.repeating}</p>` : ''}
      <section class="big">
        <button class="help" data-do="help">${T.help}</button>
        <button class="safe" data-do="ok">${T.safe}</button>
        <button class="safe" data-do="listen">👂 ${state.listener ? T.listening : T.listen}</button>
      </section>`;
  } else if (state.tab === 'builder') {
    body = `<section class="big">
      <div class="row">${FLAGS.map((f) => `<button class="chip" aria-pressed="${state.chosen.has(f)}" data-flag="${f}"><span>${ICON[f]}</span>${T[f]}</button>`).join('')}</div>
      <div class="people"><button data-do="minus" aria-label="−">−</button><span>${T.people}: <b>${state.people}</b></span><button data-do="plus" aria-label="+">+</button></div>
      <input type="text" id="note" maxlength="40" placeholder="${T.notePh}" value="${esc(state.note)}" />
      <button class="send" data-do="send">📡 ${T.send}</button>
      <button class="safe" data-do="back">${T.back}</button></section>`;
  } else if (state.tab === 'inbox') {
    const list = cases.sort((a, b) => b.time - a.time);
    body = `<section class="inbox">${list.length ? list.map((c) => card(c, false)).join('') : `<p class="hint">${T.noCases}</p>`}</section>`;
  } else if (state.tab === 'rescue') {
    const list = sos.sort((a, b) => (a.status === 'resolved' ? 1 : 0) - (b.status === 'resolved' ? 1 : 0) || urgency(b) - urgency(a));
    body = `<p class="hint">${T.rescueIntro}</p>
      <label class="toggle"><input type="checkbox" data-pref="rescue" ${state.rescue ? 'checked' : ''}/> ${T.rescue}: ${state.rescue ? 'ON' : 'OFF'}</label>
      <canvas id="radar" class="radar" aria-hidden="true"></canvas>
      <section class="inbox">${list.length ? list.map((c) => card(c, true)).join('') : `<p class="hint">${T.noCases}</p>`}</section>`;
  } else {
    body = `<section class="settings">
      <label>${T.language}<select id="lang">${(Object.keys(LANGS) as Lang[]).map((l) => `<option value="${l}" ${l === lang() ? 'selected' : ''}>${LANG_NAMES[l]}</option>`).join('')}</select></label>
      <label class="toggle"><input type="checkbox" data-pref="drill" ${state.drill ? 'checked' : ''}/> ${T.drill}</label>
      <label class="toggle"><input type="checkbox" data-pref="plain" ${state.plain ? 'checked' : ''}/> ${T.theme}</label>
      <p class="meta">Dial-Up Lifeline · Bell 202 AFSK 1200 baud · works offline · MIT</p></section>`;
  }

  app.innerHTML = `
    <header class="flicker">DIAL-UP LIFELINE <small>${state.drill ? `<span class="tag">${T.drillTag}</span> ` : ''}${state.listener ? '● RX' : '○ RX'}</small></header>
    <div class="term" id="term" aria-live="polite"></div>
    <canvas class="scope" id="scope" aria-hidden="true"></canvas>
    ${body}
    <nav class="nav">${tabs}</nav>`;
  paintLog();
  drawScope();
  if (state.tab === 'rescue') radar(sos);
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!el) return;
  const tab = el.dataset.tab as typeof state.tab | undefined;
  if (tab) { state.tab = tab; if (tab === 'rescue') void ensureListening(); if (tab === 'rescue') void position().then(render); render(); return; }
  if (el.dataset.flag) {
    const f = el.dataset.flag as Flag;
    state.chosen.has(f) ? state.chosen.delete(f) : state.chosen.add(f);
    navigator.vibrate?.(15);
    render();
    return;
  }
  if (el.dataset.act && el.dataset.id) { setCaseStatus(el.dataset.id, el.dataset.act as 'onway' | 'resolved'); return; }
  switch (el.dataset.do) {
    case 'help': state.tab = 'builder'; render(); break;
    case 'back': state.tab = 'home'; render(); break;
    case 'minus': state.people = Math.max(0, state.people - 1); render(); break;
    case 'plus': state.people = Math.min(15, state.people + 1); render(); break;
    case 'send': state.note = (document.getElementById('note') as HTMLInputElement)?.value ?? ''; void sendSos('SOS'); break;
    case 'ok': void sendSos('OK'); break;
    case 'listen': void ensureListening(); break;
    case 'stop': stopSending(); render(); break;
  }
});
document.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  if (el.id === 'lang') { setLang(el.value as Lang); render(); return; }
  const k = (el as HTMLInputElement).dataset.pref as 'rescue' | 'drill' | 'plain' | undefined;
  if (k) { state[k] = (el as HTMLInputElement).checked; setPref(k, state[k]); if (k === 'rescue' && state[k]) void ensureListening(); render(); }
});
document.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'note') state.note = el.value;
});

// ---------- boot ----------
setLang(lang());
void loadMsgs().then((list) => {
  for (const m of list) if (m.kind === 'SOS' || m.kind === 'OK') state.cases.set(m.id, m as Case);
  render();
});
render();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* offline install optional */ });
}
// test hook used by the end-to-end demo / e2e tests (no network, pure in-page)
(window as unknown as { __lifeline: unknown }).__lifeline = { onFrame, encodeMsg, state };
