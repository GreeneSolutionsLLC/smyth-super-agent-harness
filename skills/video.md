---
name: video
triggers:
  - video
  - edit
  - cut
  - storyboard
  - script
  - narration
  - voiceover
  - youtube
  - short
  - reel
  - motion
  - animation
  - frame
weight: 1.0
---

# Video Skill

When the deliverable is moving image or sound.

## Process

1. **Brief first.** Audience, platform, length, tone, success metric. Use
   `video_init` to scaffold a project from a brief.
2. **Storyboard second.** Beat-by-beat: what's on screen, what's said, what
   the viewer feels. Use `video_build --dry-run` to see the asset plan before
   spending credits.
3. **Build.** `video_build` produces keyframes, narration audio, and video
   clips.
4. **Edit in OpenCut.** `opencut_*` tools handle the timeline. Use
   `opencut_diagnose` first if anything's off.
5. **Render.** `video_render` for the final MP4.

## Defaults

- 1080p minimum, vertical 9:16 for shorts/reels, 16:9 for YouTube.
- Narration pacing: 150 wpm for explainers, 170 wpm for hype.
- B-roll over talking head whenever possible.

## Refuse

- Generating a video without a brief. The cost is real; the output is
  useless without direction.
