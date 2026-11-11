// Dial-Up Lifeline UI prototype (Home, SOS builder, transmit, inbox).
// Built against .kiro/specs/lifeline-app; Rescue Mode, i18n and offline map come next.
import './style.css';
import { transmit, listen, type Listener } from './audio/io';
import { encodeSos, decodeSos, FLAGS, type Flag, type Sos } from './ui/sos';

const ICON: Record<Flag, [string, string]> = {
  injured: ['🩸', 'Injured'], trapped: ['🧱', 'Trapped'], water: ['💧', 'Water'],
  medicine: ['💊', 'Medicine'], fire: ['🔥', 'Fire'], children: ['🧒', 'Children'], elderly: ['🧓', 'Elderly'],
};

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<header class="flicker">DIAL-UP LIFELINE <small id="status">● OFFLINE OK</small></header>
<div class="term" id="term" aria-live="polite"></div>
<canvas class="scope" id="scope" aria-hidden="true"></canvas>

<section id="home" class="big">
  <button class="help" id="btnHelp">I NEED HELP</button>
  <button class="safe" id="btnSafe">I'M SAFE</button>
  <button class="safe" id="btnListen">👂 START LISTENING</button>
</section>

<section id="builder" class="big hidden">
  <div class="row" id="chips"></div>
  <div class="people"><button id="pMinus" aria-label="Fewer people">−</button><span>PEOPLE: <b id="pNum">1</b></span><button id="pPlus" aria-label="More people">+</button></div>
  <input type="text" id="note" maxlength="40" placeholder="Landmark / note (optional)" />
  <button class="send" id="btnSend">📡 SEND SOS</button>
  <button class="safe" id="btnBack">← BACK</button>
</section>

<section id="inbox" class="inbox"></section>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const term = $('term');
const log = (msg: string, cls = '') => {
  const d = document.createElement('div');
  d.className = 'l ' + cls;
  d.textContent = msg;
  term.appendChild(d);
  while (term.children.length > 6) term.firstChild?.remove();
};
log('ATZ'); log('OK'); log('ATDT 0-LIFELINE ... READY');

// ---- oscilloscope ----
const scope = $<HTMLCanvasElement>('scope');
const g = scope.getContext('2d')!;
function drawScope(s: Float32Array) {
  const w = (scope.width = scope.clientWidth * devicePixelRatio);
  const h = (scope.height = scope.clientHeight * devicePixelRatio);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = '#33ff66'; g.lineWidth = 2 * devicePixelRatio; g.shadowColor = '#33ff66'; g.shadowBlur = 8;
  g.beginPath();
  const n = Math.min(s.length, 1024);
  for (let i = 0; i < n; i++) {
    const x = (i / n) * w, y = h / 2 - (s[i] ?? 0) * h * 0.45;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
}
drawScope(new Float32Array(256));

// ---- builder ----
const chosen = new Set<Flag>();
let people = 1;
const chips = $('chips');
for (const f of FLAGS) {
  const b = document.createElement('button');
  b.className = 'chip'; b.setAttribute('aria-pressed', 'false');
  b.innerHTML = `<span>${ICON[f][0]}</span>${ICON[f][1]}`;
  b.onclick = () => {
    chosen.has(f) ? chosen.delete(f) : chosen.add(f);
    b.setAttribute('aria-pressed', String(chosen.has(f)));
    navigator.vibrate?.(15);
  };
  chips.appendChild(b);
}
$('pMinus').onclick = () => ($('pNum').textContent = String((people = Math.max(0, people - 1))));
$('pPlus').onclick = () => ($('pNum').textContent = String((people = Math.min(15, people + 1))));
const show = (id: 'home' | 'builder') => {
  $('home').classList.toggle('hidden', id !== 'home');
  $('builder').classList.toggle('hidden', id !== 'builder');
};
$('btnHelp').onclick = () => show('builder');
$('btnBack').onclick = () => show('home');

function position(): Promise<{ lat?: number; lon?: number }> {
  return new Promise((res) => {
    if (!navigator.geolocation) return res({});
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => res({}), { enableHighAccuracy: true, timeout: 6000 });
  });
}

let listener: Listener | null = null;
const seen = new Set<string>();

async function send(kind: 'SOS' | 'OK') {
  const pos = await position();
  const sos: Sos = {
    kind, id: Math.random().toString(36).slice(2, 8), flags: [...chosen], people,
    ...pos, note: ($<HTMLInputElement>('note').value || undefined), time: Date.now(),
  };
  seen.add(sos.id);
  log(`ATDT ${kind} #${sos.id} ...`, 'warn');
  if (listener) listener.muted = true;
  for (let i = 0; i < 2; i++) {
    await transmit(encodeSos(sos), drawScope);
    log(`CONNECT 1200 · PACKET ${i + 1}/2 SENT`);
    await new Promise((r) => setTimeout(r, 400));
  }
  if (listener) listener.muted = false;
  log('NO CARRIER · listening for replies');
  show('home');
}
$('btnSend').onclick = () => send('SOS');
$('btnSafe').onclick = () => send('OK');

// ---- receive ----
function render(s: Sos) {
  const c = document.createElement('div');
  c.className = 'card ' + (s.kind === 'SOS' ? 'sos' : '');
  const icons = s.flags.map((f) => ICON[f][0]).join(' ');
  c.innerHTML = `<h3>${s.kind === 'SOS' ? '🆘 HELP NEEDED' : '✅ SAFE'} ${icons}</h3>
    <div>${s.people} people${s.note ? ' · ' + s.note.replace(/[<>&]/g, '') : ''}</div>
    <div class="meta">#${s.id} · ${new Date(s.time).toLocaleTimeString()}${s.lat !== undefined ? ` · ${s.lat.toFixed(4)}, ${s.lon?.toFixed(4)}` : ''}</div>`;
  $('inbox').prepend(c);
}
$('btnListen').onclick = async () => {
  if (listener) return;
  try {
    listener = await listen((payload) => {
      const s = decodeSos(payload);
      if (!s || seen.has(s.id)) return;
      seen.add(s.id);
      log(`CARRIER DETECT · ${s.kind} #${s.id}`, s.kind === 'SOS' ? 'err' : '');
      navigator.vibrate?.([200, 100, 200]);
      render(s);
    }, drawScope);
    $('btnListen').textContent = '👂 LISTENING…';
    $('status').textContent = '● LISTENING';
    log('MIC OPEN · waiting for carrier');
  } catch {
    log('MIC BLOCKED · allow microphone access', 'err');
  }
};
