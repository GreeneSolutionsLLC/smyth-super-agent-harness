// ── OpenCut Client (postMessage bridge version) ──
//
// Drives the OpenCut editor running in an iframe inside Smyth.
// Uses the /api/opencut/eval bridge route to send JS expressions
// to the browser, which forwards them to the iframe via postMessage.
//
// The browser (VideographyPanel) polls /api/opencut/eval?poll=1 to
// receive pending eval requests, executes them in the iframe, and
// POSTs results back.

const BRIDGE_URL = "/api/opencut/eval";

// Active project awareness (set by VideographyPanel)
let activeProjectId: string | null = null;

export function setActiveProjectId(id: string) {
  activeProjectId = id;
}

export function getActiveProjectId(): string | null {
  return activeProjectId;
}

/**
 * Evaluate a JS expression in the OpenCut iframe via the server→browser bridge.
 */
async function evalInEditor(expression: string): Promise<unknown> {
  const baseUrl = process.env.NODE_ENV === "production"
    ? "http://localhost:3000"
    : "http://localhost:3000";
  const res = await fetch(`${baseUrl}${BRIDGE_URL}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expr: expression }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `Bridge returned ${res.status}`);
  }
  return data.value;
}

// ── Public API (same interface as before, but via postMessage bridge) ──

export async function evaluate<T = unknown>(expression: string): Promise<T> {
  return evalInEditor(expression) as Promise<T>;
}

export async function diagnose(): Promise<{
  cdpReachable: boolean;
  opencutTarget: { id: string; url: string } | null;
  opencutProjectId: string | null;
  editorAvailable: boolean;
  projectTotalDuration: number | null;
  trackCount: number | null;
  mediaCount: number;
  error?: string;
}> {
  try {
    const result = await evalInEditor(`(function() {
      const e = window.__smythEditor;
      if (!e) return { cdpReachable: true, opencutTarget: null, opencutProjectId: null, editorAvailable: false, projectTotalDuration: null, trackCount: null, mediaCount: 0, error: "Editor not available (window.__smythEditor not set)" };
      const active = e.project.getActiveOrNull ? e.project.getActiveOrNull() : null;
      const media = e.media.getAssets ? e.media.getAssets() : [];
      const scene = e.scenes.getActiveScene ? e.scenes.getActiveScene() : null;
      const trackCount = scene ? (1 + (scene.tracks.overlay?.length || 0) + (scene.tracks.audio?.length || 0)) : null;
      const total = active ? e.timeline.getTotalDuration() : null;
      return {
        cdpReachable: true,
        opencutTarget: { id: "iframe", url: window.location.href },
        opencutProjectId: active ? active.metadata.id : null,
        editorAvailable: true,
        projectTotalDuration: total,
        trackCount: trackCount,
        mediaCount: media.length,
      };
    })()`) as any;
    return result;
  } catch (e) {
    return {
      cdpReachable: false,
      opencutTarget: null,
      opencutProjectId: null,
      editorAvailable: false,
      projectTotalDuration: null,
      trackCount: null,
      mediaCount: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function getState(): Promise<unknown> {
  return evalInEditor(`(function() {
    const e = window.__smythEditor;
    if (!e) return { error: "Editor not available" };
    const active = e.project.getActiveOrNull();
    if (!active) return { error: "No active project" };
    const scene = e.scenes.getActiveScene();
    const total = e.timeline.getTotalDuration();
    return {
      projectId: active.metadata.id,
      projectName: active.metadata.name,
      duration: total,
      fps: active.settings.fps,
      canvasSize: active.settings.canvasSize,
      tracks: {
        main: scene.tracks.main ? {
          id: scene.tracks.main.id, name: scene.tracks.main.name, type: scene.tracks.main.type,
          elementCount: scene.tracks.main.elements.length,
        } : null,
        overlay: (scene.tracks.overlay || []).map(t => ({id: t.id, name: t.name, type: t.type, elementCount: t.elements.length})),
        audio: (scene.tracks.audio || []).map(t => ({id: t.id, name: t.name, type: t.type, elementCount: t.elements.length})),
      },
      media: e.media.getAssets ? e.media.getAssets().map(m => ({id: m.id, name: m.name, type: m.type, duration: m.duration})) : [],
    };
  })()`);
}

export async function getTimeline(): Promise<unknown> {
  return evalInEditor(`(function() {
    const e = window.__smythEditor;
    if (!e) return { error: "Editor not available" };
    const active = e.project.getActiveOrNull();
    if (!active) return { error: "No active project" };
    const scene = e.scenes.getActiveScene();
    if (!scene) return { error: "No active scene" };
    const all = [];
    const mainTrack = scene.tracks.main;
    if (mainTrack) {
      for (const el of mainTrack.elements) {
        all.push({
          trackId: mainTrack.id, trackName: mainTrack.name, trackType: mainTrack.type,
          elementId: el.id, elementName: el.name, elementType: el.type,
          startTime: el.startTime, duration: el.duration, trimStart: el.trimStart, trimEnd: el.trimEnd,
        });
      }
    }
    for (const t of [...(scene.tracks.overlay || []), ...(scene.tracks.audio || [])]) {
      for (const el of t.elements) {
        all.push({
          trackId: t.id, trackName: t.name, trackType: t.type,
          elementId: el.id, elementName: el.name, elementType: el.type,
          startTime: el.startTime, duration: el.duration, trimStart: el.trimStart, trimEnd: el.trimEnd,
        });
      }
    }
    all.sort((a, b) => a.startTime - b.startTime);
    return { projectId: active.metadata.id, totalDuration: e.timeline.getTotalDuration(), elements: all };
  })()`);
}

export async function insertClipFromUrl(url: string, startTime = 0): Promise<unknown> {
  return evalInEditor(`(async function() {
    const e = window.__smythEditor;
    if (!e) return { error: "Editor not available" };
    const active = e.project.getActiveOrNull();
    if (!active) return { error: "No active project" };
    const scene = e.scenes.getActiveScene();
    if (!scene) return { error: "No active scene" };
    const main = scene.tracks.main;
    if (!main) return { error: "No main track" };

    let file, duration = 5, mediaType = 'video';
    try {
      const resp = await fetch(${JSON.stringify(url)});
      if (!resp.ok) return { error: "Failed to fetch URL: " + resp.status };
      const blob = await resp.blob();
      const name = ${JSON.stringify(url)}.split('/').pop() || 'clip';
      file = new File([blob], name, { type: blob.type || 'video/mp4' });
      try {
        const probeUrl = URL.createObjectURL(blob);
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.src = probeUrl;
        await new Promise((res) => { v.onloadedmetadata = res; v.onerror = res; setTimeout(res, 5000); });
        if (v.duration && isFinite(v.duration)) duration = v.duration;
        if (file.type.startsWith('audio/')) mediaType = 'audio';
        URL.revokeObjectURL(probeUrl);
      } catch {}
    } catch (err) {
      return { error: "Fetch failed: " + err.message };
    }

    let asset;
    try {
      asset = await e.media.addMediaAsset({
        projectId: active.metadata.id,
        asset: {
          name: file.name, type: mediaType, size: file.size,
          lastModified: file.lastModified || Date.now(), file: file,
          url: URL.createObjectURL(file),
        }
      });
    } catch (err) {
      return { error: "addMediaAsset failed: " + err.message };
    }

    const TICKS_PER_SECOND = 120000;
    const startTimeTicks = Math.round(${startTime} * TICKS_PER_SECOND);
    const durationTicks = Math.round(duration * TICKS_PER_SECOND);
    const newElementId = crypto.randomUUID();
    const newElement = {
      id: newElementId, type: 'video', name: file.name, mediaId: asset.id,
      duration: durationTicks, startTime: startTimeTicks, trimStart: 0, trimEnd: 0, params: {},
    };
    e.scenes.updateSceneTracks({
      tracks: {
        main: { ...main, elements: [...main.elements, newElement] },
        overlay: scene.tracks.overlay, audio: scene.tracks.audio,
      }
    });
    return { ok: true, projectId: active.metadata.id, elementId: newElementId, assetId: asset.id,
      fileName: file.name, duration: durationTicks, startTime: startTimeTicks };
  })()`);
}

export async function addTextOverlay(text: string, startTime = 0, duration = 3, position: "top" | "center" | "bottom" = "center"): Promise<unknown> {
  return evalInEditor(`(async function() {
    const e = window.__smythEditor;
    if (!e) return { error: "Editor not available" };
    const active = e.project.getActiveOrNull();
    if (!active) return { error: "No active project" };
    const scene = e.scenes.getActiveScene();
    if (!scene) return { error: "No active scene" };

    const newTrackId = crypto.randomUUID();
    const newElementId = crypto.randomUUID();
    const textLabel = ${JSON.stringify(text)}.slice(0, 30);
    const TICKS_PER_SECOND = 120000;
    const startTimeTicks = Math.round(${startTime} * TICKS_PER_SECOND);
    const durationTicks = Math.round(${duration} * TICKS_PER_SECOND);
    const newTrack = {
      id: newTrackId, name: 'Text ' + (scene.tracks.overlay.length + 1), type: 'text',
      elements: [{
        id: newElementId, type: 'text', name: textLabel, text: ${JSON.stringify(text)},
        startTime: startTimeTicks, duration: durationTicks, trimStart: 0, trimEnd: 0,
        params: { position: ${JSON.stringify(position)}, fontSize: 48, color: '#ffffff' },
      }],
      muted: false, hidden: false,
    };
    e.scenes.updateSceneTracks({
      tracks: { main: scene.tracks.main, overlay: [...scene.tracks.overlay, newTrack], audio: scene.tracks.audio }
    });
    return { ok: true, trackId: newTrackId, elementId: newElementId, text: ${JSON.stringify(text)} };
  })()`);
}

export async function deleteElement(elementId: string): Promise<unknown> {
  return evalInEditor(`(function() {
    const e = window.__smythEditor;
    if (!e) return { error: "Editor not available" };
    const active = e.project.getActiveOrNull();
    if (!active) return { error: "No active project" };
    const scene = e.scenes.getActiveScene();
    if (!scene) return { error: "No active scene" };
    let found = false;
    const main = scene.tracks.main;
    if (main && main.elements.some(el => el.id === ${JSON.stringify(elementId)})) {
      found = true;
      e.scenes.updateSceneTracks({
        tracks: {
          main: { ...main, elements: main.elements.filter(el => el.id !== ${JSON.stringify(elementId)}) },
          overlay: scene.tracks.overlay, audio: scene.tracks.audio,
        }
      });
    } else {
      const newOverlay = (scene.tracks.overlay || []).map(t => {
        if (t.elements.some(el => el.id === ${JSON.stringify(elementId)})) {
          found = true;
          return { ...t, elements: t.elements.filter(el => el.id !== ${JSON.stringify(elementId)}) };
        }
        return t;
      });
      const newAudio = (scene.tracks.audio || []).map(t => {
        if (t.elements.some(el => el.id === ${JSON.stringify(elementId)})) {
          found = true;
          return { ...t, elements: t.elements.filter(el => el.id !== ${JSON.stringify(elementId)}) };
        }
        return t;
      });
      if (found) {
        e.scenes.updateSceneTracks({ tracks: { main: scene.tracks.main, overlay: newOverlay, audio: newAudio } });
      }
    }
    if (!found) return { error: "Element not found: " + ${JSON.stringify(elementId)} };
    return { ok: true, deleted: ${JSON.stringify(elementId)} };
  })()`);
}

export async function moveElement(elementId: string, newStartTime: number): Promise<unknown> {
  return evalInEditor(`(function() {
    const e = window.__smythEditor;
    if (!e) return { error: "Editor not available" };
    const active = e.project.getActiveOrNull();
    if (!active) return { error: "No active project" };
    const scene = e.scenes.getActiveScene();
    if (!scene) return { error: "No active scene" };
    const TICKS_PER_SECOND = 120000;
    const newStartTimeTicks = Math.round(${newStartTime} * TICKS_PER_SECOND);
    let found = false;
    const main = scene.tracks.main;
    if (main && main.elements.some(el => el.id === ${JSON.stringify(elementId)})) {
      found = true;
      e.scenes.updateSceneTracks({
        tracks: {
          main: { ...main, elements: main.elements.map(el => el.id === ${JSON.stringify(elementId)} ? { ...el, startTime: newStartTimeTicks } : el) },
          overlay: scene.tracks.overlay, audio: scene.tracks.audio,
        }
      });
    } else {
      const updateInArray = (arr) => arr.map(t => {
        if (t.elements.some(el => el.id === ${JSON.stringify(elementId)})) {
          found = true;
          return { ...t, elements: t.elements.map(el => el.id === ${JSON.stringify(elementId)} ? { ...el, startTime: newStartTimeTicks } : el) };
        }
        return t;
      });
      const newOverlay = updateInArray(scene.tracks.overlay || []);
      const newAudio = updateInArray(scene.tracks.audio || []);
      if (found) {
        e.scenes.updateSceneTracks({ tracks: { main: scene.tracks.main, overlay: newOverlay, audio: newAudio } });
      }
    }
    if (!found) return { error: "Element not found" };
    return { ok: true, elementId: ${JSON.stringify(elementId)}, newStartTime: ${newStartTime} };
  })()`);
}

export async function trimElement(elementId: string, trimStart: number, trimEnd: number): Promise<unknown> {
  return evalInEditor(`(function() {
    const e = window.__smythEditor;
    if (!e) return { error: "Editor not available" };
    const active = e.project.getActiveOrNull();
    if (!active) return { error: "No active project" };
    const scene = e.scenes.getActiveScene();
    if (!scene) return { error: "No active scene" };
    const TICKS_PER_SECOND = 120000;
    const trimStartTicks = Math.round(${trimStart} * TICKS_PER_SECOND);
    const trimEndTicks = Math.round(${trimEnd} * TICKS_PER_SECOND);
    let found = false;
    const main = scene.tracks.main;
    const updateEl = (el) => el.id === ${JSON.stringify(elementId)} ? { ...el, trimStart: trimStartTicks, trimEnd: trimEndTicks } : el;
    if (main && main.elements.some(el => el.id === ${JSON.stringify(elementId)})) {
      found = true;
      e.scenes.updateSceneTracks({
        tracks: { main: { ...main, elements: main.elements.map(updateEl) }, overlay: scene.tracks.overlay, audio: scene.tracks.audio }
      });
    } else {
      const updateInArray = (arr) => arr.map(t => {
        if (t.elements.some(el => el.id === ${JSON.stringify(elementId)})) {
          found = true;
          return { ...t, elements: t.elements.map(updateEl) };
        }
        return t;
      });
      const newOverlay = updateInArray(scene.tracks.overlay || []);
      const newAudio = updateInArray(scene.tracks.audio || []);
      if (found) {
        e.scenes.updateSceneTracks({ tracks: { main: scene.tracks.main, overlay: newOverlay, audio: newAudio } });
      }
    }
    if (!found) return { error: "Element not found" };
    return { ok: true, elementId: ${JSON.stringify(elementId)}, trimStart: ${trimStart}, trimEnd: ${trimEnd} };
  })()`);
}

export async function save(): Promise<unknown> {
  return evalInEditor(`(async function() {
    const e = window.__smythEditor;
    if (!e) return { error: "Editor not available" };
    const active = e.project.getActiveOrNull();
    if (!active) return { error: "No active project" };
    try {
      if (e.save && typeof e.save.flush === 'function') await e.save.flush();
      if (e.project && typeof e.project.saveCurrentProject === 'function') await e.project.saveCurrentProject();
      return { ok: true, projectId: active.metadata.id };
    } catch (err) {
      return { error: "Save failed: " + err.message };
    }
  })()`);
}

// ── CDP helpers (kept for backward compat, but not used) ──
export async function findOpencutTarget(): Promise<null> { return null; }
export async function ensureOpencutTab(): Promise<null> { return null; }