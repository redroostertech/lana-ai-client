# Tiptap Editor Setup

The document template editor uses [Tiptap](https://tiptap.dev/) - a headless, block-based rich text editor built on ProseMirror.

## Why Tiptap?

- **Block-based editing**: Like Notion, each paragraph/heading/list is a separate block
- **Slash commands**: Type `/` to insert blocks and merge fields
- **Extensible**: Easy to add custom blocks, formatting, and functionality
- **No CDN dependencies**: All code is bundled locally with the app

## Build Process

Since browsers can't resolve npm package imports directly, we bundle Tiptap using esbuild.

### Building the Bundle

```bash
npm run build:tiptap
```

This creates:
- `src/js/tiptap-bundle-built.js` - The bundled editor (781KB)
- `src/js/tiptap-bundle-built.js.map` - Source map for debugging

### When to Rebuild

Rebuild the bundle when:
- Installing/updating Tiptap packages
- Adding new Tiptap extensions
- Modifying `src/js/tiptap-bundle.js`

### Source Files

- **Source**: `src/js/tiptap-bundle.js` - Imports and exports Tiptap to global scope
- **Build script**: `scripts/build-tiptap.js` - esbuild configuration
- **Output**: `src/js/tiptap-bundle-built.js` - Browser-ready bundle (gitignored)

## Adding New Extensions

1. Install the extension:
   ```bash
   npm install @tiptap/extension-name
   ```

2. Add to `src/js/tiptap-bundle.js`:
   ```javascript
   import ExtensionName from '@tiptap/extension-name';
   window.TiptapExtensionName = ExtensionName;
   ```

3. Rebuild:
   ```bash
   npm run build:tiptap
   ```

4. Use in `document-generation.html`:
   ```javascript
   tiptapEditor = new window.TiptapEditor({
     extensions: [
       window.TiptapStarterKit,
       window.TiptapExtensionName,
     ],
   });
   ```

## Included Extensions

- **StarterKit**: Basic formatting (bold, italic, headings, lists, etc.)
- **Placeholder**: Shows placeholder text when editor is empty
- **Typography**: Smart quotes, ellipses, em dashes, etc.

## Future Enhancements

Potential additions:
- **Block controls**: Visual "+" button in left margin
- **Drag handles**: Reorder blocks by dragging
- **Task lists**: Checkable todo items
- **Tables**: Rich table editing
- **Collaboration**: Real-time collaborative editing
