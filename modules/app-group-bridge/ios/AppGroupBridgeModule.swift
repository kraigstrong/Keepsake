import ExpoModulesCore

// Phase 1 risk-spike proof for App Group handoff (execution-plan.md Phase 1
// build scope, Phase 9's real Share Extension target). Reads/writes a file
// in the shared container rather than shared UserDefaults, matching the
// payload-file handoff design the real Share Extension will use.
private let appGroupIdentifier = "group.com.kraigstrong.keepsake"
private let payloadFileName = "share-inbox-test.json"

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
  }
}
