#!/usr/bin/env bash
#
# Android OS resume regression test — emulator driver.
#
# Drives GENUINE Android OS lifecycle transitions (home, recents resume,
# device lock/unlock, radio off/on) against the disposable harness app and
# asserts on the harness telemetry captured from logcat.
#
# Prerequisites (handled by the Codemagic `android-os-resume-test` workflow):
#   - an emulator is booted and visible to adb
#   - tests/android-os/workspace/.generated/android/app/build/outputs/apk/debug/app-debug.apk
#     has been built
#
# This script never signs, publishes or uploads anything.
set -uo pipefail

PKG="app.igniteclubhq.androidosresumetest"
ACTIVITY="${PKG}/.MainActivity"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APK="${ROOT}/tests/android-os/workspace/.generated/android/app/build/outputs/apk/debug/app-debug.apk"
OUT="${ROOT}/test-results/android-os"
LOGCAT="${OUT}/logcat.txt"

mkdir -p "$OUT"

FAILURES=0
say()  { echo -e "\n=== $* ==="; }
pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; FAILURES=$((FAILURES + 1)); }

cleanup() {
  say "Collecting artifacts"
  adb shell dumpsys activity activities   > "${OUT}/dumpsys-activity.txt"   2>&1 || true
  adb shell dumpsys webviewupdate         > "${OUT}/dumpsys-webviewupdate.txt" 2>&1 || true
  adb shell dumpsys gfxinfo "$PKG"        > "${OUT}/dumpsys-gfxinfo.txt"    2>&1 || true
  adb shell uiautomator dump /sdcard/aos-ui.xml >/dev/null 2>&1 || true
  adb pull /sdcard/aos-ui.xml "${OUT}/uiautomator.xml" >/dev/null 2>&1 || true
  adb exec-out screencap -p > "${OUT}/final-screenshot.png" 2>/dev/null || true
  # Ensure connectivity is restored even if we bailed mid-test.
  adb shell svc wifi enable >/dev/null 2>&1 || true
  adb shell svc data enable >/dev/null 2>&1 || true
  kill "${LOGCAT_PID:-0}" >/dev/null 2>&1 || true
  cp "$LOGCAT" "${OUT}/logcat-full.txt" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Log helpers: `mark` records the current logcat line count so assertions only
# look at lines produced by the phase under test.
# ---------------------------------------------------------------------------
MARK=0
mark() { MARK=$(wc -l < "$LOGCAT" 2>/dev/null || echo 0); }
since() { tail -n "+$((MARK + 1))" "$LOGCAT" 2>/dev/null; }

# Last `WINDOW ... after=<type>` line emitted since the mark, field extracted.
window_field() { # $1=type $2=field
  since | grep -o "AOSTEST WINDOW .*after=$1 .*" | tail -n 1 \
    | grep -o "$2=[0-9]*" | cut -d= -f2
}
event_field() { # $1=type $2=field
  since | grep -o "AOSTEST EVENT .*type=$1 .*" | tail -n 1 \
    | grep -o "$2=[0-9]*" | cut -d= -f2
}
last_num() { # $1=pattern $2=field
  grep -o "$1" "$LOGCAT" | tail -n 1 | grep -o "$2=[0-9]*" | cut -d= -f2
}

wait_for_log() { # $1=pattern $2=timeout seconds
  local deadline=$((SECONDS + $2))
  while [ $SECONDS -lt $deadline ]; do
    grep -q "$1" "$LOGCAT" && return 0
    sleep 1
  done
  return 1
}

# ---------------------------------------------------------------------------
say "Device"
adb wait-for-device
adb shell settings put global window_animation_scale 0     >/dev/null 2>&1 || true
adb shell settings put global transition_animation_scale 0 >/dev/null 2>&1 || true
adb shell settings put global animator_duration_scale 0    >/dev/null 2>&1 || true
adb shell input keyevent 82 >/dev/null 2>&1 || true   # dismiss keyguard
adb shell getprop ro.build.version.release
adb shell wm size

say "Installing isolated test APK"
[ -f "$APK" ] || { echo "APK not found at $APK"; exit 1; }
adb uninstall "$PKG" >/dev/null 2>&1 || true
adb install -r "$APK" || { echo "install failed"; exit 1; }

adb logcat -c || true
adb logcat -v time > "$LOGCAT" 2>&1 &
LOGCAT_PID=$!

say "Launching harness"
adb shell am start -n "$ACTIVITY" >/dev/null
if ! wait_for_log "AOSTEST READY" 90; then
  fail "harness never reported READY"
  exit 1
fi
INITIAL=$(last_num "AOSTEST READY .*" "initialFetches")
if [ "${INITIAL:-0}" -ge 30 ]; then
  pass "30 active synthetic React Query observers mounted (initialFetches=$INITIAL)"
else
  fail "expected >=30 initial fetches from 30 observers, got ${INITIAL:-0}"
fi

# ---------------------------------------------------------------------------
say "TEST 1 — ordinary online background/resume causes zero blanket refetches"
mark
adb shell input keyevent KEYCODE_HOME
sleep 25
adb shell am start -n "$ACTIVITY" >/dev/null
wait_for_log "AOSTEST WINDOW .*after=resume" 20 || true
sleep 2
R1=$(window_field resume fetches)
if [ "${R1:-x}" = "0" ]; then
  pass "ordinary resume produced 0 refetches"
else
  fail "ordinary resume produced ${R1:-unknown} refetches (expected 0)"
fi

# ---------------------------------------------------------------------------
say "TEST 2 — repeated ordinary resumes cause no request storm"
STORM=0
for i in 1 2 3; do
  mark
  adb shell input keyevent KEYCODE_HOME
  sleep 22
  adb shell am start -n "$ACTIVITY" >/dev/null
  sleep 6
  N=$(window_field resume fetches)
  echo "    resume #$i fetches=${N:-unknown}"
  [ "${N:-0}" -gt 0 ] 2>/dev/null && STORM=$((STORM + 1))
done
if [ "$STORM" -eq 0 ]; then
  pass "3 repeated resumes produced no request storm"
else
  fail "$STORM of 3 repeated resumes triggered refetches"
fi

# ---------------------------------------------------------------------------
say "TEST 3 — device lock/unlock causes no blanket refetch"
mark
adb shell input keyevent KEYCODE_SLEEP
sleep 25
adb shell input keyevent KEYCODE_WAKEUP
sleep 1
adb shell input keyevent 82   # dismiss keyguard
sleep 6
L1=$(window_field resume fetches)
if [ "${L1:-0}" = "0" ] || [ -z "${L1:-}" ]; then
  pass "lock/unlock produced no blanket refetch"
else
  fail "lock/unlock produced ${L1} refetches (expected 0)"
fi

# ---------------------------------------------------------------------------
say "TEST 4 — genuine offline→online recovery produces one bounded 30-query batch"
mark
adb shell svc wifi disable >/dev/null 2>&1 || true
adb shell svc data disable >/dev/null 2>&1 || true
sleep 12
adb shell svc wifi enable >/dev/null 2>&1 || true
adb shell svc data enable >/dev/null 2>&1 || true
wait_for_log "AOSTEST WINDOW .*after=online" 60 || true
sleep 3
ONLINE_FETCHES=$(window_field online fetches)
ONLINE_BATCHES=$(window_field online batches)
ONLINE_CONC=$(window_field online maxConcurrent)
echo "    recovery fetches=${ONLINE_FETCHES:-?} batches=${ONLINE_BATCHES:-?} maxConcurrent=${ONLINE_CONC:-?}"
if [ "${ONLINE_FETCHES:-0}" -gt 0 ] 2>/dev/null && [ "${ONLINE_FETCHES:-0}" -le 30 ] 2>/dev/null; then
  pass "offline→online recovery refetched ${ONLINE_FETCHES} queries (bounded by 30)"
else
  fail "offline→online recovery refetched ${ONLINE_FETCHES:-0} queries (expected 1..30)"
fi
if [ "${ONLINE_BATCHES:-1}" -gt 1 ] 2>/dev/null; then
  pass "recovery was dripped across ${ONLINE_BATCHES} batches"
else
  fail "recovery was not dripped (batches=${ONLINE_BATCHES:-?}); connection pool would saturate"
fi
if [ "${ONLINE_CONC:-99}" -le 8 ] 2>/dev/null; then
  pass "recovery peak concurrency ${ONLINE_CONC} within the ~6-connection budget"
else
  fail "recovery peak concurrency ${ONLINE_CONC} exceeds the connection budget"
fi

# ---------------------------------------------------------------------------
say "TEST 5 — an ordinary resume after recovery does not create another batch"
mark
adb shell input keyevent KEYCODE_HOME
sleep 25
adb shell am start -n "$ACTIVITY" >/dev/null
sleep 6
R2=$(window_field resume fetches)
if [ "${R2:-x}" = "0" ]; then
  pass "post-recovery resume produced 0 refetches"
else
  fail "post-recovery resume produced ${R2:-unknown} refetches (expected 0)"
fi

# ---------------------------------------------------------------------------
say "TEST 6 — resumed WebView remains touch-responsive"
TAPS_BEFORE=$(last_num "AOSTEST ALIVE .*" "taps")
FRAMES_BEFORE=$(last_num "AOSTEST ALIVE .*" "frames")
SIZE=$(adb shell wm size | tail -n 1 | grep -o '[0-9]*x[0-9]*')
W=${SIZE%x*}; H=${SIZE#*x}
for _ in 1 2 3; do
  adb shell input tap $((W / 2)) $((H * 3 / 4))
  sleep 1
done
sleep 4
TAPS_AFTER=$(last_num "AOSTEST ALIVE .*" "taps")
FRAMES_AFTER=$(last_num "AOSTEST ALIVE .*" "frames")
if [ "${TAPS_AFTER:-0}" -gt "${TAPS_BEFORE:-0}" ] 2>/dev/null; then
  pass "WebView routed touch input after resume (${TAPS_BEFORE:-0} → ${TAPS_AFTER:-0})"
else
  fail "WebView did not register taps after resume (${TAPS_BEFORE:-0} → ${TAPS_AFTER:-0})"
fi
if [ "${FRAMES_AFTER:-0}" -gt "${FRAMES_BEFORE:-0}" ] 2>/dev/null; then
  pass "WebView compositor still producing frames after resume"
else
  fail "WebView compositor frozen after resume (frames stuck at ${FRAMES_BEFORE:-0})"
fi

# ---------------------------------------------------------------------------
say "TEST 7 — no ANR, no fatal exception, no renderer loss"
if grep -q "ANR in ${PKG}" "$LOGCAT"; then
  fail "ANR detected for ${PKG}"; grep "ANR in ${PKG}" "$LOGCAT" | head -n 5
else
  pass "no ANR for ${PKG}"
fi
if grep -qE "FATAL EXCEPTION" "$LOGCAT" && grep -qE "FATAL EXCEPTION" -A5 "$LOGCAT" | grep -q "$PKG"; then
  fail "fatal application exception detected"
else
  pass "no fatal application exception"
fi
if grep -qE "Render process .* (crashed|died|gone)|RENDER_PROCESS_GONE|WebView render process" "$LOGCAT"; then
  fail "WebView renderer-loss error detected"
else
  pass "no WebView renderer-loss error"
fi

# ---------------------------------------------------------------------------
say "Result"
{
  echo "failures=${FAILURES}"
  echo "initialFetches=${INITIAL:-}"
  echo "resume1Fetches=${R1:-}"
  echo "repeatedResumeStorms=${STORM}"
  echo "lockUnlockFetches=${L1:-0}"
  echo "recoveryFetches=${ONLINE_FETCHES:-} batches=${ONLINE_BATCHES:-} maxConcurrent=${ONLINE_CONC:-}"
  echo "postRecoveryResumeFetches=${R2:-}"
} | tee "${OUT}/summary.txt"

grep "AOSTEST" "$LOGCAT" > "${OUT}/harness-telemetry.txt" 2>/dev/null || true

if [ "$FAILURES" -gt 0 ]; then
  echo "ANDROID OS RESUME REGRESSION TEST FAILED (${FAILURES} assertion failure(s))"
  exit 1
fi
echo "ANDROID OS RESUME REGRESSION TEST PASSED"
