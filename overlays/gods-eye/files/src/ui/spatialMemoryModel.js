/** Bounded, session-local historical tracks and geolocated media manifests. */
export const MEMORY_LIMITS = Object.freeze({
  manifestBytes: 2 * 1024 * 1024,
  samples: 20000,
  observations: 500,
  mediaBytes: 100 * 1024 * 1024,
  totalMediaBytes: 256 * 1024 * 1024,
});

const text = (value, limit = 180) =>
  String(value ?? '')
    .trim()
    .slice(0, limit);
const wrap = (value) => ((value + 540) % 360) - 180;

/** Parse an explicit ISO timestamp without accepting normalized impossible dates. */
export function memoryTime(value) {
  const match =
    typeof value === 'string' &&
    value.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/,
    );
  const fail = () => {
    throw new Error(
      'Use a real ISO timestamp with a timezone, for example 2026-10-25T12:00:00Z.',
    );
  };
  if (!match) return fail();
  const [, year, month, day, hour, minute, second, zone] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (
    +month < 1 ||
    +month > 12 ||
    +day < 1 ||
    +day > days ||
    +hour > 23 ||
    +minute > 59 ||
    +second > 59
  )
    return fail();
  if (
    zone !== 'Z' &&
    (+zone.slice(1, 3) > 14 ||
      +zone.slice(4) > 59 ||
      (+zone.slice(1, 3) === 14 && +zone.slice(4) !== 0))
  )
    return fail();
  const result = Date.parse(value);
  if (!Number.isFinite(result)) return fail();
  return result;
}

