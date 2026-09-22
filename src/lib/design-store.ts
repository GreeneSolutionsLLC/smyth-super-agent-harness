// IndexedDB-backed persistence for the Design panel.
// Image dataURLs live in IndexedDB — localStorage caps at ~5MB and a single
// 768x768 PNG can be 1-2MB, so a handful of designs would blow the quota.
// Only the tiny "active session" pointer touches localStorage.

export interface DesignImage {
  id: string;
  prompt: string;
  dataUrl: string;
  width: number;
  height: number;
  seed: number;
  provider?: string;
  timestamp: number;
  /** Lineage: id of the image this was iterated from. Root generations omit it. */
  parentId?: string;
  /** The human edit instruction that produced this image (for tooltips/branches). */
  editInstruction?: string;
  /** Smyth-authored SVG overlay composited on top at export time. */
  overlaySvg?: string;
  /** Smyth-authored HTML overlay (rich layout: styled divs, mixed text, nested imgs). Rendered as DOM, rasterized at export. */
  overlayHtml?: string;
}

export type DesignShape = "square" | "portrait" | "landscape";

export interface DesignHistoryEntry {
  id: string;
  role: "user" | "agent";
  content: string;
  imageId?: string;
  timestamp: number;
}

export interface DesignSession {
  id: string;
  name: string;
  images: DesignImage[];
  selectedImageId: string | null;
  lastPrompt: string;
  negativePrompt: string;
  shape: DesignShape;
  style?: string;
  numImages?: number;
  seed?: number;
  guidanceScale?: number;
  history: DesignHistoryEntry[];
  /** Pinned sessions surface as reusable templates at the top of the rail. */
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

const DB_NAME = "smyth-design-store";
const DB_VERSION = 2;
const STORE = "sessions";
const ACTIVE_KEY = "smyth-design-active-session";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Failed to open design store"));
    });
  }
  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("design store error"));
      })
  );
}

export function saveDesignSession(session: DesignSession): Promise<void> {
  return tx("readwrite", (s) => s.put(session)).then(() => undefined);
}

export function loadDesignSession(id: string): Promise<DesignSession | null> {
  return tx("readonly", (s) => s.get(id)).then((r) => (r as DesignSession) || null);
}

export function listDesignSessions(): Promise<DesignSession[]> {
  return tx("readonly", (s) => s.getAll()).then((r) =>
    ((r as DesignSession[]) || []).sort((a, b) => b.updatedAt - a.updatedAt)
  );
}

export function deleteDesignSession(id: string): Promise<void> {
  return tx("readwrite", (s) => s.delete(id)).then(() => undefined);
}

export function getActiveDesignSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveDesignSessionId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

// --- Summaries (gallery portfolio view — one thumbnail per session, keeps memory light) ---
export interface DesignSessionSummary {
  id: string;
  name: string;
  count: number;
  createdAt: number;
  updatedAt: number;
  thumbUrl: string | null;
  pinned?: boolean;
}

export async function listDesignSessionSummaries(): Promise<DesignSessionSummary[]> {
  const all = await listDesignSessions();
  return all.map((s) => {
    const latest =
      s.images.find((i) => i.id === s.selectedImageId) || s.images[0] || null;
    return {
      id: s.id,
      name: s.name,
      count: s.images.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      thumbUrl: latest ? latest.dataUrl : null,
      pinned: !!s.pinned,
    };
  });
}

// --- Export: whole design bundle as a zip ---
//   <name>.png            latest rendition (zip root)
//   design-history.md     full chat history as Markdown
//   versions/             every generated image
//   manifest.json         machine-readable session (prompts, seeds, history map)
export async function exportDesignSessionZip(
  session: DesignSession
): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const safeName =
    (session.name || "design").replace(/[^\w\- ]+/g, "").trim().slice(0, 40) ||
    "design";

  const latest =
    session.images.find((i) => i.id === session.selectedImageId) ||
    session.images[0];

  if (latest) {
    zip.file(`${safeName}.png`, latest.dataUrl.split(",")[1], { base64: true });
  }

  const versions = zip.folder("versions");
  session.images.forEach((img, idx) => {
    versions!.file(
      `${String(idx + 1).padStart(2, "0")}-${img.id.slice(0, 8)}.png`,
      img.dataUrl.split(",")[1],
      { base64: true }
    );
  });

  const md: string[] = [`# ${safeName}`, "", "Smyth Design Panel — session export", ""];
  if (session.history.length === 0) md.push("_No chat history for this design._");
  session.history.forEach((h) => {
    const who = h.role === "user" ? "**You:**" : "**Smyth:**";
    const imgRef = h.imageId
      ? ` *(rendition: ${h.imageId.slice(0, 8)}…)*`
      : "";
    md.push(`- ${who} ${h.content}${imgRef}`);
  });
  zip.file("design-history.md", md.join("\n"));

  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        format: "smyth-design/1",
        id: session.id,
        name: session.name,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        lastPrompt: session.lastPrompt,
        negativePrompt: session.negativePrompt,
        shape: session.shape,
        selectedImageId: latest ? latest.id : null,
        history: session.history,
        images: session.images.map(({ dataUrl, ...meta }) => meta),
      },
      null,
      2
    )
  );

  return zip.generateAsync({ type: "blob" });
}

