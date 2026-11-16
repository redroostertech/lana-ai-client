const path = require('path');

const Model = require(path.join(__dirname, '../../src/agents/js/agents-dashboard-model.js'));

const item = (runId, attention, extra = {}) => ({
  run_id: runId, attention, agent_name: 'Matter Architect', title: `Run ${runId}`, status: 'failed', at: '2026-11-15T11:00:00.000Z', ...extra
});

describe('Agents home model (Orcestr8 Control Center priorities)', () => {
  const needs = [item('a', 'approval'), item('s', 'stopped'), item('q', 'question'), item('a2', 'approval')];

  test('needs-you tabs count each kind; filtering keeps the server order (newest first)', () => {
    expect(Model.needsTabCounts(needs)).toEqual({ all: 4, approval: 2, question: 1, stopped: 1 });
    expect(Model.filterNeeds(needs, 'approval').map((n) => n.run_id)).toEqual(['a', 'a2']);
    expect(Model.filterNeeds(needs, 'all').map((n) => n.run_id)).toEqual(['a', 's', 'q', 'a2']);
    expect(Model.filterNeeds(needs, 'nonsense').map((n) => n.run_id)).toEqual(['a', 's', 'q', 'a2']);
  });

  test.each([
    ['approval', 'Matter Architect has work ready for your approval'],
    ['question', 'Matter Architect has a question for you'],
    ['stopped', 'Matter Architect stopped before finishing']
  ])('a %s reads as a sentence about the agent', (attention, sentence) => {
    expect(Model.needSentence(item('x', attention))).toBe(sentence);
  });

  test('an item with no agent name still reads', () => {
    expect(Model.needSentence(item('x', 'question', { agent_name: null }))).toBe('An agent has a question for you');
  });

  test('working now names the agent, the task and the step it is on', () => {
    expect(Model.workingLine(item('w', null, { status: 'running', activity: 'draft_engagement_letter' })))
      .toEqual({ who: 'Matter Architect', what: 'Run w', step: 'Draft engagement letter' });
    expect(Model.workingLine(item('w', null, { status: 'queued', activity: null, title: null })))
      .toEqual({ who: 'Matter Architect', what: 'a task', step: 'Waiting to start' });
  });

  test('counts read as at least when the server capped its read', () => {
    expect(Model.countLabel(3, false)).toBe('3');
    expect(Model.countLabel(200, true)).toBe('200+');
    expect(Model.countLabel(undefined, false)).toBe('0');
  });
});
