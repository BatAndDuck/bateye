const test = require('node:test');
const assert = require('node:assert/strict');

const { formatErrorWithCauses } = require('../../dist/core/runtime/error-format');

test('formatErrorWithCauses includes nested cause details and socket metadata', () => {
  const rootCause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4096'), {
    code: 'ECONNREFUSED',
    syscall: 'connect',
    address: '127.0.0.1',
    port: 4096,
  });
  const error = new Error('fetch failed', { cause: rootCause });

  assert.equal(
    formatErrorWithCauses(error),
    'fetch failed <- connect ECONNREFUSED 127.0.0.1:4096 (code=ECONNREFUSED, syscall=connect, address=127.0.0.1, port=4096)',
  );
});

test('formatErrorWithCauses flattens aggregate causes without duplication', () => {
  const nested = new AggregateError(
    [
      Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT', syscall: 'read' }),
      Object.assign(new Error('getaddrinfo ENOTFOUND ai-gateway.vercel.sh'), { code: 'ENOTFOUND', hostname: 'ai-gateway.vercel.sh' }),
    ],
    'fetch failed',
  );

  assert.match(formatErrorWithCauses(nested), /fetch failed/);
  assert.match(formatErrorWithCauses(nested), /ETIMEDOUT/);
  assert.match(formatErrorWithCauses(nested), /ENOTFOUND/);
});
