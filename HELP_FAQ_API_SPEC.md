# LANA AI Help & FAQ API Specification

**For Web Team Implementation**
**Version:** 1.0.0
**Last Updated:** 2025-12-22

---

## Overview

This document specifies the API endpoints and data structures required for the LANA AI Help & Support system. These endpoints should be hosted at:

- **Production:** `https://redroostertec.com/lana-ai/v1/`
- **Development:** `http://localhost:3001/lana-ai/v1/` (for testing)

The client will fetch help and FAQ content dynamically from these endpoints, allowing for centralized content management without requiring client updates.

---

## Endpoints

### 1. Get Help Content

**Endpoint:** `GET /lana-ai/v1/help`

**Description:** Returns structured help content for the LANA AI help page, including getting started guides, feature documentation, and troubleshooting steps.

**Request:**
```http
GET /lana-ai/v1/help HTTP/1.1
Host: redroostertec.com
Accept: application/json
```

**Response Structure:**

```json
{
  "version": "1.0.0",
  "lastUpdated": "2025-12-22T10:00:00Z",
  "sections": [
    {
      "id": "getting-started",
      "title": "Getting Started",
      "description": "Learn the basics of LANA AI",
      "icon": "rocket",
      "order": 1,
      "articles": [
        {
          "id": "quick-start",
          "title": "Quick Start Guide",
          "summary": "Get up and running with LANA AI in minutes",
          "content": "## Quick Start Guide\n\nWelcome to LANA AI! This guide will help you...",
          "tags": ["beginner", "setup"],
          "readTime": 5,
          "lastUpdated": "2025-12-20T15:30:00Z",
          "relatedArticles": ["first-login", "navigating-dashboard"]
        },
        {
          "id": "first-login",
          "title": "Your First Login",
          "summary": "What to expect when you first log in",
          "content": "## Your First Login\n\nWhen you first access LANA AI...",
          "tags": ["beginner", "authentication"],
          "readTime": 3,
          "lastUpdated": "2025-12-18T09:00:00Z",
          "relatedArticles": ["quick-start", "account-setup"]
        }
      ]
    },
    {
      "id": "features",
      "title": "Features",
      "description": "Explore LANA AI's powerful features",
      "icon": "sparkles",
      "order": 2,
      "articles": [
        {
          "id": "chat-interface",
          "title": "Using the Chat Interface",
          "summary": "Learn how to interact with LANA AI's conversational interface",
          "content": "## Chat Interface\n\nThe LANA AI chat interface allows you to...",
          "tags": ["chat", "ai", "features"],
          "readTime": 7,
          "lastUpdated": "2025-12-15T14:00:00Z",
          "relatedArticles": ["document-analysis", "context-awareness"]
        },
        {
          "id": "matter-management",
          "title": "Managing Matters",
          "summary": "Organize your cases and legal matters efficiently",
          "content": "## Matter Management\n\nLANA AI helps you organize matters...",
          "tags": ["matters", "organization"],
          "readTime": 10,
          "lastUpdated": "2025-12-10T11:00:00Z",
          "relatedArticles": ["document-upload", "matter-insights"]
        },
        {
          "id": "document-upload",
          "title": "Uploading Documents",
          "summary": "Learn how to upload and manage documents",
          "content": "## Document Upload\n\nTo upload documents to LANA AI...",
          "tags": ["documents", "upload"],
          "readTime": 5,
          "lastUpdated": "2025-12-08T16:00:00Z",
          "relatedArticles": ["matter-management", "document-search"]
        },
        {
          "id": "data-connectors",
          "title": "Data Connectors",
          "summary": "Connect LANA AI to your existing systems",
          "content": "## Data Connectors\n\nLANA AI can integrate with...",
          "tags": ["connectors", "integrations"],
          "readTime": 8,
          "lastUpdated": "2025-12-05T13:00:00Z",
          "relatedArticles": ["sharepoint-connector", "google-drive-connector"]
        }
      ]
    },
    {
      "id": "troubleshooting",
      "title": "Troubleshooting",
      "description": "Solutions to common issues",
      "icon": "wrench",
      "order": 3,
      "articles": [
        {
          "id": "login-issues",
          "title": "Can't Log In?",
          "summary": "Troubleshoot login and authentication problems",
          "content": "## Login Issues\n\nIf you're experiencing login problems...",
          "tags": ["troubleshooting", "authentication"],
          "readTime": 4,
          "lastUpdated": "2025-12-01T10:00:00Z",
          "relatedArticles": ["password-reset", "account-locked"]
        },
        {
          "id": "slow-performance",
          "title": "Performance Issues",
          "summary": "Fix slow loading and performance problems",
          "content": "## Performance Troubleshooting\n\nIf LANA AI is running slowly...",
          "tags": ["troubleshooting", "performance"],
          "readTime": 6,
          "lastUpdated": "2025-11-28T14:30:00Z",
          "relatedArticles": ["system-requirements", "browser-compatibility"]
        },
        {
          "id": "connector-sync-errors",
          "title": "Connector Sync Errors",
          "summary": "Resolve data connector synchronization issues",
          "content": "## Connector Sync Troubleshooting\n\nWhen connectors fail to sync...",
          "tags": ["troubleshooting", "connectors"],
          "readTime": 7,
          "lastUpdated": "2025-11-25T09:00:00Z",
          "relatedArticles": ["data-connectors", "oauth-authorization"]
        }
      ]
    },
    {
      "id": "admin",
      "title": "Administration",
      "description": "Admin guides and best practices",
      "icon": "shield",
      "order": 4,
      "articles": [
        {
          "id": "user-management",
          "title": "Managing Users",
          "summary": "Add, remove, and manage user accounts",
          "content": "## User Management\n\nAs an administrator, you can...",
          "tags": ["admin", "users"],
          "readTime": 10,
          "lastUpdated": "2025-11-20T11:00:00Z",
          "relatedArticles": ["roles-permissions", "organization-settings"]
        },
        {
          "id": "roles-permissions",
          "title": "Roles & Permissions",
          "summary": "Configure user roles and access control",
          "content": "## Roles & Permissions\n\nLANA AI uses role-based access control...",
          "tags": ["admin", "security"],
          "readTime": 12,
          "lastUpdated": "2025-11-18T15:00:00Z",
          "relatedArticles": ["user-management", "audit-logs"]
        }
      ]
    }
  ],
  "quickLinks": [
    {
      "title": "Contact Support",
      "description": "Get help from our support team",
      "href": "#contact-support",
      "icon": "mail"
    },
    {
      "title": "Video Tutorials",
      "description": "Watch step-by-step video guides",
      "href": "https://www.youtube.com/@redroostertec",
      "icon": "video",
      "external": true
    },
    {
      "title": "System Status",
      "description": "Check current system status",
      "href": "https://status.redroostertec.com",
      "icon": "activity",
      "external": true
    },
    {
      "title": "API Documentation",
      "description": "Developer API reference",
      "href": "https://docs.redroostertec.com/lana-ai/api",
      "icon": "code",
      "external": true
    }
  ]
}
```

