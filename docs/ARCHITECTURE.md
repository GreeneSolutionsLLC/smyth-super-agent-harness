# Smyth Super Agent — Architecture

## Overview

Smyth Super Agent is a multi-tenant agent platform built on a **three-tier architecture**:

| Tier | Stack | Purpose |
|------|-------|---------|
| **Cloud / Web** | Next.js + OpenClaw | Multi-tenant web app, skill hosting, billing, orchestration |
| **Echo Vision** | Python (structural image decoder) | **Model-agnostic vision layer** — gives any text-based model the ability to "see" images through structural data (pixel grids, edges, contours, OCR, colors). Runs as a sidecar or embedded process. |
| **Local Agent** | Rust (later, jcode-inspired) | On-device compaction, offline queueing, embedded sensors, low-latency inference |

The cloud tier ships first (beta). Echo Vision ships alongside it — it's immediately useful. The Rust local tier follows once demand proves out.

---

## Why Echo Vision Changes Everything

Most AI apps that handle images are **model-gated** — you need GPT-4o, Claude 3.5 Sonnet, or Gemini Pro Vision to process images. That means:
- You're locked into expensive models
- You can't use local/open-source models for vision tasks
- Every image costs tokens at the vision rate (much higher)

Echo Vision solves this: it **decodes images into structured data** that ANY text model can read. Pixel grid, edge maps, contours, color regions, OCR text, face/glasses detection, lighting, composition — all as JSON.

**Now your OmniRoute model router can route vision tasks to ANY model — including $0.15/M tokens ones.**

### How it fits

```
User uploads image → Next.js API → Echo Vision (Python)
                                    ↓
                              JSON report (pixel grid, edges,
                              contours, OCR, colors, semantic,
                              composition, etc.)
                                    ↓
                              Feed to ANY text model via OmniRoute
                                    ↓
                              Model reasons over structural data
                              as if it "saw" the image
```

---

## The Vision System: Echo Vision

### What it outputs (11 analysis layers)

| Layer | What it produces | What the LLM can do with it |
|-------|-----------------|---------------------------|
| **Pixel Grid** | Row-by-row color grid (spatial layout) | "Read" the image spatially — top-to-bottom, left-to-right |
| **Dominant Colors** | Top 5 colors with hex + name + coverage % | Know exact palette without vision model |
| **Edges** | Edge density, quadrant activity, interpretation | Know where detail is concentrated |
| **Contours** | Shapes with bounding boxes, positions, types | Identify objects by geometric shape |
| **Color Regions** | Spatial color segmentation | Know what color lives where |
| **OCR Text** | Text extraction with positions & confidence | Read text without vision model |
| **Semantic** | Faces, eyes, glasses with frame/lens/tint analysis | Detect people, facial features |
| **Creative Vision** | Lighting mood, color temp, texture, composition, palette scheme | Art-level analysis |
| **Zoom** | Full-resolution pixel grid of any region | Fine-detail inspection |
| **SVG** | Vector paths via vtracer | Perfect for diagrams, logos, UI |
| **ASCII Art** | Brightness-to-character encoding | Quick silhouette recognition |

### Deployment

- **Beta:** Spawn Python subprocess from Next.js API route or Node worker thread
- **Scale:** Python microservice sidecar (FastAPI + shared volume)
- **Local:** Runs natively on the user's machine (already works with `python3 echovision.py`)

### Skill Integration

Skills declare `"vision": true` in their manifest if they need Echo Vision:

```json
{
  "name": "image-analyzer",
  "vision": true,
  "permissions": ["filesystem:read"]
}
```

The runtime automatically:
1. Runs Echo Vision on any image the skill touches
2. Feeds the JSON report into the model context
3. Model reasons over structural data + text together

This means **every skill gets vision for free** — from browser screenshots to uploaded documents.

---

## Tier 1 — Web App (MVP / Beta)

### Frontend
- **Next.js** (App Router) — SSR + API routes
- Tailwind CSS + shadcn/ui for component library
- Deployed via Railway

### Backend
- **OpenClaw** — agent runtime (multi-tenant capable)
- **OmniRoute** — model router (any model can now "see" via Echo Vision)
- PostgreSQL (Railway) — user data, billing, logs
- Redis (Railway) — session cache, job queue
- **Echo Vision** — Python sidecar for structural image decoding

