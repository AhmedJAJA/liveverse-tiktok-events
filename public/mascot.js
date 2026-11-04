/* SKY LIVE — "Sky", the house mascot (same drawing as the game covers).
   SkyMascot.svg({ visor, crown }) returns an SVG string built only from the fixed presets. */
(() => {
  'use strict';
  const VISORS = ['#7fe3ff', '#7dffc8', '#ff8fb3', '#ffd36c', '#c9a7ff'];
  const CROWNS = {
    gold: ['#FFF1C2', '#D4AF37', '#7a5f1c'],
    silver: ['#ffffff', '#c9ccd3', '#6b7079'],
    rose: ['#ffe1d6', '#e8a08a', '#8a4b3c'],
    obsidian: ['#6b6f7a', '#25262c', '#0b0b0d']
  };
  let n = 0;
  function svg({ visor = VISORS[0], crown = 'gold' } = {}, { size = 120, title = 'Sky' } = {}) {
    const v = VISORS.includes(visor) ? visor : VISORS[0];
    const c = CROWNS[crown] || CROWNS.gold;
    const id = 'skym' + (++n);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-80 -80 160 190" width="${size}" height="${Math.round(size * 190 / 160)}" role="img" aria-label="${title}">
<defs><linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset=".55" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[2]}"/></linearGradient></defs>
<ellipse cx="0" cy="96" rx="58" ry="10" fill="#000" opacity=".45"/>
<path d="M-44 92c-4-26 4-46 22-52h44c18 6 26 26 22 52Z" fill="#14151a" stroke="url(#${id}g)" stroke-width="3"/>
<circle cx="0" cy="66" r="8" fill="url(#${id}g)"/>
<rect x="-52" y="-30" width="104" height="80" rx="38" fill="#17181e" stroke="url(#${id}g)" stroke-width="4"/>
<rect x="-38" y="-12" width="76" height="40" rx="20" fill="#071a33" stroke="${v}" stroke-opacity=".6" stroke-width="2"/>
<ellipse cx="-15" cy="8" rx="8" ry="10" fill="${v}"/><ellipse cx="15" cy="8" rx="8" ry="10" fill="${v}"/>
<circle cx="-12" cy="4" r="3" fill="#fff"/><circle cx="18" cy="4" r="3" fill="#fff"/>
<path d="M-8 22q8 6 16 0" fill="none" stroke="${v}" stroke-width="3" stroke-linecap="round"/>
<path d="M-34 -28 -40 -62 -16 -44 0 -70 16 -44 40 -62 34 -28Z" fill="url(#${id}g)" stroke="${c[0]}" stroke-width="2" stroke-linejoin="round"/>
<circle cx="0" cy="-48" r="5" fill="${v}"/>
<path d="M-52 40c-16 6-22 20-18 34M52 40c16 6 22 20 18 34" fill="none" stroke="#17181e" stroke-width="12" stroke-linecap="round"/>
<circle cx="-70" cy="76" r="9" fill="url(#${id}g)"/><circle cx="70" cy="76" r="9" fill="url(#${id}g)"/>
</svg>`;
  }
  // DOM node version: parsed as XML from the fixed template, never injected as HTML.
  function element(opts, size) {
    const doc = new DOMParser().parseFromString(svg(opts, size), 'image/svg+xml');
    return document.importNode(doc.documentElement, true);
  }
  window.SkyMascot = Object.freeze({ svg, element, VISORS, CROWNS: Object.keys(CROWNS) });
})();
