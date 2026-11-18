<?php

namespace Lopyta\MailGateway\Laravel\Events;

class GatewayWebhookReceived
{
    public function __construct(
        public readonly string $event,
        public readonly array $data,
        public readonly array $envelope
    ) {}
}
