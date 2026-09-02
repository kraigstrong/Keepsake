# `web/` — the Keepsake public site

A static site, deliberately dependency-free: two HTML files with inline CSS, no build step.

It exists because `keepsake.brightbench.app` had **no web hosting at all** — Resend's Vercel
integration configured email DNS (MX/TXT) only, so the host did not resolve. Three separate roadmap
items were each blocked on the same missing thing.

## What it unblocks

1. **The privacy policy URL** — required for Beta App Review, which gates external TestFlight.
2. **`apple-app-site-association`** — universal links for invitations. Not added yet: the file needs
   the Apple Team ID, and a malformed AASA is worse than none because iOS caches it.
3. **The same AASA file** — the 1Password autofill domain association.

## Deploying

One Vercel project, pointed at this repo. The only non-default settings:

- **Root Directory:** `web`
- **Framework Preset:** Other
- **Build Command:** none (leave empty)
- **Output Directory:** leave empty — the files are served as-is

Then add `keepsake.brightbench.app` as a domain on that project. Vercel already holds the DNS, so it
only needs the A/CNAME record it offers to add for you; the existing Resend MX/TXT records are
untouched by that and email keeps working.

Do not point the project at the repository root — that would try to build the Expo app.

## Before it fronts an App Review submission

- Confirm `privacy@brightbench.app` exists and is monitored. It is the only contact route the policy
  gives, including for deletion requests.
- Re-read the policy as the accountable party. It was drafted from the app's actual data flows, but
  it is not legal advice.