**Response Codes:**
- `200 OK` - Success
- `304 Not Modified` - Content hasn't changed (supports caching with ETag)
- `500 Internal Server Error` - Server error

**Caching:**
- Should support `ETag` and `Last-Modified` headers for efficient caching
- Recommended cache duration: 1 hour

---

### 2. Get FAQ Content

**Endpoint:** `GET /lana-ai/v1/faq`

**Description:** Returns frequently asked questions organized by category, with support for search and filtering.

**Request:**
```http
GET /lana-ai/v1/faq HTTP/1.1
Host: redroostertec.com
Accept: application/json
```

**Optional Query Parameters:**
- `category` (string) - Filter by category ID
- `search` (string) - Search FAQ content (future enhancement)

**Response Structure:**

```json
{
  "version": "1.0.0",
  "lastUpdated": "2025-12-22T10:00:00Z",
  "categories": [
    {
      "id": "general",
      "title": "General Questions",
      "description": "Common questions about LANA AI",
      "icon": "info",
      "order": 1,
      "faqs": [
        {
          "id": "what-is-lana",
          "question": "What is LANA AI?",
          "answer": "LANA AI is an enterprise legal AI platform designed for law firms and legal departments. It combines document intelligence, conversational AI, and workflow automation to streamline legal operations.",
          "tags": ["general", "overview"],
          "helpful": 245,
          "notHelpful": 12,
          "lastUpdated": "2025-12-15T10:00:00Z",
          "relatedFaqs": ["how-does-ai-work", "pricing"]
        },
        {
          "id": "how-does-ai-work",
          "question": "How does the AI work?",
          "answer": "LANA AI uses advanced large language models (LLMs) combined with retrieval-augmented generation (RAG) to analyze your documents and provide intelligent responses. The AI runs entirely on your on-premises server, ensuring your data never leaves your network.",
          "tags": ["general", "ai", "technology"],
          "helpful": 189,
          "notHelpful": 8,
          "lastUpdated": "2025-12-10T14:00:00Z",
          "relatedFaqs": ["what-is-lana", "data-security"]
        },
        {
          "id": "pricing",
          "question": "How much does LANA AI cost?",
          "answer": "LANA AI pricing is based on your organization's size and needs. Contact our sales team at sales@redroostertec.com for a custom quote.",
          "tags": ["general", "pricing"],
          "helpful": 156,
          "notHelpful": 23,
          "lastUpdated": "2025-12-01T09:00:00Z",
          "relatedFaqs": ["what-is-lana", "trial-available"]
        }
      ]
    },
    {
      "id": "getting-started",
      "title": "Getting Started",
      "description": "Questions about setup and initial use",
      "icon": "play",
      "order": 2,
      "faqs": [
        {
          "id": "first-steps",
          "question": "What should I do first after logging in?",
          "answer": "After logging in, we recommend: 1) Complete your profile in Settings, 2) Upload your first documents or connect a data source, 3) Create your first matter to organize your work, 4) Try the chat interface to ask questions about your documents.",
          "tags": ["getting-started", "beginner"],
          "helpful": 201,
          "notHelpful": 15,
          "lastUpdated": "2025-11-28T11:00:00Z",
          "relatedFaqs": ["upload-documents", "create-matter"]
        },
        {
          "id": "upload-documents",
          "question": "How do I upload documents?",
          "answer": "To upload documents: 1) Navigate to a matter, 2) Click the 'Upload' button, 3) Select files from your computer or drag and drop them, 4) Wait for processing to complete. Supported formats include PDF, DOCX, TXT, and more.",
          "tags": ["getting-started", "documents"],
          "helpful": 178,
          "notHelpful": 9,
          "lastUpdated": "2025-11-25T15:00:00Z",
          "relatedFaqs": ["supported-formats", "processing-time"]
        },
        {
          "id": "create-matter",
          "question": "How do I create a new matter?",
          "answer": "To create a matter: 1) Go to the Matters page, 2) Click 'New Matter', 3) Fill in the matter details (name, client, type), 4) Click 'Create'. You can then start uploading documents and organizing your work within the matter.",
          "tags": ["getting-started", "matters"],
          "helpful": 165,
          "notHelpful": 7,
          "lastUpdated": "2025-11-20T10:00:00Z",
          "relatedFaqs": ["upload-documents", "matter-permissions"]
        }
      ]
    },
    {
      "id": "features",
      "title": "Features & Capabilities",
      "description": "Questions about LANA AI features",
      "icon": "zap",
      "order": 3,
      "faqs": [
        {
          "id": "chat-capabilities",
          "question": "What can I ask the AI in chat?",
          "answer": "You can ask LANA AI to: analyze documents, summarize content, extract key information, draft legal documents, compare contracts, find relevant case law, and much more. The AI has access to all documents you've uploaded within your matters.",
          "tags": ["features", "chat", "ai"],
          "helpful": 312,
          "notHelpful": 18,
          "lastUpdated": "2025-12-18T09:00:00Z",
          "relatedFaqs": ["how-does-ai-work", "context-awareness"]
        },
        {
          "id": "context-awareness",
          "question": "How does the AI know which documents to use?",
          "answer": "LANA AI uses the matter context you're working in. When you're in a specific matter and use chat, the AI automatically searches and retrieves relevant information from documents within that matter using vector similarity search.",
          "tags": ["features", "ai", "search"],
          "helpful": 198,
          "notHelpful": 12,
          "lastUpdated": "2025-12-12T14:00:00Z",
          "relatedFaqs": ["chat-capabilities", "search-documents"]
        },
        {
          "id": "data-connectors",
          "question": "What systems can LANA AI connect to?",
          "answer": "LANA AI can connect to: Microsoft SharePoint, Google Drive, OneDrive, Dropbox, Box, and more. Data connectors sync documents automatically so the AI always has access to your latest files.",
          "tags": ["features", "connectors", "integrations"],
          "helpful": 187,
          "notHelpful": 14,
          "lastUpdated": "2025-12-05T11:00:00Z",
          "relatedFaqs": ["connector-setup", "sync-frequency"]
        },
        {
          "id": "workflows",
          "question": "Can I automate tasks with LANA AI?",
          "answer": "Yes! LANA AI includes a workflow automation system that can: automatically categorize documents, send follow-up reminders, generate documents, route matters to team members, and more. You can create custom workflows or use pre-built templates.",
          "tags": ["features", "workflows", "automation"],
          "helpful": 234,
          "notHelpful": 16,
          "lastUpdated": "2025-11-30T10:00:00Z",
          "relatedFaqs": ["workflow-builder", "document-generation"]
        }
      ]
    },
    {
      "id": "security",
      "title": "Security & Privacy",
      "description": "Questions about data security and privacy",
      "icon": "lock",
      "order": 4,
      "faqs": [
        {
          "id": "data-security",
          "question": "Is my data secure?",
          "answer": "Yes. LANA AI is deployed entirely on-premises at your office. All data, documents, and AI models run on your local server. Nothing is sent to external cloud services. We use AES-256 encryption for data at rest and TLS 1.3 for data in transit.",
          "tags": ["security", "privacy"],
          "helpful": 289,
          "notHelpful": 5,
          "lastUpdated": "2025-12-20T13:00:00Z",
          "relatedFaqs": ["on-premises", "cloud-backup"]
        },
        {
          "id": "on-premises",
          "question": "What does 'on-premises' mean?",
          "answer": "On-premises means LANA AI runs on a server physically located at your office. The server (typically a Mac Studio) contains the database, AI models, and all your data. This ensures complete data sovereignty and compliance with regulations like GDPR and HIPAA.",
          "tags": ["security", "deployment"],
          "helpful": 176,
          "notHelpful": 8,
          "lastUpdated": "2025-12-15T09:00:00Z",
          "relatedFaqs": ["data-security", "system-requirements"]
        },
        {
          "id": "user-permissions",
          "question": "Can I control who sees what?",
          "answer": "Yes. LANA AI has role-based access control (RBAC) and matter-level permissions. You can control which users can access specific matters, documents, and features. Admins can configure roles with granular permissions.",
          "tags": ["security", "permissions"],
          "helpful": 203,
          "notHelpful": 11,
          "lastUpdated": "2025-12-10T15:00:00Z",
          "relatedFaqs": ["roles-permissions", "matter-sharing"]
        }
      ]
    },
    {
      "id": "troubleshooting",
      "title": "Troubleshooting",
      "description": "Solutions to common problems",
      "icon": "tool",
      "order": 5,
      "faqs": [
        {
          "id": "forgot-password",
          "question": "I forgot my password. What do I do?",
          "answer": "Click 'Forgot Password' on the login page. If your organization has email configured, you'll receive a password reset link. Otherwise, contact your system administrator to reset your password.",
          "tags": ["troubleshooting", "authentication"],
          "helpful": 145,
          "notHelpful": 6,
          "lastUpdated": "2025-12-01T10:00:00Z",
          "relatedFaqs": ["login-issues", "account-locked"]
        },
        {
          "id": "slow-upload",
          "question": "Why are my uploads slow?",
          "answer": "Upload speed depends on: your network connection to the server, file size, and current server load. Large PDFs can take time to process. Ensure you're on the same local network as the server for best performance.",
          "tags": ["troubleshooting", "performance"],
          "helpful": 132,
          "notHelpful": 18,
          "lastUpdated": "2025-11-28T14:00:00Z",
          "relatedFaqs": ["processing-time", "network-issues"]
        },
        {
          "id": "connector-not-syncing",
          "question": "My data connector isn't syncing. Help!",
          "answer": "Check: 1) OAuth token hasn't expired (go to Connectors → Re-authorize if needed), 2) You have permissions to the source folder/library, 3) Network connectivity to the external service. View sync logs in the Sync Status page for detailed error messages.",
          "tags": ["troubleshooting", "connectors"],
          "helpful": 167,
          "notHelpful": 14,
          "lastUpdated": "2025-11-25T11:00:00Z",
          "relatedFaqs": ["data-connectors", "sync-frequency"]
        }
      ]
    },
    {
      "id": "billing",
      "title": "Billing & Account",
      "description": "Questions about billing and account management",
      "icon": "credit-card",
      "order": 6,
      "faqs": [
        {
          "id": "trial-available",
          "question": "Is there a free trial?",
          "answer": "Yes, we offer a 30-day free trial for qualifying organizations. Contact sales@redroostertec.com to request a trial.",
          "tags": ["billing", "trial"],
          "helpful": 98,
          "notHelpful": 7,
          "lastUpdated": "2025-11-20T09:00:00Z",
          "relatedFaqs": ["pricing", "demo-request"]
        },
        {
          "id": "add-users",
          "question": "How do I add more users?",
          "answer": "System administrators and org admins can add users from the Admin → Users page. If you need to exceed your current user limit, contact your account manager or support@redroostertec.com.",
          "tags": ["billing", "users"],
          "helpful": 114,
          "notHelpful": 5,
          "lastUpdated": "2025-11-18T13:00:00Z",
          "relatedFaqs": ["user-management", "upgrade-plan"]
        }
      ]
    }
  ],
  "popularFaqs": [
    "what-is-lana",
    "data-security",
    "chat-capabilities",
    "upload-documents",
    "connector-not-syncing"
  ]
}
```

