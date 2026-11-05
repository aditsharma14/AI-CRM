# Frontend: bundle size and Lighthouse, before and after S1.9

Closes the "production bundle is one chunk over 500 kB" finding. Two builds matter and both are reported:

- **The normal production build** (`npm run build`): what a real deploy ships, and what the CI budget guards.
- **The demo build** (`VITE_DEMO=true`): what the live demo at https://aditsharma14.github.io/AI-CRM/ serves. It adds MSW
  and the seed data, and starts a service worker before the first render, so **every Lighthouse number below is for
  the demo build (MSW in the browser)**, not for a real deploy.

```bash
cd frontend
npm run build && node scripts/bundle-report.mjs              # chunk sizes, and what loads first
ANALYZE=1 npm run build                                      # + dist/stats.html (treemap) and per-package sizes
node scripts/check-bundle-budget.mjs                         # the CI budget check
node ../scripts/bench/lighthouse.mjs <url> <label>           # 3 Lighthouse runs, median saved to bench/results/
```

"Initial JS" is what loads before the first render: the entry chunk and every chunk it imports statically (the
`<script>` and `modulepreload`s in `index.html`). kB = 1024 bytes; gzip sizes are `zlib` defaults.

## Normal production build

| Step (commit) | Initial JS | gzip | Total JS | gzip | Chunks |
|---|---|---|---|---|---|
| **Before** (`4bb3db4`) | 613.3 kB | 187.5 kB | 613.3 kB | 187.5 kB | 1 |
| Pages as lazy chunks, libraries in their own chunks (`2bec34b`) | 567.4 | 179.7 | 619.7 | 199.8 | 18 |
| CSS enter animations instead of framer-motion (`0dcaefb`) | 444.7 | 140.5 | 496.7 | 160.5 | 18 |
| Auth pages lazy too: form libraries only with a form (`5c0d4ed`) | **342.0** | **110.2** | 498.1 | 161.2 | 21 |

**Initial JS: 613 kB → 342 kB (−44%), 188 kB → 110 kB gzip (−41%).** The entry chunk itself is 28.9 kB (8.4 kB gzip).

### Where the weight was (before, by package)

From `ANALYZE=1` (`dist/stats.json`). These are sizes before minification, so they rank packages rather than add up
to the chunk.

| Package | kB | gzip kB | After S1.9 |
|---|---|---|---|
| react-dom | 448.0 | 85.0 | `react` chunk, first load (needed to render anything) |
| motion-dom + framer-motion | 259.6 | 100.4 | **gone**: replaced by three Tailwind keyframes |
| app code (src/) | 161.1 | 47.0 | split: shell in the entry, each page its own chunk (2-15 kB) |
| zod | 119.9 | 27.0 | `forms` chunk, only with a page that has a form |
| axios | 92.2 | 34.8 | `vendor` chunk, first load (the API client) |
| react-router | 90.6 | 22.4 | `react` chunk, first load |
| react-hook-form | 63.4 | 14.3 | `forms` chunk |
| @tanstack/query-core | 63.2 | 18.5 | `query` chunk, first load |

### What changed

1. **Route-level splitting.** Every page is `React.lazy`, with a page-shaped skeleton in `AppLayout`'s `Suspense`, so
   the shell (sidebar, header) stays while a page's chunk loads. On its own this saved little (613 → 567 kB): almost
   all of the weight was libraries the shell loaded eagerly.
2. **Libraries in their own chunks** (`react`, `query`, `forms`, `vendor`): a deploy that changes only the app
   leaves them cached.
3. **framer-motion removed.** The layout imported it for 120-150 ms fade and slide-ins in menus and dialogs, so it was
   in every first load. CSS keyframes (`motion-safe:`, none under reduced motion) do the same entrance. The
   **trade-off:** the exit fade is gone; panels and dialogs close at once.
