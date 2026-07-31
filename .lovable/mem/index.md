Android WebView compositor pauses on background; setupAndroidWebViewWake() forces repaint on resume (see mem://technical/android-webview-resume-repaint).
Chat Recap typewriter runs on native with slower cadence (CHAR_MS=22); GlobalChatRecapSheet keeps fetch concurrency at 2 on native. Static-reveal only triggers on prefers-reduced-motion — see mem://technical/chat-recap-native-static-reveal.
Chat metadata queries must use `.maybeSingle()` + `resolveChatMetadataState`; render `<ChatUnreachable />` on errored/paused fetches — never "chat removed" (see mem://technical/chat-metadata-gate).
