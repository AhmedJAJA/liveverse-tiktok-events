// Generates the original SPONGE LIVE game covers in public/covers/*.svg.
// Run: node tools/build-covers.mjs — every cover shares the stage lighting and the
// "Sky" mascot (an obsidian crown-bot) so the catalogue reads as one family.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'covers');
fs.mkdirSync(out, { recursive: true });
const NS = 'http://www.w3.org/2000/svg';

const stage = (id, { sky = ['#13307A', '#0A1640', '#050818'], glow = '#3D8BFF', floor = '#37B3D4' } = {}) => `
  <defs>
    <radialGradient id="${id}-sky" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="${sky[0]}"/><stop offset=".55" stop-color="${sky[1]}"/><stop offset="1" stop-color="${sky[2]}"/></radialGradient>
    <radialGradient id="${id}-glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${glow}" stop-opacity=".75"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}-floor" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${floor}" stop-opacity=".7"/><stop offset=".6" stop-color="${floor}" stop-opacity=".12"/><stop offset="1" stop-color="${floor}" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#D8F7FF"/><stop offset=".3" stop-color="#8CD9F1"/><stop offset=".62" stop-color="#2FA1C9"/><stop offset="1" stop-color="#92DEF4"/></linearGradient>
    <linearGradient id="${id}-goldv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C2F3FF"/><stop offset=".5" stop-color="#37B3D4"/><stop offset="1" stop-color="#1C647A"/></linearGradient>
    <radialGradient id="${id}-vig" cx="50%" cy="45%" r="72%"><stop offset=".6" stop-color="#010306" stop-opacity="0"/><stop offset="1" stop-color="#010306" stop-opacity=".7"/></radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#${id}-sky)"/>
  <g opacity=".22" stroke="#9CC4FF" stroke-width="1.2">${Array.from({ length: 9 }, (_, i) => `<path d="M256 -40 L${-80 + i * 84} 560"/>`).join('')}</g>
  <ellipse cx="256" cy="210" rx="230" ry="190" fill="url(#${id}-glow)"/>
  <ellipse cx="256" cy="440" rx="260" ry="70" fill="url(#${id}-floor)"/>
  <g fill="#FFFFFF">${[[60, 70, 2], [430, 60, 2.6], [470, 170, 1.6], [90, 200, 1.4], [380, 120, 1.2], [150, 40, 1.4], [330, 30, 1.8]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" opacity=".85"/>`).join('')}</g>
  <g fill="#C2F3FF">${[[420, 250], [72, 300], [300, 70]].map(([x, y]) => `<path d="M${x} ${y - 10}q2 8 10 10q-8 2-10 10q-2-8-10-10q8-2 10-10Z"/>`).join('')}</g>`;

// "Bubble" (بوبل), the house mascot: obsidian crown-bot with cyan visor eyes.
const mascot = (id, x, y, s = 1, flip = false) => `
  <g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})">
    <ellipse cx="0" cy="96" rx="58" ry="10" fill="#010306" opacity=".45"/>
    <path d="M-44 92c-4-26 4-46 22-52h44c18 6 26 26 22 52Z" fill="#0B162F" stroke="url(#${id}-gold)" stroke-width="3"/>
    <circle cx="0" cy="66" r="8" fill="url(#${id}-gold)"/>
    <rect x="-52" y="-30" width="104" height="80" rx="38" fill="#0D1935" stroke="url(#${id}-gold)" stroke-width="4"/>
    <rect x="-38" y="-12" width="76" height="40" rx="20" fill="#071A33" stroke="#2B6FD6" stroke-width="2"/>
    <ellipse cx="-15" cy="8" rx="8" ry="10" fill="#7FE3FF"/><ellipse cx="15" cy="8" rx="8" ry="10" fill="#7FE3FF"/>
    <circle cx="-12" cy="4" r="3" fill="#FFFFFF"/><circle cx="18" cy="4" r="3" fill="#FFFFFF"/>
    <path d="M-8 22q8 6 16 0" fill="none" stroke="#7FE3FF" stroke-width="3" stroke-linecap="round"/>
    <path d="M-34 -28 -40 -62 -16 -44 0 -70 16 -44 40 -62 34 -28Z" fill="url(#${id}-goldv)" stroke="#C2F3FF" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="0" cy="-48" r="5" fill="#5BC8FF"/>
    <path d="M-52 40c-16 6-22 20-18 34M52 40c16 6 22 20 18 34" fill="none" stroke="#0D1935" stroke-width="12" stroke-linecap="round"/>
    <circle cx="-70" cy="76" r="9" fill="url(#${id}-gold)"/><circle cx="70" cy="76" r="9" fill="url(#${id}-gold)"/>
  </g>`;

const covers = {
  quiz: (id) => `${stage(id)}
    <path d="M150 -10 196 300h120l46-310Z" fill="#FFFFFF" opacity=".06"/>
    <g transform="translate(256 200)">
      <rect x="-132" y="-96" width="264" height="182" rx="26" fill="url(#${id}-gold)"/>
      <rect x="-118" y="-82" width="236" height="154" rx="18" fill="#081536"/>
      <rect x="-118" y="-82" width="236" height="154" rx="18" fill="none" stroke="#5BC8FF" stroke-opacity=".5" stroke-width="2"/>
      <path d="M-26 -38c0-24 18-38 38-38 22 0 38 14 38 34 0 30-34 30-34 58v6" fill="none" stroke="#D8F7FF" stroke-width="20" stroke-linecap="round" transform="translate(-12 0)"/>
      <circle cx="0" cy="54" r="11" fill="#D8F7FF"/>
      ${Array.from({ length: 14 }, (_, i) => `<circle cx="${-120 + i * 18.5}" cy="-104" r="4" fill="#C2F3FF" opacity="${i % 2 ? .5 : 1}"/>`).join('')}
    </g>
    ${[['#E0694B', 150], ['#5B7FC9', 222], ['#46A883', 294], ['#9774C6', 366]].map(([c, x]) => `<ellipse cx="${x}" cy="352" rx="30" ry="13" fill="${c}"/><ellipse cx="${x}" cy="346" rx="30" ry="13" fill="${c}" opacity=".9"/><ellipse cx="${x - 8}" cy="342" rx="10" ry="4" fill="#FFFFFF" opacity=".5"/>`).join('')}
    ${mascot(id, 412, 360, .78)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`,
  bomb: (id) => `${stage(id, { sky: ['#5A1D10', '#2A0C08', '#0D0505'], glow: '#FF5A1F' })}
    <circle cx="246" cy="282" r="132" fill="#091226"/>
    <circle cx="246" cy="282" r="132" fill="none" stroke="#FF6A2A" stroke-opacity=".55" stroke-width="5"/>
    <path d="M168 220a100 100 0 0 1 60 -58" fill="none" stroke="#FFFFFF" stroke-opacity=".25" stroke-width="12" stroke-linecap="round"/>
    <rect x="262" y="132" width="58" height="40" rx="6" fill="#5B5C63" transform="rotate(30 291 152)"/>
    <path d="M300 136c18-40 58-34 70-62s36-30 50-18" fill="none" stroke="#5296B9" stroke-width="8" stroke-linecap="round"/>
    <circle cx="420" cy="56" r="30" fill="#47C5FF" opacity=".45"/><circle cx="420" cy="56" r="14" fill="#D8F7FF"/>
    <g stroke="#7ADBFF" stroke-width="4" stroke-linecap="round">${[0, 60, 120, 180, 240, 300].map((a) => `<path d="M420 56l${Math.round(Math.cos(a * Math.PI / 180) * 34)} ${Math.round(Math.sin(a * Math.PI / 180) * 34)}"/>`).join('')}</g>
    <rect x="176" y="300" width="140" height="58" rx="12" fill="#040710" stroke="#4A1A14" stroke-width="3"/>
    <text x="246" y="343" text-anchor="middle" font-family="DejaVu Sans Mono,Menlo,monospace" font-size="40" font-weight="700" fill="#FF4A2F">00:15</text>
    ${mascot(id, 92, 380, .7, true)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`,
  race: (id) => `${stage(id, { sky: ['#1A2F86', '#0B1546', '#04071A'] })}
    <path d="M256 210 40 512h432Z" fill="#0B0F26"/>
    <path d="M256 210 40 512M256 210 472 512" stroke="url(#${id}-gold)" stroke-width="6"/>
    <path d="M256 230v40M256 300v60M256 400v90" stroke="#C2F3FF" stroke-width="7" stroke-linecap="round" opacity=".7"/>
    <g transform="translate(116 80)">${Array.from({ length: 4 }, (_, r) => Array.from({ length: 10 }, (_, c) => (r + c) % 2 ? '' : `<rect x="${c * 28}" y="${r * 18}" width="28" height="18" fill="#E7F2F6"/>`).join('')).join('')}<rect width="280" height="72" fill="none" stroke="url(#${id}-gold)" stroke-width="4"/></g>
    <g transform="translate(256 370)">
      <path d="M-112 30c0-44 26-72 112-72s112 28 112 72v30h-224Z" fill="url(#${id}-goldv)" stroke="#C2F3FF" stroke-width="3"/>
      <path d="M-70 -30c10-26 34-40 70-40s60 14 70 40Z" fill="#0B2A5A" stroke="#5BC8FF" stroke-width="3"/>
      <rect x="-96" y="20" width="56" height="18" rx="8" fill="#D8F7FF"/><rect x="40" y="20" width="56" height="18" rx="8" fill="#D8F7FF"/>
      <rect x="-128" y="56" width="44" height="40" rx="10" fill="#081022"/><rect x="84" y="56" width="44" height="40" rx="10" fill="#081022"/>
    </g>
    <g stroke="#9CC4FF" stroke-width="4" stroke-linecap="round" opacity=".5"><path d="M60 300l60 20M40 360l70 16M452 300l-60 20M472 360l-70 16"/></g>
    ${mascot(id, 420, 196, .6)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`,
  glass: (id) => `${stage(id, { sky: ['#0E4A73', '#072A4A', '#020A18'], glow: '#5EE0FF' })}
    <path d="M190 160h132l120 352H70Z" fill="#020812" opacity=".7"/>
    ${Array.from({ length: 5 }, (_, i) => {
      const t = i / 5, t2 = (i + 1) / 5, y1 = 170 + t * 330, y2 = 170 + t2 * 330 - 10;
      const w1 = 70 + t * 200, w2 = 70 + t2 * 200;
      const row = (side) => {
        const s = side < 0 ? -1 : 1;
        const cracked = (i === 2 && side < 0) || (i === 4 && side > 0);
        const pts = `${256 + s * 6} ${y1} ${256 + s * w1 / 2} ${y1} ${256 + s * w2 / 2} ${y2} ${256 + s * 8} ${y2}`;
        return `<polygon points="${pts}" fill="${cracked ? '#5EE0FF' : '#BDF3FF'}" fill-opacity="${cracked ? .18 : .32}" stroke="#E8FDFF" stroke-width="2"/>${cracked ? `<path d="M${256 + s * w1 / 4} ${y1 + 8}l${s * 14} ${(y2 - y1) / 2}l${-s * 18} ${(y2 - y1) / 2 - 10}" stroke="#FFFFFF" stroke-width="2" fill="none"/>` : ''}`;
      };
      return row(-1) + row(1);
    }).join('')}
    <path d="M256 160V512" stroke="url(#${id}-gold)" stroke-width="5"/>
    <path d="M186 160 66 512M326 160l120 352" stroke="url(#${id}-gold)" stroke-width="4"/>
    ${mascot(id, 256, 116, .62)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`,
  guess: (id) => `${stage(id, { sky: ['#2A2486', '#141048', '#05051A'], glow: '#7B6BFF' })}
    ${['ك', 'ل', '؟', 'م', 'ة'].map((ch, i) => {
      const x = 64 + i * 80, lit = ch === '؟';
      return `<g transform="translate(${x} 196) rotate(${(i - 2) * 3})"><rect width="68" height="80" rx="14" fill="${lit ? `url(#${id}-gold)` : '#141633'}" stroke="${lit ? '#D8F7FF' : `url(#${id}-gold)`}" stroke-width="3"/><text x="34" y="56" text-anchor="middle" font-family="Tajawal,DejaVu Sans,sans-serif" font-size="44" font-weight="800" fill="${lit ? '#051334' : '#8CD9F1'}">${ch}</text></g>`;
    }).join('')}
    <g transform="translate(318 300) rotate(-28)"><circle r="62" fill="#9CC4FF" fill-opacity=".12" stroke="url(#${id}-gold)" stroke-width="12"/><rect x="-11" y="62" width="22" height="88" rx="10" fill="url(#${id}-goldv)"/><path d="M-30 -30a42 42 0 0 1 36 -14" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" opacity=".7"/></g>
    ${mascot(id, 128, 380, .72)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`,
  wheel: (id) => `${stage(id, { sky: ['#123A8A', '#0A1A4C', '#04081C'] })}
    <g transform="translate(256 236)">
      <circle r="168" fill="url(#${id}-gold)"/>
      ${Array.from({ length: 8 }, (_, i) => {
        const a0 = (i * 45 - 90) * Math.PI / 180, a1 = ((i + 1) * 45 - 90) * Math.PI / 180, r = 150;
        const c = ['#37B3D4', '#0D2A6A', '#8CD9F1', '#16163A', '#2FA1C9', '#0B3A7A', '#63C9E6', '#1D1D40'][i];
        return `<path d="M0 0L${(Math.cos(a0) * r).toFixed(1)} ${(Math.sin(a0) * r).toFixed(1)}A${r} ${r} 0 0 1 ${(Math.cos(a1) * r).toFixed(1)} ${(Math.sin(a1) * r).toFixed(1)}Z" fill="${c}"/>`;
      }).join('')}
      ${Array.from({ length: 16 }, (_, i) => `<circle cx="${(Math.cos(i * Math.PI / 8) * 160).toFixed(1)}" cy="${(Math.sin(i * Math.PI / 8) * 160).toFixed(1)}" r="5" fill="#D8F7FF"/>`).join('')}
      <circle r="38" fill="#081022" stroke="url(#${id}-gold)" stroke-width="6"/>
      <path d="M-18 6-22 -14-8 -4 0 -22 8 -4 22 -14 18 6Z" fill="url(#${id}-goldv)"/>
      <path d="M0 -150-22 -196h44Z" fill="#D8F7FF" stroke="#1C647A" stroke-width="3" transform="translate(0 -14)"/>
    </g>
    ${mascot(id, 424, 392, .62)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`,
  rps: (id) => `${stage(id, { sky: ['#2A1A6E', '#130C3C', '#05051A'], glow: '#9B6BFF' })}
    ${[['#E0694B', 120, 250, -14, 'M-34 -10c0-26 16-40 34-40s34 14 34 40c0 28-16 44-34 44s-34-16-34-44Z'], ['#5B7FC9', 256, 196, 0, 'M-40 -44h80v88h-80Z'], ['#46A883', 392, 250, 14, 'M-10 -50 4 -2M10 -50 -4 -2M-22 10a14 14 0 1 0 1 0M22 10a14 14 0 1 0 1 0']].map(([c, x, y, r, d], i) => `<g transform="translate(${x} ${y}) rotate(${r})"><circle r="74" fill="${c}" opacity=".22"/><circle r="74" fill="none" stroke="url(#${id}-gold)" stroke-width="5"/><path d="${d}" fill="${i === 2 ? 'none' : '#D8F7FF'}" stroke="#D8F7FF" stroke-width="${i === 2 ? 9 : 3}" stroke-linecap="round" stroke-linejoin="round"/></g>`).join('')}
    <g fill="#FF8FB3">${[0, 1, 2].map((i) => `<path transform="translate(${212 + i * 44} 72) scale(1.6)" d="M0 6C-6 0-10-4-6-8c2-2 5-2 6 1 1-3 4-3 6-1 4 4 0 8-6 14Z"/>`).join('')}</g>
    ${mascot(id, 256, 380, .74)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`,
  minority: (id) => `${stage(id, { sky: ['#0F4A5E', '#08243C', '#030A18'], glow: '#5EE0FF' })}
    <path d="M256 70V440" stroke="url(#${id}-gold)" stroke-width="6" stroke-dasharray="14 12"/>
    <g>${Array.from({ length: 14 }, (_, i) => `<circle cx="${70 + (i % 4) * 40}" cy="${170 + Math.floor(i / 4) * 52}" r="16" fill="#7A8DB0" opacity=".75"/>`).join('')}</g>
    <g>${Array.from({ length: 3 }, (_, i) => `<circle cx="${350 + i * 46}" cy="230" r="20" fill="url(#${id}-gold)"/><circle cx="${350 + i * 46}" cy="230" r="27" fill="none" stroke="#C2F3FF" stroke-opacity=".6" stroke-width="3"/>`).join('')}</g>
    <text x="128" y="120" text-anchor="middle" font-family="DejaVu Sans,sans-serif" font-size="56" font-weight="700" fill="#9CC4FF" opacity=".8">1</text>
    <text x="396" y="120" text-anchor="middle" font-family="DejaVu Sans,sans-serif" font-size="56" font-weight="700" fill="#A3EAFF">2</text>
    ${mascot(id, 396, 392, .68)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`,
  higherlower: (id) => `${stage(id, { sky: ['#123A8A', '#0A1A4C', '#04081C'] })}
    ${[['K', 156, -10, .9], ['7', 300, 8, 1]].map(([v, x, r, o]) => `<g transform="translate(${x} 236) rotate(${r})" opacity="${o}"><rect x="-82" y="-118" width="164" height="236" rx="18" fill="#D8F7FF" stroke="url(#${id}-gold)" stroke-width="6"/><text x="-52" y="-72" font-family="DejaVu Sans,sans-serif" font-size="40" font-weight="700" fill="#9C1C2A">${v}</text><text x="0" y="40" text-anchor="middle" font-family="DejaVu Sans,sans-serif" font-size="110" font-weight="700" fill="#9C1C2A">${v}</text></g>`).join('')}
    <g fill="url(#${id}-gold)"><path d="M436 120l34 46h-22v60h-24v-60h-22Z"/><path d="M436 388l34-46h-22v-60h-24v60h-22Z" opacity=".7"/></g>
    ${mascot(id, 86, 396, .62)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`,
  truefalse: (id) => `${stage(id, { sky: ['#1D2F86', '#0D1648', '#04071A'], glow: '#5B8CFF' })}
    <g transform="translate(160 214)"><circle r="96" fill="#46A883" opacity=".25"/><circle r="96" fill="none" stroke="url(#${id}-gold)" stroke-width="6"/><path d="M-44 0l30 32 58-64" fill="none" stroke="#7DFFC8" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/></g>
    <g transform="translate(352 214)"><circle r="96" fill="#E0694B" opacity=".25"/><circle r="96" fill="none" stroke="url(#${id}-gold)" stroke-width="6"/><path d="M-36-36 36 36M36-36-36 36" stroke="#FF8F8F" stroke-width="20" stroke-linecap="round"/></g>
    <rect x="96" y="70" width="320" height="34" rx="17" fill="#0B1236" stroke="url(#${id}-gold)" stroke-width="3"/><rect x="118" y="84" width="200" height="6" rx="3" fill="#A3EAFF" opacity=".8"/>
    ${mascot(id, 256, 392, .66)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`,
  redlight: (id) => `${stage(id, { sky: ['#3A0E1E', '#1A0710', '#070206'], glow: '#FF4A5A' })}
    <g transform="translate(372 120)"><rect x="-50" y="-30" width="100" height="232" rx="28" fill="#081022" stroke="url(#${id}-gold)" stroke-width="5"/><circle cy="20" r="54" fill="#FF3B3B" opacity=".25"/><circle cy="20" r="34" fill="#FF3B3B"/><circle cy="96" r="30" fill="#3A3A3A"/><circle cy="166" r="30" fill="#204A2C"/></g>
    <path d="M60 460h300" stroke="url(#${id}-gold)" stroke-width="6"/>
    ${Array.from({ length: 6 }, (_, i) => `<rect x="${70 + i * 48}" y="440" width="30" height="8" rx="3" fill="#C2F3FF" opacity="${(.3 + i * .1).toFixed(1)}"/>`).join('')}
    <g transform="translate(60 0)"><rect x="0" y="300" width="12" height="160" fill="#E7F2F6"/>${Array.from({ length: 4 }, (_, r) => Array.from({ length: 2 }, (_, c) => `<rect x="${12 + c * 14}" y="${300 + r * 14}" width="14" height="14" fill="${(r + c) % 2 ? '#081022' : '#E7F2F6'}"/>`).join('')).join('')}</g>
    ${mascot(id, 210, 370, .7)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`,
  bowling: (id) => `${stage(id, { sky: ['#123A8A', '#0A1A4C', '#04081C'], glow: '#5BC8FF' })}
    <path d="M196 120h120l120 392H76Z" fill="#0B1835"/><path d="M196 120h120l120 392H76Z" fill="url(#${id}-goldv)" opacity=".28"/>
    ${[[256, 150], [236, 168], [276, 168], [216, 188], [256, 188], [296, 188]].map(([x, y]) => `<g transform="translate(${x} ${y})"><path d="M0-30c8 0 10 10 8 18-2 6 8 12 8 26 0 10-6 16-16 16S-16 24-16 14c0-14 10-20 8-26-2-8 0-18 8-18Z" fill="#D8F7FF" stroke="#1C647A" stroke-width="2"/><rect x="-8" y="-14" width="16" height="4" fill="#E0694B"/></g>`).join('')}
    <g transform="translate(256 386)"><circle r="62" fill="#0D1F4A" stroke="url(#${id}-gold)" stroke-width="5"/><circle cx="-14" cy="-20" r="8" fill="#02050F"/><circle cx="12" cy="-24" r="8" fill="#02050F"/><circle cx="0" cy="2" r="8" fill="#02050F"/><path d="M-36-30a44 44 0 0 1 30-18" stroke="#FFFFFF" stroke-opacity=".5" stroke-width="6" fill="none" stroke-linecap="round"/></g>
    ${mascot(id, 420, 392, .58)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`
};

for (const [name, build] of Object.entries(covers)) {
  const svg = `<svg xmlns="${NS}" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="SPONGE LIVE — ${name}">${build('c' + name)}</svg>\n`;
  fs.writeFileSync(path.join(out, name + '.svg'), svg.replace(/\n\s+/g, '\n'));
}
console.log('covers written:', Object.keys(covers).join(', '));