// --- Import: zip (full restore) | image (seed a new design) | md (seed history) ---
export async function importDesignBundle(file: File): Promise<DesignSession> {
  const name = file.name.toLowerCase();
  const now = Date.now();
  const baseName = file.name.replace(/\.[^.]+$/, "").slice(0, 48) || "Imported design";

  if (name.endsWith(".zip")) return importZipBundle(file);

  if (name.endsWith(".md")) {
    const text = await file.text();
    const entry: DesignHistoryEntry = {
      id: `h-${now}`,
      role: "user",
      content: `Imported chat history from ${file.name}:\n\n${text.slice(0, 4000)}`,
      timestamp: now,
    };
    return makeSession(baseName, [], null, [entry], now);
  }

  // Single image → seed a brand-new design session with it as the base.
  const dataUrl = await fileToDataUrl(file);
  const img: DesignImage = {
    id: `imp-${now}`,
    prompt: `Imported: ${file.name}`,
    dataUrl,
    width: 0,
    height: 0,
    seed: 0,
    timestamp: now,
  };
  const entry: DesignHistoryEntry = {
    id: `h-${now}`,
    role: "user",
    content: `Uploaded ${file.name} as the base for a new design. Ready to iterate — tell me what to change.`,
    timestamp: now,
  };
  return makeSession(baseName, [img], img.id, [entry], now);
}

function makeSession(
  name: string,
  images: DesignImage[],
  selectedImageId: string | null,
  history: DesignHistoryEntry[],
  now: number
): DesignSession {
  return {
    id: `design-${now}-import`,
    name,
    images,
    selectedImageId,
    lastPrompt: "",
    negativePrompt: "",
    shape: "square",
    history,
    createdAt: now,
    updatedAt: now,
  };
}

async function importZipBundle(file: File): Promise<DesignSession> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("Not a Smyth design bundle (missing manifest.json)");
  const manifest = JSON.parse(await manifestFile.async("string"));

  const now = Date.now();
  const versions = zip.folder("versions");
  const images: DesignImage[] = [];
  if (versions) {
    for (const rel of Object.keys(versions.files)) {
      if (rel === "versions/" || rel.endsWith("/")) continue;
      const f = versions.file(rel);
      if (!f) continue;
      const b64 = await f.async("base64");
      const meta = (manifest.images || []).find(
        (m: any) => rel.includes(m.id.slice(0, 8))
      );
      images.push({
        id: meta?.id || `imp-${now}-${rel}`,
        prompt: meta?.prompt || rel,
        dataUrl: `data:image/png;base64,${b64}`,
        width: meta?.width || 0,
        height: meta?.height || 0,
        seed: meta?.seed || 0,
        timestamp: meta?.timestamp || now,
      });
    }
  }

  // Fallback: single image at zip root (no versions folder)
  if (images.length === 0) {
    const rootImg = Object.keys(zip.files).find(
      (n) => !n.endsWith("/") && /\.(png|jpe?g|webp)$/i.test(n)
    );
    if (rootImg) {
      const f = zip.file(rootImg);
      if (f) {
        const b64 = await f.async("base64");
        images.push({
          id: `imp-${now}`,
          prompt: "Imported rendition",
          dataUrl: `data:image/png;base64,${b64}`,
          width: 0,
          height: 0,
          seed: 0,
          timestamp: now,
        });
      }
    }
  }

  const session: DesignSession = {
    id: `design-${now}-import`,
    name: manifest.name || "Imported design",
    images,
    selectedImageId:
      images.find((i) => i.id === manifest.selectedImageId)?.id ||
      images[0]?.id ||
      null,
    lastPrompt: manifest.lastPrompt || "",
    negativePrompt: manifest.negativePrompt || "",
    shape: manifest.shape || "square",
    history: manifest.history || [],
    createdAt: manifest.createdAt || now,
    updatedAt: now,
  };
  return session;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(file);
  });
}
