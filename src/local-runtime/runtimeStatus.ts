export interface RuntimeStatus {
  state: "not-configured" | "starting" | "ready" | "failed";
  label: string;
  detail: string;
}

export const runtimeStatus: RuntimeStatus = {
  state: "not-configured",
  label: "llama.cpp not configured",
  detail: "The managed local runtime will be added after the Phase 0 app shell and loop contracts are stable.",
};
