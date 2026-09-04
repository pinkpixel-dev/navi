/// Tauri commands reject with the plain string their Rust side returned, not with an
/// `Error`, so an `error instanceof Error` check throws away the real reason and
/// leaves the caller showing a generic fallback. This unwraps both shapes.
export const describeError = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return fallback;
};
