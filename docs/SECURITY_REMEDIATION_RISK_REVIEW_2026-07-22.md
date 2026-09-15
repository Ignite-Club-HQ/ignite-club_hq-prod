# Ignite Club HQ Security Remediation Risk Review

**Assessment date:** 22 July 2026

## Executive conclusion

The dependency and source-security findings should not be fixed in one bulk update. Some changes are low-risk patch releases, while Firebase, Capacitor, Fabric, Vite and ExcelJS require feature-specific validation.

An important correction from the initial security review is:

> Do not remove the `firebase` package. `@capacitor-firebase/messaging@8.0.1` declares `firebase ^12.6.0` as a peer dependency, so removal could break native push messaging or native builds.

No dependency, production code, database or environment was changed during this review.

## Risk summary

| Proposed change | Functional risk | Security priority | Recommendation |
|---|---:|---:|---|
| jsPDF `4.2.0 → 4.2.1` | Low | High | Do first |
| React Router `6.30.1 → 6.30.4` | Low–medium | High | Do second |
| Remove Firebase | High | Not applicable | Do not do |
| Firebase `12.7.0 → 12.16.0` | Medium | High | Separate native-aware change |
| Capacitor CLI `8.0.0 → 8.0.2+` | Medium | High for build environment | Separate native-tooling change |
| Fabric `7.2.0 → 7.4.0` | Medium | Moderate | Test pitch drawing thoroughly |
| Fix reminder-email HTML rendering | Low–medium | Medium–high | Safe with formatting/security tests |
| Upgrade Vite 5 to Vite 8 | High | Low for the deployed static application | Do not rush |
| Apply `npm audit fix --force` | Very high | Not applicable | Do not use |
| Downgrade ExcelJS to `3.4.0` | High | Moderate | Do not do |

## 1. jsPDF

### Recommendation

Update `jspdf` from `4.2.0` to `4.2.1` in an isolated commit.

### Risk assessment

Risk is low. Both versions use the same dependency set. Ignite uses jsPDF only in `VideoGuideDownloadPage.tsx`, where it creates a PDF from hard-coded guide content using basic text, wrapping, line and page APIs. It does not use the vulnerable HTML rendering path or user-controlled content.

Possible regressions are limited primarily to font spacing, line wrapping, page breaks or download behavior.

### Validation

- Run the application build.
- Run the complete baseline.
- Download the video guide PDF manually.
- Open the PDF and verify headings, bullets, wrapping and page breaks.

## 2. React Router

### Recommendation

Update within React Router 6:

```text
react-router-dom 6.30.1 → 6.30.4
react-router     6.30.1 → 6.30.4
@remix-run/router 1.23.0 → 1.23.3
```

### Risk assessment

Risk is low to medium. This is a same-line patch update and does not require adopting Router 7 APIs. Routing is nevertheless central to authentication, invites, joins, password reset, notification taps and deep links.

### Existing protection

Tests exist for authentication redirects, competition joins, invite dialogs, short invites, push navigation, notification launch handling and path normalization.

### Validation

- Run the complete baseline.
- Run the authentication Playwright journey.
- Exercise club, team and competition invitations.
- Exercise authenticated and unauthenticated deep links.
- Test password-reset navigation.
- Test push-notification navigation.

## 3. Firebase

### Recommendation

Do not remove Firebase. Plan a controlled same-major upgrade from `12.7.0` toward `12.16.0`.

### Dependency constraint

```text
@capacitor-firebase/messaging@8.0.1
└── firebase ^12.6.0
```

Firebase introduces the vulnerable Protobuf and WebSocket dependency paths. Although Ignite does not directly import Firebase web APIs, the native messaging plugin requires Firebase as a peer dependency.

### Risk assessment

Risk is medium because an upgrade can affect FCM tokens, push registration, foreground/background delivery, native dependency resolution and token refresh. Mocked browser tests cannot prove real Android or iOS behavior.

### Validation

- Run the complete baseline.
- Run `npx cap sync android` and the Android debug build.
- Run the corresponding maintained iOS sync/build.
- Install on a physical Android device.
- Approve notifications and confirm an FCM token is stored.
- Send a real test notification.
- Test foreground, background and terminated-app delivery.
- Tap notifications and verify navigation.
- Confirm token refresh and re-registration.
- Confirm Crashlytics still initializes.

Do not combine this change with a Capacitor CLI update.

## 4. Capacitor CLI and `tar`

### Recommendation

Trial `@capacitor/cli 8.0.2` as the smallest targeted change before considering broader Capacitor 8 updates.

Current path:

```text
@capacitor/cli 8.0.0
└── tar 6.2.1
```

CLI `8.0.2` changes its dependency to `tar ^7.5.3`, which should resolve to a patched release such as the current `7.5.21` when the lockfile is regenerated.

### Risk assessment

