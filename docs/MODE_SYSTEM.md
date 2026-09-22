# Smyth Super Agent — Mode System

## Overview

Smyth operates in one of three modes. Each mode is a complete operational profile — it changes where inference runs, what tools are available, what data can be accessed, and the fallback behavior when things fail.

```
┌─────────────────────────────────────────────────────────┐
│                    Mode Selector                         │
│                                                         │
│  ● Offline    ● Cloud    ● Computer Use                 │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ Local     │  │ OmniRoute│  │ UI TARS / Direct     │  │
│  │ Inference │  │ Remote   │  │ Machine Control      │  │
│  │ + HD      │  │ Models   │  │ (browser + desktop)  │  │
│  └──────────┘  └──────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Mode Definitions

### 1. Offline Mode 🤖🔌

**Purpose:** Privacy-sensitive chat and note-taking. Everything stays local.

| Aspect | Behavior |
|--------|----------|
| **Inference** | Local model only (Ollama, LM Studio, llama.cpp) via OmniRoute's local provider |
| **Data flow** | All data stored on local filesystem / IndexedDB |
| **Network** | No outbound calls for inference. Only loads skills from cache. |
| **Vision** | Echo Vision runs locally (Python subprocess, no API calls) |
| **Skills** | Cached skills only. New skills cannot be downloaded. |
| **Storage** | Local HD — notes, sessions, settings are files, not DB rows |
| **Fallback** | If local model unavailable → graceful error, suggest Cloud mode |

**What it's for:**
- Private conversations (therapy/brainstorming/sensitive data)
- Note-taking with AI assistance
- Airplane mode / no connectivity
- Users who want zero data leaving their machine

**In Smyth's future (Rust local tier):** Also runs the offline queue + sync reconciliation. For now: local inference + HD storage in the web app.

---

### 2. Cloud Mode ☁️🌐

**Purpose:** Full-powered agent with remote models, skill downloads, and network tools.

| Aspect | Behavior |
|--------|----------|
| **Inference** | OmniRoute routes to any configured model (OpenAI, Anthropic, etc.) |
| **Data flow** | Sessions stored in PostgreSQL (cloud) |
| **Network** | Full internet access — skills download, web browsing, API calls |
| **Vision** | Echo Vision runs server-side (Python sidecar on Railway) |
| **Skills** | Full registry access — install, update, run any skill |
| **Storage** | Cloud DB — multi-tenant, persistent |
| **Fallback** | If remote model unavailable → queue or retry |

**What it's for:**
- Everything Online mode does, plus
- Heavy agent tasks (research, automation, analysis)
- Team collaboration (shared sessions)
- Production use with billing + usage tracking

---

### 3. Computer Use Mode 🖥️🤖

**Purpose:** Smyth takes over the machine — browser control, desktop automation, file operations. This is the "bad guy from the Matrix" mode (agent that acts).

| Aspect | Behavior |
|--------|----------|
| **Inference** | Cloud mode models (needs speed + capability) |
| **Data flow** | Cloud DB + local machine access |
| **Network** | Full internet (needs to browse, scrape, etc.) |
| **Vision** | Echo Vision + screenshot analysis for UI understanding |
| **Skills** | All skills + **UI TARS** (screen-agent for computer control) |
| **Tools** | Full toolset: browser, filesystem, screen capture, keyboard, mouse |
| **Fallback** | Cannot fallback to Offline — this mode requires cloud inference |

**What UI TARS enables:**
- Smyth sees your screen (via Echo Vision + screenshots)
- Smyth navigates your browser, clicks buttons, fills forms
- Smyth reads and writes files on your filesystem
- Smyth performs multi-step workflows across apps
- Like watching a ghost use your computer

---

## Mode Selector UI

### Panel Design (always visible, left sidebar rail)

```
┌──────────────────────┐
│   Smyth              │ ││
│                      │
│  ○ Offline 🤖🔌     │ ← Current mode highlighted
│  ● Cloud ☁️          │
│  ○ Computer Use 🖥️  │
│                      │
│  ⛽████████░░  60%   │ ← Token gas tank (always visible)
│  Plan: Pro            │
└──────────────────────┘
```

**States:**
- **Hover:** Shows brief tooltip of what each mode does
- **Active:** Filled dot + subtle glow/highlight
- **Transition:** Mode switch triggers a confirm dialog if there are unsaved changes

### Mode Transition Rules

| From → To | Behavior |
|-----------|----------|
| Cloud → Offline | Warn: "You'll lose access to cloud skills and remote models. Switch?" |
| Offline → Cloud | Warn: "Your local session will sync to cloud on next connection." |
| Any → Computer Use | Warn: "Smyth will have control of your computer. Continue?" (security gate) |
| Computer Use → Offline | Auto-switch inference to local, disable UI TARS tools |

---

## How Modes Interact with OpenClaw / Kliner Face

We're not copying OpenClaw — we're using its engine and re-skinning the experience.

**What we take from OpenClaw:**
- Agent runtime (session management, tool execution, skill loading)
- Tool system architecture
- Multi-provider model routing pattern

**What changes in Smyth:**
- **Mode system** — OpenClaw doesn't have this. It's all one mode.
- **Token gas tank** — OpenClaw doesn't meter consumption this way
- **Echo Vision** — OpenClaw relies on model-native vision
- **UI aesthetic** — Kliner Face cleaned up, branded as Smyth
- **Skill marketplace** — OpenClaw has no marketplace
- **Billing / multi-tenancy** — OpenClaw is single-user

**Visual metaphor:** OpenClaw is the engine block. Smyth is the luxury car built around it. Same internals, completely different experience.

---

## Page Map (Mode-Aware)

| Page | Offline Mode | Cloud Mode | Computer Use Mode |
|------|-------------|------------|-------------------|
| **Chat** | Local inference, no cloud tools | Full agent, all skills | Full agent + screen control |
| **Notepad** | Local filesystem save | Cloud sync | Cloud + local sync |
| **Skill Store** | Cached skills only | Full marketplace | Full marketplace |
| **Settings** | Local-only config | Cloud account settings | Computer use permissions |
| **Dashboard** | Local usage stats | Cloud billing + usage | Cloud usage + computer use logs |
| **Mode Panel** | Always shown (left rail) | Always shown | Always shown |

---

## Future: Rust Local Tier

When the Rust agent ships:
- **Offline Mode** → Tauri app, fully local, no browser needed
- **Cloud Mode** → still works via web, plus sync protocol
- **Computer Use Mode** → UI TARS gets native desktop access (window management, deeper automation)

---

## Security Boundaries

| Mode | Data leaves device? | Model runs where? | Highest risk tool |
|------|-------------------|------------------|-------------------|
| Offline | ❌ No | Local | File read/write |
| Cloud | ✅ Yes | Remote API | Email send |
| Computer Use | ✅ Yes (inference) | Remote API | Browser control, mouse/keyboard |

**Critical rule:** Computer Use Mode requires explicit user approval per action for dangerous operations (file delete, email send, form submission). Offline Mode logs everything locally for audit.

---

## Questions for You

Before I build this:

1. **UI TARS integration** — do you want this in beta or post-launch? It's a heavy dependency.
2. **Offline Mode scope** — for v1, "offline" means local model via Ollama/LM Studio. Users need those installed. Is that acceptable, or should we ship with a bundled small model?
3. **Mode default** — what should the first-run mode be? Cloud makes sense since it requires no setup.
4. **The "Kliner Face" reference** — what specific elements do you want to copy vs change? I can map out exactly which panels to keep, which to re-arrange.
