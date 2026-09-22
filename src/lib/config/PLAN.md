# Runtime Configuration Plan — Smyth.app

Owner: Main / Kimi K2.7  
Reviewer: Rook (product), Grok (Electron lifecycle), Mini Max (build/packaging)  
Scope: v2 full app, first-run setup, no embedded keys

---

## 1. Configuration Sources (priority order)

The Smyth app reads configuration from multiple sources in this order:

1. **User env file** — `~/Library/Application Support/smyth/.env` (macOS)
   - Highest priority. Written by setup wizard or Settings.
2. **Default env file** — bundled `resources/default.env`
   - Contains safe defaults: `OMNIROUTE_URL=http://127.0.0.1:20128/v1/chat/completions`, local Ollama defaults, etc.
   - No secret keys. No user-specific paths.
3. **Process environment** — e.g., `SMYTH_USER_DATA`, `SMYTH_ENV_PATH`, `PORT`
   - Injected by Electron main process.
4. **In-code defaults** — fallback values in `src/lib/env.ts`
   - Only for truly safe defaults like `OLLAMA_BASE_URL=https://ollama.com/v1`.

### Resolution rule
- If a value exists in the user env file, it wins.
- If not, fall back to default env, then process env, then in-code default.
- Empty string in user env does NOT fall back; empty is treated as intentionally unset.

---

## 2. Configuration Module

Create `src/lib/env.ts` as the single source of truth for all runtime configuration.

Responsibilities:
- Read `process.env.SMYTH_ENV_PATH` at runtime.
- Parse `.env` file (using `dotenv` or a lightweight parser).
- Merge with bundled defaults and process env.
- Provide typed getters:
  - `getEnv(key: string): string | undefined`
  - `requireEnv(key: string, friendlyName?: string): string | throws`
  - `isServiceEnabled(serviceId: ServiceId): boolean`
  - `getEndpointForModel(provider: string, model?: string): { url: string, keyName: string }`
- Cache parsed values for the process lifetime.

### Important
- This module must work in both Next.js server context and client-safe contexts.
- Never expose user keys to the browser except through a controlled setup API.

---

## 3. User Data Directory

macOS: `~/Library/Application Support/smyth/`

Contents:
```
~/Library/Application Support/smyth/
├── .env                    # user API keys and settings
├── settings.json           # UI preferences (theme, sidebar state, etc.)
├── workspace/              # default Smyth workspace
│   └── .gitkeep
├── logs/
│   ├── main.log
│   ├── smyth-server.log
│   └── omniroute.log
├── cache/
│   └── tool-cache.json
└── python-sidecars/        # optional user-managed Python scripts
```

### On first launch
- Electron main creates this directory before spawning servers.
- If `.env` does not exist, it is created empty. The bundled `default.env` is copied only as a template, not loaded as active config.

---

## 4. First-Run Setup Wizard

Location: `src/app/setup/`  
Route: `/setup` (forced redirect on first launch if `setupComplete !== true`)  
Stored flag: `settings.json → setupComplete`

### Steps

#### Step 0: Welcome
- Greene Solutions LLC branding.
- Short value prop: local AI workspace, your keys, your data.
- Buttons: Continue, Skip Setup (still creates empty `.env`, enables OmniRoute auto).

#### Step 1: Model Provider Selection
- Default: OmniRoute auto-routing (no key, enabled automatically).
- Optional providers in tabs/cards:
  - Ollama Cloud
  - Ollama Pro
  - OpenClaw Gateway
  - Local Ollama (auto-detect)
  - Parallel Web / AI Search
  - AgenticMail
  - Zernio
  - Perchance
  - Replicate
  - Twenty CRM
  - Brave Search (MCP)
- For each provider:
  - Dropdown of common models.
  - Selecting a model auto-fills endpoint URL (read-only field, can be overridden).
  - API key input (masked).
  - "Test" button that calls a lightweight endpoint.
  - "Skip" button.

#### Step 2: macOS Permissions
- Camera, Microphone, Accessibility, Screen Recording.
- Each shows: why it is needed, current status (granted / not granted), button to request or open System Settings.
- All permissions can be deferred.

#### Step 3: Workspace Path
- Default: `~/Library/Application Support/smyth/workspace`.
- Allow user to pick a different folder.
- Create folder if it does not exist.

