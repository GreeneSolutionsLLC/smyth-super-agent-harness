"use client";

import { useState, useEffect, useRef } from "react";
import { Send, Circle, ExternalLink } from "lucide-react";
import {
  isVelornConnected,
  callVelornTool,
  listVelornTools,
  createProject,
  importAsset,
  addClipToTimeline,
  setPlayhead,
} from "@/lib/velorn-mcp";

interface Message {
  role: "user" | "agent";
  text: string;
  timestamp: number;
}

export default function VideographyChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [tools, setTools] = useState<string[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Poll Smyth Cuts connection
  useEffect(() => {
    const check = async () => {
      const ok = await isVelornConnected();
      setConnected(ok);
      if (ok && tools.length === 0) {
        const t = await listVelornTools();
        setTools(t);
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [tools.length]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const addMessage = (role: "user" | "agent", text: string) => {
    setMessages((prev) => [...prev, { role, text, timestamp: Date.now() }]);
  };

  const processCommand = async (text: string) => {
    const lower = text.toLowerCase();

    // Create project
    if (lower.includes("create project") || lower.includes("new project")) {
      addMessage("agent", "Creating project in Smyth Cuts...");
      const nameMatch = text.match(/(?:named?|called?)\s+["']?([^"']+)["']?/i);
      const projectName = nameMatch ? nameMatch[1] : "Smyth Project";
      const result = await createProject(projectName);
      const resultText = result.content?.[0]?.text || "Done";
      addMessage("agent", `Project created: ${resultText}`);
      return;
    }

    // Import asset
    if (lower.includes("import") || lower.includes("add clip")) {
      const pathMatch = text.match(/(?:from|file|path)\s+["']?([^\s"']+\.\w{2,4})["']?/i);
      if (!pathMatch) {
        addMessage("agent", "Please provide a file path. Example: import /Users/you/video.mp4");
        return;
      }
      addMessage("agent", `Importing ${pathMatch[1]}...`);
      const result = await importAsset(pathMatch[1]);
      const resultText = result.content?.[0]?.text || "Done";
      addMessage("agent", resultText);
      return;
    }

    // Add to timeline
    if (lower.includes("add to timeline") || lower.includes("place on")) {
      const assetMatch = text.match(/asset\s+([^\s]+)/i);
      const trackMatch = text.match(/track\s+([^\s]+)/i);
      if (!assetMatch) {
        addMessage("agent", "Please specify the asset ID. Example: add asset asset_1234 to track video-1");
        return;
      }
      addMessage("agent", "Adding to timeline...");
      const result = await addClipToTimeline(
        trackMatch ? trackMatch[1] : "video-1",
        assetMatch[1]
      );
      addMessage("agent", result.content?.[0]?.text || "Done");
      return;
    }

    // Set playhead
    if (lower.includes("playhead") || lower.includes("scrub to")) {
      const timeMatch = text.match(/(\d+(?:\.\d+)?)/);
      if (!timeMatch) {
        addMessage("agent", "Please specify a time. Example: scrub to 5.5");
        return;
      }
      await setPlayhead(parseFloat(timeMatch[1]));
      addMessage("agent", `Playhead set to ${timeMatch[1]}s`);
      return;
    }

    // List tools
    if (lower.includes("what can you do") || lower.includes("list tools")) {
      if (tools.length === 0) {
        addMessage("agent", "Smyth Cuts not connected. Is the editor running?");
      } else {
        addMessage("agent", `Smyth Cuts has ${tools.length} tools available:\n${tools.join(", ")}`);
      }
      return;
    }

    // Unknown command — try as a raw MCP tool call
    addMessage("agent", `Trying as raw command: ${text}`);
    const result = await callVelornTool(text);
    addMessage("agent", result.content?.[0]?.text || "No result");
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isThinking) return;

    setInput("");
    addMessage("user", text);
    setIsThinking(true);

    try {
      await processCommand(text);
    } catch (err: any) {
      addMessage("agent", `Error: ${err.message}`);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Header */}
      <div className="h-10 border-b border-[#222] flex items-center px-3 justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Circle
            size={8}
            className={connected ? "fill-green-500 text-green-500" : "fill-red-500 text-red-500"}
          />
          <span className="text-[10px] font-bold text-[#666] uppercase tracking-widest">
            {connected ? "Velorn Connected" : "Velorn Disconnected"}
          </span>
        </div>
        {connected && (
          <span className="text-[9px] text-[#444] font-mono">{tools.length} tools</span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="text-center text-[#444] text-xs mt-8 space-y-2">
            <p>Videography Agent</p>
            <p className="text-[10px]">Commands: create project, import [path], add to timeline</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                msg.role === "user"
                  ? "bg-[#0066ff] text-white"
                  : "bg-[#1a1a1a] text-[#ccc] border border-[#222]"
              }`}
            >
              <pre className="whitespace-pre-wrap font-sans">{msg.text}</pre>
            </div>
          </div>
        ))}
        {isThinking && (
          <div className="flex justify-start">
            <div className="bg-[#1a1a1a] border border-[#222] rounded-lg px-3 py-2 text-xs text-[#666]">
              Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-[#222]">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder={connected ? "Type a command..." : "Start Velorn to begin"}
            disabled={!connected}
            className="flex-1 bg-[#111] border border-[#222] rounded-lg px-3 py-2 text-xs text-white placeholder-[#444] focus:outline-none focus:border-[#0066ff] disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!connected || !input.trim() || isThinking}
            className="p-2 bg-[#0066ff] hover:bg-[#0055dd] disabled:bg-[#222] disabled:text-[#555] rounded-lg text-white transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
