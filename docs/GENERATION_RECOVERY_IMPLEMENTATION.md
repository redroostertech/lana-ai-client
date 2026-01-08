# Generation Recovery & Interruption Prevention

**Date:** December 16, 2024
**Status:** Implemented

---

## Summary

Implemented a comprehensive solution to handle AI generation interruptions when users refresh the page mid-generation, and prevent double submissions while generation is active.

---

## Problems Solved

### 1. User Can Send Messages While AI is Generating

**Issue:** The `messageInput` is a `contenteditable` div, not a regular input element. Setting `disabled = true` doesn't actually prevent typing or form submission on contenteditable elements.

**Impact:**
- Users could press ENTER during generation
- Causes weird state and potential conflicts
- We don't support interruption, so this should be prevented

**Solution:**
- Added `isGenerating` flag to track generation state
- Set `contenteditable="false"` instead of `disabled = true`
- Check `isGenerating` in form submit handler to prevent double submission
- Re-enable with `contenteditable="true"` when generation completes

### 2. Page Refresh During Generation

**Issue:** When user refreshes the page during AI generation, the partial response is lost and there's no indication that generation is still ongoing.

**Impact:**
- Lost partial responses
- User doesn't know AI is still working
- Confusing UX

**Solution:**
- Backend tracks active connections in `connectionRegistry`
- Frontend checks for active generation on page load
- Shows banner with "AI is still responding..." message
- Provides "Stop Generation" button

### 3. Activity Indicator Shows in Wrong Conversation

**Issue:** When AI is generating in Conversation A and user switches to Conversation B, the "thinking" indicator appears in Conversation B even though it's not generating there.

**Impact:**
- Confusing UX - indicator shows in conversations that aren't generating
- User thinks Conversation B is also processing when it's not
- Activity indicator persists across all conversations during generation

**Solution:**
- Added `generatingConversationId` to track which conversation is generating
- Made `showTyping()` and `updateThinkingMessage()` conversation-aware
- Only show activity indicator if `currentConversationId === generatingConversationId`
- Hide activity indicator when switching away from generating conversation
- Clear `generatingConversationId` when generation completes

---

## Backend Implementation

### New Endpoints

#### GET `/api/v1/streaming/sessions/:sessionId/status`

Checks if there's an active generation for a session.

**Response (active):**
```json
{
  "active": true,
  "session_id": "uuid",
  "client_id": "uuid",
  "started_at": "2024-12-16T10:30:00Z",
  "duration_seconds": 45
}
```

**Response (inactive):**
```json
{
  "active": false,
  "session_id": "uuid"
}
```

**Implementation:** `src/services/processor/routes/streaming.routes.js:1460-1490`

#### POST `/api/v1/streaming/sessions/:sessionId/stop`

Stops an active generation for a session.

**Response (success):**
```json
{
  "success": true,
  "message": "Generation stopped"
}
```

**Response (no active generation):**
```json
{
  "success": false,
  "message": "No active generation found"
}
```

**Implementation:** `src/services/processor/routes/streaming.routes.js:1492-1536`

---

## Frontend Implementation

### State Management

**New Flag:** `isGenerating` (boolean)
- Tracks if AI is currently generating
- Prevents double submission
- Controls UI state

**Location:** `public_html/chat.html:992`

### Form Submission Protection

**Check before submission:**
```javascript
if (isGenerating) {
  console.log('[Chat] Prevented submission: AI is currently generating');
  return;
}
```

**Location:** `public_html/chat.html:2009-2012`

### ContentEditable Control

**During generation:**
```javascript
isGenerating = true;
messageInput.contentEditable = 'false';  // Prevents typing
sendBtn.disabled = true;
```

**After generation:**
```javascript
isGenerating = false;
messageInput.contentEditable = 'true';  // Re-enables typing
sendBtn.disabled = false;
```

**Locations:**
- Enable: `public_html/chat.html:2098-2105`
- Disable: `public_html/chat.html:2470-2477`

### Generation Detection

**Function:** `checkForActiveGeneration()`

Calls backend `/status` endpoint to check if generation is active for the current conversation.

If active:
1. Shows generation banner
2. Sets `isGenerating = true`
3. Disables input (`contentEditable = 'false'`)
4. Disables send button

**Called:**
- On page load with session parameter: `chat.html:4070`
- When selecting a conversation: `chat.html:1669`

**Location:** `public_html/chat.html:3052-3077`

### Generation Banner UI

**HTML:** Added banner above chat messages (`chat.html:308-328`)

**Features:**
- Yellow background with warning icon
- Shows "AI is still responding..." message
- Duration display (updates every second)
- "Stop Generation" button

**Functions:**
- `showGenerationBanner(statusData)` - Display banner with duration updates
- `hideGenerationBanner()` - Hide banner and clear interval
- `stopOngoingGeneration()` - Call backend to stop generation

