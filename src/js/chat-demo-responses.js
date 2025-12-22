/**
 * Demo responses for Lana AI Chat
 * Used when DEMO_MODE is enabled to simulate AI responses without a backend
 */

window.ChatDemoResponses = {
  // Comprehensive demo responses for different query types
  responses: {
    contract: `A valid contract requires several key elements:

**1. Offer and Acceptance** - One party makes an offer, and the other accepts it.

**2. Consideration** - Something of value must be exchanged between parties (money, services, goods).

**3. Capacity** - Both parties must have legal capacity to enter the contract (age, mental competency).

**4. Legality** - The contract's purpose must be legal.

**5. Intent** - Both parties must intend to create a legally binding agreement.

**6. Certainty** - Terms must be clear and definite enough to be enforceable.

Would you like me to explain any of these elements in more detail?`,

    civilCriminal: `**Civil Law vs. Criminal Law**

**Criminal Law:**
- Deals with offenses against society/state
- Cases brought by government (prosecution)
- Standard: "Beyond reasonable doubt"
- Penalties: Fines, imprisonment, probation
- Examples: Theft, assault, murder

**Civil Law:**
- Deals with disputes between individuals/organizations
- Cases brought by private parties (plaintiffs)
- Standard: "Preponderance of evidence"
- Remedies: Monetary damages, injunctions
- Examples: Contract disputes, personal injury, property disputes

**Key Difference:** Criminal law punishes wrongdoers; civil law compensates victims.

Would you like more details on either area?`,

    attorneyClient: `**Attorney-Client Privilege**

This is a legal protection that keeps communications between a lawyer and client confidential.

**Key Aspects:**

1. **What's Protected:**
   - Communications made in confidence
   - For the purpose of seeking legal advice
   - Between attorney and client

2. **Who Holds It:**
   - The client owns the privilege
   - Only the client can waive it

3. **Exceptions:**
   - Crime-fraud exception (planning future crimes)
   - Waiver by disclosure to third parties
   - Disputes between attorney and client

4. **Why It Matters:**
   - Encourages honest communication
   - Enables effective legal representation

**Note:** This differs from work-product doctrine, which protects attorney's trial preparation materials.

Need clarification on any point?`,

    organizeDocuments: `**Tips for Organizing Legal Documents**

**1. Create a Logical Folder Structure:**
\`\`\`
📁 Client Name
  📁 Matter/Case Name
    📁 Correspondence
    📁 Pleadings
    📁 Discovery
    📁 Research
    📁 Contracts
\`\`\`

**2. Use Consistent Naming Conventions:**
- Date_DocumentType_Description
- Example: "2024-01-15_Contract_ServiceAgreement"

**3. Maintain a Document Index:**
- Track document dates, types, and status
- Use spreadsheet or document management system

**4. Implement Version Control:**
- Use clear version numbers (v1, v2, FINAL)
- Keep track of changes and who made them

**5. Regular Backups:**
- Multiple backup locations
- Test restoration periodically

**6. Access Controls:**
- Limit access based on need-to-know
- Track who accesses sensitive documents

Would you like specific tips for any document type?`,

    summarize: `I'd be happy to help summarize your documents! In the full version of Lana AI, I can:

**Document Analysis Features:**
- Extract key terms and clauses from contracts
- Identify parties, dates, and obligations
- Highlight potential risks or unusual provisions
- Create executive summaries

**To get started:**
1. Upload your document using the paperclip icon
2. Select the matter this document belongs to
3. Ask me specific questions about the content

In demo mode, I can explain general concepts. For actual document analysis, please sign in to access full features.

What type of document would you like to work with?`,

    caselaw: `**Legal Research with Lana AI**

In the full version, I can help you:

**Find Relevant Cases:**
- Search by jurisdiction, topic, or key terms
- Filter by date range and court level
- Find cases that cite specific statutes

**Analyze Precedents:**
- Summarize holdings and reasoning
- Track how cases have been treated
- Identify distinguishing factors

**Research Workflow:**
1. Start with your key legal issues
2. I'll suggest relevant search terms
3. Review and refine results together
4. Export citations in your preferred format

**Demo Limitation:** Case law database requires authentication.

What legal issue would you like to research?`,

    draft: `**Document Drafting with Lana AI**

I can assist with creating various legal documents:

**Available Templates:**
- Non-Disclosure Agreements (NDA)
- Service Agreements
- Employment Contracts
- Cease and Desist Letters
- Legal Memoranda

**Drafting Process:**
1. Select document type
2. Answer guided questions
3. Review AI-generated draft
4. Make edits and refinements
5. Export final document

**In Demo Mode:** I can explain document structures and common clauses.

**Full Version:** Generate complete drafts customized to your needs.

What type of document would you like to draft?`,

    greeting: `Hello! I'm Lana, your AI legal assistant. I'm here to help with:

- **Document Analysis** - Review contracts, briefs, and legal documents
- **Legal Research** - Find relevant case law and statutes
- **Drafting** - Create legal documents from templates
- **Organization** - Manage your matters and files

What would you like to work on today?`,

    help: `**How I Can Help**

**In Demo Mode, I can:**
- Explain legal concepts and terminology
- Discuss document organization best practices
- Describe contract elements and clauses
- Answer general legal questions

**In Full Mode (requires sign-in):**
- Analyze your uploaded documents
- Search case law databases
- Draft custom legal documents
- Manage matter workflows
- Collaborate with your team

**Quick Commands:**
- Ask about any legal concept
- "Summarize [document type]"
- "Draft a [document type]"
- "Find cases about [topic]"

What would you like to know more about?`,

    default: `That's a great question! In the full version of Lana AI, I can help you with:

**Document Analysis** - Upload contracts, briefs, and legal documents for AI-powered review

**Legal Research** - Search across jurisdictions and find relevant case law

**Document Drafting** - Generate legal documents with AI assistance

**Matter Management** - Organize all your case materials in one place

To access these features, please sign in to your account.

Is there anything else I can help explain in demo mode?`
  },

  /**
   * Get an appropriate response based on the user's query
   * @param {string} query - The user's message
   * @returns {string} - The demo response
   */
  getResponse(query) {
    const lowerQuery = query.toLowerCase();

    // Greeting patterns
    if (/^(hi|hello|hey|good\s*(morning|afternoon|evening)|greetings)/i.test(lowerQuery)) {
      return this.responses.greeting;
    }

    // Help patterns
    if (/\b(help|what can you|how do i|how can you|capabilities)\b/i.test(lowerQuery)) {
      return this.responses.help;
    }

    // Contract patterns
    if (lowerQuery.includes('contract') &&
        (lowerQuery.includes('element') || lowerQuery.includes('valid') ||
         lowerQuery.includes('key') || lowerQuery.includes('require'))) {
      return this.responses.contract;
    }

    // Civil vs Criminal
    if (lowerQuery.includes('civil') && lowerQuery.includes('criminal')) {
      return this.responses.civilCriminal;
    }

    // Attorney-client privilege
    if ((lowerQuery.includes('attorney') && lowerQuery.includes('privilege')) ||
        lowerQuery.includes('client privilege') ||
        lowerQuery.includes('confidential') && lowerQuery.includes('lawyer')) {
      return this.responses.attorneyClient;
    }

    // Document organization
    if ((lowerQuery.includes('organize') || lowerQuery.includes('organise') ||
         lowerQuery.includes('manage')) &&
        (lowerQuery.includes('document') || lowerQuery.includes('file'))) {
      return this.responses.organizeDocuments;
    }

    // Summarize
    if (lowerQuery.includes('summarize') || lowerQuery.includes('summarise') ||
        lowerQuery.includes('summary') || lowerQuery.includes('analyze document')) {
      return this.responses.summarize;
    }

    // Case law / research
    if (lowerQuery.includes('case law') || lowerQuery.includes('case-law') ||
        lowerQuery.includes('find case') || lowerQuery.includes('legal research') ||
        lowerQuery.includes('precedent')) {
      return this.responses.caselaw;
    }

    // Drafting
    if (lowerQuery.includes('draft') || lowerQuery.includes('write') ||
        lowerQuery.includes('create') || lowerQuery.includes('template')) {
      if (lowerQuery.includes('contract') || lowerQuery.includes('agreement') ||
          lowerQuery.includes('nda') || lowerQuery.includes('letter') ||
          lowerQuery.includes('document') || lowerQuery.includes('memo')) {
        return this.responses.draft;
      }
    }

    // Default response
    return this.responses.default;
  },

  /**
   * Simulate typing delay based on response length
   * @param {string} response - The response text
   * @returns {number} - Delay in milliseconds
   */
  getTypingDelay(response) {
    // Base delay + variable based on length (simulates reading/thinking)
    const baseDelay = 800;
    const perCharDelay = 2; // 2ms per character
    const maxDelay = 3000;

    return Math.min(baseDelay + (response.length * perCharDelay), maxDelay);
  }
};
