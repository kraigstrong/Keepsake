// jest-expo's preset only knows how to auto-mock official Expo SDK native
// modules — a project-local one like AppGroupBridge has no such registry
// entry, so any test that renders the real app tree (app/_layout.tsx now
// pulls this in via src/import/outboxEngine.ts, ADR-0016) would otherwise
// throw "Cannot find native module 'AppGroupBridge'" the moment it loads.
// Routed here via jest.config.js's moduleNameMapper. Tests that care about
// this module's actual behavior (src/appGroup/appGroupHandoff.test.ts,
// src/import/outboxEngine.test.ts) still call jest.mock() with their own
// factory, which takes precedence over this file for their own module
// graph — this is only the safe default for everything else.
export default {
  containerAvailable: () => false,
  writeTestPayload: () => false,
  readTestPayload: () => null,
  listSharePayloads: () => [],
  deleteSharePayload: () => true,
};
