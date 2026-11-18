<?php

namespace Lopyta\MailGateway\Laravel;

use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Lopyta\MailGateway\Client;

class LopytaGatewayServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__ . '/../../config/lopyta-gateway.php', 'lopyta-gateway');

        $this->app->singleton(Client::class, function ($app) {
            $cfg = $app['config']->get('lopyta-gateway', []);
            return new Client(
                (string) ($cfg['client_id'] ?? ''),
                (string) ($cfg['client_secret'] ?? ''),
                (string) ($cfg['url'] ?? 'https://lopyta.com'),
                max(1, (int) ($cfg['timeout'] ?? 30))
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
