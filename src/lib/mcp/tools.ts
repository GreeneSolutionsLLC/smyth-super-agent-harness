// ── MCP Tool Definitions ──
// Individual MCP tools are discovered at startup via discoverStdioTools() and
// discoverAndCreateHandlers(). The generic wrappers below are kept as empty array
// because the individual tools (mcp_openpencil_render, mcp_filesystem_read_file, etc.) 
// are better — they have proper parameter schemas and direct handlers.
// The discovery functions and mcp_* helper functions are still exported below.

import type { ToolHandler } from "@/lib/tools";

export const mcpTools: ToolHandler[] = [];

export async function discoverStdioTools(): Promise<{
  tools: any[];
  handlers: Map<string, (args: Record<string, any>) => Promise<string>>;
}> {
  const { readFileSync, existsSync } = await import("fs");
  const { join } = await import("path");
  const { execSync } = await import("child_process");
  const { homedir } = await import("os");
  const yaml = await import("js-yaml");
  
  const configPath = join(process.cwd(), "mcp-servers.yaml");
  if (!existsSync(configPath)) return { tools: [], handlers: new Map() };

  const rawYaml = readFileSync(configPath, "utf-8");
  // Replace ${VAR} placeholders so disabled servers don't break YAML parsing at build time.
  const substitutedYaml = rawYaml.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_match: string, varName: string) => process.env[varName] ?? "");
  const config = yaml.load(substitutedYaml) as any;
  const servers = config?.servers || {};
  
  // Try multiple bridge locations: OpenClaw install, then bundled fallback
  const bridgeCandidates = [
    `${homedir()}/.openclaw/skills/mcp-agent/bridge.py`,
    join(process.cwd(), "bridge.py"),
  ];
  const venvCandidates = [
    `${homedir()}/.openclaw/venvs/mcp/bin/activate`,
    join(process.cwd(), "venv", "bin", "activate"),
  ];
  
  let bridgePath: string | null = null;
  let venvActivate: string | null = null;
  for (const bp of bridgeCandidates) {
    if (existsSync(bp)) { bridgePath = bp; break; }
  }
  for (const va of venvCandidates) {
    if (existsSync(va)) { venvActivate = va; break; }
  }
  
  const allTools: any[] = [];
  const handlers = new Map<string, (args: Record<string, any>) => Promise<string>>();
  
  for (const [name, s] of Object.entries(servers)) {
    const srv = s as any;
    if (!srv.enabled) continue;
    
    // Skip HTTP servers (handled by http-client)
    if (srv.transport === "http" || srv.transport === "sse") continue;
    
    // Skip if no bridge available
    if (!bridgePath || !venvActivate) {
      console.warn(`[mcp-stdio] No bridge available, skipping server "${name}"`);
      continue;
    }
    
    try {
      // 2026-09-09: raised 2s → 20s. This runs in BACKGROUND discovery
      // (discoverMcpInBackground), so it never blocks the user's chat. The old
      // 2s timeout silently skipped every stdio server — the macos-mcp bundle
      // alone takes ~6s to cold-start (Python + pyobjc imports), so nothing was
      // ever discovered. 20s covers cold npx downloads too.
      const cmd = `source ${venvActivate} && python3 ${bridgePath} ${name} list_tools 2>/dev/null`;
      let rawOutput: string;
      try {
        rawOutput = execSync(cmd, { encoding: "utf-8", timeout: 20000, shell: "/bin/zsh" });
      } catch {
        // Server didn't respond in 20s — skip it (will retry on next process restart)
        console.warn(`[mcp-stdio] "${name}" list_tools timed out or failed — skipping (retries on next restart)`);
        continue;
      }
      const jsonStart = rawOutput.indexOf("[");
      const jsonEnd = rawOutput.lastIndexOf("]");
      if (jsonStart < 0 || jsonEnd <= jsonStart) continue;
      
      const tools = JSON.parse(rawOutput.substring(jsonStart, jsonEnd + 1));
      
      for (const tool of tools) {
        // 2026-09-09: the bridge already prefixes tool names with the server
        // name (e.g. "macos_App"), which produced doubled keys like
        // mcp_macos_macos_App. Strip the redundant "${name}_" prefix so tool
        // names read mcp_macos_App. call_tool below still uses the ORIGINAL
        // bridge name (tool.name) — only the exposed key is normalized.
        const baseName = tool.name.startsWith(`${name}_`) ? tool.name.slice(name.length + 1) : tool.name;
        const handlerKey = `mcp_${name}_${baseName}`;
        const toolDef = {
          type: "function" as const,
          function: {
            name: handlerKey,
            description: `[MCP:${name}] ${tool.description || tool.name}`,
            parameters: tool.inputSchema || { type: "object", properties: {} },
          },
        };
        allTools.push(toolDef);
        
        // Create handler that calls the bridge
        const serverName = name;
        const toolName = tool.name;
        handlers.set(handlerKey, async (args: Record<string, any>) => {
          if (!bridgePath || !venvActivate) {
            return `Error: MCP bridge not available for ${serverName}/${toolName}`;
          }
          try {
            const { execSync } = await import("child_process");
            const escapedArgs = JSON.stringify(args).replace(/'/g, "'\\''");
            const cmd = `source ${venvActivate} && python3 ${bridgePath} ${serverName} call_tool ${toolName} '${escapedArgs}' 2>/dev/null`;
            const rawOutput = execSync(cmd, { encoding: "utf-8", timeout: 60000, shell: "/bin/zsh" });
            
            // Parse the result — bridge returns JSON with content array
            const lines = rawOutput.split("\n");
            let jsonResult: any = null;
            let braceDepth = 0;
            let jsonStart = -1;
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim();
              if (line.startsWith("{") && braceDepth === 0) jsonStart = i;
              if (jsonStart >= 0) {
                for (const ch of lines[i]) {
                  if (ch === "{") braceDepth++;
                  else if (ch === "}") braceDepth--;
                }
                if (braceDepth === 0 && jsonStart >= 0) {
                  const jsonStr = lines.slice(jsonStart, i + 1).join("\n");
                  try { jsonResult = JSON.parse(jsonStr); } catch {}
                  break;
                }
              }
            }
            
            if (jsonResult?.content) {
              const texts = jsonResult.content.filter((c: any) => c.type === "text").map((c: any) => c.text);
              return texts.join("\n") || JSON.stringify(jsonResult);
            }
            return typeof jsonResult === "string" ? jsonResult : (rawOutput.split("\n").filter((l: string) => !l.startsWith("[INFO]")).join("\n").trim() || "No result");
          } catch (e: any) {
            return `Error calling MCP tool ${toolName} on ${serverName}: ${e.message}`;
          }
        });
      }
      
      console.log(`[mcp-stdio] Discovered ${tools.length} tools from "${name}"`);
    } catch (e: any) {
      console.error(`[mcp-stdio] Failed to discover tools from "${name}": ${e.message}`);
    }
  }
  
  return { tools: allTools, handlers };
}
