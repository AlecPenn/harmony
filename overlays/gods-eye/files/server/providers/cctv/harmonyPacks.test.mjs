import test from 'node:test';
import assert from 'node:assert/strict';
import { HARMONY_CAMERA_PACKS, loadHarmonyPack, packCameraToSource, readPath } from './harmonyPacks.js';

const illinois = HARMONY_CAMERA_PACKS.find((p) => p.id === 'us-il');
const spain = HARMONY_CAMERA_PACKS.find((p) => p.id === 'es-dgt');

test('dotted paths read objects and arrays', () => {
  assert.equal(readPath({ a: { b: [1, { c: 'x' }] } }, 'a.b.1.c'), 'x');
  assert.deepEqual(readPath([5], ''), [5]);
  assert.equal(readPath({ a: 1 }, 'a.b'), undefined);
  assert.equal(readPath({}, '__proto__.polluted'), undefined);
});

test('a catalog record becomes a camera with its image pinned to the pack folder', () => {
  const cam = packCameraToSource(illinois, {
    attributes: { OBJECTID: 7, CameraLocation: 'Hillside  Tower', x: -87.9, y: 41.88, CameraDirection: 'WB',
      SnapShot: 'https://cctv.travelmidwest.com/snapshots/IL_7.jpg' },
  });
  assert.equal(cam.id, 'harmony-us-il-7');
  assert.equal(cam.city, 'Chicago');
  assert.equal(cam.name, 'Hillside Tower');
  assert.equal(cam.url, 'https://cctv.travelmidwest.com/snapshots/IL_7.jpg');
  assert.ok(Number.isFinite(cam.headingDeg));
  // Off-host, off-folder and bad coordinates are refused.
  for (const SnapShot of ['https://evil.example/snapshots/x.jpg', 'https://cctv.travelmidwest.com/other/x.jpg', 'http://cctv.travelmidwest.com/snapshots/x.jpg'])
    assert.equal(packCameraToSource(illinois, { attributes: { OBJECTID: 1, x: -87, y: 41, SnapShot } }), null);
  assert.equal(packCameraToSource(illinois, { attributes: { OBJECTID: 1, x: 0, y: 0, SnapShot: 'https://cctv.travelmidwest.com/snapshots/a.jpg' } }), null);
});

test('template packs build the image URL from the id', () => {
  const cam = packCameraToSource(spain, { properties: { id: 2, carretera: 'A-62' }, geometry: { coordinates: [-4.22, 42.07] } });
  assert.equal(cam.url, 'https://etraffic.dgt.es/camarasEtraffic/2.jpg');
});

test('a failing or odd catalog gives no cameras instead of throwing', async () => {
  const fail = async () => ({ ok: false, status: 503, body: null });
  assert.deepEqual(await loadHarmonyPack(illinois, fail), []);
  const boom = async () => { throw new Error('offline'); };
  assert.deepEqual(await loadHarmonyPack(illinois, boom), []);
});
