# In-App Text Size & Accessibility Settings

Add a user-controlled text size setting (plus a couple of bundled accessibility wins) without enabling pinch-to-zoom. Goal: better readability for users with vision issues, zero impact on chat gestures, pitch board, or fixed UI.

## What the user gets

1. **Text size slider** in Profile → Settings → Accessibility
   - 5 steps: Small (90%), Default (100%), Large (115%), Larger (130%), Largest (150%)
   - Live preview as they drag
   - Persists per-user (localStorage with `ignite_` prefix, synced to `profiles.accessibility_prefs` jsonb so it follows them across devices)
2. **High contrast toggle** — boosts `--foreground` / `--muted-foreground` contrast for users on light themes
3. **Reduce motion toggle** — disables typewriter, carousels auto-advance, non-essential transitions (respects OS `prefers-reduced-motion` by default, this lets users force it on)
4. **Bold text toggle** — bumps body weight from 400 → 500 for users who find thin text hard to read

All four live on one screen with clear labels and a "Reset to defaults" button.

## How it works (technical)

**Root font-size scaling**
- Set `font-size` on `<html>` via a CSS variable `--app-font-scale` (default `1`)
- Tailwind's `rem`-based spacing/sizing already scales correctly because shadcn/Tailwind use `rem` for text and most spacing
- Audit ~10 components that hardcode `px` font sizes (chat composer, recap sheet titles, a few headers) and convert to `text-base` / `text-lg` tokens so they scale too
- Cap the scaler at 1.5× to prevent layout breakage on fixed-height headers/FABs

**What does NOT scale (intentional)**
- Pitch board (fixed canvas, would break positioning)
- Avatar sizes, icon sizes (visual chrome, not reading content)
- Sticky header height, bottom nav height (fixed for touch targets)
- Image dimensions in media gallery

**Storage**
- `profiles.accessibility_prefs jsonb` column (default `{}`)
- Shape: `{ textScale: 1.15, highContrast: false, reduceMotion: false, boldText: false }`
- Loaded once at app boot in a new `useAccessibilityPrefs` hook, applied to `<html>` via CSS vars and class toggles
- localStorage cache for instant first-paint, server is source of truth on login

**High contrast**
- Adds `class="hc"` to `<html>`
- `index.css` overrides: `.hc { --muted-foreground: <darker>; --border: <stronger>; }`
- ~15 token overrides, no per-component changes needed

**Reduce motion**
- Adds `class="rm"` to `<html>`
- Existing `useStaticReveal` already checks native; extend to also check this class
- Disable `animate-*` Tailwind utilities via a global `.rm *` CSS rule targeting non-essential animations

**Bold text**
- Adds `class="bt"` to `<html>`
- `.bt body { font-weight: 500; }` and bumps `.bt .font-medium` → 600

## Files touched

- New: `src/hooks/useAccessibilityPrefs.tsx`
- New: `src/pages/AccessibilitySettingsPage.tsx`
- New: `src/components/accessibility/TextSizeSlider.tsx`
- Edit: `src/index.css` — add CSS vars, `.hc`/`.rm`/`.bt` rules
- Edit: `src/App.tsx` — mount prefs hook at root
- Edit: `src/pages/ProfilePage.tsx` — add "Accessibility" row linking to new page
- Edit: ~10 components with hardcoded `px` font sizes → token classes
- Migration: add `accessibility_prefs jsonb default '{}'` to `profiles`
- Edit: `src/lib/typewriterScheduler.ts` + `useStaticReveal` to honour reduce-motion class

## What I won't change

- Viewport meta tag stays `user-scalable=no` (pinch-zoom remains off — protects chat gestures, pitch board, image viewer)
- No changes to icon sizes, tap targets, or layout dimensions
- Pitch board untouched
- Chat message bubbles scale with text; bubble max-width stays in `%` so they reflow cleanly

## Risks & mitigations

- **Layout overflow at 1.5×**: Cap headers/FABs at fixed `px` heights, let text inside ellipsis-truncate. Tested combos before ship.
- **Sticky header crowding**: At 1.3×+, header title uses `truncate` instead of growing.
- **Cross-device drift**: Server-synced prefs ensure consistency; localStorage is just first-paint cache.

## Effort estimate

~1 focused session:
- 30 min: migration + hook + CSS vars wiring
- 45 min: settings page UI + slider component
- 45 min: audit hardcoded `px` font sizes, convert to tokens
- 30 min: high-contrast token overrides + bold/reduce-motion classes
- 30 min: QA at each scale step across Home, Chat, Media, Events, Pitch Board

Want me to build it as scoped, or adjust anything first (different scale steps, drop one of the toggles, add a different one)?
