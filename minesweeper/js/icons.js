// Small hand-drawn cell icons (flag, mine), each a self-contained inline
// SVG body on a 0 0 100 100 viewBox, matching the icon convention used by
// the other apps in this collection.

export const FLAG_SVG = `
  <path d="M30 10 L30 90" stroke="#3a2a1a" stroke-width="9" stroke-linecap="round"/>
  <circle cx="30" cy="90" r="6" fill="#3a2a1a"/>
  <path d="M30 14 L78 29 L30 46 Z" fill="#d43b3b" stroke="#8f1f1f" stroke-width="2" stroke-linejoin="round"/>`;

export const WRONG_FLAG_SVG = `
  ${FLAG_SVG}
  <path d="M16 16 L84 84 M84 16 L16 84" stroke="#d43b3b" stroke-width="9" stroke-linecap="round"/>`;

export const MINE_SVG = `
  <g stroke="#161010" stroke-width="6" stroke-linecap="round">
    <path d="M50 8 L50 26"/>
    <path d="M50 74 L50 92"/>
    <path d="M8 50 L26 50"/>
    <path d="M74 50 L92 50"/>
    <path d="M20 20 L33 33"/>
    <path d="M80 20 L67 33"/>
    <path d="M20 80 L33 67"/>
    <path d="M80 80 L67 67"/>
  </g>
  <circle cx="50" cy="50" r="26" fill="#161010"/>
  <circle cx="41" cy="41" r="7" fill="#5a5a5a" opacity="0.7"/>`;

export const EXPLODED_MINE_SVG = MINE_SVG;
