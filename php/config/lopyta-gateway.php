<?php

return [
    'url' => env('LOPYTA_GATEWAY_URL', env('SEO_GATEWAY_URL', 'https://lopyta.com')),
    'client_id' => env('LOPYTA_GATEWAY_CLIENT_ID', env('SEO_GATEWAY_CLIENT_ID', '')),
    'client_secret' => env('LOPYTA_GATEWAY_CLIENT_SECRET', env('SEO_GATEWAY_CLIENT_SECRET', '')),
    'webhook_secret' => env('LOPYTA_GATEWAY_WEBHOOK_SECRET', env('SEO_GATEWAY_WEBHOOK_SECRET', '')),
    'timeout' => (int) env('LOPYTA_GATEWAY_TIMEOUT', env('SEO_GATEWAY_TIMEOUT', 30)),
];
