---
name: coding
triggers:
  - python
  - typescript
  - javascript
  - refactor
  - bug
  - function
  - class
  - module
  - test
  - pytest
  - jest
  - async
  - decorator
  - generator
  - api
  - endpoint
  - route
weight: 1.0
---

# Coding Skill

When writing or editing code, follow these defaults.

## Style

- **Python**: type hints on every public function. Async where it earns its
  keep. Prefer stdlib before adding deps. No wildcard imports.
- **TypeScript**: strict mode. `interface` over `type` for object shapes.
  Avoid `any`; if you must, narrow immediately.
- Match the existing repo's style before imposing a new one.

## Process

1. **Read before writing.** Skim the surrounding file. Match naming.
2. **Smallest viable change.** No drive-by refactors.
3. **Test what you can.** New logic gets a test or a docstring with an
   example. Bug fixes get a regression test.
4. **Errors are data.** Catch narrowly, log with context, re-raise if you
   can't handle.

## Smyth-specific

- All new code lives next to its peers in the repo root (`$SMYTH_HOME` or the directory you cloned into).
- Memory writes go through `SmythCore.save_fact()` — never directly to JSON.
- Tool registrations go through `SmythCore.register_tool()` so they appear in
  the model tool schema.

## Anti-patterns to refuse

- Premature abstraction. Write the second copy before extracting.
- Logging secrets. Redact tokens, emails, phone numbers.
- `try/except: pass` — at minimum log what you swallowed.
