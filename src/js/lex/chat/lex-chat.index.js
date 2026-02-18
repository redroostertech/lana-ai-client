/* ==========================================================================
   Lex UI — Chat Module Index (Barrel)
   Loads all chat component files in dependency order, registers
   default sources and custom elements.

   Load order (matches <script> tags):
     1. lex-chat.format.js     — pure utility, no deps
     2. lex-chat.source.js     — ChatSource protocol + SSE + Demo
     3. lex-chat.message.js    — depends on format
     4. lex-chat.activity.js   — standalone
     5. lex-chat.documents.js  — standalone
     6. lex-chat.composer.js   — standalone
     7. lex-chat.thread.js     — depends on message
     8. lex-chat.js            — orchestrator, depends on all above
     9. lex-chat.index.js      — this file (barrel)
   ========================================================================== */

(function (global) {
  'use strict';

  const Lex = global.Lex;
  if (!Lex || !Lex.LexElement) {
    console.error('[Lex Chat] lex.core.js must be loaded first');
    return;
  }

  const Chat = Lex.Chat;
  if (!Chat) {
    console.error('[Lex Chat] Chat module files must be loaded before the barrel');
    return;
  }

  const { defineLex } = Lex;

  // -------------------------------------------------------------------------
  // Register default sources
  // -------------------------------------------------------------------------
  if (Chat.SSEChatSource)    Chat.registerSource('sse',   Chat.SSEChatSource);
  if (Chat.DemoChatSource)   Chat.registerSource('demo',  Chat.DemoChatSource);
  if (Chat.LlamaChatSource)  Chat.registerSource('llama', Chat.LlamaChatSource);

  // Also register 'lana' as an alias for 'sse'
  if (Chat.SSEChatSource) Chat.registerSource('lana', Chat.SSEChatSource);

  // -------------------------------------------------------------------------
  // Register custom elements
  // -------------------------------------------------------------------------
  if (Chat.LexChatMessage)   defineLex('lex-chat-message',   Chat.LexChatMessage);
  if (Chat.LexChatActivity)  defineLex('lex-chat-activity',  Chat.LexChatActivity);
  if (Chat.LexChatDocuments) defineLex('lex-chat-documents', Chat.LexChatDocuments);
  if (Chat.LexChatComposer)  defineLex('lex-chat-composer',  Chat.LexChatComposer);
  if (Chat.LexChatThread)    defineLex('lex-chat-thread',    Chat.LexChatThread);
  if (Chat.LexChat)          defineLex('lex-chat',           Chat.LexChat);

  // -------------------------------------------------------------------------
  // Log
  // -------------------------------------------------------------------------
  const components = ['message', 'activity', 'documents', 'composer', 'thread', 'chat'];
  const sources = Chat.getRegisteredSources ? Chat.getRegisteredSources() : [];
  console.log(`[Lex Chat] Registered ${components.length} components, ${sources.length} sources (${sources.join(', ')})`);

})(typeof window !== 'undefined' ? window : globalThis);
