export interface InlineRetryOptions {
  /** Maksimum percobaan kilat langsung per panggilan HTTP (default: 2). */
  maxAttempts?: number;
  /** Jeda awal sebelum retry kedua dalam milidetik (default: 400 ms). */
  initialDelayMs?: number;
  /** Batas maksimum jeda backoff dalam milidetik (default: 3000 ms). */
  maxDelayMs?: number;
}

export interface LopytaClientConfig {
  /** URL dasar gateway Lopyta, contoh: "https://lopyta.com". */
  baseUrl?: string;
  clientId: string;
  clientSecret: string;
  /** Timeout tiap HTTP request dalam milidetik (default: 30000). */
  timeoutMs?: number;
  /** Pengaturan retry kilat untuk blip jaringan singkat. */
  inlineRetry?: InlineRetryOptions;
  /** Custom fetch implementation (opsional, default global fetch Node 18+). */
  fetchFn?: typeof fetch;
}

export type RecipientInput =
  | string
  | {
      email: string;
      name?: string;
    };

export interface EmailAttachmentInput {
  filename: string;
  content_type?: string;
  content_base64: string;
}

export interface SendEmailInput {
  to: RecipientInput;
  from_email?: string;
  from_name?: string;
  reply_to?: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachmentInput[];
  external_id?: string;
  metadata?: Record<string, unknown>;
}

export interface SendEmailResponse {
  success: boolean;
  message_id: string;
  status: string;
  from_email: string;
  from_name: string;
  to_email: string;
}

export interface BroadcastRecipient {
  email: string;
  name?: string;
  subject?: string;
  html?: string;
  text?: string;
  variables?: Record<string, string>;
  external_id?: string;
  metadata?: Record<string, unknown>;
}

export interface BroadcastEmailInput {
  from_email?: string;
  from_name?: string;
  reply_to?: string;
  subject: string;
  html?: string;
  text?: string;
  external_batch_id?: string;
  attachments?: EmailAttachmentInput[];
  recipients: BroadcastRecipient[];
}

export interface BroadcastEmailResponse {
  success: boolean;
  batch_id: string;
  external_batch_id?: string | null;
  status: string;
  from_email: string;
  from_name: string;
  accepted_count: number;
  skipped_invalid_count: number;
  rate_limit_per_sec: number;
}

export interface ClientInfo {
  id: string;
  name: string;
  slug: string;
  client_id: string;
  default_from_email: string;
  default_from_name: string;
  allowed_from_emails: string[];
  webhook_url?: string | null;
  daily_limit?: number | null;
  is_active: boolean;
}

export interface UsageResponse {
  success: boolean;
  client_id: string;
  client_name: string;
  default_from_email: string;
  default_from_name: string;
  usage: {
    sent_today: number;
    delivered_today: number;
    failed_today: number;
    queued_now: number;
    total_all_time: number;
    client_daily_limit?: number | null;
  };
  gateway: {
    global_rate_limit_per_sec: number;
    global_daily_limit: number;
    global_sent_today: number;
    global_remaining_today: number;
  };
}

export interface MessageStatusResponse {
  success: boolean;
  message: {
    id: string;
    batch_id?: string | null;
    external_id?: string | null;
    from_email: string;
    from_name: string;
    to_email: string;
    subject: string;
    status: string;
    ses_message_id?: string | null;
    error_message?: string | null;
    attempts: number;
    sent_at?: string | null;
    delivered_at?: string | null;
    created_at: string;
  };
}

export interface BatchStatusResponse {
  success: boolean;
  batch: {
    id: string;
    client_id: string;
    external_batch_id?: string | null;
    subject: string;
    from_email: string;
    from_name: string;
    total_recipients: number;
    sent_count: number;
    failed_count: number;
    status: string;
    webhook_notified_at?: string | null;
    created_at: string;
    completed_at?: string | null;
  };
}

export type WebhookEventType =
  | "email.sent"
  | "email.delivered"
  | "email.bounced"
  | "email.complained"
  | "email.rejected"
  | "email.delayed"
  | "email.failed"
  | "email.ses_event"
  | "batch.progress"
  | "batch.completed"
  | (string & {});

export interface WebhookSentItem {
  gateway_message_id: string;
  recipient_email: string;
  external_id?: string | null;
  ses_message_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface WebhookEmailEventData {
  gateway_message_id: string;
  ses_message_id?: string | null;
  batch_id?: string | null;
  external_id?: string | null;
  recipient_email: string;
  status: string;
  ses_event_type?: string;
  error_message?: string | null;
  metadata?: Record<string, unknown>;
  raw_ses_event?: unknown;
}

export interface WebhookBatchEventData {
  batch_id: string;
  external_batch_id?: string | null;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  status?: string;
  sent_items?: WebhookSentItem[];
}

export interface ParsedWebhookEvent<T = Record<string, unknown>> {
  delivery_id: string;
  event: WebhookEventType;
  client_id: string;
  timestamp: string;
  data: T;
}
