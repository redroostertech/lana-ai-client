# formatCustomSection() - Dynamic Section Formatting

The `formatCustomSection()` utility allows you to format custom sections dynamically without creating specific formatters for each type.

## Usage

```javascript
const formatUtils = require('./src/shared/services/prompt-builder.utils');

const section = formatUtils.formatCustomSection(sectionName, details, options);
```

## Parameters

- **`sectionName`** (string) - Name of the section (used as header)
- **`details`** (string | Object | Array) - Content to format
- **`options`** (Object, optional) - Formatting options:
  - `headerLevel` ('h1' | 'h2' | 'h3') - Header level (default: 'h2')
  - `includeEmpty` (boolean) - Include header even if details are empty (default: false)

## Examples

### 1. Simple String Content

```javascript
const section = formatUtils.formatCustomSection(
  'Important Notice', 
  'This is a simple string message.'
);
```

**Output:**
```
## Important Notice

This is a simple string message.
```

### 2. Object with Key-Value Pairs

```javascript
const section = formatUtils.formatCustomSection('User Preferences', {
  theme: 'dark',
  language: 'en-US',
  notifications_enabled: true,
  auto_save_interval: '5 minutes'
});
```

**Output:**
```
## User Preferences

**Theme:** dark
**Language:** en-US
**Notifications Enabled:** true
**Auto Save Interval:** 5 minutes
```

Note: Keys are automatically converted from `snake_case` to `Title Case`.

### 3. Array of Strings (List)

```javascript
const section = formatUtils.formatCustomSection('Key Features', [
  'Document analysis',
  'AI-powered search',
  'Real-time collaboration',
  'Automated workflows'
]);
```

**Output:**
```
## Key Features

- Document analysis
- AI-powered search
- Real-time collaboration
- Automated workflows
```

### 4. Array of Objects

```javascript
const section = formatUtils.formatCustomSection('Active Tasks', [
  { task: 'Review contract', due_date: '2025-12-20', priority: 'high' },
  { task: 'Send email', due_date: '2025-12-18', priority: 'medium' }
]);
```

**Output:**
```
## Active Tasks

- **Task:** Review contract
- **Due Date:** 2025-12-20
- **Priority:** high
- **Task:** Send email
- **Due Date:** 2025-12-18
- **Priority:** medium
```

### 5. Nested Object

```javascript
const section = formatUtils.formatCustomSection('Integration Status', {
  email: { status: 'connected', last_sync: '2025-12-17' },
  calendar: { status: 'disconnected', last_sync: 'never' },
  supported_features: ['sync', 'webhooks', 'oauth']
});
```

**Output:**
```
## Integration Status

**Email:**
  - Status: connected
  - Last Sync: 2025-12-17
**Calendar:**
  - Status: disconnected
  - Last Sync: never
**Supported Features:**
  - sync
  - webhooks
  - oauth
```

### 6. Different Header Levels

```javascript
const h1 = formatUtils.formatCustomSection('Level 1', 'Content', { headerLevel: 'h1' });
const h2 = formatUtils.formatCustomSection('Level 2', 'Content', { headerLevel: 'h2' });
const h3 = formatUtils.formatCustomSection('Level 3', 'Content', { headerLevel: 'h3' });
```

**Output:**
```
# Level 1

Content

## Level 2

Content

### Level 3

Content
```

### 7. Empty Content Handling

```javascript
// Returns empty string by default
const empty = formatUtils.formatCustomSection('Empty Section', null);
// Result: ""

// Include header even if content is empty
const withHeader = formatUtils.formatCustomSection('Empty Section', null, { 
  includeEmpty: true 
});
// Result: "## Empty Section"
```

## Use Cases

### Dynamic Context Injection

```javascript
// Add custom sections to system context based on runtime conditions
const contextParts = [
  formatUtils.formatSystemContextHeader(),
  formatUtils.formatUserContext(userProfile, userId)
];

// Add custom sections dynamically
if (userSettings.customFields) {
  contextParts.push(
    formatUtils.formatCustomSection('Custom Fields', userSettings.customFields)
  );
}

if (integrationStatus) {
  contextParts.push(
    formatUtils.formatCustomSection('Integration Status', integrationStatus)
  );
}

const fullContext = contextParts.join('\n\n');
```

### API Response Formatting

