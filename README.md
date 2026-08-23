# PWA Apps

A small collection of offline-first Progressive Web Apps. Each one launches instantly from
the home screen with no network at all, and updates itself quietly in the background.

Live at **[jhbadger.github.io/pwa](https://jhbadger.github.io/pwa/)**.

## Apps

| App | Description |
| --- | --- |
| [Thermidor](thermidor/) | French Republican Calendar and decimal clock converter. |
| [Minichess](minichess/) | Gardner's 5x5 minichess against the computer. |
| [Jigsaw](jigsaw/) | Jigsaw puzzles from bundled art or your own photos. |
| [Video Poker](videopoker/) | Five-card draw video poker, Jacks-or-Better paytable. |
| [Shanghai Solitaire](shanghai/) | Mahjong tile-matching solitaire — clear the board by pairing free tiles. |
| [Library](library/) | Read classic literature offline — pick a book off the shelf and turn its pages. |
| [BASIC](basic/) | A line-numbered BASIC interpreter with canvas graphics and sound. |
| [Piano](piano/) | Two-octave piano with chords, plus a learn-by-highlighting mode for simple songs. |
| [Slots](slots/) | Classic 3-reel fruit machine — cherries, lemons, bells and bars, with sound effects. |

## Structure

Every app is a self-contained static directory — no build tooling, no dependencies, no
external requests at runtime:

```
<app>/
  index.html
  css/style.css
  js/*.js
  manifest.webmanifest
  sw.js               cache-first service worker; precaches everything the app needs
  icons/
  scripts/build.mjs   stamps sw.js with a hash of the precached files
```

`index.html` at the repo root is just a hub page linking out to each app.

### Working on an app

After editing anything a service worker precaches (HTML, CSS, JS, icons), regenerate its
cache version so browsers pick up the change:

```sh
node <app>/scripts/build.mjs
```

Serve the repo root with any static file server and open `/<app>/` to test locally, e.g.:

```sh
python3 -m http.server 8080
```

## License

MIT — see [LICENSE](LICENSE).
