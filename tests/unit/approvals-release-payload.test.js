'use strict';

const fs = require('fs');
const path = require('path');

describe('Approval detail document release payload', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/js/approvals.js'), 'utf8');
  const releaseRenderer = source.slice(
    source.indexOf('function _renderDocumentReleasePayload'),
    source.indexOf('function _renderPayload')
  );

  test('shows a release summary without rendering the stored document bytes', () => {
    expect(source).toContain("=== 'document_edit_batch_release'");
    expect(releaseRenderer).toContain("{ key: 'Release content', value: _releaseSourceSummary(request) }");
    expect(releaseRenderer).not.toContain('request.contentBase64');
    expect(releaseRenderer).not.toContain('request.contentText');
  });
});
