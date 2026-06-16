#!/usr/bin/env bash
#
# Run the WalletConnect Pay E2E flows one-per-invocation with native screen
# recording, keeping a video only when a flow fails. Tool-agnostic: drives
# `maestro` by default, or `ennio` (RN-only fast local runner) via RUNNER=ennio.
#
# Why per-flow: native recorders (simctl io recordVideo / adb screenrecord) have
# no concept of "flows" — they record continuously. Wrapping each flow gives one
# video per flow instead of one giant video for the whole suite.
#
# Required env:
#   PLATFORM        ios | android
#   DEVICE_ID       iOS simulator UDID (ios) — ignored on android (uses adb)
#   FLOWS_DIR       directory containing pay_*.yaml (default: .maestro)
#   OUT_DIR         artifact dir for logs + kept videos (default: maestro-artifacts)
#   APP_ID, WPAY_*  passed through to the flows
# Optional env:
#   RUNNER          maestro (default) | ennio
#   MAESTRO_BIN     path to maestro (default: $HOME/.maestro/bin/maestro)
#   INCLUDE_TAGS    maestro --include-tags value (default: pay; ignored for ennio)
#   EXCLUDE_TAGS    maestro --exclude-tags value (optional; ignored for ennio)
#   DEBUG_OUTPUT    maestro --debug-output dir (optional; ignored for ennio)
#   ATTEMPTS        per-flow retries (default: 2)
#   FLOW_GLOB       glob of flows to run (default: $FLOWS_DIR/pay_*.yaml)
#
set -uo pipefail
PLATFORM="${PLATFORM:?set PLATFORM=ios|android}"
RUNNER="${RUNNER:-maestro}"
FLOWS_DIR="${FLOWS_DIR:-.maestro}"
OUT_DIR="${OUT_DIR:-maestro-artifacts}"
MAESTRO_BIN="${MAESTRO_BIN:-$HOME/.maestro/bin/maestro}"
INCLUDE_TAGS="${INCLUDE_TAGS:-pay}"
EXCLUDE_TAGS="${EXCLUDE_TAGS:-}"
DEBUG_OUTPUT="${DEBUG_OUTPUT:-}"
ATTEMPTS="${ATTEMPTS:-2}"
FLOW_GLOB="${FLOW_GLOB:-$FLOWS_DIR/pay_*.yaml}"
mkdir -p "$OUT_DIR"

env_args=(--env APP_ID="${APP_ID:-}")
for v in WPAY_CUSTOMER_KEY_SINGLE_NOKYC WPAY_MERCHANT_ID_SINGLE_NOKYC \
         WPAY_CUSTOMER_KEY_MULTI_NOKYC WPAY_MERCHANT_ID_MULTI_NOKYC \
         WPAY_CUSTOMER_KEY_MULTI_KYC WPAY_MERCHANT_ID_MULTI_KYC \
         WPAY_PAY_API_URL WPAY_EXPIRED_GATEWAY_URL; do
  env_args+=(--env "$v=${!v:-}")
done

start_rec() { # $1=video path -> echoes recorder pid
  if [ "$PLATFORM" = ios ]; then
    xcrun simctl io "$DEVICE_ID" recordVideo --codec h264 --force "$1" >/dev/null 2>&1 & echo $!
  else
    # adb screenrecord runs on-device; 180s cap is safe for a single pay flow
    adb shell screenrecord --bit-rate 4000000 "/sdcard/$(basename "$1")" >/dev/null 2>&1 & echo $!
  fi
}
stop_rec() { # $1=pid $2=video path
  kill -INT "$1" 2>/dev/null; wait "$1" 2>/dev/null
  if [ "$PLATFORM" = android ]; then
    sleep 1; adb pull "/sdcard/$(basename "$2")" "$2" >/dev/null 2>&1 || true
    adb shell rm -f "/sdcard/$(basename "$2")" >/dev/null 2>&1 || true
  fi
}

overall=0
shopt -s nullglob
for flow in $FLOW_GLOB; do
  name=$(basename "$flow" .yaml)
  video="$OUT_DIR/${name}.mp4"
  log="$OUT_DIR/${name}.log"
  rec=$(start_rec "$video")
  rc=1
  for a in $(seq 1 "$ATTEMPTS"); do
    echo "=== $RUNNER $name (attempt $a/$ATTEMPTS) ==="
    if [ "$RUNNER" = ennio ]; then
      ennio test "$flow" >>"$log" 2>&1
    else
      "$MAESTRO_BIN" test "${env_args[@]}" --include-tags "$INCLUDE_TAGS" \
        ${EXCLUDE_TAGS:+--exclude-tags "$EXCLUDE_TAGS"} \
        ${DEBUG_OUTPUT:+--debug-output "$DEBUG_OUTPUT"} \
        --test-output-dir "$OUT_DIR" "$flow" >>"$log" 2>&1
    fi
    rc=$?; [ $rc -eq 0 ] && break
  done
  stop_rec "$rec" "$video"
  if [ $rc -eq 0 ]; then rm -f "$video"; echo "PASS  $name"; else overall=1; echo "FAIL  $name (kept $video)"; fi
done
exit $overall
