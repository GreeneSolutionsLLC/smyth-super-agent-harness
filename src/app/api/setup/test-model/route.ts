import { NextResponse } from 'next/server';

export interface TestModelPayload {
  provider: string;
  model: string;
  endpoint: string;
  key: string;
}

export async function POST(request: Request) {
  try {
    const { provider, endpoint, key }: TestModelPayload = await request.json();

    if (!endpoint) {
      return NextResponse.json({ ok: false, error: 'Endpoint is required.' }, { status: 400 });
    }

    const url = new URL(endpoint);
    // Provider-specific health/test paths.
    switch (provider) {
      case 'omniroute':
      case 'ollama-cloud':
      case 'ollama-pro':
      case 'openclaw':
        url.pathname = '/v1/models';
        break;
      case 'ollama-local':
        url.pathname = '/api/tags';
        break;
      case 'brave':
        url.pathname = '/res/v1/web/search';
        url.searchParams.set('q', 'health');
        break;
      case 'replicate':
        url.pathname = '/v1/models';
        break;
      default:
        // Try HEAD on the endpoint root.
        break;
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (key) {
      headers.Authorization = `Bearer ${key}`;
    }

    // Use a short timeout to avoid hanging.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(url.toString(), {
        method: provider === 'brave' && key ? 'GET' : 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok || res.status === 401 || res.status === 403) {
        // 401/403 still means reachable; just key-restricted.
        return NextResponse.json({ ok: true, status: res.status });
      }
      return NextResponse.json({ ok: false, status: res.status, error: await res.text().catch(() => 'Unknown error') });
    } catch (fetchErr: any) {
      clearTimeout(timeout);
      if (fetchErr.name === 'AbortError') {
        return NextResponse.json({ ok: false, error: 'Connection timed out.' });
      }
      return NextResponse.json({ ok: false, error: fetchErr.message ?? 'Connection failed.' });
    }
  } catch (err: any) {
    console.error('Test model error:', err);
    return NextResponse.json({ ok: false, error: err?.message ?? 'Test failed.' }, { status: 500 });
  }
}
