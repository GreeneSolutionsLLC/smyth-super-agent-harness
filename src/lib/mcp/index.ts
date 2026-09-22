// ── MCP Module ──
// Unified exports for the MCP integration layer.
// Inspired by lastmile-ai/mcp-agent's composable architecture.

// Registry — server configuration and health tracking
export {
  MCPServerRegistry,
  getRegistry,
  type MCPServerConfig,
  type MCPServerStatus,
  type MCPTool,
  type MCPToolCallResult,
  type TransportType,
} from "./registry";

// Client — tool discovery and calling
export {
  discoverServerTools,
  discoverAllTools,
  getAllTools,
  callTool,
  callToolAuto,
  callToolsParallel,
  callToolsSequential,
  toOpenAITools,
  createMCPToolHandlers,
} from "./client";

// Workflows — Canva/OpenPencil MCP helper workflows
export {
  canvaCreateDesignFromTemplate,
  canvaExportDesign,
  canvaFindAndReplace,
  canvaUploadAndInsertImage,
} from "./workflows";

// Tools — MCP tool definitions for the main tool registry
export {
  mcpTools,
} from "./tools";

// Merge — helper to integrate MCP tools with other tool arrays
export {
  mergeMCPTools,
  getMCPTools,
} from "./merge";
