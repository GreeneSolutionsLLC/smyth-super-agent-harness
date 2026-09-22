# macOS-MCP Integration for Smyth

**Added:** 2026-09-08  
**Source:** https://github.com/CursorTouch/MacOS-MCP  
**Location:** `vendor/macos-mcp` (git submodule)

---

## What It Does

Gives the Smyth agent **full control of the Mac** via the Accessibility API:

| Tool | What it does |
|------|-----------|
| **App** | Launch, resize, move, switch applications |
| **Shell** | Execute shell commands and AppleScript |
| **Snapshot** | Capture desktop state (windows, buttons, text fields, coordinates) |
| **Click** | Mouse clicks at coordinates (left/right/middle, single/double) |
| **Type** | Type text at coordinates with optional clear/enter |
| **Scroll** | Scroll vertically/horizontally |
| **Move** | Move mouse cursor, drag-and-drop |
| **Shortcut** | Keyboard shortcuts (command+c, command+space, etc.) |
| **Wait** | Pause execution for UI animations |
| **Scrape** | Fetch URL content |
| **Desktop** | Create Mission Control virtual desktops |
| **Notification** | Send macOS notification banners |

---

## Setup

### 1. Permissions Required

macOS-MCP needs **Accessibility** and **Screen Recording** permissions:

```bash
# Open System Settings to grant permissions
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
```

Add these to Accessibility:
- Your terminal (Terminal, iTerm2, VS Code)
- Python (`~/.cache/uv/archive-v0/*/bin/python`)
- UV (`~/.local/bin/uv`)

Add the same to **Screen Recording** for the Snapshot tool.

### 2. Running

**Via Smyth (stdio transport):**
Already configured in `mcp-servers.yaml`. The Smyth MCP client spawns it automatically when the agent calls a macOS tool.

**Standalone for testing:**
```bash
cd <repo>
uvx --from ./vendor/macos-mcp macos-mcp serve --transport stdio
```

**As a background service:**
```bash
uvx --from ./vendor/macos-mcp macos-mcp install
# Logs: ~/.macos-mcp/server.log
```

**HTTP transport (for remote agents):**
```bash
uvx --from ./vendor/macos-mcp macos-mcp serve --transport sse --host 127.0.0.1 --port 8000
```

---

## Usage Examples

**Agent prompt:** *"Open Safari and go to apple.com"*
```
1. App(mode="launch", name="Safari")
2. Wait(duration=2)
3. Shortcut(shortcut="command+l")
4. Type(loc=[500, 100], text="apple.com", press_enter=True)
```

**Agent prompt:** *"Take a screenshot of what's on my screen"*
```
1. Snapshot(use_vision=True)
```

**Agent prompt:** *"Create a new desktop space"*
```
1. Desktop(mode="create")
```

---

## Configuration

Edit `mcp-servers.yaml`:

```yaml
macos:
  description: Native macOS automation
  transport: stdio
  command: uvx
  args:
    - --from
    - ./vendor/macos-mcp
    - macos-mcp
    - --transport
    - stdio
  enabled: true
```

To disable: set `enabled: false`

---

## Security Notes

- **Shell tool** executes with the same permissions as the Smyth app
- **Accessibility API** can read all UI elements and simulate input
- **Screen Recording** captures full screen content
- All actions are logged by macOS-MCP to `~/.macos-mcp/` when running as service

---

## Updating

```bash
cd <repo>
git submodule update --remote vendor/macos-mcp
```

Current version: v0.4.0-16-g4ab71ac
