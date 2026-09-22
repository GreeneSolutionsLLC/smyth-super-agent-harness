"use client";

import { X, Maximize2, Minimize2, RefreshCw, MessageSquare } from "lucide-react";
import { useState, useRef } from "react";
import VideographyChat from "./VideographyChat";

interface VideographyPanelProps {
  onClose: () => void;
}

export default function VideographyPanel({ onClose }: VideographyPanelProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const refreshVelorn = () => {
    if (iframeRef.current) {
      iframeRef.current.src = `http://localhost:5173?t=${Date.now()}`;
    }
  };

  return (
    <div className={`fixed z-50 bg-black flex flex-col ${isFullscreen ? "inset-0" : "inset-4 rounded-xl border border-[#333] shadow-2xl"}`}>
      {/* Control Bar */}
      <div className="h-10 bg-[#111] border-b border-[#222] flex items-center px-3 justify-between shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[#0066ff] animate-pulse" />
          <span className="text-[10px] font-bold text-[#666] uppercase tracking-widest">Smyth Cuts</span>
          <span className="text-[9px] text-[#333] font-mono">Smyth Cuts sidecar</span>
        </div>
        
        <div className="flex items-center gap-1">
          <button onClick={refreshVelorn} className="p-1.5 hover:bg-[#222] rounded text-[#888] hover:text-white transition-colors" title="Refresh Smyth Cuts">
            <RefreshCw size={12} />
          </button>
          <button
            onClick={() => setShowChat(!showChat)}
            className={`p-1.5 hover:bg-[#222] rounded transition-colors ${showChat ? "text-[#0066ff]" : "text-[#888] hover:text-white"}`}
            title="Toggle Agent Chat"
          >
            <MessageSquare size={12} />
          </button>
          <button onClick={() => setIsFullscreen(!isFullscreen)} className="p-1.5 hover:bg-[#222] rounded text-[#888] hover:text-white transition-colors" title="Toggle Fullscreen">
            {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <button onClick={onClose} className="p-1.5 hover:bg-[#333] hover:text-red-400 rounded text-[#888] transition-colors ml-2" title="Close">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Split View: Smyth Cuts Editor + Agent Chat */}
      <div className="flex-1 flex min-h-0">
        {/* Smyth Cuts Editor Iframe */}
        <div className={`${showChat ? "w-[65%]" : "w-full"} min-h-0 transition-all`}>
          <iframe
            ref={iframeRef}
            src={`http://localhost:5173?t=${Date.now()}`}
            title="Smyth Cuts Video Editor"
            className="w-full h-full border-0"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        </div>

        {/* Agent Chat Panel */}
        {showChat && (
          <>
            <div className="w-px bg-[#222] shrink-0" />
            <div className="w-[35%] min-h-0">
              <VideographyChat />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
