type ErrorLike = {
  message?: string;
  cause?: unknown;
  code?: unknown;
  errno?: unknown;
  syscall?: unknown;
  hostname?: unknown;
  address?: unknown;
  port?: unknown;
  status?: unknown;
  url?: unknown;
  errors?: unknown[];
};

function asErrorLike(value: unknown): ErrorLike | null {
  return value && typeof value === 'object' ? value as ErrorLike : null;
}

function collectSegments(error: unknown, seen = new Set<unknown>()): string[] {
  if (!error || seen.has(error)) {
    return [];
  }

  seen.add(error);
  const candidate = asErrorLike(error);
  if (!candidate) {
    return [String(error)];
  }

  const segments: string[] = [];
  const message = typeof candidate.message === 'string' ? candidate.message.trim() : '';
  const detailParts = [
    formatDetail('code', candidate.code),
    formatDetail('errno', candidate.errno),
    formatDetail('syscall', candidate.syscall),
    formatDetail('hostname', candidate.hostname),
    formatDetail('address', candidate.address),
    formatDetail('port', candidate.port),
    formatDetail('status', candidate.status),
    formatDetail('url', candidate.url),
  ].filter(Boolean);

  if (message) {
    segments.push(detailParts.length > 0 ? `${message} (${detailParts.join(', ')})` : message);
  } else if (detailParts.length > 0) {
    segments.push(detailParts.join(', '));
  }

  if (Array.isArray(candidate.errors)) {
    for (const nested of candidate.errors) {
      segments.push(...collectSegments(nested, seen));
    }
  }

  if (candidate.cause) {
    segments.push(...collectSegments(candidate.cause, seen));
  }

  return segments;
}

function formatDetail(label: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return `${label}=${String(value)}`;
}

export function formatErrorWithCauses(error: unknown): string {
  const uniqueSegments: string[] = [];
  for (const segment of collectSegments(error)) {
    if (segment && !uniqueSegments.includes(segment)) {
      uniqueSegments.push(segment);
    }
  }

  return uniqueSegments.length > 0 ? uniqueSegments.join(' <- ') : 'Unknown error';
}
