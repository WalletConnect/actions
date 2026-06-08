#!/usr/bin/env bash
# Assemble the daily Slack message from the four KPI outputs and POST it
# to the webhook. Emits attention-line + threshold-breach alerts when the
# numbers warrant.
#
# Inputs (file paths, one JSON object per line, format from kpi_*.sh):
#   PASS_FILE       — pass rate per workflow
#   FLAKE_FILE      — flake rate per workflow
#   P95_FILE        — P95 feedback per workflow
#   CATCHES_FILE    — bug catches per platform
#   YESTERDAY_PASS  — yesterday's pass rate per workflow (optional; for week-over-week deltas and "2 consecutive days <90%" alert)
#
# Env: SLACK_KPI_WEBHOOK_URL is required at runtime.

set -euo pipefail

PASS_FILE="${PASS_FILE:?missing}"
FLAKE_FILE="${FLAKE_FILE:?missing}"
P95_FILE="${P95_FILE:?missing}"
CATCHES_FILE="${CATCHES_FILE:?missing}"
YESTERDAY_PASS="${YESTERDAY_PASS:-/dev/null}"
# When DRY_RUN=1, print the message to stdout instead of POSTing. Useful
# for local debugging and the workflow echoes the dry-run output so the
# run log is self-contained.
DRY_RUN="${DRY_RUN:-0}"
if [[ "$DRY_RUN" != "1" ]]; then
  SLACK_WEBHOOK="${SLACK_KPI_WEBHOOK_URL:?missing SLACK_KPI_WEBHOOK_URL}"
  # Auto-masking covers the secret value as ${{ secrets.* }} resolved it,
  # but doesn't follow into derived shell variables. Re-mask both forms
  # so a stray `set -x` (or ACTIONS_STEP_DEBUG) can't leak the URL.
  echo "::add-mask::$SLACK_WEBHOOK"
fi
TODAY="${TODAY:-$(date -u +%Y-%m-%d)}"

# Targets per the design doc.
PASS_TARGET=95
FLAKE_TARGET=5
P95_TARGET_MIN=30
PASS_ALERT=90
FLAKE_ALERT=10
P95_ALERT_MIN=45

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

# Build a row for one workflow. Looks up flake + p95 by label.
build_row() {
  local pass_entry="$1"
  local label rate total
  label=$(jq -r '.label' <<<"$pass_entry")
  rate=$(jq -r '.rate' <<<"$pass_entry")
  total=$(jq -r '.total' <<<"$pass_entry")

  local flake_rate flake_total p95_min p95_count
  flake_rate=$(jq -r --arg l "$label" 'select(.label == $l) | .rate' "$FLAKE_FILE" | head -1)
  flake_total=$(jq -r --arg l "$label" 'select(.label == $l) | .total_failures' "$FLAKE_FILE" | head -1)
  p95_min=$(jq -r --arg l "$label" 'select(.label == $l) | .p95_minutes' "$P95_FILE" | head -1)
  p95_count=$(jq -r --arg l "$label" 'select(.label == $l) | .count' "$P95_FILE" | head -1)
  flake_rate="${flake_rate:-0}"
  p95_min="${p95_min:-0}"

  local pass_cell flake_cell p95_cell
  if [[ "${total:-0}" == "0" ]]; then
    pass_cell="—"
  else
    pass_cell=$(kpi_cell "$rate" ">=" "$PASS_TARGET" "%")
  fi
  if [[ "${flake_total:-0}" == "0" ]]; then
    flake_cell="—"
  else
    flake_cell=$(kpi_cell "$flake_rate" "<" "$FLAKE_TARGET" "%")
  fi
  if [[ "${p95_count:-0}" == "0" ]]; then
    p95_cell="—"
  else
    p95_cell=$(kpi_cell "$p95_min" "<" "$P95_TARGET_MIN" "m")
  fi

  # Fixed-width formatting for Slack code block.
  printf '%-22s  %-10s  %-10s  %s\n' "$label" "$pass_cell" "$flake_cell" "$p95_cell"
}

