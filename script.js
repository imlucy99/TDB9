/* =========================================================
   JGVRP Speedometer HUD  -  Kluster analog 4 dial (gaya Aston Martin DB9 generasi awal)
     [Fuel kecil] [Speedo MPH + km/h] [Tacho CCW] [Oil PSI kecil]
   API (dipanggil dari game / CEF):
     setSpeed(m/s)            setRPM(0.0 - 1.0)   (1.0 = 8000 rpm)
     setFuel(0-1 | 0-100)     setHealth(0-1 | 0-1000)  -> jarum OIL PSI
     setGear(n)               setHeadlights(0 off | 1 low | 2 high)
     setSeatbelts(bool)       updateLockStatus(state)
     setOdometer(miles)       setEngine(bool)
     setTrip(miles) / resetTrip()   (opsional; kalau tidak dipanggil, trip dihitung otomatis dari selisih odometer)
   Efek:
     setEngine(true)  -> dial jadi terang + jarum menyapu (kontak ON), tacho menyapu counter-clockwise
     setHeadlights(1|2) -> semua jarum menyala (glow), seperti lampu dashboard asli
   ========================================================= */

const MPS_TO_MPH = 2.236936;
const KMH_PER_MPH = 1.609344;
const MAX_MPH = 220;        // ring luar speedo
const MAX_KMH = 330;        // ring dalam speedo
const MAX_RPM = 8;          // skala tachometer (x1000)
const REDLINE = 7.0;        // mulai zona merah (x1000)
const LIMITER = 0.96;       // RPM (0-1) mulai dianggap kena limiter -> jarum geter
const OIL_MAX_PSI = 150;    // skala penuh gauge oli
const OIL_NORMAL_PSI = 80;  // tekanan oli saat health 100%

const NOOP_EL = document.createElement('div');   // pengaman kalau ada elemen yang dihapus dari HTML
const $ = (id) => document.getElementById(id) || NOOP_EL;
const elHud = $('hud');
const svg = $('dial');

