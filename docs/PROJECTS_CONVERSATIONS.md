# Projects & Conversations Architecture

## Overview
The chat system supports two types of conversations:
1. **Regular Chats** - Standalone conversations not linked to any matter
2. **Project Conversations** - Conversations associated with a specific matter/case

## Key Features

### Multiple Conversations Per Matter
- **Each matter can have multiple independent conversations** (projects)
- Each conversation has a unique `thread_id` but shares the same `matter_id`
- This allows users to:
  - Have different discussion topics for the same matter
  - Keep conversations organized and isolated
  - Archive or delete old conversations without affecting the matter

### Architecture

#### Database Schema
```sql
CREATE TABLE conversations (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    matter_id varchar(255),        -- NULL for regular chats, UUID for projects
    thread_id uuid NOT NULL,       -- Unique per conversation
    content text NOT NULL,
    role varchar(50) NOT NULL,
    metadata jsonb DEFAULT '{}',   -- Stores title, context, etc.
    created_at timestamp
);
```

#### Key Relationships
- **One Matter → Many Conversations**: A matter can have unlimited conversations
- **One Conversation → One Thread ID**: Each conversation is uniquely identified by `thread_id`
- **One Conversation → Zero or One Matter**: Conversations can be standalone or linked to a matter

### Deleting Conversations vs Matters

#### When Deleting a Conversation/Project:
✅ **ONLY** the conversation messages are deleted (all records with that `thread_id`)
✅ The matter remains intact and accessible
✅ Other conversations for the same matter are unaffected
✅ You can create new conversations for the same matter later

#### Backend Implementation
```javascript
// DELETE /api/v1/chat/sessions/:sessionId
// Only deletes conversation messages, NOT the matter
DELETE FROM conversations 
WHERE thread_id = $1 AND user_id = $2
```

#### Frontend Confirmation
- **For Projects**: Warns user that only the conversation will be deleted, not the matter
- **For Regular Chats**: Standard deletion warning

### UI Organization

#### Sidebar Structure
```
└── Projects (Expandable)
    ├── [New Project] Button
    ├── Matter A - Conversation 1
    ├── Matter A - Conversation 2
    ├── Matter B - Conversation 1
    └── [Show More] (if > 6 projects)

└── Your Chats (Expandable, Infinite Scroll)
    ├── Standalone Chat 1
    ├── Standalone Chat 2
    └── ... (paginated)
```

#### Context Menu (Three Dots)
- **Rename**: Update conversation title (doesn't affect matter)
- **Delete**: Remove conversation messages only (preserves matter)

### Creating New Project Conversations

#### Steps:
1. User clicks "New Project" button
2. Modal shows list of available matters (searchable)
3. User selects a matter
4. System creates new conversation with:
   - Unique `thread_id`
   - Associated `matter_id`
   - AI-generated title based on first message
   - Initial context about the matter

#### Backend:
```javascript
POST /api/v1/chat/sessions
{
  "matter_id": "uuid",
  "title": "Matter Name",
  "context": {
    "matter_name": "Case ABC",
    "matter_id": "uuid"
  }
}
```

### AI Title Generation

- **Automatically generated** after the first message in a conversation
- Uses the user's initial message and matter context
- Stored in `metadata.title`
- Can be manually overridden via "Rename"

### API Endpoints

#### Create Conversation
```
POST /api/v1/chat/sessions
Body: { matter_id?, title?, context? }
```

#### List Conversations
```
GET /api/v1/chat/sessions
Query: { page, limit, matter_id?, sort }
Returns: Both project and regular conversations with matter_name
```

#### Update Conversation (Rename)
```
PUT /api/v1/chat/sessions/:sessionId
Body: { title }
```

#### Delete Conversation
```
DELETE /api/v1/chat/sessions/:sessionId
⚠️ Only deletes conversation messages, NOT the matter
```

## Use Cases

### Scenario 1: Multiple Topics for Same Matter
```
Matter: "Smith Estate Planning"
├── Conversation 1: "Initial Estate Analysis" (archived)
├── Conversation 2: "Trust Document Review"
└── Conversation 3: "Tax Planning Discussion"
```

### Scenario 2: Deleting Old Conversations
```
User deletes "Initial Estate Analysis" conversation
✅ Conversation messages are deleted
✅ Matter "Smith Estate Planning" remains
✅ Other conversations for Smith matter are unaffected
✅ User can create new conversations for Smith matter anytime
```

### Scenario 3: Organizing Work
```
Projects Section:
- Client A - Discovery Phase
- Client A - Contract Negotiations
- Client B - Initial Consultation
- Client C - Follow-up Discussion

Your Chats Section:
- General legal research
- Quick questions
- Template drafting
```

## Benefits

1. **Organization**: Group related conversations by matter
2. **Isolation**: Keep different topics separate even within same matter
3. **Flexibility**: Create multiple conversations as needed
4. **Data Integrity**: Deleting conversations doesn't affect matter data
5. **Context**: AI has matter context for better responses
6. **Scalability**: Support unlimited conversations per matter

## Technical Notes

- `thread_id` is the primary identifier for conversations
- `matter_id` is just a foreign key reference (not a hard constraint)
- Matters are managed separately in the `matters` table
- Conversation deletion is soft-delete friendly (can add `deleted_at` column)
- Title generation uses Ollama AI service
- Frontend maintains separate state for projects vs regular chats