#### Step 4: Legal
- Display EULA, Privacy Policy, Terms of Service, Accessibility Statement.
- Checkbox: "I agree to the Terms of Service and Privacy Policy."
- Required to finish setup.
- Link: "Read full legal documents" opens local HTML pages in a modal.

#### Finish
- Write all collected keys/paths to `~/Library/Application Support/smyth/.env`.
- Write `setupComplete: true` to `settings.json`.
- Restart Smyth server from Electron main so new env is loaded.
- Redirect to `/`.

---

## 5. Model + Endpoint Mapping

Create `src/lib/model-config.ts` containing:

- `PROVIDERS` array with id, name, optional/required flags.
- `MODELS_BY_PROVIDER` map.
- For each model: id, display name, default endpoint URL, API key env var name, capabilities (vision, tools, etc.).

Example:
```ts
{
  provider: "ollama-cloud",
  models: [
    { id: "glm-5.2:cloud", name: "GLM 5.2 Cloud", endpoint: "https://ollama.com/v1/chat/completions", keyName: "OLLAMA_CLOUD_API_KEY", capabilities: ["tools", "reasoning", "coding"] },
    { id: "qwen3.5:cloud", name: "Qwen 3.5 Cloud", endpoint: "https://ollama.com/v1/chat/completions", keyName: "OLLAMA_CLOUD_API_KEY", capabilities: ["tools", "coding"] },
  ]
}
```

OmniRoute auto models are listed under provider `omniroute` with `keyName: null` (no key required for free auto models).

---

## 6. Graceful Degradation

When a service is skipped or a key is missing:
- UI panel for that service shows a placeholder card: "[Service] is not configured. Add your key in Settings."
- Chat tools that require the service return a friendly message instead of crashing.
- API routes check `isServiceEnabled` before calling third-party endpoints and return 503 with `serviceRequired` if disabled.

---

## 7. Files to Create or Modify

### New files
- `src/lib/env.ts` — configuration module
- `src/lib/model-config.ts` — model + endpoint mapping
- `src/app/setup/page.tsx` — setup wizard UI
- `src/app/setup/layout.tsx` — setup layout (no sidebar)
- `src/components/setup/ProviderCard.tsx`
- `src/components/setup/ModelSelector.tsx`
- `src/components/setup/PermissionItem.tsx`
- `src/components/setup/LegalCheckbox.tsx`
- `src/app/api/setup/route.ts` — write setup form to `.env` and restart signal
- `src/app/api/setup/status/route.ts` — return setup completion + enabled services
- `src/app/api/setup/test-model/route.ts` — lightweight model connectivity test
- `resources/default.env` — bundled safe defaults

### Modified files
- `src/lib/ollama-models.ts` — derive endpoint/key info from `model-config.ts` if possible, or keep as source of truth for machine pool
- `src/lib/tools.ts` — read keys via `env.ts` instead of `process.env` directly
- `src/app/api/swarm/route.ts` — use `env.ts`
- `src/app/page.tsx` — check setup status on load, redirect to `/setup` if incomplete
- `next.config.js` or `next.config.ts` — add `output: 'standalone'`

---

## 8. API Keys That Must Be Configurable

- `OPENCLAW_GATEWAY_TOKEN`
- `OLLAMA_CLOUD_API_KEY`
- `OLLAMA_PRO_API_KEY`
- `OMNIROUTE_API_KEY` (optional; free auto-routing does not require it)
- `PARALLEL_API_KEY`
- `AGENTICMAIL_MASTER_KEY`
- `ZERNIO_API_KEY`
- `PERCHANCE_COOKIE`, `PERCHANCE_USER_KEY`
- `REPLICATE_API_TOKEN`
- `TWENTY_MCP_TOKEN`
- `BRAVE_API_KEY`
- `DATABASE_URL` (only if local MCP DB used)
- `LOCAL_OLLAMA_API_KEY` (default "ollama-local" if unset)

---

## 9. Security Notes

- User `.env` lives outside the app bundle so it survives updates and uninstall.
- Never log keys. Mask them in UI and logs.
- The setup API runs only on localhost; no remote exposure.
- For v2, no encryption of `.env` at rest, but store with macOS file permissions `0600` from Electron main.
