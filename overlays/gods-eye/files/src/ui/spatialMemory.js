/** Historical playback and spatial media, isolated from live feed clocks.
 * Spatial Memory from JEROME-PRAKASH-L/gods-eye-view (MIT, October 25, 2026), brought into HARMONY's God's Eye without
 * its Flight 7598 tab: that loads an outside website, and HARMONY's God's Eye window only shows local pages. */
import * as Cesium from 'cesium';
import { registerUnsavedWork, t } from '../i18n/index.js';
import {
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';
import {
  MEMORY_LIMITS,
  normalizeMemoryProject,
  sampleMemoryTrack,
  exportMemoryProject,
  exampleMemoryProject,
  memoryMediaKind,
} from './spatialMemoryModel.js';

const MARKER = '#47d9f2';
const iso = (time) =>
  new Date(time).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
const TEMPLATE = `
  <header class="memory-header">
    <div><span class="memory-eyebrow">SPACE + TIME</span><h2 id="memory-heading">Spatial Memory</h2></div>
    <button type="button" data-memory="close" class="scene-btn" aria-label="Close Spatial Memory">×</button>
  </header>
  <div data-memory-pane="local" class="memory-local-pane">
    <p class="memory-intro">Put moments back where they happened. Import a timed track, photos, video, audio, or prebuilt 3D scans and explore them together on the globe.</p>
    <div class="memory-import-actions">
      <button type="button" class="scene-btn" data-memory="import">IMPORT FILES</button>
      <button type="button" class="scene-btn" data-memory="example">TRY EXAMPLE</button>
      <button type="button" class="scene-btn" data-memory="export" disabled>EXPORT JSON</button>
      <input type="file" multiple data-memory="files" accept=".json,.geojson,.jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.webm,.ogv,.mp3,.wav,.m4a,.ogg,.oga,.glb" hidden />
    </div>
    <div class="memory-drop" data-memory="drop" tabindex="0">Drop a manifest and its media here. Files stay in this browser session.</div>
    <p class="memory-note">JSON manifest or timed GeoJSON + local media. Prebuilt self-contained .glb scans are supported. Creating new 3D/4D scans from raw video needs an external reconstruction pipeline.</p>
    <div class="memory-empty" data-memory="empty"><span>01 — Import your moments</span><span>02 — Scrub through time</span><span>03 — See every moment in place</span><a href="/spatial-memory-example.json" download>Download an example manifest ↗</a></div>
    <section data-memory="project" hidden>
      <h3 data-memory="title"></h3><p class="memory-note" data-memory="description"></p>
      <div class="memory-stats" data-memory="stats"></div>
      <output data-memory="time" class="memory-time"></output>
      <label class="memory-timeline-label">Timeline<input type="range" min="0" max="1000" value="0" data-memory="timeline" aria-label="Historical playback time" /></label>
      <div class="memory-transport">
        <button type="button" class="scene-btn" data-memory="rewind" aria-label="Return to the start">|◀</button>
        <button type="button" class="scene-btn" data-memory="play" aria-pressed="false">PLAY</button>
        <label>Speed<select class="gev-field" data-memory="speed" aria-label="Playback speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select></label>
      </div>
      <div class="memory-camera"><label>View<select class="gev-field" data-memory="camera" aria-label="Historical playback camera"><option value="free">Free map</option><option value="chase">Follow track</option><option value="cockpit">First person</option></select></label><button type="button" class="scene-btn" data-memory="overview">FRAME PROJECT</button></div>
      <label class="memory-history">Show<select class="gev-field" data-memory="history" aria-label="Visible moments"><option value="all">All moments</option><option value="elapsed">Elapsed history</option></select></label>
      <p class="memory-note" data-memory="pose"></p>
      <div class="memory-preview" data-memory="preview"></div>
      <div class="memory-observations" data-memory="observations" aria-label="Geolocated observations"></div>
      <button type="button" class="scene-btn" data-memory="clear">CLEAR PROJECT</button>
    </section>
  </div>
  <p class="memory-status" data-memory="status" role="status" aria-live="polite">Ready to explore.</p>`;

/** Mount into the existing globe; own every timer, data source and object URL. */
export function initSpatialMemory({
  viewer,
  navigation = null,
  document: doc = globalThis.document,
}) {
  const opener = doc?.getElementById('spatial-memory-open');
  if (!opener || !viewer?.dataSources) return null;
  const root = doc.createElement('section');
  root.id = 'spatial-memory-workspace';
  root.className = 'memory-workspace';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-labelledby', 'memory-heading');
  root.hidden = true;
  root.innerHTML = TEMPLATE;
  doc.body.append(root);
  const find = (key) => root.querySelector(`[data-memory="${key}"]`);
  const lifetime = new AbortController();
  const assets = new Map();
  let project = null,
    source = null,
    marker = null,
    pointEntities = [],
    observationEntities = [];
  let at = 0,
    speed = 1,
    playing = false,
    camera = 'free',
    lastFrame = 0,
    frame = null,
    selected = null;
  let previewMedia = null,
    destroyed = false,
    generation = 0,
    importIntent = 0,
    changingCamera = false,
    imported = false;
  const listen = (target, type, fn, options = {}) =>
    target?.addEventListener(type, fn, { ...options, signal: lifetime.signal });
  const status = (message) => {
    find('status').textContent = message;
  };
  const render = () => viewer.scene?.requestRender?.();
  const unregisterUnsaved = registerUnsavedWork(() =>
    imported && project ? 'spatial memory project' : null,
  );

  function stopPreview() {
    previewMedia?.pause?.();
    if (previewMedia) {
      previewMedia.removeAttribute('src');
      previewMedia.load?.();
    }
    previewMedia = null;
    find('preview').replaceChildren();
  }
  function freeCamera() {
    if (camera !== 'free')
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    camera = 'free';
    find('camera').value = 'free';
  }
  function pause() {
    playing = false;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    releaseContinuousRender('spatial-memory');
    previewMedia?.pause?.();
    find('play').textContent = t('PLAY');
    find('play').setAttribute('aria-pressed', 'false');
  }
  function navigate(fn) {
    changingCamera = true;
    try {
      return navigation?.runImmediateNavigation
        ? navigation.runImmediateNavigation('file', fn)
        : fn();
    } finally {
      changingCamera = false;
    }
  }
  const handoff = navigation?.subscribeCameraHandoff?.(() => {
    if (!changingCamera) freeCamera();
  });
  const trackingChanged = viewer.trackedEntityChanged?.addEventListener(() => {
    if (viewer.trackedEntity) freeCamera();
  });
  listen(viewer.scene.canvas, 'pointerdown', freeCamera, { passive: true });
  listen(viewer.scene.canvas, 'wheel', freeCamera, { passive: true });

  function position(row, padding = 0) {
    const carto = Cesium.Cartographic.fromDegrees(row.lon, row.lat);
    const ground = viewer.scene.globe?.getHeight(carto);
    const height = row.altitudeM ?? (Number.isFinite(ground) ? ground : 0);
    return Cesium.Cartesian3.fromDegrees(row.lon, row.lat, height + padding);
  }
  function updateCamera(pose) {
    if (!pose || camera === 'free') return;
    const carto = Cesium.Cartographic.fromDegrees(pose.lon, pose.lat);
    const ground = viewer.scene.globe?.getHeight(carto);
    const eye = {
      ...pose,
      altitudeM: Math.max(
        pose.altitudeM ?? ground ?? 0,
        (Number.isFinite(ground) ? ground : 0) + 3,
      ),
    };
    if (camera === 'cockpit') {
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      viewer.camera.setView({
        destination: position(eye),
        orientation: {
          heading: Cesium.Math.toRadians(pose.heading),
          pitch: -0.08,
          roll: 0,
        },
      });
    } else
      viewer.camera.lookAt(
        position(eye),
        new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(pose.heading),
          -0.35,
          150,
        ),
      );
  }
  function update() {
    if (!project) return;
    const pose = sampleMemoryTrack(project, at);
    if (marker && pose) marker.position = position(pose, 2);
    const all = find('history').value === 'all';
    for (const { entity, time } of pointEntities)
      entity.show = all || time <= at;
    for (const { entity, time } of observationEntities)
      entity.show = all || time <= at;
    find('time').textContent = iso(at);
    find('timeline').value =
      project.end === project.start
        ? '0'
        : String(
            Math.round(
              ((at - project.start) / (project.end - project.start)) * 1000,
            ),
          );
    find('timeline').setAttribute('aria-valuetext', iso(at));
    find('pose').textContent = pose
      ? `${pose.lat.toFixed(5)}°, ${pose.lon.toFixed(5)}° · ${pose.altitudeM == null ? 'Height unmeasured' : `${Math.round(pose.altitudeM)} m`} ${pose.gap ? '· Track gap — holding last observed fix' : ''}`
      : 'Photo and media timeline · no flight track supplied';
    for (const button of find('observations').querySelectorAll('button'))
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.observation === selected),
      );
    updateCamera(pose);
    render();
  }
  function syncMedia() {
    const row = project?.observations.find((entry) => entry.id === selected);
    if (!previewMedia || !row) return;
    const seconds = Math.max(0, (at - row.time) / 1000);
    const duration = previewMedia.duration;
    if (
      Number.isFinite(duration) &&
      Math.abs(previewMedia.currentTime - seconds) > 0.5
    )
      previewMedia.currentTime = Math.min(duration, seconds);
    previewMedia.playbackRate = speed;
    if (
      playing &&
      at >= row.time &&
      (!Number.isFinite(duration) || seconds < duration)
    )
      void previewMedia.play().catch(() => {});
    else previewMedia.pause();
  }
  function seek(time) {
    if (!project || !Number.isFinite(time)) return;
    at = Math.max(project.start, Math.min(project.end, time));
    update();
    syncMedia();
  }
  function tick(now) {
    if (!playing || destroyed) return;
    const delta = Math.min(1000, Math.max(0, now - lastFrame));
    lastFrame = now;
    seek(at + delta * speed);
    if (at >= project.end) {
      pause();
      return;
    }
    frame = requestAnimationFrame(tick);
  }
  function play() {
    if (!project || project.start === project.end || doc.hidden) return;
    if (at >= project.end) seek(project.start);
    if (playing) return;
    playing = true;
    lastFrame = performance.now();
    holdContinuousRender('spatial-memory');
    find('play').textContent = t('PAUSE');
    find('play').setAttribute('aria-pressed', 'true');
    syncMedia();
    frame = requestAnimationFrame(tick);
  }
  function assetUrl(ref) {
    return ref?.startsWith('https://') ? ref : assets.get(ref)?.url || null;
  }

  function preview(id) {
    if (!project) return;
    selected = id;
    stopPreview();
    const row = project.observations.find((entry) => entry.id === id);
    if (!row) return;
    const title = doc.createElement('h4');
    title.textContent = row.title;
    const note = doc.createElement('p');
    note.textContent = row.note;
    note.className = 'memory-note';
    find('preview').append(title, note);
    if (row.media) {
      const url = assetUrl(row.media);
      if (!url) {
        const hint = doc.createElement('p');
        hint.textContent = `Choose the local file “${row.media}” with IMPORT FILES to show this observation.`;
        find('preview').append(hint);
      } else if (row.kind === 'model') {
        const hint = doc.createElement('p');
        hint.textContent =
          'The prebuilt 3D scan is positioned on the globe. Use FRAME PROJECT or navigate the map to inspect it.';
        find('preview').append(hint);
      } else {
        const media = doc.createElement(
          row.kind === 'image' ? 'img' : row.kind,
        );
        media.src = url;
        if (row.kind === 'image') media.alt = row.title;
        else {
          media.controls = true;
          media.preload = 'metadata';
          media.setAttribute('playsinline', '');
          previewMedia = media;
        }
        media.onerror = () =>
          status(
            `Could not load “${row.media}”. Check the selected local file or HTTPS source.`,
          );
        find('preview').append(media);
      }
    }
    const credit = doc.createElement('small');
    credit.textContent = row.credit;
    find('preview').append(credit);
    seek(row.time);
  }
  function overview() {
    if (!source || !project) return;
    freeCamera();
    const rows = [...project.samples, ...project.observations];
    const sphere = Cesium.BoundingSphere.fromPoints(
      rows.map((row) => position(row)),
    );
    navigate(() =>
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 1,
        offset: new Cesium.HeadingPitchRange(
          0,
          -1.2,
          Math.max(900, sphere.radius * 3),
        ),
      }),
    );
  }
  function drawProject() {
    source.entities.removeAll();
    pointEntities = [];
    observationEntities = [];
    marker = null;
    if (!project) return;
    if (project.samples.length > 1)
      source.entities.add({
        polyline: {
          positions: project.samples.map((row) => position(row, 1)),
          width: 3,
          material: Cesium.Color.fromCssColorString(MARKER).withAlpha(0.55),
          clampToGround: project.samples.every((row) => row.altitudeM === null),
        },
      });
    const step = Math.max(1, Math.ceil(project.samples.length / 100));
    project.samples.forEach((row, index) => {
      if (index % step && index !== project.samples.length - 1) return;
      const entity = source.entities.add({
        position: position(row, 1),
        point: {
          pixelSize: 5,
          color: Cesium.Color.fromCssColorString(MARKER).withAlpha(0.5),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      pointEntities.push({ entity, time: row.time });
    });
    if (project.samples.length)
      marker = source.entities.add({
        name: project.title,
        position: position(project.samples[0], 2),
        point: {
          pixelSize: 13,
          color: Cesium.Color.WHITE,
          outlineWidth: 3,
          outlineColor: Cesium.Color.fromCssColorString(MARKER),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: 'HISTORICAL TRACK',
          font: '12px monospace',
          pixelOffset: new Cesium.Cartesian2(0, -24),
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    for (const row of project.observations) {
      const location = position(row, row.kind === 'model' ? 0 : 3);
      const options = {
        id: `spatial-memory:${row.id}`,
        name: row.title,
        position: location,
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString('#ffbd69'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      };
      const url = assetUrl(row.media);
      if (row.kind === 'model' && url) {
        options.orientation = Cesium.Transforms.headingPitchRollQuaternion(
          location,
          new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(row.heading), 0, 0),
        );
        options.model = {
          uri: url,
          scale: row.scale,
          heightReference:
            row.altitudeM === null
              ? Cesium.HeightReference.CLAMP_TO_GROUND
              : Cesium.HeightReference.NONE,
        };
      }
      const entity = source.entities.add(options);
      observationEntities.push({ entity, time: row.time });
    }
    update();
  }
  function renderProject() {
    find('empty').hidden = Boolean(project);
    find('project').hidden = !project;
    find('export').disabled = !project;
    if (!project) return;
    find('title').textContent = project.title;
    find('description').textContent = project.description;
    find('stats').textContent =
      `${project.samples.length} track fixes · ${project.observations.length} observations · ${Math.round((project.end - project.start) / 1000)} seconds`;
    find('play').disabled = project.start === project.end;
    find('camera').disabled = !project.samples.length;
    const list = find('observations');
    list.replaceChildren();
    for (const row of project.observations) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.observation = row.id;
      button.className = 'memory-observation';
      const name = doc.createElement('span');
      name.textContent = row.title;
      const when = doc.createElement('small');
      when.textContent = `${iso(row.time)} · ${row.kind || 'note'}`;
      button.append(name, when);
      list.append(button);
    }
    drawProject();
  }
  function commitAssets(replacements) {
    for (const [name, item] of replacements) {
      const old = assets.get(name);
      if (old) URL.revokeObjectURL(old.url);
      assets.set(name, item);
    }
  }
  async function installProject(
    raw,
    userImported = true,
    replacements = [],
    current = () => true,
  ) {
    const normalized = normalizeMemoryProject(raw);
    const token = ++generation;
    if (!source) {
      const owned = new Cesium.CustomDataSource('Spatial Memory');
      await viewer.dataSources.add(owned);
      if (destroyed || token !== generation || !current()) {
        viewer.dataSources.remove(owned, true);
        return false;
      }
      source = owned;
    }
    if (destroyed || token !== generation || !current()) return false;
    pause();
    freeCamera();
    stopPreview();
    source.entities.removeAll();
    commitAssets(replacements);
    project = normalized;
    at = project.start;
    imported = userImported;
    selected = null;
    renderProject();
    overview();
    status(
      userImported
        ? 'Imported locally. Your files have not been uploaded.'
        : 'Illustrative example loaded — these are synthetic positions.',
    );
    return true;
  }
  async function importFiles(files) {
    if (destroyed) return false;
    const intent = ++importIntent;
    let replacements = [],
      committed = false;
    try {
      const list = [...files];
      const manifests = list.filter((file) =>
        /\.(?:geo)?json$/i.test(file.name),
      );
      if (manifests.length > 1)
        throw new Error('Choose one project manifest at a time.');
      let raw = null;
      if (manifests.length) {
        if (manifests[0].size > MEMORY_LIMITS.manifestBytes)
          throw new Error('Manifest exceeds 2 MB.');
        raw = JSON.parse(await manifests[0].text());
        normalizeMemoryProject(raw);
      }
      if (destroyed || intent !== importIntent) return false;
      const media = list.filter((file) => !manifests.includes(file));
      let bytes = 0;
      for (const file of media) {
        memoryMediaKind(file.name);
        if (file.size > MEMORY_LIMITS.mediaBytes)
          throw new Error('Each media file must be 100 MB or smaller.');
      }
      const sizes = new Map(
        [...assets].map(([name, item]) => [name, item.bytes]),
      );
      for (const file of media) sizes.set(file.name, file.size);
      for (const size of sizes.values()) bytes += size;
      if (bytes > MEMORY_LIMITS.totalMediaBytes)
        throw new Error(
          'Session media is limited to 256 MB. Clear the project before importing another large set.',
        );
      if (!raw && !project && media.length)
        throw new Error(
          'Import a JSON manifest with timestamps and coordinates alongside your media.',
        );
      // Everything is validated before any active project or URL is replaced.
      replacements = media.map((file) => [
        file.name,
        { url: URL.createObjectURL(file), bytes: file.size },
      ]);
      if (raw)
        committed = await installProject(
          raw,
          true,
          replacements,
          () => intent === importIntent,
        );
      else {
        stopPreview();
        source.entities.removeAll();
        commitAssets(replacements);
        committed = true;
        drawProject();
        if (selected) preview(selected);
        status('Local media attached. Nothing has been uploaded.');
      }
      return committed;
    } catch (error) {
      if (!destroyed && intent === importIntent) status(error.message);
      return false;
    } finally {
      if (!committed)
        for (const [, item] of replacements) URL.revokeObjectURL(item.url);
    }
  }
  function clear() {
    ++generation;
    ++importIntent;
    pause();
    freeCamera();
    stopPreview();
    project = null;
    imported = false;
    selected = null;
    source?.entities.removeAll();
    for (const item of assets.values()) URL.revokeObjectURL(item.url);
    assets.clear();
    pointEntities = [];
    observationEntities = [];
    marker = null;
    renderProject();
    render();
    status('Project cleared from this browser session.');
  }
  function open(mode = 'local') {
    if (destroyed) return;
    root.hidden = false;
    root.dataset.mode = mode;
    opener.setAttribute('aria-expanded', 'true');
    for (const button of root.querySelectorAll('[data-memory-tab]'))
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.memoryTab === mode),
      );
    for (const pane of root.querySelectorAll('[data-memory-pane]'))
      pane.hidden = pane.dataset.memoryPane !== mode;
    find('close').focus();
  }
  function close() {
    pause();
    freeCamera();
    root.hidden = true;
    opener.setAttribute('aria-expanded', 'false');
    opener.focus();
  }
  listen(opener, 'click', () => (root.hidden ? open() : close()));
  listen(find('close'), 'click', close);
  listen(
    root,
    'keydown',
    (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    },
    { capture: true },
  );
  listen(root, 'click', (event) => {
    const tab = event.target.closest('[data-memory-tab]');
    if (tab) open(tab.dataset.memoryTab);
    const observation = event.target.closest('[data-observation]');
    if (observation) preview(observation.dataset.observation);
  });
  listen(find('import'), 'click', () => find('files').click());
  listen(find('files'), 'change', () => {
    void importFiles(find('files').files || []);
    find('files').value = '';
  });
  listen(find('example'), 'click', () => {
    ++importIntent;
    void installProject(exampleMemoryProject(), false).catch((error) =>
      status(error.message),
    );
  });
  listen(find('clear'), 'click', clear);
  listen(find('play'), 'click', () => (playing ? pause() : play()));
  listen(find('rewind'), 'click', () => {
    pause();
    if (project) seek(project.start);
  });
  listen(find('timeline'), 'input', () => {
    if (project)
      seek(
        project.start +
          (Number(find('timeline').value) / 1000) *
            (project.end - project.start),
      );
  });
  listen(find('speed'), 'change', () => {
    speed = Number(find('speed').value);
    syncMedia();
  });
  listen(find('history'), 'change', update);
  listen(find('overview'), 'click', overview);
  listen(find('camera'), 'change', () => {
    const mode = find('camera').value;
    freeCamera();
    if (mode !== 'free' && project?.samples.length)
      navigate(() => {
        camera = mode;
        find('camera').value = mode;
        update();
      });
  });
  listen(find('export'), 'click', () => {
    if (!project) return;
    const url = URL.createObjectURL(
      new Blob([exportMemoryProject(project)], { type: 'application/json' }),
    );
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = 'spatial-memory.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  listen(find('drop'), 'dragover', (event) => {
    event.preventDefault();
    event.stopPropagation();
    find('drop').classList.add('is-dragging');
  });
  listen(find('drop'), 'dragleave', () =>
    find('drop').classList.remove('is-dragging'),
  );
  listen(find('drop'), 'drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    find('drop').classList.remove('is-dragging');
    void importFiles(event.dataTransfer?.files || []);
  });
  listen(find('drop'), 'keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      find('files').click();
    }
  });
  listen(doc, 'visibilitychange', () => {
    if (doc.hidden) pause();
  });
  const initial = new URL(doc.baseURI).searchParams.get('workspace');
  if (initial === 'memory') open('local');
  return {
    open,
    close,
    importFiles,
    loadProject: installProject,
    seek,
    play,
    pause,
    clear,
    getState: () => ({
      open: !root.hidden,
      mode: root.dataset.mode || 'local',
      title: project?.title || null,
      time: at,
      playing,
      camera,
      sampleCount: project?.samples.length || 0,
      observationCount: project?.observations.length || 0,
      assetCount: assets.size,
      entityCount: source?.entities.values.length || 0,
    }),
    destroy() {
      if (destroyed) return;
      clear();
      destroyed = true;
        lifetime.abort();
      handoff?.();
      trackingChanged?.();
      unregisterUnsaved();
      if (source) viewer.dataSources.remove(source, true);
      source = null;
      root.remove();
    },
  };
}
