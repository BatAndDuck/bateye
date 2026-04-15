import { createGateway } from 'ai';
import { Agent } from 'undici';

const MIN_GATEWAY_TIMEOUT_MS = 15 * 60 * 1000;
const GATEWAY_TIMEOUT_BUFFER_MS = 30_000;

export function resolveGatewayRequestTimeoutMs(timeoutMs?: number): number {
  const requestedTimeoutMs = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs + GATEWAY_TIMEOUT_BUFFER_MS
    : 0;

  return Math.max(MIN_GATEWAY_TIMEOUT_MS, requestedTimeoutMs);
}

export function createBateyeGateway(options: {
  apiKey: string;
  baseURL?: string;
  timeoutMs?: number;
}) {
  const requestTimeoutMs = resolveGatewayRequestTimeoutMs(options.timeoutMs);
  const dispatcher = new Agent({
    headersTimeout: requestTimeoutMs,
    bodyTimeout: requestTimeoutMs,
  });

  return createGateway({
    apiKey: options.apiKey,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    fetch: (url, init) => fetch(url, {
      ...init,
      dispatcher,
    } as unknown as RequestInit),
  });
}
