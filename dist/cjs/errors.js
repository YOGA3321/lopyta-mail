"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LopytaClientError = exports.LopytaTransientError = exports.LopytaGatewayError = void 0;
exports.isRetryableGatewayError = isRetryableGatewayError;
class LopytaGatewayError extends Error {
    statusCode;
    code;
    retryable;
    constructor(message, opts = {}) {
        super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
        this.name = new.target.name;
        this.statusCode = opts.statusCode;
        this.code = opts.code;
        this.retryable = opts.retryable ?? false;
    }
}
exports.LopytaGatewayError = LopytaGatewayError;
/**
 * Error sementara (network putus, timeout, HTTP 408 / 429 / 5xx saat gateway maintenance/lag).
 * Aman dan disarankan untuk di-retry oleh LopytaMailQueue hingga 24 jam.
 */
class LopytaTransientError extends LopytaGatewayError {
    constructor(message, opts = {}) {
        super(message, { ...opts, retryable: true });
    }
}
exports.LopytaTransientError = LopytaTransientError;
/**
 * Error permanen dari sisi client (payload salah, Client Secret salah, client nonaktif/kedaluwarsa).
 * Tidak di-retry otomatis karena hasilnya akan tetap ditolak.
 */
class LopytaClientError extends LopytaGatewayError {
    constructor(message, opts = {}) {
        super(message, { ...opts, retryable: false });
    }
}
exports.LopytaClientError = LopytaClientError;
function isRetryableGatewayError(err) {
    if (err instanceof LopytaGatewayError) {
        return err.retryable;
    }
    return false;
}
