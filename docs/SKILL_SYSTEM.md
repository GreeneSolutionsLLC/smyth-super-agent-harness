# Smyth Skill System

## Overview

Skills are the building blocks of Smyth Super Agent. Each skill is a self-contained module that extends what the agent can do.

## Skill Lifecycle

1. **Publish** — Skill author creates a skill package (TypeScript)
2. **Registry** — Submitted to Smyth registry (curated in beta; open later)
3. **Install** — User browses marketplace, installs with one click
4. **Permission** — User reviews and approves required tool access
5. **Run** — Agent loads skill on-demand during sessions

## Skill Package Structure

```
skills/browser-control/
├── manifest.json
├── handler.ts
├── package.json
└── README.md
```

### manifest.json
```json
{
  "name": "browser-control",
  "version": "1.0.0",
  "description": "Control a web browser programmatically",
  "author": "smyth",
  "permissions": ["browser:open", "browser:navigate", "browser:click"],
  "tools": ["browser"],
  "categories": ["hero", "automation"],
  "icon": "🌐"
}
```

### handler.ts
```typescript
import { SmythSkill, ToolContext } from '@smyth/sdk';

export default class BrowserControlSkill implements SmythSkill {
  async execute(tool: ToolContext, args: any) {
    const { url } = args;
    await tool.browser.navigate(url);
    const snapshot = await tool.browser.snapshot();
    return snapshot;
  }
}
```

## Permission Model

| Permission | Description | Risk Level |
|-----------|-------------|------------|
| `browser:open` | Open browser tabs | Medium |
| `browser:read` | Read page content | Low |
| `browser:click` | Click elements | Medium |
| `browser:type` | Type into inputs | High |
| `filesystem:read` | Read local files | High |
| `network:fetch` | Make HTTP requests | Medium |
| `email:read` | Read emails | High |
| `email:send` | Send emails | Critical |

Users must approve permissions at install time. Critical permissions require admin override.

## SDK (@smyth/sdk)

Skills import from the Smyth SDK to access:
- Tool context (browser, email, search, etc.)
- Agent memory/state (scoped to session)
- Logging and error handling
- Secure credential storage (user never exposes API keys to skills)

## Beta Skills (Curated)

| Skill | Status | Description |
|-------|--------|-------------|
| Browser Control | Planned | Navigate, click, fill, read |
| Web Research | Planned | Tavily search + scrape + summarize |
| Email Triage | Planned | Read, categorize, draft replies |
| Calendar Actions | Planned | Check schedule, create events |
| Image Generation | Planned | DALL-E / Stable Diffusion |
| Code Execution | Planned | Run Python/JS sandbox |

## Beyond Beta

- Community-authored skill submissions (PR → review → publish)
- Skill versioning + auto-update
- Usage metrics per skill (show users what's active)
- Revenue sharing for popular community skills
