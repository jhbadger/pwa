// Registry of bundled books. `cover` selects a CSS look (css/style.css
// .cover--<id> rules) and `icon` is a small inline SVG silhouette — original
// vector art, not scanned cover images, so there's nothing to license or
// precache as a binary asset. Each icon is sized on a 0 0 100 100 viewBox.
export const BOOKS = [
  {
    id: 'treasure-island',
    title: 'Treasure Island',
    author: 'Robert Louis Stevenson',
    cover: 'treasure-island',
    icon: `<circle cx="50" cy="38" r="24"/>
      <circle cx="40" cy="35" r="5" fill="var(--cover-bg)"/>
      <circle cx="60" cy="35" r="5" fill="var(--cover-bg)"/>
      <path d="M50 44 L46 52 L54 52 Z" fill="var(--cover-bg)"/>
      <path d="M20 78 L80 60 M20 60 L80 78" stroke="currentColor" stroke-width="6" fill="none"/>`,
  },
  {
    id: 'call-of-the-wild',
    title: 'The Call of the Wild',
    author: 'Jack London',
    cover: 'call-of-the-wild',
    icon: `<circle cx="68" cy="28" r="16"/>
      <circle cx="62" cy="24" r="16" fill="var(--cover-bg)"/>
      <path d="M10 82 L38 40 L52 62 L66 30 L90 82 Z"/>`,
  },
  {
    id: 'alice',
    title: "Alice's Adventures in Wonderland",
    author: 'Lewis Carroll',
    cover: 'alice',
    icon: `<circle cx="50" cy="52" r="30" fill="none" stroke="currentColor" stroke-width="6"/>
      <path d="M50 52 L50 34 M50 52 L64 60" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M40 16 Q50 6 60 16" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="round"/>
      <circle cx="50" cy="12" r="4"/>`,
  },
  {
    id: 'dracula',
    title: 'Dracula',
    author: 'Bram Stoker',
    cover: 'dracula',
    icon: `<path d="M50 30 C40 15 20 20 10 35 C22 32 30 38 34 46 C24 46 16 54 12 66 C24 60 34 60 40 66 C44 58 47 52 50 50
               C53 52 56 58 60 66 C66 60 76 60 88 66 C84 54 76 46 66 46 C70 38 78 32 90 35 C80 20 60 15 50 30 Z"/>`,
  },
];

export function bookById(id) {
  return BOOKS.find((b) => b.id === id);
}
