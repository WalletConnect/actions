#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_TMP_DIR"' EXIT

PASS_FILE="$TEST_TMP_DIR/pass.jsonl"
FLAKE_FILE="$TEST_TMP_DIR/flake.jsonl"
P95_FILE="$TEST_TMP_DIR/p95.jsonl"
YESTERDAY_PASS="$TEST_TMP_DIR/yesterday-pass.jsonl"

write_metrics() {
  local pass_rate="$1" pass_success="$2" pass_total="$3"
  local flake_rate="$4" flake_recovered="$5" flake_total="$6"
  local p95_minutes="$7" p95_count="$8"

  printf '{"platform":"swift","label":"swift","success":%s,"failure":%s,"total":%s,"rate":%s}\n' \
    "$pass_success" "$((pass_total - pass_success))" "$pass_total" "$pass_rate" > "$PASS_FILE"
  printf '{"platform":"swift","label":"swift","recovered":%s,"failed":%s,"total_failures":%s,"rate":%s}\n' \
    "$flake_recovered" "$((flake_total - flake_recovered))" "$flake_total" "$flake_rate" > "$FLAKE_FILE"
  printf '{"platform":"swift","label":"swift","p95_seconds":%s,"p95_minutes":%s,"count":%s}\n' \
    "$((p95_minutes * 60))" "$p95_minutes" "$p95_count" > "$P95_FILE"
}

write_yesterday_pass() {
  local rate="$1" success="$2" total="$3"
  printf '{"platform":"swift","label":"swift","success":%s,"failure":%s,"total":%s,"rate":%s}\n' \
    "$success" "$((total - success))" "$total" "$rate" > "$YESTERDAY_PASS"
}

run_report() {
  local date="$1" previous_state="$2" state_file="$3"
  PASS_FILE="$PASS_FILE" \
  FLAKE_FILE="$FLAKE_FILE" \
  P95_FILE="$P95_FILE" \
  YESTERDAY_PASS="$YESTERDAY_PASS" \
  PREVIOUS_ALERT_STATE="$previous_state" \
  ALERT_STATE_FILE="$state_file" \
  TODAY="$date" \
  WINDOW_START="2026-08-04" \
  DRY_RUN=1 \
    bash "$SCRIPT_DIR/post_to_slack.sh"
}

assert_contains() {
  local output="$1" expected="$2"
  if [[ "$output" != *"$expected"* ]]; then
    echo "Expected output to contain: $expected" >&2
    exit 1
  fi
}

assert_not_contains() {
  local output="$1" unexpected="$2"
  if [[ "$output" == *"$unexpected"* ]]; then
    echo "Expected output not to contain: $unexpected" >&2
    exit 1
  fi
}

# With no prior state, initialize current conditions silently so an older
# breach is not incorrectly assigned the deployment date.
write_metrics 100.00 10 10 100.00 1 1 16 1
write_yesterday_pass 100.00 10 10
first_state="$TEST_TMP_DIR/first-state.jsonl"
output=$(run_report 2026-08-11 "$TEST_TMP_DIR/missing-state.jsonl" "$first_state")
assert_not_contains "$output" '🚨 2026-08-11'
jq -e 'select(.label == "swift") | .flake == true' "$first_state" >/dev/null

# The same active breach remains in the rolling Attention line but does not
# emit another separate Slack alert on the next report.
second_state="$TEST_TMP_DIR/second-state.jsonl"
output=$(run_report 2026-08-12 "$first_state" "$second_state")
assert_contains "$output" '⚠️ Attention: swift flake 100.00%'
assert_not_contains "$output" '🚨 2026-08-12'

# Recovery clears persisted state without emitting an alert.
write_metrics 100.00 10 10 0.00 0 0 16 1
recovered_state="$TEST_TMP_DIR/recovered-state.jsonl"
output=$(run_report 2026-08-13 "$second_state" "$recovered_state")
assert_not_contains "$output" '🚨 2026-08-13'
jq -e 'select(.label == "swift") | .flake == false' "$recovered_state" >/dev/null

# A later breach is a new event and emits a new alert with its own date.
write_metrics 100.00 10 10 50.00 1 2 16 1
rebreach_state="$TEST_TMP_DIR/rebreach-state.jsonl"
output=$(run_report 2026-08-14 "$recovered_state" "$rebreach_state")
assert_contains "$output" '🚨 2026-08-14 — `swift` flake rate 50.00% exceeds 10%'

repeat_rebreach_state="$TEST_TMP_DIR/repeat-rebreach-state.jsonl"
output=$(run_report 2026-08-15 "$rebreach_state" "$repeat_rebreach_state")
assert_not_contains "$output" '🚨 2026-08-15'

# The two-day pass-rate rule also alerts once, and rows with no runs never
# become pass-rate breaches.
write_metrics 80.00 8 10 0.00 0 0 16 1
write_yesterday_pass 85.00 8 10
pass_state="$TEST_TMP_DIR/pass-state.jsonl"
output=$(run_report 2026-08-16 "$recovered_state" "$pass_state")
assert_contains "$output" '🚨 2026-08-16 — `swift` pass rate <90% for 2 consecutive days'

repeat_pass_state="$TEST_TMP_DIR/repeat-pass-state.jsonl"
output=$(run_report 2026-08-17 "$pass_state" "$repeat_pass_state")
assert_not_contains "$output" '🚨 2026-08-17'

write_metrics 0.00 0 0 0.00 0 0 0 0
write_yesterday_pass 0.00 0 0
no_runs_state="$TEST_TMP_DIR/no-runs-state.jsonl"
output=$(run_report 2026-08-18 "$recovered_state" "$no_runs_state")
assert_not_contains "$output" 'pass rate <90%'
jq -e 'select(.label == "swift") | .pass == false' "$no_runs_state" >/dev/null

echo "post_to_slack tests passed"
