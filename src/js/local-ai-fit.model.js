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
 * AMD and Intel graphics on Windows and Linux (Vulkan, speed unmeasured) are run carefully: one
 * slot, and every layer on the chip only when the model plus its conversation memory fits there.
 * A card with its own memory is sized like an NVIDIA card; a chip that shares system memory is
 * sized against system memory and must also fit in INTEGRATED_GPU_SHARE of it, the share Windows
 * and Linux let such a chip address by default. A card whose memory cannot be read, or one too
 * small for any chat model, gets the processor-only plan instead.
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
  /**
   * Models are priced with one conversation slot, so the model and context LANA picks do not
   * depend on how many slots run (one f16 slot costs what Pip Desktop's two q8_0 slots did). The
   * slot count that runs is then chosen from what is left (chooseSlots). Context is per
   * conversation.
   */
  var PRICED_SLOTS = 1;
  /**
   * Slots a personal computer runs: two, chat plus one background lane (the engine is told to
   * keep background work to one call, electron-pip-supervisor.js engineEndpoints). Measured on
   * b7debcd (Norton, 2026-11-12): two streams decode 95 tok/s together against 76 for one.
   * One only when two do not fit. A server for a whole firm sizes slots differently (LANA-AI
   * infra/lib/config/lqe-args.js).
   */
  var MAX_SLOTS = 2;
  /** Pip's shared context pool (engine D-38) grows a conversation in chunks of this many tokens. */
  var CTX_CHUNK = 4096;
  /** The pool on a Mac with 16 GB or less: half the room, so the 9B still fits beside the rest. */
  var SMALL_MAC_POOL_TOKENS = 32768;
  /** About 500 words. */
  var TOKENS_PER_PAGE = 750;

  var COMFORTABLE = 0.55;
  var TIGHT = 0.75;
  // A graphics card's memory: Pip and nothing else. A card held back by 1 GB for its driver.
  var GPU_COMFORTABLE = 0.85;
  var GPU_TIGHT = 1.0;
  var GPU_RESERVE_BYTES = 1 * GIB;
  // A chip that shares system memory (Intel UHD, Iris, Arc 140V; AMD Radeon ... Graphics) may
  // address about half of it by default (Windows shared GPU memory; Linux GTT).
  var INTEGRATED_GPU_SHARE = 0.5;

  // Conversation memory per token, f16 (Pip runs f16 KV: quantized KV turns batched decode off
  // and decoded slower on Apple silicon). Pip Desktop's q8_0 figures (17400 and 57344, at 1.0625
  // bytes per value) doubled to 2 bytes per value: the Qwen3.5 9B keeps K and V for 8 attention
  // layers x 4 heads x 256, 32 KiB a token.
  var KV_BYTES_PER_TOKEN = { 'qwen3.5': 32768, qwen3: 107940 };
  var RECURRENT_BYTES_PER_SLOT = { 'qwen3.5': 0.05 * GIB, qwen3: 0 };
  // Models whose shape differs from their family's: the 35B-A3B has 10 attention layers x 2 heads
  // (20 KiB a token) and about 140 MiB of recurrent state per slot (engine measurements).
  var MODEL_SHAPES = { 'qwen3.5-35b-a3b-q4km': { kvBytesPerToken: 20480, recurrentBytesPerSlot: 140 * MIB } };
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

  function shapeOf(model) {
    var shape = MODEL_SHAPES[model.id] || {};
    return {
      kvBytesPerToken: shape.kvBytesPerToken || KV_BYTES_PER_TOKEN[model.family],
      recurrentBytesPerSlot: shape.recurrentBytesPerSlot != null ? shape.recurrentBytesPerSlot : RECURRENT_BYTES_PER_SLOT[model.family]
    };
  }

  /**
   * Conversation memory in tokens. One slot holds its own context. Two or more share a pool of
   * a full context per slot (65536 for two at 32768, as measured), except on a Mac with 16 GB or
   * less, where the pool is 32768: there one conversation reaches 32768 - 4096 = 28672 tokens
   * while the other holds its first chunk. Idle slots give their room back.
   */
  function poolTokens(contextTokens, slots, backend, totalMemoryBytes) {
    if (!(slots > 1)) {return contextTokens;}
    var pool = contextTokens * slots;
    if (backend === 'metal' && totalMemoryBytes && totalMemoryBytes <= 16 * GIB) {pool = Math.min(pool, SMALL_MAC_POOL_TOKENS);}
    return pool;
  }

  /**
   * What /props reports as n_ctx: -c, capped at what is left of the pool when every other slot
   * holds a chunk. `pool` defaults to poolTokens().
   */
  function perConversationTokens(contextTokens, slots, backend, totalMemoryBytes, pool) {
    if (!(slots > 1)) {return contextTokens;}
    var chunk = Math.min(CTX_CHUNK, contextTokens);
    var tokens = pool || poolTokens(contextTokens, slots, backend, totalMemoryBytes);
    return Math.min(contextTokens, tokens - (slots - 1) * chunk);
  }

  /**
   * Host memory Pip keeps for computed system prompts (engine D-40, --prefix-share-mb), in MiB.
   * Apple silicon shares them on the graphics chip only with more than one slot (under
   * --gpu-inexact): 1024 MiB from 64 GB up, else 512. On a processor-only computer sharing is
   * exact, so it is always on at the engine's default 256. NVIDIA and other graphics chips do not
   * share (unmeasured there).
   */
  function prefixShareMb(backend, slots, totalMemoryBytes) {
    if (backend === 'metal') {return slots > 1 ? (totalMemoryBytes >= 64 * GIB ? 1024 : 512) : 0;}
    if (backend === 'cpu') {return 256;}
    return 0;
  }

  /**
   * Chat memory: model + the shared conversation pool + recurrent state per slot + working
   * memory, plus the shared system-prompt memory when `backend` is given.
   */
  function chatBytes(model, contextTokens, slots, backend, totalMemoryBytes, pool) {
    var count = slots || PRICED_SLOTS;
    var shape = shapeOf(model);
    var share = backend ? prefixShareMb(backend, count, totalMemoryBytes || 0) * MIB : 0;
    var tokens = count > 1 && pool ? pool : poolTokens(contextTokens, count, backend, totalMemoryBytes);
    return model.sizeBytes + tokens * shape.kvBytesPerToken + shape.recurrentBytesPerSlot * count + SCRATCH_BYTES + share;
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
    if (accel.backend === 'vulkan') {
      if (accel.shared) {
        return { gpuBytes: null, systemBytes: hardware.totalMemoryBytes, backend: 'vulkan', gpuShareBytes: Math.floor(hardware.totalMemoryBytes * INTEGRATED_GPU_SHARE) };
      }
      if (accel.vramBytes > GPU_RESERVE_BYTES) {
        return { gpuBytes: accel.vramBytes - GPU_RESERVE_BYTES, systemBytes: hardware.totalMemoryBytes, backend: 'vulkan' };
      }
      return processorPool(hardware);
    }
    if (accel.backend === 'cuda' && accel.vramBytes > GPU_RESERVE_BYTES) {
      return { gpuBytes: accel.vramBytes - GPU_RESERVE_BYTES, systemBytes: hardware.totalMemoryBytes, backend: 'cuda' };
    }
    // NVIDIA without its own memory figure (DGX Spark GB10 shares system memory) still runs on the
    // graphics chip.
    var shared = accel.backend === 'metal' || (accel.backend === 'cuda' && !accel.vramBytes) ? accel.backend : 'cpu';
    return { gpuBytes: null, systemBytes: hardware.totalMemoryBytes, backend: shared };
  }

  function processorPool(hardware) {
    return { gpuBytes: null, systemBytes: hardware.totalMemoryBytes, backend: 'cpu' };
  }

  /** How well chat (with optional vision) fits, given what is already set aside in system memory. */
  function chatLevel(pool, reservedSystemBytes, bytes) {
    if (pool.gpuShareBytes && bytes > pool.gpuShareBytes) {return 'wont_fit';}
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
      return { fit: 'wont_fit', contextTokens: null, reason: 'There is not enough free space on this computer for this ' + gb(model.sizeBytes) + ' GB model.' };
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

  /**
   * How many conversations Pip keeps ready for the chosen model, and their shared pool: two
   * (MAX_SLOTS) when they fit, that is when the pool and shared system-prompt memory two bring
   * keep the setup as good a fit as one slot (a comfortable choice stays comfortable, a tight one
   * stays tight). A Mac up to 24 GB that cannot hold the full pool tries the 32768-token pool
   * before giving up the second slot. One slot when neither fits.
   * @returns {{ slots: number, poolTokens: number|null }}
   */
  function chooseSlots(input) {
    // Vulkan is unmeasured: one slot, no shared pool.
    if (input.backend === 'vulkan') {return { slots: 1, poolTokens: null };}
    var memory = input.pool.systemBytes;
    var one = chatBytes(input.model, input.contextTokens, 1, input.backend, memory) + input.visionBytes;
    var floor = LEVEL[chatLevel(input.pool, input.reservedSystemBytes, one)];
    var pools = [poolTokens(input.contextTokens, MAX_SLOTS, input.backend, memory)];
    if (input.backend === 'metal' && memory <= 24 * GIB) {pools.push(Math.min(pools[0], SMALL_MAC_POOL_TOKENS));}
    for (var i = 0; i < pools.length; i += 1) {
      var bytes = chatBytes(input.model, input.contextTokens, MAX_SLOTS, input.backend, memory, pools[i]) + input.visionBytes;
      if (LEVEL[chatLevel(input.pool, input.reservedSystemBytes, bytes)] >= floor) {return { slots: MAX_SLOTS, poolTokens: pools[i] };}
    }
    return { slots: 1, poolTokens: null };
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
   * @param {Object} [input.redactor]  { memoryBytes }: the redactor runs whenever the app is open
   *                                  (electron-redactor.js REDACTOR_MEMORY_BYTES); none when it
   *                                  is not on this computer
   * @param {Object} [input.docling]  { memoryBytes, diskBytes, downloadBytes, provided }: Docling runs
   *                                  whenever the app is open when it is on this computer
   *                                  (electron-docling.js DOCLING_MEMORY_BYTES). provided: one is here
   *                                  already (a developer's, or the runtime first launch installed).
   *                                  Otherwise diskBytes is what installing it takes on the disk at
   *                                  once (electron-docling-install.js sizes), null when no runtime
   *                                  is built for this kind of computer
   * @param {string[]} [input.installed]  ids already on disk and checked (they need no space)
   * @param {string} [input.chosenChatId]  the person's choice; ignored when it won't fit
   * @returns {Object} { computer, chatChoices, defaultChatId, plan, download }
   */
  function planLocalAi(input) {
    var pool = pools(input.hardware);
    var result = planOn(input, pool);
    // No chat model fits on an AMD or Intel chip: the processor-only plan instead.
    if (pool.backend === 'vulkan' && result.plan.chat.where !== 'local') {return planOn(input, processorPool(input.hardware));}
    return result;
  }

  /** planLocalAi on one pool of memory (pools()). */
  function planOn(input, pool) {
    var hardware = input.hardware;
    var catalog = input.catalog;
    var installed = installedSet(input.installed);
    var diskLeft = hardware.freeDiskBytes == null ? Infinity : Math.max(0, hardware.freeDiskBytes - DISK_RESERVE_BYTES);
    var plan = {};
    var files = [];
    var reserved = 0;

    function take(entry, kind) {
      var bytes = need(entry, installed);
      diskLeft -= bytes;
      if (!bytes) {return;}
      var file = { id: entry.id, kind: kind, bytes: bytes };
      // Docling takes more room than it downloads: its archive unpacks beside itself.
      if (entry.downloadBytes) {file.downloadBytes = entry.downloadBytes;}
      files.push(file);
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

    // 1b. The redactor: always on when it is here, so always set aside. It is part of the app,
    //     not a download.
    if (input.redactor && input.redactor.memoryBytes) {reserved += input.redactor.memoryBytes;}

    // 1c. Docling: whether it is here or can be installed. Its memory is checked AFTER chat and
    //     vision (step 4b): chat on this computer comes first, and when Docling does not fit, the
    //     organization's server reads documents instead, so Docling never pushes chat to a smaller
    //     model. Disk is checked there too: chat and vision come first on the disk.
    var docling = input.docling || null;
    var doclingAvailable = Boolean(docling && (docling.provided || installed.docling || docling.diskBytes != null));
    var doclingFitsMemory = false;

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
      plan.chat = { id: model.id, where: 'local', contextTokens: chosen.contextTokens, parallel: PRICED_SLOTS, reason: null };
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
      var slots = chooseSlots({
        model: model, contextTokens: chosen.contextTokens, backend: pool.backend, pool: pool,
        reservedSystemBytes: chatReserved, visionBytes: plan.vision.id ? visionBytes(vision) : 0
      });
      plan.chat.parallel = slots.slots;
      plan.chat.poolTokens = slots.poolTokens;
    }

    // 4b. Docling, after chat and vision in memory and on the disk, and before speech on the disk.
    //     It must fit, under the tight line rather than the comfortable one, beside everything
    //     already set aside plus chat and vision (on a graphics card chat and vision use the card,
    //     not system memory). Docling only reaches its peak while it reads a file and the server is
    //     the fallback, so a 16 GB computer with the 4B and image reading (about 60 percent at the
    //     worst moment) runs it, as the 16 GB Mac mini does today.
    if (doclingAvailable) {
      var chatModel = plan.chat.where === 'local' ? catalog.chat.find(function (m) { return m.id === plan.chat.id; }) : null;
      var visionModel = plan.vision.id ? catalog.vision.find(function (v) { return v.id === plan.vision.id; }) : null;
      var aiOnSystem = pool.gpuBytes || !chatModel ? 0 : chatBytes(chatModel, plan.chat.contextTokens, plan.chat.parallel, pool.backend, pool.systemBytes, plan.chat.poolTokens) + (visionModel ? visionBytes(visionModel) : 0);
      doclingFitsMemory = level((reserved + aiOnSystem + (docling.memoryBytes || 0)) / pool.systemBytes, COMFORTABLE, TIGHT) !== 'wont_fit';
    }
    if (!docling) {
      plan.docling = { install: false, reason: null };
    } else if (!doclingAvailable) {
      plan.docling = { install: false, reason: 'Reading documents on this computer is not ready for this kind of computer yet.' };
    } else if (!doclingFitsMemory) {
      plan.docling = { install: false, reason: 'This computer does not have enough memory to read documents here, so your organization\'s server reads them.' };
    } else {
      var doclingEntry = { id: 'docling', sizeBytes: docling.provided ? 0 : docling.diskBytes, downloadBytes: docling.downloadBytes };
      if (need(doclingEntry, installed) > diskLeft) {
        plan.docling = { install: false, reason: 'There is not enough free space on this computer to read documents here, so your organization\'s server reads them.' };
      } else {
        plan.docling = { install: true, reason: null };
        take(doclingEntry, 'docling');
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
    poolTokens: poolTokens,
    perConversationTokens: perConversationTokens,
    prefixShareMb: prefixShareMb,
    CTX_CHUNK: CTX_CHUNK,
    MAX_SLOTS: MAX_SLOTS,
    CONTEXT_STEPS: CONTEXT_STEPS,
    TOKENS_PER_PAGE: TOKENS_PER_PAGE,
    INTEGRATED_GPU_SHARE: INTEGRATED_GPU_SHARE
  };
  if (typeof module !== 'undefined' && module.exports) {module.exports = api;}
  else {root.LanaLocalAiFit = api;}
})(typeof window !== 'undefined' ? window : this);
