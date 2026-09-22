"use client";

import { useState } from "react";
import { ArrowRight, ArrowLeft, FolderOpen } from "lucide-react";

interface StepWorkspaceProps {
  initialPath: string;
  onChange: (path: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepWorkspace({ initialPath, onChange, onNext, onBack }: StepWorkspaceProps) {
  const [path, setPath] = useState(initialPath);

  const chooseFolder = async () => {
    if (typeof window !== "undefined" && (window as any).smythRuntime?.selectFolder) {
      const chosen = await (window as any).smythRuntime.selectFolder();
      if (chosen) {
        setPath(chosen);
        onChange(chosen);
      }
    }
  };

  return (
    <div className="flex flex-col flex-1 px-6 py-8 max-w-2xl mx-auto w-full">
      <div className="mb-8">
        <h2 className="text-2xl font-heading font-bold">Workspace Folder</h2>
        <p className="text-sm text-muted mt-1">
          Smyth stores your projects, memory, and scratch files here.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface/50 p-6 space-y-4">
        <div>
          <label className="block text-xs text-muted mb-1">Workspace path</label>
          <input
            type="text"
            value={path}
            onChange={(e) => {
              setPath(e.target.value);
              onChange(e.target.value);
            }}
            className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <button
          onClick={chooseFolder}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-surface text-sm"
        >
          <FolderOpen className="w-4 h-4" />
          Choose Folder
        </button>
      </div>

      <div className="flex justify-between pt-6 border-t border-border mt-auto">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-border hover:bg-surface"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onNext}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-accent hover:bg-accent/90 text-white font-semibold shadow-[0_0_20px_rgba(0,102,255,0.35)]"
        >
          Continue <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
