---
name: Composer IME composition gate
description: MentionInput must NOT skip onChange during IME composition (Android Gboard wipes characters); only adjustHeight is gated. Reconstruction is safe.
type: feature
---
`MentionInput` (`src/components/chat/MentionInput.tsx`) is a React-controlled textarea whose `value` comes from upstream `displayValue` (derived from raw segments).

**HARD RULE: `handleDisplayChange` must NOT early-return while `isComposingRef.current` is true.** Doing so was a real, user-reported regression on Android Gboard: every keystroke fires `compositionstart`, so skipping `onChange` made the controlled `displayValue` lag the textarea, React then re-rendered with the stale value, and the typed characters vanished. Users reported "I can't type into the app, I have to send an image instead." (Juliette Tyson, 2026‑06‑17).

The original concern — Gboard autocorrect being clobbered — was actually caused by `adjustHeight` forcing `height='auto'` + reading `scrollHeight` synchronously, which re-entered the composing region. That's gated inside `adjustHeight` itself (early-return on `isComposingRef.current`). It is NOT necessary, and is harmful, to also gate `handleDisplayChange`.

Reconstruction via `reconstructRawFromDisplayEdit` is safe during composition: for plain-text edits (no overlap with an existing mention) the reconstructed string equals what Gboard just wrote, so React performs no DOM write and the pending suggestion is preserved.

Composition handlers:
- `onCompositionStart` sets the ref (used only to gate `adjustHeight` and the `useEffect`-driven `adjustHeight` after value changes).
- `onCompositionEnd` clears the ref inside `requestAnimationFrame`, then re-fires `handleDisplayChange` with the textarea's *current* value to capture any final commit and re-run height adjustment.

Related: `mem://features/chat/send-ime-flush-and-tap-gate` (blur-to-flush on send button).
