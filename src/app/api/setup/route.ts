import { NextResponse } from 'next/server';
import { writeEnvFile, writeSettings, readSettings } from '@/lib/env';
import { SETUP_STEPS, allSetupStepIds, type SetupStepId } from '@/lib/provider-registry';
import { clearRuntimeEnvCache } from '@/lib/runtime-keys';

export interface SetupPayload {
  stepData: Record<SetupStepId, Record<string, string>>;
  skippedSteps?: SetupStepId[];
  legal: {
    terms: boolean;
    privacy: boolean;
    eula: boolean;
  };
}

export async function POST(request: Request) {
  try {
    const payload: SetupPayload = await request.json();

    if (!payload.legal?.terms || !payload.legal?.privacy || !payload.legal?.eula) {
      return NextResponse.json({ error: 'Legal agreements required.' }, { status: 400 });
    }

    const env: Record<string, string> = {};
    const stepCompletion: Record<string, any> = {};
    const skippedSteps: Record<string, boolean> = {};

    // Collect every field from non-skipped steps and mark skips.
    for (const stepId of allSetupStepIds()) {
      const step = SETUP_STEPS.find((s) => s.id === stepId)!;
      const values = payload.stepData?.[stepId] ?? {};
      const isSkipped = payload.skippedSteps?.includes(stepId) ?? false;
      skippedSteps[stepId] = isSkipped;

      if (!isSkipped) {
        for (const field of step.fields) {
          const value = values[field.key]?.trim() ?? field.defaultValue ?? '';
          if (value) {
            env[field.key] = value;
          }
        }
        // byok: also collect any extra keys not in the pre-registered fields
        // (e.g. pool keys like OLLAMA_CLOUD_API_KEY, CLOUDFLARE_API_TOKEN, etc.)
        if (stepId === "byok") {
          const knownKeys = new Set(step.fields.map((f) => f.key));
          for (const [k, v] of Object.entries(values)) {
            if (!knownKeys.has(k) && typeof v === "string" && v.trim()) {
              env[k] = v.trim();
            }
          }
        }
      }

      // 'configured' semantics: the byok step is satisfied by ANY one provider
      // key (users pick one provider, not all 18). Every other step needs all
      // its fields.
      const isConfigured = stepId === "byok"
        ? step.fields.some((f) => {
            const v = env[f.key]?.trim() ?? values[f.key]?.trim() ?? '';
            return Boolean(v);
          })
        : step.fields.every((f) => {
            const v = env[f.key]?.trim() ?? values[f.key]?.trim() ?? '';
            return Boolean(v) || (f.type === 'text' && f.defaultValue);
          });

      stepCompletion[stepId] = {
        configured: isSkipped ? false : isConfigured,
        skipped: isSkipped,
      };
    }

    const existing = await readSettings();

    await writeEnvFile(env);
    clearRuntimeEnvCache();

    const settings = await writeSettings({
      setupComplete: true,
      workspacePath: existing.workspacePath,
      permissions: existing.permissions,
      providers: {
        ...(existing.providers ?? {}),
        setup: {
          skippedSteps,
          stepCompletion,
        },
      } as any,
    });

    return NextResponse.json({ ok: true, settings });
  } catch (err: any) {
    console.error('Setup POST error:', err);
    return NextResponse.json({ error: err?.message ?? 'Setup failed.' }, { status: 500 });
  }
}
