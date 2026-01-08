# Document Mention Feature - Design Specification

**Date:** December 15, 2025
**Feature:** # Document Mentions in Message Input
**Status:** Design Phase

---

## User Experience

### Trigger Behavior
```
User types: "What does it say in #"
                              ↑
                         Triggers picker
```

### Document Picker Dropdown
```
┌─────────────────────────────────────────────────────┐
│ # Search documents...                         [×]   │
├─────────────────────────────────────────────────────┤
│ 📄 Document1.pdf                           Ready    │
│    2.5 MB • 10 chunks • Page 1-15                   │
├─────────────────────────────────────────────────────┤
│ 📄 Document2.pdf                           Ready    │
│    1.2 MB • 6 chunks • Page 1-8                     │
├─────────────────────────────────────────────────────┤
│ 📄 Contract.docx                      Processing    │
│    800 KB • Processing... 45%                       │
└─────────────────────────────────────────────────────┘
```

### Tag Display in Input
```
┌─────────────────────────────────────────────────────┐
│ What does it say in [📄 Document1.pdf ×] about... │
│                      └──────────────┘               │
│                      Document tag (removable)       │
└─────────────────────────────────────────────────────┘
```

### Message Metadata
```json
{
  "message": "What does it say in  about payment terms?",
  "attachments": {
    "files": [
      {
        "file_id": "uuid-123",
        "type": "document",
        "name": "Document1.pdf",
        "mention_position": 19  // Character position in message
      }
    ]
  }
}
```

---

## Implementation Plan

### Phase 1: UI Components

#### 1. Document Tag Component
```html
<div class="document-tag" data-doc-id="uuid-123">
  <span class="document-icon">📄</span>
  <span class="document-name">Document1.pdf</span>
  <button class="remove-tag">×</button>
</div>
```

**Styling:**
```css
.document-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: #EEF2FF; /* Indigo-50 */
  border: 1px solid #C7D2FE; /* Indigo-200 */
  border-radius: 6px;
  font-size: 14px;
  color: #4F46E5; /* Indigo-600 */
  margin: 0 4px;
}
```

#### 2. Document Picker Dropdown
```html
<div id="documentPickerDropdown" class="absolute hidden z-50">
  <div class="bg-white rounded-lg shadow-xl border border-gray-200 w-96 max-h-80 overflow-hidden">
    <!-- Search input -->
    <div class="p-3 border-b border-gray-200">
      <input
        type="text"
        id="docPickerSearch"
        placeholder="# Search documents..."
        class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
      />
    </div>

    <!-- Document list -->
    <div id="docPickerList" class="overflow-y-auto max-h-64">
      <!-- Items populated by JS -->
    </div>

    <!-- Empty state -->
    <div id="docPickerEmpty" class="hidden p-6 text-center text-sm text-gray-500">
      No documents found
    </div>
  </div>
</div>
```

#### 3. Document Picker Item
```html
<div class="doc-picker-item hover:bg-gray-50 cursor-pointer p-3 border-b border-gray-100">
  <div class="flex items-start gap-3">
    <div class="text-2xl">📄</div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center justify-between">
        <p class="text-sm font-medium text-gray-900 truncate">Document1.pdf</p>
        <span class="text-xs px-2 py-0.5 bg-green-100 text-green-800 rounded-full">Ready</span>
      </div>
      <p class="text-xs text-gray-500 mt-1">2.5 MB • 10 chunks • Page 1-15</p>
    </div>
  </div>
</div>
```

---

### Phase 2: JavaScript Logic

#### State Management
```javascript
const documentMentions = {
  // Array of mentioned documents in current message
  attachedDocs: [],

  // Picker state
  pickerOpen: false,
  pickerQuery: '',
  pickerPosition: { top: 0, left: 0 },

  // Available documents (cached from session)
  availableDocs: []
};
```

#### Core Functions

**1. Detect # Trigger**
```javascript
function onMessageInputKeydown(event) {
  const input = event.target;
  const cursorPos = input.selectionStart;
  const textBefore = input.value.substring(0, cursorPos);

  // Check if user just typed #
  if (event.key === '#') {
    // Show picker at cursor position
    showDocumentPicker(input, cursorPos);
  }

  // Check if # exists and user is typing after it
  const hashIndex = textBefore.lastIndexOf('#');
  if (hashIndex !== -1 && documentMentions.pickerOpen) {
    const searchQuery = textBefore.substring(hashIndex + 1);
    filterDocumentPicker(searchQuery);
  }

  // Close picker on Escape
  if (event.key === 'Escape' && documentMentions.pickerOpen) {
    closeDocumentPicker();
  }
}
```

