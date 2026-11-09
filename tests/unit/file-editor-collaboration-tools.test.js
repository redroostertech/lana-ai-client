'use strict';

const fs = require('fs');
const path = require('path');

const collaborationTools = require(path.join(
  __dirname,
  '../../src/js/file-editor/collaboration-tools.js'
));
const editorSource = fs.readFileSync(path.join(__dirname, '../../src/js/file-editor.js'), 'utf8');
const editorHtml = fs.readFileSync(path.join(__dirname, '../../src/file-editor.html'), 'utf8');
const routerPages = fs.readFileSync(path.join(__dirname, '../../src/js/lex/lex-router.pages.js'), 'utf8');

describe('file-editor collaboration tools', () => {
  describe('signature packet from a link (?signature_packet=)', () => {
    const packets = [
      { id: 'pk-1', signers: [{ email: 'pat.lee@example.com' }] },
      { id: 'pk-2', signers: [{ email: 'Alex.Smith@Example.com' }, { email: 'pat.lee@example.com' }] }
    ];
    const focus = (input) => collaborationTools.signaturePacketFocus(input);

    test('the packet in the link opens the panel on that packet for its signer', () => {
      expect(focus({ packetId: 'pk-2', packets, currentEmail: ' alex.smith@example.com ' }))
        .toEqual({ action: 'open', packetId: 'pk-2' });
    });

    test('a packet that is not on this document says so and leaves the document open', () => {
      const result = focus({ packetId: 'pk-9', packets, currentEmail: 'alex.smith@example.com' });
      expect(result).toMatchObject({ action: 'message', reason: 'not_found' });
      expect(result.message).toBe('This signature request is not on this document. It may have been cancelled or replaced. The document is open.');
    });

    test('someone who is not a signer is told plainly', () => {
      const result = focus({ packetId: 'pk-1', packets, currentEmail: 'alex.smith@example.com' });
      expect(result).toMatchObject({ action: 'message', reason: 'not_signer' });
      expect(result.message).toBe('You are not a signer on this signature request. The document is open.');
      expect(focus({ packetId: 'pk-1', packets, currentEmail: '' }).reason).toBe('not_signer');
    });

    test('packets that could not load say so', () => {
      expect(focus({ packetId: 'pk-1', packets: [], currentEmail: 'pat.lee@example.com', loadFailed: true }))
        .toMatchObject({ action: 'message', reason: 'load_failed' });
    });

    test('no packet in the link keeps today\'s behaviour', () => {
      expect(focus({ packetId: '', packets, currentEmail: 'pat.lee@example.com' })).toEqual({ action: 'none' });
      expect(focus({ packets, currentEmail: 'pat.lee@example.com', loadFailed: true })).toEqual({ action: 'none' });
      expect(focus(undefined)).toEqual({ action: 'none' });
    });

    test('File Editor reads signature_packet once and acts on it after the packets load', () => {
      expect(editorSource).toContain("routeSignaturePacketId = String(routeParams().get('signature_packet') || '').trim();");
      const loader = editorSource.slice(
        editorSource.indexOf('async function loadRemoteWorkflows(file, options)'),
        editorSource.indexOf('function setUpdated(file)')
      );
      expect(loader.indexOf('focusRouteSignaturePacket(remote);')).toBeGreaterThan(loader.indexOf('} finally {'));
      expect(loader).toContain('tools.signaturePacketFocus({');
      expect(loader).toContain("routeSignaturePacketId = '';");
      expect(loader).toMatch(/focus\.action === 'open'\) \{\s*remote\.selectedPacketId = focus\.packetId;\s*activateOfficePanel\('signatures'\);/);
      expect(loader).toMatch(/focus\.action === 'message'\) \{\s*notice\(focus\.message\);/);
    });
  });

  describe('signature signer staging', () => {
    test('rejects duplicate emails case-insensitively after trimming', () => {
      const signers = [
        { name: 'Alex Smith', email: 'alex.smith@example.com' },
        { name: 'Pat Lee', email: 'pat.lee@example.com' }
      ];

      expect(collaborationTools.hasDuplicateSigner(signers, '  ALEX.SMITH@EXAMPLE.COM ')).toBe(true);
      expect(collaborationTools.hasDuplicateSigner(signers, 'new.signer@example.com')).toBe(false);
    });

    test('does not treat an empty candidate as a duplicate', () => {
      expect(collaborationTools.hasDuplicateSigner([{ email: '' }], '   ')).toBe(false);
      expect(collaborationTools.hasDuplicateSigner(null, 'person@example.com')).toBe(false);
    });
  });

  describe('review comment anchors', () => {
    test('builds a persisted range with surrounding context', () => {
      const text = 'Opening context. The selected contract language is important. Closing context.';
      const selected = 'selected contract language';
      const start = text.indexOf(selected);

      expect(collaborationTools.buildCommentAnchor(text, start, start + selected.length, selected)).toEqual({
        anchor_start: start,
        anchor_end: start + selected.length,
        anchor_prefix: text.slice(Math.max(0, start - 48), start),
        anchor_suffix: text.slice(start + selected.length, start + selected.length + 48)
      });
    });

    test('prefers a valid persisted range when the same text occurs more than once', () => {
      const text = 'Repeat this clause. Intervening language. Repeat this clause.';
      const selected = 'Repeat this clause.';
      const start = text.lastIndexOf(selected);

      expect(collaborationTools.resolveCommentAnchor(text, {
        anchor_text: selected,
        anchor_start: start,
        anchor_end: start + selected.length
      })).toEqual({
        start,
        end: start + selected.length,
        strategy: 'persisted-range'
      });
    });

    test('uses saved prefix and suffix to disambiguate an old or shifted range', () => {
      const text = 'First: shared phrase. Second: shared phrase follows this marker.';
      const selected = 'shared phrase';
      const expectedStart = text.lastIndexOf(selected);

      expect(collaborationTools.resolveCommentAnchor(text, {
        anchor_text: selected,
        anchor_start: 0,
        anchor_end: selected.length,
        anchor_prefix: 'First: shared phrase. Second: ',
        anchor_suffix: ' follows this marker.'
      })).toEqual({
        start: expectedStart,
        end: expectedStart + selected.length,
        strategy: 'anchor-text-context'
      });
    });

    test('falls back to anchor text and returns null when the text was removed', () => {
      expect(collaborationTools.resolveCommentAnchor('Before located words after', {
        anchor_text: 'located words'
      })).toEqual({
        start: 7,
        end: 20,
        strategy: 'anchor-text'
      });
      expect(collaborationTools.resolveCommentAnchor('The selection is gone.', {
        anchor_text: 'located words'
      })).toBeNull();
    });

    test('refuses invalid capture ranges instead of persisting unsafe offsets', () => {
      expect(collaborationTools.buildCommentAnchor('Short text', -1, 4, 'Shor')).toBeNull();
      expect(collaborationTools.buildCommentAnchor('Short text', 0, 50, 'Short text')).toBeNull();
      expect(collaborationTools.buildCommentAnchor('Short text', 0, 5, 'wrong')).toBeNull();
    });
  });

  test('wires duplicate feedback and comment Locate through the File Editor', () => {
    expect(editorHtml).toContain('js/file-editor/collaboration-tools.js');
    expect(routerPages).toContain("'js/file-editor/collaboration-tools.js'");
    expect(editorSource).toContain("toast('That signer has already been added to this packet.')");
    expect(editorSource).toContain('data-action="locate-review-comment"');
    expect(editorSource).toContain('function locateOfficeReviewComment(file, commentId)');
    expect(editorSource).toContain('anchor_id: anchorText ? \'anchor-\' + id : \'\'');
    expect(editorSource).toContain("location.strategy === 'persisted-range'");
  });
});
