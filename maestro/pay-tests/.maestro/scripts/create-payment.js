// Creates a WalletConnect Pay payment via the API.
// Expects WPAY_CUSTOMER_KEY and WPAY_MERCHANT_ID env vars from Maestro.
// Optional WPAY_PAY_API_URL overrides the API base URL (default: prod).
// Sets output.gateway_url and output.payment_id for use in subsequent flow steps.

if (typeof WPAY_CUSTOMER_KEY === 'undefined') throw new Error('Missing env var: WPAY_CUSTOMER_KEY');
if (typeof WPAY_MERCHANT_ID === 'undefined') throw new Error('Missing env var: WPAY_MERCHANT_ID');

var baseUrl = (typeof WPAY_PAY_API_URL !== 'undefined' && WPAY_PAY_API_URL)
  ? WPAY_PAY_API_URL
  : 'https://api.pay.walletconnect.com';

// This is a single host-side network hop and, unlike the in-app steps (which run
// under a Maestro `retry {}`), nothing wraps it. We retry it, but only for
// TRANSIENT failures (5xx, 429, network error) — a transient blot otherwise fails
// the whole flow before the app even launches.
//
// A deterministic 4xx (e.g. 400 params_validation when the requested amount
// exceeds the merchant's per-payment cap) will NEVER succeed on retry, so we fail
// fast on it instead of burning ~10s of backoff on a guaranteed-lost cause. The
// thrown error carries the HTTP status + body so the real reason is visible rather
// than a silent "flow failed in 1s".
//
// Linear backoff; Maestro's JS runtime has no setTimeout, so we busy-wait.
var MAX_ATTEMPTS = 4;
var response = null;
var lastError = '';

function isRetryable(status) {
  // No HTTP status -> a thrown network/timeout error -> retry.
  // 429 (rate limited) and 5xx (server) are transient -> retry.
  // Everything else (incl. 4xx validation/auth) is deterministic -> don't retry.
  return status === 0 || status === 429 || status >= 500;
}

for (var attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  var status = 0;
  try {
    var r = http.post(baseUrl + '/v1/payments', {
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': WPAY_CUSTOMER_KEY,
        'Merchant-Id': WPAY_MERCHANT_ID,
      },
      body: JSON.stringify({
        referenceId: '' + Date.now() + Math.random().toString(36).substring(2, 10),
        amount: { value: typeof WPAY_AMOUNT !== 'undefined' ? WPAY_AMOUNT : '1', unit: 'iso4217/USD' },
      }),
    });
    if (r.status >= 200 && r.status < 300) {
      response = r;
      break;
    }
    status = r.status;
    lastError = 'HTTP ' + r.status + ': ' + r.body;
  } catch (e) {
    status = 0;
    lastError = '' + e;
  }

  // Deterministic error (e.g. 4xx) -> stop now and surface the real reason.
  if (!isRetryable(status)) {
    throw new Error('create-payment rejected (not retryable): ' + lastError);
  }

  console.log('create-payment attempt ' + attempt + '/' + MAX_ATTEMPTS + ' failed (transient): ' + lastError);

  if (attempt < MAX_ATTEMPTS) {
    var until = Date.now() + attempt * 1500; // 1.5s, 3s, 4.5s
    while (Date.now() < until) { /* busy-wait: no setTimeout in Maestro JS */ }
  }
}

if (!response) {
  throw new Error('create-payment failed after ' + MAX_ATTEMPTS + ' transient attempts. Last error: ' + lastError);
}

var data = json(response.body);

if (!data.gatewayUrl) {
  throw new Error('No gatewayUrl in response: ' + response.body);
}

console.log('Payment created: ' + data.paymentId);
output.gateway_url = data.gatewayUrl;
output.payment_id = data.paymentId;
