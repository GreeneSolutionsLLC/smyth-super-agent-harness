# Canva MCP — Quick Reference for Smyth

## Connected: YES ✅
Server: https://mcp.canva.com/mcp (remote HTTP + OAuth PKCE)
Tokens: stored in .mcp-oauth-tokens.json
Config: mcp-servers.yaml (oauth: true)

## How to Initialize
- Call http-client.ts's `discoverAndCreateHandlers()` which loads
  all HTTP server configs, including Canva.
- OAuth flow is automatic — tokens persist between sessions.
- If token is expired, `refreshOAuthToken()` handles it.
- If refresh fails, agent re-initiates browser OAuth flow.

## 33 Tools Available
Key tools: create-folder, search-designs, search-brand-templates,
create-design-from-brand-template, generate-design, get-design,
export-design, perform-editing-operations, upload-asset-from-url,
resize-design, import-design-from-url, comment-on-design.

## Full Documentation
See docs/CANVA_MCP_SETUP.md
