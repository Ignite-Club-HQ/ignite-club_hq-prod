# Android OS resume regression test

A real Android emulator test for the resume/reconnect regression first shipped
in commit `0ee10f109` — a blanket `refetchQueries({ type: 'active' })` on every
app resume, which saturated the ~6-connection-per-origin WebView pool and froze
Inbox / Schedule / Media / chat threads until a force-quit.

The jsdom guard tests (`src/test/resumeVsReconnectRecovery.guard.test.ts` and
friends) cover the logic. This harness covers the thing jsdom cannot: **genuine
Android OS lifecycle transitions** — home/recents, device lock/unlock, and radio
off/on — driven through `adb` against a real WebView.

## What runs

| File | Role |
| --- | --- |
| `app/` | Synthetic WebView app: 30 active React Query observers + the **real** `src/lib/reactQueryNativeAdapter.ts` |
| `vite.config.ts` | Builds `app/` into `workspace/dist` with Supabase compiled out |
| `workspace/capacitor.config.json` | Disposable Capacitor project (`app.igniteclubhq.androidosresumetest`) |
| `verify-safety.mjs` | Fails the build if any Supabase/database/signing credential or reference is present |
| `run-emulator-test.sh` | Drives the emulator and asserts on harness telemetry from logcat |
| `src/test/androidOsHarness.guard.test.ts` | Static guard: the harness stays isolated and the workflow stays unsigned |

## Assertions

1. 30 active synthetic React Query observers mount.
2. An ordinary online background/resume causes **zero** blanket refetches.
3. Repeated ordinary resumes cause no request storm.
4. Device lock/unlock causes no blanket refetch.
5. A genuine offline→online recovery produces **one bounded 30-query** recovery,
   dripped in batches with peak concurrency inside the connection budget.
6. Another ordinary resume after recovery does not create another batch.
7. The resumed WebView remains touch-responsive and keeps compositing.
8. No ANR, no fatal application exception, no WebView renderer loss.

## Safety

This test must never reach dev or prod infrastructure. Enforced by
`verify-safety.mjs` and the guard test:

- no Supabase URL, key, or client is bundled (`@/lib/supabaseAuthRetry` is
  aliased to a local stub; `VITE_SUPABASE_URL` compiles to `undefined`);
- no environment groups, no Firebase config, no signing config;
- isolated package ID `app.igniteclubhq.androidosresumetest`;
- the debug APK is a Codemagic test artifact only — never published.

The workflow **fails** if any environment variable beginning with `SUPABASE`,
`VITE_SUPABASE`, `DATABASE_URL` or `PGPASSWORD` is present.

## Running

CI: the `android-os-resume-test` workflow in `codemagic.yaml`
(`codespaces-review` branch or manual run).

Locally, with an emulator already booted:

```bash
npm run test:android-os:safety
npx vitest run src/test/androidOsHarness.guard.test.ts
npm run test:android-os:build
cd tests/android-os/workspace
../../../node_modules/.bin/cap add android
../../../node_modules/.bin/cap sync android
cd .generated/android && ./gradlew assembleDebug && cd -
cd ../..
node tests/android-os/verify-safety.mjs --post
bash tests/android-os/run-emulator-test.sh
```

Artifacts land in `test-results/android-os/`.
