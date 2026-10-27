// HARMONY Lite mode: lighter rendering for modest GPUs (HARMONY runs this globe on a GTX 1650 beside a voice
// assistant). After kuxala/gods-eye-view's "potato-grade Low tier" and "no backdrop blur" changes (MIT, 2026-09).
// Turned on by HARMONY with ?lite=1 (remembered), off with ?lite=0. No browser-only imports here: layer modules
// that may also load on the server read it (it is simply off there). Its stylesheet is imported through src/ui/styles/harmony.css (a CSS import here would break God's Eye's Node tests).

const KEY = 'harmony.lite';

/** Whether Lite mode is on. Never throws (storage can be unavailable). */
export function harmonyLite() {
  try {
    const value = new URLSearchParams(globalThis.location?.search ?? '').get('lite');
    if (value === '1' || value === '0') {
      try {
        globalThis.localStorage?.setItem(KEY, value);
      } catch {
        /* storage unavailable */
      }
      return value === '1';
    }
    return globalThis.localStorage?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let cached = null;
/** harmonyLite(), read once per page (it can't change without a reload). */
export function liteOn() {
  if (cached === null) cached = harmonyLite();
  return cached;
}

/** What Lite mode changes. Normal mode is the upstream default for each. */
export const LITE = Object.freeze({
  msaaSamples: 1, // upstream 4
  resolutionScale: 0.75, // upstream 1 (device pixels)
  targetFrameRate: 30, // upstream 60
  atmosphere: false, // sky and ground atmosphere shading
  globeScreenSpaceError: 4, // coarser imagery tiles (Cesium default 2)
  photoreal: false, // Google 3D tiles only when Lite is off
  // Flights, measured on Alec's PC (12,400 aircraft): animating every plane 12.5 times a second took 60% of each
  // second, and 3D fleet models (ground snapping by scene picks, shader builds) most of the rest. kuxala's low tier
  // made the same calls (MIT).
  fleetTickMs: 250, // upstream 80
  fleetModels: false, // 3D models for the fleet (the plane you follow keeps its own)
  fleetHorizonFirst: true, // skip planes behind the Earth before projecting them forward
});

/** Marks the page so harmony-lite.css applies. */
export function markLite(on) {
  try {
    globalThis.document?.documentElement.classList.toggle('harmony-lite', !!on);
  } catch {
    /* no document */
  }
}
