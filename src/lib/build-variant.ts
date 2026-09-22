/**
 * Build-variant detection for Smyth.
 *
 * The app is built in two flavors:
 *   - "personal" (default): for the internal fleet / pre-seeded keys allowed.
 *   - "public": shipped to external users; starts with zero keys and forces setup.
 *
 * The variant is set at build time via `NEXT_PUBLIC_SM_BUILD_VARIANT`.
 * Server-only code can also read `process.env.SMYTH_BUILD_VARIANT`.
 */

export type BuildVariant = "personal" | "public";

function getVariant(): BuildVariant {
  if (typeof process !== "undefined") {
    const v =
      process.env.NEXT_PUBLIC_SM_BUILD_VARIANT ||
      process.env.SMYTH_BUILD_VARIANT ||
      "personal";
    return v === "public" ? "public" : "personal";
  }
  return "personal";
}

export const buildVariant: BuildVariant = getVariant();

export function isPublicBuild(): boolean {
  return buildVariant === "public";
}

export function isPersonalBuild(): boolean {
  return buildVariant === "personal";
}
