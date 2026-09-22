# Web Redesign Skill — Smyth Super Agent

**The goal:** Turn Smyth into a full-stack web design agency in a single conversation. Not a generic "I redesigned your site" — a jaw-dropping, multi-angle, reference-backed transformation that makes the Deverus guy's jaw hit the floor.

---

## Architecture

```
User: "Redesign deverus.com"
       ↓
Swarm Mode (Kimi K2.6 orchestrates)
       ↓
Phase 1: Capture & Analyze ──→ Parallel: screenshot, content fetch, brand extraction
       ↓
Phase 2: Research & Reference ──→ Parallel: search best-in-class CRA/enterprise sites, 
                                   collect design patterns, pull inspiration
       ↓
Phase 3: Compete & Critique ──→ Consensus: multiple models review current site,
                                 identify every weakness independently
       ↓  
Phase 4: Design System ──→ All models propose color palettes, typography, layout grid,
                            component patterns → synthesize into one coherent system
       ↓
Phase 5: Build ──→ Generate full static site with the combined design system
       ↓
Phase 6: Preview & Polish ──→ Screenshot, iterate, refine
       ↓
Phase 7: Deliver ──→ Package with pitch summary you can send
```

---

## What Makes This "Amazing" (Not Generic)

### 1. Multi-Reference Intelligence
Instead of one model guessing what "good design" looks like, Smyth:
- **Scrapes top competitors** and extracts their design patterns
- **Researches award-winning sites** in B2B/enterprise/CRA spaces
- **Analyzes current trends** in the background screening industry
- **Builds a moodboard** from real references before writing a single line of CSS

### 2. Template Library (Curated, Not Random)
A local directory of proven templates Smyth can reference:

```
smyth-super-agent/templates/
├── enterprise-saas/       # Clean, professional B2B
│   ├── landing-simple/
│   ├── landing-hero-video/
│   └── product-showcase/
├── creative-agency/       # Bold, modern, portfolio-style
│   ├── full-bleed/
│   ├── dark-theme/
│   └── grid-heavy/
├── startup-minimal/       # Clean, fast, single-page
│   ├── one-pager/
│   ├── product-hunt-style/
│   └── waitlist/
└── foundation/            # Base building blocks
    ├── color-systems/
    ├── typography-pairs/
    └── layout-grids/
```

Each template is a real, opinionated starting point — not a boilerplate. Smyth reads the template, understands the design decisions baked into it, then **remixes** it for the target brand.

### 3. Multi-Model Consensus on Design
Before building, 3-5 models critique the plan:
- **Visual model (MiniMax M3)** — judges aesthetics, hierarchy, color
- **UX model (GLM 5.2)** — judges information architecture, flow, accessibility
- **Code model (Kimi K2.7)** — judges feasibility, implementation approach
- **Strategy model (Nemotron)** — judges brand alignment, messaging

They vote. If any model flags an issue, it gets resolved before code is written.

### 4. Generated Art + Brand Assets
Smyth can:
- Generate SVG logos/illustrations (inline, no dependencies)
- Generate color system with WCAG contrast verification
- Generate favicon, og-image, social cards
- Generate responsive breakpoint tests

### 5. Not Just a Redesign — A Competitive Analysis
The final output includes:
- **Before/after comparison** with screenshots
- **What changed and why** (annotated)
- **Competitive positioning** — how the new design stacks against top 3 competitors
- **ROI pitch** — why better design = more conversions for a CRA

---

## Tool Chain (What Smyth Needs)

| Tool | Already Exists? | Purpose |
|------|----------------|---------|
| `web_fetch` | ✅ | Scrape competitor sites, get content |
| `screenshot` | ✅ | Capture before/after visuals |
| `web_search` | ✅ | Research design trends, references |
| `shell` | ✅ | Generate builds, run local server |
| `write_file`/`read_file` | ✅ | Save design files and iterations |
| `deep_research` | ✅ | Deep CRA industry analysis |
| `planning` | ✅ | Track multi-phase progress |
| `list_files` | ✅ | Browse template library |

**New tools needed:**
- `design_review` — asks 3-5 models to critique a design plan and votes
- `generate_template` — reads a template, applies brand colors/content, outputs customized HTML
- `brand_analysis` — extracts brand identity from existing site content

---

## The "Super Agent" Edge

| Ordinary Agent | Smyth |
|---|---|
| Generates one design from training data | Researches **competitors + trends + references** first |
| Single model opinion | **3-5 model consensus** on every design decision |
| Generic boilerplate | **Curated template library** remixed for the brand |
| No context on the industry | **Deep CRA industry research** baked into the design |
| One-shot output, no iteration | **Multi-phase: analyze → plan → critique → build → review → polish** |
| No business value in output | **Competitive analysis + ROI pitch included** |

---

## How to Enable

1. Build out `src/lib/design-skill/`:
   - `reference-library.ts` — knows how to find and read templates
   - `design-system.ts` — color, typography, layout generation
   - `multi-model-critique.ts` — consensus engine for design review
   - `brand-extractor.ts` — analyzes existing site for brand signals

2. Add template directory with 9-12 real templates across 3 categories

3. Register the tools in Smyth's tool registry

4. Test the full flow end-to-end with swarm mode

---

*This is the difference between "an AI wrote my site" and "a super agent redesigned my business."*

---

## Implementation Status (July 9)

### ✅ Built
- `src/lib/design-skill/brand-analyzer.ts` — Brand profile extraction + design system generator
- `src/lib/design-skill/reference-library.ts` — 3 curated templates (Enterprise SaaS, Creative Dark, Startup Minimal) + apply/render engine
- `src/lib/design-skill/multi-model-critique.ts` — 3-perspective design review engine
- `src/lib/tools.ts` — 5 new tools registered: `design_analyze_brand`, `design_generate_system`, `design_list_templates`, `design_apply_template`, `design_critique`

### Needs Work
- Templates are embedded in code — should load from filesystem `templates/` dir for easier expansion
- `multi-model-critique.ts` uses simulated responses (no real API calls yet) — needs wiring to pool router
- The `screenshot` tool uses Chromium headless which isn't reliable — needs switch to Playwright or Puppeteer
- No generated SVG/illustration system yet — templates use placeholder graphics
- No competitive analysis auto-fetch flow (manually triggered via web_search)
