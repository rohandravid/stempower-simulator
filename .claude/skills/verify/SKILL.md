# Verify StemPower Lab changes

Build/launch/drive recipe for runtime verification of this Vite + React app.

## Launch

```bash
npm run dev -- --port 5273 --strictPort   # background; app at http://localhost:5273
```

## Drive (headless browser)

No playwright in the repo, but a cached npx install works:

```js
import { createRequire } from 'module';
const require = createRequire('/Users/nonan20/.npm/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
```

Browsers are already downloaded (`~/Library/Caches/ms-playwright`). Use a wide
viewport (≥1500px) so the 3-column workspace layout applies.

## Driving the circuit canvas

- The SVG has `viewBox="0 0 1000 640"`; map board coords to page coords with
  `scale = svgBoundingBox.width / 1000`.
- Wiring = `mouse.click` on one hole, then another (pointerdown on `.node-hit`
  circles, r=7 SVG units). Board coords are in `src/circuit/model.ts`
  (`ROW_OFFSET`, `BB`, `UNO`); e.g. `bb.c1` = (426, 130.8), `uno.D13` = (50, 74),
  `uno.GND1` = (116, 296).
- **Gotcha:** part graphics cover nearby holes (LED bulb over rows a/b of its
  columns). The tap that *finishes* a wire snaps through graphics to the nearest
  hole (16-unit radius, capture-phase handler), but the tap that *starts* a wire
  must hit an uncovered hole — start from the Uno pin or a clear row.
- Dragged parts may share a column group with other parts (only exact-hole
  collisions revert); auto-placed parts always land on untouched columns, so
  recompute expected columns after any drag.
- Push button: `mouse.down` on the cap (midpoint between its two pins), hold,
  `mouse.up`. Sliders on modules: pointer-drag horizontally.
- The Run button becomes Stop while the sim runs. The tutorial's "put this code
  in the editor" button auto-stops the sim, so Run is available right after.

## Flows worth driving

- Projects menu → "Build step by step" (tutorial mode) and "Open finished".
- Tutorial panel: `.tutorial-step-title`, `.tutorial-progress-label`,
  `.tutorial-check[data-done]`, `.btn-tutorial-next` (disabled until check passes).
- Run a sketch, watch `.serial-text` and LED lit state; Circuit check card
  (`.diag-item`) for wiring lint.
