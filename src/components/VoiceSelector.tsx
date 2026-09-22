"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Check } from "lucide-react";

interface VoiceOption {
  key: string;
  name: string;
}

interface VoiceSelectorProps {
  selected: string;
  onSelect: (key: string) => void;
}

export default function VoiceSelector({ selected, onSelect }: VoiceSelectorProps) {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/voices")
      .then((r) => r.json())
      .then((d) => setVoices(d.voices || []))
      .catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selectedName = voices.find((v) => v.key === selected)?.name || "Smyth";

  return (
    <div className="relative w-full" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full bg-muted-bg border border-border rounded px-2.5 py-1.5 text-[10px] text-foreground cursor-pointer hover:border-accent transition-colors"
      >
        <span className="truncate">{selectedName}</span>
        <ChevronDown size={12} className={`ml-1 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute bottom-full mb-1 left-0 w-full bg-surface border border-border rounded shadow-xl z-20 max-h-[200px] overflow-y-auto">
          {voices.map((v) => (
            <button
              key={v.key}
              onClick={() => {
                onSelect(v.key);
                setOpen(false);
              }}
              className={`flex items-center gap-2 w-full text-left px-2.5 py-1.5 text-[10px] cursor-pointer transition-colors hover:bg-accent/10 ${
                v.key === selected ? "text-accent font-medium" : "text-foreground"
              }`}
            >
              {v.key === selected && <Check size={10} className="shrink-0" />}
              <span className={v.key === selected ? "" : "ml-[18px]"}>{v.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