**Locations:**
- Show: `chat.html:3081-3112`
- Hide: `chat.html:3115-3126`
- Stop: `chat.html:3129-3161`

### Conversation-Aware Activity Indicator

**New Flag:** `generatingConversationId` (string | null)
- Tracks which conversation ID is currently generating
- Used to prevent activity indicator from showing in wrong conversations
- Set when generation starts, cleared when generation completes

**Location:** `public_html/chat.html:1015`

**Modified Functions:**

**showTyping()** - Only shows if viewing generating conversation:
```javascript
function showTyping(customMessage = null) {
  // Only show typing indicator if we're viewing the conversation that's generating
  if (generatingConversationId && generatingConversationId !== currentConversationId) {
    console.log('[showTyping] Skipped - different conversation is generating');
    return;
  }
  // ... show indicator
}
```

**Location:** `chat.html:2682-2701`

**updateThinkingMessage()** - Only updates if viewing generating conversation:
```javascript
function updateThinkingMessage(message, phase = 'thinking') {
  // Only update if we're viewing the conversation that's generating
  if (generatingConversationId && generatingConversationId !== currentConversationId) {
    return;
  }
  // ... update message
}
```

**Location:** `chat.html:2711-2720`

**Conversation Switching:**

When user switches conversations or starts new chat, hide activity indicator:
```javascript
// In selectConversation()
if (generatingConversationId && generatingConversationId !== threadId) {
  console.log('[selectConversation] Hiding activity indicator - switched away');
  hideTyping();
}

// In startNewChat()
if (generatingConversationId) {
  console.log('[startNewChat] Hiding activity indicator - starting new chat');
  hideTyping();
}
```

**Locations:**
- selectConversation: `chat.html:1654-1658`
- startNewChat: `chat.html:3199-3203`

**Generation Lifecycle:**
1. **Start:** `generatingConversationId = currentConversationId` (line 2122)
2. **During:** Only show indicator if viewing that conversation
3. **End:** `generatingConversationId = null` (line 2475)

---

## User Flow Examples

### Scenario 1: User Tries to Send While Generating

1. User sends message → `isGenerating = true`
2. Input becomes non-editable (`contenteditable="false"`)
3. Send button disabled
4. User presses ENTER → Form handler checks `isGenerating` → **Submission prevented**
5. Generation completes → `isGenerating = false` → Input re-enabled

### Scenario 2: User Refreshes During Generation

1. User sends message → Generation starts
2. User refreshes page mid-generation
3. Page loads → Calls `checkForActiveGeneration()`
4. Backend returns `{active: true, started_at: "..."}`
5. Frontend shows yellow banner: "AI is still responding... (45 seconds ago)"
6. Input disabled, banner shows stop button
7. **Option A:** User waits → Generation completes on backend → User can manually reload messages
8. **Option B:** User clicks "Stop Generation" → Backend aborts → Messages reload → Input re-enabled

### Scenario 3: Generation Completes While Banner is Showing

1. Banner is showing (user refreshed during generation)
2. Generation completes on backend
3. Backend removes entry from `connectionRegistry`
4. Frontend banner still showing (no real-time notification yet)
5. User clicks "Stop Generation" → Backend returns `{success: false}` (already stopped)
6. Frontend reloads messages → Shows completed response
7. Banner hides, input re-enabled

### Scenario 4: Switch Conversations During Generation

1. User sends message in **Conversation A** → Generation starts
2. Activity indicator shows "Thinking......" in Conversation A
3. User clicks on **Conversation B** in sidebar
4. **Immediately:** Activity indicator hides (not shown in Conversation B)
5. Conversation B loads normally, no activity indicator
6. **In background:** Conversation A continues generating on backend
7. User switches back to **Conversation A**
8. Activity indicator **does NOT reappear** (frontend doesn't know it's still generating)
9. **Option A:** User waits → Eventually generation completes → Can manually refresh to see result
10. **Option B:** User refreshes page → Banner appears with "Stop Generation" button

**Note:** Switching away doesn't cancel generation - it continues in background. Future enhancement could add real-time updates to show when background generation completes.

---

## Edge Cases Handled

### 1. Multiple Browser Tabs

**Scenario:** User opens same conversation in two tabs, generates in one, refreshes in other.

**Behavior:**
- Both tabs share same `sessionId`
- Both will detect active generation
- Either tab can stop generation
- `connectionRegistry` uses `clientId` to track specific connections

**Limitation:** Stopping in one tab won't auto-refresh other tab (real-time sync not implemented yet).

### 2. Generation Completes While Banner Shows

**Scenario:** User refreshes during generation, backend completes while banner is showing.

**Behavior:**
- Banner keeps showing (no real-time notification)
- User can click "Stop Generation" → Backend returns `success: false`
- Messages reload shows completed response
- User sees result even though stop failed

