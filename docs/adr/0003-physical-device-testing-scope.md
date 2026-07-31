# ADR-0003: iOS Simulator is the default exit-gate environment; physical device is required only where hardware/OS behavior actually differs

- **Status:** Accepted
- **Date:** 2026-07-31
- **Phase:** 0

## Context

The original execution plan required a physical-iPhone demonstration at every phase's exit gate (21 phases). The developer is effectively the sole reviewer and tester, and the goal of this whole process is to minimize how often they're interrupted or required to do something only a human can do. Requiring a physical device 21 times conflicts with that goal, and most phases (schema, RLS, domain logic, search, planning, grocery generation, UI) don't exercise anything that behaves differently between Simulator and a real device.

## Decision

iOS Simulator is the default and sufficient environment for a phase's exit-gate demonstration. A physical device is required only for phases that exercise capabilities Simulator can't represent faithfully:

- **Phase 1** — Native Feasibility and Risk Spikes (proving Share Extension, Reminders, camera, keep-awake, App Group handoff all actually work)
- **Phase 9** — Safari Share Sheet and Bulk URL Import (Share Extension)
- **Phase 10** — Camera and Existing Photo Import (Simulator has no camera)
- **Phase 14** — Apple Reminders Export (already scoped to physical devices in the plan)
- **Phase 15** — Cooking Mode and Cooking History (screen-awake behavior, real kitchen-use validation)
- **Phase 17** — End-to-End Product and Security Validation (at least one full pass on real hardware in addition to Simulator coverage)
- **Phase 19 / Phase 20** — Beta and App Store Release (TestFlight is physical-device by definition)

All other phases exit on Simulator evidence alone.

## Alternatives considered

- **Keep physical-device-everywhere:** rejected as disproportionate to what most phases actually test, and in direct tension with the developer's low-interruption goal.
- **Drop physical-device testing entirely, rely on Simulator/CI only:** rejected — Share Extension, camera, Reminders, and real kitchen use are exactly the kind of thing that looks fine on Simulator and fails in practice; the PRD's whole premise depends on those working for real.

## Consequences

Reviewing this list is worth revisiting if a phase's scope changes materially, or if something in the "Simulator is fine" set turns out to have a hardware-dependent edge (e.g., offline/connectivity-toggle behavior in Phase 6 might warrant a spot-check later — Simulator's network conditioning is decent but not identical to a real device on real Wi-Fi/cellular transitions). If that comes up, add the phase to the physical-device list here rather than silently deciding it mid-phase.