4. **Auth pages lazy too.** Only pages import zod and react-hook-form; with sign-in in the entry, every first load
   carried them. Now the Dashboard (signed in or guest) loads none. Landing on `/login` costs one more round trip: the
   login chunk and the form libraries load in parallel after the entry.

**Nothing large is imported eagerly by the layouts any more:** `AppLayout` imports the shell's own parts (sidebar,
header, the search palette, the notifications panel), `lucide-react` icons (tree-shaken, 9 kB gzip in all) and the
API/session code; `AuthLayout` imports only a loader.

## Demo build (what the live demo serves)

| | Initial JS | gzip | Total JS | gzip |
|---|---|---|---|---|
| After (`18b2fbe`) | 729.5 kB | 258.8 kB | 915.2 kB | 321.6 kB |

The demo adds MSW and its dependencies to the first load, because the service worker must be running before the app's
first request. The biggest is **`tldts` (109 kB gzip)**, the public-suffix list MSW's cookie handling pulls in
(through tough-cookie). It ships only in the demo; CI checks the normal build has none of it (`check-no-demo.mjs`).

## Lighthouse: demo build (MSW in browser)

Lighthouse 12.6.1, CLI defaults (**mobile preset**: emulated Moto G Power, slow 4G, 4x CPU slowdown), on
https://aditsharma14.github.io/AI-CRM/ (the guest Dashboard). 3 runs each from the same machine; the table shows the
median run (by score), the range across the 3 in brackets.

| Demo build (MSW in browser) | Before (`4bb3db4`) | After (`18b2fbe`) |
|---|---|---|
| Performance | **91** (90-91) | **92** (92-95) |
| LCP | 2,907 ms (2,883-2,916) | **2,631 ms** (2,419-2,631) |
| TBT | 55 ms (55-87) | **13 ms** (8-13) |
| FCP | 2,472 ms (2,307-2,472) | 2,556 ms (2,344-2,556) |
| JS transferred | 351 kB in 3 requests | **275 kB** in 11 requests |
| Lighthouse "Reduce unused JavaScript" | 154 KiB | 66 KiB |

Raw results: [bench/results/lighthouse-before.json](results/lighthouse-before.json),
[lighthouse-after.json](results/lighthouse-after.json).

**Why lazy loading helps LCP:** the browser can't paint the page until it has downloaded, parsed and run the JS that
renders it. Less JS before the first render means less of all three, so the main thread is free sooner (TBT 55 → 13 ms)
and the largest element paints earlier (LCP −276 ms). Code for pages the visitor hasn't opened is fetched only when
they do.

**Why the score barely moved here:** the demo must start MSW's service worker before React renders anything, so the
LCP element (the demo banner) waits on the demo's own code: 71% of its LCP is render delay. A real deploy has no such
wait and ships 110 kB gzip of initial JS instead of 259 kB.

### The top Lighthouse findings

1. **"Reduce unused JavaScript"**: fixed as far as it is cheap, 154 → 66 KiB. What remains is 37 KiB of the demo's
   `vendor` chunk (MSW and `tldts`, needed before the first render) and 29 KiB of `react-dom` (it can't be split).
2. **"Initial server response time" and "Use efficient cache lifetimes"**: GitHub Pages' hosting (its TTFB and its
   10-minute `Cache-Control`). Not fixable from this repo; a real deploy would serve the hashed `assets/` with a long
   immutable cache.

Not done, and why: starting MSW after the first render (it would make API calls race the worker), and inlining
critical CSS (Lighthouse rates render-blocking CSS at 0.5; the stylesheet is 18 kB, 4.5 kB gzip).

## CI budget

[frontend/bundle-budget.json](../frontend/bundle-budget.json), checked by
[check-bundle-budget.mjs](../frontend/scripts/check-bundle-budget.mjs) in the CI frontend job after the build. Set at
the after-size + 10%:

