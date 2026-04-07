# Maestro Pay Tests

Shared [Maestro](https://maestro.mobile.dev/) E2E test flows for **WalletConnect Pay**. These tests verify the full payment lifecycle — from scanning a payment link to confirming on-chain — and are designed to run on any wallet that integrates WalletConnect Pay (React Native, Kotlin, Swift, Flutter).

## How It Works

This action copies shared Maestro test flows and helper scripts into your workspace. Your CI workflow then runs `maestro test` against your built app. The flows use accessibility IDs (testIDs) to interact with UI elements, so every wallet platform must implement the same set of IDs on the corresponding components.

## Prerequisites

- **Maestro CLI** installed — use [`WalletConnect/actions/maestro/setup`](../setup) action
- **App built and installed** on simulator/emulator
- **Test mode enabled** in the wallet app (to expose the URL input field)

## Required TestIDs

Every wallet platform must add these accessibility identifiers to the corresponding UI elements. The tests will fail if any are missing.

### Scanner / URL Entry

| TestID | Element | Description |
|---|---|---|
| `button-scan` | Scan button on home screen | Opens the scanner/QR modal |
| `input-paste-url` | Text input in scan modal | For pasting payment URLs (**test mode only** — see below) |
| `button-submit-url` | Submit button in scan modal | Submits the pasted URL (**test mode only**) |

### Payment Modal — Header

| TestID | Element | Description |
|---|---|---|
| `pay-button-back` | Back arrow button | Returns to previous step |
| `pay-button-close` | Close (X) button | Dismisses the payment modal |

### Payment Modal — Merchant Info & Loading

| TestID | Element | Description |
|---|---|---|
| `pay-merchant-info` | Merchant display | Shows merchant name and payment amount |
| `pay-loading-message` | Loading text | Shown during payment processing |

### Payment Modal — Option Selection

| TestID | Element | Description |
|---|---|---|
| `pay-option-{index}` | Payment option (unselected) | 0-based index from the payment options array |
| `pay-option-{index}-selected` | Payment option (selected) | Same element when selected |
| `pay-info-required-badge` | "Info required" badge | Shown on options that require KYC |
| `pay-button-info` | Info (?) button in header | Explains KYC requirement |
| `pay-button-continue` | Continue button | Proceeds after selecting a payment option |

### Payment Modal — Review Screen

| TestID | Element | Description |
|---|---|---|
| `pay-review-token-{networkName}` | Token/network display | Dynamic — lowercase network name (e.g. `pay-review-token-base`) |
| `pay-button-pay` | Pay button | Confirms and submits the payment |

### Payment Modal — Result Screen

| TestID | Element | Description |
|---|---|---|
| `pay-result-container` | Result screen wrapper | Container for the result view |
| `pay-result-success-icon` | Success icon | Checkmark shown on successful payment |
| `pay-result-insufficient-funds-icon` | Insufficient funds icon | Shown when wallet balance is too low |
| `pay-result-expired-icon` | Expired icon | Shown for expired payment links |
| `pay-result-cancelled-icon` | Cancelled icon | Shown for cancelled payments |
| `pay-result-error-icon` | Generic error icon | Shown for other errors (e.g. already completed) |
| `pay-button-result-action-success` | "Got it!" button (success) | Dismisses the success result |
| `pay-button-result-action-insufficient_funds` | Action button (insufficient funds) | Dismisses the insufficient funds error |
| `pay-button-result-action-expired` | Action button (expired) | Dismisses the expired error |
| `pay-button-result-action-cancelled` | Action button (cancelled) | Dismisses the cancelled error |
| `pay-button-result-action-generic` | Action button (generic error) | Dismisses the generic error |

### Dynamic TestID Patterns

Some testIDs include dynamic values:

- **`pay-option-{index}`** / **`pay-option-{index}-selected`** — `index` is 0-based from the payment options array. Example: `pay-option-0`, `pay-option-1-selected`
- **`pay-review-token-{networkName}`** — lowercase network name. Example: `pay-review-token-base`, `pay-review-token-ethereum`
- **`pay-button-result-action-{type}`** — one of: `success`, `insufficient_funds`, `expired`, `cancelled`, `generic`

## Test Input Field Requirement

Each wallet must add a **text input field** and **submit button** inside the scan/QR modal. This is required for Maestro to bypass camera/QR scanning and submit payment URLs directly.

**Important:** This input should only be visible when a test mode flag is enabled (e.g. `ENV_TEST_MODE=true`). It should never appear in production builds.

### Reference Implementation (React Native)

From `ScannerOptionsModal.tsx` in the React Native wallet sample:

```tsx
import Config from 'react-native-config';

const showTestInput = Config.ENV_TEST_MODE === 'true';

// Inside the modal component's render:
{showTestInput && (
  <View style={styles.testInputContainer}>
    <TextInput
      testID="input-paste-url"
      style={styles.testInput}
      placeholder="Paste payment URL here"
      value={urlInput}
      onChangeText={setUrlInput}
      autoCapitalize="none"
      autoCorrect={false}
    />
    <Button
      testID="button-submit-url"
      onPress={() => {
        const url = urlInput.trim();
        if (!url) return;
        closeModal();
        handleUriOrPaymentLink(url);
      }}
    >
      <Text>Go</Text>
    </Button>
  </View>
)}
```

The key points for any platform:
1. Gate visibility behind a test/debug build flag
2. Use `input-paste-url` as the accessibility ID for the text input
3. Use `button-submit-url` as the accessibility ID for the submit button
4. On submit, pass the URL to the same handler that processes scanned QR codes or deep links

## Required Secrets

These secrets must be configured in your repository for the tests to create and manipulate payments:

| Secret | Description |
|---|---|
| `WPAY_CUSTOMER_KEY_SINGLE_NOKYC` | API key for single-option, no-KYC merchant |
| `WPAY_MERCHANT_ID_SINGLE_NOKYC` | Merchant ID for single-option, no-KYC merchant |
| `WPAY_CUSTOMER_KEY_MULTI_NOKYC` | API key for multi-option, no-KYC merchant |
| `WPAY_MERCHANT_ID_MULTI_NOKYC` | Merchant ID for multi-option, no-KYC merchant |
| `WPAY_CUSTOMER_KEY_MULTI_KYC` | API key for multi-option, KYC-required merchant |
| `WPAY_MERCHANT_ID_MULTI_KYC` | Merchant ID for multi-option, KYC-required merchant |

Each merchant pair represents a different test configuration. The tests use these to create payments with specific option counts and KYC requirements.

## Test Catalog

| Flow | Description | Merchant Config |
|---|---|---|
| `pay_single_option_nokyc` | Happy path: single payment option, no KYC | SINGLE_NOKYC |
| `pay_single_option_nokyc_deeplink` | Same as above but opened via deep link | SINGLE_NOKYC |
| `pay_multiple_options_nokyc` | Select between multiple options, no KYC | MULTI_NOKYC |
| `pay_multiple_options_kyc` | Multiple options with KYC webview | MULTI_KYC |
| `pay_cancel_from_review` | Server-side cancellation on review screen | SINGLE_NOKYC |
| `pay_cancel_from_kyc` | Server-side cancellation during KYC | MULTI_KYC |
| `pay_kyc_back_navigation` | Back/close button navigation in KYC | MULTI_KYC |
| `pay_insufficient_funds` | Payment amount exceeds wallet balance | SINGLE_NOKYC |
| `pay_double_scan` | Re-scan same QR after completion | SINGLE_NOKYC |
| `pay_expired_link` | Hardcoded expired payment URL | None (hardcoded) |
| `pay_cancelled` | Hardcoded cancelled payment URL | None (hardcoded) |

All flows are tagged with `pay` for filtering via `--include-tags`.

## Deep Link Support

The `pay_single_option_nokyc_deeplink` test uses Maestro's `openLink` command to open a `https://pay.walletconnect.com` URL. Your wallet must be configured to handle these URLs as deep links / universal links for this test to work.

## Local Development

For running tests locally during development. Requires [Maestro CLI](https://maestro.mobile.dev/) installed on your machine.

### Setup

1. **Create your secrets file** (one-time):
   ```bash
   cp .env.maestro.example .env.maestro
   # Fill in the WPAY_* values (get them from your team or the WalletConnect Pay dashboard)
   ```

2. **Run tests** (auto-downloads flows if not present):
   ```bash
   ./scripts/run-maestro-pay-tests.sh
   ```

That's it. The script will automatically download the shared test flows from this repo if they're not already present, load secrets from `.env.maestro`, and run all pay-tagged tests.

### Other local commands

```bash
# Run a single test
./scripts/run-maestro-pay-tests.sh .maestro/pay_cancelled.yaml

# Re-download flows (e.g. after an update)
./scripts/setup-maestro-pay-tests.sh

# Download flows from a specific branch
./scripts/setup-maestro-pay-tests.sh feat/my-branch
```

## CI Usage

### iOS (composite action)

```yaml
steps:
  - uses: actions/checkout@v4

  # ... your platform-specific build steps ...

  - name: Copy shared Pay test flows
    uses: WalletConnect/actions/maestro/pay-tests@main

  - name: Install Maestro
    uses: WalletConnect/actions/maestro/setup@main

  # ... boot simulator, install app ...

  - name: Run Pay E2E tests
    uses: WalletConnect/actions/maestro/run@main
    with:
      app-id: com.example.wallet.internal
      wpay-customer-key-single-nokyc: ${{ secrets.WPAY_CUSTOMER_KEY_SINGLE_NOKYC }}
      wpay-merchant-id-single-nokyc: ${{ secrets.WPAY_MERCHANT_ID_SINGLE_NOKYC }}
      wpay-customer-key-multi-nokyc: ${{ secrets.WPAY_CUSTOMER_KEY_MULTI_NOKYC }}
      wpay-merchant-id-multi-nokyc: ${{ secrets.WPAY_MERCHANT_ID_MULTI_NOKYC }}
      wpay-customer-key-multi-kyc: ${{ secrets.WPAY_CUSTOMER_KEY_MULTI_KYC }}
      wpay-merchant-id-multi-kyc: ${{ secrets.WPAY_MERCHANT_ID_MULTI_KYC }}
```

### Android (emulator runner)

The `reactivecircus/android-emulator-runner` action runs everything inside a `script:` block, which cannot call composite actions. Use `maestro/pay-tests` and `maestro/setup` *before* the emulator step, then run `maestro test` inline:

```yaml
steps:
  - uses: actions/checkout@v4

  # ... your platform-specific build steps ...

  - name: Copy shared Pay test flows
    uses: WalletConnect/actions/maestro/pay-tests@main

  - name: Install Maestro
    uses: WalletConnect/actions/maestro/setup@main

  - name: Run E2E tests on Android Emulator
    id: maestro
    uses: reactivecircus/android-emulator-runner@v2
    with:
      api-level: 34
      arch: x86_64
      script: |
        adb install path/to/app.apk
        $HOME/.maestro/bin/maestro test \
          --env APP_ID="com.example.wallet.internal" \
          --env WPAY_CUSTOMER_KEY_SINGLE_NOKYC="${{ secrets.WPAY_CUSTOMER_KEY_SINGLE_NOKYC }}" \
          --env WPAY_MERCHANT_ID_SINGLE_NOKYC="${{ secrets.WPAY_MERCHANT_ID_SINGLE_NOKYC }}" \
          --env WPAY_CUSTOMER_KEY_MULTI_NOKYC="${{ secrets.WPAY_CUSTOMER_KEY_MULTI_NOKYC }}" \
          --env WPAY_MERCHANT_ID_MULTI_NOKYC="${{ secrets.WPAY_MERCHANT_ID_MULTI_NOKYC }}" \
          --env WPAY_CUSTOMER_KEY_MULTI_KYC="${{ secrets.WPAY_CUSTOMER_KEY_MULTI_KYC }}" \
          --env WPAY_MERCHANT_ID_MULTI_KYC="${{ secrets.WPAY_MERCHANT_ID_MULTI_KYC }}" \
          --include-tags pay \
          --test-output-dir maestro-artifacts \
          --debug-output maestro-artifacts \
          .maestro/

  - name: Upload Maestro artifacts
    if: always()
    uses: actions/upload-artifact@v4
    with:
      name: maestro-android-artifacts
      path: |
        maestro-artifacts/
      retention-days: 14
```
