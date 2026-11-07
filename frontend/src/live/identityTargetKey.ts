import type { IcpTargetConfig } from "./targetRegistry";
/** Complete environment binding, not the display alias alone. Never telemetry. */
export function identityTargetKey(target: IcpTargetConfig): string {
  return JSON.stringify([target.alias, target.host, target.networkKind,
    Object.entries(target.canisterIds).sort(([a], [b]) => a.localeCompare(b)),
    target.supportedDomains ?? []]);
}