// Creates a WalletConnect Pay payment via the API.
// Expects WPAY_CUSTOMER_KEY and WPAY_MERCHANT_ID env vars from Maestro.
// Optional WPAY_PAY_API_URL overrides the API base URL (default: prod).
// Sets output.gateway_url and output.payment_id for use in subsequent flow steps.

if (typeof WPAY_CUSTOMER_KEY === 'undefined') throw new Error('Missing env var: WPAY_CUSTOMER_KEY');
if (typeof WPAY_MERCHANT_ID === 'undefined') throw new Error('Missing env var: WPAY_MERCHANT_ID');

var baseUrl = (typeof WPAY_PAY_API_URL !== 'undefined' && WPAY_PAY_API_URL)
  ? WPAY_PAY_API_URL
  : 'https://api.pay.walletconnect.com';

var response = http.post(baseUrl + '/v1/payments', {
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

if (response.status < 200 || response.status >= 300) {
  throw new Error('API returned HTTP ' + response.status + ': ' + response.body);
}

var data = json(response.body);

if (!data.gatewayUrl) {
  throw new Error('No gatewayUrl in response: ' + response.body);
}

console.log('Payment created: ' + data.paymentId);
output.gateway_url = data.gatewayUrl;
output.payment_id = data.paymentId;