| | Measured | Budget |
|---|---|---|
| Entry chunk | 28.9 kB (8.4 gzip) | **31.8 kB (9.2 gzip)** |
| Initial JS | 342.0 kB (110.2 gzip) | **376.2 kB (121.2 gzip)**; 407.8 kB (130.5 gzip) since #48, see below |

Both, because moving code from the entry into a chunk the entry imports statically would pass an entry-only budget
without loading any less.

## After the security fixes (#30)

`npm audit fix` (#30) moved two runtime libraries up a minor version within their ranges. Measured with
`ANALYZE=1 npm run build && node scripts/bundle-report.mjs` on `main` just before and just after #30:

| | Before #30 | After #30 | Change |
|---|---|---|---|
| Initial JS | 343.9 kB (110.8 gzip) | 353.8 kB (114.1 gzip) | +9.9 kB (+3.3 gzip) |
| `vendor` chunk (initial) | 52.4 kB (19.9 gzip) | 64.7 kB (23.8 gzip) | +12.3 kB |
| `index` chunk (entry) | 29.1 kB (8.4 gzip) | 30.6 kB (9.0 gzip) | +1.5 kB |
| `react` chunk (initial) | 227.2 kB (72.0 gzip) | 223.4 kB (70.7 gzip) | −3.8 kB |
| `forms` chunk (lazy) | 93.0 kB (27.1 gzip) | 112.0 kB (33.4 gzip) | +19.0 kB |

- **axios 1.18.1 → 1.21.0** (in `vendor`, so initial): the release that fixes the high advisory. It is real code:
  six new modules (`formDataToBlob`, `assertParamsAcyclic`, `createMultipartBody` and three smaller ones) and larger
  `utils`, `xhr`, `fetch` and `AxiosHeaders` modules, 92.0 → 118.1 kB in the module stats.
- **zod 4.4.3 → 4.6.7** (in the lazy `forms` chunk, so not initial): 119.9 → 154.5 kB in the module stats.
- **Nothing came in by accident:** one version of each package (`npm ls`), the same entry files as before (axios's
  `lib/` ESM build), and the app's own code unchanged at 177.4 kB.

Both budgets still pass. The entry chunk has the least room: 30.6 kB against a 31.8 kB budget.

## The frontend minor and patch group (#48)

Dependabot's frontend group (13 minor and patch bumps) failed the initial-JS budget. Measured with `npm run build &&
node scripts/check-bundle-budget.mjs` on `main` and on #48's branch, chunk sizes from `dist/assets`:

| | `main` | #48 | Change |
|---|---|---|---|
| Initial JS | 353.8 kB (114.1 gzip) | 385.4 kB (123.4 gzip) | **+31.6 kB (+9.3 gzip)** |
| `react` chunk (initial) | 223.4 kB (70.7 gzip) | 251.9 kB (79.1 gzip) | +28.5 kB (+8.4 gzip) |
| `vendor` chunk (initial) | 64.7 kB (23.9 gzip) | 67.9 kB (25.0 gzip) | +3.2 kB (+1.1 gzip) |
| `index` chunk (entry) | 30.6 kB (9.0 gzip) | 30.6 kB (9.0 gzip) | 0 |
| `forms` chunk (lazy) | 112.0 kB (33.3 gzip) | 119.3 kB (35.6 gzip) | +7.3 kB, not initial |

- **react and react-dom 19.2.7 → 19.3.1** are almost all of it. The app can't render without them, so lazy loading
  can't move them.
- **lucide-react 1.23 → 1.66** (in `vendor`): every import is a named import of one icon, and both builds contain the
  same 37 icon definitions (the ones the app uses, not the package's whole set). 1.66 writes each icon as a plain
  object instead of a factory call; the small `vendor` growth is that and the other bumps in the chunk.
- **react-hook-form 7.80 → 7.91** grows the lazy `forms` chunk only.

**Budget raised by the measured growth:** initial JS 376.2 → 407.8 kB, 121.2 → 130.5 kB gzip. The entry chunk budget
is unchanged.
