import UIKit
import UniformTypeIdentifiers

/// Phase 1 risk-spike proof for Safari Share Sheet import (execution-plan.md
/// Phase 1 build scope; Phase 9 builds the real authenticated-submission
/// version on top). Deliberately not SLComposeServiceViewController's
/// "compose + Post button" pattern — the PRD's import flow has no mandatory
/// review step, so this captures the shared URL and dismisses immediately,
/// matching the frictionless "send to Keepsake" UX a Pocket/Instapaper-style
/// extension has, not a text-composer.
private let appGroupIdentifier = "group.com.kraigstrong.keepsake"
private let sharePayloadFileName = "share-inbox.json"

class ShareViewController: UIViewController {
  private let statusLabel = UILabel()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    setupStatusLabel()
    extractSharedURL { [weak self] url in
      DispatchQueue.main.async {
        self?.handle(url: url)
      }
    }
  }

  private func setupStatusLabel() {
    statusLabel.translatesAutoresizingMaskIntoConstraints = false
    statusLabel.textAlignment = .center
    statusLabel.font = .preferredFont(forTextStyle: .headline)
    statusLabel.text = "Saving to Keepsake…"
    view.addSubview(statusLabel)
    NSLayoutConstraint.activate([
      statusLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      statusLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      statusLabel.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
      statusLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
    ])
  }

  private func handle(url: URL?) {
    guard let url else {
      statusLabel.text = "Couldn't read a link from this share."
      dismissAfterDelay()
      return
    }

    if writeSharePayload(url: url) {
      statusLabel.text = "Saved to Keepsake"
    } else {
      statusLabel.text = "Couldn't reach Keepsake's shared storage."
    }
    dismissAfterDelay()
  }

  private func dismissAfterDelay() {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
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

    let receivedAtMillis = Int(Date().timeIntervalSince1970 * 1000)
    let payload = "{\"url\":\"\(url.absoluteString)\",\"receivedAt\":\(receivedAtMillis)}"
    let fileURL = containerURL.appendingPathComponent(sharePayloadFileName)

    do {
      try payload.write(to: fileURL, atomically: true, encoding: .utf8)
      return true
    } catch {
      return false
    }
  }
}
