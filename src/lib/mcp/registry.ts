// ── MCP Server Registry ──
// Manages server configurations, health tracking, and tool caching.
// Inspired by lastmile-ai/mcp-agent's config + health monitor.

import { readFileSync, existsSync } from "fs";
import { join } from "path";

export type TransportType = "stdio" | "sse" | "websocket";

export interface MCPServerConfig {
  name: string;
  description: string;
  transport: TransportType;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  allowedTools?: string[];
}

export interface MCPServerStatus {
  name: string;
  connected: boolean;
  toolCount: number;
  lastError?: string;
  lastChecked?: Date;
}

export interface MCPTool {
  serverName: string;
  name: string;
  description: string;
  inputSchema: any;
}

export interface MCPToolCallResult {
  serverName: string;
  toolName: string;
  result: any;
  error?: string;
  durationMs: number;
}

class MCPServerRegistryImpl {
  private configs: Map<string, MCPServerConfig> = new Map();
  private status: Map<string, MCPServerStatus> = new Map();
  private toolCache: Map<string, MCPTool[]> = new Map();
  private loaded = false;

  /**
   * Load configuration from mcp-servers.yaml
   */
  loadConfig(configPath?: string): void {
    const path = configPath || join(process.cwd(), "mcp-servers.yaml");
    if (!existsSync(path)) {
      console.warn(`[mcp-registry] Config not found at ${path}, using defaults`);
      this.loaded = true;
      return;
    }

    try {
      const yaml = require("js-yaml");
      const raw = readFileSync(path, "utf-8");
      const config = yaml.load(raw) as any;

      if (config?.servers) {
        for (const [name, serverConfig] of Object.entries(config.servers) as [string, any]) {
          this.configs.set(name, {
            name,
            description: serverConfig.description || "",
            transport: serverConfig.transport || "stdio",
            command: serverConfig.command || "",
            args: serverConfig.args || [],
            env: serverConfig.env || {},
            enabled: serverConfig.enabled !== false,
            allowedTools: serverConfig.allowed_tools,
          });

          this.status.set(name, {
            name,
            connected: false,
            toolCount: 0,
          });
        }
      }

      this.loaded = true;
      console.log(`[mcp-registry] Loaded ${this.configs.size} server configs`);
    } catch (err: any) {
      console.error(`[mcp-registry] Failed to load config:`, err.message);
      this.loaded = true;
    }
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.loadConfig();
  }

  getServerConfig(name: string): MCPServerConfig | undefined {
    this.ensureLoaded();
    return this.configs.get(name);
  }

  getAllConfigs(): MCPServerConfig[] {
    this.ensureLoaded();
    return Array.from(this.configs.values());
  }

  getEnabledServers(): MCPServerConfig[] {
    return this.getAllConfigs().filter(s => s.enabled);
  }

  getServerStatus(name: string): MCPServerStatus | undefined {
    return this.status.get(name);
  }

  getConfig(name: string): MCPServerConfig | undefined {
    return this.configs.get(name);
  }

  getAllStatuses(): MCPServerStatus[] {
    return Array.from(this.status.values());
  }

  cacheTools(serverName: string, tools: MCPTool[]): void {
    this.toolCache.set(serverName, tools);
    // Ensure a status entry exists — some servers (HTTP-based ones like
    // canva, twenty) aren't in mcp-servers.yaml and are added dynamically
    // by the HTTP client. Without this, cacheTools silently no-ops for them.
    if (!this.status.has(serverName)) {
      this.status.set(serverName, {
        name: serverName,
        connected: false,
        toolCount: 0,
      });
    }
    const st = this.status.get(serverName);
    if (st) {
      st.toolCount = tools.length;
      st.connected = true;
      st.lastChecked = new Date();
    }
  }

  getCachedTools(serverName: string): MCPTool[] | undefined {
    return this.toolCache.get(serverName);
  }

  getAllCachedTools(): MCPTool[] {
    const all: MCPTool[] = [];
    for (const tools of this.toolCache.values()) {
      all.push(...tools);
    }
    return all;
  }

  recordError(serverName: string, error: string): void {
    const st = this.status.get(serverName);
    if (st) {
      st.lastError = error;
      st.lastChecked = new Date();
    }
  }
}

// Singleton
let _registry: MCPServerRegistryImpl | null = null;

export function getRegistry(): MCPServerRegistryImpl {
  if (!_registry) {
    _registry = new MCPServerRegistryImpl();
  }
  return _registry;
}

export const MCPServerRegistry = MCPServerRegistryImpl;
