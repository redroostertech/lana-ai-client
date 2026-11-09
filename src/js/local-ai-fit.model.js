/**
 * Which AI models this computer can run, and the setup LANA picks (first-launch plan,
 * docs/plans/first-launch-local-ai-plan.md, sections 4.2 and 4.3). Pure, no I/O: the main
 * process gives it the computer (electron-hardware.js) and the catalog
 * (electron-model-catalog.js); first launch and Settings > Capabilities show the result.
 *
 * The person chooses only the chat model, and one is already chosen for them. LANA chooses
 * the rest: the vision file that pairs with the chat model, the pinned embedding model, and
 * the speech and voice models. The models LANA requires are priced first, so every chat
 * choice shown leaves room for them.
 *
 * Memory math is Pip Desktop v2.0.0's (src/shared/presets.ts estimateImpact): model file +
 * conversation memory (KV cache) + working memory, against total memory:
 *   under 55%  comfortable  "Plenty left for other apps"
 *   under 75%  tight        "Little left for other apps"
 *   otherwise  won't fit
 * The 45% left over is what keeps the system and other apps running, so nothing else is
 * set aside for them. On a computer with an NVIDIA card, chat and vision live in the card's
 * memory instead, and the card has nothing else to share it with, so its limits are higher.
 *
 * Conversation memory per token is measured for the Qwen3 and Qwen3.5 families only, which is
 * why electron-model-catalog.js offers only those.
 */
