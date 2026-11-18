<?php

return [
    'url' => env('LOPYTA_GATEWAY_URL'),
    'client_id' => env('LOPYTA_GATEWAY_CLIENT_ID'),
    'client_secret' => env('LOPYTA_GATEWAY_CLIENT_SECRET'),
    'webhook_secret' => env('LOPYTA_GATEWAY_WEBHOOK_SECRET'),
    'timeout' => env('LOPYTA_GATEWAY_TIMEOUT') !== null && env('LOPYTA_GATEWAY_TIMEOUT') !== ''
        ? (int) env('LOPYTA_GATEWAY_TIMEOUT')
        : null,
];
