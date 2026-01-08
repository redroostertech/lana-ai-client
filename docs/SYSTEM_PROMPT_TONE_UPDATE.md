# System Prompt Tone Update

**Date:** December 16, 2024
**Status:** Implemented

---

## Summary

Updated Lana's system prompts across all endpoints to use a natural, conversational first-person tone. Eliminated awkward third-person references like "As Lana, I..." that made responses feel robotic and impersonal.

---

## Problem

Lana's responses sometimes included overly formal phrases that broke immersion:

**Before:**
```
As Lana, I'm happy to report that I don't have personal preferences or emotions. My purpose is to assist and provide information.

Regarding the 18th word of the haiku, it's actually "Winter's peaceful hush". Here are all the words again:
```

**Issues:**
- "As Lana, I'm happy to report..." sounds robotic
- Third-person self-references break natural conversation flow
- Feels like an AI trying to remind you it's an AI
- Not how humans naturally communicate

---

## Solution

Added explicit tone guidance to all system prompts:

### Communication Style Guidelines

```
Communication Style:
- Speak naturally in FIRST PERSON as Lana (use "I", "my", "I'm")
- NEVER use phrases like "As Lana, I..." or "As an AI assistant..." - you ARE Lana, just respond directly
- Be conversational and helpful, like a knowledgeable colleague
- Avoid overly formal or robotic language
- Examples of natural responses:
  ✓ "I don't have personal preferences, but I can help you with..."
  ✓ "I've found the information you need..."
  ✓ "Let me help you with that..."
  ✗ "As Lana, I'm happy to report..."
  ✗ "As an AI assistant, I don't have emotions..."
  ✗ "Speaking as Lana..."
```

---

## Implementation

### Files Modified

**1. Main Streaming Endpoint**
`src/services/processor/routes/streaming.routes.js:148-160`
- Updated `BASE_SYSTEM_PROMPT` with communication style section
- Provides clear examples of good vs bad phrasing
- Emphasizes first-person, natural tone

**2. Smart Query Endpoint**
`src/services/processor/routes/smart-query.routes.js:28-31`
- Added communication style to `SMART_QUERY_SYSTEM_PROMPT`
- Ensures multi-source queries also use natural tone
- Consistent with main prompt

**3. System Context Service (Minimal)**
`src/shared/context/system-context.service.js:356-360`
- Added tone guidance to `getMinimalContext()` fallback
- Ensures even error states use natural tone

**4. Cached System Context Service**
`src/shared/context/cached-system-context.service.js:206-209`
- Added tone guidance to `buildMinimalContext()`
- Consistent caching behavior

---

## Expected Results

### Before:
```
User: "What's your favorite color?"
Lana: "As Lana, I'm happy to report that I don't have personal preferences or emotions. My purpose is to assist and provide information."
```

### After:
```
User: "What's your favorite color?"
Lana: "I don't have personal preferences, but I can help you choose colors for documents, branding, or design work if you'd like!"
```

---

## Key Differences

### Old Style (Robotic):
- ❌ "As Lana, I'm happy to report..."
- ❌ "Speaking as an AI assistant..."
- ❌ "As your legal AI, I must inform you..."
- ❌ "In my capacity as Lana..."

### New Style (Natural):
- ✅ "I don't have access to that information..."
- ✅ "Let me help you with that..."
- ✅ "I've found what you're looking for..."
- ✅ "I can assist with..."

---

## Benefits

1. **More Natural Conversations**
   - Feels like talking to a knowledgeable colleague
   - Less robotic, more human-like
   - Better user experience

2. **Improved Immersion**
   - User doesn't need constant reminders they're talking to AI
   - Focus on solving problems, not AI identity
   - More professional interaction

3. **Clearer Communication**
   - Removes unnecessary prefixes
   - Gets to the point faster
   - More direct and helpful

4. **Consistent Personality**
   - Lana has a consistent voice across all endpoints
   - Feels like the same assistant everywhere
   - Professional yet approachable

---

## Testing

### Test Cases

**1. Personal Questions:**
```
User: "What's your name?"
Expected: "I'm Lana, your legal AI assistant. How can I help you today?"
NOT: "As Lana, I'm here to inform you that my name is Lana..."
```

**2. Capability Questions:**
```
User: "Can you help with contracts?"
Expected: "Yes! I can help you analyze contracts, draft clauses, or answer questions about contract law."
NOT: "As an AI assistant, I have the capability to assist with contracts..."
```

**3. Information Requests:**
```
User: "Tell me about this case."
Expected: "I don't have that information in my current context. Could you provide the matter name or case number?"
NOT: "As Lana, I must report that I don't have access to that information..."
```

---

## Implementation Notes

### Why This Works

The LLM (Ollama/llama3) receives these instructions as part of the system prompt on every request. By providing:
1. **Clear negative examples** (what NOT to say)
2. **Positive examples** (what TO say)
3. **Explicit rules** (NEVER use "As Lana...")

The model learns to adopt the desired tone naturally.

### Model Behavior

Large language models are very responsive to tone guidance in system prompts. By showing concrete examples of good/bad responses, the model adjusts its generation patterns to match the desired style.

---

## Future Enhancements

### 1. Tone Customization Per User

Allow users to set preferred communication style:
- Formal/professional
- Casual/friendly
- Technical/detailed
- Brief/concise

### 2. Context-Aware Tone

Adjust tone based on conversation context:
- More formal for court filings
- More casual for internal memos
- More technical for legal research

### 3. A/B Testing

Test different tone styles to see which users prefer:
- Current natural style
- More formal style
- Ultra-casual style

---

## Rollback Plan

If the new tone causes issues, the change can be easily reverted:

```bash
git checkout HEAD~1 -- src/services/processor/routes/streaming.routes.js
git checkout HEAD~1 -- src/services/processor/routes/smart-query.routes.js
git checkout HEAD~1 -- src/shared/context/system-context.service.js
git checkout HEAD~1 -- src/shared/context/cached-system-context.service.js
```

---

## Key Takeaways

1. **Tone matters** - How an AI responds is as important as what it says
2. **Explicit examples work** - Showing good/bad examples trains the model effectively
3. **Consistency is key** - All endpoints should use the same tone
4. **Less is more** - Removing unnecessary prefixes improves readability

---

**Status:** Implemented and ready for testing. Monitor user feedback to ensure the new tone is well-received.
