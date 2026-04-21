/**
 * Single source of truth for the `codep` version string.
 * - At build time, tsup replaces `__CODEP_VERSION__` with package.json's version.
 * - During `tsc --noEmit` / tests, the fallback literal is used.
 */
declare const __CODEP_VERSION__: string | undefined;

export const CODEP_VERSION: string =
  typeof __CODEP_VERSION__ !== "undefined" ? __CODEP_VERSION__ : "0.0.0-dev";
