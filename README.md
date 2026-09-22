# Smyth Super Agent Harness

A local-first AI agent workspace. Bring your own model keys, run it on your own
hardware, and give your agent a persistent memory, a skill system, and a
unified panel for email, CRM, browser, media, and more.

**No baked-in keys. No lock-in. You own the stack.**

---

## What it is

Smyth is a self-hosted agent harness — a single web app that:

- Routes chat through **any major model provider** (OpenAI, Anthropic, DeepSeek,
  xAI, Google, Mistral, OpenRouter, and more) using *your* API key.
- Runs **fully local** via Ollama if you don't want to use a cloud key.
- Gives the agent **persistent memory**, **self-review**, and a **skill system**
  (coding, research, design, media, social, business).
- Integrates open-source tools — **Twenty CRM**, scheduling, email, browser
  automation — all wired through MCP.

It's built with Next.js and TypeScript. No vendor lock-in: swap providers, models,
or run entirely offline.

---

## Quick start

```bash
git clone https://github.com/GreeneSolutionsLLC/smyth-super-agent-harness.git
cd smyth-super-agent-harness
npm install
npm run dev
# open http://localhost:3000
```

On first run you'll land on the **setup wizard**. It walks you through:

1. **AI Providers** — pick any provider (OpenAI, Anthropic, DeepSeek, etc.),
   paste your key, done. Every provider is optional.
2. **Optional integrations** — Parallel web search, Replicate media, Zernio
   social, swarm. Skip anything you don't use.
3. **Legal** — accept, and you're in.

Keys are written to a per-install `.env` file on *your* machine — never
uploaded, never baked into the code.

---

## Bring your own keys (BYOK)

Smyth supports these providers out of the box. Get a key, paste it in setup or
Settings, and start using it:

| Provider | Key | Where to get it |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | platform.openai.com/api-keys |
| Anthropic | `ANTHROPIC_API_KEY` | console.anthropic.com/settings/keys |
| Google AI Studio | `GOOGLE_API_KEY` | aistudio.google.com/apikey |
| xAI (Grok) | `XAI_API_KEY` | console.x.ai |
| DeepSeek | `DEEPSEEK_API_KEY` | platform.deepseek.com/api_keys |
| Mistral | `MISTRAL_API_KEY` | console.mistral.ai/api-keys |
| Moonshot (Kimi) | `MOONSHOT_API_KEY` | platform.moonshot.cn |
| OpenRouter | `OPENROUTER_API_KEY` | openrouter.ai/keys |
| Groq | `GROQ_API_KEY` | console.groq.com/keys |
| … and more | | Cohere, Qwen, Zhipu, Baichuan, Yi, Together, Fireworks, DeepInfra, Perplexity |

**No key? Run local.** Install [Ollama](https://ollama.com), pull a model
(`ollama pull llama3.1:8b`), and Smyth falls back to it automatically.

---

## Why Smyth

Most agent harnesses are free *shells* that charge you per token forever and
lock you to one vendor. Smyth is the opposite:

- **You own it** — self-hosted, your keys, your data.
- **Model-agnostic** — the "driver" is swappable; the harness is the asset.
- **Open tooling** — Twenty CRM, MCP, and open-source integrations instead of
  proprietary lock-in.

---

## License

Business Source License 1.1 — free to use, but not to resell as a commercial
hosted service. Converts to Apache 2.0 after four years. See [LICENSE](LICENSE).

---

## Architecture

- **Next.js 16** (App Router) frontend + API routes
- **MCP** for tool integration (stdio + SSE + HTTP, OAuth PKCE)
- **Model routing** with rate-limiting, failover, and BYOK provider streaming
- **Skill system** — a library of reusable workflows the agent loads on demand
- **Operator layer** — an overwatch agent that keeps long tasks on track

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full picture.
