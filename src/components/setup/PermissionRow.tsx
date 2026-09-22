"use client";

import { Check, X, Settings, Loader2 } from "lucide-react";

export interface PermissionItem {
  id: string;
  name: string;
  why: string;
  status?: boolean | 'deferred';
}

interface PermissionRowProps {
  item: PermissionItem;
  onRequest: (id: string) => void;
  requesting?: boolean;
}

export function PermissionRow({ item, onRequest, requesting }: PermissionRowProps) {
  const granted = item.status === true;
  const deferred = item.status === 'deferred';

  return (
    <div className="flex items-center justify-between gap-4 py-4 border-b border-border/50 last:border-0">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h4 className="font-medium">{item.name}</h4>
          {granted ? (
            <span className="inline-flex items-center gap-1 text-xs text-accent-bright">
              <Check className="w-3 h-3" /> Allowed
            </span>
          ) : deferred ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <X className="w-3 h-3" /> Deferred
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-amber-400">
              <X className="w-3 h-3" /> Not requested
            </span>
          )}
        </div>
        <p className="text-sm text-muted mt-0.5">{item.why}</p>
      </div>
      <button
        onClick={() => onRequest(item.id)}
        disabled={requesting || granted}
        className={`shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition ${
          granted
            ? "bg-accent-bright/10 text-accent-bright cursor-default"
            : "border border-border hover:bg-surface"
        }`}
      >
        {requesting ? <Loader2 className="w-4 h-4 animate-spin" /> : granted ? <Check className="w-4 h-4" /> : <Settings className="w-4 h-4" />}
        {granted ? "Granted" : "Request"}
      </button>
    </div>
  );
}
