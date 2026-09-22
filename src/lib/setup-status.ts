/**
 * Shared setup-status logic used by the UI and the API.
 */

import {
  SETUP_STEPS,
  type SetupStepId,
} from "@/lib/provider-registry";
import { readEnvFile, readSettings } from "@/lib/env";

export interface StepStatus {
  id: SetupStepId;
  configured: boolean;
  skipped: boolean;
  missingFields: string[];
}

export async function getSetupStatus(): Promise<{
  setupComplete: boolean;
  steps: StepStatus[];
  env: Record<string, string>;
}> {
  const [settings, env] = await Promise.all([readSettings(), readEnvFile()]);
  const stepSkips: Record<string, boolean> =
    (settings.providers?.setup as Record<string, any> | undefined)?.skippedSteps ?? {};

  const steps: StepStatus[] = SETUP_STEPS.map((step) => {
    const required = step.dependsOnKeys ?? step.fields.map((f) => f.key);
    const missingFields: string[] = [];

    if (step.dependsOnKeys) {
      // Swarm: satisfied if any dependency key is present.
      const any = required.some((k) => Boolean(env[k]?.trim()));
      if (!any) {
        missingFields.push(...required);
      }
    } else if (step.id === "byok") {
      // BYOK: satisfied if ANY one provider key is present.
      const anyKey = step.fields.some((f) => Boolean(env[f.key]?.trim()));
      if (!anyKey) {
        missingFields.push(...step.fields.map((f) => f.key));
      }
    } else {
      for (const field of step.fields) {
        const v = env[field.key];
        if (!v?.trim() && field.type !== "text") {
          missingFields.push(field.key);
        }
      }
    }

    return {
      id: step.id,
      configured: missingFields.length === 0,
      skipped: Boolean(stepSkips[step.id]),
      missingFields,
    };
  });

  return {
    setupComplete: settings.setupComplete,
    steps,
    env,
  };
}
