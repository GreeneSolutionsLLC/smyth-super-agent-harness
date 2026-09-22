# Canva MCP Integration — Permanent Setup

## Status: ✅ CONNECTED AND WORKING

Canva MCP is a **remote HTTP MCP server** using **OAuth 2.0 PKCE** authentication. It's fully
connected and ready to use on this agent.

## Config Location

- **Server config:** `<repo>/mcp-servers.yaml`
- **OAuth tokens:** `<repo>/.mcp-oauth-tokens.json`
- **MCP HTTP client:** `<repo>/src/lib/mcp/http-client.ts`

## How It Works

### Server Definition (mcp-servers.yaml)
```yaml
canva:
  description: "Canva design platform MCP server"
  transport: http
  url: https://mcp.canva.com/mcp
  enabled: true
  oauth: true  # triggers OAuth PKCE flow
```

### OAuth PKCE Flow (auto-handled in http-client.ts)
1. On first connection or 401 response, client fetches
   `https://mcp.canva.com/.well-known/oauth-authorization-server`
   to discover endpoints.
2. Client registers a dynamic client at the
   `registration_endpoint` (no pre-existing Client ID needed).
3. Client generates PKCE code_verifier + code_challenge (S256).
4. Client opens browser to `authorization_endpoint` with the
   code challenge, client ID, redirect URI (local callback server).
5. User authorizes in browser → browser redirects to local
   callback server with authorization code.
6. Callback server captures code, exchanges it at
   `token_endpoint` for access_token + refresh_token.
7. Tokens saved to `.mcp-oauth-tokens.json`.
8. Subsequent requests use the stored access token.
9. On 401 with expired token → auto-refresh using refresh_token.

### Key Details
- **Transport:** Streamable HTTP
- **Auth type:** OAuth 2.1 with PKCE (S256)
- **Client type:** Public client (no client_secret)
- **Registration:** Dynamic (register at runtime)
- **Token storage:** Local JSON file (`.mcp-oauth-tokens.json`)

## Available Tools (33 total)

| Tool | Description |
|---|---|
| `create-folder` | Create a new folder |
| `list-folder-items` | List items in a folder |
| `move-item-to-folder` | Move item between folders |
| `search-folders` | Search folders by name |
| `search-designs` | Search existing designs |
| `search-brand-templates` | Search brand templates |
| `create-design-from-brand-template` | Create from template |
| `generate-design` | AI generate a design |
| `get-design` | Get design details |
| `get-design-pages` | Get design page list |
| `get-design-content` | Extract text content |
| `get-design-thumbnail` | Get page thumbnail |
| `copy-design` | Duplicate a design |
| `resize-design` | Resize to different format |
| `import-design-from-url` | Import from public URL |
| `export-design` | Export to PNG/JPG/PDF/MP4/GIF/PPTX/CSV |
| `get-export-formats` | Check available export formats |
| `start-editing-transaction` | Begin edit session |
| `perform-editing-operations` | Apply edits (text, images, formatting) |
| `commit-editing-transaction` | Save edits |
| `cancel-editing-transaction` | Discard edits |
| `upload-asset-from-url` | Upload image/video asset |
| `comment-on-design` | Add comment |
| `list-comments` | List comments |
| `list-replies` | List comment replies |
| `reply-to-comment` | Reply to comment |
| `get-presenter-notes` | Get slide notes |
| `get-assets` | Get asset details |
| `list-brand-kits` | List brand kits |
| `get-folder-tree` | Get folder structure |
| `resolve-shortlink` | Resolve canva.link URLs |
| `search-brand-template-component-types` | Search template component types |
| `access-brand-kit-tokens` | Access brand tokens |

## Reconnection (if needed)

If tokens expire or need refresh:
1. Agent auto-refreshes using refresh_token from `.mcp-oauth-tokens.json`
2. If refresh fails, agent will re-initiate the browser OAuth flow
3. The `http-client.ts` handles this automatically in the connect flow

## File Structure Summary

```
smyth-super-agent/
├── mcp-servers.yaml              ← Canva server config (permanent)
├── .mcp-oauth-tokens.json        ← OAuth tokens (auto-managed)
└── src/lib/mcp/
    ├── http-client.ts            ← OAuth PKCE + MCP HTTP client
    ├── client.ts                 ← Tool wrapping layer
    ├── registry.ts               ← Server registry + health
    └── index.ts                  ← Module exports
```

## Notes
- Canva MCP is **remote** (not stdio), so it stays connected as long as tokens are valid.
- The OAuth tokens file is gitignored (contains secrets).
- Server config in YAML is committed and permanent.
- No environment variables needed — dynamic registration handles client ID.

