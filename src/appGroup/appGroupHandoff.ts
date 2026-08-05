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
  id: string;
  url: string;
  receivedAt: number;
}

/**
 * Reads every share currently queued in the App Group's share-inbox/
 * directory (written by the real Share Extension,
 * targets/share/ShareViewController.swift) — a directory of one <uuid>.json
 * file per share, not a single fixed filename, so a second share before the
 * app opens doesn't overwrite the first (ADR-0016, adopting
 * docs/risk-spikes/durable-import-submission.md decision 1). Each entry is
 * parsed defensively: the files are written by our own extension, not
 * arbitrary external input, but a partially-written or unexpected-shape
 * file is skipped rather than thrown, so one bad entry doesn't break the
 * drain for the rest of the queue.
 */
export function readQueuedShares(): SharedImport[] {
  const rawPayloads = AppGroupBridge.listSharePayloads();
  const shares: SharedImport[] = [];

  for (const raw of rawPayloads) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'id' in parsed &&
        typeof parsed.id === 'string' &&
        parsed.id.length > 0 &&
        'url' in parsed &&
        typeof parsed.url === 'string' &&
        parsed.url.length > 0 &&
        'receivedAt' in parsed &&
        typeof parsed.receivedAt === 'number'
      ) {
        shares.push({ id: parsed.id, url: parsed.url, receivedAt: parsed.receivedAt });
      }
    } catch {
      // skip a malformed entry rather than losing the rest of the queue
    }
  }

  return shares;
}

/**
 * Removes one share's queue file. Callers must only do this after the
 * share is durably recorded elsewhere (the local outbox) — deleting first
 * and persisting second would risk losing an import if the app is killed
 * in between (durable-import-submission.md decision 2).
 */
export function deleteQueuedShare(id: string): boolean {
  return AppGroupBridge.deleteSharePayload(id);
}
