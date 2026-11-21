/* Live file processing: what the file viewer shows while LANA works on a
   file it just received.

   Chef records each step on the file's ingestion job and streams it
   (GET /api/v1/storage/jobs/:job_id/status/stream; the shape is Chef's
   shared/contracts/ingestion-progress.contract.js). This module turns that
   progress into the rows of the live panel, in plain words, and decides when
   the panel shows at all. It holds no state: the job on the server is the
   only state, so a person who closes the panel and opens the file again sees
   the same steps.

   No DOM here; tests: tests/unit/ingestion-progress-model.test.js. */

(function (global) {
  'use strict';

  var TERMINAL = ['completed', 'failed', 'cancelled'];

  function count(value) {
    var number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function stepsByStage(progress) {
    var map = {};
    (progress && Array.isArray(progress.steps) ? progress.steps : []).forEach(function (step) {
      if (step && step.stage) map[step.stage] = step;
    });
    return map;
  }

  function detailsLine(step) {
    var parts = [];
    var people = count(step.people_count);
    var dates = count(step.date_count);
    var amounts = count(step.amount_count);
    var citations = count(step.citation_count);
    if (people) parts.push(plural(people, 'person', 'people'));
    if (dates) parts.push(plural(dates, 'date', 'dates'));
    if (amounts) parts.push(plural(amounts, 'amount', 'amounts'));
    if (citations) parts.push(plural(citations, 'citation', 'citations'));
    return parts.length ? 'Found ' + parts.join(', ') : 'No names, dates or amounts found';
  }

  var SAFETY = {
    clean: 'Passed',
    flagged: 'Found text that looks like instructions. LANA will not follow it.',
    unreviewed: 'Not checked this time'
  };

  /* The panel's rows, in order. `done` names the step that finishes the row,
     `starts` the step that begins it (else the row before it finishing). */
  var ROWS = [
    {
      id: 'reading',
      label: 'Reading your file',
      starts: 'extracting_text',
      done: ['extraction_complete'],
      detail: function (s) {
        var read = s.extraction_complete;
        var pages = s.chunking_complete && count(s.chunking_complete.page_count);
        if (!read) return '';
        if (read.used_ocr) return pages ? 'Read ' + plural(pages, 'scanned page', 'scanned pages') : 'Read the scanned pages';
        return pages ? 'Read ' + plural(pages, 'page', 'pages') : 'Read the text';
      }
    },
    {
      id: 'details',
      label: 'Finding key details',
      done: ['details_found'],
      detail: function (s) { return s.details_found ? detailsLine(s.details_found) : ''; }
    },
    {
      id: 'safety',
      label: 'Safety check',
      done: ['safety_checked'],
      detail: function (s) {
        return s.safety_checked ? (SAFETY[s.safety_checked.disposition] || SAFETY.unreviewed) : '';
      }
    },
    {
      id: 'sections',
      label: 'Breaking it into sections',
      done: ['chunking_complete'],
      detail: function (s) {
        var n = s.chunking_complete && count(s.chunking_complete.chunk_count);
        return n ? plural(n, 'section', 'sections') : '';
      }
    },
    {
      id: 'search',
      label: 'Making it searchable',
      done: ['embeddings_complete', 'embeddings_deferred'],
      detail: function (s) {
        if (s.embeddings_deferred) return 'Search finishes in the background';
        var n = s.embeddings_complete && count(s.embeddings_complete.embedding_count);
        return n ? plural(n, 'section', 'sections') + ' ready to search' : '';
      }
    },
    {
      id: 'summary',
      label: 'Starting the summary',
      done: ['summary_queued'],
      detail: function (s) { return s.summary_queued ? 'The summary appears on the file when it is written' : ''; }
    }
  ];

  function isTerminal(status) {
    return TERMINAL.indexOf(status) !== -1;
  }

  /**
   * Show the live panel for this job? Yes while the file is still processing,
   * and for a failed file (it shows the step that broke and Try again). Not
   * for a finished or cancelled file, and not when there is no job.
   */
  function shouldShow(progress) {
    if (!progress || !progress.job_id) return false;
    return progress.status === 'failed' || !isTerminal(progress.status);
  }

  function rowDone(row, steps) {
    return row.done.some(function (stage) { return Boolean(steps[stage]); });
  }

  /**
   * Rows for lex-run-trace: { id, label, status, message, started_at,
   * completed_at }. Status is completed, running, pending or failed. The first
   * row not done is running while the job is live, failed when the job
   * failed. A finished job adds the Ready row.
   */
  function traceSteps(progress) {
    var steps = stepsByStage(progress);
    var status = progress && progress.status;
    var failed = status === 'failed' || Boolean(progress && progress.failed);
    var finished = status === 'completed';
    var started = Boolean(steps.extracting_text) || failed || finished;
    var previousAt = steps.extracting_text ? steps.extracting_text.at : null;
    var current = false;
    var rows = ROWS.map(function (row) {
      var done = rowDone(row, steps) || finished;
      var doneStep = row.done.map(function (stage) { return steps[stage]; }).filter(Boolean)[0];
      var item = { id: row.id, label: row.label, status: 'pending', message: '' };
      if (done) {
        item.status = 'completed';
        item.message = row.detail(steps);
        if (doneStep && previousAt && doneStep.at) {
          item.started_at = previousAt;
          item.completed_at = doneStep.at;
        }
        if (doneStep && doneStep.at) previousAt = doneStep.at;
      } else if (!current && started) {
        current = true;
        item.status = failed ? 'failed' : 'running';
        if (failed) item.message = 'This step did not finish';
      }
      return item;
    });
    if (finished) rows.push({ id: 'ready', label: 'Ready', status: 'completed', message: 'Ask LANA about this file' });
    return rows;
  }

  /** One line for the panel heading. */
  function headline(progress) {
    if (!progress) return '';
    if (progress.status === 'completed') return 'Your file is ready';
    if (progress.status === 'failed') return 'LANA could not finish this file';
    if (progress.status === 'cancelled') return 'Processing was stopped';
    var steps = stepsByStage(progress);
    return steps.extracting_text ? 'LANA is working on your file' : 'Waiting to start';
  }

  /**
   * Split a text/event-stream buffer into the JSON events it holds and the
   * unfinished rest. Comments (heartbeats) and frames that are not JSON are
   * skipped. The frame format is Chef's own, so this reads it, it does not
   * guess at it.
   */
  function parseEvents(buffer) {
    var text = String(buffer || '');
    var frames = text.split('\n\n');
    var rest = frames.pop();
    var events = [];
    frames.forEach(function (frame) {
      frame.split('\n').forEach(function (line) {
        if (line.indexOf('data: ') !== 0) return;
        try {
          events.push(JSON.parse(line.slice(6)));
        } catch (_error) { /* not an event */ }
      });
    });
    return { events: events, rest: rest };
  }

  var api = {
    shouldShow: shouldShow,
    traceSteps: traceSteps,
    headline: headline,
    parseEvents: parseEvents,
    isTerminal: isTerminal
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.LanaIngestionProgress = api;
})(typeof window !== 'undefined' ? window : this);