function isLockedState(val) {
    return val === true || val === 1 || val === '1' || val === 'true' || val === 2 || val === '2';
}
function isTrueValue(val) {
    return val === true || val === 1 || val === '1' || val === 'true';
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ---------- Geometri (viewBox 1774 x 710, mengikuti gambar referensi) ----------
// a0 = sudut jarum di nilai 0 (derajat layar, 0 = kanan, 90 = bawah). sweep > 0 searah jarum jam, sweep < 0 BERLAWANAN.
const SPD  = { cx: 572,  cy: 432, bezel: 308, a0: 68,  sweep: 223 };    // 0 kanan-bawah -> 220 kanan-atas (CW); sisi kanan dikosongkan untuk layar LCD
const RPM  = { cx: 1202, cy: 432, bezel: 308, a0: 112, sweep: -223 };   // cermin speedo (seperti DB9): 0 kiri-bawah -> naik lewat bawah, kanan, atas -> 8 kiri-atas (CCW); sisi kiri kosong untuk layar
const FUEL = { cx: 130,  cy: 552, bezel: 126, a0: 155, sweep: 170 };    // E kiri-bawah -> F kanan-atas
const OIL  = { cx: 1642, cy: 552, bezel: 126, a0: 145, sweep: 215 };    // 0 kiri-bawah -> 150 kanan
const rimOf = (g) => Math.round(g.bezel * 0.07);
[SPD, RPM, FUEL, OIL].forEach((g) => { g.face = g.bezel - rimOf(g) - 4; });

const pol = (cx, cy, r, a) => {
    const t = (a * Math.PI) / 180;
    return [(cx + r * Math.cos(t)).toFixed(2), (cy + r * Math.sin(t)).toFixed(2)];
};
// Sektor (a1 -> a2 searah jarum jam; beri a1 < a2)
function sector(cx, cy, r1, r2, a1, a2) {
    const [x1, y1] = pol(cx, cy, r2, a1), [x2, y2] = pol(cx, cy, r2, a2);
    const [x3, y3] = pol(cx, cy, r1, a2), [x4, y4] = pol(cx, cy, r1, a1);
    const large = a2 - a1 > 180 ? 1 : 0;
    return `M${x1} ${y1}A${r2} ${r2} 0 ${large} 1 ${x2} ${y2}L${x3} ${y3}A${r1} ${r1} 0 ${large} 0 ${x4} ${y4}Z`;
}
function arcPath(cx, cy, r, a1, a2) {
    const [x1, y1] = pol(cx, cy, r, a1), [x2, y2] = pol(cx, cy, r, a2);
    return `M${x1} ${y1}A${r} ${r} 0 ${Math.abs(a2 - a1) > 180 ? 1 : 0} ${a2 > a1 ? 1 : 0} ${x2} ${y2}`;
}
const tick = (cx, cy, a, r1, r2, w, cls) => {
    const [x1, y1] = pol(cx, cy, r1, a), [x2, y2] = pol(cx, cy, r2, a);
    return `<line class="${cls || 'tk'}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${w}"/>`;
};
const txt = (cls, x, y, size, s) => `<text class="${cls}" x="${x}" y="${y}" font-size="${size}">${s}</text>`;

// Bezel krom tebal (dua gradien berlawanan = efek bevel) + muka dial arang
function bezelFace(g) {
    const rim = rimOf(g);
    return `
    <circle cx="${g.cx}" cy="${g.cy}" r="${g.bezel + 12}" fill="url(#dropG)"/>
    <circle cx="${g.cx}" cy="${g.cy}" r="${g.bezel}" fill="url(#chromeA)"/>
    <circle cx="${g.cx}" cy="${g.cy}" r="${(g.bezel - rim * 0.5).toFixed(1)}" fill="url(#chromeB)"/>
    <circle cx="${g.cx}" cy="${g.cy}" r="${g.bezel - rim}" fill="#050506"/>
    <circle cx="${g.cx}" cy="${g.cy}" r="${g.face}" fill="url(#faceG)"/>
    <circle cx="${g.cx}" cy="${g.cy}" r="${g.face}" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="2"/>`;
}
const shade = (g) => `<circle class="shade" cx="${g.cx}" cy="${g.cy}" r="${g.face}"/>`;

// Jarum ramping perak (dua sisi, efek 3D) + cap krom di tengah
function needle(id, g, L, hubR, tail, w) {
    const hw = w || 3.2;
    return `
    <g id="${id}" class="nd" transform="translate(${g.cx} ${g.cy}) rotate(0)">
      <path class="nd-a" d="M${-tail} 0L${-tail} ${-hw * 0.7}L0 ${-hw}L${L} -0.6L${L} 0Z"/>
      <path class="nd-b" d="M${-tail} 0L${-tail} ${hw * 0.7}L0 ${hw}L${L} 0.6L${L} 0Z"/>
    </g>
    <circle cx="${g.cx}" cy="${g.cy}" r="${hubR}" fill="url(#chromeA)"/>
    <circle cx="${g.cx}" cy="${g.cy}" r="${(hubR * 0.86).toFixed(1)}" fill="url(#chromeB)"/>
    <circle cx="${g.cx}" cy="${g.cy}" r="${(hubR * 0.7).toFixed(1)}" fill="url(#hubG)"/>
    <circle class="hub-ring" cx="${g.cx}" cy="${g.cy}" r="${hubR - 1}"/>
    <ellipse cx="${(g.cx - hubR * 0.22).toFixed(1)}" cy="${(g.cy - hubR * 0.28).toFixed(1)}" rx="${(hubR * 0.34).toFixed(1)}" ry="${(hubR * 0.18).toFixed(1)}" fill="rgba(255,255,255,0.16)"/>`;
}

// Ikon (viewBox 24x24) ditaruh di (x,y) dengan skala s
const icon = (id, cls, x, y, s, inner) =>
    `<g id="${id}" class="ind ${cls}" transform="translate(${x.toFixed ? x.toFixed(1) : x} ${y}) scale(${s})" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;

const ICON_HEADLIGHT = `
    <path d="M12 4h2a8 8 0 0 1 0 16h-2z" fill="currentColor" fill-opacity=".15"/>
    <g class="beam-low"><path d="M9 5L2 7.5M9 9L2 11.5M9 13L2 15.5M9 17L2 19.5"/></g>
    <g class="beam-high"><path d="M9 6H2M9 10H2M9 14H2M9 18H2"/></g>`;
const ICON_SEATBELT = `
    <circle cx="12" cy="4" r="2.2" fill="currentColor" stroke="none"/>
    <path d="M8 22v-5.5L7 11.5C7 9.6 8.4 8 10.2 8h3.6C15.6 8 17 9.6 17 11.5l-1 5V22"/>
    <path d="M9 8.5l7.5 10"/>`;
const ICON_LOCK = `
    <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="15.2" r="1.4" fill="#0a0a0c" stroke="none"/>
    <path class="shackle-closed" d="M8 11V8a4 4 0 0 1 8 0v3"/>
    <path class="shackle-open" d="M8 11V8a4 4 0 0 1 7.4-2.1"/>`;
const ICON_ENGINE = `<path d="M2 11v5M5 9h3V7h5v2h3l2 2h3v6h-3l-2 2H8l-3-3z"/>`;
const ICON_FUEL = `<path fill="currentColor" stroke="none" d="M19.77 7.23l.01-.01-3.72-3.72L15 4.56l2.11 2.11c-.94.36-1.61 1.26-1.61 2.33 0 1.38 1.12 2.5 2.5 2.5.36 0 .69-.08 1-.21v7.21c0 .55-.45 1-1 1s-1-.45-1-1V14c0-1.1-.9-2-2-2h-1V5c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v16h10v-7.5h1.5v5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V9c0-.69-.28-1.32-.73-1.77zM12 10H6V5h6v5zm6 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/>`;
const ICON_OIL = `<path fill="currentColor" stroke="none" d="M2.5 10h4.2l1.3-2h2V6.5H8V5h6v1.5h-2V8h2.5l2 1.8 5-2.8 1 1.2-6.6 7.3H8.4L7 13H2.5zM20.2 14.6c0-.9 1.1-2.3 1.1-2.3s1.1 1.4 1.1 2.3c0 .6-.5 1.1-1.1 1.1s-1.1-.5-1.1-1.1z"/>`;

// layar LCD (trip + total mil) di sisi kanan hub speedo
const LCD = { x: SPD.cx + 60, y: SPD.cy - 52, w: 190, h: 112 };
// layar pesan peringatan di tachometer (di bawah hub)
const MSG = { x: RPM.cx - 260, y: RPM.cy - 52, w: 200, h: 112 };   // cermin layar speedo, di kiri hub
// bingkai layar LCD (dipakai kedua layar)
const lcdFrame = (r) => `
    <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="8" fill="#2b2d33"/>
    <rect x="${r.x + 3}" y="${r.y + 3}" width="${r.w - 6}" height="${r.h - 6}" rx="6" fill="url(#lcdG)"/>
    <rect class="lcd-shade" x="${r.x + 3}" y="${r.y + 3}" width="${r.w - 6}" height="${r.h - 6}" rx="6"/>
    <line x1="${r.x + 8}" y1="${r.y + 4.5}" x2="${r.x + r.w - 8}" y2="${r.y + 4.5}" stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>
    <path d="M${r.x + 3} ${r.y + 3}H${r.x + r.w * 0.55}L${r.x + r.w * 0.3} ${r.y + r.h - 3}H${r.x + 3}Z" fill="rgba(255,255,255,0.035)"/>`;

function buildDial() {
    const sA = (v) => SPD.a0 + (v / MAX_MPH) * SPD.sweep;        // sudut speedo (mph)
    const kA = (k) => sA(k / KMH_PER_MPH);                        // sudut km/h (sejajar dengan mph)
    const rA = (v) => RPM.a0 + (v / MAX_RPM) * RPM.sweep;         // sudut tacho (CCW karena sweep negatif)
    const fA = (f) => FUEL.a0 + f * FUEL.sweep;                   // sudut fuel (0..1)
    const oA = (p) => OIL.a0 + (p / OIL_MAX_PSI) * OIL.sweep;     // sudut oli (psi)

    let s = `
    <defs>
      <linearGradient id="chromeA" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f7f8fa"/><stop offset="0.16" stop-color="#8d9097"/>
        <stop offset="0.36" stop-color="#26272b"/><stop offset="0.5" stop-color="#d2d5db"/>
        <stop offset="0.64" stop-color="#34353a"/><stop offset="0.82" stop-color="#9da0a7"/>
        <stop offset="1" stop-color="#f1f2f5"/>
      </linearGradient>
      <linearGradient id="chromeB" x1="1" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#e9eaed"/><stop offset="0.28" stop-color="#5a5c62"/>
        <stop offset="0.52" stop-color="#17181b"/><stop offset="0.76" stop-color="#868990"/>
        <stop offset="1" stop-color="#ffffff"/>
      </linearGradient>
      <radialGradient id="faceG" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0.45" style="stop-color:var(--face-a)"/><stop offset="1" style="stop-color:var(--face-b)"/>
      </radialGradient>
      <radialGradient id="dropG" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0.94" stop-color="#000" stop-opacity="0.6"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="lcdG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#101328"/><stop offset="0.5" stop-color="#070812"/><stop offset="1" stop-color="#04050b"/>
      </linearGradient>
      <radialGradient id="hubG" cx="0.4" cy="0.35" r="0.75">
        <stop offset="0" stop-color="#3a3b40"/><stop offset="0.6" stop-color="#0c0c0e"/><stop offset="1" stop-color="#030304"/>
      </radialGradient>
    </defs>`;

    // ----- 4 bezel + muka (kecil dulu, supaya yang besar menimpa bayangan) -----
    s += bezelFace(FUEL) + bezelFace(OIL) + bezelFace(SPD) + bezelFace(RPM);

    // ----- FUEL (kiri kecil): E kiri-bawah -> F kanan-atas -----
    s += `<path class="arc" d="${arcPath(FUEL.cx, FUEL.cy, 104, fA(0), fA(1))}"/>`;
    s += `<path class="arc-red" d="${arcPath(FUEL.cx, FUEL.cy, 100, fA(0), fA(0.12))}"/>`;
    for (let i = 0; i <= 8; i++) s += tick(FUEL.cx, FUEL.cy, fA(i / 8), i % 4 === 0 ? 88 : 96, 104, i % 4 === 0 ? 4 : 2.2);
    {
        const [ex, ey] = pol(FUEL.cx, FUEL.cy, 66, fA(0)), [fx, fy] = pol(FUEL.cx, FUEL.cy, 66, fA(1));
        s += txt('num', ex, ey, 30, 'E') + txt('num', fx, fy, 30, 'F');
    }

    // ----- OIL PSI (kanan kecil): 0 30 60 90 120 150 -----
    s += `<path class="arc" d="${arcPath(OIL.cx, OIL.cy, 104, oA(0), oA(OIL_MAX_PSI))}"/>`;
    s += `<path class="arc-red" d="${arcPath(OIL.cx, OIL.cy, 100, oA(130), oA(OIL_MAX_PSI))}"/>`;
    for (let p = 0; p <= OIL_MAX_PSI; p += 5) {
        const major = p % 30 === 0, mid = p % 10 === 0;
        s += tick(OIL.cx, OIL.cy, oA(p), major ? 88 : mid ? 95 : 99, 104, major ? 4 : mid ? 2.6 : 1.6);
    }
    for (let p = 0; p <= OIL_MAX_PSI; p += 30) {
        const [x, y] = pol(OIL.cx, OIL.cy, 68, oA(p));
        s += txt('num', x, y, 22, p);
    }
    s += txt('lbl', OIL.cx, OIL.cy + 78, 18, 'PSI');

    // ----- SPEEDO (kiri besar): ring luar MPH 0-220, ring dalam km/h 0-330 -----
    for (let v = 0; v <= MAX_MPH; v += 2) {
        const major = v % 20 === 0, mid = v % 10 === 0;
        s += tick(SPD.cx, SPD.cy, sA(v), major ? 244 : mid ? 252 : 259, 272, major ? 5 : mid ? 3.4 : 2);
    }
    for (let v = 0; v <= MAX_MPH; v += 20) {
        const [x, y] = pol(SPD.cx, SPD.cy, 222, sA(v));
        s += txt('num', x, y, 42, v);
    }
    s += txt('lbl', SPD.cx + 164, SPD.cy + 158, 28, 'MPH');   // di celah kanan-bawah, bebas dari angka & tick
    s += `<path class="arc thin" d="${arcPath(SPD.cx, SPD.cy, 176, kA(0), kA(MAX_KMH))}"/>`;
    for (let k = 0; k <= MAX_KMH; k += 5) {
        const major = k % 30 === 0, mid = k % 10 === 0;
        s += tick(SPD.cx, SPD.cy, kA(k), major ? 158 : mid ? 164 : 169, 176, major ? 3.4 : mid ? 2.2 : 1.4, 'tk dim');
    }
    for (let k = 0; k <= MAX_KMH; k += 30) {
        const [x, y] = pol(SPD.cx, SPD.cy, 132, kA(k));
        s += txt('num', x, y, 23, k);
    }
    s += txt('lbl', SPD.cx, SPD.cy - 90, 24, 'km/h');

    // ----- TACHO (kanan besar): BERLAWANAN arah jarum jam, 0 kanan-bawah -> 8 kiri-bawah -----
    s += `<path class="zone" d="${sector(RPM.cx, RPM.cy, 238, 276, rA(MAX_RPM), rA(REDLINE))}"/>`;   // a1 < a2 (rA(8) lebih kecil dari rA(7))
    for (let i = 0; i <= MAX_RPM * 10; i++) {
        const major = i % 10 === 0, mid = i % 5 === 0;
        s += tick(RPM.cx, RPM.cy, rA(i / 10), major ? 244 : mid ? 251 : 259, 274, major ? 4.8 : mid ? 3.2 : 1.8);
    }
    for (let v = 0; v <= MAX_RPM; v++) {
        const [x, y] = pol(RPM.cx, RPM.cy, 212, rA(v));
        s += txt('num', x, y, 46, v);
    }
    s += `<circle cx="${RPM.cx}" cy="${RPM.cy}" r="150" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="2"/>`;
    s += `<circle cx="${RPM.cx}" cy="${RPM.cy}" r="168" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="2"/>`;
    s += txt('lbl', RPM.cx - 164, RPM.cy + 150, 28, 'RPM') + txt('lbl', RPM.cx - 164, RPM.cy + 178, 18, 'X1000');   // cermin label MPH

    // ----- bayangan "mesin mati" (di atas muka, di bawah jarum) -----
    s += shade(FUEL) + shade(OIL) + shade(SPD) + shade(RPM);

    // ----- ikon gauge fuel & oil (di area bawah gauge, tidak tersapu jarum) -----
    s += icon('fuel-ico', 'gauge-ico', FUEL.cx - 14.4, FUEL.cy + 28, 1.2, ICON_FUEL);
    s += icon('oil-ico', 'gauge-ico', OIL.cx - 14.4, OIL.cy + 28, 1.2, ICON_OIL);

    // ----- gear + ikon status: di celah bawah tachometer (jarum tidak pernah lewat sini) -----
    // layar kiri hub: sel gear (kiri) + pembatas + area pesan (kanan)
    const MX = MSG.x + 78 + (MSG.w - 78) / 2;
    s += `<g class="lcd">${lcdFrame(MSG)}
    <g class="lcd-txt">
    <line x1="${MSG.x + 78}" y1="${MSG.y + 16}" x2="${MSG.x + 78}" y2="${MSG.y + MSG.h - 16}" stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>
    <text id="gear" class="gear" x="${MSG.x + 40}" y="${MSG.y + MSG.h / 2 + 2}">N</text>
    <text id="msg-a" class="lcd-m" x="${MX}" y="${MSG.y + 42}" font-size="25"></text>
    <text id="msg-b" class="lcd-m" x="${MX}" y="${MSG.y + 72}" font-size="25"></text>
    ${txt('lcd-s end', MSG.x + MSG.w - 12, MSG.y + 15, 13, '').replace('></text>', ' id="msg-n"></text>')}
    </g></g>`;
    const IC = 1.4, IW = 24 * IC, icoY = RPM.cy + 70;   // baris ikon tepat di bawah layar
    [['engine-ico', 'eng', ICON_ENGINE], ['headlight', 'eng', ICON_HEADLIGHT],
     ['seatbelts', 'eng warn', ICON_SEATBELT], ['door-lock', '', ICON_LOCK]].forEach(([id, cls, inner], i) => {
        s += icon(id, cls, MSG.x + MSG.w / 2 + (i - 1.5) * 48 - IW / 2, icoY, IC, inner);
    });

    // ----- LCD (kanan hub speedo): baris atas = TRIP, baris bawah = total MILE -----
    s += `<g class="lcd">
    ${lcdFrame(LCD)}
    <g class="lcd-txt">
    ${txt('lcd-s', LCD.x + 14, LCD.y + 38, 15, 'TI')}
    <text id="lcd-trip" class="lcd-v" x="${LCD.x + 42}" y="${LCD.y + 31}" font-size="40">0.0</text>
    <text id="lcd-odo" class="lcd-v" x="${LCD.x + 14}" y="${LCD.y + 82}" font-size="40">0</text>
    ${txt('lcd-s end', LCD.x + LCD.w - 12, LCD.y + 89, 15, 'MILE')}
    </g></g>`;

    // ----- jarum + cap krom (paling atas) -----
    s += needle('nd-fuel', FUEL, 88, 18, 16, 2.4) + needle('nd-oil', OIL, 88, 18, 16, 2.4);
    s += needle('nd-rpm', RPM, 268, 44, 54, 3.4) + needle('nd-spd', SPD, 268, 44, 54, 3.4);

    svg.innerHTML = s;
}
buildDial();

const ndSpd = $('nd-spd'), ndRpm = $('nd-rpm'), ndFuel = $('nd-fuel'), ndOil = $('nd-oil');
const ang = {};
function setNeedle(el, key, g, a) {
    if (ang[key] !== undefined && Math.abs(ang[key] - a) < 0.04) return;   // tulis hanya kalau jarum benar-benar bergerak
    ang[key] = a;
    el.setAttribute('transform', `translate(${g.cx} ${g.cy}) rotate(${a.toFixed(2)})`);
}
// Helper kelas untuk elemen SVG (className SVG bukan string biasa)
function setCls(el, cls) { if (el.getAttribute('class') !== cls) el.setAttribute('class', cls); }
function setText(el, t) { t = String(t); if (el.textContent !== t) el.textContent = t; }

// ---------- State ----------
const state = {
    mph: 0, mps: 0,
    rpm: 0, health: 1, fuel: 1,
    spdShown: 0, rpmShown: 0, fuelShown: 0, oilShown: 0,
    belted: false, engine: false, lights: 0,
};
const BOOT_MS = 1700;
let bootUntil = 0;
const OIL_FRAC_NORMAL = OIL_NORMAL_PSI / OIL_MAX_PSI;   // posisi jarum oli saat health 100%

// ---------- Loop animasi (berhenti sendiri kalau semua jarum diam) ----------
const FRAME_MS = 1000 / 60;
let lastFrame = 0, rafId = 0;
function kick() {
    if (rafId) return;
    lastFrame = performance.now() - FRAME_MS;
    rafId = requestAnimationFrame(frame);
}
function frame(now) {
    rafId = 0;
    if (now - lastFrame < FRAME_MS - 2) { rafId = requestAnimationFrame(frame); return; }
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    // Sapuan jarum saat kontak ON: 0 -> max -> 0 (tacho menyapu counter-clockwise karena sweep negatif)
    const booting = now < bootUntil;
    let sw = 0;
    if (booting) {
        const t = 1 - (bootUntil - now) / BOOT_MS;
        sw = t < 0.45 ? t / 0.45 : t < 0.55 ? 1 : Math.max(0, 1 - (t - 0.55) / 0.45);
    }

    const tSpd = booting ? Math.max(sw, state.mph / MAX_MPH) : state.mph / MAX_MPH;
    const limiter = !booting && state.engine && state.rpm >= LIMITER;
    let tRpm = booting ? sw : state.engine ? state.rpm : 0;
    if (limiter) {   // rev limiter: jarum mental-mental di dekat batas (fuel cut), seperti mobil asli
        const cut = Math.sin((now / 1000) * 2 * Math.PI * 11) > 0;
        tRpm = state.rpm - (cut ? 0.04 + Math.random() * 0.02 : Math.random() * 0.012);
    }
    const tFuel = booting ? Math.max(sw, state.fuel) : state.engine ? state.fuel : 0;
    const tOil = booting ? sw : state.engine ? state.health * OIL_FRAC_NORMAL : 0;

    const kf = booting ? 1 : Math.min(1, dt * (limiter ? 45 : 12)), ks = booting ? 1 : Math.min(1, dt * 4);
    const ease = (cur, tgt, k) => (Math.abs(tgt - cur) < 0.0004 ? tgt : cur + (tgt - cur) * k);
    state.spdShown = ease(state.spdShown, tSpd, kf);
    state.rpmShown = ease(state.rpmShown, tRpm, kf);
    state.fuelShown = ease(state.fuelShown, tFuel, ks);
    state.oilShown = ease(state.oilShown, tOil, ks);

    setNeedle(ndSpd, 'spd', SPD, SPD.a0 + clamp01(state.spdShown) * SPD.sweep);
    setNeedle(ndRpm, 'rpm', RPM, RPM.a0 + clamp01(state.rpmShown) * RPM.sweep);   // sweep negatif -> CCW
    setNeedle(ndFuel, 'fuel', FUEL, FUEL.a0 + clamp01(state.fuelShown) * FUEL.sweep);
    setNeedle(ndOil, 'oil', OIL, OIL.a0 + clamp01(state.oilShown) * OIL.sweep);

    if (booting || limiter || state.spdShown !== tSpd || state.rpmShown !== tRpm || state.fuelShown !== tFuel || state.oilShown !== tOil) {
        rafId = requestAnimationFrame(frame);
    }
}

// ---------- 1. Kecepatan (m/s) ----------
window.setSpeed = function (speed) {
    state.mps = Number(speed || 0);
    state.mph = Math.round(state.mps * MPS_TO_MPH);
    kick();
};
// ---------- 2. RPM (0.0 - 1.0) ----------
window.setRPM = function (rpm) {
    const r = clamp01(Number(rpm || 0));
    if (r === state.rpm) return;
    state.rpm = r;
    kick();
};
// ---------- 3. Fuel ----------
window.setFuel = function (fuel) {
    const val = Number(fuel || 0);
    state.fuel = clamp01(val > 1 ? val / 100 : val);
    setCls($('fuel-ico'), state.fuel < 0.2 ? 'ind gauge-ico low' : 'ind gauge-ico');
    kick();
};
// ---------- 4. Engine health -> jarum OIL PSI (100% = 80 psi) + lampu check engine ----------
window.setHealth = function (health) {
    const val = Number(health || 0);
    const p = clamp01(val > 1 ? val / 1000 : val);
    if (p === state.health) return;
    state.health = p;
    setCls($('oil-ico'), p <= 0.3 ? 'ind gauge-ico crit' : p <= 0.5 ? 'ind gauge-ico low' : 'ind gauge-ico');
    setCls($('engine-ico'), p <= 0.3 ? 'ind eng crit' : p <= 0.5 ? 'ind eng low' : 'ind eng');
    kick();
};
// ---------- 5. Gear ----------
window.setGear = function (gear) {
    let g = String(gear);
    if (gear == 0 || g === '0' || g.toUpperCase() === 'R') g = 'R';
    else if (gear === null || gear === undefined || g === '' || g.toUpperCase() === 'N') g = 'N';
    setText($('gear'), g);
    setCls($('gear'), g === 'R' ? 'gear rev' : 'gear');
};
// ---------- 6. Lock ----------
window.updateLockStatus = function (st) {
    setCls($('door-lock'), isLockedState(st) ? 'ind locked' : 'ind');
};
['setDoors', 'setDoorLock', 'setVehicleLocked', 'setLocked', 'setLock', 'toggleLock'].forEach((n) => { window[n] = window.updateLockStatus; });

// ---------- 7. LAMPU: 0 mati, 1 low, 2 high -> ikon + SEMUA JARUM MENYALA ----------
window.setHeadlights = function (st) {
    const val = Number(st || 0);
    state.lights = val;
    setCls($('headlight'), val === 2 ? 'ind eng high-beam' : val === 1 ? 'ind eng active' : 'ind eng');
    elHud.classList.toggle('lights-on', val > 0);
};
window.setLights = window.setHeadlights;
window.setLeftIndicator = function () {};     // sein dihapus
window.setRightIndicator = function () {};

// ---------- 8. Seatbelt ----------
window.setSeatbelts = function (val) {
    const on = isTrueValue(val);
    state.belted = on;
    setCls($('seatbelts'), on ? 'ind eng active' : 'ind eng warn');
};

// ---------- 8b. Layar pesan peringatan (tachometer): ENGINE FAULT / CHECK ENGINE, FUEL LOW, FASTEN SEATBELT ----------
// Hanya tampil saat mesin hidup. Kalau ada beberapa peringatan, tampil bergantian (kritis duluan) dengan penanda 1/2, 2/2.
const MSG_ROTATE_MS = 2200;
function activeWarnings() {
    const w = [];
    if (!state.engine) return w;
    if (state.health <= 0.3) w.push({ a: 'ENGINE', b: 'FAULT', c: 'crit' });
    else if (state.health <= 0.5) w.push({ a: 'CHECK', b: 'ENGINE', c: 'warn' });
    if (state.fuel < 0.2) w.push({ a: 'FUEL', b: 'LOW', c: 'warn' });
    if (!state.belted) w.push({ a: 'FASTEN', b: 'SEATBELT', c: 'warn' });
    return w;
}
let msgIdx = 0, msgSince = 0, msgKey = '';
function renderMsg(m, i, n) {
    setText($('msg-a'), m ? m.a : '');
    setText($('msg-b'), m ? m.b : '');
    setText($('msg-n'), m && n > 1 ? i + '/' + n : '');
    const cls = 'lcd-m' + (m ? ' ' + m.c : '');
    setCls($('msg-a'), cls);
    setCls($('msg-b'), cls);
}
function updateMsg() {
    const now = performance.now(), list = activeWarnings();
    if (!list.length) { msgKey = ''; renderMsg(null, 0, 0); return; }
    const key = list.map((m) => m.a + m.b).join('|');
    if (key !== msgKey) { msgKey = key; msgIdx = 0; msgSince = now; }
    else if (list.length > 1 && now - msgSince > MSG_ROTATE_MS) { msgIdx = (msgIdx + 1) % list.length; msgSince = now; }
    const idx = msgIdx % list.length;
    renderMsg(list[idx], idx + 1, list.length);
}
setInterval(updateMsg, 200);

// ---------- 9. Layar LCD: total mil (bawah) + trip 1 desimal (atas) ----------
let odoMiles = 0, lastOdoMiles = null, tripMiles = 0, tripManual = false;
function renderLcd() {
    setText($('lcd-odo'), Math.floor(odoMiles));
    setText($('lcd-trip'), tripMiles.toFixed(1));
}
window.setOdometer = function (distance) {
    const m = Math.max(0, Math.min(999999.9, Number(distance || 0)));
    if (!tripManual && lastOdoMiles !== null) {           // trip otomatis: akumulasi selisih odometer
        const delta = m - lastOdoMiles;
        if (delta > 0 && delta < 5) tripMiles = Math.min(9999.9, tripMiles + delta);
    }
    lastOdoMiles = m;
    odoMiles = m;
    renderLcd();
};
window.setTrip = function (distance) {                    // opsional: isi trip manual dari server
    tripManual = true;
    tripMiles = Math.max(0, Math.min(9999.9, Number(distance || 0)));
    renderLcd();
};
window.resetTrip = function () { tripMiles = 0; renderLcd(); };

// ---------- 10. MESIN: nyala = dial terang + jarum menyapu ----------
window.setEngine = function (on) {
    const v = isTrueValue(on);
    const was = state.engine;
    state.engine = v;
    elHud.classList.toggle('engine-on', v);
    if (v && !was && performance.now() > bootUntil) bootUntil = performance.now() + BOOT_MS;
    kick();
};

// ---------- Sapuan jarum (tanpa tulisan intro) ----------
window.playIntro = function () {
    if (state.engine) bootUntil = performance.now() + BOOT_MS;
    kick();
};

// ---------- Suara peringatan (Web Audio, tanpa file mp3) ----------
const SND = {
    enabled: true,
    volume: 0.3,
    seatbeltEvery: 2000,
    seatbeltMinSpeed: 1,    // m/s
    fuelBelow: 0.20,
    fuelEvery: 30000,
};
try {
    const q = new URLSearchParams(location.search);
    ['nosound', 'mute', 'silent', 'noalarm', 'noseatbelt', 'nobelt'].forEach((k) => {
        if (q.has(k) && !['0', 'false', 'no', 'off'].includes((q.get(k) || '').toLowerCase())) SND.enabled = false;
    });
    if (q.has('volume') && !isNaN(parseFloat(q.get('volume')))) SND.volume = Math.max(0, Math.min(1, parseFloat(q.get('volume'))));
} catch (e) {}
let audioCtx = null;
function getAudio() {
    if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
}
function tone(freq, start, dur, type, vol) {
    const a = getAudio();
    if (!a) return;
    const t0 = a.currentTime + start;
    const osc = a.createOscillator(), gain = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, SND.volume * vol), t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
}
window.playHudSound = function (kind) {
    if (!SND.enabled) return;
    if (kind === 'seatbelt') {
        tone(1000, 0.00, 0.14, 'triangle', 1);
        tone(1000, 0.22, 0.14, 'triangle', 1);
    } else if (kind === 'fuel') {
        tone(988, 0.00, 0.45, 'sine', 1);
        tone(1976, 0.00, 0.30, 'sine', 0.25);
        tone(740, 0.30, 0.70, 'sine', 1);
        tone(1480, 0.30, 0.45, 'sine', 0.25);
    }
};
window.setHudSound = function (on, volume) {
    SND.enabled = !!on;
    if (volume !== undefined) SND.volume = clamp01(Number(volume));
};
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, getAudio, { once: true }));

