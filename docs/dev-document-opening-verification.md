# DEV document opening and export

## Cause and entry points

- Competition and ordinary chat file tokens render `VaultFileCard` in both message renderers. It reads the file through existing authorized Vault queries, then used `safeOpenFile`.
- Vault rows and their Open menu also used `safeOpenFile`. The Download menu previously used browser anchors, even in native apps; that did not provide a native accessible-save guarantee.
- Chat's shared-files list previously navigated to the Vault rather than opening the selected file. File entries now use the same authorized file card and document action pipeline.
- `safeOpenFile` previously loaded FileOpener through a `new Function` bare package import. Vite cannot bundle that runtime import; a packaged WebView has no package resolver. Import failure was caught and Open silently fell through to Share. A generic MIME retry could also hide the correct document handler.
- The Browser branch was present in source, but came **after** automatic sharing and did not open cached DOCX/XLSX through a native viewer. The specific installed phone bundle was not inspected; no claim is made about which source commit it contains.

## Implemented

- Bundle the installed FileOpener package using a normal import. Android uses the plugin's ACTION_VIEW chooser with the exact document MIME. iOS uses its document-preview branch, not its activity/share branch.
- Open never invokes Share. PDF-only authorized Browser fallback is allowed if native preview fails; launching Browser does not prove that every phone renders a PDF. Other failures show Download and Share as explicit commands.
- All actions resolve authorization/decryption first. Recognized private files receive fresh 120-second signed URLs; these document URLs are not added to persistent caches. Existing storage access policies and competition/file queries remain unchanged.
- Preserve safe names/extensions, prefer recognized file extensions over generic/misleading server MIME, download to unique native cache paths, retain decrypted WebView bytes for ICP files, and serialize repeated taps on the same file.
- Download uses Android ACTION_CREATE_DOCUMENT or iOS UIDocumentPicker export-as-copy. Android resolves success only after writing and closing the destination stream; iOS resolves after the selected export completes. Cancellation is not reported as a saved file.
- Share uses the cached authorized copy only when selected. Web touch downloads/shares offer a fresh explicit action after bytes are prepared to preserve browser user activation.
- Web Open reserves its tab synchronously, checks the authorized response, and reports blocked windows or missing/expired/denied files. Web Download fetches nonempty authorized bytes with a safe filename.
- Codemagic's four existing workflows run the document wiring step after Capacitor sync. Android verifies FileOpener registration and configures viewer package visibility; the installed plugin supplies its nonexported FileProvider, cache paths and read-URI grants. The workflow adds a no-viewer check before the chooser. iOS verifies the FileOpener SPM dependency and registers the export plugin through its bridge subclass.

## Checks completed

- Focused email-mode suite: 97 passing, 3 existing skipped checks across MIME resolution, Open/Share separation, save/cancel/failure, duplicate taps, private-file refusal, fresh signing, web popup failures, chat file dispatch and calendar nonregression.
- Native wiring rehearsal: two Python tests pass for repeatable Android/iOS registration and export wiring. Actual native Java/Swift compilation is not verified in this Linux sandbox.
- Playwright exercised the real shared helper on localhost with a bounded PDF fixture: nonempty `Check.pdf` download (39-byte dispatch fixture, not a PDF rendering acceptance file), a separate document tab, a specific blocked-window error and zero page errors. This is helper-level web verification, not a signed-in referee chat/Vault acceptance test.
- Preview compilation passed after changes.

## Held verification before promotion

- No Android device/Google Docs/Sheets or iPhone is connected; actual DOCX/PDF/XLSX rendering, no-viewer behavior, accessible export destinations and explicit Share sheets remain unverified on real phones.
- External user-managed Supabase does not permit managed session minting. Actual authorized-referee opening and unauthorized-user denial through signed-in UI are not verified; mocked refusal/signing tests do not establish live access acceptance.
- Install a DEV native build to test referee chat and Vault with the same files; verify both permitted and denied accounts without altering production data. No production publication, bucket changes, migrations or production data writes were performed.
- Installed apps need a new native build. A local native checkout must be updated from the connected repository and synced with `npx cap sync`, then run the document wiring step for the platform before building (Codemagic already runs these steps).