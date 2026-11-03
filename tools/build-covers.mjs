// Generates the original SKY LIVE game covers in public/covers/*.svg.
// Run: node tools/build-covers.mjs — every cover shares the stage lighting and the
// "Sky" mascot (an obsidian crown-bot) so the catalogue reads as one family.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'covers');
fs.mkdirSync(out, { recursive: true });
const NS = 'http://www.w3.org/2000/svg';

const stage = (id, { sky = ['#13307a', '#0a1640', '#050818'], glow = '#3d8bff', floor = '#D4AF37' } = {}) => `
  <defs>
    <radialGradient id="${id}-sky" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="${sky[0]}"/><stop offset=".55" stop-color="${sky[1]}"/><stop offset="1" stop-color="${sky[2]}"/></radialGradient>
    <radialGradient id="${id}-glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${glow}" stop-opacity=".75"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}-floor" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${floor}" stop-opacity=".7"/><stop offset=".6" stop-color="${floor}" stop-opacity=".12"/><stop offset="1" stop-color="${floor}" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF6D8"/><stop offset=".3" stop-color="#F1D58C"/><stop offset=".62" stop-color="#C9982F"/><stop offset="1" stop-color="#F4DA92"/></linearGradient>
    <linearGradient id="${id}-goldv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF1C2"/><stop offset=".5" stop-color="#D4AF37"/><stop offset="1" stop-color="#7a5f1c"/></linearGradient>
    <radialGradient id="${id}-vig" cx="50%" cy="45%" r="72%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".7"/></radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#${id}-sky)"/>
  <g opacity=".22" stroke="#9cc4ff" stroke-width="1.2">${Array.from({ length: 9 }, (_, i) => `<path d="M256 -40 L${-80 + i * 84} 560"/>`).join('')}</g>
  <ellipse cx="256" cy="210" rx="230" ry="190" fill="url(#${id}-glow)"/>
  <ellipse cx="256" cy="440" rx="260" ry="70" fill="url(#${id}-floor)"/>
  <g fill="#fff">${[[60, 70, 2], [430, 60, 2.6], [470, 170, 1.6], [90, 200, 1.4], [380, 120, 1.2], [150, 40, 1.4], [330, 30, 1.8]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" opacity=".85"/>`).join('')}</g>
  <g fill="#FFF1C2">${[[420, 250], [72, 300], [300, 70]].map(([x, y]) => `<path d="M${x} ${y - 10}q2 8 10 10q-8 2-10 10q-2-8-10-10q8-2 10-10Z"/>`).join('')}</g>`;

// "Sky", the house mascot: obsidian crown-bot with cyan visor eyes.
const mascot = (id, x, y, s = 1, flip = false) => `
  <g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})">
    <ellipse cx="0" cy="96" rx="58" ry="10" fill="#000" opacity=".45"/>
    <path d="M-44 92c-4-26 4-46 22-52h44c18 6 26 26 22 52Z" fill="#14151a" stroke="url(#${id}-gold)" stroke-width="3"/>
    <circle cx="0" cy="66" r="8" fill="url(#${id}-gold)"/>
    <rect x="-52" y="-30" width="104" height="80" rx="38" fill="#17181e" stroke="url(#${id}-gold)" stroke-width="4"/>
    <rect x="-38" y="-12" width="76" height="40" rx="20" fill="#071a33" stroke="#2b6fd6" stroke-width="2"/>
    <ellipse cx="-15" cy="8" rx="8" ry="10" fill="#7fe3ff"/><ellipse cx="15" cy="8" rx="8" ry="10" fill="#7fe3ff"/>
    <circle cx="-12" cy="4" r="3" fill="#fff"/><circle cx="18" cy="4" r="3" fill="#fff"/>
    <path d="M-8 22q8 6 16 0" fill="none" stroke="#7fe3ff" stroke-width="3" stroke-linecap="round"/>
    <path d="M-34 -28 -40 -62 -16 -44 0 -70 16 -44 40 -62 34 -28Z" fill="url(#${id}-goldv)" stroke="#FFF1C2" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="0" cy="-48" r="5" fill="#5bc8ff"/>
    <path d="M-52 40c-16 6-22 20-18 34M52 40c16 6 22 20 18 34" fill="none" stroke="#17181e" stroke-width="12" stroke-linecap="round"/>
    <circle cx="-70" cy="76" r="9" fill="url(#${id}-gold)"/><circle cx="70" cy="76" r="9" fill="url(#${id}-gold)"/>
  </g>`;

const covers = {
  quiz: (id) => `${stage(id)}
    <path d="M150 -10 196 300h120l46-310Z" fill="#fff" opacity=".06"/>
    <g transform="translate(256 200)">
      <rect x="-132" y="-96" width="264" height="182" rx="26" fill="url(#${id}-gold)"/>
      <rect x="-118" y="-82" width="236" height="154" rx="18" fill="#081536"/>
      <rect x="-118" y="-82" width="236" height="154" rx="18" fill="none" stroke="#5bc8ff" stroke-opacity=".5" stroke-width="2"/>
      <path d="M-26 -38c0-24 18-38 38-38 22 0 38 14 38 34 0 30-34 30-34 58v6" fill="none" stroke="#FFF6D8" stroke-width="20" stroke-linecap="round" transform="translate(-12 0)"/>
      <circle cx="0" cy="54" r="11" fill="#FFF6D8"/>
      ${Array.from({ length: 14 }, (_, i) => `<circle cx="${-120 + i * 18.5}" cy="-104" r="4" fill="#FFF1C2" opacity="${i % 2 ? .5 : 1}"/>`).join('')}
    </g>
    ${[['#E0694B', 150], ['#5B7FC9', 222], ['#46A883', 294], ['#9774C6', 366]].map(([c, x]) => `<ellipse cx="${x}" cy="352" rx="30" ry="13" fill="${c}"/><ellipse cx="${x}" cy="346" rx="30" ry="13" fill="${c}" opacity=".9"/><ellipse cx="${x - 8}" cy="342" rx="10" ry="4" fill="#fff" opacity=".5"/>`).join('')}
    ${mascot(id, 412, 360, .78)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`,
  bomb: (id) => `${stage(id, { sky: ['#5a1d10', '#2a0c08', '#0d0505'], glow: '#ff5a1f' })}
    <circle cx="246" cy="282" r="132" fill="#101114"/>
    <circle cx="246" cy="282" r="132" fill="none" stroke="#ff6a2a" stroke-opacity=".55" stroke-width="5"/>
    <path d="M168 220a100 100 0 0 1 60 -58" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="12" stroke-linecap="round"/>
    <rect x="262" y="132" width="58" height="40" rx="6" fill="#5b5c63" transform="rotate(30 291 152)"/>
    <path d="M300 136c18-40 58-34 70-62s36-30 50-18" fill="none" stroke="#b98a52" stroke-width="8" stroke-linecap="round"/>
    <circle cx="420" cy="56" r="30" fill="#ffb347" opacity=".45"/><circle cx="420" cy="56" r="14" fill="#FFF6D8"/>
    <g stroke="#ffd27a" stroke-width="4" stroke-linecap="round">${[0, 60, 120, 180, 240, 300].map((a) => `<path d="M420 56l${Math.round(Math.cos(a * Math.PI / 180) * 34)} ${Math.round(Math.sin(a * Math.PI / 180) * 34)}"/>`).join('')}</g>
    <rect x="176" y="300" width="140" height="58" rx="12" fill="#050506" stroke="#4a1a14" stroke-width="3"/>
    <text x="246" y="343" text-anchor="middle" font-family="DejaVu Sans Mono,Menlo,monospace" font-size="40" font-weight="700" fill="#ff4a2f">00:15</text>
    ${mascot(id, 92, 380, .7, true)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`,
  race: (id) => `${stage(id, { sky: ['#1a2f86', '#0b1546', '#04071a'] })}
    <path d="M256 210 40 512h432Z" fill="#0b0f26"/>
    <path d="M256 210 40 512M256 210 472 512" stroke="url(#${id}-gold)" stroke-width="6"/>
    <path d="M256 230v40M256 300v60M256 400v90" stroke="#FFF1C2" stroke-width="7" stroke-linecap="round" opacity=".7"/>
    <g transform="translate(116 80)">${Array.from({ length: 4 }, (_, r) => Array.from({ length: 10 }, (_, c) => (r + c) % 2 ? '' : `<rect x="${c * 28}" y="${r * 18}" width="28" height="18" fill="#F6F1E7"/>`).join('')).join('')}<rect width="280" height="72" fill="none" stroke="url(#${id}-gold)" stroke-width="4"/></g>
    <g transform="translate(256 370)">
      <path d="M-112 30c0-44 26-72 112-72s112 28 112 72v30h-224Z" fill="url(#${id}-goldv)" stroke="#FFF1C2" stroke-width="3"/>
      <path d="M-70 -30c10-26 34-40 70-40s60 14 70 40Z" fill="#0b2a5a" stroke="#5bc8ff" stroke-width="3"/>
      <rect x="-96" y="20" width="56" height="18" rx="8" fill="#FFF6D8"/><rect x="40" y="20" width="56" height="18" rx="8" fill="#FFF6D8"/>
      <rect x="-128" y="56" width="44" height="40" rx="10" fill="#0d0e12"/><rect x="84" y="56" width="44" height="40" rx="10" fill="#0d0e12"/>
    </g>
    <g stroke="#9cc4ff" stroke-width="4" stroke-linecap="round" opacity=".5"><path d="M60 300l60 20M40 360l70 16M452 300l-60 20M472 360l-70 16"/></g>
    ${mascot(id, 420, 196, .6)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`,
  glass: (id) => `${stage(id, { sky: ['#0e4a73', '#072a4a', '#020a18'], glow: '#5ee0ff' })}
    <path d="M190 160h132l120 352H70Z" fill="#020812" opacity=".7"/>
    ${Array.from({ length: 5 }, (_, i) => {
      const t = i / 5, t2 = (i + 1) / 5, y1 = 170 + t * 330, y2 = 170 + t2 * 330 - 10;
      const w1 = 70 + t * 200, w2 = 70 + t2 * 200;
      const row = (side) => {
        const s = side < 0 ? -1 : 1;
        const cracked = (i === 2 && side < 0) || (i === 4 && side > 0);
        const pts = `${256 + s * 6} ${y1} ${256 + s * w1 / 2} ${y1} ${256 + s * w2 / 2} ${y2} ${256 + s * 8} ${y2}`;
        return `<polygon points="${pts}" fill="${cracked ? '#5ee0ff' : '#bdf3ff'}" fill-opacity="${cracked ? .18 : .32}" stroke="#e8fdff" stroke-width="2"/>${cracked ? `<path d="M${256 + s * w1 / 4} ${y1 + 8}l${s * 14} ${(y2 - y1) / 2}l${-s * 18} ${(y2 - y1) / 2 - 10}" stroke="#fff" stroke-width="2" fill="none"/>` : ''}`;
      };
      return row(-1) + row(1);
    }).join('')}
    <path d="M256 160V512" stroke="url(#${id}-gold)" stroke-width="5"/>
    <path d="M186 160 66 512M326 160l120 352" stroke="url(#${id}-gold)" stroke-width="4"/>
    ${mascot(id, 256, 116, .62)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`,
  guess: (id) => `${stage(id, { sky: ['#2a2486', '#141048', '#05051a'], glow: '#7b6bff' })}
    ${['ك', 'ل', '؟', 'م', 'ة'].map((ch, i) => {
      const x = 64 + i * 80, lit = ch === '؟';
      return `<g transform="translate(${x} 196) rotate(${(i - 2) * 3})"><rect width="68" height="80" rx="14" fill="${lit ? `url(#${id}-gold)` : '#141633'}" stroke="${lit ? '#FFF6D8' : `url(#${id}-gold)`}" stroke-width="3"/><text x="34" y="56" text-anchor="middle" font-family="Tajawal,DejaVu Sans,sans-serif" font-size="44" font-weight="800" fill="${lit ? '#2A2008' : '#F1D58C'}">${ch}</text></g>`;
    }).join('')}
    <g transform="translate(318 300) rotate(-28)"><circle r="62" fill="#9cc4ff" fill-opacity=".12" stroke="url(#${id}-gold)" stroke-width="12"/><rect x="-11" y="62" width="22" height="88" rx="10" fill="url(#${id}-goldv)"/><path d="M-30 -30a42 42 0 0 1 36 -14" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".7"/></g>
    ${mascot(id, 128, 380, .72)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`,
  wheel: (id) => `${stage(id, { sky: ['#123a8a', '#0a1a4c', '#04081c'] })}
    <g transform="translate(256 236)">
      <circle r="168" fill="url(#${id}-gold)"/>
      ${Array.from({ length: 8 }, (_, i) => {
        const a0 = (i * 45 - 90) * Math.PI / 180, a1 = ((i + 1) * 45 - 90) * Math.PI / 180, r = 150;
        const c = ['#D4AF37', '#0d2a6a', '#F1D58C', '#16163a', '#C9982F', '#0b3a7a', '#E6C463', '#1d1d40'][i];
        return `<path d="M0 0L${(Math.cos(a0) * r).toFixed(1)} ${(Math.sin(a0) * r).toFixed(1)}A${r} ${r} 0 0 1 ${(Math.cos(a1) * r).toFixed(1)} ${(Math.sin(a1) * r).toFixed(1)}Z" fill="${c}"/>`;
      }).join('')}
      ${Array.from({ length: 16 }, (_, i) => `<circle cx="${(Math.cos(i * Math.PI / 8) * 160).toFixed(1)}" cy="${(Math.sin(i * Math.PI / 8) * 160).toFixed(1)}" r="5" fill="#FFF6D8"/>`).join('')}
      <circle r="38" fill="#0d0e12" stroke="url(#${id}-gold)" stroke-width="6"/>
      <path d="M-18 6-22 -14-8 -4 0 -22 8 -4 22 -14 18 6Z" fill="url(#${id}-goldv)"/>
      <path d="M0 -150-22 -196h44Z" fill="#FFF6D8" stroke="#7a5f1c" stroke-width="3" transform="translate(0 -14)"/>
    </g>
    ${mascot(id, 424, 392, .62)}
    <rect width="512" height="512" fill="url(#${id}-vig)"/>`
};

for (const [name, build] of Object.entries(covers)) {
  const svg = `<svg xmlns="${NS}" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="SKY LIVE — ${name}">${build('c' + name)}</svg>\n`;
  fs.writeFileSync(path.join(out, name + '.svg'), svg.replace(/\n\s+/g, '\n'));
}
console.log('covers written:', Object.keys(covers).join(', '));
