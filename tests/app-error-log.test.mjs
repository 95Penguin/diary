import assert from 'node:assert/strict';
import test from 'node:test';

import { formatAppErrorLogItems, redactDiagnosticValue } from '../src/utils/app-error-log-core.ts';

test('diagnostic redaction removes API keys, local paths and precise coordinates', () => {
  const source = 'AIzaSyB0j2MwbaY9TLQU3rbfTYZLqGI9VyfnVek file:///private/data/photo.jpg /Users/me/project 39.95912, 116.35781';
  const redacted = redactDiagnosticValue(source);
  assert.equal(redacted.includes('AIza'), false);
  assert.equal(redacted.includes('/Users/me'), false);
  assert.equal(redacted.includes('39.95912'), false);
  assert.match(redacted, /API_KEY/);
  assert.match(redacted, /坐标/);
});

test('formatted error log contains only the supplied technical fields', () => {
  const output = formatAppErrorLogItems([{
    id: '1',
    occurredAt: '2026-07-30T12:00:00.000Z',
    context: 'backup.export',
    name: 'Error',
    message: 'sharing-unavailable',
  }]);
  assert.match(output, /backup\.export/);
  assert.match(output, /sharing-unavailable/);
});
