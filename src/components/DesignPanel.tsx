"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  loadDesignSession,
  saveDesignSession,
  deleteDesignSession,
  getActiveDesignSessionId,
  setActiveDesignSessionId,
  listDesignSessionSummaries,
  exportDesignSessionZip,
  importDesignBundle,
  type DesignSession,
  type DesignSessionSummary,
  type DesignImage,
} from "@/lib/design-store";
import { ART_STYLES } from "@/lib/perchance-styles";
import { useDesignSession, makeMsg, type DesignChatMsg } from "@/hooks/useDesignSession";
import { streamAgent } from "@/hooks/useAgentStream";
import { ThinkingBackground } from "@/components/ThinkingBackground";
import { ChatThinkingEffect } from "@/components/ChatThinkingEffect";
import {
  X,
  Sparkles,
  Wand2,
  Download,
  RefreshCw,
  AlertCircle,
  Send,
  Trash2,
  Upload,
  Plus,
  Pin,
  PinOff,
  GitCompare,
  Layers,
  Palette,
  Square,
} from "lucide-react";

interface DesignPanelProps {
  onClose: () => void;
}

const PRESETS = [
  { label: "Cyberpunk Circuit", prompt: "cyberpunk circuit board dark blue neon glowing lines intricate detail futuristic" },
  { label: "Neon Cityscape", prompt: "cyberpunk city night neon blue purple lights dark atmosphere rain reflections" },
  { label: "Network Nodes", prompt: "cyberpunk neon network nodes dark blue glowing connections data flow abstract" },
  { label: "Dark Gradient", prompt: "abstract dark navy gradient with subtle purple and blue neon glow minimal" },
  { label: "Tech Grid", prompt: "futuristic tech grid dark background blue neon lines perspective depth" },
  { label: "Neon Abstract", prompt: "abstract neon blue purple pink glowing shapes dark background cyberpunk aesthetic" },
];

const MAX_PROMPT_CHARS = 250;
const capPrompt = (text: string) => {
  const t = text.trim();
  if (t.length <= MAX_PROMPT_CHARS) return t;
  const slice = t.slice(0, MAX_PROMPT_CHARS);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 60 ? slice.slice(0, lastSpace) : slice).trim();
};

const PROMPT_REFINER_SYSTEM = `You are Smyth's prompt engineer inside the Design panel. Your ONLY job: turn the user's rough idea into a single detailed image-generation prompt.
Rules:
- Output ONLY the refined prompt. No preamble, no quotes, no markdown, no explanation.
- Enrich with concrete style, lighting, composition, color palette, mood, subject detail, and camera/lens language.
- Keep it ONE concise paragraph, 25-40 words, and NEVER exceed 200 characters — brevity forces the strongest details.
- Never mention "prompt" or that you are refining.
- Preserve the user's core intent — do not invent a different subject.`;

const ITERATION_SYSTEM = `You are Smyth's design editor. The user is looking at an image generated from the ORIGINAL PROMPT provided in context. They describe an edit ("make it darker", "more vibrant", "change the mood", "make it square for Instagram"). Your ONLY job: rewrite the ORIGINAL prompt into a new, complete generation prompt that bakes in their edit.
Rules:
- Output ONLY the new full prompt. No preamble, no quotes, no markdown, no explanation.
- Keep every original subject/style element the user did NOT ask to change.
- Apply the requested change explicitly and concretely.
- Mention aspect/format only if the user asks (square/portrait/landscape).
- One paragraph, 25-40 words, NEVER exceeding 200 characters.`;

// Overlay editor: Smyth draws ON the existing image with SVG or HTML (text, frames, shapes,
// color washes, branding, rich layouts) instead of regenerating. Image dimensions are given.
const OVERLAY_SYSTEM = `You are Smyth, a graphic artist. The user has an existing image and wants you to DRAW ON TOP of it — NOT to regenerate it. You are shown the image and its exact width and height.
You have TWO output formats. Pick the best one for the job:

1) SVG — for vector text, shapes, frames, borders, glows, gradients. Output ONLY:
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 WIDTH HEIGHT">...</svg>

2) HTML — for rich layout: styled divs, mixed-size/colored text, multi-line formatted captions, badges, gradients, or nested images. Output ONLY a single root <div> using INLINE styles, sized to the image:
<div style="position:absolute;left:0;top:0;width:WIDTHpx;height:HEIGHTpx;...">...</div>
- Use the EXACT width/height given. Position children absolutely or with flexbox inside the root div.
- Inline ALL styles (no classes, no external CSS). Use elegant fonts (Orbitron, Rajdhani, Georgia, serif). Add text-shadow for legibility over busy art.
- Any language/script the user asks (Hindi, Sanskrit, Japanese, etc.).
- You may embed small images with <img src="..."> only if they are data-URLs or the same-origin; otherwise avoid.

Rules:
- Output ONLY the SVG or the HTML div — no preamble, no markdown fences, no explanation.
- Match the image's palette/mood. Honor requested colors/placement.
- If the user asks to modify existing overlay text/graphics, output the FULL corrected markup.`;

const CHAT_SYSTEM = `You are Smyth, an AI art director embedded in the Design Studio. You help the user create and refine generated graphics.
Capabilities you can invoke by replying with a structured action line at the END of your message:
- To generate a new image, end with a line exactly like: GENERATE: <a detailed image prompt, 25-40 words>
- To iterate on the currently selected image, end with: ITERATE: <rewritten full prompt baking in the requested change>
- To draw on the selected image (title text, frames, logos, shapes, color-grade washes, branding), end with an SVG overlay block like:
  OVERLAY: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H">...</svg>
  where W/H match the image dimensions. Use crisp vector shapes, elegant typography (font-family Orbitron/Rajdhani), gradients, and glows. Only emit well-formed standalone SVG.
- To create a Canva design layout (social post, flyer, presentation, brand template), end with: CANVA: <description of the layout, including any text, assets, and dimensions>
Otherwise reply conversationally, concisely, with genuine art direction. Suggest composition, color, style. If the user asks for an image or a change, ALWAYS include the action line. Never output anything after the action line/block.`;

