# OpenPencil MCP — Complete Setup Guide

> How to connect any agent (Smyth, Rook, or future agents) to the OpenPencil
> desktop design app via MCP. This doc covers the full chain, what broke, and
> how to replicate it cleanly.

---

## Architecture (End-to-End)

```
Agent (Smyth/Rook)
  ↓ calls bridge.py via execSync
MCP Bridge (Python, stdio)
  ↓ spawns: openpencil-mcp (stdio binary)
OpenPencil MCP Server (Node.js)
  ↓ HTTP :7600 (MCP protocol)
  ↓ WS   :7601 (app ↔ server link)
OpenPencil Desktop App (Tauri)
  ↕ renders canvas, executes tool calls
```

**Key insight:** The OpenPencil **desktop app starts its own MCP server**.
You do NOT need a separate LaunchAgent or daemon. Just open the app.

---

## Prerequisites

### 1. OpenPencil Desktop App
- **Location:** `/Applications/OpenPencil.app`
- **Version:** 0.13.2 (at time of writing)
- The app is a Tauri (Rust + WebView) desktop application
- On launch, it starts:
  - HTTP MCP server on `127.0.0.1:7600`
  - WebSocket server on `127.0.0.1:7601`
  - Unix socket at `/tmp/net_dannote_open_pencil_si.sock`
- The app auto-connects to its own MCP server via WebSocket

### 2. OpenPencil MCP CLI (stdio binary)
```bash
npm i -g @open-pencil/mcp@0.13.2
```
- Installs `openpencil-mcp` to your global npm bin
- Binary: `~/.hermes/node/bin/openpencil-mcp` (symlink to `dist/stdio.mjs`)
- This is the stdio bridge that agents spawn to talk to the MCP server

### 3. MCP Bridge (Python)
- **Bridge script:** `~/.openclaw/skills/mcp-agent/bridge.py`
- **Python venv:** `~/.openclaw/venvs/mcp/`
- Activate: `source ~/.openclaw/venvs/mcp/bin/activate`
- The bridge spawns the stdio binary, discovers tools, and relays tool calls

### 4. Agent Config (mcp-servers.yaml)
Each agent needs an entry in its `mcp-servers.yaml`:

```yaml
openpencil:
  description: OpenPencil design canvas MCP server
  transport: stdio
  command: /path/to/openpencil-mcp
  enabled: true
```

- `transport: stdio` — the bridge spawns the binary as a subprocess
- `command:` — absolute path to the `openpencil-mcp` binary
- `enabled: true` — picked up by `discoverStdioTools()` in the agent's tool loader

---

## Setup Steps (Clean Install)

### Step 1: Install OpenPencil
Download and install OpenPencil to `/Applications/`. Verify:
```bash
ls /Applications/OpenPencil.app
plutil -p /Applications/OpenPencil.app/Contents/Info.plist | grep CFBundleShortVersionString
```

### Step 2: Install the MCP CLI
```bash
npm i -g @open-pencil/mcp@0.13.2
which openpencil-mcp   # should print the path
```

### Step 3: Verify the Bridge
```bash
source ~/.openclaw/venvs/mcp/bin/activate
python3 ~/.openclaw/skills/mcp-agent/bridge.py openpencil list_tools 2>&1 | grep -c '"name"'
# Should print: 106
```

### Step 4: Open the App
```bash
open -a OpenPencil
# Wait for MCP server to come up
curl -s http://127.0.0.1:7600/health | python3 -m json.tool
# Should show: {"status": "ok", ...}
```

### Step 5: Add to Agent's mcp-servers.yaml
```yaml
openpencil:
  description: OpenPencil design canvas MCP server
  transport: stdio
  command: /path/to/openpencil-mcp
  enabled: true
```

### Step 6: Restart the Agent
The agent caches tools for 10 minutes (`TOOL_CACHE_TTL`). Restart the dev
server to force immediate re-discovery:
```bash
# Kill the Next.js dev server, then restart
npm run dev
```

