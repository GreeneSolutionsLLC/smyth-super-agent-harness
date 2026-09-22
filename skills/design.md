---
name: design
triggers:
  - design
  - ux
  - ui
  - wireframe
  - mockup
  - brand
  - typography
  - color
  - layout
  - prototype
  - figma
  - logo
  - icon
weight: 1.0
---

# Design Skill

When producing visual, interaction, or brand work.

## Process

1. **Read the brief twice.** Note audience, tone, constraints, success metric.
2. **Critique before building.** Run `design_critique` on the plan to surface
   visual / UX / strategy issues early.
3. **Generate a system.** Use `design_generate_system` to get a consistent
   palette, type scale, and spacing scale before drawing anything.
4. **Pick a template.** Use `design_list_templates` to find an industry match,
   then `design_apply_template` to fill in brand content.
5. **Critique again** after the template is applied.

## Visual defaults

- Type scale: 1.25 ratio (minor third) unless the brand wants something else.
- Spacing scale: 4 / 8 / 16 / 24 / 32 / 48 / 64 / 96.
- Color: one accent, one neutral ramp, one semantic (success/error).
- Contrast: WCAG AA minimum on body text.

## What to refuse

- Decorative gradients over text.
- More than two typefaces in one view.
- Animation that doesn't carry meaning.

## Smyth-specific

- Generated sites live under `<repo>/public/`.
- When asked for a marketing page, default to a 1-page scroll with a hero,
  three features, two testimonials, and a CTA.