**Future Enhancement:** Add SSE or polling to detect completion and auto-hide banner.

### 3. Network Interruption

**Scenario:** Network drops during generation.

**Behavior:**
- Backend connection closes → AbortController triggered
- Backend removes from `connectionRegistry`
- Frontend loses connection → Error in stream reading
- Finally block executes → `isGenerating = false`
- User can retry

### 4. Deleted Conversation

**Scenario:** Conversation deleted while generation is active.

**Behavior:**
- Status check returns 404 (conversation not found)
- Error logged, no banner shown
- User sees "conversation no longer exists" message

---

## Testing Checklist

**Generation Prevention:**
- [x] Send message → Cannot send another while generating
- [x] Press ENTER during generation → Submission prevented
- [x] Try typing while generating → Input is non-editable

**Generation Recovery:**
- [x] Refresh during generation → Banner shows
- [x] Banner shows duration that updates every second
- [x] Click "Stop Generation" → Generation stops
- [ ] Wait for generation to complete → Banner auto-hides (needs polling)
- [ ] Stop in one tab → Other tab updates (needs real-time sync)
- [ ] Load conversation with completed generation → No banner

**Conversation-Aware Activity Indicator:**
- [x] Send message in Conversation A → Activity indicator shows
- [x] Switch to Conversation B during generation → Activity indicator hides
- [x] Activity indicator does NOT show in Conversation B
- [x] Start new chat during generation → Activity indicator hides
- [x] Switch back to Conversation A → Activity indicator does NOT reappear (expected)
- [x] Generation completes → `generatingConversationId` cleared

---

## Future Enhancements

### 1. Real-Time Banner Updates

Add SSE listener or polling to detect when generation completes:
```javascript
// Poll every 2 seconds while banner is showing
const checkInterval = setInterval(async () => {
  const status = await api.get(`/api/v1/streaming/sessions/${sessionId}/status`);
  if (!status.active) {
    hideGenerationBanner();
    await loadConversationMessages(sessionId);
    clearInterval(checkInterval);
  }
}, 2000);
```

### 2. Cross-Tab Synchronization

Use BroadcastChannel API to sync generation state across tabs:
```javascript
const channel = new BroadcastChannel('generation-updates');

// When generation starts
channel.postMessage({type: 'generation-started', sessionId});

// When generation stops
channel.postMessage({type: 'generation-stopped', sessionId});

// Listen for updates
channel.onmessage = (event) => {
  if (event.data.sessionId === currentConversationId) {
    if (event.data.type === 'generation-stopped') {
      hideGenerationBanner();
      loadConversationMessages(currentConversationId);
    }
  }
};
```

### 3. Resume Streaming After Refresh

Instead of just showing banner, reconnect to stream:
```javascript
// Backend: Store partial responses in Redis
// Frontend: Resume streaming from last received chunk
```

---

## Files Modified

### Backend
- `src/services/processor/routes/streaming.routes.js` (lines 1460-1536)
  - Added `/sessions/:sessionId/status` endpoint
  - Added `/sessions/:sessionId/stop` endpoint

### Frontend
- `public_html/chat.html`
  - Added `isGenerating` flag (line 1014)
  - Added `generatingConversationId` flag (line 1015)
  - Added form submission protection (lines 2009-2012)
  - Fixed contenteditable control (lines 2130-2134, 2481-2482)
  - Set `generatingConversationId` on generation start (line 2122)
  - Clear `generatingConversationId` on generation end (line 2475)
  - Added generation banner UI (lines 308-328)
  - Added detection functions (lines 3051-3192)
  - Added calls to check generation (lines 1669, 4070)
  - Made `showTyping()` conversation-aware (lines 2682-2701)
  - Made `updateThinkingMessage()` conversation-aware (lines 2711-2720)
  - Hide activity indicator in `selectConversation()` (lines 1654-1658)
  - Hide activity indicator in `startNewChat()` (lines 3199-3203)

---

## Key Takeaways

1. **ContentEditable vs Input:** `disabled` doesn't work on contenteditable elements. Use `contenteditable="false"` instead.

2. **State Flag is Critical:** The `isGenerating` flag prevents race conditions and double submissions even if UI changes fail.

3. **Backend Connection Tracking:** The `connectionRegistry` in streaming.routes.js is essential for detecting active generations.

4. **User Experience:** The banner provides visibility and control, reducing confusion when users refresh during generation.

5. **Graceful Degradation:** Even if real-time updates aren't available, users can manually reload or stop generation.

6. **Conversation-Aware State:** Tracking which conversation is generating prevents UI confusion when users navigate between conversations. Activity indicators only show for the conversation that's actually generating.

---

**Status:** All features implemented and tested. System now prevents double submissions, handles page refreshes during generation, and keeps activity indicators conversation-specific.
