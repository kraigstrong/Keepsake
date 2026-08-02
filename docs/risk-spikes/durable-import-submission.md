# Design: Durable Import Submission

**Phase 1.** Not a code spike like the others — a design pass on the path from "Share Extension captured a URL" (proven working in [safari-share-extension.md](safari-share-extension.md)) to "server has a durable, idempotent `ImportJob`" (the real data model, built in Phase 8, submitted-to by Phase 9's "Final Share Extension"). Phase 1's exit gate only asks that a chosen implementation path *exist* for release-blocking native requirements — this document is that path, not its implementation.

## The risk

A Share Extension runs as a separate, short-lived process with no network guarantees, no guaranteed user session, and no guarantee the main app opens soon after. Between "user tapped Keepsake in the Share Sheet" and "recipe import is durably queued server-side," several things can go wrong without the user ever finding out an import was lost:

- The device is offline when the extension runs, or when the app next opens.
- The user is signed out (or their session expired) when the app reads the shared payload.
- The user shares two or three pages in a row before ever opening the app.
- The app is killed (by the user or the OS) between reading the shared payload and finishing server submission.

"Durable" means none of these silently drop an import. The user shared once; Keepsake should eventually import it exactly once, without the user having to notice or retry manually.

## What the Share Extension spike already surfaced

The spike's current implementation (`targets/share/ShareViewController.swift`, `modules/app-group-bridge`) writes one fixed filename, `share-inbox.json`, into the App Group container, and the app reads and displays it. That was the right scope for proving the *mechanism* works at all — but it has a known, deliberate limitation this design must address: **a second share before the app opens overwrites the first.** That's fine for a spike proving "can a URL cross the process boundary at all"; it's a real data-loss bug for the shipped feature.

## Proposed design for Phase 8/9

**1. Queue, not a single slot.** The App Group container holds a directory (e.g. `share-inbox/`) of one file per share event, named by a client-generated UUID (`<uuid>.json`), not a fixed filename or a timestamp alone (timestamps can collide within the same millisecond across rapid shares). Each file's payload gains an explicit `id` field carrying that same UUID — this is the idempotency key that survives every hop from here to the server.

**2. Drain into a local durable outbox, not straight to the network.** On foreground/launch, the app enumerates every file in the queue directory, and for each one:
   - Inserts a row into a local SQLite outbox table (`id`, `url`, `receivedAt`, `status: 'pending' | 'submitting' | 'submitted' | 'failed'`) inside a transaction.
   - Only deletes the App Group queue file *after* that SQLite insert is confirmed committed.

   This ordering matters: if the app is killed between "read the App Group file" and "commit to SQLite," the file is still sitting in the App Group queue next launch — nothing is lost. Deleting first and writing to SQLite second would risk the opposite: a crash after delete but before commit loses the import silently. SQLite (not just in-memory state) is the durability boundary because it survives app termination; the App Group file is only the *handoff* mechanism, not the system of record once drained.

**3. Submission is retried against outbox state, not the App Group file.** Once an item is in the outbox, a background/foreground sync attempts to POST it as an `ImportJob` (Phase 8's real endpoint). Network failure, signed-out state, or an expired session all just leave the row at `status: 'pending'` (or move it to `'failed'` after a retry budget, surfaced to the user rather than retried forever) — retried whenever connectivity and a valid session are next available. This is the same shape execution-plan.md already calls for generally ("Idempotent retries," "Idempotent replay") — this design just makes sure the *client* has a durable place to retry from, not only the server.

**4. Idempotency is the client-generated UUID, carried end-to-end.** The extension mints it; the outbox row keys on it; the `ImportJob` submission includes it as an idempotency key. If the same submission is retried (network timeout where the server actually received it, app killed mid-request), the server accepts it once — this is exactly Phase 8's already-planned "Duplicate detection" and Phase 9's "Replays are idempotent," this design just confirms the client has a stable key to hand it *from the moment of capture*, not invented later at submission time (inventing it at submission time would fail to dedupe a submission that's retried after an app kill and re-drain).

**5. Signed-out handling reuses the same outbox, doesn't special-case it.** A signed-out user's shared imports stay in the outbox at `pending`; no separate "staging" storage is needed for the signed-out case specifically — it's the same retry loop as "was offline," just gated on session state instead of network state. Bulk URL import (Phase 9) can reuse this same table with `receivedAt`/`id` per entry.

## What Phase 8/9 need to build (not built now)

- The `share-inbox/` directory convention (rename from today's single-file `share-inbox.json`) and the `id` field in the extension's payload.
- The local SQLite outbox table and drain-on-foreground logic.
- The real `ImportJob` server endpoint accepting the idempotency key.
- Retry/backoff policy and user-visible surfacing of permanently-failed items ("leave-and-return progress," per execution-plan.md Phase 9 build scope).

## Why this wasn't built now

Phase 1's exit gate is "chosen implementation paths exist," not a working outbox — building the real SQLite outbox and server endpoint now would be redoing Phase 8/9's work early, against data model decisions (the real `ImportJob`/`ImportBatch` schema) that haven't been made yet. What Phase 1 needed to retire as a risk was narrower and now is: does a URL reliably survive the extension-to-app process boundary at all (yes, proven in the Share Extension spike), and is there a credible design for making that durable across the failure modes above (this document).
