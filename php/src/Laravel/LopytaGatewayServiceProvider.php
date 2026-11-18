<?php

namespace Lopyta\MailGateway\Laravel;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Lopyta\MailGateway\Client;
use Lopyta\MailGateway\Exceptions\TransientGatewayException;

class LopytaGatewayServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__ . '/../../config/lopyta-gateway.php', 'lopyta-gateway');

        $this->app->bind(Client::class, function ($app) {
            $primary = $app['config']->get('lopyta-gateway', []);
            $legacy = $app['config']->get('services.seo_gateway', []);

            $clientId = trim((string) (($primary['client_id'] ?? '') ?: ($legacy['client_id'] ?? '')));
            $clientSecret = trim((string) (($primary['client_secret'] ?? '') ?: ($legacy['client_secret'] ?? '')));
            $baseUrl = trim((string) (($primary['url'] ?? '') ?: ($legacy['url'] ?? 'https://lopyta.com')));
            $timeout = max(1, (int) (($primary['timeout'] ?? 0) ?: ($legacy['timeout'] ?? 30)));

            $laravelTransport = static function (
                string $method,
                string $url,
                array $headerLines,
                ?string $jsonBody,
                int $timeoutSecs
            ): array {
                $headers = [];
                foreach ($headerLines as $line) {
                    if (str_contains($line, ':')) {
                        [$k, $v] = explode(':', $line, 2);
                        $k = trim($k);
                        if (strtolower($k) !== 'content-type') {
                            $headers[$k] = trim($v);
                        }
                    }
                }

                try {
                    $pending = Http::withHeaders($headers)->timeout($timeoutSecs);
                    $options = $jsonBody !== null
                        ? ['body' => $jsonBody, 'headers' => ['Content-Type' => 'application/json']]
                        : [];
                    $response = $pending->send($method, $url, $options);
                } catch (ConnectionException $e) {
                    throw new TransientGatewayException(
                        'Koneksi atau timeout ke Lopyta Gateway gagal: ' . $e->getMessage(),
                        null,
                        $e
                    );
                }

                return [$response->status(), $response->body()];
            };

            return new Client(
                $clientId,
                $clientSecret,
                $baseUrl !== '' ? $baseUrl : 'https://lopyta.com',
                $timeout,
                2,
                400,
                $laravelTransport
            );
        });
    }

    public function boot(): void
    {
        if ($this->app->runningInConsole()) {
            $this->publishes([
                __DIR__ . '/../../config/lopyta-gateway.php' => config_path('lopyta-gateway.php'),
            ], 'lopyta-gateway-config');
        }

        Mail::extend('lopyta-gateway', function () {
            return new LopytaGatewayTransport($this->app->make(Client::class));
        });

        Mail::extend('seo-gateway', function () {
            return new LopytaGatewayTransport($this->app->make(Client::class));
        });

        Route::macro('lopytaWebhook', function (string $uri = '/v1/webhooks/email-gateway') {
            $csrfClasses = array_values(array_filter([
                \Illuminate\Foundation\Http\Middleware\ValidateCsrfToken::class,
                \Illuminate\Foundation\Http\Middleware\VerifyCsrfToken::class,
            ], static fn (string $cls) => class_exists($cls)));

            $route = Route::post($uri, [WebhookController::class, 'handle']);
            return !empty($csrfClasses) ? $route->withoutMiddleware($csrfClasses) : $route;
        });
    }
}
