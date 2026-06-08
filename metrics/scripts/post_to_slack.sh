#!/usr/bin/env bash
# Assemble the daily Slack message from the three KPI outputs and POST it
# to the webhook. Emits attention-line + threshold-breach alerts when the
# numbers warrant.
#
# Inputs (file paths, one JSON object per line, format from kpi_*.sh):
#   PASS_FILE       — pass rate per workflow
#   FLAKE_FILE      — flake rate per workflow
#   P95_FILE        — P95 feedback per workflow
#   YESTERDAY_PASS  — yesterday's pass rate per workflow (optional; for
#                     "2 consecutive days <90%" alert)
#
# Env: SLACK_KPI_WEBHOOK_URL is required at runtime.

set -euo pipefail

PASS_FILE="${PASS_FILE:?missing}"
FLAKE_FILE="${FLAKE_FILE:?missing}"
P95_FILE="${P95_FILE:?missing}"
YESTERDAY_PASS="${YESTERDAY_PASS:-/dev/null}"
DRY_RUN="${DRY_RUN:-0}"
if [[ "$DRY_RUN" != "1" ]]; then
  SLACK_WEBHOOK="${SLACK_KPI_WEBHOOK_URL:?missing SLACK_KPI_WEBHOOK_URL}"
  echo "::add-mask::$SLACK_WEBHOOK"
fi

# Window: same 7d the kpi_*.sh scripts use (lib.sh::iso_days_ago 7).
# Compute fresh here so the Slack header always reflects the same
# interval the scripts queried.
WINDOW_END="${TODAY:-$(date -u +%Y-%m-%d)}"
WINDOW_START="${WINDOW_START:-$(date -u -d "7 days ago" +%Y-%m-%d 2>/dev/null || date -u -v -7d +%Y-%m-%d)}"

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
  local label rate success total
  label=$(jq -r '.label' <<<"$pass_entry")
  rate=$(jq -r '.rate' <<<"$pass_entry")
  success=$(jq -r '.success' <<<"$pass_entry")
  total=$(jq -r '.total' <<<"$pass_entry")

  local flake_rate flake_recovered flake_total p95_min p95_count
  flake_rate=$(jq -r --arg l "$label" 'select(.label == $l) | .rate' "$FLAKE_FILE" | head -1)
  flake_recovered=$(jq -r --arg l "$label" 'select(.label == $l) | .recovered' "$FLAKE_FILE" | head -1)
  flake_total=$(jq -r --arg l "$label" 'select(.label == $l) | .total_failures' "$FLAKE_FILE" | head -1)
  p95_min=$(jq -r --arg l "$label" 'select(.label == $l) | .p95_minutes' "$P95_FILE" | head -1)
  p95_count=$(jq -r --arg l "$label" 'select(.label == $l) | .count' "$P95_FILE" | head -1)
  flake_rate="${flake_rate:-0}"
  flake_recovered="${flake_recovered:-0}"
  flake_total="${flake_total:-0}"
  p95_min="${p95_min:-0}"
  p95_count="${p95_count:-0}"

  local pass_cell flake_cell p95_cell
  if [[ "${total:-0}" == "0" ]]; then
    pass_cell="— (no runs)"
  else
    pass_cell="$(kpi_cell "$rate" ">=" "$PASS_TARGET" "%") ($success/$total)"
  fi
  if [[ "${flake_total:-0}" == "0" ]]; then
    flake_cell="— (no failures)"
  else
    flake_cell="$(kpi_cell "$flake_rate" "<" "$FLAKE_TARGET" "%") ($flake_recovered/$flake_total)"
  fi
  if [[ "${p95_count:-0}" == "0" ]]; then
    p95_cell="— (no PR runs)"
  else
    p95_cell="$(kpi_cell "$p95_min" "<" "$P95_TARGET_MIN" "m") (n=$p95_count)"
  fi

  # Wider columns to fit the counts.
  printf '%-12s  %-22s  %-22s  %s\n' "$label" "$pass_cell" "$flake_cell" "$p95_cell"
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
📊 Maestro E2E KPIs — 7d window: $WINDOW_START → $WINDOW_END

$(printf '%-12s  %-22s  %-22s  %s\n' "" "Pass rate" "Flake rate" "P95 PR feedback")
$(printf '%-12s  %-22s  %-22s  %s\n' "" "(success/total)" "(recovered/failures)" "(n = sample size)")
$(printf -- '-%.0s' {1..78})
$(while IFS= read -r entry; do build_row "$entry"; done < "$PASS_FILE")
$(printf -- '-%.0s' {1..78})
🎯 targets    ≥${PASS_TARGET}%                  <${FLAKE_TARGET}%                   <${P95_TARGET_MIN}m
EOF
)

attention=$(build_attention_line || true)
if [[ -n "$attention" ]]; then
  body="$body

$attention"
fi

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

# Webhook URL via curl --config file to keep it out of argv.
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