```javascript
// Format API response data for AI context
const apiData = await fetchExternalData();

const section = formatUtils.formatCustomSection(
  'External Data',
  {
    source: apiData.source,
    last_updated: apiData.timestamp,
    records: apiData.items.map(item => item.summary)
  }
);
```

### Configuration Display

```javascript
// Format configuration settings
const config = {
  ai_model: 'llama3.2',
  temperature: 0.7,
  max_tokens: 2000,
  streaming: true
};

const configSection = formatUtils.formatCustomSection(
  'AI Configuration',
  config,
  { headerLevel: 'h3' }
);
```

### Error Context

```javascript
// Add error details to context
const errorDetails = {
  error_code: 'AUTH_001',
  message: 'Authentication failed',
  attempted_at: new Date().toISOString(),
  suggestions: [
    'Check API key',
    'Verify user permissions',
    'Review access logs'
  ]
};

const errorSection = formatUtils.formatCustomSection('Error Details', errorDetails);
```

## Integration with System Context

You can use `formatCustomSection` in `system-context.service.js`:

```javascript
// In system-context.service.js
static async _buildContextInternal({ user, matterId, threadId }) {
  // ... fetch data ...
  
  // Build components object
  const components = {
    userProfile,
    userId: user.id,
    orgContext,
    matterContext,
    matterDocuments,
    matterMemories,
    conversationMemories
  };
  
  // Add custom sections if needed
  if (user.customSettings) {
    components.customSettings = formatUtils.formatCustomSection(
      'User Settings',
      user.customSettings
    );
  }
  
  return formatUtils.assembleSystemContext(components);
}
```

## Advanced: Custom Assembly

For more control, combine `formatCustomSection` with other utilities:

```javascript
const { 
  formatSystemContextHeader,
  formatUserContext,
  formatCustomSection,
  formatContextClosing
} = require('./prompt-builder.utils');

// Build custom context with mix of standard and custom sections
const customContext = [
  formatSystemContextHeader(),
  formatUserContext(userProfile, userId),
  formatCustomSection('Business Metrics', metrics),
  formatCustomSection('Active Campaigns', campaigns, { headerLevel: 'h3' }),
  formatCustomSection('Recent Activity', activities),
  formatContextClosing()
].join('\n\n');
```

## Best Practices

1. **Use descriptive section names** - Make it clear what the section contains
   ```javascript
   // Good
   formatCustomSection('Recent Customer Interactions', data)
   
   // Avoid
   formatCustomSection('Data', data)
   ```

2. **Structure your data** - Organize complex data into nested objects
   ```javascript
   // Good - structured
   const data = {
     email: { count: 50, last_sent: '2025-12-17' },
     sms: { count: 20, last_sent: '2025-12-16' }
   };
   
   // Less clear - flat
   const data = {
     email_count: 50,
     email_last_sent: '2025-12-17',
     sms_count: 20,
     sms_last_sent: '2025-12-16'
   };
   ```

3. **Use appropriate header levels** - Maintain hierarchy
   ```javascript
   formatCustomSection('Main Section', data, { headerLevel: 'h2' })
   formatCustomSection('Subsection', data, { headerLevel: 'h3' })
   ```

4. **Handle empty data gracefully** - Use `includeEmpty` when needed
   ```javascript
   // Show section even if empty (with explanation)
   const section = formatCustomSection(
     'Optional Features',
     optionalData || 'No optional features configured',
     { includeEmpty: true }
   );
   ```

5. **Keep it readable** - Don't nest too deeply
   ```javascript
   // Good - clear hierarchy
   {
     metrics: { views: 100, clicks: 50 },
     status: 'active'
   }
   
   // Avoid - too nested
   {
     data: {
       metrics: {
         engagement: {
           views: { count: 100 }
         }
       }
     }
   }
   ```

## Related Utilities

- `formatUserContext()` - Format user-specific information
- `formatMatterContext()` - Format matter details
- `formatDocumentList()` - Format document lists
- `assembleSystemContext()` - Combine multiple sections
- `assembleFullPrompt()` - Build complete prompts

## See Also

- [Prompt Builder Usage Guide](./PROMPT_BUILDER_USAGE.md)
- [Prompt System Architecture](./PROMPT_SYSTEM_ARCHITECTURE.md)
- [Refactoring Complete](./REFACTORING_COMPLETE.md)
