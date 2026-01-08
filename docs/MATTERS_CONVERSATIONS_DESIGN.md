# Matter Conversations Design

## Overview
This document describes the data model and UI design for linking conversations to matters, inspired by ChatGPT's "Projects" feature.

## Data Model

### Database Schema

**`conversations` table:**
```sql
CREATE TABLE conversations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,           -- Who sent the message
  matter_id varchar(255),           -- Links to client_matters.matter_id (e.g., "MATT-00001")
  thread_id uuid NOT NULL,          -- Groups messages into a conversation/session
  content text NOT NULL,            -- The message content
  role varchar(50) NOT NULL,        -- 'user', 'assistant', 'system'
  metadata jsonb DEFAULT '{}',      -- Can include title, messageCount, etc.
  created_at timestamp NOT NULL
);
```

**Key Concepts:**
- Each **message** is a row in `conversations`
- Messages are grouped by `thread_id` into **sessions/conversations**
- A session can be linked to a matter via `matter_id` (nullable)
- Multiple messages in the same `thread_id` = one conversation

### Relationships

```
client_matters (1) ───── (many) conversations
     ↓                             ↓
  matter_id  ←────────────────  matter_id (FK)
```

## User Experience

### Conversation Organization

#### Regular Chats (No Matter)
```
💬 RECENT CHATS
├── General legal question
├── Research request
└── Quick lookup
```
- Standalone conversations not linked to any matter
- Default behavior when starting a new chat
- Flexible for ad-hoc queries

#### Project-Based Chats (Linked to Matter)
```
📁 PROJECTS (Matters)
├── 📂 John Doe Estate (MATT-00001)
│   ├── 💬 Will review questions
│   ├── 💬 Asset research
│   └── 💬 Tax implications
└── 📂 Smith Trust (MATT-00002)
    └── 💬 Beneficiary questions
```
- Conversations organized by matter/project
- All conversations for a matter appear together
- Provides context and organization

### User Flow

#### 1. Starting a New Chat
**Option A: Regular Chat (No Matter)**
- Click "New Chat" in sidebar
- Start conversation immediately
- Not linked to any matter

**Option B: Chat in a Matter/Project**
- Navigate to matter in sidebar or matters page
- Click "Start Chat" or "New Conversation"
- Automatically linked to that matter
- `matter_id` set on first message

#### 2. Organizing Existing Chats
- View any existing chat
- Click "Add to Project" or "Link to Matter"
- Select matter from dropdown
- Updates `matter_id` for all messages in that `thread_id`

#### 3. Viewing Matter Conversations
- Open matter details page
- Switch to "Conversations" tab
- See all chats linked to this matter
- Click to open any conversation

## UI Implementation

### Matter Details Drawer Tabs

The matter details drawer has three tabs:

#### 1. Details Tab
- Matter information (ID, client, status, visibility)
- Description
- Shared users/permissions

#### 2. Conversations Tab
```
┌─────────────────────────────────────────┐
│ Conversations                           │
├─────────────────────────────────────────┤
│ 5 conversations        [+ New Chat]     │
│                                         │
│ ┌─────────────────────────────────┐   │
│ │ 💬 Will review questions        │ → │
│ │ Started 2 hours ago • 8 messages│   │
│ └─────────────────────────────────┘   │
│                                         │
│ ┌─────────────────────────────────┐   │
│ │ 💬 Asset research               │ → │
│ │ Started 1 day ago • 12 messages │   │
│ └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```
- Lists all conversations for this matter
- Shows title, timestamp, message count
- Click to open conversation in chat interface
- Button to start new conversation in this matter
- Empty state when no conversations exist

#### 3. Activity Tab
- All activity related to the matter
- Grouped by date
- Includes documents, updates, shares, chats

## API Endpoints

### Get Conversations for a Matter
```http
GET /api/v1/chat/sessions?matter_id=MATT-00001&limit=100
```

**Response:**
```json
{
  "sessions": [
    {
      "id": "uuid",
      "thread_id": "uuid",
      "matter_id": "MATT-00001",
      "metadata": {
        "title": "Will review questions",
        "messageCount": 8
      },
      "created_at": "2024-12-04T10:00:00Z"
    }
  ],
  "pagination": {
    "limit": 100,
    "offset": 0,
    "total": 5
  }
}
```

### Get Activity for a Matter
```http
GET /api/v1/activity/matter/MATT-00001?limit=100
```

**Response:**
```json
{
  "activities": [
    {
      "id": "uuid",
      "event_type": "matter_updated",
      "resource_type": "matter",
      "resource_id": "MATT-00001",
      "resource_name": "John Doe Estate",
      "details": {...},
      "created_at": "2024-12-04T10:00:00Z",
      "user": {
        "id": "uuid",
        "email": "user@example.com",
        "first_name": "John",
        "last_name": "Doe"
      }
    }
  ]
}
```

### Create New Chat Session
```http
POST /api/v1/chat/sessions
Content-Type: application/json

{
  "title": "Will review questions",
  "matter_id": "MATT-00001",  // Optional - omit for regular chat
  "context": {}
}
```

## Frontend Components

### JavaScript Functions

**`viewMatter(matterId)`**
- Fetches matter, permissions, conversations, activity
- Stores data in `currentMatterData`
- Renders matter drawer with tabs

**`switchMatterTab(tabName)`**
- Switches between 'details', 'conversations', 'activity'
- Updates tab button styles
- Calls appropriate render function

**`renderDetailsTab(matter, permissions)`**
- Displays matter information and shared users

**`renderConversationsTab(matter, chats)`**
- Lists all conversations for the matter
- Empty state with "Start First Conversation" button
- Links to open each conversation
- Shows message counts and timestamps

**`renderActivityTab(matter, activities)`**
- Groups activities by date
- Displays with color-coded icons
- Shows user and timestamp

## Benefits of This Approach

1. **Organization**: Conversations are organized by matter/project
2. **Context**: AI understands the matter context when chatting
3. **Flexibility**: Users can have both project-based and standalone chats
4. **Discovery**: Easy to find all conversations related to a matter
5. **Collaboration**: Multiple team members can have matter-specific chats
6. **History**: Complete conversation history per matter

## Future Enhancements

1. **Chat Sidebar**: Add matter/project navigation to chat interface
2. **Move Conversations**: Allow moving chats between matters
3. **Bulk Actions**: Archive/delete multiple conversations
4. **Search**: Search within matter conversations
5. **Templates**: Pre-defined conversation starters per matter type
6. **Notifications**: Alert users to new messages in shared matters
7. **AI Context**: Automatically inject matter details into AI prompts
8. **Document Links**: Link documents to specific conversations

