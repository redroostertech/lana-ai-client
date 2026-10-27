'use strict';

const { JSDOM } = require('jsdom');
const NoteListComponent = require('../../src/js/components/note-list.component');

function setupDom() {
  const dom = new JSDOM('<!DOCTYPE html><body></body>');
  global.window = dom.window;
  global.document = dom.window.document;

  document.body.innerHTML = [
    '<div id="notes-root"></div>',
    '<input id="notesTitleInput">',
    '<div id="notesEditorContainer"></div>',
    '<button id="notesSaveBtn"></button>',
    '<div id="notesFocusModal" class="hidden"></div>',
    '<button id="notesFocusModeToggle"><span></span></button>',
    '<input id="notesFocusTitleInput">',
    '<div id="notesFocusEditorContainer"></div>',
    '<button id="notesFocusSaveBtn"></button>'
  ].join('');
}

function createComponent(options = {}) {
  const component = Object.create(NoteListComponent.prototype);
  component.notes = [];
  component.options = {
    apiClient: {
      formatRelativeDate: jest.fn(),
      formatPreview: jest.fn()
    }
  };
  component.focusModeEditor = null;
  component.editingNoteId = null;
  if (options.mockToggleFocusMode !== false) {
    component.toggleFocusMode = jest.fn();
  }
  component.showSuccess = jest.fn();
  component.showError = jest.fn();
  return component;
}

describe('NoteListComponent content rendering', () => {
  beforeEach(() => {
    setupDom();
    delete window.Tiptap;
    delete window.TiptapEditor;
    delete window.TiptapStarterKit;
    delete window.TiptapPlaceholder;
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
  });

  test('renders plain text newlines as visible breaks without interpreting HTML', () => {
    const component = createComponent();

    expect(component.renderNoteContent('line one\nline two')).toBe('line one<br>line two');
    expect(component.renderNoteContent('<script>alert(1)</script>\nnext')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;<br>next');
    expect(component.renderNoteContent('<img src=x onerror=alert(1)>\nnext')).toBe('&lt;img src=x onerror=alert(1)&gt;<br>next');
    expect(component.renderNoteContent('Use <br> here')).toBe('Use &lt;br&gt; here');
    expect(component.renderNoteContent('literal <a href="https://example.com">text</a>'))
      .toBe('literal &lt;a href="https://example.com"&gt;text&lt;/a&gt;');
  });

  test('preserves sanitized rich HTML notes', () => {
    const component = createComponent();

    expect(component.renderNoteContent('<p>Hello<br>there</p><ul><li>A</li></ul>'))
      .toBe('<p>Hello<br>there</p><ul><li>A</li></ul>');
    expect(component.renderNoteContent('<p>Hello</p><a href="javascript:alert(1)" onclick="bad()">bad</a>'))
      .toBe('<p>Hello</p><a>bad</a>');
    expect(component.renderNoteContent('<a href="data:text/html,<script>alert(1)</script>">bad</a>'))
      .toBe('<a>bad</a>');
    expect(component.renderNoteContent('<a href="java&#x0A;script:alert(1)">bad</a>'))
      .toBe('<a>bad</a>');
    expect(component.renderNoteContent('<a href="jav&#x09;ascript:alert(1)">bad</a>'))
      .toBe('<a>bad</a>');
    expect(component.renderNoteContent('<a href="https://example.com" target="_blank">safe</a>'))
      .toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">safe</a>');
  });

  test('preloads plain text notes for editing without collapsing newlines', async () => {
    const component = createComponent();
    component.notes = [{
      note_id: 'note-1',
      title: 'Meeting note',
      content: 'first line\nsecond line'
    }];

    await component.handleEditNote('note-1');

    expect(document.getElementById('notesTitleInput').value).toBe('Meeting note');
    expect(document.getElementById('notesEditorContainer').innerHTML).toBe('first line<br>second line');
    expect(component.toggleFocusMode).toHaveBeenCalled();
    expect(component.editingNoteId).toBe('note-1');
  });

  test('focus mode initializes with current Tiptap bundle globals', () => {
    const component = createComponent({ mockToggleFocusMode: false });
    document.getElementById('notesEditorContainer').innerHTML = '<p>Existing</p>';

    const setContent = jest.fn();
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    window.TiptapStarterKit = { configure: jest.fn(() => 'starter-kit') };
    window.TiptapPlaceholder = { configure: jest.fn(() => 'placeholder') };
    window.TiptapEditor = jest.fn(function Editor() {
      this.commands = { setContent };
    });

    try {
      component.toggleFocusMode();
    } finally {
      logSpy.mockRestore();
    }

    expect(window.TiptapEditor).toHaveBeenCalled();
    expect(window.TiptapStarterKit.configure).toHaveBeenCalledWith({ heading: { levels: [1, 2, 3] } });
    expect(window.TiptapPlaceholder.configure).toHaveBeenCalledWith({ placeholder: 'Start writing...' });
    expect(setContent).toHaveBeenCalledWith('<p>Existing</p>');
  });
});
