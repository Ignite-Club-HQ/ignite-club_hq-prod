# Android Keyboard Show / Hide Regression Checklist

Run this checklist on **real Android hardware** after any change touching:

- `index.html` viewport meta (`interactive-widget`)
- `src/hooks/useNativeKeyboardHeight.ts`
- `src/hooks/useNativeAndroidKeyboardState.ts`
- `src/components/chat/ChatMessagesScroller.tsx`
- Chat page `handleReply` callbacks (`ClubChatPage`, `TeamChatPage`, `BroadcastChatPage`, `GroupChatPage`, `DMChatPage`)
- Composer components (`ChatComposer`, `MobileChatComposer`, reply-pill height, auto-focus logic)
- App layout / bottom nav / `useKeyboardOpen` / status-bar control

The Android emulator's soft keyboard does NOT reproduce real Gboard / Samsung Keyboard IME quirks (predictive bar height changes, `visualViewport` shrink races, split-screen). Always validate on a physical device.

---

## Setup

- [ ] Test in **Lovable Preview** (Chrome on Android) — verifies the web / `resizes-content` path.
- [ ] Test in a **release-mode native APK** (`npm run build` → `npx cap sync android` → assemble release / Codemagic artifact) — verifies the Capacitor `Keyboard.resize: 'none'` path.
- [ ] Test on at least one **Samsung device** (One UI / Samsung Keyboard notorious for viewport-shrink races) AND one **Pixel / stock Android device** (Gboard reference behavior).
- [ ] Test on Android **14+** and one older version (e.g. Android 12) if the app supports it.
- [ ] Sign in as a user who is a member of a chat with several messages (enough to scroll).
- [ ] Ensure the latest message is from another user (so you can clearly see whether it stays visible above the composer).

---

## Preview (Chrome on Android) — `interactive-widget=resizes-content`

Open the Lovable preview URL in Chrome on Android.

### Basic composer focus

- [ ] Tap the composer in a **Team Chat** → keyboard opens, composer slides up, and the **latest message stays fully visible** above the composer (not clipped behind it).
- [ ] Tap the composer in a **Club Chat** → same — latest message visible above composer.
- [ ] Tap the composer in a **Group Chat** → same.
- [ ] Tap the composer in a **DM** → same.

### Reply-to-message focus

- [ ] Long-press a message and tap **Reply** in a **Team Chat** → reply pill appears, keyboard opens, and the message you are replying to (and the latest message below it) stays visible.
- [ ] Repeat in **Club Chat**, **Group Chat**, **Broadcast Chat**, and **DM**.

### Multi-line typing

- [ ] Type enough text in the composer that it grows to 3–4 lines → composer height increases, and the chat content shifts up so the latest message remains visible (not buried behind the taller composer).

### Keyboard dismiss

- [ ] Tap the system back button (gesture or button) while the keyboard is open → keyboard closes smoothly, composer drops to bottom, and the scroll position is stable (no jump to top or wild re-pin).
- [ ] Tap a message bubble while the keyboard is open → keyboard closes, scroll stays where you tapped.

---

## Native App (Capacitor APK) — `Keyboard.resize: 'none'`

Install the release APK and run the same scenarios. Native behavior diverges from preview because the keyboard inset is driven by the Capacitor Keyboard plugin, not the browser's `interactive-widget`.

### Basic composer focus

- [ ] Tap the composer in a **Team Chat** → keyboard opens, `keyboardWillShow` fires, the chat shell shrinks by the full keyboard height on the **same frame**, and the latest message is visible above the composer.
- [ ] Repeat in **Club Chat**, **Group Chat**, **Broadcast Chat**, and **DM**.
- [ ] **Critical:** the latest message does NOT briefly appear behind the composer and then snap up — it should be correctly positioned immediately.

### Reply-to-message focus

- [ ] Long-press a message and tap **Reply** in a **Team Chat** → reply pill renders, composer focuses, keyboard opens, and the scroller re-pins to bottom at 0ms / 180ms / 480ms. The latest message stays visible through all stages.
- [ ] Repeat in **Club Chat**, **Group Chat**, **Broadcast Chat**, and **DM**.

### Multi-line typing

- [ ] Type until the composer grows to 3–4 lines → the composer height increase triggers the scroller's composer-grew compensation. The visible chat content shifts up by the exact delta so what you were reading stays in view.
- [ ] While scrolled **up in history** (not at bottom), grow the composer → the scroll position compensates in place; you are NOT yanked back to the latest message.

### Keyboard dismiss

- [ ] Tap the system back button → keyboard closes, chat shell restores to full height, no scroll jump.
- [ ] Tap a message bubble while keyboard is open → keyboard closes, scroll stays at the tapped message.
- [ ] Swipe down on the message list to dismiss the keyboard (if the OS supports it) → smooth close, no jump.

### Predictive text / Gboard toolbar

- [ ] Enable **Gboard suggestions** and type a word that triggers the predictive strip → the strip appears above the keyboard. The chat shell should NOT jitter or double-shrink; the composer stays anchored and the latest message stays visible.
- [ ] Toggle **Gboard voice-input toolbar** (mic icon) → toolbar height changes, no jitter, latest message visible.

---

## Edge cases

### Device rotation

- [ ] With the keyboard open, rotate the device **portrait → landscape** → keyboard may hide or resize. The composer and chat layout should settle correctly when rotated back to portrait.
- [ ] With the keyboard open, rotate **landscape → portrait** → no stuck keyboard height, composer returns to correct position.

### Backgrounding mid-keyboard

- [ ] Open the keyboard in a chat, then press the home button / switch apps. Return to the app → the keyboard state should be sane (either restored open with correct scroll, or closed with correct scroll). No blank space where the keyboard used to be.

### Rapid open / close

- [ ] Rapidly tap the composer and the back button 3–4 times in quick succession → no accumulated ghost insets, no composer stuck floating with no keyboard, no latest message clipped.

### Split-screen / foldables

- [ ] On a foldable or tablet, enter **split-screen** mode with the app in the bottom half. Open the keyboard → the app should use the reduced window height correctly, and the latest message stays visible.

### Swipe-to-reply while keyboard open

- [ ] With the keyboard already open, swipe right on a message to reply → reply pill appears, composer stays focused, keyboard stays open, latest message visible.

---

## Regression signals to watch

If any of the following appear, the fix is NOT working:

- Latest message is **partially or fully hidden behind the composer** when the keyboard opens.
- Reply-to-message leaves the latest message **clipped behind the composer** after the 480ms settle.
- Composer focus causes a **scroll jump to top** instead of pinning to bottom.
- Keyboard dismiss causes the chat to **snap to the most recent message** when the user was reading history.
- **Blank gap** between the composer and the message list (double-counted nav offset or failed inset compute).
- **Composer floating** with empty space below it (ghost keyboard inset).

---

## When to re-run this checklist

- Any PR touching the files listed at the top of this doc.
- Any Capacitor or `@capacitor/keyboard` plugin upgrade.
- Any Android OS major version upgrade (test on the new OS as soon as it ships).
- Any change to `useKeyboardOpen`, `useNativeKeyboardHeight`, app layout, bottom nav, or composer components.