**Response Codes:**
- `200 OK` - Success
- `304 Not Modified` - Content hasn't changed
- `400 Bad Request` - Invalid query parameters
- `500 Internal Server Error` - Server error

**Caching:**
- Should support `ETag` and `Last-Modified` headers
- Recommended cache duration: 1 hour

---

### 3. Submit Support Request

**Endpoint:** `POST /lana-ai/v1/support/contact`

**Description:** Allows users to submit support inquiries directly from the help page.

**Request:**
```http
POST /lana-ai/v1/support/contact HTTP/1.1
Host: redroostertec.com
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john.doe@lawfirm.com",
  "organization": "ABC Law Firm",
  "subject": "Question about data connectors",
  "category": "technical",
  "priority": "normal",
  "message": "I'm having trouble setting up the SharePoint connector...",
  "userAgent": "Mozilla/5.0...",
  "appVersion": "2.0.0",
  "deploymentId": "customer-abc-123",
  "attachments": []
}
```

**Request Fields:**
- `name` (string, required) - User's full name
- `email` (string, required) - User's email address
- `organization` (string, optional) - Organization name
- `subject` (string, required) - Support request subject
- `category` (string, required) - Category: "technical", "billing", "feature-request", "bug-report", "general"
- `priority` (string, required) - Priority: "low", "normal", "high", "urgent"
- `message` (string, required) - Detailed message (min 20 chars)
- `userAgent` (string, optional) - Browser user agent
- `appVersion` (string, optional) - LANA AI client version
- `deploymentId` (string, optional) - Customer deployment ID
- `attachments` (array, optional) - File attachments (future enhancement)

