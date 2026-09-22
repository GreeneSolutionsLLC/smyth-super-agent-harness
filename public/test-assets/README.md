# Test assets

- `clip2.mp4` — 15.0 second 720x1280 H.264 30fps 450-frame test video.
  Used by the opencut MCP tools and the agent for end-to-end testing.
  Re-encode from any source with:
    ffmpeg -i input.mp4 -t 15 -c:v libx264 -preset ultrafast -crf 28 \
      -pix_fmt yuv420p -r 30 -an clip2.mp4
