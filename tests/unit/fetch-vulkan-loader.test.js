/**
 * scripts/fetch-vulkan-loader.js: the archive and the file are each refused unless their sha256
 * is the pinned one.
 */

const { checkBytes, sha256 } = require('../../scripts/fetch-vulkan-loader');

test('bytes match only their pinned sha256', () => {
  const bytes = Buffer.from('vulkan-1.dll bytes');
  expect(checkBytes(bytes, sha256(bytes), 'the loader')).toEqual([]);
  expect(checkBytes(Buffer.from('other'), sha256(bytes), 'the loader').join(' ')).toMatch(/the loader has sha256 [0-9a-f]{64}, the pin says/);
  expect(checkBytes(bytes, null, 'the loader').join(' ')).toMatch(/no sha256 for the loader/);
});
