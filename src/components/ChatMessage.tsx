"use client";

/**
 * ChatMessage — renders a single chat bubble with light markdown support.
 *
 * Converts: **bold**, *italic*, `inline code`, - bullet lists, code blocks.
 * No external dependency. Keeps whitespace-pre-wrap for proper spacing.
 */

import React, { Fragment } from "react";

// ── Very lightweight inline markdown parser ──
// Splits text into segments based on markdown patterns

type Segment =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string }
  | { type: "bullet"; text: string }
  | { type: "image"; alt: string; url: string }
  | { type: "link"; text: string; url: string }
  | { type: "linebreak" };

function parseInlineMarkdown(text: string): Segment[] {
  const segments: Segment[] = [];
  // Process line by line to handle bullet lists
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks are handled by parent component
    // Bullet check
    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      segments.push({ type: "bullet", text: bulletMatch[1] });
      if (i < lines.length - 1) segments.push({ type: "linebreak" });
      continue;
    }

    // Parse inline formatting within the line
    let remaining = line;
    while (remaining.length > 0) {
      // Markdown image (![alt](url))
      const imgMatch = remaining.match(/!\[([^\]]*)\]\(([^)\s]+)\)/);
      // Markdown link ([text](url))
      const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)\s]+)\)/);
      // Inline code (`code`)
      const codeMatch = remaining.match(/`([^`]+)`/);
      // Bold (**text**)
      const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);
      // Italic (*text*)
      const italicMatch = remaining.match(/(?<!\*)\*([^*]+)\*(?!\*)/);

      // Find the earliest match
      const matches: Array<{ index: number; type: Segment["type"]; text: string; url?: string; length: number }> = [];
      if (imgMatch) matches.push({ index: imgMatch.index!, type: "image", text: imgMatch[1], url: imgMatch[2], length: imgMatch[0].length });
      if (linkMatch) matches.push({ index: linkMatch.index!, type: "link", text: linkMatch[1], url: linkMatch[2], length: linkMatch[0].length });
      if (codeMatch) matches.push({ index: codeMatch.index!, type: "code", text: codeMatch[1], length: codeMatch[0].length });
      if (boldMatch) matches.push({ index: boldMatch.index!, type: "bold", text: boldMatch[1], length: boldMatch[0].length });
      if (italicMatch) matches.push({ index: italicMatch.index!, type: "italic", text: italicMatch[1], length: italicMatch[0].length });

      if (matches.length === 0) {
        // No more formatting — emit rest as text
        segments.push({ type: "text", text: remaining });
        break;
      }

      // Pick the earliest match
      matches.sort((a, b) => a.index - b.index);
      const match = matches[0];

      // Text before the match
      if (match.index > 0) {
        segments.push({ type: "text", text: remaining.slice(0, match.index) });
      }
      if (match.type === "image") {
        segments.push({ type: "image", alt: match.text, url: match.url || "" });
      } else if (match.type === "link") {
        segments.push({ type: "link", text: match.text, url: match.url || "" });
      } else {
        segments.push({ type: match.type as any, text: match.text });
      }
      remaining = remaining.slice(match.index + match.length);
    }

    if (i < lines.length - 1) segments.push({ type: "linebreak" });
  }

  return segments;
}

// ── Inline renderer ──

function InlineContent({ text }: { text: string }) {
  const segments = parseInlineMarkdown(text);

  return (
    <>
      {segments.map((seg, i) => {
        switch (seg.type) {
          case "bold":
            return <strong key={i} className="font-semibold text-foreground">{seg.text}</strong>;
          case "italic":
            return <em key={i} className="italic">{seg.text}</em>;
          case "code":
            return (
              <code key={i} className="bg-muted-bg text-accent px-1 py-0.5 rounded text-[0.9em] font-mono">
                {seg.text}
              </code>
            );
          case "bullet":
            return (
              <span key={i} className="block">
                <span className="inline-block w-4 text-muted shrink-0 select-none">•</span>
                <InlineContent text={seg.text} />
              </span>
            );
          case "linebreak":
            return <br key={i} />;
          case "image":
            return (
              <div key={i} className="my-2">
                <img src={(seg as any).url} alt={(seg as any).text} className="w-full rounded-lg border border-border max-h-96 object-contain bg-black/20" />
                <a href={(seg as any).url} target="_blank" className="mt-1 inline-block text-xs text-accent hover:underline">
                  {(seg as any).text || "Open image"} ↗
                </a>
              </div>
            );
          case "link":
            return (
              <a key={i} href={(seg as any).url} target="_blank" className="text-accent hover:underline">
                {(seg as any).text}
              </a>
            );
          case "text":
            // Check for bare URLs in text segments
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const urlParts: { t: string; isUrl: boolean; isImg: boolean }[] = [];
            let lastIdx = 0;
            let uMatch;
            while ((uMatch = urlRegex.exec(seg.text)) !== null) {
              if (uMatch.index > lastIdx) {
                urlParts.push({ t: seg.text.slice(lastIdx, uMatch.index), isUrl: false, isImg: false });
              }
              const fullUrl = uMatch[1];
              const isImage = /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(fullUrl) || fullUrl.includes("replicate.delivery");
              urlParts.push({ t: fullUrl, isUrl: true, isImg: isImage });
              lastIdx = uMatch.index + fullUrl.length;
            }
            if (lastIdx < seg.text.length) {
              urlParts.push({ t: seg.text.slice(lastIdx), isUrl: false, isImg: false });
            }
            if (urlParts.length > 0) {
              return <Fragment key={i}>{urlParts.map((p, pi) => {
                if (p.isImg) {
                  return <div key={pi} className="my-2"><img src={p.t} alt="" className="w-full rounded-lg border border-border max-h-96 object-contain bg-black/20" /><a href={p.t} target="_blank" className="mt-1 inline-block text-xs text-accent hover:underline">Open image ↗</a></div>;
                }
                if (p.isUrl) {
                  return <a key={pi} href={p.t} target="_blank" className="text-accent hover:underline">{p.t}</a>;
                }
                return <Fragment key={pi}>{p.t}</Fragment>;
              })}</Fragment>;
            }
            return <Fragment>{(seg as any).text}</Fragment>;
          default:
            return <Fragment key={i}>{(seg as any).text}</Fragment>;
        }
      })}
    </>
  );
}

// ── Block-level: splits code blocks from prose ──

interface ChatMessageProps {
  content: string;
}

export function ChatMessage({ content }: ChatMessageProps) {
  // Split into code blocks and prose
  const parts: Array<{ type: "code"; language: string; code: string } | { type: "prose"; text: string }> = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Prose before this code block
    const before = content.slice(lastIndex, match.index);
    if (before.trim()) {
      parts.push({ type: "prose", text: before });
    }
    parts.push({ type: "code", language: match[1] || "", code: match[2] });
    lastIndex = match.index + match[0].length;
  }

  // Remaining prose after last code block
  const after = content.slice(lastIndex);
  if (after.trim()) {
    parts.push({ type: "prose", text: after });
  }

  // If no code blocks at all, fast path
  if (parts.length === 0) {
    return (
      <div className="whitespace-pre-wrap text-sm leading-relaxed">
        <InlineContent text={content} />
      </div>
    );
  }

  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed">
      {parts.map((part, i) => {
        if (part.type === "code") {
          return (
            <pre key={i} className="bg-muted-bg border border-border rounded-lg p-3 my-2 overflow-x-auto text-sm font-mono leading-relaxed">
              <code>{part.code}</code>
            </pre>
          );
        }
        return <InlineContent key={i} text={part.text} />;
      })}
    </div>
  );
}
