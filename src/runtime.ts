// ARP Runtime - Store PluginRuntime reference for use across modules

import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setARPRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getARPRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("ARP runtime not initialized");
  }
  return runtime;
}
