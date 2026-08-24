// Pipe-segment icons, one path per piece type, all sharing the same thick
// rounded-stroke "tube" styling. Deliberately colorless (stroke:
// currentColor) — dry vs. wet is a CSS class on the containing cell, not a
// different icon, so the same markup serves the board and the queue strip.

const TUBE = 'fill="none" stroke="currentColor" stroke-width="30" stroke-linecap="round"';

export const PIECE_SVG = {
  NS: `<path d="M50 0 L50 100" ${TUBE}/>`,
  EW: `<path d="M0 50 L100 50" ${TUBE}/>`,
  NE: `<path d="M50 0 Q50 50 100 50" ${TUBE}/>`,
  NW: `<path d="M50 0 Q50 50 0 50" ${TUBE}/>`,
  SE: `<path d="M50 100 Q50 50 100 50" ${TUBE}/>`,
  SW: `<path d="M50 100 Q50 50 0 50" ${TUBE}/>`,
};

// The fixed tap: a small tank with a short stub feeding south into the
// board, so it reads as "where the water comes from" rather than another
// ordinary piece.
export const SOURCE_SVG = `
  <rect x="24" y="6" width="52" height="34" rx="8" fill="currentColor"/>
  <path d="M50 40 L50 100" ${TUBE}/>`;

export function pieceIconHTML(type, extraClass = '') {
  const body = type === 'SOURCE' ? SOURCE_SVG : PIECE_SVG[type];
  return `<svg class="pipe-icon ${extraClass}" viewBox="0 0 100 100" aria-hidden="true">${body}</svg>`;
}