### Step 7: Verify Tool Discovery
In the agent's console, look for:
```
[tools] Discovered 106 MCP stdio tools
```

---

## Verification (End-to-End Test)

```bash
# 1. Health check
curl -s http://127.0.0.1:7600/health | python3 -m json.tool
# Expect: {"status": "ok", ...}

# 2. List tools via bridge
source ~/.openclaw/venvs/mcp/bin/activate
python3 ~/.openclaw/skills/mcp-agent/bridge.py openpencil list_tools 2>&1 | grep -c '"name"'
# Expect: 106

# 3. Create a shape
python3 ~/.openclaw/skills/mcp-agent/bridge.py openpencil call_tool openpencil_create_shape \
  '{"type":"RECTANGLE","x":100,"y":100,"width":200,"height":150,"name":"Test Box"}'

# 4. Set fill color
python3 ~/.openclaw/skills/mcp-agent/bridge.py openpencil call_tool openpencil_set_fill \
  '{"id":"0:3","color":"#4A90D9"}'

# 5. Add text
python3 ~/.openclaw/skills/mcp-agent/bridge.py openpencil call_tool openpencil_create_shape \
  '{"type":"TEXT","x":120,"y":150,"width":160,"height":50,"name":"Label"}'
python3 ~/.openclaw/skills/mcp-agent/bridge.py openpencil call_tool openpencil_set_text \
  '{"id":"0:4","text":"Hello from Smyth!"}'

# 6. Export
python3 ~/.openclaw/skills/mcp-agent/bridge.py openpencil call_tool openpencil_export_image \
  '{"path":"openpencil_test.png"}'
```

---

## What Broke (And Why)

### Problem: LaunchAgent Conflict
A `com.openpencil.mcp-http` LaunchAgent was starting an MCP HTTP server on
port 7600 *before* the OpenPencil app launched. When the app tried to start
its own MCP server on the same port, it couldn't bind (port in use).

**Symptoms:**
- `curl http://127.0.0.1:7600/health` returned `{"status": "no_app"}`
- 106 tools were discovered but all tool calls failed with "app not connected"
- The app's WebSocket client couldn't connect to its own MCP server

**Root cause:** Two MCP servers fighting over port 7600. The LaunchAgent
server had no app connection. The app's built-in server couldn't start.

**Fix:** Remove the LaunchAgent. The app starts its own MCP server.
```bash
launchctl unload ~/Library/LaunchAgents/com.openpencil.mcp-http.plist
mv ~/Library/LaunchAgents/com.openpencil.mcp-http.plist \
   ~/Library/LaunchAgents/com.openpencil.mcp-http.plist.bak
```

### Problem: Health Check Returns "no_app"
This means the MCP HTTP server is running but the OpenPencil desktop app
isn't connected to it via WebSocket.

**Possible causes:**
1. The app isn't running → `open -a OpenPencil`
2. A stale MCP server is running (from LaunchAgent) → kill it, restart app
3. The app crashed → check `ps aux | grep OpenPencil`

**Fix:**
```bash
# Kill everything and restart clean
launchctl unload ~/Library/LaunchAgents/com.openpencil.mcp-http.plist 2>/dev/null
killall OpenPencil 2>/dev/null
sleep 2
open -a OpenPencil
sleep 5
curl -s http://127.0.0.1:7600/health | python3 -m json.tool
# Should show status: "ok"
```

---

## How It Works (Technical Detail)

### The Connection Chain

1. **OpenPencil app launches** → starts MCP HTTP server on :7600 + WS on :7601
2. **App connects to its own WS** → sends `{"type":"register","token":"..."}` to :7601
3. **MCP server marks app as connected** → health endpoint returns `{"status":"ok"}`
4. **Agent starts** → `discoverStdioTools()` reads `mcp-servers.yaml`
5. **Bridge spawns `openpencil-mcp`** (stdio binary) → connects to MCP server on :7600
6. **MCP server proxies tool calls** → sends them to the app via WebSocket
7. **App executes** → draws shapes, sets colors, exports images, etc.

