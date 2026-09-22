# Smyth Super Agent — Roadmap

## Phase Zero: Foundation (Now)
- [x] Name: **Smyth Super Agent** (working title)
- [x] Architecture document written
- [x] Create repo (GitHub private) — GreeneSolutionsLLC/smyth-super-agent
- [x] Bootstrap Next.js + Tailwind v4 + shadcn/ui
- [x] Railway deploy config (railway.json + Dockerfile)
- [x] Landing page + chat UI + agent API proxy
- [x] Echo Vision integrated into architecture (model-agnostic vision layer)
- [ ] Wire up OpenClaw agent session
- [ ] Wire up OmniRoute proxy integration
- [ ] Define first hero skill: **browser automation**

## Phase One: Beta — Web App (Q3 2026)

### Core Platform
- [ ] Multi-tenant auth (org → users → API keys) — Clerk or NextAuth
- [ ] Stripe subscription billing (metered tokens)
- [ ] Dashboard — usage stats, session logs, token gas tank
- [ ] Agent chat UI (threaded, persistent) — already scaffolded
- [ ] OmniRoute model selector per user/tier

### Echo Vision (model-agnostic vision layer)
- [ ] Python sidecar service (FastAPI wrapper around echovision.py)
- [ ] Vision endpoint in Next.js API routes (spawns Python subprocess)
- [ ] Skill manifest `vision: true` flag support
- [ ] Auto-inject vision data into context when user uploads image
- [ ] Vision usage tracking (cost per image analysis)

### Skill System
- [ ] Skill registry & marketplace UI
- [ ] Runtime skill loader (isolated processes)
- [ ] **Hero Skill: Browser Control** (Playwright — navigate, click, read)
- [ ] **Hero Skill: Web Research** (Tavily + scrape + summarize)
- [ ] **Hero Skill: Email Triage** (read, categorize, draft replies)
- [ ] **Hero Skill: Image Understanding** (Echo Vision-powered)
- [ ] Skill permissions UI (user approves tool access)

### Token Meter (Gas Tank)
- [ ] Live token consumption in sidebar (always-visible)
- [ ] Green/amber/red color zones based on remaining allowance
- [ ] Pulse animation during active session token burn
- [ ] Per-tier token limits (Basic 50K, Pro 500K, Enterprise unlimited)
- [ ] Usage threshold alerts (email at 80%, 95%, 100%)

### Infrastructure
- [ ] PostgreSQL schema (users, orgs, sessions, logs, billing)
- [ ] Redis for session cache + job queue
- [ ] CI/CD via GitHub Actions → Railway
- [ ] Deploy to Railway staging environment

## Phase Two: Local Tier — Rust (Q4 2026 / Q1 2027)
- [ ] Spin up `smyth-core` crate (shared types)
- [ ] Integrate jcode compaction patterns → `smyth-compactor`
- [ ] Build `smyth-queue` (offline FIFO, sync reconciliation)
- [ ] Port Echo Vision to Rust (native `smyth-lens` crate) or keep as Python sidecar
- [ ] Desktop wrapper via Tauri
- [ ] Local agent daemon (HTTP sidecar)
- [ ] Sync protocol: offline → queue → cloud reconcile
- [ ] Beta desktop distribution (Homebrew tap + direct download)

## Phase Three: Scale & Polish (2027)
- [ ] Skill marketplace — community submissions
- [ ] Local-first mode (Rust agent as primary, cloud as backup)
- [ ] Custom model fine-tuning layer
- [ ] Enterprise SSO (SAML, OIDC)
- [ ] Audit logs + compliance exports
- [ ] On-prem / self-hosted option

---

## Notes from Research

### jcode
- MIT-licensed compaction crate is pullable for `smyth-compactor`
- Offline queue pattern maps 1:1 to `smyth-queue`
- For v1 (web beta), ignore Rust tier entirely — focus on shipping the web app
- When Rust local tier becomes active, jcode patterns save 3-4 weeks of R&D

### Echo Vision
- **Already exists and works** — not a future dependency, a current asset
- Gives Smyth a fundamental advantage: *any* model can process images
- Breaks vision model lock-in (no forced GPT-4o/Claude Vision tier)
- Must be deployed as a sidecar in beta — Python subprocess from Next.js
- Future: native Rust port or keep Python if performance is fine

## Anti-Goals (V1)
- ❌ No local/Rust agent in beta
- ❌ No community marketplace in beta (curated only)
- ❌ No custom model training
- ❌ No on-prem deployment
- ❌ No self-hosted vision — Echo Vision runs on Smyth infra