let lastSeatBeep = -Infinity, lastFuelChime = -Infinity;
setInterval(() => {
    if (!SND.enabled) return;
    const now = performance.now();
    const seatWarn = state.engine && !state.belted && state.mps > SND.seatbeltMinSpeed;
    if (!seatWarn) lastSeatBeep = -Infinity;
    else if (now - lastSeatBeep >= SND.seatbeltEvery) { lastSeatBeep = now; window.playHudSound('seatbelt'); }

    const fuelWarn = state.engine && state.fuel < SND.fuelBelow;
    if (!fuelWarn) lastFuelChime = -Infinity;
    else if (now - lastFuelChime >= SND.fuelEvery) { lastFuelChime = now; window.playHudSound('fuel'); }
}, 250);

window.setSeatbeltSoundEnabled = (on) => window.setHudSound(!!on);
window.setSeatbeltVolume = (v) => { const n = parseFloat(v); if (!isNaN(n)) window.setHudSound(SND.enabled, n); };

// ---------- Pesan NUI: window.postMessage({ action: 'setEngine', state: true }) ----------
window.addEventListener('message', function (event) {
    const d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'setDoors' || d.action === 'setDoors' || d.type === 'lock') {
        window.updateLockStatus(d.status !== undefined ? d.status : d.state);
    }
    if (d.type === 'playIntro' || d.action === 'playIntro') window.playIntro();
    if (!d.action) return;
    try {
        switch (d.action) {
            case 'setEngine': window.setEngine(d.state); break;
            case 'setSpeed': window.setSpeed(Number(d.speed) || 0); break;
            case 'setRPM': window.setRPM(Number(d.rpm) || 0); break;
            case 'setFuel': window.setFuel(Number(d.fuel) || 0); break;
            case 'setHealth': window.setHealth(Number(d.health) || 0); break;
            case 'setGear': window.setGear(d.gear !== undefined ? d.gear : 'N'); break;
            case 'setHeadlights':
            case 'setLights': window.setHeadlights(Number(d.state !== undefined ? d.state : d.lights) || 0); break;
            case 'setSeatbelts': window.setSeatbelts(!!d.state); break;
            case 'setOdometer': window.setOdometer(Number(d.distance) || 0); break;
            case 'setTrip': window.setTrip(Number(d.distance !== undefined ? d.distance : d.trip) || 0); break;
            case 'resetTrip': window.resetTrip(); break;
            case 'toggleVbox': window.toggleVbox(); break;
            case 'setVbox': window.setVbox(d.state !== undefined ? !!d.state : true); break;
            case 'resetVbox': window.resetVbox(); break;
            case 'muteSeatbelt': window.setSeatbeltSoundEnabled(false); break;
            case 'unmuteSeatbelt': window.setSeatbeltSoundEnabled(true); break;
            case 'setSeatbeltSound': window.setSeatbeltSoundEnabled(d.enabled !== undefined ? !!d.enabled : !d.disabled); break;
            case 'setVolume': window.setSeatbeltVolume(d.volume !== undefined ? d.volume : d.value); break;
        }
    } catch (e) { /* abaikan pesan rusak */ }
});

