# Context Engine for AI Conversations

## Overview
The context engine ensures that Lana AI has full awareness of matter details during project conversations.

## How It Works

### 1. **Frontend Context Creation** (`chat.html`)
When a user creates a project conversation:

```javascript
const aiContext = {
  matter_id: matterId,
  matter_name: matterName,
  client_name: matterDetails.client_name,
  matter_number: matterDetails.matter_number,
  status: matterDetails.status,
  type: matterDetails.type,
  description: matterDetails.description,
  initial_greeting: true  // Triggers special first message
};
```

### 2. **API Request** (`/api/v1/chat`)
Context is sent with the initial message:

```javascript
{
  content: "I want to start a conversation about the matter: 'Update namesss'",
  conversation_id: threadId,
  matter_id: matterId,
  generate_title: true,
  context: aiContext  // ← Matter details included
}
```

### 3. **Backend Processing** (`streaming.routes.js`)
The `buildConversationPrompt()` function now augments the system prompt with context:

```javascript
function buildConversationPrompt(systemPrompt, conversationHistory, newMessage, context = {}) {
  let prompt = `<|system|>\n${systemPrompt}\n`;

  // Add matter/project context if provided
  if (context && Object.keys(context).length > 0) {
    prompt += `
CONTEXT FOR THIS CONVERSATION:
- Matter/Project: ${context.matter_name}
- Client: ${context.client_name}
- Matter Number: ${context.matter_number}
- Status: ${context.status}
- Type: ${context.type}
- Description: ${context.description}

This is the first message about this matter.
Greet warmly and offer help with ${context.matter_name}.

Remember this context throughout the conversation...
`;
  }
  
  // ... rest of prompt building
}
```

### 4. **Result: AI Prompt with Context**
The AI receives a fully contextualized prompt:

```
<|system|>
You are Lana, an intelligent legal AI assistant...

CONTEXT FOR THIS CONVERSATION:
- Matter/Project: Update namesss
- Client: John Doe
- Matter Number: MATT-00123
- Status: active
- Type: Estate Planning
- Description: Estate planning for John Doe

This is the first message in a new conversation about this matter.
Greet the user warmly and offer to help with Update namesss.

Remember this context throughout the conversation...

<|user|>
I want to start a conversation about the matter: "Update namesss"

<|assistant|>
```

## Benefits

✅ **AI has full matter context** - Knows what it's talking about  
✅ **Personalized responses** - Can reference specific matter details  
✅ **Continuity** - Context reminder in every message  
✅ **Professional greetings** - Acknowledges the specific matter  
✅ **Better assistance** - Can provide targeted help  

## Context Persistence

### Initial Message
- Full context injected into system prompt
- `initial_greeting` flag triggers welcoming message
- AI is instructed to remember context

### Follow-up Messages
- Context is stored in conversation metadata
- Each subsequent message includes matter_id
- AI maintains awareness throughout conversation

### Multiple Conversations Per Matter
- Each conversation has its own thread_id
- All conversations for a matter share the same matter_id
- Context is fresh for each conversation
- Deleting a conversation doesn't affect the matter

## Testing Context Engine

### How to Test:
1. Create a new project conversation
2. Select a matter with full details
3. AI should respond with awareness of:
   - Matter name
   - Client name
   - Matter type
   - Status

### Expected AI Response:
```
Hello! I'd be happy to help you with [Matter Name] for [Client Name].
This is an [active/closed] [matter type] matter (Matter #[number]).

What would you like to know or do regarding this matter?
```

## Debugging

### Frontend Logging
```javascript
console.log('Creating project chat with context:', aiContext);
```

### Backend Logging
```javascript
logInfo('Starting Ollama chat stream', {
  hasContext: Object.keys(context).length > 0,
  contextKeys: Object.keys(context)
});
```

### Check Context in Database
```sql
SELECT metadata FROM conversations WHERE thread_id = 'xxx';
```

## Future Enhancements

- [ ] Load related documents for matter
- [ ] Include previous conversation summaries
- [ ] Add matter deadlines/milestones to context
- [ ] Include client preferences
- [ ] Add jurisdiction/court information
- [ ] Load matter-specific templates

## Files Modified

- `public_html/chat.html` - Creates and sends context
- `src/services/processor/routes/streaming.routes.js` - Processes context
- `src/services/processor/routes/chat.routes.js` - Stores context in metadata

---

**Last Updated:** December 4, 2025  
**Version:** 1.0

