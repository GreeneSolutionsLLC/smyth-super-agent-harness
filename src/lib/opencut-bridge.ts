"use client";

// ── OpenCut iframe ref bridge ──
//
// Stores a reference to the OpenCut iframe element so other components
// can access it. The actual server→browser bridge is handled by
// use-opencut-bridge.ts (polling /api/opencut/eval) and the eval
// listener in OpenCut's editor-provider.tsx.

let iframeRef: HTMLIFrameElement | null = null;

export function setIframeRef(ref: HTMLIFrameElement | null) {
  iframeRef = ref;
}

export function getIframeRef(): HTMLIFrameElement | null {
  return iframeRef;
}