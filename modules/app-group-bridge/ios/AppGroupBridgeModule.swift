import ExpoModulesCore

// Phase 1 risk-spike proof for App Group handoff (execution-plan.md Phase 1
// build scope), extended in Phase 9 (ADR-0016) for the real Share Extension
// target's durable queue. Reads/writes files in the shared container rather
// than shared UserDefaults, matching the payload-file handoff design the
// real Share Extension uses.
private let appGroupIdentifier = "group.com.kraigstrong.keepsake"
private let payloadFileName = "share-inbox-test.json"
// A directory of one <uuid>.json file per share
// (targets/share/ShareViewController.swift writes these), not a single
// fixed filename — a second share before the app opens no longer
// overwrites the first (docs/risk-spikes/durable-import-submission.md
// decision 1). Kept separate from the round-trip test file above.
private let shareInboxDirectoryName = "share-inbox"

public class AppGroupBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppGroupBridge")

    Function("containerAvailable") { () -> Bool in
      FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) != nil
    }

    Function("writeTestPayload") { (value: String) -> Bool in
      guard
        let containerURL = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: appGroupIdentifier)
      else {
        return false
      }
      let fileURL = containerURL.appendingPathComponent(payloadFileName)
      do {
        try value.write(to: fileURL, atomically: true, encoding: .utf8)
        return true
      } catch {
        return false
      }
    }

    Function("readTestPayload") { () -> String? in
      guard
        let containerURL = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: appGroupIdentifier)
      else {
        return nil
      }
      let fileURL = containerURL.appendingPathComponent(payloadFileName)
      return try? String(contentsOf: fileURL, encoding: .utf8)
    }

    // Returns the raw JSON contents of every file currently queued in
    // share-inbox/, one string per share — the caller (src/appGroup/
    // appGroupHandoff.ts) parses and drains each into the local outbox,
    // then calls deleteSharePayload(id) only after that's committed.
    Function("listSharePayloads") { () -> [String] in
      guard
        let containerURL = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: appGroupIdentifier)
      else {
        return []
      }
      let directoryURL = containerURL.appendingPathComponent(shareInboxDirectoryName)
      guard
        let files = try? FileManager.default.contentsOfDirectory(
          at: directoryURL, includingPropertiesForKeys: nil)
      else {
        return []
      }
      return files
        .filter { $0.pathExtension == "json" }
        .compactMap { try? String(contentsOf: $0, encoding: .utf8) }
    }

    Function("deleteSharePayload") { (id: String) -> Bool in
      guard
        let containerURL = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: appGroupIdentifier)
      else {
        return false
      }
      let fileURL =
        containerURL
        .appendingPathComponent(shareInboxDirectoryName)
        .appendingPathComponent("\(id).json")
      try? FileManager.default.removeItem(at: fileURL)
      return true
    }
  }
}