**2. Show Document Picker**
```javascript
function showDocumentPicker(inputElement, cursorPosition) {
  // Load available documents from session
  loadAvailableDocuments();

  // Position dropdown below cursor
  const coords = getCaretCoordinates(inputElement, cursorPosition);
  const dropdown = document.getElementById('documentPickerDropdown');
  dropdown.style.top = `${coords.top + 20}px`;
  dropdown.style.left = `${coords.left}px`;
  dropdown.classList.remove('hidden');

  documentMentions.pickerOpen = true;
  documentMentions.pickerPosition = cursorPosition;

  // Focus search input
  document.getElementById('docPickerSearch').focus();
}
```

**3. Select Document**
```javascript
function selectDocument(doc) {
  const input = document.getElementById('messageInput');
  const cursorPos = documentMentions.pickerPosition;
  const textBefore = input.value.substring(0, cursorPos);
  const textAfter = input.value.substring(cursorPos);

  // Find the # that triggered the picker
  const hashIndex = textBefore.lastIndexOf('#');

  // Replace # and query with document tag
  const beforeHash = input.value.substring(0, hashIndex);
  const newText = beforeHash + `{doc:${doc.id}}` + textAfter;

  input.value = newText;

  // Add to attached documents
  documentMentions.attachedDocs.push({
    file_id: doc.id,
    type: 'document',
    name: doc.filename,
    mention_position: hashIndex
  });

  // Render tags
  renderDocumentTags();

  // Close picker
  closeDocumentPicker();

  // Focus back to input
  input.focus();
}
```

**4. Render Document Tags**
```javascript
function renderDocumentTags() {
  const container = document.getElementById('documentTagsContainer');
  container.innerHTML = '';

  documentMentions.attachedDocs.forEach((doc, index) => {
    const tag = document.createElement('div');
    tag.className = 'document-tag';
    tag.innerHTML = `
      <span class="document-icon">📄</span>
      <span class="document-name">${doc.name}</span>
      <button class="remove-tag" data-index="${index}">×</button>
    `;

    // Remove handler
    tag.querySelector('.remove-tag').addEventListener('click', () => {
      removeDocumentTag(index);
    });

    container.appendChild(tag);
  });
}
```

**5. Send Message with Attachments**
```javascript
async function sendMessageWithAttachments() {
  const messageText = document.getElementById('messageInput').value;

  // Clean message text (remove {doc:uuid} markers)
  const cleanText = messageText.replace(/\{doc:[^\}]+\}/g, '').trim();

  const payload = {
    message: cleanText,
    conversation_id: currentConversationId,
    session_id: currentConversationId,
    matter_id: currentMatterId,
    attachments: {
      files: documentMentions.attachedDocs
    }
  };

  console.log('Sending message with attachments:', payload);

  // Send to /chat/stream endpoint
  const response = await fetch(`${baseUrl}/api/v1/streaming/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  // Clear attached docs after sending
  documentMentions.attachedDocs = [];
  renderDocumentTags();
}
```

---

### Phase 3: Backend Enhancement

#### Current Behavior
```javascript
// Backend already accepts attachments
const { attachments = {} } = req.body;
```

#### Enhanced RAG Logic
```javascript
// In Phase 3.5 RAG retrieval
const attachedFileIds = attachments?.files?.map(f => f.file_id) || [];

if (attachedFileIds.length > 0) {
  // Force RAG retrieval for explicitly attached files
  shouldRetrieve = true;

  // Add attached files to context even if not in session
  logInfo('User explicitly attached documents', {
    attachedCount: attachedFileIds.length,
    fileIds: attachedFileIds
  });
}

// Modify retrieval to prioritize attached docs
retrievalResult = await retrievalService.retrieve({
  orgId: req.user.organizationId,
  sessionId: effectiveSessionId,
  userId: req.user.id,
  messageId: messageId,
  queryText: message,
  activeMatterId: effectiveMatterId,
  prioritizeDocIds: attachedFileIds  // NEW - prioritize these docs
});
```

---

## UI/UX Details

### Keyboard Navigation
- **#** - Open document picker
- **Type** - Filter documents
- **↑/↓** - Navigate picker items
- **Enter** - Select highlighted document
- **Escape** - Close picker
- **Backspace on {doc:...}** - Remove tag

### Visual Feedback
```
Typing:  "What is in #con"
         Shows: Contract.pdf (filtered)

