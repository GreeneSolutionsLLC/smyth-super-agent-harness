"use client";

import { ArrowRight, Sparkles } from "lucide-react";

interface StepWelcomeProps {
  onStart: () => void;
  onSkip: () => void;
}

export function StepWelcome({ onStart, onSkip }: StepWelcomeProps) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 px-6 py-16 text-center">
      <div className="mb-6 inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-accent/10 border border-accent/30 shadow-[0_0_30px_rgba(0,102,255,0.25)]">
        <Sparkles className="w-10 h-10 text-accent-bright" />
      </div>
      <h1 className="text-4xl md:text-5xl font-heading font-bold mb-4">
        Welcome to Smyth
      </h1>
      <p className="text-lg text-muted max-w-xl mb-8">
        Your local AI workspace by Greene Solutions LLC.
      </p>

      <div className="max-w-md text-left space-y-4 mb-10 text-sm text-muted">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 w-5 h-5 rounded-full bg-accent-bright/20 text-accent-bright flex items-center justify-center text-xs">✓</span>
          <span>Smyth runs entirely on your Mac.</span>
        </div>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 w-5 h-5 rounded-full bg-accent-bright/20 text-accent-bright flex items-center justify-center text-xs">✓</span>
          <span>Your API keys stay on your machine.</span>
        </div>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 w-5 h-5 rounded-full bg-accent-bright/20 text-accent-bright flex items-center justify-center text-xs">✓</span>
          <span>OmniRoute free auto-routing is ready to use right now.</span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm">
        <button
          onClick={onStart}
          className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-accent hover:bg-accent/90 text-white font-semibold transition shadow-[0_0_20px_rgba(0,102,255,0.35)]"
        >
          Get Started
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={onSkip}
          className="flex-1 px-6 py-3 rounded-lg border border-border hover:bg-surface transition text-sm"
        >
          Skip Setup
        </button>
      </div>
      <p className="mt-4 text-xs text-muted">
        Skipping still enables OmniRoute Auto and lets you add providers later in Settings.
      </p>
    </div>
  );
}
