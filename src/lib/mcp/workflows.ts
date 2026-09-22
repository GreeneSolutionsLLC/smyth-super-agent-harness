// ── MCP Workflow Adapters ──
// Higher-level workflow functions that combine multiple MCP tools
// for common tasks.

import { callHttpTool } from "./http-client"

/**
 * Thin wrapper around the native HTTP MCP tool caller.
 * Kept as callMCPTool for compatibility with existing workflow code.
 */
async function callMCPTool(serverName: string, toolName: string, args: Record<string, any> = {}) {
  const result = await callHttpTool(serverName, toolName, args)
  return typeof result === "string" ? JSON.parse(result) : result
}

/**
 * Canva Workflow: Create a design from a brand template.
 * 1. Search templates matching the query
 * 2. Pick the best match
 * 3. Create a design from it
 * Returns the design ID and URL.
 */
export async function canvaCreateDesignFromTemplate(query: string, templateIndex = 0) {
  const searchResult = await callMCPTool("canva", "search-brand-templates", { query })
  const templates = searchResult?.items || []
  if (templates.length === 0) throw new Error(`No Canva brand templates found for: ${query}`)
  const template = templates[Math.min(templateIndex, templates.length - 1)]
  const createResult = await callMCPTool("canva", "create-design-from-brand-template", {
    brand_template_id: template.id,
  })
  return createResult
}

/**
 * Canva Workflow: Export a design as a specific format.
 * First checks which formats are available, then exports.
 */
export async function canvaExportDesign(
  designId: string,
  format: "pdf" | "png" | "jpg" | "gif" | "pptx" | "mp4" | "csv"
) {
  const formats = await callMCPTool("canva", "get-export-formats", { design_id: designId })
  const exportResult = await callMCPTool("canva", "export-design", {
    design_id: designId,
    format: { type: format },
  })
  return exportResult
}

/**
 * Canva Workflow: Find and edit text in a design.
 * Uses start-editing-transaction → perform-editing-operations → commit-editing-transaction.
 */
export async function canvaFindAndReplace(
  designId: string,
  elementId: string,
  findText: string,
  replaceText: string
) {
  const tx = await callMCPTool("canva", "start-editing-transaction", { design_id: designId })
  const transactionId = (tx as any).transaction_id
  if (!transactionId) throw new Error("Failed to start editing transaction")
  await callMCPTool("canva", "perform-editing-operations", {
    transaction_id: transactionId,
    operations: [{ type: "find_and_replace_text", element_id: elementId, find_text: findText, replace_text: replaceText }],
    page_index: 1,
  })
  const commit = await callMCPTool("canva", "commit-editing-transaction", { transaction_id: transactionId })
  return commit
}

/**
 * Canva Workflow: Upload an image from a URL and insert into a design.
 */
export async function canvaUploadAndInsertImage(
  imageUrl: string,
  name: string,
  designId: string,
  pageId: string
) {
  const upload = await callMCPTool("canva", "upload-asset-from-url", {
    url: imageUrl,
    name,
  })
  const assetId = (upload as any).asset?.id
  if (!assetId) throw new Error("Failed to upload asset")
  const tx = await callMCPTool("canva", "start-editing-transaction", { design_id: designId })
  const transactionId = (tx as any).transaction_id
  await callMCPTool("canva", "perform-editing-operations", {
    transaction_id: transactionId,
    operations: [{ type: "insert_fill", page_id: pageId, asset_type: "image", asset_id: assetId, alt_text: name }],
    page_index: 1,
  })
  return callMCPTool("canva", "commit-editing-transaction", { transaction_id: transactionId })
}