export default function DesignPanel({ onClose }: DesignPanelProps) {
  const { state, dispatch, selectedImage, filmstrip } = useDesignSession();
  const { settings, images, chat, generating, assisting, streaming, error, compareId, pinned, sessionName, sessionId } = state;

  const [sessions, setSessions] = useState<DesignSessionSummary[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showStyleMenu, setShowStyleMenu] = useState(false);
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [comparePos, setComparePos] = useState(50);
  const [canvaMode, setCanvaMode] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [overlayEditorOpen, setOverlayEditorOpen] = useState(false);
  const [overlayDraft, setOverlayDraft] = useState("");
  const [overlayVisible, setOverlayVisible] = useState(true);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatAbortRef = useRef<(() => void) | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const canvasImgRef = useRef<HTMLImageElement>(null);
  const [htmlScale, setHtmlScale] = useState({ scale: 1 });

  // Track the rendered size of the canvas image so the HTML overlay (authored at native
  // resolution) can be scaled to fit. Recompute on resize / image change.
  useEffect(() => {
    const el = canvasImgRef.current;
    if (!el || !selectedImage) return;
    const update = () => {
      const w = el.clientWidth;
      if (w && selectedImage.width) setHtmlScale({ scale: w / selectedImage.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [selectedImage]);

  const strip = useMemo(() => filmstrip(), [filmstrip]);
  const compareImage = compareId ? images.find((i) => i.id === compareId) ?? null : null;

  // ---- session summaries ----
  const refreshSessions = useCallback(() => {
    listDesignSessionSummaries().then((list) => {
      list.sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.updatedAt - a.updatedAt);
      setSessions(list);
    }).catch(() => {});
  }, []);

  // ---- hydrate on mount ----
  useEffect(() => {
    (async () => {
      try {
        const id = getActiveDesignSessionId();
        if (id) {
          const s = await loadDesignSession(id);
          if (s) {
            dispatch({
              type: "LOAD_SESSION",
              payload: {
                sessionId: s.id,
                sessionName: s.name,
                pinned: !!s.pinned,
                images: s.images,
                selectedImageId: s.selectedImageId,
                chat: (s.history || []).map((h) => ({ ...h })),
                settings: {
                  prompt: s.lastPrompt || "",
                  negativePrompt: s.negativePrompt || "",
                  shape: s.shape || "square",
                  style: s.style || "none",
                  numImages: s.numImages ?? 1,
                  seed: s.seed ?? -1,
                  guidanceScale: s.guidanceScale ?? 7,
                },
              },
            });
          }
        }
      } catch { /* fresh */ }
      refreshSessions();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- autosave ----
  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      const id = sessionId || `design-${Date.now()}`;
      if (!sessionId) {
        dispatch({ type: "LOAD_SESSION", payload: { sessionId: id } });
        setActiveDesignSessionId(id);
      }
      const session: DesignSession = {
        id,
        name: sessionName,
        pinned,
        images,
        selectedImageId: state.selectedImageId,
        lastPrompt: settings.prompt,
        negativePrompt: settings.negativePrompt,
        shape: settings.shape,
        style: settings.style,
        numImages: settings.numImages,
        seed: settings.seed,
        guidanceScale: settings.guidanceScale,
        history: chat.map((m) => {
          const { pending: _pending, ...rest } = m;
          void _pending;
          return rest;
        }),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      saveDesignSession(session).catch(() => {});
      refreshSessions();
    }, 600);
    return () => { if (persistTimer.current) clearTimeout(persistTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, chat, settings, sessionName, pinned, state.selectedImageId]);

  // scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, streaming]);

  // ---- generation ----
  const runGeneration = useCallback(async (promptText: string, parent?: DesignImage, editInstruction?: string) => {
    const p = capPrompt(promptText);
    if (!p) return;
    const count = Math.max(1, Math.min(4, settings.numImages));
    dispatch({ type: "GENERATE_START", count });
    const produced: DesignImage[] = [];
    try {
      for (let i = 0; i < count; i++) {
        const res = await fetch("/api/perchance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: p,
            negativePrompt: settings.negativePrompt || undefined,
            shape: settings.shape,
            style: settings.style,
            numImages: 1,
            seed: settings.seed,
            guidanceScale: settings.guidanceScale,
          }),
          signal: AbortSignal.timeout(90000),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        produced.push({
          id: data.metadata.imageId,
          prompt: data.metadata.prompt,
          dataUrl: data.image,
          width: data.metadata.width,
          height: data.metadata.height,
          seed: data.metadata.seed,
          provider: data.metadata.provider,
          timestamp: Date.now(),
          parentId: parent?.id,
          editInstruction,
        });
      }
      dispatch({ type: "GENERATE_SUCCESS", images: produced, prompt: p });
      dispatch({
        type: "CHAT_ADD",
        msg: makeMsg("agent", editInstruction ? `Reworked it — ${editInstruction}` : `Generated ${produced.length > 1 ? produced.length + " renditions" : "a new rendition"}.`, {
          imageId: produced[0].id,
          imageIds: produced.map((x) => x.id),
        }),
      });
    } catch (e: any) {
      const msg = e?.message || "Generation failed";
      dispatch({ type: "GENERATE_FAIL", error: msg });
      dispatch({ type: "CHAT_ADD", msg: makeMsg("agent", `Generation hit a wall: ${msg}`) });
    }
  }, [settings, dispatch]);

  const generate = useCallback(async (text?: string) => {
    const p = (text ?? settings.prompt).trim();
    if (!p || generating) return;
    dispatch({ type: "CHAT_ADD", msg: makeMsg("user", p) });
    await runGeneration(p);
  }, [settings.prompt, generating, runGeneration, dispatch]);

  const runCanvaDesign = useCallback(async (description: string, sourceImage?: DesignImage) => {
    dispatch({ type: "SET_STREAMING", value: true });
    const pending = makeMsg("agent", "Designing\u2026", { pending: true });
    dispatch({ type: "CHAT_ADD", msg: pending });
    try {
      // Use the Smyth Design Engine (/api/design) instead of Canva MCP
      const formatMatch = description.match(/(?:instagram\s*post|ig\s*post)/i) ? "instagram_post"
        : description.match(/(?:instagram\s*story|ig\s*story)/i) ? "instagram_story"
        : description.match(/linkedin/i) ? "linkedin_post"
        : description.match(/youtube/i) ? "youtube_thumb"
        : description.match(/poster/i) ? "poster"
        : "instagram_post";

      const templateMatch = description.match(/grit|gritty|raw|aggressive/i) ? "grit"
        : description.match(/split|editorial|magazine/i) ? "split_text"
        : description.match(/gradient|premium|cinematic/i) ? "gradient_quote"
        : description.match(/minimal|clean|simple/i) ? "minimal_quote"
        : "dark_quote";

      const quotedText = description.match(/[""'](.+?)[""']/)?.[1]
        || description.match(/[:\u2014-]\s*(.+)/)?.[1]?.trim()
        || description;

      const bgKeywords = description.match(/(?:dark|moody|gritty|concrete|storm|mountain|urban|texture|atmospheric|cinematic|dramatic)[^,.]*/gi);
      const bg_prompt = bgKeywords ? bgKeywords.join(", ") : "dark moody atmospheric background, cinematic lighting";

      const res = await fetch("/api/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: quotedText,
          template: templateMatch,
          format: formatMatch,
          brand: "unfiltered_wisdom",
          bg_prompt,
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });

      const imgEl = new Image();
      imgEl.src = dataUrl;
      await new Promise((r) => { imgEl.onload = r; imgEl.onerror = r; });

      const now = Date.now();
      const img: DesignImage = {
        id: `design-${now}`,
        prompt: `Design: ${description.slice(0, 120)}`,
        dataUrl,
        width: imgEl.naturalWidth || 1080,
        height: imgEl.naturalHeight || 1080,
        seed: 0,
        provider: "design-engine",
        timestamp: now,
        parentId: sourceImage?.id,
        editInstruction: description,
      };
      dispatch({ type: "GENERATE_SUCCESS", images: [img], prompt: description });
      dispatch({ type: "CHAT_UPDATE", id: pending.id, patch: { pending: false, content: `Design created (${templateMatch}, ${formatMatch}) and added to the filmstrip.` } });
    } catch (e: any) {
      dispatch({ type: "CHAT_UPDATE", id: pending.id, patch: { pending: false, content: "Design failed: " + (e?.message || "unknown") } });
    } finally {
      dispatch({ type: "SET_STREAMING", value: false });
    }
  }, [dispatch]);

  // ---- prompt assist ----
  const assistPrompt = useCallback(async () => {
    if (!settings.prompt.trim() || assisting) return;
    dispatch({ type: "SET_ASSISTING", value: true });
    try {
      const refined = await streamAgent({
        message: settings.prompt,
        history: [{ role: "system", content: PROMPT_REFINER_SYSTEM }],
      }).promise;
      dispatch({ type: "SET_SETTINGS", payload: { prompt: capPrompt(refined.trim()) } });
    } catch (e: any) {
      dispatch({ type: "SET_ERROR", error: "Prompt Assist failed: " + (e?.message || "unknown") });
    } finally {
      dispatch({ type: "SET_ASSISTING", value: false });
    }
  }, [settings.prompt, assisting, dispatch]);

  // ---- the Smyth chat: conversational + structured generation/iteration ----
  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || streaming || generating) return;
    setChatInput("");
    dispatch({ type: "CHAT_ADD", msg: makeMsg("user", text) });

    const wantsImage = /generat|make|create|draw|design|render|produce|image|graphic|logo|banner|art|picture/i.test(text);
    // Overlay edits: drawing ON the existing image (text, titles, frames, borders, captions,
    // watermarks, logos, shapes, badges). These must NOT regenerate — Smyth draws SVG on top.
    const isOverlayEdit = selectedImage && /\b(text|title|caption|frame|border|watermark|logo|badge|word|words|lettering|font|say|says|write|written|inscribe|hindi|sanskrit|japanese|korean|arabic|chinese|devanagari|script|quote|label|tagline|headline|subtitle)\b/i.test(text);
    // Pixel edits: change the actual rendered art (mood, lighting, color grade, composition).
    const isPixelEdit = selectedImage && /\b(darker|lighter|brighter|mood|vibrant|saturat|grayscale|black and white|sepia|blur|sharpen|recolor|recolour|night|day|sunset|glowing|neon|rain|snow|fog|background|scene|square|portrait|landscape|crop|aspect)\b/i.test(text);

    // ---- OVERLAY path: draw on the existing image with SVG ----
    if (isOverlayEdit) {
      dispatch({ type: "SET_STREAMING", value: true });
      const pending = makeMsg("agent", "Drawing on your design…", { pending: true });
      dispatch({ type: "CHAT_ADD", msg: pending });
      try {
        const svgReply = await streamAgent({
          message: `${text}\n\n[IMAGE SIZE: width=${selectedImage.width} height=${selectedImage.height}. Current SVG overlay (may be empty): ${selectedImage.overlaySvg || "none"}. Current HTML overlay (may be empty): ${selectedImage.overlayHtml || "none"}]`,
          image: { base64: selectedImage.dataUrl, filename: "current-design.png" },
          history: [{ role: "system", content: OVERLAY_SYSTEM }],
        }).promise;
        const svgMatch = svgReply.match(/<svg[\s\S]*?<\/svg>/i);
        const htmlMatch = svgReply.match(/<div[\s\S]*?<\/div>\s*$/i) || svgReply.match(/<div[\s\S]*?<\/div>/i);
        if (svgMatch) {
          dispatch({ type: "SET_OVERLAY", id: selectedImage.id, svg: svgMatch[0] });
          dispatch({ type: "CHAT_UPDATE", id: pending.id, patch: { pending: false, content: "Done — I drew that onto your design. Toggle or tweak it in the overlay editor (the layers icon)." } });
        } else if (htmlMatch) {
          dispatch({ type: "SET_HTML_OVERLAY", id: selectedImage.id, html: htmlMatch[0] });
          dispatch({ type: "CHAT_UPDATE", id: pending.id, patch: { pending: false, content: "Done — I laid that out on your design with HTML. Toggle or tweak it in the overlay editor (the layers icon)." } });
        } else {
          dispatch({ type: "CHAT_UPDATE", id: pending.id, patch: { pending: false, content: "I tried to draw that but didn't produce valid markup. Want me to try again?" } });
        }
      } catch (e: any) {
        dispatch({ type: "CHAT_UPDATE", id: pending.id, patch: { pending: false, content: "That edit failed: " + (e?.message || "unknown") } });
      } finally {
        dispatch({ type: "SET_STREAMING", value: false });
      }
      return;
    }

    // ---- PIXEL-EDIT path: regenerate the art with the change baked in ----
    if (isPixelEdit) {
      dispatch({ type: "SET_STREAMING", value: true });
      const pending = makeMsg("agent", "Reworking the art…", { pending: true });
      dispatch({ type: "CHAT_ADD", msg: pending });
      try {
        const refined = await streamAgent({
          message: text,
          image: { base64: selectedImage.dataUrl, filename: "current-design.png" },
          history: [
            { role: "system", content: ITERATION_SYSTEM },
            { role: "user", content: "ORIGINAL PROMPT: " + selectedImage.prompt },
          ],
        }).promise;
        dispatch({ type: "CHAT_UPDATE", id: pending.id, patch: { pending: false, content: "Reworked the art — compare it with the previous version in the filmstrip." } });
        await runGeneration(refined, selectedImage, text);
      } catch (e: any) {
        dispatch({ type: "CHAT_UPDATE", id: pending.id, patch: { pending: false, content: "That edit failed: " + (e?.message || "unknown") } });
      } finally {
        dispatch({ type: "SET_STREAMING", value: false });
      }
      return;
    }

    // Conversational / generative path — Smyth decides via structured action line
    dispatch({ type: "SET_STREAMING", value: true });
    const pending = makeMsg("agent", "", { pending: true });
    dispatch({ type: "CHAT_ADD", msg: pending });
    try {
      const systemPrompt = canvaMode
        ? CHAT_SYSTEM + "\n\nThe user has activated Canva mode. For any layout, template, social post, flyer, presentation, or design composition request, you MUST use the CANVA action instead of GENERATE or ITERATE."
        : CHAT_SYSTEM;
      const history = [
        { role: "system", content: systemPrompt },
        ...chat.slice(-12).map((m) => ({ role: m.role === "agent" ? "assistant" : "user", content: m.content })),
        ...(selectedImage ? [{ role: "user", content: `[Currently selected design prompt: ${selectedImage.prompt}]` }] : []),
      ];
      const stream = streamAgent({ message: text, history, canvaMode });
      chatAbortRef.current = stream.abort;
      const reply = await stream.promise;
      chatAbortRef.current = null;

      const genMatch = reply.match(/(?:^|\n)\s*GENERATE:\s*(.+)/i);
      const iterMatch = reply.match(/(?:^|\n)\s*ITERATE:\s*(.+)/i);
      const overlayMatch = reply.match(/OVERLAY:\s*(<svg[\s\S]*?<\/svg>)/i);
      const canvaMatch = reply.match(/(?:^|\n)\s*CANVA:\s*(.+)/i);
      const clean = reply.replace(/(?:^|\n)\s*(GENERATE|ITERATE|CANVA):.*/i, "").replace(/OVERLAY:\s*<svg[\s\S]*?<\/svg>/i, "").trim();

      dispatch({ type: "CHAT_UPDATE", id: pending.id, patch: { pending: false, content: clean || "Working on it…" } });

      if (overlayMatch && selectedImage) {
        const svg = overlayMatch[1];
        dispatch({ type: "SET_OVERLAY", id: selectedImage.id, svg });
        dispatch({ type: "CHAT_ADD", msg: makeMsg("agent", "Drew an overlay on the current design — toggle it in the overlay editor.") });
      }

      if (genMatch) {
        await runGeneration(genMatch[1].trim());
      } else if (iterMatch && selectedImage) {
        await runGeneration(iterMatch[1].trim(), selectedImage, text);
      } else if (canvaMatch) {
        await runCanvaDesign(canvaMatch[1].trim(), selectedImage ?? undefined);
      } else if (!overlayMatch && wantsImage && !genMatch && !iterMatch && !canvaMatch) {
        // fallback: Smyth talked but didn't emit an action — generate from his best prompt guess
        await runGeneration(selectedImage ? selectedImage.prompt + ", " + text : text);
      }
    } catch (e: any) {
      const aborted = e?.name === "AbortError" || /abort/i.test(e?.message || "");
      dispatch({ type: "CHAT_UPDATE", id: pending.id, patch: { pending: false, content: aborted ? "Stopped." : "Hit an error: " + (e?.message || "unknown") } });
    } finally {
      chatAbortRef.current = null;
      dispatch({ type: "SET_STREAMING", value: false });
    }
  }, [chatInput, streaming, generating, chat, selectedImage, dispatch, runGeneration, runCanvaDesign, canvaMode]);

  const stopChat = useCallback(() => {
    chatAbortRef.current?.();
    chatAbortRef.current = null;
  }, []);

  // ---- sessions ----
  const openSession = useCallback(async (id: string) => {
    try {
      const s = await loadDesignSession(id);
      if (!s) return;
      setActiveDesignSessionId(id);
      dispatch({
        type: "LOAD_SESSION",
        payload: {
          sessionId: s.id,
          sessionName: s.name,
          pinned: !!s.pinned,
          images: s.images,
          selectedImageId: s.selectedImageId,
          chat: s.history || [],
          settings: {
            prompt: s.lastPrompt || "",
            negativePrompt: s.negativePrompt || "",
            shape: s.shape || "square",
            style: s.style || "none",
            numImages: s.numImages ?? 1,
            seed: s.seed ?? -1,
            guidanceScale: s.guidanceScale ?? 7,
          },
        },
      });
    } catch { /* ignore */ }
  }, [dispatch]);

  const newSession = useCallback(() => {
    const id = `design-${Date.now()}`;
    setActiveDesignSessionId(id);
    dispatch({ type: "RESET" });
    dispatch({ type: "LOAD_SESSION", payload: { sessionId: id, sessionName: "Untitled design" } });
    refreshSessions();
  }, [dispatch, refreshSessions]);

  const removeSession = useCallback(async (id: string) => {
    await deleteDesignSession(id).catch(() => {});
    if (id === sessionId) newSession();
    refreshSessions();
  }, [sessionId, newSession, refreshSessions]);

  const togglePin = useCallback(() => {
    dispatch({ type: "SET_PINNED", pinned: !pinned });
  }, [pinned, dispatch]);

  const cloneAsTemplate = useCallback((tpl: DesignSessionSummary) => {
    openSession(tpl.id).then(() => {
      // clone: new id keeps settings+style but starts fresh chat/images optionally
      const id = `design-${Date.now()}`;
      setActiveDesignSessionId(id);
      dispatch({ type: "LOAD_SESSION", payload: { sessionId: id, sessionName: tpl.name + " copy", images: [], selectedImageId: null, chat: [] } });
    });
  }, [openSession, dispatch]);

  // ---- export/import ----
  const exportZip = useCallback(async () => {
    if (!sessionId) return;
    const s = await loadDesignSession(sessionId);
    if (!s) return;
    const blob = await exportDesignSessionZip(s);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${s.name.replace(/[^\w\- ]+/g, "").trim() || "design"}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sessionId]);

  const onImportFile = useCallback(async (f: File) => {
    try {
      const s = await importDesignBundle(f);
      await saveDesignSession(s);
      setActiveDesignSessionId(s.id);
      await openSession(s.id);
    } catch (e: any) {
      dispatch({ type: "SET_ERROR", error: "Import failed: " + (e?.message || "unknown") });
    }
  }, [openSession, dispatch]);

  const downloadImage = (img: DesignImage) => {
    const a = document.createElement("a");
    a.href = img.dataUrl;
    a.download = `smyth-design-${img.id.slice(0, 12)}.png`;
    a.click();
  };

  // Composite base image + overlays (SVG and/or HTML) onto a canvas, export as PNG.
  const downloadComposite = useCallback(async (img: DesignImage) => {
    if (!img.overlaySvg && !img.overlayHtml) { downloadImage(img); return; }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { downloadImage(img); return; }
      const base = await loadImg(img.dataUrl);
      ctx.drawImage(base, 0, 0, img.width, img.height);

      // SVG overlay
      if (img.overlaySvg) {
        try {
          const svgBlob = new Blob([img.overlaySvg], { type: "image/svg+xml;charset=utf-8" });
          const svgUrl = URL.createObjectURL(svgBlob);
          try {
            const svgImg = await loadImg(svgUrl);
            ctx.drawImage(svgImg, 0, 0, img.width, img.height);
          } finally {
            URL.revokeObjectURL(svgUrl);
          }
        } catch { /* skip svg layer on failure */ }
      }

      // HTML overlay — rasterize by wrapping in an SVG foreignObject (same-origin, no
      // external refs, so the canvas stays clean). Requires XHTML namespace on the div.
      if (img.overlayHtml) {
        try {
          const html = img.overlayHtml.replace(/<div /, '<div xmlns="http://www.w3.org/1999/xhtml" ');
          const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
          const blob = new Blob([wrapped], { type: "image/svg+xml;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          try {
            const hImg = await loadImg(url);
            ctx.drawImage(hImg, 0, 0, img.width, img.height);
          } finally {
            URL.revokeObjectURL(url);
          }
        } catch { /* skip html layer on failure */ }
      }

      canvas.toBlob((blob) => {
        if (!blob) { downloadImage(img); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `smyth-design-${img.id.slice(0, 12)}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    } catch {
      downloadImage(img);
    }
  }, []);

  const currentStyle = ART_STYLES.find((s) => s.name === settings.style || s.name.toLowerCase() === settings.style.toLowerCase());

  // ============================== RENDER ==============================
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#060913] text-slate-200" style={{ fontFamily: "Rajdhani, sans-serif" }}>
      {/* ---------- TOPBAR ---------- */}
      <div className="relative z-40 flex items-center gap-3 border-b border-cyan-500/20 bg-[#0a0f1e]/90 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-cyan-400" />
          <span className="font-['Orbitron'] text-xs font-bold tracking-[0.2em] text-cyan-300">SMYTH DESIGN</span>
        </div>
        <div className="h-4 w-px bg-cyan-500/20" />
        {editingName ? (
          <input
            ref={nameInputRef}
            defaultValue={sessionName}
            autoFocus
            onBlur={(e) => { dispatch({ type: "SET_NAME", name: e.target.value.trim() || "Untitled design" }); setEditingName(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingName(false); }}
            className="rounded border border-cyan-500/40 bg-[#060913] px-2 py-0.5 text-sm text-cyan-100 outline-none"
          />
        ) : (
          <button onClick={() => setEditingName(true)} className="text-sm font-semibold text-slate-200 hover:text-cyan-300" title="Rename session">
            {sessionName}
          </button>
        )}
        <button onClick={togglePin} title={pinned ? "Unpin template" : "Pin as template"} className={`rounded p-1 transition ${pinned ? "text-amber-400" : "text-slate-500 hover:text-amber-300"}`}>
          {pinned ? <Pin className="h-4 w-4 fill-amber-400" /> : <PinOff className="h-4 w-4" />}
        </button>

        <div className="ml-auto flex items-center gap-2">
          {/* shape */}
          <div className="flex overflow-hidden rounded border border-cyan-500/30">
            {(["square", "portrait", "landscape"] as const).map((s) => (
              <button key={s} onClick={() => dispatch({ type: "SET_SETTINGS", payload: { shape: s } })}
                className={`px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition ${settings.shape === s ? "bg-cyan-500/30 text-cyan-200" : "text-slate-400 hover:bg-cyan-500/10"}`}>
                {s === "square" ? "1:1" : s === "portrait" ? "2:3" : "3:2"}
              </button>
            ))}
          </div>
          {/* style chip */}
          <div className="relative">
            <button onClick={() => { setShowStyleMenu(!showStyleMenu); setShowPresetMenu(false); }}
              className="flex items-center gap-1.5 rounded border border-fuchsia-500/40 bg-fuchsia-500/10 px-2.5 py-1 text-[11px] font-semibold text-fuchsia-200 hover:bg-fuchsia-500/20">
              <Sparkles className="h-3 w-3" /> {currentStyle?.name ?? "No style"}
            </button>
            {showStyleMenu && (
              <StyleMenu selected={settings.style} onPick={(name) => { dispatch({ type: "SET_SETTINGS", payload: { style: name } }); setShowStyleMenu(false); }} onClose={() => setShowStyleMenu(false)} />
            )}
          </div>
          {/* presets */}
          <div className="relative">
            <button onClick={() => { setShowPresetMenu(!showPresetMenu); setShowStyleMenu(false); }}
              className="rounded border border-cyan-500/30 px-2.5 py-1 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/10">✨</button>
            {showPresetMenu && (
              <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border border-cyan-500/30 bg-[#0a0f1e] p-1.5 shadow-xl">
                {PRESETS.map((p) => (
                  <button key={p.label} onClick={() => { dispatch({ type: "SET_SETTINGS", payload: { prompt: p.prompt } }); setShowPresetMenu(false); }}
                    className="block w-full rounded px-2 py-1.5 text-left text-xs text-slate-300 hover:bg-cyan-500/10">{p.label}</button>
                ))}
              </div>
            )}
          </div>
          {/* settings popover */}
          <div className="relative">
            <button onClick={() => setShowSettings(!showSettings)} className="rounded border border-cyan-500/30 px-2.5 py-1 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/10">⚙</button>
            {showSettings && (
              <div className="absolute right-0 top-full z-50 mt-1 w-64 space-y-3 rounded-md border border-cyan-500/30 bg-[#0a0f1e] p-3 shadow-xl">
                <label className="block text-[11px] text-slate-400">How many
                  <select value={settings.numImages} onChange={(e) => dispatch({ type: "SET_SETTINGS", payload: { numImages: Number(e.target.value) } })}
                    className="mt-0.5 w-full rounded border border-cyan-500/30 bg-[#060913] px-2 py-1 text-xs text-slate-200">
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label className="block text-[11px] text-slate-400">Seed (-1 = random)
                  <input type="number" value={settings.seed} onChange={(e) => dispatch({ type: "SET_SETTINGS", payload: { seed: Number(e.target.value) } })}
                    className="mt-0.5 w-full rounded border border-cyan-500/30 bg-[#060913] px-2 py-1 text-xs text-slate-200" />
                </label>
                <label className="block text-[11px] text-slate-400"><span>{"Guidance " + settings.guidanceScale}</span>
                  <input type="range" min={1} max={30} value={settings.guidanceScale} onChange={(e) => dispatch({ type: "SET_SETTINGS", payload: { guidanceScale: Number(e.target.value) } })} className="mt-1 w-full accent-cyan-400" />
                </label>
                <label className="block text-[11px] text-slate-400">Negative prompt
                  <input type="text" value={settings.negativePrompt} onChange={(e) => dispatch({ type: "SET_SETTINGS", payload: { negativePrompt: e.target.value } })}
                    placeholder="blurry, watermark…" className="mt-0.5 w-full rounded border border-cyan-500/30 bg-[#060913] px-2 py-1 text-xs text-slate-200" />
                </label>
              </div>
            )}
          </div>
          <button onClick={exportZip} title="Export session zip" className="rounded border border-cyan-500/30 p-1.5 text-cyan-300 hover:bg-cyan-500/10"><Download className="h-3.5 w-3.5" /></button>
          <button onClick={() => fileInputRef.current?.click()} title="Import" className="rounded border border-cyan-500/30 p-1.5 text-cyan-300 hover:bg-cyan-500/10"><Upload className="h-3.5 w-3.5" /></button>
          <input ref={fileInputRef} type="file" accept=".zip,.png,.jpg,.jpeg,.webp,.md" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ""; }} />
          <button onClick={onClose} title="Close" className="rounded border border-red-500/40 p-1.5 text-red-400 hover:bg-red-500/10"><X className="h-4 w-4" /></button>
        </div>
      </div>

      {/* ---------- BODY ---------- */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* SESSION RAIL */}
        <div className={`flex flex-col border-r border-cyan-500/20 bg-[#080c18] transition-all ${railOpen ? "w-40" : "w-12"}`}>
          <div className="flex items-center justify-between border-b border-cyan-500/10 p-2">
            {railOpen && <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Sessions</span>}
            <div className="flex gap-1">
              <button onClick={newSession} title="New session" className="rounded p-1 text-cyan-400 hover:bg-cyan-500/10"><Plus className="h-4 w-4" /></button>
              <button onClick={() => setRailOpen(!railOpen)} className="rounded p-1 text-slate-500 hover:bg-cyan-500/10 text-[10px]">{railOpen ? "«" : "»"}</button>
            </div>
          </div>
          <div className="flex-1 space-y-1.5 overflow-y-auto p-1.5">
            {sessions.map((s) => (
              <div key={s.id} className={`group relative cursor-pointer rounded-md border p-1 transition ${s.id === sessionId ? "border-cyan-400/60 bg-cyan-500/10" : "border-transparent hover:border-cyan-500/30 hover:bg-cyan-500/5"}`}
                onClick={() => openSession(s.id)}>
                {s.thumbUrl ? (
                  <img src={s.thumbUrl} alt="" className={`w-full rounded object-cover ${railOpen ? "aspect-square" : "aspect-square"}`} />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center rounded bg-[#0d1322] text-[10px] text-slate-600">empty</div>
                )}
                {railOpen && (
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <span className="truncate text-[10px] text-slate-300">{s.pinned && "📌 "}{s.name}</span>
                    <span className="text-[9px] text-slate-600">{s.count}</span>
                  </div>
                )}
                {railOpen && (
                  <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
                    <button title="Use as template" onClick={(e) => { e.stopPropagation(); cloneAsTemplate(s); }} className="rounded bg-black/70 p-0.5 text-amber-300 hover:text-amber-200"><Pin className="h-3 w-3" /></button>
                    <button title="Delete" onClick={(e) => { e.stopPropagation(); removeSession(s.id); }} className="rounded bg-black/70 p-0.5 text-red-400 hover:text-red-300"><Trash2 className="h-3 w-3" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* CANVAS STAGE */}
        <div className="relative flex min-w-0 flex-1 flex-col bg-[#060a14]">
          <div className="relative min-h-0 flex-1">
            {/* thinking visuals while generating */}
            {generating && <ThinkingBackground active={true} label="drawing" />}

            {!generating && !selectedImage && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                <Sparkles className="h-10 w-10 text-cyan-500/40" />
                <p className="max-w-sm text-sm text-slate-500">Describe what you want in the prompt bar below, or tell Smyth in the chat. Pick a style, hit generate.</p>
              </div>
            )}

            {selectedImage && (
              <div className="absolute inset-0 flex min-h-0 min-w-0 items-center justify-center overflow-hidden p-4">
                <div className="relative flex h-full w-full min-h-0 min-w-0 items-center justify-center">
                  {compareImage ? (
                    <CompareView base={selectedImage} other={compareImage} pos={comparePos} setPos={setComparePos} />
                  ) : (
                    <div className="relative inline-block max-h-full max-w-full">
                      <img ref={canvasImgRef} src={selectedImage.dataUrl} alt="" className="block max-h-full max-w-full rounded-md border border-cyan-500/20 object-contain shadow-[0_0_40px_rgba(0,180,255,0.15)]" />
                      {selectedImage.overlaySvg && overlayVisible && (
                        <div
                          className="pointer-events-none absolute inset-0 [&>svg]:h-full [&>svg]:w-full"
                          dangerouslySetInnerHTML={{ __html: selectedImage.overlaySvg }}
                        />
                      )}
                      {selectedImage.overlayHtml && overlayVisible && (
                        <div className="pointer-events-none absolute inset-0 overflow-hidden">
                          <div
                            style={{
                              position: "absolute",
                              left: 0,
                              top: 0,
                              width: selectedImage.width,
                              height: selectedImage.height,
                              transform: `scale(${htmlScale.scale})`,
                              transformOrigin: "top left",
                            }}
                            dangerouslySetInnerHTML={{ __html: selectedImage.overlayHtml }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {/* image actions */}
                  <div className="absolute right-1 top-1 flex gap-1">
                    {compareImage ? (
                      <button onClick={() => dispatch({ type: "SET_COMPARE", id: null })} className="rounded-full bg-fuchsia-600 p-1.5 text-white shadow" title="Exit compare"><X className="h-3.5 w-3.5" /></button>
                    ) : (
                      <>
                        <button
                          onClick={() => { setOverlayDraft(selectedImage.overlaySvg || defaultOverlay(selectedImage)); setOverlayEditorOpen(true); }}
                          className={`rounded-full p-1.5 text-white shadow transition ${selectedImage.overlaySvg ? "bg-amber-500/90 hover:bg-amber-400" : "bg-slate-600/90 hover:bg-slate-500"}`}
                          title="Overlay editor (Smyth's SVG layer)"><Layers className="h-3.5 w-3.5" /></button>
                        <button onClick={() => downloadComposite(selectedImage)} className="rounded-full bg-cyan-600/90 p-1.5 text-white shadow hover:bg-cyan-500" title="Download (composited PNG)"><Download className="h-3.5 w-3.5" /></button>
                        <button onClick={() => dispatch({ type: "DELETE_IMAGE", id: selectedImage.id })} className="rounded-full bg-red-600/90 p-1.5 text-white shadow hover:bg-red-500" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* error toast */}
            {error && (
              <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-md border border-red-500/40 bg-red-950/80 px-3 py-1.5 text-xs text-red-300">
                <AlertCircle className="h-3.5 w-3.5" /> {error}
                <button onClick={() => dispatch({ type: "SET_ERROR", error: null })}><X className="h-3 w-3" /></button>
              </div>
            )}

            {/* overlay editor modal */}
            {overlayEditorOpen && selectedImage && (
              <OverlayEditor
                image={selectedImage}
                draft={overlayDraft}
                setDraft={setOverlayDraft}
                visible={overlayVisible}
                setVisible={setOverlayVisible}
                onSave={() => { dispatch({ type: "SET_OVERLAY", id: selectedImage.id, svg: overlayDraft }); setOverlayEditorOpen(false); }}
                onClear={() => { dispatch({ type: "SET_OVERLAY", id: selectedImage.id, svg: "" }); setOverlayDraft(""); setOverlayEditorOpen(false); }}
                onClose={() => setOverlayEditorOpen(false)}
              />
            )}
          </div>

          {/* FILMSTRIP */}
          {strip.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto border-t border-cyan-500/15 bg-[#080c18]/80 px-3 py-2">
              {strip.map((img) => (
                <div key={img.id} className="group relative shrink-0">
                  <img
                    src={img.dataUrl}
                    alt=""
                    title={img.editInstruction || img.prompt}
                    onClick={() => dispatch({ type: "SELECT_IMAGE", id: img.id })}
                    onDoubleClick={() => dispatch({ type: "SET_COMPARE", id: img.id })}
                    className={`h-16 w-16 cursor-pointer rounded border object-cover transition ${img.id === state.selectedImageId ? "border-cyan-400 ring-2 ring-cyan-400/40" : "border-slate-700 hover:border-cyan-500/50"}`}
                  />
                  {img.parentId && <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[8px] text-cyan-300">↳</span>}
                  {img.id !== state.selectedImageId && (
                    <button title="Compare with selected" onClick={() => dispatch({ type: "SET_COMPARE", id: img.id })}
                      className="absolute right-0.5 top-0.5 hidden rounded bg-black/70 p-0.5 text-fuchsia-300 group-hover:block"><GitCompare className="h-3 w-3" /></button>
                  )}
                </div>
              ))}
              {generating && Array.from({ length: state.generatingCount }).map((_, i) => (
                <div key={`sh-${i}`} className="h-16 w-16 shrink-0 animate-pulse rounded border border-cyan-500/30 bg-cyan-500/10" />
              ))}
            </div>
          )}

          {/* PROMPT BAR */}
          <div className="border-t border-cyan-500/15 bg-[#080c18] p-3">
            <div className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-[#0a1020] px-3 py-2 focus-within:border-cyan-400/60">
              <Sparkles className="h-4 w-4 shrink-0 text-fuchsia-400" />
              <input
                value={settings.prompt}
                onChange={(e) => dispatch({ type: "SET_SETTINGS", payload: { prompt: e.target.value } })}
                onKeyDown={(e) => { if (e.key === "Enter" && !generating) generate(); }}
                placeholder="Describe the graphic you want…"
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 outline-none"
              />
              <span className="text-[10px] text-slate-600">{settings.prompt.length}/{MAX_PROMPT_CHARS}</span>
              <button onClick={assistPrompt} disabled={assisting || !settings.prompt.trim()} title="Prompt assist (Smyth rewrites it)"
                className="rounded p-1.5 text-fuchsia-300 transition hover:bg-fuchsia-500/10 disabled:opacity-40">
                <Wand2 className={`h-4 w-4 ${assisting ? "animate-spin" : ""}`} />
              </button>
              <button onClick={() => generate()} disabled={generating || !settings.prompt.trim()}
                className="flex items-center gap-1.5 rounded-md bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-white transition hover:opacity-90 disabled:opacity-40">
                {generating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {generating ? "Working" : "Generate"}
              </button>
            </div>
          </div>
        </div>

        {/* SMYTH CHAT */}
        <div className="flex w-80 flex-col border-l border-cyan-500/20 bg-[#080c18]">
          <div className="flex items-center gap-2 border-b border-cyan-500/10 px-3 py-2.5">
            <div className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(0,255,255,0.8)]" />
            <span className="font-['Orbitron'] text-[11px] font-bold tracking-widest text-cyan-300">SMYTH</span>
            <span className="text-[10px] text-slate-500">art director</span>
          </div>
          <div className="relative flex-1 overflow-y-auto">
            {streaming && <ChatThinkingEffect />}
            <div className="relative z-10 space-y-3 p-3">
              {chat.length === 0 && (
                <div className="rounded-md border border-cyan-500/15 bg-cyan-500/5 p-3 text-xs leading-relaxed text-slate-400">
                  Tell me what you&apos;re making — a banner, a logo concept, album art. I&apos;ll generate it, then we refine it together. Select any version and say &quot;make it darker&quot; and I&apos;ll rework it.
                </div>
              )}
              {chat.map((m) => (
                <ChatBubble key={m.id} msg={m} images={images} onSelect={(id) => dispatch({ type: "SELECT_IMAGE", id })} />
              ))}
              {streaming && <div className="text-[11px] italic text-cyan-400/70">Smyth is thinking…</div>}
              <div ref={chatEndRef} />
            </div>
          </div>
          <div className="border-t border-cyan-500/15 p-2.5">
            <div className="flex items-end gap-2 rounded-lg border border-cyan-500/30 bg-[#0a1020] px-2.5 py-2 focus-within:border-cyan-400/60">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                placeholder={canvaMode
                  ? (selectedImage ? "Describe the Canva layout you want with this image…" : "Describe the Canva design you want…")
                  : (selectedImage ? "Tell Smyth what to change…" : "Tell Smyth what to make…")}
                rows={2}
                className="min-w-0 flex-1 resize-none bg-transparent text-xs text-slate-100 placeholder-slate-500 outline-none"
              />
              <button
                type="button"
                onClick={() => setCanvaMode((v) => !v)}
                title={canvaMode ? "Canva mode ON — layouts go to Canva" : "Canva mode OFF — default Perchance generation"}
                className={`rounded-md p-2 transition ${
                  canvaMode
                    ? "bg-gradient-to-r from-[#00C4CC] to-[#7D2AE8] text-white shadow-[0_0_12px_rgba(0,196,204,0.4)]"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                }`}
              >
                <Palette className="h-3.5 w-3.5" />
              </button>
              {streaming ? (
                <button
                  type="button"
                  onClick={stopChat}
                  title="Stop Smyth"
                  className="rounded-md bg-red-500/80 p-2 text-white transition hover:bg-red-400"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button onClick={sendChat} disabled={generating || !chatInput.trim()}
                  className="rounded-md bg-cyan-500/80 p-2 text-white transition hover:bg-cyan-400 disabled:opacity-40">
                  <Send className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- helpers ----------
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function defaultOverlay(img: DesignImage): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${img.width} ${img.height}">
  <defs>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#00e5ff"/>
      <stop offset="1" stop-color="#ff2ea6"/>
    </linearGradient>
  </defs>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
    font-family="Orbitron, sans-serif" font-size="${Math.round(img.width / 12)}" font-weight="700"
    fill="url(#glow)">TITLE</text>
</svg>`;
}

// ---------- chat bubble with inline generated images ----------
function ChatBubble({ msg, images, onSelect }: { msg: DesignChatMsg; images: DesignImage[]; onSelect: (id: string) => void }) {
  const isUser = msg.role === "user";
  const imgs = (msg.imageIds ?? (msg.imageId ? [msg.imageId] : []))
    .map((id) => images.find((i) => i.id === id))
    .filter(Boolean) as DesignImage[];
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[90%] rounded-lg px-3 py-2 text-xs leading-relaxed ${isUser ? "bg-cyan-600/20 text-cyan-100" : "bg-[#0d1322] text-slate-300"}`}>
        {msg.pending ? <span className="italic text-slate-500">{msg.content || "…"}</span> : msg.content}
        {imgs.length > 0 && (
          <div className={`mt-2 grid gap-1.5 ${imgs.length > 1 ? "grid-cols-2" : ""}`}>
            {imgs.map((img) => (
              <img key={img.id} src={img.dataUrl} alt="" onClick={() => onSelect(img.id)}
                className="w-full cursor-pointer rounded border border-cyan-500/20 object-cover transition hover:border-cyan-400/60" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- drag-wipe compare ----------
function CompareView({ base, other, pos, setPos }: { base: DesignImage; other: DesignImage; pos: number; setPos: (n: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(ref.current);
    setW(ref.current.clientWidth);
    return () => ro.disconnect();
  }, []);
  const onMove = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPos(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  };
  return (
    <div
      ref={ref}
      className="relative max-h-full select-none overflow-hidden rounded-md border border-fuchsia-500/30"
      onMouseDown={(e) => { dragging.current = true; onMove(e.clientX); }}
      onMouseMove={(e) => dragging.current && onMove(e.clientX)}
      onMouseUp={() => (dragging.current = false)}
      onMouseLeave={() => (dragging.current = false)}
    >
      <img src={base.dataUrl} alt="" className="block max-h-[70vh] max-w-full object-contain" draggable={false} />
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
        <img src={other.dataUrl} alt="" className="block max-h-[70vh] max-w-none object-contain" style={w ? { width: w } : undefined} draggable={false} />
      </div>
      <div className="absolute inset-y-0 w-0.5 bg-fuchsia-400" style={{ left: `${pos}%` }}>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fuchsia-500 p-1.5 text-white shadow-lg">
          <GitCompare className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  );
}

// ---------- style picker ----------
function styleSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function StyleMenu({ selected, onPick, onClose }: { selected: string; onPick: (name: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [building, setBuilding] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  const loadPreviews = useCallback(() => {
    fetch("/api/style-previews?all=1")
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) {
          setPreviews(d.previews || {});
          setMissing(d.missing || []);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => { loadPreviews(); }, [loadPreviews]);

  // Build the next missing preview, then re-poll. Sequentially fills the cache.
  const buildNext = useCallback(async () => {
    if (building || missing.length === 0) return;
    setBuilding(true);
    try {
      await fetch("/api/style-previews?style=" + encodeURIComponent(missing[0]));
      loadPreviews();
    } catch { /* ignore */ } finally {
      setBuilding(false);
    }
  }, [building, missing, loadPreviews]);

  const list = useMemo(() => {
    const q = query.toLowerCase().trim();
    const all = [{ name: "none" } as any, ...ART_STYLES];
    if (!q) return all;
    return all.filter((s) => s.name.toLowerCase().includes(q));
  }, [query]);

  const coverage = Math.round((Object.keys(previews).length / ART_STYLES.length) * 100);

  return (
    <div ref={ref} className="absolute right-0 top-full z-50 mt-1 w-[26rem] rounded-md border border-fuchsia-500/40 bg-[#0a0f1e] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-fuchsia-500/20 p-2">
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search 78 styles…"
          className="min-w-0 flex-1 rounded border border-fuchsia-500/30 bg-[#060913] px-2 py-1 text-xs text-slate-200 outline-none" />
        <span className="shrink-0 text-[10px] text-slate-500" title="preview coverage">{coverage}%</span>
        {missing.length > 0 && (
          <button onClick={buildNext} disabled={building} title="Generate next style preview"
            className="shrink-0 rounded border border-fuchsia-500/40 px-2 py-1 text-[10px] font-semibold text-fuchsia-300 hover:bg-fuchsia-500/10 disabled:opacity-40">
            {building ? "…" : `+${missing.length}`}
          </button>
        )}
      </div>
      <div className="grid max-h-80 grid-cols-3 gap-1.5 overflow-y-auto p-2">
        {list.map((s) => {
          const thumb = s.name === "none" ? null : previews[s.name];
          return (
            <button key={s.name} onClick={() => onPick(s.name === "none" ? "none" : s.name)}
              className={`group flex flex-col overflow-hidden rounded border text-left transition ${selected === s.name ? "border-fuchsia-400 bg-fuchsia-500/20" : "border-slate-700/60 hover:border-fuchsia-500/50 hover:bg-fuchsia-500/5"}`}>
              {thumb ? (
                <img src={thumb} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center bg-[#0d1322] text-slate-600">
                  {s.name === "none" ? <span className="text-[10px]">∅</span> : <Sparkles className="h-4 w-4 opacity-40" />}
                </div>
              )}
              <span className="truncate px-1.5 py-1 text-[10px] text-slate-300 group-hover:text-fuchsia-200">
                {s.name === "none" ? "No style" : s.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- SVG overlay editor ----------
function OverlayEditor({
  image,
  draft,
  setDraft,
  visible,
  setVisible,
  onSave,
  onClear,
  onClose,
}: {
  image: DesignImage;
  draft: string;
  setDraft: (s: string) => void;
  visible: boolean;
  setVisible: (b: boolean) => void;
  onSave: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const isValid = /<svg[\s\S]*<\/svg>/i.test(draft);
  return (
    <div className="absolute inset-0 z-20 flex bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="m-auto flex h-[85%] w-[90%] max-w-4xl overflow-hidden rounded-lg border border-cyan-500/40 bg-[#0a0f1e] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* live preview */}
        <div className="relative flex flex-1 items-center justify-center bg-[#060a14] p-4">
          <div className="relative max-h-full max-w-full">
            <img src={image.dataUrl} alt="" className="max-h-full max-w-full rounded object-contain" />
            {visible && isValid && (
              <div className="pointer-events-none absolute inset-0 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: draft }} />
            )}
          </div>
          <div className="absolute left-3 top-3 flex items-center gap-2">
            <button onClick={() => setVisible(!visible)} className={`rounded px-2 py-1 text-[11px] font-semibold ${visible ? "bg-amber-500/80 text-white" : "bg-slate-700 text-slate-300"}`}>
              {visible ? "Overlay ON" : "Overlay OFF"}
            </button>
            {!isValid && <span className="rounded bg-red-500/20 px-2 py-1 text-[11px] text-red-300">Invalid SVG</span>}
          </div>
        </div>
        {/* editor */}
        <div className="flex w-96 flex-col border-l border-cyan-500/20">
          <div className="flex items-center justify-between border-b border-cyan-500/10 px-3 py-2">
            <span className="text-xs font-bold text-cyan-300">SVG OVERLAY</span>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="h-4 w-4" /></button>
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-[#060913] p-3 font-mono text-[11px] leading-relaxed text-cyan-100 outline-none"
          />
          <div className="flex gap-2 border-t border-cyan-500/10 p-3">
            <button onClick={onSave} disabled={!isValid} className="flex-1 rounded bg-cyan-500/80 px-3 py-1.5 text-xs font-bold text-white hover:bg-cyan-400 disabled:opacity-40">Save</button>
            <button onClick={onClear} className="rounded border border-red-500/40 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10">Clear</button>
            <button onClick={onClose} className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/50">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
