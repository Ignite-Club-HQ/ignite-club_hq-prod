---
name: Composer IME composition gate
description: MentionInput must skip controlled-value reconstruction while IME composition is active so Gboard/QuickType autocorrect suggestions aren't clobbered
type: feature
---
`MentionInput` (`src/components/chat/MentionInput.tsx`) is a controlled textarea that recomputes `displayValue` from parsed segments on every input. During an active IME composition (Android Gboard always composes; iOS QuickType for some replacements), pushing a fresh value back into the textarea cancels the pending autocorrect suggestion — the user taps the suggestion and nothing changes.

Rule: `handleDisplayChange` MUST early-return while `isComposingRef.current` is true. We re-fire it on `onCompositionEnd` so the committed text is captured into the raw value. `onCompositionStart` sets the ref; `onCompositionEnd` clears it then re-runs the handler.

Related: `mem://features/chat/send-ime-flush-and-tap-gate` (blur-to-flush on send).