Select:  "What is in [📄 Contract.pdf ×]"
         Tag appears inline

Remove:  Click ×
         Tag removed, cursor returns to position
```

### Mobile Considerations
- Picker appears as bottom sheet on mobile
- Touch-friendly item height (48px minimum)
- Larger tap targets for × buttons

---

## Data Flow

### 1. User Types #
```
User Input → Detect # → Show Picker → Load Available Docs
```

### 2. Search & Select
```
User Types Query → Filter Docs → User Clicks → Insert Tag → Update State
```

### 3. Send Message
```
User Clicks Send → Extract Attachments → Clean Message Text → POST to /chat/stream
```

### 4. Backend Processing
```
Receive Message → Parse Attachments → Prioritize in RAG → Retrieve Chunks → Generate Response
```

---

## Implementation Checklist

### HTML Changes
- [ ] Add document picker dropdown container
- [ ] Add document tags container above input
- [ ] Add picker search input
- [ ] Add picker item template

### CSS Changes
- [ ] Style document tags (inline badges)
- [ ] Style picker dropdown (shadow, positioning)
- [ ] Style picker items (hover states)
- [ ] Mobile responsive styles

### JavaScript Changes
- [ ] Add # detection in input keydown
- [ ] Implement showDocumentPicker()
- [ ] Implement filterDocumentPicker()
- [ ] Implement selectDocument()
- [ ] Implement removeDocumentTag()
- [ ] Update sendMessage() to include attachments
- [ ] Add keyboard navigation (↑/↓/Enter/Escape)

### Backend Changes
- [ ] Enhance RAG to prioritize attached docs
- [ ] Add prioritizeDocIds to retrieval service
- [ ] Log attached document usage

---

## Example Usage

### Scenario 1: Reference Specific Document
```
User types: "What are the payment terms in #"
           [Picker opens, shows 5 documents]
User selects: "Contract.pdf"
Message becomes: "What are the payment terms in [📄 Contract.pdf ×]"
User sends message
Backend: Prioritizes Contract.pdf in retrieval
AI responds: "According to Contract.pdf (Page 5), the payment terms are..."
```

### Scenario 2: Multiple Documents
```
User types: "Compare # and #"
Selects: "Doc1.pdf" and "Doc2.pdf"
Message becomes: "Compare [📄 Doc1.pdf ×] and [📄 Doc2.pdf ×]"
Backend: Retrieves from both documents
AI responds: "Comparing Doc1.pdf and Doc2.pdf..."
```

### Scenario 3: Remove Tag
```
User has: "What is in [📄 Doc1.pdf ×] about pricing"
User clicks ×
Message becomes: "What is in about pricing"
Attachment removed from metadata
```

---

## Future Enhancements

### Phase 2
- @ mentions for people/users
- @@ mentions for matters/clients
- ! mentions for tasks/deadlines
- Multiple mention types in one message

### Phase 3
- Smart suggestions (ML-based)
- Recent documents shortcut
- Drag & drop to attach
- Paste document links

---

## Technical Notes

### Caret Position Detection
```javascript
function getCaretCoordinates(element, position) {
  const div = document.createElement('div');
  const span = document.createElement('span');
  const computed = window.getComputedStyle(element);

  // Copy styles
  div.style.cssText = computed.cssText;
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';

  // Insert text before caret
  div.textContent = element.value.substring(0, position);
  span.textContent = element.value.substring(position) || '.';
  div.appendChild(span);

  document.body.appendChild(div);
  const coordinates = {
    top: span.offsetTop + element.offsetTop,
    left: span.offsetLeft + element.offsetLeft
  };
  document.body.removeChild(div);

  return coordinates;
}
```

### Tag Storage Format
```javascript
// Internal representation
{doc:uuid-123}

// Display representation
[📄 Document.pdf ×]

// Sent to backend
{
  attachments: {
    files: [{
      file_id: "uuid-123",
      type: "document",
      name: "Document.pdf"
    }]
  }
}
```

---

**Status:** Ready for implementation
**Estimated Time:** 3-4 hours
**Priority:** High - Improves UX significantly