// ---------- Nilai awal ----------
window.setSpeed(0);
window.setRPM(0);
window.setFuel(100);
window.setHealth(1000);
window.setGear('N');
window.setHeadlights(0);
window.setSeatbelts(false);
window.setEngine(false);
window.updateLockStatus(false);
window.setOdometer(0);
window.playIntro();

// ---------- VBOX Performance Box Touch ----------
// Otomatis mengukur: 0-60 mph, 0-100 km/h, 0-100 mph, 100-200 km/h, 1/8 mil, 1/4 mil (+ kecepatan trap).
// Mulai saat mobil berhenti total lalu jalan; ikut berjalan walau panel ditutup.
// API: toggleVbox() | setVbox(bool) | resetVbox()  (juga lewat postMessage & tombol V)
const VB_STILL = 0.28, VB_MID_A = 100 / 3.6, VB_MID_B = 200 / 3.6;
const VB_TESTS = [
    { id: 'z60',   n: '0-60',    u: 'MPH',  type: 'v', v: 60 / MPS_TO_MPH },
    { id: 'z100k', n: '0-100',   u: 'KM/H', type: 'v', v: 100 / 3.6 },
    { id: 'z100m', n: '0-100',   u: 'MPH',  type: 'v', v: 100 / MPS_TO_MPH },
    { id: 'mid',   n: '100-200', u: 'KM/H', type: 'mid' },
    { id: 'e',     n: '1/8',     u: 'MIL',  type: 'd', d: 201.168 },
    { id: 'q',     n: '1/4',     u: 'MIL',  type: 'd', d: 402.336 },
];
const VB = { open: false, unit: 'mph', phase: 'wait', t0: 0, dist: 0, lastT: 0, lastV: 0, stillSince: 0, g: 0, res: {}, midT: null, lastMark: 0, frozen: 0 };
(function () {
    $('vbox').innerHTML = `
    <div class="vb-top"><span class="vb-logo">VBOX</span><span class="vb-sub">PERFORMANCE BOX TOUCH</span><span class="vb-gps"><i></i>GPS 100Hz</span></div>
    <div class="vb-screen">
      <div class="vb-status" id="vb-status">STOP TO ARM</div>
      <div class="vb-main">
        <div class="vb-speed" id="vb-speed" title="Klik untuk ganti MPH / KM/H"><b id="vb-spd">0</b><em id="vb-unit">MPH</em></div>
        <div class="vb-time"><b id="vb-t">0.00</b><em>S</em></div>
      </div>
      <div class="vb-g">G <b id="vb-g">+0.00</b></div>
      <div class="vb-rows">${VB_TESTS.map((t) => `<div class="vb-row" id="vbr-${t.id}"><span class="n">${t.n}<small>${t.u}</small></span><b class="t" id="vbt-${t.id}">--.--</b><span class="x" id="vbx-${t.id}"></span></div>`).join('')}</div>
    </div>
    <div class="vb-btns"><button type="button" id="vb-reset">RESET</button><button type="button" id="vb-close">CLOSE</button></div>`;
})();
const vbSpeedK = () => (VB.unit === 'mph' ? MPS_TO_MPH : 3.6);
function vbRender(now) {
    const run = VB.phase === 'run', el = run ? (now - VB.t0) / 1000 : VB.frozen;
    setText($('vb-spd'), Math.round(state.mps * vbSpeedK()));
    setText($('vb-unit'), VB.unit === 'mph' ? 'MPH' : 'KM/H');
    setText($('vb-t'), el.toFixed(2));
    setText($('vb-g'), (VB.g >= 0 ? '+' : '-') + Math.abs(VB.g).toFixed(2));
    const st = $('vb-status'), label = run ? 'RUNNING' : VB.phase === 'ready' ? 'READY - GO!' : 'STOP TO ARM';
    setText(st, label); if (st.className !== 'vb-status ' + VB.phase) st.className = 'vb-status ' + VB.phase;
    for (const t of VB_TESTS) {
        const r = VB.res[t.id], row = $('vbr-' + t.id);
        const live = run && !r && (t.type !== 'mid' || VB.midT !== null);
        setText($('vbt-' + t.id), r ? r.t.toFixed(2) : live ? (t.type === 'mid' ? el - VB.midT : el).toFixed(2) : '--.--');
        setText($('vbx-' + t.id), r && r.v ? Math.round(r.v * vbSpeedK()) + (VB.unit === 'mph' ? ' mph' : ' km/h') : '');
        const cls = 'vb-row' + (r ? ' done' : live ? ' live' : '');
        if (row.className !== cls) row.className = cls;
    }
}
function vbTick() {
    const now = performance.now(), v = state.mps;
    if (!VB.lastT) { VB.lastT = now; VB.lastV = v; return; }
    const dt = (now - VB.lastT) / 1000, lv = VB.lastV;
    if (dt <= 0) return;
    VB.lastT = now; VB.lastV = v;
    if (dt > 0.3) return;                                   // tab sempat tertahan: lewati sampel ini
    VB.g += ((v - lv) / dt / 9.81 - VB.g) * 0.15;
    const still = v <= VB_STILL, frac = (target) => clamp01((v - target) / ((v - lv) || 1));
    if (VB.phase === 'run') {
        const prev = VB.dist, el = (now - VB.t0) / 1000;
        VB.dist += ((v + lv) / 2) * dt;
        const mark = (id, t, extra) => { VB.res[id] = Object.assign({ t }, extra); };
        for (const t of VB_TESTS) {
            if (VB.res[t.id] || t.type === 'mid') continue;
            if (t.type === 'v' && v >= t.v) { const tt = el - dt * frac(t.v); mark(t.id, tt); VB.lastMark = Math.max(VB.lastMark, tt); }
            if (t.type === 'd' && VB.dist >= t.d) { const tt = el - dt * clamp01((VB.dist - t.d) / ((VB.dist - prev) || 1)); mark(t.id, tt, { v }); VB.lastMark = Math.max(VB.lastMark, tt); }
        }
        if (!VB.res.mid) {                                  // 100 -> 200 km/h (gagal kalau kecepatan turun di bawah 100 sebelum 200)
            if (lv < VB_MID_A && v >= VB_MID_A && VB.midT === null) VB.midT = el - dt * frac(VB_MID_A);
            if (VB.midT !== null && v < VB_MID_A) VB.midT = null;
            if (VB.midT !== null && v >= VB_MID_B) { const tt = el - dt * frac(VB_MID_B); mark('mid', tt - VB.midT); VB.lastMark = Math.max(VB.lastMark, tt); }
        }
        if (still) {
            if (!VB.stillSince) VB.stillSince = now;
            else if (now - VB.stillSince > 1000) { VB.frozen = VB.lastMark || (VB.stillSince - VB.t0) / 1000; VB.phase = 'ready'; }
        } else VB.stillSince = 0;
    } else if (still) {
        if (!VB.stillSince) VB.stillSince = now;
        else if (now - VB.stillSince > 400) VB.phase = 'ready';
    } else {
        VB.stillSince = 0;
        if (VB.phase === 'ready') {                         // LAUNCH: waktu 0 diinterpolasi tepat saat lepas dari diam
            VB.phase = 'run'; VB.res = {}; VB.midT = null; VB.lastMark = 0; VB.frozen = 0; VB.dist = 0;
            VB.t0 = now - dt * 1000 * frac(VB_STILL);
        }
    }
    if (VB.open) vbRender(now);
}
setInterval(vbTick, 40);
window.setVbox = function (on) {
    VB.open = !!on;
    $('vbox').classList.toggle('open', VB.open);
    $('vbox-btn').classList.toggle('on', VB.open);
    if (VB.open) vbRender(performance.now());
};
window.toggleVbox = () => window.setVbox(!VB.open);
window.resetVbox = function () {
    VB.res = {}; VB.midT = null; VB.lastMark = 0; VB.frozen = 0; VB.stillSince = 0;
    if (VB.phase === 'run') VB.phase = 'wait';
    if (VB.open) vbRender(performance.now());
};
$('vbox-btn').addEventListener('click', window.toggleVbox);
$('vb-close').addEventListener('click', () => window.setVbox(false));
$('vb-reset').addEventListener('click', window.resetVbox);
$('vb-speed').addEventListener('click', () => { VB.unit = VB.unit === 'mph' ? 'kmh' : 'mph'; vbRender(performance.now()); });
window.addEventListener('keydown', (e) => { if (e.key === 'v' || e.key === 'V') window.toggleVbox(); });
try { if (new URLSearchParams(location.search).has('nobutton')) document.body.classList.add('no-btn'); } catch (e) {}

