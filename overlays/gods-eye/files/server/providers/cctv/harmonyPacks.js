/**
 * HARMONY camera packs: more public traffic-camera catalogs, from uhrichsam4/gods-eye-view's declarative world camera
 * catalogs (MIT, August 31, 2026). Only catalogs with an open licence that answered from Alec's PC on October 26, 2026
 * are here (Geneva, Malaga and Vitoria failed certificate checks on that PC; Queensland's shared key was rate limited;
 * Singapore's image links change every minute, so a cached catalog would go stale). Each pack is one entry: a catalog
 * URL, where its fields are, and the one host and folder its images may come from (pinned like God's Eye View's own
 * packs). Each fails on its own; CCTV_HARMONY_PACKS_ENABLED=0 turns them all off.
 */
import { readResponseJsonCapped } from '../common/http.js';
import {
  cameraDisplayCode,
  fallbackHeadingFromId,
  pinnedCameraUrl,
  prioritizeSources,
  toFiniteNumber,
} from './normalize.js';
import { directionToHeading } from '../../../src/data/directionText.js';

const FETCH_TIMEOUT_MS = 20_000;
const MAX_CATALOG_BYTES = 8 * 1024 * 1024;

/** @type {ReadonlyArray<object>} */
export const HARMONY_CAMERA_PACKS = Object.freeze([
  {
    id: 'us-il',
    name: 'Illinois',
    provider: 'Illinois DOT / Travel Midwest',
    license: 'CC BY-SA 2.0 — Illinois Department of Transportation',
    catalogUrl:
      'https://services2.arcgis.com/aIrBD8yn1TDTEXoz/arcgis/rest/services/TrafficCamerasTM_Public/FeatureServer/0/query?where=SnapShot+LIKE+%27%25travelmidwest%25%27&outFields=*&f=json&outSR=4326&resultRecordCount=2000',
    arrayPath: 'features',
    fields: {
      id: 'attributes.OBJECTID',
      name: 'attributes.CameraLocation',
      lat: 'attributes.y',
      lon: 'attributes.x',
      heading: 'attributes.CameraDirection',
      imageUrl: 'attributes.SnapShot',
    },
    imagePrefix: 'https://cctv.travelmidwest.com/snapshots/',
    anchors: [{ lat: 41.8781, lon: -87.6298, city: 'Chicago' }],
    maxSources: 200,
  },
  {
    id: 'es-dgt',
    name: 'Spain',
    provider: 'Dirección General de Tráfico',
    license:
      'DGT open reuse under Ley 37/2007 (RISP), free of charge. Credit: Dirección General de Tráfico.',
    catalogUrl:
      'https://services-eu1.arcgis.com/xMJSZjeskIpAzCcP/arcgis/rest/services/camaras_web/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson&outSR=4326&resultRecordCount=2000',
    arrayPath: 'features',
    fields: {
      id: 'properties.id',
      name: 'properties.carretera',
      lat: 'geometry.coordinates.1',
      lon: 'geometry.coordinates.0',
    },
    imageUrlTemplate: 'https://etraffic.dgt.es/camarasEtraffic/{id}.jpg',
    imagePrefix: 'https://etraffic.dgt.es/camarasEtraffic/',
    anchors: [
      { lat: 40.4168, lon: -3.7038, city: 'Madrid' },
      { lat: 39.4699, lon: -0.3763, city: 'Valencia' },
      { lat: 37.3891, lon: -5.9845, city: 'Sevilla' },
      { lat: 36.7213, lon: -4.4214, city: 'Málaga' },
    ],
    maxSources: 250,
  },
  {
    id: 'is-vegagerdin',
    name: 'Iceland',
    provider: 'Vegagerðin (Icelandic Road and Coastal Administration)',
    license:
      'IRCA web-services terms (modelled on the UK Open Government Licence). Credit: Icelandic Road and Coastal Administration.',
    catalogUrl: 'https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1',
    arrayPath: '',
    fields: {
      id: 'Maelist_nr',
      name: 'Myndavel',
      lat: 'Breidd',
      lon: 'Lengd',
      imageUrl: 'Slod',
    },
    imagePrefix: 'https://www.vegagerdin.is/vgdata/vefmyndavelar/',
    anchors: [
      { lat: 64.15, lon: -21.94, city: 'Reykjavik' },
      { lat: 65.68, lon: -18.09, city: 'Akureyri' },
    ],
    maxSources: 150,
  },
  {
    id: 'se-stockholm',
    name: 'Stockholm',
    provider: 'Trafik Stockholm / Trafikverket',
    license: 'Trafikverket open data, CC0 1.0 (served via trafiken.nu).',
    catalogUrl: 'https://trafiken.nu/api/trafficcameras?region=vst',
    arrayPath: '',
    fields: {
      id: 'cameraId',
      name: 'name',
      lat: 'wgs84Position.coordinates.1',
      lon: 'wgs84Position.coordinates.0',
      heading: 'direction',
      imageUrl: 'imageUrl',
    },
    imagePrefix:
      'https://api.trafikinfo.trafikverket.se/v2/Images/data/road.infrastructure.camera/',
    anchors: [{ lat: 59.33, lon: 18.07, city: 'Stockholm' }],
    maxSources: 150,
  },
  {
    id: 'se-goteborg',
    name: 'Gothenburg',
    provider: 'Trafikverket',
    license: 'Trafikverket open data, CC0 1.0 (served via trafiken.nu).',
    catalogUrl: 'https://trafiken.nu/api/trafficcameras?region=gbg',
    arrayPath: '',
    fields: {
      id: 'cameraId',
      name: 'name',
      lat: 'wgs84Position.coordinates.1',
      lon: 'wgs84Position.coordinates.0',
      heading: 'direction',
      imageUrl: 'imageUrl',
    },
    imagePrefix:
      'https://api.trafikinfo.trafikverket.se/v2/Images/data/road.infrastructure.camera/',
    anchors: [{ lat: 57.71, lon: 11.97, city: 'Gothenburg' }],
    maxSources: 150,
  },
  {
    id: 'fr-lyon',
    name: 'Lyon',
    provider: 'Métropole de Lyon — CRITER',
    license: 'Licence Ouverte / Open Licence (Etalab). Credit: Métropole de Lyon.',
    catalogUrl:
      'https://data.grandlyon.com/geoserver/metropole-de-lyon/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=metropole-de-lyon:pvo_patrimoine_voirie.pvocameracriter&outputFormat=application/json&SRSNAME=EPSG:4326',
    arrayPath: 'features',
    fields: {
      id: 'properties.identifiant',
      name: 'properties.nom',
      lat: 'geometry.coordinates.1',
      lon: 'geometry.coordinates.0',
      imageUrl: 'properties.url',
    },
    imagePrefix:
      'https://download.data.grandlyon.com/files/rdata/pvo_patrimoine_voirie.pvocameracriter/',
    anchors: [{ lat: 45.764, lon: 4.8357, city: 'Lyon' }],
    maxSources: 20,
  },
]);

