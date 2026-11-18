import type { BatchStatusResponse, BroadcastEmailInput, BroadcastEmailResponse, ClientInfo, LopytaClientConfig, MessageStatusResponse, SendEmailInput, SendEmailResponse, UsageResponse } from "./types.js";
export declare class LopytaMailClient {
    readonly baseUrl: string;
    private readonly clientId;
    private readonly clientSecret;
    private readonly timeoutMs;
    private readonly inlineMaxAttempts;
    private readonly inlineInitialDelayMs;
    private readonly inlineMaxDelayMs;
    private readonly fetchFn;
    constructor(config: LopytaClientConfig);
    /**
     * Membuat client langsung dari environment variables (.env).
     * Mendukung prefix LOPYTA_GATEWAY_* maupun SEO_GATEWAY_*.
     */
    static fromEnv(env?: Record<string, string | undefined>): LopytaMailClient;
    /** Mengirim 1 email transaksional ke POST /api/v1/send (dikembalikan status queued / 202). */
    send(input: SendEmailInput): Promise<SendEmailResponse>;
    /**
     * Mengirim broadcast massal hingga 25.000 penerima per 1 HTTP JSON request ke POST /api/v1/broadcast.
     * Jika penerima melebihi 25.000, otomatis dipecah menjadi beberapa chunk batch.
     */
    broadcast(input: BroadcastEmailInput): Promise<BroadcastEmailResponse>;
    broadcastChunked(input: BroadcastEmailInput, chunkSize?: number): Promise<BroadcastEmailResponse[]>;
    /** Mengambil profil client & alamat sender default dari GET /api/v1/me. */
    me(): Promise<ClientInfo>;
    /** Mengambil pemakaian kuota & rate limit global dari GET /api/v1/usage. */
    usage(): Promise<UsageResponse>;
    /** Mengecek status 1 email berdasarkan message_id. */
    getMessageStatus(messageId: string): Promise<MessageStatusResponse>;
    /** Mengecek progres batch broadcast berdasarkan batch_id. */
    getBatchStatus(batchId: string): Promise<BatchStatusResponse>;
    private request;
    private computeInlineBackoffMs;
}
