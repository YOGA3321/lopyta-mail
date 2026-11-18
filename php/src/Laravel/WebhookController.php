<?php

namespace Lopyta\MailGateway\Laravel;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Lopyta\MailGateway\Exceptions\GatewayRejectedException;
use Lopyta\MailGateway\Laravel\Events\GatewayWebhookReceived;
use Lopyta\MailGateway\WebhookVerifier;

class WebhookController
{
    public function handle(Request $request): JsonResponse
    {
        $secret = (string) (config('lopyta-gateway.webhook_secret') ?: config('services.seo_gateway.webhook_secret', ''));

        try {
            $parsed = WebhookVerifier::parse(
                $request->getContent(),
                $request->header('X-Gateway-Signature'),
                $secret
            );
        } catch (GatewayRejectedException $e) {
            return response()->json(['error' => $e->getMessage()], $e->httpStatus);
        }

        event(new GatewayWebhookReceived(
            (string) $parsed['event'],
            is_array($parsed['data'] ?? null) ? $parsed['data'] : [],
            $parsed
        ));

        return response()->json(['status' => 'processed', 'event' => $parsed['event']]);
    }
}
