# LANA AI Help & Support API - Implementation Guide

**Version:** 1.0.0
**Last Updated:** 2025-12-22
**For:** Web Team / Backend Developers

---

## Table of Contents

1. [Overview](#overview)
2. [API Specification](#api-specification)
3. [Implementation Options](#implementation-options)
4. [Data Validation Rules](#data-validation-rules)
5. [Caching Strategy](#caching-strategy)
6. [Rate Limiting](#rate-limiting)
7. [Error Handling](#error-handling)
8. [Testing](#testing)
9. [Deployment](#deployment)
10. [Content Management](#content-management)

---

## Overview

The LANA AI Help & Support system requires three API endpoints to provide dynamic help content, FAQs, and support contact functionality to the desktop client.

### Endpoints

| Endpoint | Method | Purpose | Caching |
|----------|--------|---------|---------|
| `/lana-ai/v1/help` | GET | Retrieve help articles | 1 hour |
| `/lana-ai/v1/faq` | GET | Retrieve FAQs | 1 hour |
| `/lana-ai/v1/support/contact` | POST | Submit support request | N/A |

### Base URLs

- **Production:** `https://redroostertec.com/lana-ai/v1/`
- **Development:** `http://localhost:3001/lana-ai/v1/`

---

## API Specification

The complete API specification is provided in OpenAPI 3.0 format:

📄 **[HELP_SUPPORT_API_CONTRACT.yaml](./HELP_SUPPORT_API_CONTRACT.yaml)**

You can:
- Import this file into Swagger Editor: https://editor.swagger.io/
- Generate server stubs using OpenAPI Generator
- Generate API documentation automatically
- Validate requests/responses against the schema

---

## Implementation Options

### Option 1: Static JSON Files (Recommended for MVP)

**Pros:**
- Simplest to implement
- No server logic needed
- Fast performance
- Easy to deploy (S3 + CloudFront)
- Low maintenance

**Cons:**
- No dynamic content
- Manual updates required
- No support request handling (needs separate service)

**Implementation:**

```bash
# Directory structure
s3://lana-help-content/
├── help.json           # GET /lana-ai/v1/help
├── faq.json            # GET /lana-ai/v1/faq
└── index.html          # Optional: API documentation
```

**CloudFront Configuration:**
```json
{
  "origins": [
    {
      "domainName": "lana-help-content.s3.amazonaws.com",
      "customHeaders": [
        {
          "headerName": "Cache-Control",
          "headerValue": "public, max-age=3600"
        }
      ]
    }
  ],
  "behaviors": [
    {
      "pathPattern": "/lana-ai/v1/*",
      "viewerProtocolPolicy": "redirect-to-https",
      "allowedMethods": ["GET", "HEAD", "OPTIONS"],
      "compress": true
    }
  ]
}
```

**Support Endpoint:**
For POST `/support/contact`, you'll need a separate Lambda function or API Gateway endpoint.

---

### Option 2: Express/Node.js Server

**Pros:**
- Full control over logic
- Can add authentication
- Support request handling built-in
- Can integrate with ticketing system

**Cons:**
- Requires server hosting
- More complex deployment
- Maintenance overhead

**Implementation:**

```javascript
// server.js
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const app = express();

// Middleware
app.use(cors({
  origin: ['https://redroostertec.com', 'http://localhost:*'],
  methods: ['GET', 'POST', 'OPTIONS']
}));
app.use(express.json());

// Rate limiter for support endpoint
const supportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Rate Limit Exceeded',
    message: 'You\'ve exceeded the maximum number of support requests. Please try again in 1 hour.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

// Load content (could be from files, DB, or CMS)
const helpData = require('./data/help.json');
const faqData = require('./data/faq.json');

// GET /lana-ai/v1/help
app.get('/lana-ai/v1/help', (req, res) => {
  res.set({
    'Cache-Control': 'public, max-age=3600',
    'ETag': generateETag(helpData),
    'Last-Modified': helpData.lastUpdated
  });

  // Handle conditional requests
  if (req.get('If-None-Match') === generateETag(helpData)) {
    return res.status(304).send();
  }

  res.json(helpData);
});

// GET /lana-ai/v1/faq
app.get('/lana-ai/v1/faq', (req, res) => {
  const { category } = req.query;

  let responseData = faqData;

  // Filter by category if provided
  if (category) {
    const validCategories = ['general', 'getting-started', 'features', 'security', 'troubleshooting', 'billing'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: `Invalid category. Must be one of: ${validCategories.join(', ')}`,
        code: 'INVALID_CATEGORY'
      });
    }

    responseData = {
      ...faqData,
      categories: faqData.categories.filter(cat => cat.id === category)
    };
  }

  res.set({
    'Cache-Control': 'public, max-age=3600',
    'ETag': generateETag(responseData),
    'Last-Modified': faqData.lastUpdated
  });

  if (req.get('If-None-Match') === generateETag(responseData)) {
    return res.status(304).send();
  }

  res.json(responseData);
});

// POST /lana-ai/v1/support/contact
app.post('/lana-ai/v1/support/contact',
  supportLimiter,
  [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Invalid email address'),
    body('subject').trim().isLength({ min: 5, max: 200 }).withMessage('Subject must be 5-200 characters'),
    body('category').isIn(['technical', 'billing', 'feature-request', 'bug-report', 'general']).withMessage('Invalid category'),
    body('priority').isIn(['low', 'normal', 'high', 'urgent']).withMessage('Invalid priority'),
    body('message').trim().isLength({ min: 20, max: 5000 }).withMessage('Message must be 20-5000 characters')
  ],
  async (req, res) => {
    // Validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: errors.array()[0].msg,
        code: 'VALIDATION_ERROR',
        details: errors.array()
      });
    }

    const { name, email, organization, subject, category, priority, message, userAgent, appVersion, deploymentId } = req.body;

    try {
      // Generate ticket ID
      const ticketId = generateTicketId();

      // TODO: Send to ticketing system (Zendesk, Freshdesk, email, etc.)
      await sendToTicketingSystem({
        ticketId,
        name,
        email,
        organization,
        subject,
        category,
        priority,
        message,
        metadata: {
          userAgent,
          appVersion,
          deploymentId,
          submittedAt: new Date().toISOString()
        }
      });

      res.status(201).json({
        success: true,
        ticketId,
        message: 'Support request submitted successfully. We\'ll respond within 24 hours.',
        estimatedResponseTime: '24 hours'
      });
    } catch (error) {
      console.error('Support request error:', error);
      res.status(500).json({
        error: 'Internal Error',
        message: 'Failed to submit support request. Please try again or email support@redroostertec.com.',
        code: 'INTERNAL_ERROR'
      });
    }
  }
);

// Helper functions
function generateETag(data) {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
}

function generateTicketId() {
  const year = new Date().getFullYear();
  const number = Math.floor(Math.random() * 900000) + 100000;
  return `LANA-${year}-${number}`;
}

async function sendToTicketingSystem(ticket) {
  // Option 1: Email via SendGrid/AWS SES
  // await sendEmail({
  //   to: 'support@redroostertec.com',
  //   subject: `[${ticket.ticketId}] ${ticket.subject}`,
  //   body: formatTicketEmail(ticket)
  // });

  // Option 2: Zendesk API
  // await zendesk.tickets.create({ ... });

  // Option 3: Slack webhook
  // await axios.post(process.env.SLACK_WEBHOOK_URL, { ... });

  // For now, just log
  console.log('Support ticket created:', ticket);
}

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Help & Support API running on port ${PORT}`);
});
```

**Deploy with PM2:**
```bash
pm2 start server.js --name lana-help-api
pm2 save
pm2 startup
```

---

### Option 3: Headless CMS

**Recommended CMS Options:**
- **Contentful** - User-friendly, good API
- **Strapi** - Open-source, self-hosted
- **Sanity** - Developer-friendly, real-time

**Pros:**
- Non-technical users can update content
- Version control built-in
- Preview mode
- Webhooks for cache invalidation

**Cons:**
- Additional service dependency
- Learning curve
- Monthly cost (for hosted options)

**Example with Contentful:**

```javascript
const contentful = require('contentful');

const client = contentful.createClient({
  space: process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN
});

app.get('/lana-ai/v1/help', async (req, res) => {
  const entries = await client.getEntries({
    content_type: 'helpArticle',
    order: 'fields.order'
  });

  const helpData = transformContentfulToHelpData(entries);

  res.json(helpData);
});
```

---

## Data Validation Rules

### Help Content

```javascript
const helpContentSchema = {
  version: {
    type: 'string',
    required: true,
    pattern: /^\d+\.\d+\.\d+$/
  },
  sections: {
    type: 'array',
    required: true,
    minItems: 1,
    items: {
      id: { type: 'string', required: true, pattern: /^[a-z0-9-]+$/ },
      title: { type: 'string', required: true, minLength: 1, maxLength: 100 },
      articles: { type: 'array', required: true, minItems: 1 }
    }
  }
};
```

### Support Request

```javascript
const supportRequestValidation = {
  name: {
    required: true,
    minLength: 2,
    maxLength: 100,
    sanitize: (value) => value.trim()
  },
  email: {
    required: true,
    format: 'email',
    normalize: true
  },
  message: {
    required: true,
    minLength: 20,
    maxLength: 5000,
    sanitize: (value) => value.trim()
  },
  category: {
    required: true,
    enum: ['technical', 'billing', 'feature-request', 'bug-report', 'general']
  },
  priority: {
    required: true,
    enum: ['low', 'normal', 'high', 'urgent']
  }
};
```

---

## Caching Strategy

### Client-Side Caching

Desktop client implements:
- 1-hour cache for help/FAQ content
- ETag-based conditional requests
- Local storage fallback for offline access

### Server-Side Caching

Recommended headers:

```http
Cache-Control: public, max-age=3600, must-revalidate
ETag: "33a64df551425fcc55e4d42a148795d9f25f89d4"
Last-Modified: Sat, 22 Dec 2025 10:00:00 GMT
Vary: Accept-Encoding
```

### Cache Invalidation

When content is updated:

**Option 1: CloudFront Invalidation**
```bash
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/lana-ai/v1/*"
```

**Option 2: Version Bump**
```json
{
  "version": "1.0.1",  // Increment version
  "lastUpdated": "2025-12-22T15:30:00Z"
}
```

**Option 3: ETag Update**
```javascript
// Automatically updates when content changes
const etag = crypto.createHash('md5')
  .update(JSON.stringify(content))
  .digest('hex');
```

---

## Rate Limiting

### Support Endpoint

Implement rate limiting to prevent abuse:

**Per IP Address:**
- 5 requests per hour
- 20 requests per day

**Per Email Address:**
- 20 requests per day (tracked via email hash)

**Headers:**
```http
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 3
X-RateLimit-Reset: 1703174400
```

**Implementation:**
```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Rate Limit Exceeded',
      message: 'Too many support requests. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED'
    });
  }
});
```

---

## Error Handling

### Standard Error Response

```json
{
  "error": "Error Type",
  "message": "Human-readable description",
  "code": "MACHINE_READABLE_CODE",
  "details": {}
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `INVALID_EMAIL` | 400 | Email format invalid |
| `MESSAGE_TOO_SHORT` | 400 | Message < 20 characters |
| `INVALID_CATEGORY` | 400 | Category not in enum |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |
| `NOT_FOUND` | 404 | Resource not found |

### Error Handling Example

```javascript
app.use((err, req, res, next) => {
  console.error('API Error:', err);

  // Log to monitoring service (Sentry, Datadog, etc.)
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }

  res.status(err.status || 500).json({
    error: err.name || 'Internal Error',
    message: err.message || 'An unexpected error occurred',
    code: err.code || 'INTERNAL_ERROR'
  });
});
```

---

## Testing

### Manual Testing

```bash
# Test help endpoint
curl https://redroostertec.com/lana-ai/v1/help

# Test FAQ endpoint
curl https://redroostertec.com/lana-ai/v1/faq

# Test FAQ with category filter
curl https://redroostertec.com/lana-ai/v1/faq?category=getting-started

# Test support request
curl -X POST https://redroostertec.com/lana-ai/v1/support/contact \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "subject": "Test request",
    "category": "technical",
    "priority": "normal",
    "message": "This is a test support request with enough characters."
  }'

# Test conditional request
curl -H "If-None-Match: \"abc123\"" https://redroostertec.com/lana-ai/v1/help
```

### Automated Tests

```javascript
// test/api.test.js
const request = require('supertest');
const app = require('../server');

describe('Help & Support API', () => {
  describe('GET /lana-ai/v1/help', () => {
    it('should return help content', async () => {
      const res = await request(app).get('/lana-ai/v1/help');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('version');
      expect(res.body).toHaveProperty('sections');
      expect(res.body.sections).toBeInstanceOf(Array);
      expect(res.headers['cache-control']).toContain('max-age=3600');
    });

    it('should return 304 for matching ETag', async () => {
      const firstRes = await request(app).get('/lana-ai/v1/help');
      const etag = firstRes.headers['etag'];

      const secondRes = await request(app)
        .get('/lana-ai/v1/help')
        .set('If-None-Match', etag);

      expect(secondRes.status).toBe(304);
    });
  });

  describe('GET /lana-ai/v1/faq', () => {
    it('should return FAQ content', async () => {
      const res = await request(app).get('/lana-ai/v1/faq');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('categories');
      expect(res.body.categories).toBeInstanceOf(Array);
    });

    it('should filter by category', async () => {
      const res = await request(app).get('/lana-ai/v1/faq?category=general');

      expect(res.status).toBe(200);
      expect(res.body.categories).toHaveLength(1);
      expect(res.body.categories[0].id).toBe('general');
    });

    it('should reject invalid category', async () => {
      const res = await request(app).get('/lana-ai/v1/faq?category=invalid');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_CATEGORY');
    });
  });

  describe('POST /lana-ai/v1/support/contact', () => {
    const validRequest = {
      name: 'Test User',
      email: 'test@example.com',
      subject: 'Test Subject',
      category: 'technical',
      priority: 'normal',
      message: 'This is a test message with enough characters to pass validation.'
    };

    it('should create support ticket', async () => {
      const res = await request(app)
        .post('/lana-ai/v1/support/contact')
        .send(validRequest);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.ticketId).toMatch(/^LANA-\d{4}-\d{6}$/);
    });

    it('should reject invalid email', async () => {
      const res = await request(app)
        .post('/lana-ai/v1/support/contact')
        .send({ ...validRequest, email: 'invalid-email' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject message too short', async () => {
      const res = await request(app)
        .post('/lana-ai/v1/support/contact')
        .send({ ...validRequest, message: 'Too short' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should enforce rate limiting', async () => {
      // Send 6 requests (limit is 5)
      for (let i = 0; i < 6; i++) {
        const res = await request(app)
          .post('/lana-ai/v1/support/contact')
          .send(validRequest);

        if (i < 5) {
          expect(res.status).toBe(201);
        } else {
          expect(res.status).toBe(429);
          expect(res.body.code).toBe('RATE_LIMIT_EXCEEDED');
        }
      }
    });
  });
});
```

Run tests:
```bash
npm test
```

---

## Deployment

### AWS Deployment (Recommended)

**Architecture:**
```
CloudFront → S3 (help.json, faq.json)
           → API Gateway → Lambda (support/contact)
```

**Setup:**

1. **Create S3 Bucket:**
```bash
aws s3 mb s3://lana-help-content
aws s3 cp help.json s3://lana-help-content/lana-ai/v1/help.json
aws s3 cp faq.json s3://lana-help-content/lana-ai/v1/faq.json
```

2. **Create Lambda for Support Endpoint:**
```javascript
// lambda/support-handler.js
exports.handler = async (event) => {
  const body = JSON.parse(event.body);

  // Validate
  // Send to ticketing system

  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      ticketId: generateTicketId(),
      message: 'Support request submitted successfully.'
    })
  };
};
```

3. **Configure CloudFront:**
- Origin 1: S3 bucket for static content
- Origin 2: API Gateway for support endpoint
- Custom domain: redroostertec.com
- SSL certificate

**Cost Estimate:**
- CloudFront: ~$1-5/month
- S3: <$1/month
- Lambda: Free tier covers most usage
- API Gateway: ~$3.50 per million requests

---

### Vercel/Netlify Deployment (Alternative)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy serverless functions
vercel --prod
```

**Serverless Functions:**
```javascript
// api/help.js
export default async (req, res) => {
  const helpData = await fetchHelpData();
  res.json(helpData);
};

// api/faq.js
export default async (req, res) => {
  const faqData = await fetchFAQData();
  res.json(faqData);
};

// api/support/contact.js
export default async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Handle support request
};
```

---

## Content Management

### Content Update Workflow

**Option 1: Git-based (Developer workflow)**
```bash
# 1. Update content
vim data/help.json

# 2. Validate
npm run validate

# 3. Commit
git add data/help.json
git commit -m "Update help article: Quick Start Guide"

# 4. Deploy
git push origin main
# CI/CD automatically deploys to S3
```

**Option 2: CMS-based (Non-technical workflow)**
1. Log into Contentful/Strapi
2. Edit article content
3. Click "Publish"
4. Webhook triggers cache invalidation
5. Content live within 1 minute

### Content Versioning

Track content changes:

```json
{
  "version": "1.2.3",
  "changelog": [
    {
      "version": "1.2.3",
      "date": "2025-12-22",
      "changes": [
        "Added new troubleshooting article",
        "Updated FAQ about data connectors"
      ]
    }
  ]
}
```

---

## Monitoring & Analytics

### Metrics to Track

1. **Performance:**
   - Average response time
   - P95 response time
   - Cache hit rate

2. **Usage:**
   - API requests per day
   - Most accessed articles
   - Popular FAQs
   - Support request volume

3. **Errors:**
   - 4xx/5xx error rates
   - Failed support submissions
   - Validation errors

### Implementation

**CloudWatch (AWS):**
```javascript
const CloudWatch = require('aws-sdk/clients/cloudwatch');
const cloudwatch = new CloudWatch();

// Log metric
await cloudwatch.putMetricData({
  Namespace: 'LANA/HelpAPI',
  MetricData: [{
    MetricName: 'SupportRequestSubmitted',
    Value: 1,
    Unit: 'Count',
    Timestamp: new Date()
  }]
}).promise();
```

**Google Analytics:**
```javascript
// Track article views
app.get('/lana-ai/v1/help', (req, res) => {
  // Send event to GA
  ga.event({
    category: 'Help',
    action: 'View',
    label: 'Help Content Fetched'
  });

  res.json(helpData);
});
```

---

## Security Considerations

1. **CORS:** Only allow requests from known origins
2. **Rate Limiting:** Prevent abuse of support endpoint
3. **Input Sanitization:** Validate and sanitize all user input
4. **SQL Injection:** Use parameterized queries (if using DB)
5. **XSS Prevention:** Sanitize markdown content
6. **DDoS Protection:** Use CloudFlare or AWS Shield

---

## Questions or Issues?

Contact: support@redroostertec.com

**Related Documentation:**
- [OpenAPI Specification](./HELP_SUPPORT_API_CONTRACT.yaml)
- [Original Spec](./HELP_FAQ_API_SPEC.md)
- [Mock Data Files](./src/mock-data/)
