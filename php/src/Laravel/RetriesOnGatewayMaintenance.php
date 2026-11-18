<?php

namespace Lopyta\MailGateway\Laravel;

use DateTimeInterface;
use Lopyta\MailGateway\Exceptions\TransientGatewayException;

trait RetriesOnGatewayMaintenance
{
    public int $tries = 35;

    public int $maxExceptions = 35;

    public function retryUntil(): DateTimeInterface
    {
        return now()->addHours(24);
    }

    /**
     * @return array<int, int>
     */
    public function backoff(): array
    {
        return [15, 30, 60, 120, 300, 600, 900, 1800, 3600];
    }

    protected function shouldRetryGatewayError(\Throwable $e): bool
    {
        for ($cur = $e; $cur !== null; $cur = $cur->getPrevious()) {
            if ($cur instanceof TransientGatewayException) {
                return true;
            }
        }
        return false;
    }
}