**Response:**
```json
{
  "success": true,
  "ticketId": "LANA-2025-001234",
  "message": "Support request submitted successfully. We'll respond within 24 hours.",
  "estimatedResponseTime": "24 hours"
}
```

**Response Codes:**
- `201 Created` - Request submitted successfully
- `400 Bad Request` - Invalid request data
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error

**Rate Limiting:**
- 5 requests per hour per IP address
- 20 requests per day per email address

---

## Data Structure Details

### Article Content Format

Articles use **Markdown format** for content. Supported features:
- Headers (H2, H3)
- Bold, italic text
- Bullet and numbered lists
- Code blocks
- Links
- Images (hosted on CDN)
- Tables

Example:
```markdown
## Getting Started with Chat

The LANA AI chat interface provides:

1. **Context-aware responses** - AI automatically uses relevant documents
2. **Streaming output** - See responses as they're generated
3. **Follow-up questions** - Continue the conversation naturally

### Using File Drawer

Click the file drawer icon to select specific documents for the AI to reference.
```

### Icons

Icon values reference Heroicons (same as used in the UI):
- `rocket` - Getting started
- `sparkles` - Features
- `wrench` - Troubleshooting
- `shield` - Admin
- `info` - General info
- `play` - Getting started
- `zap` - Features
- `lock` - Security
- `tool` - Troubleshooting
- `credit-card` - Billing
- `mail` - Contact
- `video` - Video
- `activity` - Status
- `code` - Code/API