### Skill System
- Skills are isolated Node.js/TypeScript modules
- Each skill defines:
  - `manifest.json` — name, description, required tools, permissions, vision flag
  - `handler.ts` — main entrypoint
  - Tool bindings (browser, email, search, filesystem, vision)
- Skills are loaded at runtime from a registry (S3 + DB)
- Skill marketplace: users can install/remove permissions-gated skills

### Multi-Tenancy
- Organization → Users → API Keys structure
- Tenant isolation via DB row-level security
- Per-tenant skill allowlisting
- Usage tracking (tokens + vision calls) → Stripe billing

---

## Tier 2 — Local Agent (Rust / Post-MVP)

### Motivation
- Works offline / spotty connectivity
- Runs local inference (small models, on-device)
- Compress and queue operations server-side failed
- Sensor integration (webcam, mic, file system watchers)
- Super-low latency for repetitive tasks

### Architecture (drawn from jcode patterns)
- Each crate is a standalone capability
- `smyth-core` — shared types, serialization, errors
- `smyth-compactor` — payload compression, dedup, batching (MIT fork of jcode crates)
- `smyth-queue` — offline FIFO queue with sync reconciliation
- `smyth-lens` — local vision/sensor processing (wraps Echo Vision or native Rust port)
- FFI bridge to Next.js via Tauri or a local HTTP sidecar

---

## Skill System (Full Detail)

```json
{
  "name": "browser-control",
  "version": "1.0.0",
  "description": "Control a web browser programmatically",
  "vision": false,
  "permissions": [
    "browser:open",
    "browser:navigate",
    "browser:read",
    "browser:click",
    "network:fetch"
  ],
  "tools": ["browser", "fetch"],
  "author": "smyth"
}
```

### Skill Runtime
1. User enables a skill → OpenClaw loads the module
2. Skill manifests define required tools & permissions
3. If `vision: true`, Echo Vision automatically decodes images before model inference
4. Runtime sandboxes skill execution per permission scope
5. Skills can be community-authored and submitted via PR

### Skill Categories (Beta)
- **Hero** — browser automation, web research, email triage
- **Vision** — image analysis, screenshot understanding, OCR (uses Echo Vision)
- **Productivity** — calendar, todo, note-taking
- **Media** — image gen, video, audio
- **Custom** — user-written TypeScript skills

---

## Data Flow

```
User → Web UI (Next.js) → API Route → OpenClaw Agent
                                         ├─ OmniRoute → LLM (any model)
                                         ├─ Echo Vision → structural image data
                                         ├─ Skill Runtime → Tools
                                         └─ DB → Sessions / Logs

Echo Vision flow:
  Image file → Python subprocess → echovision.py → JSON report → LLM context

Offline (later):
User → Smyth Desktop (Tauri + Rust) → Local Queue → Sync on reconnect
```

---

## Deployment

### Beta
- Next.js → Railway (containerized)
- PostgreSQL → Railway Postgres plugin
- Redis → Railway Redis plugin
- Echo Vision → Python sidecar in same container or separate Railway service
- Skill registry → S3 + DB metadata
- OpenClaw → embedded in Next.js API routes

### Production Scale
- OpenClaw worker pool (separate process)
- Echo Vision as dedicated microservice (horizontal scaling)
- Horizontal scaling per tenant
- CDN for skill modules
- Local agent distributed via Homebrew / direct download

---

## Key Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Model-agnostic vision | Echo Vision (Python) | Breaks model lock-in. Any text model can "see". Works with local models. |
| Multi-tenant from day 1 | Yes | Greene Solutions needs it; backfilling is painful |
| Local agent tech | Rust | jcode validates performance; MIT licensing |
| Skill isolation | Process-level (Node worker threads) | Fast enough for beta; Wasm for later |
| Model router | OmniRoute | Already proven; Echo Vision means even cheap models handle images |
| Frontend framework | Next.js | Best DX for full-stack; massive ecosystem |
| Desktop shell | Tauri (later) | Lightweight; Rust native; jcode integration path |
| Deploy target | Railway | Managed Postgres + Redis; simple container deploy |