// ---------- Demo (otomatis di preview Netlify atau dengan ?demo) ----------
const params = new URLSearchParams(location.search);
const isPreview = params.has('demo') || (/netlify\.app$/.test(location.hostname) && !params.has('nodemo'));

if (isPreview) {
    document.body.classList.add('preview');
    const btnE = $('dev-engine'), btnL = $('dev-lights');
    const LIGHT_NAMES = ['OFF', 'LOW', 'HIGH'];
    const toggleEngine = () => { setEngine(!state.engine); };
    const cycleLights = () => { setHeadlights((state.lights + 1) % 3); };
    btnE.addEventListener('click', toggleEngine);
    btnL.addEventListener('click', cycleLights);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'e' || e.key === 'E') toggleEngine();
        if (e.key === 'l' || e.key === 'L') cycleLights();
    });

    const GEAR_TOP = [0, 28, 50, 76, 106, 140, 190];
    let mps = 0, gear = 1, throttle = true, odo = 39139.2, health = 1000, fuel = 86;
    setInterval(() => {
        btnE.textContent = 'Mesin: ' + (state.engine ? 'ON' : 'OFF');
        btnE.classList.toggle('on', state.engine);
        btnL.textContent = 'Lampu: ' + LIGHT_NAMES[state.lights];
        btnL.classList.toggle('on', state.lights > 0);

        if (!state.engine || performance.now() < bootUntil) {   // mesin mati / masih menyapu: mobil diam
            mps = 0; gear = 1; throttle = true;
            setSpeed(0); setRPM(0); setGear('N');
            return;
        }
        const mph = mps * MPS_TO_MPH;
        if (throttle) mps += 0.38 / gear; else mps -= 0.55;
        if (mph > 170) throttle = false;
        if (mps <= 0) { mps = 0; throttle = true; }
        while (gear < 6 && mph > GEAR_TOP[gear]) gear++;
        while (gear > 1 && mph < GEAR_TOP[gear - 1] - 6) gear--;
        const lo = GEAR_TOP[gear - 1], hi = GEAR_TOP[gear];
        const rpm = 0.11 + clamp01((mph - lo) / (hi - lo)) * (throttle ? 0.89 : 0.6);
        health = Math.max(180, health - 0.9); if (health <= 180) health = 1000;
        fuel = fuel <= 4 ? 86 : fuel - 0.02;
        odo += (mph * 0.05) / 3600;
        setSpeed(mps); setRPM(rpm); setGear(gear); setHealth(health); setFuel(fuel); setOdometer(odo);
    }, 50);
    setTimeout(() => { setSeatbelts(true); updateLockStatus(false); }, 1500);
}