### Tags

Tags help with search and filtering. Use lowercase, hyphenated format:
- `beginner`, `advanced`
- `chat`, `documents`, `matters`, `connectors`, `workflows`
- `troubleshooting`, `security`, `admin`
- `setup`, `configuration`

---

## Implementation Notes

### For Web Team

1. **Static Hosting:** These endpoints can be static JSON files hosted on S3/CloudFront or served by a simple Express server.

2. **Versioning:** Include a `version` field in all responses. Increment when content structure changes.

3. **Caching:**
   - Set appropriate `Cache-Control` headers (e.g., `max-age=3600`)
   - Support `ETag` for conditional requests
   - Include `Last-Modified` header

4. **CORS:** Enable CORS for `https://redroostertec.com` and development origins.

5. **Future Enhancements:**
   - Search endpoint: `GET /lana-ai/v1/help/search?q=...`
   - FAQ voting: `POST /lana-ai/v1/faq/{id}/vote` (helpful/not helpful)
   - Analytics: Track which articles are most viewed

6. **Content Management:**
   - Consider using a headless CMS (Contentful, Strapi) for easy content updates
   - Or maintain JSON files in a Git repository with CI/CD deployment

### Testing

Test files will be provided in `src/mock-data/` for frontend development:
- `help-data.json` - Mock help content
- `faq-data.json` - Mock FAQ content

---

## Example Client Usage

```javascript
// Fetch help content
const helpResponse = await fetch('https://redroostertec.com/lana-ai/v1/help');
const helpData = await helpResponse.json();

// Fetch FAQ content
const faqResponse = await fetch('https://redroostertec.com/lana-ai/v1/faq');
const faqData = await faqResponse.json();

// Submit support request
const contactResponse = await fetch('https://redroostertec.com/lana-ai/v1/support/contact', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'John Doe',
    email: 'john@example.com',
    subject: 'Help needed',
    category: 'technical',
    priority: 'normal',
    message: 'I need help with...'
  })
});
const result = await contactResponse.json();
```

---

## Questions?

Contact the LANA AI development team for clarification on this specification.
