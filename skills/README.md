# Skills System

Progressive skill loading for Smyth, inspired by Hermes Agent and DeerFlow.

## What is a Skill?

A skill is a Markdown file that teaches the agent how to approach a specific
domain — coding, design, data analysis, business, social, video, research.

Skills are **not** always-on system prompt content. They are *progressive*:
loaded only when the user query matches the skill's domain.

## Structure

```
skills/
├── README.md            (this file)
├── coding.md            ← Python, TypeScript, debugging, architecture
├── design.md            ← UX, visual, brand systems
├── data.md              ← SQL, analytics, ML pipelines
├── business.md          ← strategy, ops, sales, finance
├── social.md            ← LinkedIn, X, content strategy
├── video.md             ← editing, storyboard, motion
├── research.md          ← web research, synthesis, citations
└── web.md               ← scraping, browser automation, Playwright
```

## How loading works

1. `SkillsLoader.load_relevant(query, top_k=2)` scores each skill's trigger
   keywords against the user query and returns the top matches.
2. The returned content is appended to the system prompt for that turn.
3. No content is kept across turns unless re-matched — keeps prompts lean.

## Trigger keywords

Each skill file starts with a YAML frontmatter block:

```yaml
---
name: coding
triggers:
  - python
  - typescript
  - bug
  - refactor
  - function
  - class
weight: 1.0
---
```

`triggers` are lowercase substrings; `weight` boosts a skill's score when
multiple triggers fire (default 1.0).

## Adding a new skill

1. Create `skills/<your-skill>.md` with YAML frontmatter at the top.
2. List 5–15 trigger words you want to match against user queries.
3. Below the frontmatter, write guidance the agent should follow when this
   skill is active.
4. Reload SmythCore (or call `loader.refresh()`).
