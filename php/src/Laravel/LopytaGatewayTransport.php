<?php

namespace Lopyta\MailGateway\Laravel;

use Lopyta\MailGateway\Client;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Symfony\Component\Mime\MessageConverter;

class LopytaGatewayTransport extends AbstractTransport
{
    public function __construct(
        protected Client $client
    ) {
        parent::__construct();
    }

    protected function doSend(SentMessage $message): void
    {
        $email = MessageConverter::toEmail($message->getOriginalMessage());

        $toAddresses = $email->getTo();
        if (empty($toAddresses)) {
            throw new \RuntimeException('Tidak ada alamat email penerima (To).');
        }

        $replyToAddresses = $email->getReplyTo();
        $replyTo = !empty($replyToAddresses) ? $replyToAddresses[0]->getAddress() : null;

        $htmlBody = $email->getHtmlBody();
        if (is_resource($htmlBody)) {
            $htmlBody = stream_get_contents($htmlBody);
        }

        $textBody = $email->getTextBody();
        if (is_resource($textBody)) {
            $textBody = stream_get_contents($textBody);
        }

        $attachments = [];
        foreach ($email->getAttachments() as $attachment) {
            $attachments[] = [
                'filename' => $attachment->getFilename() ?: 'attachment.bin',
                'content_type' => $attachment->getMediaType() . '/' . $attachment->getMediaSubtype(),
                'content_base64' => base64_encode($attachment->getBody()),
            ];
        }

        $externalId = $email->getHeaders()->get('X-Gateway-External-Id')?->getBodyAsString();
        $fromAddresses = $email->getFrom();
        $fromNameRaw = !empty($fromAddresses) ? trim((string) $fromAddresses[0]->getName()) : '';
        $fromName = ($fromNameRaw !== '' && !in_array(strtolower($fromNameRaw), ['laravel', 'example'], true))
            ? $fromNameRaw
            : null;

        foreach ($toAddresses as $toAddr) {
            $payload = array_filter([
                'to' => [
                    'email' => $toAddr->getAddress(),
                    'name' => $toAddr->getName() ?: null,
                ],
                'from_name' => $fromName,
                'reply_to' => $replyTo,
                'subject' => (string) ($email->getSubject() ?: '(Tanpa Subjek)'),
                'html' => is_string($htmlBody) && $htmlBody !== '' ? $htmlBody : null,
                'text' => is_string($textBody) && $textBody !== '' ? $textBody : null,
                'attachments' => !empty($attachments) ? $attachments : null,
                'external_id' => $externalId ?: null,
            ], static fn ($v) => $v !== null);

            $result = $this->client->send($payload);

            if (!empty($result['message_id'])) {
                $email->getHeaders()->addTextHeader('X-Gateway-Message-Id', (string) $result['message_id']);
            }
        }
    }

    public function __toString(): string
    {
        return 'lopyta-gateway';
    }
}
