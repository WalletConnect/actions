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
assert_contains "$output" '🚨 2026-08-14 — `pay/swift` flake rate 50.00% exceeds 10%'

repeat_rebreach_state="$TEST_TMP_DIR/repeat-rebreach-state.jsonl"
output=$(run_report 2026-08-15 "$rebreach_state" "$repeat_rebreach_state")
assert_not_contains "$output" '🚨 2026-08-15'

# The two-day pass-rate rule also alerts once, and rows with no runs never
# become pass-rate breaches.
write_metrics 80.00 8 10 0.00 0 0 16 1
write_yesterday_pass 85.00 8 10
pass_state="$TEST_TMP_DIR/pass-state.jsonl"
output=$(run_report 2026-08-16 "$recovered_state" "$pass_state")
assert_contains "$output" '🚨 2026-08-16 — `pay/swift` pass rate <90% for 2 consecutive days'

repeat_pass_state="$TEST_TMP_DIR/repeat-pass-state.jsonl"
output=$(run_report 2026-08-17 "$pass_state" "$repeat_pass_state")
assert_not_contains "$output" '🚨 2026-08-17'

write_metrics 0.00 0 0 0.00 0 0 0 0
write_yesterday_pass 0.00 0 0
no_runs_state="$TEST_TMP_DIR/no-runs-state.jsonl"
output=$(run_report 2026-08-18 "$recovered_state" "$no_runs_state")
assert_not_contains "$output" 'pass rate <90%'
jq -e 'select(.label == "swift") | .pass == false' "$no_runs_state" >/dev/null

# Alert-state errors are non-fatal: the primary daily summary is still
# produced and the separate threshold alert is skipped with a visible warning.
write_metrics 100.00 10 10 50.00 1 2 16 1
output=$(run_report 2026-08-19 "$recovered_state" "$TEST_TMP_DIR" 2>&1)
assert_contains "$output" '::warning::build_alerts failed; skipping threshold alerts'
assert_contains "$output" '--- daily summary ---'
assert_contains "$output" '📊 Maestro E2E KPIs — 7d window: 2026-08-04 → 2026-08-19'
assert_not_contains "$output" '--- threshold alerts ---'

# Malformed previous state follows the same best-effort path.
malformed_state="$TEST_TMP_DIR/malformed-state.jsonl"
printf '{malformed\n' > "$malformed_state"
output=$(run_report 2026-08-20 "$malformed_state" "$TEST_TMP_DIR/ignored-state.jsonl" 2>&1)
assert_contains "$output" '::warning::build_alerts failed; skipping threshold alerts'
assert_contains "$output" '--- daily summary ---'
assert_not_contains "$output" '--- threshold alerts ---'

# Suites render as separate tables, and the same label in two suites keeps
# its own metrics and alert state (rows are keyed by suite + label). The
# fixtures above have no `suite` field, which exercises the 'pay' default
# used for artifacts written before suites existed.
cat > "$PASS_FILE" <<'EOF'
{"suite":"pay","platform":"kotlin","label":"kotlin","success":10,"failure":0,"total":10,"rate":100.00}
{"suite":"connect","platform":"kotlin-connect","label":"kotlin","success":8,"failure":2,"total":10,"rate":80.00}
EOF
cat > "$FLAKE_FILE" <<'EOF'
{"suite":"pay","platform":"kotlin","label":"kotlin","recovered":0,"failed":0,"total_failures":0,"rate":0.00}
{"suite":"connect","platform":"kotlin-connect","label":"kotlin","recovered":1,"failed":1,"total_failures":2,"rate":50.00}
EOF
cat > "$P95_FILE" <<'EOF'
{"suite":"pay","platform":"kotlin","label":"kotlin","p95_seconds":600,"p95_minutes":10,"count":3}
{"suite":"connect","platform":"kotlin-connect","label":"kotlin","p95_seconds":720,"p95_minutes":12,"count":3}
EOF
: > "$YESTERDAY_PASS"
suites_state="$TEST_TMP_DIR/suites-state.jsonl"
output=$(run_report 2026-08-21 "$recovered_state" "$suites_state")
assert_contains "$output" '*💳 WalletConnect Pay*'
assert_contains "$output" '*🔗 WalletKit connect flow*'
pay_section="${output%%🔗 WalletKit connect flow*}"
connect_section="${output#*🔗 WalletKit connect flow}"
assert_contains "$pay_section" '✅ 100.00% (10/10)'
assert_not_contains "$pay_section" 'Attention'
assert_contains "$connect_section" '(8/10)'
assert_contains "$connect_section" '⚠️ Attention: kotlin pass 80.00%, flake 50.00%'
assert_contains "$output" '🚨 2026-08-21 — `connect/kotlin` flake rate 50.00% exceeds 10%'
assert_not_contains "$output" '`pay/kotlin`'
jq -e 'select(.suite == "connect" and .label == "kotlin") | .flake == true' "$suites_state" >/dev/null
jq -e 'select(.suite == "pay" and .label == "kotlin") | .flake == false' "$suites_state" >/dev/null

echo "post_to_slack tests passed"
