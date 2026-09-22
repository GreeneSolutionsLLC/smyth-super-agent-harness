"use client";

import { useState } from "react";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { PermissionRow, PermissionItem } from "./PermissionRow";

interface StepPermissionsProps {
  initial: Record<string, boolean | 'deferred'>;
  onChange: (state: Record<string, boolean | 'deferred'>) => void;
  onNext: () => void;
  onBack: () => void;
}

const PERMISSIONS: PermissionItem[] = [
  { id: "camera", name: "Camera", why: "Used by EchoVision and video calls." },
  { id: "microphone", name: "Microphone", why: "Used for voice input and meetings." },
  { id: "accessibility", name: "Accessibility", why: "Allows UI automation and senses." },
  { id: "screen", name: "Screen Recording", why: "Used by the browser sense and notetaker." },
  { id: "notifications", name: "Notifications", why: "Alerts for tasks, reminders, and completion." },
];

export function StepPermissions({ initial, onChange, onNext, onBack }: StepPermissionsProps) {
  const [state, setState] = useState<Record<string, boolean | 'deferred'>>(initial);
  const [requesting, setRequesting] = useState<Record<string, boolean>>({});

  const update = (id: string, value: boolean | 'deferred') => {
    const next = { ...state, [id]: value };
    setState(next);
    onChange(next);
  };

  const request = async (id: string) => {
    setRequesting((r) => ({ ...r, [id]: true }));

    try {
      if (id === "notifications" && typeof window !== "undefined" && "Notification" in window) {
        const result = await Notification.requestPermission();
        update(id, result === "granted");
      } else if (typeof window !== "undefined" && (window as any).smythRuntime?.openSystemSettings) {
        (window as any).smythRuntime.openSystemSettings(id);
      }
      // If no runtime bridge, mark deferred.
      update(id, state[id] ?? 'deferred');
    } finally {
      setRequesting((r) => ({ ...r, [id]: false }));
    }
  };

  return (
    <div className="flex flex-col flex-1 px-6 py-8 max-w-3xl mx-auto w-full">
      <div className="mb-6">
        <h2 className="text-2xl font-heading font-bold">macOS Permissions</h2>
        <p className="text-sm text-muted mt-1">
          These are optional. You can defer any of them and grant later in System Settings.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface/50 px-5 mb-6">
        {PERMISSIONS.map((p) => (
          <PermissionRow
            key={p.id}
            item={{ ...p, status: state[p.id] ?? false }}
            onRequest={request}
            requesting={requesting[p.id]}
          />
        ))}
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