(function (root) {
  'use strict';

  var GIB = 1024 * 1024 * 1024;
  var MIB = 1024 * 1024;

  /** Context steps tried for chat, largest first. Below the last one, chat uses the cloud. */
  var CONTEXT_STEPS = [32768, 16384, 8192];
  /**
   * The default must hold this much at once (about 44 pages). A smaller model that holds it
   * beats a bigger one that does not: on 16 GB the 4B with 32768 tokens and image reading is the
   * default, not the 9B with 16384 and no images (decided 2026-11-09). Bigger models stay choices.
   */
  var DEFAULT_MIN_CONTEXT = 32768;
  /** Conversations Pip keeps ready (Pip Desktop's default). Context is per conversation. */
  var PARALLEL = 2;
  /** About 500 words. */
  var TOKENS_PER_PAGE = 750;

  var COMFORTABLE = 0.55;
  var TIGHT = 0.75;
  // A graphics card's memory: Pip and nothing else. A card held back by 1 GB for its driver.
  var GPU_COMFORTABLE = 0.85;
  var GPU_TIGHT = 1.0;
  var GPU_RESERVE_BYTES = 1 * GIB;

  // estimateImpact constants: q8_0 conversation memory, ubatch 512.
  var KV_BYTES_PER_TOKEN = { 'qwen3.5': 17400, qwen3: 57344 };
  var RECURRENT_BYTES_PER_SLOT = { 'qwen3.5': 0.05 * GIB, qwen3: 0 };
  var SCRATCH_BYTES = 0.8 * GIB;
  var VISION_WORKING_BYTES = 0.25 * GIB;
  // Embedding: context and ubatch 2048, one slot (Pip Desktop embedModelSettings).
  var EMBED_WORKING_BYTES = (0.0625 * 2 + 0.05) * GIB;
  // On a computer without a graphics chip, bigger models answer too slowly to be the default.
  var CPU_DEFAULT_MAX_BYTES = 2 * GIB;
  // Kept free on the disk after downloads (Pip Desktop MODEL_DOWNLOAD_DISK_RESERVE_BYTES).
  var DISK_RESERVE_BYTES = 512 * MIB;

  var LEVEL = { comfortable: 2, tight: 1, wont_fit: 0 };

  function gb(bytes) {
    var value = bytes / GIB;
    return value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
  }

  function pages(tokens) {
    return Math.max(1, Math.round(tokens / TOKENS_PER_PAGE));
  }

  function level(ratio, comfortable, tight) {
    return ratio < comfortable ? 'comfortable' : ratio < tight ? 'tight' : 'wont_fit';
  }

  /** Chat memory at a context size: model + conversation memory + working memory. */
  function chatBytes(model, contextTokens) {
    var kv = KV_BYTES_PER_TOKEN[model.family];
    return model.sizeBytes + contextTokens * kv * PARALLEL + RECURRENT_BYTES_PER_SLOT[model.family] * PARALLEL + SCRATCH_BYTES;
  }

  function visionBytes(vision) {
    return vision ? vision.sizeBytes + VISION_WORKING_BYTES : 0;
  }

  function embedBytes(embedding) {
    return embedding.sizeBytes + EMBED_WORKING_BYTES;
  }

  function sum(list) {
    return list.reduce(function (total, n) { return total + n; }, 0);
  }

  /** What the computer offers models: one shared pool, or a graphics card beside system memory. */
  function pools(hardware) {
    var accel = hardware.accelerator || { backend: 'cpu' };
    if (accel.backend === 'cuda' && accel.vramBytes > GPU_RESERVE_BYTES) {
      return { gpuBytes: accel.vramBytes - GPU_RESERVE_BYTES, systemBytes: hardware.totalMemoryBytes, backend: 'cuda' };
    }
    return { gpuBytes: null, systemBytes: hardware.totalMemoryBytes, backend: accel.backend === 'metal' ? 'metal' : 'cpu' };
  }

  /** How well chat (with optional vision) fits, given what is already set aside in system memory. */
  function chatLevel(pool, reservedSystemBytes, bytes) {
    if (pool.gpuBytes) {return level(bytes / pool.gpuBytes, GPU_COMFORTABLE, GPU_TIGHT);}
    return level((reservedSystemBytes + bytes) / pool.systemBytes, COMFORTABLE, TIGHT);
  }

  function installedSet(installed) {
    var set = {};
    (installed || []).forEach(function (id) { set[id] = true; });
    return set;
  }

  function need(entry, installed) {
    return installed[entry.id] ? 0 : entry.sizeBytes;
  }

  /**
   * Price one chat model: the largest context step it holds comfortably, else tightly.
   * @returns {{ fit: string, contextTokens: number|null, reason: string|null }}
   */
  function priceChat(model, pool, reservedSystemBytes, diskLeftBytes, installed) {
    if (!KV_BYTES_PER_TOKEN[model.family]) {
      return { fit: 'wont_fit', contextTokens: null, reason: 'LANA has not measured this model yet.' };
    }
    if (need(model, installed) > diskLeftBytes) {
      return { fit: 'wont_fit', contextTokens: null, reason: 'There is not enough free space on this computer for ' + gb(model.sizeBytes) + ' GB.' };
    }
    var steps = CONTEXT_STEPS.filter(function (tokens) { return tokens <= model.contextWindow; });
    var best = { fit: 'wont_fit', contextTokens: null };
    steps.forEach(function (tokens) {
      var fit = chatLevel(pool, reservedSystemBytes, chatBytes(model, tokens));
      if (LEVEL[fit] > LEVEL[best.fit]) {best = { fit: fit, contextTokens: tokens };}
    });
    if (best.fit === 'wont_fit') {
      var smallest = steps[steps.length - 1] || CONTEXT_STEPS[CONTEXT_STEPS.length - 1];
      var neededBytes = chatBytes(model, smallest) / (pool.gpuBytes ? GPU_TIGHT : TIGHT);
      return { fit: 'wont_fit', contextTokens: null, reason: pool.gpuBytes
        ? 'This model needs a graphics card with about ' + gb(neededBytes + GPU_RESERVE_BYTES) + ' GB of memory.'
        : 'This model needs a computer with about ' + gb(neededBytes + reservedSystemBytes / TIGHT) + ' GB of memory.' };
    }
    return { fit: best.fit, contextTokens: best.contextTokens, reason: null };
  }

  function chatWhere(where, reason) {
    return { id: null, where: where, contextTokens: null, parallel: null, reason: reason };
  }

  /**
   * The chat choices and the setup for this computer.
   * @param {Object} input
   * @param {Object} input.hardware   electron-hardware.js readHardware()
   * @param {{chat: Object[], vision: Object[]}} input.catalog  electron-model-catalog.js
   * @param {Object} input.embedding  the pinned embedding entry ({ id, sizeBytes })
   * @param {Object} input.speech     { transcriptionBytes, voiceBytes, memoryBytes }: speech runs inside
   *                                  the app only while recording or talking, and memoryBytes is its
   *                                  measured peak (electron-local-models.js speechSizes)
   * @param {string[]} [input.installed]  ids already on disk and checked (they need no space)
   * @param {string} [input.chosenChatId]  the person's choice; ignored when it won't fit
   * @returns {Object} { computer, chatChoices, defaultChatId, plan, download }
   */
  function planLocalAi(input) {
    var hardware = input.hardware;
    var catalog = input.catalog;
    var installed = installedSet(input.installed);
    var pool = pools(hardware);
    var diskLeft = hardware.freeDiskBytes == null ? Infinity : Math.max(0, hardware.freeDiskBytes - DISK_RESERVE_BYTES);
    var plan = {};
    var files = [];
    var reserved = 0;

    function take(entry, kind) {
      var bytes = need(entry, installed);
      diskLeft -= bytes;
      if (bytes) {files.push({ id: entry.id, kind: kind, bytes: bytes });}
    }

    // 1. Embedding: always on, so always set aside.
    var embedMemory = embedBytes(input.embedding);
    if (need(input.embedding, installed) > diskLeft) {
      plan.embedding = { id: null, where: 'cloud', reason: 'There is not enough free space on this computer, so search uses the cloud.' };
    } else if (level(embedMemory / pool.systemBytes, COMFORTABLE, TIGHT) === 'wont_fit') {
      plan.embedding = { id: null, where: 'cloud', reason: 'This computer does not have enough memory, so search uses the cloud.' };
    } else {
      plan.embedding = { id: input.embedding.id, where: 'local', reason: null };
      reserved += embedMemory;
      take(input.embedding, 'embedding');
    }

    // 2. Speech and voice: set aside only when they fit beside embedding. Disk is checked
    //    after chat, below, because chat comes first on the disk.
    var speech = input.speech;
    var speechFitsMemory = level((reserved + speech.memoryBytes) / pool.systemBytes, COMFORTABLE, TIGHT) === 'comfortable';
    if (speechFitsMemory) {reserved += speech.memoryBytes;}

    // 3. Chat choices, priced with what LANA requires already set aside. On a graphics card,
    //    chat has the card to itself and only the required models count against system memory.
    var chatReserved = pool.gpuBytes ? 0 : reserved;
    var choices = catalog.chat.map(function (model) {
      var price = priceChat(model, pool, chatReserved, diskLeft, installed);
      var slow = pool.backend === 'cpu' && model.sizeBytes > CPU_DEFAULT_MAX_BYTES;
      return {
        id: model.id,
        name: model.name,
        sizeBytes: model.sizeBytes,
        fit: price.fit,
        contextTokens: price.contextTokens,
        pages: price.contextTokens ? pages(price.contextTokens) : null,
        slow: slow && price.fit !== 'wont_fit',
        reason: price.reason || (slow && price.fit !== 'wont_fit' ? 'This computer has no graphics chip, so this model answers slowly.' : null)
      };
    });

    function canDefault(choice, minContext) {
      return choice.fit === 'comfortable' && !choice.slow && choice.contextTokens >= minContext;
    }
    // Largest first: the catalog is ordered that way.
    var byDefault = choices.find(function (c) { return canDefault(c, DEFAULT_MIN_CONTEXT); })
      || choices.find(function (c) { return canDefault(c, CONTEXT_STEPS[1]); })
      || choices.find(function (c) { return canDefault(c, CONTEXT_STEPS[CONTEXT_STEPS.length - 1]); })
      || null;
    var chosen = choices.find(function (c) { return c.id === input.chosenChatId && c.fit !== 'wont_fit'; }) || byDefault;

    // 4. Chat, then the vision file that pairs with it if chat keeps its fit.
    if (!chosen) {
      plan.chat = chatWhere('cloud', 'This computer is too small to run LANA\'s chat, so LANA uses the cloud.');
      plan.vision = { id: null, reason: 'Image reading uses the cloud with chat.' };
    } else {
      var model = catalog.chat.find(function (m) { return m.id === chosen.id; });
      plan.chat = { id: model.id, where: 'local', contextTokens: chosen.contextTokens, parallel: PARALLEL, reason: null };
      take(model, 'chat');
      var vision = catalog.vision.find(function (v) { return v.pairsWith === model.id; }) || null;
      var withVision = vision && chatLevel(pool, chatReserved, chatBytes(model, chosen.contextTokens) + visionBytes(vision));
      if (!vision) {
        plan.vision = { id: null, reason: 'This chat model cannot read images.' };
      } else if (LEVEL[withVision] < LEVEL[chosen.fit]) {
        plan.vision = { id: null, reason: 'Reading images would leave too little memory on this computer.' };
      } else if (need(vision, installed) > diskLeft) {
        plan.vision = { id: null, reason: 'There is not enough free space on this computer for image reading.' };
      } else {
        plan.vision = { id: vision.id, reason: null };
        take(vision, 'vision');
      }
    }

    // 5. Speech, then voice, while there is room.
    if (!speechFitsMemory) {
      plan.speech = { install: false, reason: 'This computer does not have enough memory for listening.' };
      plan.voice = { install: false, reason: 'This computer does not have enough memory for speaking.' };
    } else {
      var speechNeed = installed.speech ? 0 : speech.transcriptionBytes;
      plan.speech = speechNeed > diskLeft
        ? { install: false, reason: 'There is not enough free space on this computer for listening.' }
        : { install: true, reason: null };
      if (plan.speech.install) {take({ id: 'speech', sizeBytes: speech.transcriptionBytes }, 'speech');}
      var voiceNeed = installed.voice ? 0 : speech.voiceBytes;
      plan.voice = voiceNeed > diskLeft
        ? { install: false, reason: 'There is not enough free space on this computer for speaking.' }
        : { install: true, reason: null };
      if (plan.voice.install) {take({ id: 'voice', sizeBytes: speech.voiceBytes }, 'voice');}
    }

    return {
      computer: {
        memoryBytes: hardware.totalMemoryBytes,
        chip: hardware.chip || null,
        backend: pool.backend,
        graphicsMemoryBytes: pool.gpuBytes ? hardware.accelerator.vramBytes : null,
        freeDiskBytes: hardware.freeDiskBytes
      },
      chatChoices: choices,
      defaultChatId: byDefault ? byDefault.id : null,
      plan: plan,
      download: { files: files, neededBytes: sum(files.map(function (f) { return f.bytes; })), freeBytes: hardware.freeDiskBytes }
    };
  }

  /** The plain words for a fit, as Pip Desktop shows them. */
  function fitLabel(fit) {
    if (fit === 'comfortable') {return 'Good fit for this computer';}
    if (fit === 'tight') {return 'Fits, with little left for other apps';}
    return 'Too big for this computer';
  }

  /** "About 44 pages at once" for a context size. */
  function remembersLabel(contextTokens) {
    return contextTokens ? 'About ' + pages(contextTokens) + ' pages at once' : '';
  }

  var api = {
    planLocalAi: planLocalAi,
    fitLabel: fitLabel,
    remembersLabel: remembersLabel,
    chatBytes: chatBytes,
    CONTEXT_STEPS: CONTEXT_STEPS,
    TOKENS_PER_PAGE: TOKENS_PER_PAGE
  };
  if (typeof module !== 'undefined' && module.exports) {module.exports = api;}
  else {root.LanaLocalAiFit = api;}
})(typeof window !== 'undefined' ? window : this);
