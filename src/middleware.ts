import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Redirect to /setup if first-run setup is incomplete.
 * Checks the user-scoped settings.json via the setup status API.
 */
export async function middleware(request: NextRequest) {
  // Skip setup check for the setup page itself and API routes
  if (
    request.nextUrl.pathname === "/setup" ||
    request.nextUrl.pathname.startsWith("/api/") ||
    request.nextUrl.pathname.startsWith("/_next/") ||
    request.nextUrl.pathname.startsWith("/legal/") ||
    request.nextUrl.pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  try {
    const base = request.nextUrl.origin;
    const res = await fetch(`${base}/api/setup/status`, {
      headers: { cookie: request.headers.get("cookie") ?? "" },
    });
    if (!res.ok) return NextResponse.next();
    const data = await res.json();
    if (!data.setupComplete) {
      return NextResponse.redirect(new URL("/setup", request.url));
    }
  } catch {
    // If status check fails, let the request through (better than a blank page)
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
