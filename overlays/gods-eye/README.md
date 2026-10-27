# HARMONY's additions to God's Eye View

God's Eye View ([bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view), MIT, Copyright (c) 2026
Bilawal Sidhu) is installed unchanged from its pinned archive (`docs/GODS-EYE-VIEW.json`). The files under `files/`
are laid on top by `core/gods-eye-overlay.ts`, each checked against the exact original it replaces (`manifest.json`).
If God's Eye View is updated, the overlay is skipped until it is remade for the new version
(`node scripts/make-gods-eye-overlay.ts <checkout of the pinned commit>`).

Several of these come from community forks of God's Eye View. All of them are MIT licensed, like the original, and
their changes are used here under that licence with thanks:

| What | Files | From |
|---|---|---|
| Lite mode: lower resolution, no MSAA, 30 fps, no atmosphere, coarser imagery, no Google 3D tiles, no blur (`?lite=1`) | `src/harmonyLite.js`, `src/app/viewer.js`, `src/app/scene.js`, `src/ui/styles/harmony-lite.css` | Ideas from [kuxala/gods-eye-view](https://github.com/kuxala/gods-eye-view)'s "potato-grade Low tier", "Google 3D tiles are opt-in" and "drop backdrop blur" (September 2026); written for the current God's Eye View |
| Lighter flights in Lite mode: fewer fleet updates, no fleet 3D models, planes behind the Earth skipped first | `src/layers/flights/rendering.js`, `src/layers/flights/state.js` | Measured on Alec's PC; the same calls as kuxala's Low tier and [uhrichsam4/gods-eye-view](https://github.com/uhrichsam4/gods-eye-view)'s "draw only what the camera can see" |
| Pins no longer show through the globe | `src/annotations/worldAnnotationRenderer.js` | [anhaoXie/gods-eye-view](https://github.com/anhaoXie/gods-eye-view)'s hazard-marker occlusion fix (October 14, 2026) |
| Spatial Memory: your own tracks, geotagged photos and 3D scans, with playback | `src/ui/spatialMemory.js`, `src/ui/spatialMemoryModel.js`, `src/ui/styles/spatial-memory.css`, `public/spatial-memory-example.json`, `src/app/tools.js`, `src/ui/templates/layer-panels.html` | [JEROME-PRAKASH-L/gods-eye-view](https://github.com/JEROME-PRAKASH-L/gods-eye-view) (October 25, 2026), without its Flight 7598 tab (it loads an outside site) |
| Panels no longer re-lay-out every frame while a camera list fills in (7.5 s of a 12.7 s freeze when the camera layer turned on) | `src/ui/panelLayoutController.js` | HARMONY, measured on Alec's PC |
| Lite mode: cable landing points not re-clamped to the terrain on every tile load (3.6 s of a 4.6 s freeze); data-center markers placed by a terrain lookup instead of a GPU pick (2.5 s) | `src/layers/submarineCables/ingestion.js`, `src/data/localGeojsonCore.js` | kuxala's "stop clamping billboards to ground" (MIT), measured on Alec's PC |
| More traffic cameras: Illinois (Chicago), Spain, Iceland, Stockholm, Gothenburg, Lyon (about 3,700, open licences, credited in the data-attribution panel) | `server/providers/cctv/harmonyPacks.js` (+ test), `server/providers/cctv/catalog.js`, `src/data/dataCredits.js` | Catalog list from [uhrichsam4/gods-eye-view](https://github.com/uhrichsam4/gods-eye-view)'s world camera catalogs (MIT, August 31, 2026), written as a God's Eye View camera pack |
| One stylesheet entry for the above | `style.css`, `src/ui/styles/harmony.css` | HARMONY |

HARMONY-side features that use God's Eye View's own actions and endpoints (no overlay needed): spoken GPS-interference answers from its GNSS-integrity endpoint, ambient "living globe" mode (its
`rotate_globe` camera motion), replay tours (inspired by kuxala's event date scrubber), and severity and time filters
for world-feed pins (after anhaoXie's hazard panel filters). See `docs/GODS-EYE.md`.
