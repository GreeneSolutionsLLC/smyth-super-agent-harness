---
name: social
triggers:
  - social
  - linkedin
  - twitter
  - x
  - instagram
  - tiktok
  - youtube
  - post
  - thread
  - reel
  - short
  - audience
  - engagement
  - content
weight: 1.0
---

# Social Skill

When the work involves social platforms.

## Defaults

- **LinkedIn**: long-form, 1200–1800 chars, hook in the first two lines,
  white space between paragraphs. No hashtag soup.
- **X / Twitter**: threads, 5–8 tweets, each stands alone.
- **Instagram**: caption + alt text. Captions are saved searchable text, not
  afterthoughts.
- **YouTube**: title is the click; thumbnail is the second click; the first
  30 seconds are the third.

## Workflow

1. `zernio_list_channels` to see what's connected.
2. `zernio_create_post` for the publish — supports scheduling and per-platform
   settings.
3. `zernio_get_analytics` 48h after publish to learn from each post.

## Anti-patterns

- Cross-posting the same copy to every platform.
- Posting and ghosting — replies are the actual engagement.
- Vanity metrics. Save the numbers, but optimize for DMs and replies.
