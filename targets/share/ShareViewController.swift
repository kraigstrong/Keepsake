import UIKit
import UniformTypeIdentifiers

/// Phase 1 risk-spike proof for Safari Share Sheet import (execution-plan.md
/// Phase 1 build scope), extended in Phase 9 (ADR-0016) into the real
/// durable-submission handoff. Deliberately not SLComposeServiceViewController's
/// "compose + Post button" pattern — the PRD's import flow has no mandatory
/// review step, so this captures the shared URL and dismisses, matching the
/// frictionless "send to Keepsake" UX a Pocket/Instapaper-style extension has,
/// not a text-composer.
///
/// Writes one <uuid>.json file per share into a share-inbox/ directory
/// (docs/risk-spikes/durable-import-submission.md decision 1) rather than a
/// single fixed filename — a second share before the app opens no longer
/// overwrites the first. The id is minted here and carried end-to-end as the
/// idempotency key (src/appGroup/appGroupHandoff.ts drains it into the local
/// outbox, which submits it to the server as client_import_id).
private let appGroupIdentifier = "group.com.kraigstrong.keepsake"
private let shareInboxDirectoryName = "share-inbox"

class ShareViewController: UIViewController {
  private let statusLabel = UILabel()
  private let checkmarkImageView = UIImageView()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    setupViews()
    extractSharedURL { [weak self] url in
      DispatchQueue.main.async {
        self?.handle(url: url)
      }
    }
  }

  private func setupViews() {
    statusLabel.translatesAutoresizingMaskIntoConstraints = false
    statusLabel.textAlignment = .center
    statusLabel.font = .preferredFont(forTextStyle: .headline)
    statusLabel.text = "Saving to Keepsake…"

    checkmarkImageView.translatesAutoresizingMaskIntoConstraints = false
    checkmarkImageView.image = UIImage(systemName: "checkmark.circle.fill")
    checkmarkImageView.tintColor = .systemGreen
    checkmarkImageView.contentMode = .scaleAspectFit
    checkmarkImageView.isHidden = true

    view.addSubview(checkmarkImageView)
    view.addSubview(statusLabel)
    NSLayoutConstraint.activate([
      checkmarkImageView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      checkmarkImageView.bottomAnchor.constraint(equalTo: statusLabel.topAnchor, constant: -16),
      checkmarkImageView.widthAnchor.constraint(equalToConstant: 44),
      checkmarkImageView.heightAnchor.constraint(equalToConstant: 44),
      statusLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      statusLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      statusLabel.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
      statusLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
    ])
  }

  private func handle(url: URL?) {
    guard let url else {
      statusLabel.text = "Couldn't read a link from this share."
      dismissAfterDelay(seconds: 0.6)
      return
    }

    if writeSharePayload(url: url) {
      showConfirmation()
      // 1.5s (up from the Phase 1 spike's 0.6s) plus a checkmark and a
      // success haptic — the physical-device finding from that spike was
      // that 0.6s of text alone "just disappeared... no confirmation, but
      // the data was sent" (docs/risk-spikes/safari-share-extension.md).
      // Still "send and go," not a composer — just legible enough to
      // register.
      dismissAfterDelay(seconds: 1.5)
    } else {
      statusLabel.text = "Couldn't reach Keepsake's shared storage."
      dismissAfterDelay(seconds: 0.6)
    }
  }

  private func showConfirmation() {
    statusLabel.text = "Saved to Keepsake"
    checkmarkImageView.isHidden = false
    UINotificationFeedbackGenerator().notificationOccurred(.success)
  }

  private func dismissAfterDelay(seconds: TimeInterval) {
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
      self?.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
  }

  private func extractSharedURL(completion: @escaping (URL?) -> Void) {
    guard
      let item = extensionContext?.inputItems.first as? NSExtensionItem,
      let attachment = item.attachments?.first
    else {
      completion(nil)
      return
    }

    let urlType = UTType.url.identifier
    if attachment.hasItemConformingToTypeIdentifier(urlType) {
      attachment.loadItem(forTypeIdentifier: urlType, options: nil) { data, _ in
        completion(data as? URL)
      }
      return
    }

    let textType = UTType.plainText.identifier
    if attachment.hasItemConformingToTypeIdentifier(textType) {
      attachment.loadItem(forTypeIdentifier: textType, options: nil) { data, _ in
        if let string = data as? String, let url = URL(string: string) {
          completion(url)
        } else {
          completion(nil)
        }
      }
      return
    }

    completion(nil)
  }

  private func writeSharePayload(url: URL) -> Bool {
    guard
      let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupIdentifier)
    else {
      return false
    }

    let directoryURL = containerURL.appendingPathComponent(shareInboxDirectoryName)
    do {
      try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    } catch {
      return false
    }

    let id = UUID().uuidString
    let receivedAtMillis = Int(Date().timeIntervalSince1970 * 1000)
    let payload: [String: Any] = [
      "id": id,
      "url": url.absoluteString,
      "receivedAt": receivedAtMillis,
    ]

    guard let payloadData = try? JSONSerialization.data(withJSONObject: payload) else {
      return false
    }

    let fileURL = directoryURL.appendingPathComponent("\(id).json")
    do {
      try payloadData.write(to: fileURL, options: .atomic)
      return true
    } catch {
      return false
    }
  }
}
