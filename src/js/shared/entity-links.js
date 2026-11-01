/**
 * entity-links.js
 * View mapping for typed links between matter records (design 3.5, 4.2).
 *
 * A link is { id, link_type, source: { kind, id }, target, created_by,
 * created_at, relationship_source }. A rule target carries the pin of the
 * rulebook the matter applies: a firm rulebook { record_id, version }, or
 * LANA's starter { rulebook_basis: 'starter', starter_id, starter_version,
 * starter_sha256, jurisdiction }, which reads `pin_outdated` true once the
 * shipped starter text has changed. A document target that cites a
 * retained release carries { release_id, version } (the release number). The
 * server checks both ends exist in the same organization and matter; this
 * module only names things for display, maps picker records, builds the link
 * requests and words the server's refusals.
 *
 * produced_by links (to agent runs, automation runs, task actions) are written
 * by the server; a person cannot add or remove them here.
 *
 * Public API (window.LanaEntityLinks, or module.exports in Node):
 *   - PICKABLE_KINDS                        -> kinds a person can link to, in menu order
 *   - kindLabel(kind)                       -> 'Contact', 'Agent run', ...
 *   - pickerKindOptions()                   -> lex-dropdown-btn items for "Add link"
 *   - defaultLinkType(kind)                 -> 'cites' | 'about'
 *   - otherEnd(link, self)                  -> the end of the link that is not self
 *   - targetsRequest(matterId, kind, cursor) -> { method, path } for GET .../links/targets
 *   - targetsPage(kind, response)           -> { candidates, nextCursor, available, reason }
 *   - toLinkCandidates(kind, response)      -> [{ id, label, target, description? (rules), releases? }] (releases: [{ id, label, target }])
 *   - rulePin(end)                          -> { basis: 'starter'|'firm', kindText, version, outdated } | null
 *   - indexCandidates(index, kind, list)    -> index with kind:id -> label added
 *   - endLabel(end, index)                  -> readable text for one link end
 *   - linkChips(links, self, index)         -> [{ id, kind, kindText, text, title, removable, outdated, repin?, run? }]
 *   - ruleChips(links, self)                -> linkChips for linked rules only (Board cards)
 *   - repinMessage(previousReleaseId, response) -> toast text after re-pinning a citation
 *   - kindsNeedingLookup(notes, self)       -> kinds whose labels need a fetch
 *   - createLinkRequest(matterId, source, kind, target) -> { method, path, body }
 *   - removeLinkRequest(matterId, linkId)   -> { method, path, body }
 *   - linkErrorMessage(error, kind, action) -> text for a refused add or remove
 */