/** A dotted path into parsed JSON ("features", "attributes.x", "geometry.coordinates.1"); "" is the value itself. */
export function readPath(value, path) {
  let current = value;
  for (const key of String(path || '')
    .split('.')
    .filter(Boolean)) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(key);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (typeof current === 'object') {
      current = Object.prototype.hasOwnProperty.call(current, key)
        ? current[key]
        : undefined;
    } else return undefined;
  }
  return current;
}

const nearestCity = (anchors, lat, lon) => {
  let best = null;
  let bestD = Infinity;
  for (const a of anchors || []) {
    const d = (a.lat - lat) ** 2 + ((a.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best?.city || '';
};

/** One catalog record as a God's Eye View camera source, or null. Images must be under the pack's pinned folder. */
export function packCameraToSource(pack, record) {
  const f = pack.fields;
  const lat = toFiniteNumber(readPath(record, f.lat));
  const lon = toFiniteNumber(readPath(record, f.lon));
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180) || (lat === 0 && lon === 0))
    return null;
  const rawId = String(readPath(record, f.id) ?? '').trim();
  if (!rawId || rawId.length > 80) return null;
  const rawImage = f.imageUrl
    ? readPath(record, f.imageUrl)
    : pack.imageUrlTemplate?.replace('{id}', encodeURIComponent(rawId));
  const imageUrl = pinnedCameraUrl(rawImage, pack.imagePrefix);
  if (!imageUrl) return null;
  const id = `harmony-${pack.id}-${rawId}`.replace(/[^\w.-]+/g, '_');
  const name =
    String(readPath(record, f.name) ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) ||
    `${pack.name} ${rawId}`;
  const headingRaw = f.heading ? readPath(record, f.heading) : undefined;
  let heading = toFiniteNumber(headingRaw);
  if (!Number.isFinite(heading) && typeof headingRaw === 'string')
    heading = toFiniteNumber(directionToHeading(headingRaw));
  const known = Number.isFinite(heading) && heading >= 0 && heading <= 360;
  const city = nearestCity(pack.anchors, lat, lon) || pack.name;
  return {
    id,
    name,
    city,
    cityId: `harmony-${pack.id}`,
    provider: pack.provider,
    lat,
    lon,
    headingDeg: known ? heading % 360 : fallbackHeadingFromId(id),
    headingConfidence: known ? 'medium' : 'low',
    pitchDeg: -18,
    fovDeg: 44,
    rangeM: 145,
    mountHeightM: 8,
    feedType: 'image',
    url: imageUrl,
    snapshotUrl: imageUrl,
    sourceKind: `harmony-${pack.id}`,
    license: pack.license,
    code: cameraDisplayCode(name.toUpperCase()),
  };
}

/** Fetches one pack's catalog and returns its cameras (nearest its anchors first, capped). Never throws. */
export async function loadHarmonyPack(pack, fetchImpl = fetch) {
  try {
    const resp = await fetchImpl(pack.catalogUrl, {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp?.ok) {
      try {
        await resp?.body?.cancel();
      } catch {
        /* no-op */
      }
      console.warn(`[CCTV] ${pack.name} cameras: catalog answered ${resp?.status}`);
      return [];
    }
    const json = await readResponseJsonCapped(resp, MAX_CATALOG_BYTES);
    const list = pack.arrayPath ? readPath(json, pack.arrayPath) : json;
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const cameras = [];
    for (const record of list) {
      const camera = packCameraToSource(pack, record);
      if (!camera || seen.has(camera.id)) continue;
      seen.add(camera.id);
      cameras.push(camera);
    }
    const chosen = prioritizeSources(cameras, pack.maxSources, pack.anchors);
    console.log(
      `[CCTV] Loaded ${pack.name} camera sources: ${cameras.length} (using ${chosen.length})`,
    );
    return chosen;
  } catch (error) {
    console.warn(`[CCTV] ${pack.name} cameras failed:`, error?.message || error);
    return [];
  }
}