Risk is medium. Possible impacts include generated Android/iOS changes, plugin synchronization, Gradle or CocoaPods output and Codemagic builds.

### Validation

- Inspect all lockfile and generated native-project changes.
- Do not commit unexplained generated changes.
- Run Android and iOS sync/builds.
- Run the complete web baseline.
- Test at least one physical mobile build.

## 5. Fabric

### Recommendation

Update `fabric 7.2.0 → 7.4.0` only after establishing drawing compatibility tests.

### Risk assessment

Risk is medium. Fabric is lazy-loaded by `useLazyFabric.ts` and powers pitch-board drawing. It affects freehand drawing, arrows, canvas coordinates, resizing, orientation, saved drawing JSON and restored formations.

The most important risk is compatibility with drawings persisted by Fabric 7.2 using `toJSON()` and restored with `loadFromJSON()`.

### Validation

- Load an existing synthetic drawing produced by version 7.2.
- Verify lines, arrows, colours and positions.
- Create, save and reload a new drawing.
- Switch portrait and landscape orientations.
- Resize the viewport.
- Test touch input on a mobile device.
- Test clear and relevant undo behavior.
- Confirm drawing operations do not shift player positions.
- Run pitch-board and AutoSubs tests.

## 6. Reminder-email HTML rendering

### Recommendation

Replace dynamic `dangerouslySetInnerHTML` construction in `send-event-view-reminder` with React elements and escaped text nodes. Validate `primaryColor` against a strict supported CSS colour format.

### Risk assessment

Risk is low to medium. A careless change could affect bold styling, spacing, RSVP wording, CTA presentation or club colours, but it should not alter delivery logic.

### Safe implementation rules

- Preserve the exact wording.
- Use React `<strong>` elements for intended emphasis.
- Keep event, team and club names as React text children.
- Validate colours, preferably as six-digit hexadecimal values.
- Do not introduce a generic sanitizer unless arbitrary HTML is a requirement.
- Render the email to static HTML in tests.
- Verify hostile names are escaped rather than interpreted as markup.

Suggested hostile inputs include:

```text
<img src=x onerror=alert(1)>
Club "><a href="https://evil.example">Support</a>
```

## 7. Vite

### Recommendation

Do not rush a Vite 8 migration merely to reduce the audit count.

The project currently uses Vite `5.4.19`; `5.4.21` is the final Vite 5 release, but it does not resolve every currently reported advisory. Vite 8 is a major upgrade that affects Node requirements, React plugins, Lovable tagging, PWA/workbox behavior, Vitest, dynamic imports and Capacitor web assets.

Most relevant Vite advisories affect the development server rather than the deployed static bundle.

### Interim mitigations

- Do not expose the development server publicly.
- Bind local test servers to `127.0.0.1`.
- Do not open untrusted repositories or files through the dev server.
- Continue using ephemeral GitHub Actions runners.
- Treat Vite/PWA/Vitest migration as a separate engineering project.

## 8. ExcelJS

### Recommendation

Do not accept npm's proposed downgrade from `exceljs 4.4.0` to `3.4.0`.

Ignite uses ExcelJS in `FixturesCSVImport.tsx`. A downgrade could change workbook and worksheet APIs, CSV parsing, dates, formulas and browser bundling.

Safer options are:

- Wait for a maintained patched ExcelJS release.
- Test a targeted transitive override independently.
- Consider a maintained replacement if ExcelJS is no longer maintained.
- Add oversized and malformed fixture-import tests.

## Recommended rollout

### Batch 1: lowest-risk dependency patches

1. jsPDF `4.2.1`
2. React Router `6.30.4`

Use separate commits and run the full baseline plus targeted manual checks.

### Batch 2: source security

1. Safe reminder-email rendering
2. Primary-colour validation
3. Email rendering and injection tests

Do not include dependency changes in this batch.

### Batch 3: native dependencies

1. Firebase same-major update with real-device push testing
2. Separately, Capacitor CLI `8.0.2` with native sync/build checks

### Batch 4: feature-specific dependency

1. Fabric `7.4.0`
2. Drawing persistence compatibility tests

### Deferred

- Vite major upgrade
- ExcelJS downgrade
- Blanket transitive overrides
- `npm audit fix --force`
- Broad update-everything changes

## Rollback rules

Every remediation batch should:

1. Change only the relevant package declaration and lockfiles, plus targeted tests where required.
2. Record the dependency tree before and after.
3. Run the complete baseline.
4. Run feature-specific manual checks.
5. Avoid database migrations.
6. Avoid unrelated backend deployments.
7. Be committed separately.
8. Be reversible with a single commit revert.

## Final recommendation

The safest immediate sequence is:

1. Patch jsPDF.
2. Patch React Router within version 6.
3. Fix reminder-email HTML construction with tests.

Firebase, Capacitor and Fabric should follow only with their native or drawing-specific checks. Vite and ExcelJS should remain deferred until dedicated migration plans exist.