(function (global) {
  'use strict';

  var KIND_LABELS = {
    matter_asset: 'Asset',
    contact: 'Contact',
    document: 'Document',
    rulebook_rule: 'Rule',
    task: 'Task',
    agent_run: 'Agent run',
    automation_execution: 'Automation run',
    matter_note: 'Note',
    comment: 'Comment',
    assurance_record: 'Assurance record',
    assurance_decision: 'Decision',
    task_action: 'Task action'
  };

  // What a note may point at (backend link-kinds contract: about targets plus
  // cited documents). A task is not a note target; tasks link from their side.
  var PICKABLE_KINDS = Object.freeze(['matter_asset', 'contact', 'document', 'rulebook_rule']);

  // A rule id (module.area.slug) reads better than any name, so chips show it.
  var SHOWS_OWN_ID = { rulebook_rule: true };

  var LINK_TYPE_BY_KIND = {
    document: 'cites'
  };

  // Written by the server when a run produces the record; read-only here.
  var SERVER_LINK_TYPES = { produced_by: true };

  // Run kinds a produced_by link can name (the run_causation run kinds).
  var RUN_KINDS = { agent_run: true, automation_execution: true, task_action: true };

  var SHORT_ID_LENGTH = 8;

  // Shown beside a starter rule link whose shipped text has changed since.
  var PIN_OUTDATED_TEXT = 'Rulebook text changed';

  // Link target lookup page size (the route allows up to 50).
  var TARGET_PAGE_SIZE = 50;

  function kindLabel(kind) {
    return KIND_LABELS[kind] || 'Record';
  }

  function pickerKindOptions() {
    return PICKABLE_KINDS.map(function (kind) {
      return { value: kind, label: kindLabel(kind) };
    });
  }

  function defaultLinkType(kind) {
    return LINK_TYPE_BY_KIND[kind] || 'about';
  }

  function sameEnd(end, self) {
    return !!end && !!self && end.kind === self.kind && String(end.id) === String(self.id);
  }

  function otherEnd(link, self) {
    if (!link) return null;
    return sameEnd(link.source, self) ? link.target : link.source;
  }

  function firstText() {
    for (var i = 0; i < arguments.length; i++) {
      var value = arguments[i];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return '';
  }

  function shortId(id) {
    return String(id || '').substring(0, SHORT_ID_LENGTH);
  }

  /**
   * Which rulebook a rule end is pinned to: LANA's starter (starter_id,
   * starter_version) or a firm rulebook record (record_id, version). A rule
   * reference with no pin (a proposal's `about`) is neither.
   */
  function rulePin(end) {
    if (!end || end.kind !== 'rulebook_rule') return null;
    if (end.rulebook_basis === 'starter') {
      return { basis: 'starter', kindText: 'Starter rule', version: hasValue(end.starter_version) ? String(end.starter_version) : '', outdated: end.pin_outdated === true };
    }
    if (!end.record_id) return null;
    return { basis: 'firm', kindText: 'Firm rule', version: hasValue(end.version) ? String(end.version) : '', outdated: false };
  }

  // A rule id repeats across rulebooks and their versions, so a rule
  // candidate's id names the pin too.
  function candidateId(kind, target) {
    if (kind !== 'rulebook_rule') return String(target.id);
    if (target.rulebook_basis === 'starter') return target.id + '@starter:' + target.starter_id + ':' + target.starter_version + ':' + target.starter_sha256;
    return target.id + '@' + target.record_id + ':' + target.version;
  }

  function candidateLabel(kind, row) {
    var label = firstText(row.label);
    if (kind === 'rulebook_rule') {
      var id = String(row.target.id);
      var pin = rulePin(row.target);
      return id + (label && label !== id ? ': ' + label : '') + (pin ? ' (' + pin.kindText + (pin.version ? ' v' + pin.version : '') + ')' : '');
    }
    return label || (kindLabel(kind) + ' ' + shortId(row.target.id));
  }

  function releaseOptions(row) {
    return (Array.isArray(row.releases) ? row.releases : []).reduce(function (out, release) {
      if (!release || !release.release_id || !release.target) return out;
      out.push({
        id: String(release.release_id),
        label: firstText(release.label) || 'Release ' + (hasValue(release.release_number) ? release.release_number : shortId(release.release_id)),
        target: release.target
      });
      return out;
    }, []);
  }

  /**
   * One page of the link target lookup
   * ({ status, data: { kind, targets, next_cursor, available, reason? } }) as
   * picker candidates. Each candidate keeps the server's target, which is
   * the exact POST target; a document keeps its retained releases.
   */
  function targetsPage(kind, response) {
    var data = (response && response.data) || {};
    if (data.available === false) return { candidates: [], nextCursor: null, available: false, reason: firstText(data.reason) };
    var rows = Array.isArray(data.targets) ? data.targets : [];
    var candidates = rows.reduce(function (out, row) {
      if (!row || !row.target || row.target.kind !== kind || !hasValue(row.target.id)) return out;
      var candidate = { id: candidateId(kind, row.target), label: candidateLabel(kind, row), target: row.target };
      // A rule's server description names its rulebook (starter or firm, version).
      if (kind === 'rulebook_rule') candidate.description = firstText(row.description);
      if (kind === 'document') candidate.releases = releaseOptions(row);
      out.push(candidate);
      return out;
    }, []);
    return { candidates: candidates, nextCursor: data.next_cursor || null, available: true, reason: '' };
  }

  function toLinkCandidates(kind, response) {
    return targetsPage(kind, response).candidates;
  }

  function targetsRequest(matterId, kind, cursor) {
    var query = '?kind=' + encodeURIComponent(kind) + '&limit=' + TARGET_PAGE_SIZE + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    return { method: 'GET', path: linksPath(matterId) + '/targets' + query, body: null };
  }

  function indexKey(kind, id) {
    return kind + ':' + id;
  }

  function indexCandidates(index, kind, candidates) {
    var next = index || {};
    (candidates || []).forEach(function (item) {
      next[indexKey(kind, item.id)] = item.label;
    });
    return next;
  }

  function hasValue(value) {
    return value !== undefined && value !== null && value !== '';
  }

  // The pin a target carries: the version of the rulebook a rule was read
  // from (firm or starter), or the retained release a document citation rests on.
  function pinText(end) {
    if (end.kind === 'rulebook_rule') {
      var pin = rulePin(end);
      return pin && pin.version ? ' (v' + pin.version + ')' : '';
    }
    if (!hasValue(end.version)) return '';
    if (end.release_id) return ' (release ' + end.version + ')';
    return ' v' + end.version;
  }

  // The end's own text: its loaded name, its id for kinds that read by id,
  // or a short id. `named` says whether it reads on its own without the kind.
  function endText(end, index) {
    var pin = pinText(end);
    if (SHOWS_OWN_ID[end.kind]) return { text: String(end.id || '') + pin, named: true };
    var known = index && index[indexKey(end.kind, end.id)];
    if (known) return { text: known + pin, named: true };
    return { text: shortId(end.id) + pin, named: false };
  }

  function endLabel(end, index) {
    if (!end || !end.kind) return 'Unknown record';
    var own = endText(end, index);
    return own.named ? own.text : kindLabel(end.kind) + ' ' + own.text;
  }

  function linkChips(links, self, index) {
    return (links || []).reduce(function (out, link) {
      var end = otherEnd(link, self);
      if (!link || !link.id || !end) return out;
      // Chips show the kind beside the text, so the text never repeats it.
      var text = end.kind ? endText(end, index).text : endLabel(end, index);
      var pin = rulePin(end);
      var kindText = pin ? pin.kindText : kindLabel(end.kind);
      var chip = {
        id: String(link.id),
        kind: end.kind,
        kindText: kindText,
        text: text,
        title: kindText + ': ' + text + (pin && pin.outdated ? '. ' + PIN_OUTDATED_TEXT + ' since this link was made' : ''),
        removable: !SERVER_LINK_TYPES[link.link_type],
        outdated: !!(pin && pin.outdated)
      };
      // A document citation can be pinned to another retained release (the
      // server answers 200 with the new pin).
      if (link.link_type === 'cites' && end.kind === 'document') {
        chip.repin = { documentId: String(end.id), releaseId: end.release_id ? String(end.release_id) : '' };
      }
      if (link.link_type === 'produced_by' && RUN_KINDS[end.kind] && end.id) {
        chip.run = { kind: end.kind, id: String(end.id) };
      }
      out.push(chip);
      return out;
    }, []);
  }

  // Rules a record is linked to, shown by rule id, starter or firm, and pinned version.
  function ruleChips(links, self) {
    return linkChips(links, self, null).filter(function (chip) { return chip.kind === 'rulebook_rule'; });
  }

  function kindsNeedingLookup(notes, selfKind) {
    var seen = {};
    (notes || []).forEach(function (note) {
      var self = { kind: selfKind, id: note && note.note_id };
      ((note && note.links) || []).forEach(function (link) {
        var end = otherEnd(link, self);
        if (end && PICKABLE_KINDS.indexOf(end.kind) !== -1 && !SHOWS_OWN_ID[end.kind]) seen[end.kind] = true;
      });
    });
    return PICKABLE_KINDS.filter(function (kind) { return seen[kind]; });
  }

  function linksPath(matterId) {
    return '/api/v1/matters/' + encodeURIComponent(matterId) + '/links';
  }

  /**
   * @param {string} matterId - matter code
   * @param {{kind: string, id: string}} source
   * @param {string} kind - target kind
   * @param {Object} pick - the chosen target exactly as the link target
   *   lookup gave it (a rule carries its firm or starter pin, a document
   *   release adds release_id); sent as is, with `kind` only when it has none
   */
  function createLinkRequest(matterId, source, kind, pick) {
    var target = Object.assign({ kind: kind }, pick || {});
    return {
      method: 'POST',
      path: linksPath(matterId),
      body: {
        link_type: defaultLinkType(kind),
        source: { kind: source.kind, id: String(source.id) },
        target: target
      }
    };
  }

  /**
   * Toast text after a document link was sent again with a release choice.
   * The answer is the server's link ({ data: { link } }), so the text names
   * the pin it now holds.
   */
  function repinMessage(previousReleaseId, response) {
    var link = response && ((response.data && response.data.link) || response.link);
    var target = link && link.target;
    var now = target && target.release_id ? String(target.release_id) : '';
    var before = previousReleaseId ? String(previousReleaseId) : '';
    if (!link) return 'Citation saved';
    if (now === before) return 'Citation unchanged';
    if (!now) return 'The note no longer cites a retained release';
    return 'Now cites release ' + (hasValue(target.version) ? target.version : shortId(now));
  }

  function removeLinkRequest(matterId, linkId) {
    return {
      method: 'DELETE',
      path: linksPath(matterId) + '/' + encodeURIComponent(linkId),
      body: null
    };
  }

  /**
   * A sentence for a refused link add or remove, from the server's status and
   * code (shared/errors on the backend). Kind-specific wording only for the
   * refusals a person can act on.
   */
  function linkErrorMessage(error, kind, action) {
    var status = error && error.status;
    var body = (error && error.data) || {};
    var code = (error && error.code) || (body.error && body.error.code);
    var noun = kindLabel(kind).toLowerCase();
    if (action === 'remove') {
      if (status === 404) return 'That link was already removed.';
      if (status === 403) return 'You do not have permission to change links on this matter.';
      return 'The link could not be removed. Try again.';
    }
    if (code === 'LINK_KIND_NOT_LINKABLE' || status === 422) {
      return kindLabel(kind) + ' records are linked by the server when they produce a note, not by hand.';
    }
    if (status === 404) {
      if (kind === 'rulebook_rule') return 'That rule is not in the rulebook this matter applies, or its text has changed. Pick it again from the list.';
      if (kind === 'document') return 'That document or release is not on this matter, or you cannot open it.';
      return 'That ' + noun + ' is not on this matter, or you cannot see it.';
    }
    // The privilege disclosure gate holds the document (or a release's copy).
    if (status === 403 && code === 'PRIVILEGE_DISCLOSURE_BLOCKED') return 'This document is restricted and cannot be cited here.';
    if (status === 403) return 'You do not have permission to change links on this matter.';
    if (status === 409 || code === 'LINK_CONFLICT') return 'The link could not be saved. Try again.';
    if (status === 400 && error.message && error.message !== 'Validation failed') return error.message;
    return 'The link could not be added. Try again.';
  }

  var moduleApi = {
    PICKABLE_KINDS: PICKABLE_KINDS,
    PIN_OUTDATED_TEXT: PIN_OUTDATED_TEXT,
    kindLabel: kindLabel,
    pickerKindOptions: pickerKindOptions,
    defaultLinkType: defaultLinkType,
    otherEnd: otherEnd,
    targetsRequest: targetsRequest,
    targetsPage: targetsPage,
    toLinkCandidates: toLinkCandidates,
    indexCandidates: indexCandidates,
    endLabel: endLabel,
    rulePin: rulePin,
    linkChips: linkChips,
    ruleChips: ruleChips,
    kindsNeedingLookup: kindsNeedingLookup,
    createLinkRequest: createLinkRequest,
    removeLinkRequest: removeLinkRequest,
    repinMessage: repinMessage,
    linkErrorMessage: linkErrorMessage
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaEntityLinks = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
