'use strict';

/**
 * The custom objects client against the backend's own code: the bodies the
 * admin editor builds pass the backend's type schemas and change rules, the
 * routes the client calls are mounted, the matter tab, forms and events the
 * client relies on are the backend's names. The backend is LANA_BACKEND_DIR
 * when set, else a sibling checkout (tests/fixtures/backend-checkout.js).
 */

const { findBackend } = require('../fixtures/backend-checkout.js');
const C = require('../../src/js/shared/custom-objects.js');

const MODELS = 'src/services/custom-objects/custom-object-type.models.js';
const CONTRACT = 'src/shared/contracts/custom-objects.contract.js';
const EVENTS = 'src/shared/constants/event-types.js';
const TEMPLATE = 'src/domains/legal/object-types/payment.object-type.json';
const INDEX = 'src/index.js';
const ATTACH_ROUTES = 'src/services/processor/custom-objects/custom-object-attachments.routes.js';

const checkout = findBackend([MODELS, CONTRACT, EVENTS, TEMPLATE, INDEX, ATTACH_ROUTES]);
const describeBackend = checkout.describe;

describeBackend('custom objects client against the backend', () => {
  const fs = require('fs');
  let models; let contract; let events; let template;
  beforeAll(() => {
    models = checkout.require(MODELS);
    contract = checkout.require(CONTRACT);
    events = checkout.require(EVENTS);
    template = checkout.require(TEMPLATE);
  });

  test('a new type from the editor passes the backend create schema and type rules', () => {
    const draft = C.blankDraft();
    draft.label = 'Retainer'; draft.label_plural = 'Retainers';
    draft.fields = [{ ...C.blankField(), label: 'Amount', kind: 'currency' }, { ...C.blankField(), label: 'Status', kind: 'select', choices: [{ key: '', label: 'Open' }, { key: '', label: 'Closed' }] }];
    const body = C.bodyFromDraft(draft);
    const parsed = models.createTypeBodySchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(models.typeProblems({ fields: parsed.data.fields, policy: body.policy })).toEqual([]);
  });

  test('an edit of the seeded Payment passes the backend update schema and change rules', () => {
    const stored = { id: 't1', version: 2, is_protected: true, ...template };
    const draft = C.draftFromType(stored);
    const method = draft.fields.find((field) => field.key === 'method');
    // Keep Check (renamed), add Zelle, drop the rest (retired).
    method.choices = [{ key: 'check', label: 'Paper check' }, { key: '', label: 'Zelle' }];
    const status = draft.fields.find((field) => field.key === 'status');
    status.choices = status.choices.filter((choice) => ['due', 'paid'].includes(choice.key));
    const body = C.bodyFromDraft(draft);
    const parsed = models.updateTypeBodySchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect([...models.typeProblems({ fields: parsed.data.fields, policy: parsed.data.policy }),
      ...models.typeChangeProblems(template.fields, parsed.data.fields)]).toEqual([]);
  });

  test('the field kinds and policy rules the editor offers are the backend ones', () => {
    const backendKinds = checkout.require('src/services/matter-fields/matter-field-types.js').FIELD_TYPES;
    expect(C.FIELD_KINDS.map((kind) => kind.value).sort()).toEqual([...backendKinds].sort());
    expect(C.POLICY_RULES.map((rule) => rule.value)).toEqual([...contract.RECORD_POLICY_RULES]);
  });

  test('routes, tab prefix and event names the client uses exist', () => {
    const index = fs.readFileSync(checkout.path(INDEX), 'utf8');
    expect(index).toContain("app.use('/api/v1/custom-object-types'");
    expect(index).toContain("app.use('/api/v1/matters', customObjectMatterTypeRoutes)");
    expect(fs.readFileSync(checkout.path(ATTACH_ROUTES), 'utf8')).toContain("'/:matter_id/object-types/:type_id'");
    expect(contract.OBJECT_TAB_PREFIX).toBe('object-');
    expect([events.CUSTOM_OBJECT_RECORD_CREATED, events.CUSTOM_OBJECT_RECORD_UPDATED, events.CUSTOM_OBJECT_RECORD_DELETED])
      .toEqual(['custom_object.record_created', 'custom_object.record_updated', 'custom_object.record_deleted']);
  });
});
