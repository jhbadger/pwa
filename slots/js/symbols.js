// Hand-drawn slot symbols, one per traditional fruit-machine icon. Each is a
// self-contained inline SVG body on a 0 0 100 100 viewBox. Unlike the other
// apps' monochrome icons these carry their own fixed colors — real fruit-
// machine symbols are full-color, not theme-tinted.
export const SYMBOL_SVG = {
  cherry: `
    <path d="M50 10 C54 24 56 30 50 36" fill="none" stroke="#5a8a3c" stroke-width="4" stroke-linecap="round"/>
    <path d="M50 10 C44 6 34 6 30 14 C38 12 44 14 48 20" fill="#5a8a3c"/>
    <path d="M50 10 C58 26 62 34 66 44" fill="none" stroke="#5a8a3c" stroke-width="4" stroke-linecap="round"/>
    <circle cx="34" cy="60" r="20" fill="#c62b2b"/>
    <circle cx="66" cy="64" r="20" fill="#c62b2b"/>
    <circle cx="27" cy="52" r="6" fill="#ef7d7d" opacity="0.7"/>
    <circle cx="59" cy="56" r="6" fill="#ef7d7d" opacity="0.7"/>`,
  lemon: `
    <g transform="rotate(-18 50 50)">
      <ellipse cx="50" cy="50" rx="34" ry="24" fill="#f4d13a"/>
      <path d="M18 42 C12 40 8 42 6 46 C10 44 14 45 18 48 Z" fill="#e8b52e"/>
      <path d="M82 58 C88 60 92 58 94 54 C90 56 86 55 82 52 Z" fill="#e8b52e"/>
      <ellipse cx="40" cy="40" rx="10" ry="5" fill="#fbe374" opacity="0.7"/>
    </g>`,
  orange: `
    <path d="M50 10 C46 6 40 6 38 12 C42 10 46 12 48 16" fill="#5a8a3c"/>
    <rect x="48" y="8" width="4" height="8" rx="2" fill="#7a5a2c"/>
    <circle cx="50" cy="56" r="34" fill="#f08a1e"/>
    <circle cx="40" cy="46" r="8" fill="#f6ad57" opacity="0.6"/>`,
  plum: `
    <path d="M50 6 C44 2 34 2 30 10 C38 8 44 10 48 16" fill="#5a8a3c"/>
    <g fill="#7a3f9e">
      <circle cx="50" cy="30" r="12"/>
      <circle cx="36" cy="42" r="12"/>
      <circle cx="64" cy="42" r="12"/>
      <circle cx="30" cy="58" r="12"/>
      <circle cx="50" cy="58" r="12"/>
      <circle cx="70" cy="58" r="12"/>
      <circle cx="40" cy="74" r="12"/>
      <circle cx="60" cy="74" r="12"/>
    </g>
    <circle cx="46" cy="26" r="4" fill="#b98fd6" opacity="0.6"/>`,
  bell: `
    <circle cx="50" cy="12" r="6" fill="none" stroke="#e3b23c" stroke-width="4"/>
    <path d="M50 16 L50 22" stroke="#e3b23c" stroke-width="4"/>
    <path d="M30 66 C30 34 70 34 70 66 C78 66 82 74 82 78 L18 78 C18 74 22 66 30 66 Z" fill="#f0c04c" stroke="#a97a1e" stroke-width="2"/>
    <rect x="16" y="78" width="68" height="8" rx="3" fill="#d9a533" stroke="#a97a1e" stroke-width="2"/>
    <circle cx="50" cy="92" r="6" fill="#a97a1e"/>`,
  bar: `
    <rect x="6" y="34" width="88" height="32" rx="6" fill="#161010" stroke="#e3b23c" stroke-width="4"/>
    <text x="50" y="58" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="800" fill="#f4d13a">BAR</text>`,
  seven: `
    <text x="50" y="86" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="92" font-weight="900" fill="#c62b2b" stroke="#f4d13a" stroke-width="3">7</text>`,
};

export function symbolIconHTML(sym, extraClass = '') {
  return `<svg class="symbol-icon ${extraClass}" viewBox="0 0 100 100" aria-hidden="true">${SYMBOL_SVG[sym]}</svg>`;
}
