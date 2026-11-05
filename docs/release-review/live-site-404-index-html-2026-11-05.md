# Live site "Page not found" after the 5 Nov merge — cause, fix, verification

Date: 2026-11-05 (UTC). Status: fixed on the working branch; needs one more
main -> prod merge before igniteclubhq.app serves again.

## Symptom

After the merge that published the site (Netlify deploy reported success),
every address on https://igniteclubhq.app answered Netlify's "Page not found"
page (HTTP 404), including `/`, `/index.html` and `/events/<id>`.
`www.igniteclubhq.app` still redirected (301) and `/share` still reached the
edge function (302), so the site, domain and functions were healthy.

## Decisive evidence

| Address | Result |
| --- | --- |
| `https://igniteclubhq.app/` | 404 |
| `https://igniteclubhq.app/index.html` | 404 |
| `https://igniteclubhq.app/live-index.html` | **200** |
| `https://igniteclubhq.app/.well-known/ii-alternative-origins` | 200 |

A 200 on `/live-index.html` with a 404 on `/` proves the published folder was
fully populated — it simply had no file named `index.html`.

## Cause

The live build's HTML entry is `frontend/live-index.html`
(`rollupOptions.input` in `frontend/vite.live.config.ts`, `outDir`
`dist-live`), so `npm run build:live` writes `dist-live/live-index.html` and
never `dist-live/index.html`.

`netlify.toml` publishes `frontend/dist-live` as-is and rewrites every page
route to `/index.html`, which did not exist — so `/` and every deep link 404'd.

Every other consumer of the same build already performed the copy, which is
why the bug only appeared on Netlify:

- `scripts/build-preview.mjs` — copies `dist-live/live-index.html` to
  `dist/index.html` for the Lovable preview.
- `scripts/prod-hybrid-build.mjs` — copies it into `dist/index.html`.
- `frontend/scripts/prepare-canister-dist.mjs` — copies it into
  `dist-canister/index.html` for the ICP frontend canister.
- `codemagic.yaml` — `[ -f dist-live/index.html ] || cp dist-live/live-index.html dist-live/index.html`.

The Netlify build path (`scripts/host-build-env.mjs` -> `npm run build:live`)
had no equivalent step.

## Fix

- `frontend/scripts/ensure-live-index.mjs` (new) — `ensureLiveIndex(distDir)`
  copies `live-index.html` to `index.html`, refreshes the copy when the entry
  content differs, and throws when the entry page is absent.
- `frontend/scripts/build-live.mjs` — calls `ensureLiveIndex` on
  `frontend/dist-live` after a successful Vite build, and now exits non-zero
  on a failed build instead of exiting before the copy. A hosting build can no
  longer publish a folder with no servable page.
- `frontend/scripts/ensure-live-index.test.mjs` (new) — three checks: the copy
  is created, a stale `index.html` is replaced on rebuild, and the build stops
  when `live-index.html` is missing.

## Verification

- `node --test frontend/scripts/ensure-live-index.test.mjs` — 3 pass, 0 fail.
- Real live build `node frontend/scripts/build-live.mjs` — exit 0, built in
  ~30s; `frontend/dist-live/index.html` and `frontend/dist-live/live-index.html`
  both present, byte-identical (406 bytes), and `index.html` references the
  built `/assets/live-index-*.js` and `.css`.
- Not yet observed on the live site: the fix has to reach the `prod` branch
  and be published before igniteclubhq.app serves again.

## Remaining step

Merge `main` into `prod` with **Create a merge commit** (same as the previous
merge). The database and live-services promotions run again and change nothing
(the live services already match), then the website build publishes a folder
that contains `index.html`, and `/` plus every deep link serve normally.

Unrelated and still open: creating the live frontend canister (one-off
`CREATE PROD FRONTEND` run) is separate work and does not affect this fix.
