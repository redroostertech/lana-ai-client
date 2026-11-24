'use strict';

// Links typed into notes must reach the external opener with the app page as
// referrer. With rel="noreferrer" (the Link extension default) a read-only
// editor, middle-click or Cmd-click opens with no referrer, so the opener
// always asks "open this link?", while a normal click in edit mode does not.

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../../src');
const { NOTE_LINK_OPTIONS } = require(path.join(SRC, 'js/shared/note-link-options.js'));

describe('note editor link options', () => {
  test('rel keeps the referrer and keeps noopener', () => {
    const rel = NOTE_LINK_OPTIONS.HTMLAttributes.rel;
    expect(rel).not.toMatch(/noreferrer/i);
    expect(rel.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'nofollow']));
  });

  test('merged into the real Link extension, only rel changes', () => {
    const LinkModule = require('@tiptap/extension-link');
    const Link = LinkModule.default || LinkModule.Link;
    expect(Link.configure(NOTE_LINK_OPTIONS).options.HTMLAttributes)
      .toEqual({ ...Link.options.HTMLAttributes, rel: 'noopener nofollow' });
  });

  test('the editor bundle configures StarterKit link with these options', () => {
    const bundle = fs.readFileSync(path.join(SRC, 'js/tiptap-bundle.js'), 'utf8');
    expect(bundle).toMatch(/note-link-options/);
    expect(bundle).toMatch(/window\.TiptapStarterKit\s*=\s*StarterKit\.configure\(\{\s*link:\s*NOTE_LINK_OPTIONS\s*\}\)/);
  });
});
