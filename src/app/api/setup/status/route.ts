import { NextResponse } from 'next/server';
import { getSetupStatus } from '@/lib/setup-status';
import { readSettings } from '@/lib/env';

export async function GET() {
  const [status, settings] = await Promise.all([getSetupStatus(), readSettings()]);

  return NextResponse.json({
    setupComplete: status.setupComplete,
    workspacePath: settings.workspacePath,
    permissions: settings.permissions,
    steps: status.steps,
    env: status.env,
  });
}