### Auth Token
The app's MCP server generates a random auth token on startup. The stdio
binary (`openpencil-mcp`) auto-discovers this token — you don't need to
configure it manually. The token is passed through the bridge transparently.

### Tool Cache
Smyth caches discovered tools for 10 minutes (`TOOL_CACHE_TTL = 10 * 60 * 1000`).
After adding OpenPencil to `mcp-servers.yaml`, restart the dev server or wait
10 minutes for tools to appear.

### Available Tools (106 total)

| Category | Example Tools |
|---|---|
| **Shapes** | `create_shape`, `create_vector`, `set_fill`, `set_stroke`, `set_radius`, `set_opacity` |
| **Text** | `set_text`, `set_font`, `set_text_properties`, `list_fonts`, `list_available_fonts` |
| **Layout** | `set_layout`, `set_layout_child`, `set_constraints`, `arrange`, `group_nodes` |
| **Boolean** | `boolean_union`, `boolean_subtract`, `boolean_intersect`, `boolean_exclude` |
| **Components** | `create_component`, `create_instance`, `node_to_component`, `get_components` |
| **Variables** | `create_variable`, `set_variable`, `bind_variable`, `list_variables` |
| **Pages** | `create_page`, `list_pages`, `switch_page`, `get_page_tree` |
| **Export** | `export_image`, `export_pdf`, `export_svg`, `render` |
| **Analysis** | `analyze_colors`, `analyze_typography`, `analyze_spacing`, `describe` |
| **Code** | `get_jsx`, `diff_jsx`, `get_codegen_prompt`, `design_to_tokens` |
| **Navigation** | `get_selection`, `find_nodes`, `query_nodes`, `node_tree`, `node_bounds` |
| **File** | `open_file`, `save_file`, `new_document` |
| **Icons** | `search_icons`, `fetch_icons`, `insert_icon` |
| **Viewport** | `viewport_get`, `viewport_set`, `viewport_zoom_to_fit` |

---

## Quick Start (TL;DR)

```bash
# 1. Open OpenPencil
open -a OpenPencil

# 2. Wait for MCP server
sleep 5 && curl -s http://127.0.0.1:7600/health | python3 -m json.tool
# Expect: {"status": "ok", ...}

# 3. Verify tools
source ~/.openclaw/venvs/mcp/bin/activate
python3 ~/.openclaw/skills/mcp-agent/bridge.py openpencil list_tools 2>&1 | grep -c '"name"'
# Expect: 106

# 4. Restart your agent's dev server to pick up the tools
```

---

## Adding to a New Agent

To replicate this on any new agent:

1. **Ensure `mcp-servers.yaml` has the openpencil entry** (see Step 5 above)
2. **Ensure the bridge + venv exist** at `~/.openclaw/skills/mcp-agent/bridge.py`
3. **Ensure the agent's tool loader calls `discoverStdioTools()`** (see `src/lib/mcp/tools.ts`)
4. **Open the OpenPencil app** before starting the agent
5. **Restart the agent** to trigger tool discovery

That's it. No LaunchAgent, no manual server start, no auth config.
The app handles everything.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `status: "no_app"` | App not running or stale MCP server | Restart app, remove LaunchAgent |
| 0 tools discovered | Bridge can't find binary or venv | Check paths, reinstall MCP CLI |
| Tool calls fail with "app not connected" | App crashed or MCP server stale | Restart app |
| Port 7600 in use | LaunchAgent or stale process | `lsof -i :7600`, kill it |
| `authRequired: false` | Standalone MCP server (no app) | Kill it, let app start its own |
| `authRequired: true` | App's MCP server (correct) | All good, tools will work |

---

*Last updated: 2026-08-02*
*Tested with: OpenPencil 0.13.2, @open-pencil/mcp 0.13.2, Smyth Super Agent*