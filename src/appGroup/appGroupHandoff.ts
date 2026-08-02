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

export interface SharedImport {
  url: string;
  receivedAt: number;
}

/**
 * Reads whatever the real Share Extension (targets/share/ShareViewController.swift)
 * most recently wrote. Parsed defensively — the file is written by our own
 * extension, not arbitrary external input, but a partially-written or
 * unexpected-shape file should surface as "nothing to import" rather than
 * throw and break app startup.
 */
export function readSharedImport(): SharedImport | null {
  const raw = AppGroupBridge.readSharePayload();
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'url' in parsed &&
      typeof parsed.url === 'string' &&
      parsed.url.length > 0 &&
      'receivedAt' in parsed &&
      typeof parsed.receivedAt === 'number'
    ) {
      return { url: parsed.url, receivedAt: parsed.receivedAt };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearSharedImport(): boolean {
  return AppGroupBridge.clearSharePayload();
}
