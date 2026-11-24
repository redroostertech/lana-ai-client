'use strict';

// Link options for the note editor (StarterKit's Link). The library default rel
// drops the referrer, so a read-only, middle or Cmd click opens with no app
// referrer and the external opener always asks. Keeping the referrer makes
// every open of a typed link behave the same as a normal click while editing.
// Only rel is set; target and the other Link defaults stay as they are.
const NOTE_LINK_OPTIONS = Object.freeze({
  HTMLAttributes: Object.freeze({ rel: 'noopener nofollow' }),
});

module.exports = { NOTE_LINK_OPTIONS };
