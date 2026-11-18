<?php

namespace Lopyta\MailGateway\Exceptions;

class GatewayRejectedException extends \RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $httpStatus = 400,
        public readonly ?string $errorCode = null
    ) {
        parent::__construct($message, $httpStatus);
    }
}
