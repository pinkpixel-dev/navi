import { invoke } from "@tauri-apps/api/core";

interface LocalHttpResponse {
  status: number;
  body: string;
}

function isTauriApp(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return headers;
}

export function shouldUseTauriLocalFetch(baseUrl: string): boolean {
  return isTauriApp() && isLoopbackUrl(baseUrl);
}

export function createTauriLocalFetch(): typeof fetch {
  return async (input, init = {}) => {
    const url = String(input);
    const response = await invoke<LocalHttpResponse>("local_http_request", {
      request: {
        url,
        method: init.method ?? "GET",
        headers: headersToRecord(init.headers),
        body: typeof init.body === "string" ? init.body : undefined,
      },
    });

    return new Response(response.body, { status: response.status });
  };
}
