// Bundle Tiptap and extensions for browser use
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';

// Export to global scope for use in HTML
window.TiptapEditor = Editor;
window.TiptapStarterKit = StarterKit;
window.TiptapPlaceholder = Placeholder;
window.TiptapTypography = Typography;
window.TiptapLink = Link;
window.TiptapUnderline = Underline;
window.TiptapTextAlign = TextAlign;
window.TiptapTable = Table;
window.TiptapTableRow = TableRow;
window.TiptapTableHeader = TableHeader;
window.TiptapTableCell = TableCell;
