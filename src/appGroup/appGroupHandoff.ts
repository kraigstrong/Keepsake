import AppGroupBridge from '../../modules/app-group-bridge/src/AppGroupBridgeModule';

/**
 * Phase 1 risk-spike proof for App Group handoff (execution-plan.md Phase 1
 * build scope) and Phase 9's real Share Extension. Proves the App Group
 * entitlement (app.json `ios.entitlements`) actually resolves a shared
 * container the app can read/write — the same mechanism the real Share
 * Extension will use to hand an imported URL to the main app.
 */
export function isAppGroupContainerAvailable(): boolean {
  return AppGroupBridge.containerAvailable();
}

export function writeTestPayload(value: string): boolean {
  return AppGroupBridge.writeTestPayload(value);
}

export function readTestPayload(): string | null {
  return AppGroupBridge.readTestPayload();
}
