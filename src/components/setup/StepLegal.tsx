"use client";

import { useState } from "react";
import { ArrowRight, ArrowLeft, Check } from "lucide-react";

interface StepLegalProps {
  initial: { terms: boolean; privacy: boolean; eula: boolean };
  onChange: (state: { terms: boolean; privacy: boolean; eula: boolean }) => void;
  onFinish: () => void;
  onBack: () => void;
}

export function StepLegal({ initial, onChange, onFinish, onBack }: StepLegalProps) {
  const [agreed, setAgreed] = useState(initial);

  const toggle = (key: keyof typeof agreed) => {
    const next = { ...agreed, [key]: !agreed[key] };
    setAgreed(next);
    onChange(next);
  };

  const openLegal = (file: string) => {
    if (typeof window !== "undefined" && (window as any).smythRuntime?.openLegal) {
      (window as any).smythRuntime.openLegal(file);
    } else {
      window.open(`/${file}.html`, "_blank");
    }
  };

  const allAgreed = agreed.terms && agreed.privacy && agreed.eula;

  return (
    <div className="flex flex-col flex-1 px-6 py-8 max-w-2xl mx-auto w-full">
      <div className="mb-8">
        <h2 className="text-2xl font-heading font-bold">Before you start</h2>
        <p className="text-sm text-muted mt-1">
          By using Smyth, you agree to our legal terms. License credits are available in Settings → Legal.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface/50 p-6 space-y-4 mb-6">
        {[
          {
            key: "terms" as const,
            label: "I agree to the",
            link: "Terms of Service",
            file: "terms",
          },
          {
            key: "privacy" as const,
            label: "I agree to the",
            link: "Privacy Policy",
            file: "privacy",
          },
          {
            key: "eula" as const,
            label: "I agree to the",
            link: "End User License Agreement",
            file: "eula",
          },
        ].map((item) => (
          <label
            key={item.key}
            className="flex items-start gap-3 cursor-pointer group"
          >
            <div
              className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center transition ${
                agreed[item.key]
                  ? "bg-accent-bright border-accent-bright text-background"
                  : "border-border group-hover:border-accent"
              }`}
            >
              {agreed[item.key] && <Check className="w-3.5 h-3.5" />}
            </div>
            <input
              type="checkbox"
              className="sr-only"
              checked={agreed[item.key]}
              onChange={() => toggle(item.key)}
            />
            <span className="text-sm">
              {item.label}{" "}
              <button
                type="button"
                onClick={() => openLegal(item.file)}
                className="text-accent hover:underline underline-offset-2"
              >
                {item.link}
              </button>
            </span>
          </label>
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
          onClick={onFinish}
          disabled={!allAgreed}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-accent hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold shadow-[0_0_20px_rgba(0,102,255,0.35)]"
        >
          Finish Setup <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