/** Only HTTPS or a local file basename can become a media resource. */
export function memoryMediaReference(value) {
  const ref = text(value, 2048);
  if (!ref) return null;
  if (/^https:\/\//i.test(ref)) {
    const url = new URL(ref);
    if (url.username || url.password)
      throw new Error('Media URLs must not contain credentials.');
    return url.href;
  }
  if (!/^[^\x00-\x1f/\\:?#]{1,180}$/.test(ref) || ref === '.' || ref === '..') {
    throw new Error(
      'Media must use HTTPS or a local filename without directories.',
    );
  }
  return ref;
}

export function memoryMediaKind(ref) {
  const path = ref?.startsWith('https://') ? new URL(ref).pathname : ref || '';
  if (/\.(?:jpe?g|png|webp|gif|avif)$/i.test(path)) return 'image';
  if (/\.(?:mp4|webm|ogv)$/i.test(path)) return 'video';
  if (/\.(?:mp3|wav|m4a|ogg|oga)$/i.test(path)) return 'audio';
  if (/\.glb$/i.test(path)) return 'model';
  throw new Error(
    'Use a supported image, video, audio, or self-contained GLB filename.',
  );
}

function coordinate(row) {
  if (
    !row ||
    typeof row !== 'object' ||
    !Number.isFinite(row.lat) ||
    !Number.isFinite(row.lon) ||
    Math.abs(row.lat) > 90 ||
    Math.abs(row.lon) > 180
  ) {
    throw new Error(
      'Every sample and observation needs finite lat/lon coordinates on Earth.',
    );
  }
  const altitudeM = row.altitudeM == null ? null : row.altitudeM;
  if (
    altitudeM !== null &&
    (!Number.isFinite(altitudeM) || altitudeM < -500 || altitudeM > 100000)
  )
    throw new Error(
      'altitudeM must be a number from -500 to 100000 metres, or omitted.',
    );
  return { lat: row.lat, lon: row.lon, altitudeM, time: memoryTime(row.time) };
}

function fromGeoJSON(input) {
  if (
    !Array.isArray(input.features) ||
    input.features.length > MEMORY_LIMITS.observations + 1
  )
    throw new Error('The GeoJSON feature collection is too large or invalid.');
  const result = {
    version: 1,
    title: input.title || 'Imported spatial memory',
    samples: [],
    observations: [],
  };
  let tracks = 0;
  for (const feature of input.features) {
    const props = feature?.properties || {};
    const geometry = feature?.geometry;
    if (geometry?.type === 'LineString') {
      if (++tracks > 1)
        throw new Error('Import one timed track per workspace project.');
      const coords = geometry.coordinates;
      if (
        !Array.isArray(coords) ||
        coords.length > MEMORY_LIMITS.samples ||
        !Array.isArray(props.times) ||
        props.times.length !== coords.length
      )
        throw new Error(
          'A track LineString needs a properties.times timestamp for every coordinate.',
        );
      result.samples = coords.map((point, index) => ({
        lon: point?.[0],
        lat: point?.[1],
        altitudeM: point?.[2],
        time: props.times[index],
      }));
    } else if (geometry?.type === 'Point') {
      result.observations.push({
        ...props,
        lon: geometry.coordinates?.[0],
        lat: geometry.coordinates?.[1],
        altitudeM: geometry.coordinates?.[2],
      });
    } else
      throw new Error(
        'Spatial memory accepts timed LineStrings and geolocated Point observations. Other map files use Display > Import.',
      );
  }
  return result;
}

/** Validate the entire project before an existing project can be replaced. */
export function normalizeMemoryProject(raw) {
  const input = raw?.type === 'FeatureCollection' ? fromGeoJSON(raw) : raw;
  if (
    !input ||
    input.version !== 1 ||
    !Array.isArray(input.samples || []) ||
    !Array.isArray(input.observations || [])
  )
    throw new Error(
      'Expected a version 1 spatial-memory manifest or timed GeoJSON.',
    );
  if (
    (input.samples?.length || 0) > MEMORY_LIMITS.samples ||
    (input.observations?.length || 0) > MEMORY_LIMITS.observations
  )
    throw new Error('Project exceeds the sample or observation limit.');
  const samples = (input.samples || [])
    .map((row) => {
      const result = coordinate(row);
      if (row.heading != null) {
        if (!Number.isFinite(row.heading))
          throw new Error('Track headings must be finite numbers.');
        result.heading = ((row.heading % 360) + 360) % 360;
      }
      return result;
    })
    .sort((a, b) => a.time - b.time);
  if (
    samples.some(
      (sample, index) => index && sample.time === samples[index - 1].time,
    )
  )
    throw new Error('Track timestamps must be unique.');
  const ids = new Set();
  const observations = (input.observations || [])
    .map((row, index) => {
      const id = text(row.id || `observation-${index + 1}`);
      if (ids.has(id)) throw new Error('Observation IDs must be unique.');
      ids.add(id);
      const media = memoryMediaReference(row.media);
      const heading = row.heading ?? 0,
        scale = row.scale ?? 1;
      if (
        !Number.isFinite(heading) ||
        !Number.isFinite(scale) ||
        scale <= 0 ||
        scale > 10000
      )
        throw new Error(
          'Observation heading must be finite and model scale must be greater than 0 and at most 10000.',
        );
      return {
        ...coordinate(row),
        id,
        title: text(row.title || `Observation ${index + 1}`),
        note: text(row.note, 2000),
        credit: text(row.credit, 500),
        heading,
        scale,
        media,
        kind: media ? memoryMediaKind(media) : null,
      };
    })
    .sort((a, b) => a.time - b.time);
  if (!samples.length && !observations.length)
    throw new Error('Add at least one track sample or geolocated observation.');
  const gapSeconds = input.maxInterpolationGapSeconds ?? 120;
  if (!Number.isFinite(gapSeconds) || gapSeconds <= 0 || gapSeconds > 86400)
    throw new Error('maxInterpolationGapSeconds must be between 0 and 86400.');
  let start = Infinity,
    end = -Infinity;
  for (const row of [...samples, ...observations]) {
    start = Math.min(start, row.time);
    end = Math.max(end, row.time);
  }
  return {
    version: 1,
    title: text(input.title || 'Spatial memory'),
    description: text(input.description, 2000),
    maxInterpolationGapSeconds: gapSeconds,
    samples,
    observations,
    start,
    end,
  };
}

function bearing(a, b) {
  const lat1 = (a.lat * Math.PI) / 180,
    lat2 = (b.lat * Math.PI) / 180;
  const delta = (wrap(b.lon - a.lon) * Math.PI) / 180;
  return (
    ((Math.atan2(
      Math.sin(delta) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(delta),
    ) *
      180) /
      Math.PI +
      360) %
    360
  );
}

/** Sample along the short dateline arc; hold the last fix across missing-data gaps. */
export function sampleMemoryTrack(project, time) {
  const rows = project.samples;
  if (!rows.length) return null;
  const at = Math.max(rows[0].time, Math.min(rows.at(-1).time, time));
  if (!Number.isFinite(at)) throw new Error('Playback time must be finite.');
  let lo = 0,
    hi = rows.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (rows[mid].time <= at) lo = mid;
    else hi = mid - 1;
  }
  const a = rows[lo],
    b = rows[Math.min(lo + 1, rows.length - 1)];
  const gap =
    b.time - a.time > project.maxInterpolationGapSeconds * 1000 &&
    at > a.time &&
    at < b.time;
  const ratio = gap || a === b ? 0 : (at - a.time) / (b.time - a.time);
  return {
    time: at,
    lat: a.lat + (b.lat - a.lat) * ratio,
    lon: wrap(a.lon + wrap(b.lon - a.lon) * ratio),
    altitudeM:
      a.altitudeM === null || b.altitudeM === null
        ? null
        : a.altitudeM + (b.altitudeM - a.altitudeM) * ratio,
    heading:
      a.heading == null
        ? bearing(a, b)
        : (a.heading +
            wrap((b.heading ?? a.heading) - a.heading) * ratio +
            360) %
          360,
    index: lo,
    gap,
  };
}