# Attention line: list workflows where any metric is in red/yellow zone.
build_attention_line() {
  local notes=()
  while IFS= read -r pass_entry; do
    local label rate total
    label=$(jq -r '.label' <<<"$pass_entry")
    rate=$(jq -r '.rate' <<<"$pass_entry")
    total=$(jq -r '.total' <<<"$pass_entry")
    local flake_rate flake_total p95_min p95_count
    flake_rate=$(jq -r --arg l "$label" 'select(.label == $l) | .rate' "$FLAKE_FILE" | head -1)
    flake_total=$(jq -r --arg l "$label" 'select(.label == $l) | .total_failures' "$FLAKE_FILE" | head -1)
    p95_min=$(jq -r --arg l "$label" 'select(.label == $l) | .p95_minutes' "$P95_FILE" | head -1)
    p95_count=$(jq -r --arg l "$label" 'select(.label == $l) | .count' "$P95_FILE" | head -1)
    flake_rate="${flake_rate:-0}"
    p95_min="${p95_min:-0}"

    local issues=()
    if [[ "${total:-0}" != "0" ]]; then
      awk -v v="$rate" -v t="$PASS_TARGET" 'BEGIN { exit (v < t) ? 0 : 1 }' && issues+=("pass $rate%")
    fi
    if [[ "${flake_total:-0}" != "0" ]]; then
      awk -v v="$flake_rate" -v t="$FLAKE_TARGET" 'BEGIN { exit (v >= t) ? 0 : 1 }' && issues+=("flake $flake_rate%")
    fi
    if [[ "${p95_count:-0}" != "0" ]]; then
      awk -v v="$p95_min" -v t="$P95_TARGET_MIN" 'BEGIN { exit (v >= t) ? 0 : 1 }' && issues+=("P95 ${p95_min}m")
    fi

    if (( ${#issues[@]} > 0 )); then
      local joined
      joined=$(printf ', %s' "${issues[@]}")
      notes+=("$label ${joined:2}")
    fi
  done < "$PASS_FILE"

  if (( ${#notes[@]} > 0 )); then
    local joined
    joined=$(printf '; %s' "${notes[@]}")
    echo "⚠️ Attention: ${joined:2}"
  fi
}

# Bar chart for bug catches.
build_catches_section() {
  local total
  total=$(jq -s 'map(.total) | add // 0' "$CATCHES_FILE")
  local pr_total main_total
  pr_total=$(jq -s 'map(.pr_time) | add // 0' "$CATCHES_FILE")
  main_total=$(jq -s 'map(.main) | add // 0' "$CATCHES_FILE")

  local avg_days
  if [[ $total -gt 0 ]]; then
    avg_days=$(awk -v t="$total" 'BEGIN { printf "%.1f", 30 / t }')
    echo "🐛 Bug catches — last 30d: $total total (avg every $avg_days days)"
  else
    echo "🐛 Bug catches — last 30d: 0 total"
  fi
  echo "   PR-time catches:  $pr_total   •   Main-branch catches:  $main_total"
  echo ""

  while IFS= read -r entry; do
    local platform total_p bar
    platform=$(jq -r '.platform' <<<"$entry")
    total_p=$(jq -r '.total' <<<"$entry")
    if [[ $total_p -gt 0 ]]; then
      bar=$(printf '▓%.0s' $(seq 1 "$total_p"))
    else
      bar=""
    fi
    printf '   %-8s %s %d\n' "$platform" "$bar" "$total_p"
  done < "$CATCHES_FILE"
}

# Threshold-breach alerts.
build_alerts() {
  local alerts=()
  while IFS= read -r pass_entry; do
    local label rate
    label=$(jq -r '.label' <<<"$pass_entry")
    rate=$(jq -r '.rate' <<<"$pass_entry")
    local flake_rate p95_min
    flake_rate=$(jq -r --arg l "$label" 'select(.label == $l) | .rate' "$FLAKE_FILE" | head -1)
    p95_min=$(jq -r --arg l "$label" 'select(.label == $l) | .p95_minutes' "$P95_FILE" | head -1)
    flake_rate="${flake_rate:-0.00}"
    p95_min="${p95_min:-0}"

    # Pass rate < 90% for 2 consecutive days
    if awk -v v="$rate" -v t="$PASS_ALERT" 'BEGIN { exit (v < t) ? 0 : 1 }'; then
      local yesterday_rate=""
      if [[ -s "$YESTERDAY_PASS" ]]; then
        yesterday_rate=$(jq -r --arg l "$label" 'select(.label == $l) | .rate' "$YESTERDAY_PASS" | head -1)
      fi
      if [[ -n "$yesterday_rate" ]] && awk -v v="$yesterday_rate" -v t="$PASS_ALERT" 'BEGIN { exit (v < t) ? 0 : 1 }'; then
        alerts+=("🚨 \`$label\` pass rate <$PASS_ALERT% for 2 consecutive days (today $rate%, yesterday $yesterday_rate%)")
      fi
    fi
    if awk -v v="$flake_rate" -v t="$FLAKE_ALERT" 'BEGIN { exit (v > t) ? 0 : 1 }'; then
      alerts+=("🚨 \`$label\` flake rate $flake_rate% exceeds $FLAKE_ALERT%")
    fi
    if awk -v v="$p95_min" -v t="$P95_ALERT_MIN" 'BEGIN { exit (v > t) ? 0 : 1 }'; then
      alerts+=("🚨 \`$label\` P95 feedback ${p95_min}m exceeds ${P95_ALERT_MIN}m")
    fi
  done < "$PASS_FILE"

  if (( ${#alerts[@]} > 0 )); then
    printf '%s\n' "${alerts[@]}"
  fi
}

# Assemble the message body.
body=$(cat <<EOF
📊 Maestro E2E KPIs — $TODAY

$(printf '%-22s  %-10s  %-10s  %s\n' "" "Pass rate" "Flake rate" "P95 PR feedback")
$(printf '%-22s  %-10s  %-10s  %s\n' "" "(7d, main)" "(7d)" "(7d)")
$(printf -- '-%.0s' {1..72})
$(while IFS= read -r entry; do build_row "$entry"; done < "$PASS_FILE")
$(printf -- '-%.0s' {1..72})
🎯 targets              ≥${PASS_TARGET}%       <${FLAKE_TARGET}%         <${P95_TARGET_MIN}m

$(build_catches_section)
EOF
)

attention=$(build_attention_line || true)
if [[ -n "$attention" ]]; then
  body="$body

$attention"
fi

# Daily summary as a code block.
daily="\`\`\`$body\`\`\`"
alerts=$(build_alerts || true)

if [[ "$DRY_RUN" == "1" ]]; then
  echo "--- daily summary ---"
  echo "$daily"
  if [[ -n "$alerts" ]]; then
    echo
    echo "--- threshold alerts ---"
    echo "$alerts"
  fi
  exit 0
fi

# Write the webhook URL to a curl config file so it stays out of argv
# (visible under set -x / ACTIONS_STEP_DEBUG / /proc/<pid>/cmdline).
_curl_cfg=$(mktemp)
trap 'rm -f "$_curl_cfg"' EXIT
printf 'url = "%s"\n' "$SLACK_WEBHOOK" > "$_curl_cfg"
chmod 600 "$_curl_cfg"

payload=$(jq -nc --arg text "$daily" '{text: $text}')
curl -fsS -X POST -H "Content-Type: application/json" \
  -d "$payload" --config "$_curl_cfg" > /dev/null

if [[ -n "$alerts" ]]; then
  alert_payload=$(jq -nc --arg text "$alerts" '{text: $text}')
  curl -fsS -X POST -H "Content-Type: application/json" \
    -d "$alert_payload" --config "$_curl_cfg" > /dev/null
fi