/** Portable export contains filenames, never session-specific blob URLs. */
export function exportMemoryProject(project) {
  const { start, end, ...data } = project;
  return JSON.stringify(
    {
      ...data,
      samples: data.samples.map((row) => ({
        ...row,
        time: new Date(row.time).toISOString(),
      })),
      observations: data.observations.map(({ kind, ...row }) => ({
        ...row,
        time: new Date(row.time).toISOString(),
      })),
    },
    null,
    2,
  );
}

/** A deliberately synthetic example: it is not Flight 7598 telemetry. */
export function exampleMemoryProject() {
  return {
    version: 1,
    title: 'Austin memory walk · illustrative example',
    description:
      'Synthetic positions demonstrate timeline playback. Replace this example with your own measured track and media.',
    samples: [
      {
        time: '2026-10-01T12:00:00Z',
        lat: 30.273,
        lon: -97.741,
        altitudeM: 180,
      },
      {
        time: '2026-10-01T12:00:20Z',
        lat: 30.274,
        lon: -97.7405,
        altitudeM: 180,
      },
      {
        time: '2026-10-01T12:00:40Z',
        lat: 30.275,
        lon: -97.7402,
        altitudeM: 181,
      },
      {
        time: '2026-10-01T12:01:00Z',
        lat: 30.276,
        lon: -97.7401,
        altitudeM: 181,
      },
    ],
    observations: [
      {
        id: 'start',
        title: 'First observation',
        time: '2026-10-01T12:00:00Z',
        lat: 30.273,
        lon: -97.741,
        note: 'This is a synthetic example. Add a local photo or video filename to the manifest to attach your own media.',
      },
      {
        id: 'end',
        title: 'A later moment in the same place',
        time: '2026-10-01T12:01:00Z',
        lat: 30.276,
        lon: -97.7401,
        note: 'Choose All moments to compare observations, or Elapsed history to reveal them over time.',
      },
    ],
  };
}
