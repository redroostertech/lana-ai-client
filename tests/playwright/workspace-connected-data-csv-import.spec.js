'use strict';

const { test, expect } = require('@playwright/test');

const WORKSPACE_ID = 'matter-csv-import-e2e';
const WORKSPACE_UUID = '11111111-2222-4333-8444-555555555555';
const IMPORT_JOB_ID = '22222222-3333-4444-8555-666666666666';
const VALIDATING_IMPORT_JOB_ID = '33333333-4444-4555-8666-777777777777';
const CSV_BUFFER = Buffer.from([
  'Name,Email,Source,Status',
  'Avery Stone,avery@example.test,CSV Intake,Lead',
  'Blake Chen,blake@example.test,CSV Intake,Client',
  'Casey Rivera,casey@example.test,CSV Intake,Duplicate',
].join('\n'));

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function installMockSession(page) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'workspace-csv-import-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'user-csv-import',
      organization_id: 'org-csv-import',
      role: 'member',
    }));
    const hideLoader = () => {
      if (document.getElementById('workspace-csv-import-test-style')) return;
      const root = document.documentElement || document.head;
      if (!root) return;
      const style = document.createElement('style');
      style.id = 'workspace-csv-import-test-style';
      style.textContent = 'lex-loader { display: none !important; }';
      root.appendChild(style);
    };
    hideLoader();
    document.addEventListener('DOMContentLoaded', hideLoader, { once: true });
  });
  await page.route('**/js/config.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({ response, body: body + '\nwindow.LanaConfig.API_BASE_URL = "";\n' });
  });
}

function connectedDataListResponse() {
  return {
    data: [{
      id: 'existing-row-1',
      external_id: 'EXISTING-1',
      entity_type: 'contact',
      connector_id: 'manual',
      raw_data: {
        name: 'Existing Contact',
        email: 'existing@example.test',
        status: 'Client',
      },
      synced_at: '2026-08-25T12:00:00.000Z',
      annotation_count: 0,
    }],
    pagination: { page: 1, limit: 50, total: 1 },
    filters: {
      entity_types: [{ entity_type: 'contact', count: 1 }],
      connectors: [{ connector_id: 'manual', count: 1 }],
    },
  };
}

function workspaceMatterResponse() {
  return {
    id: WORKSPACE_UUID,
    matter_id: WORKSPACE_ID,
    matter_name: 'CSV Intake Workspace',
    name: 'CSV Intake Workspace',
    client_name: 'Growth Team',
    status: 'active',
    matter_type: 'workspace',
    metadata: { purpose: 'event_lead_capture' },
    contacts: [],
    notes: [],
    tasks: [],
  };
}

function previewResponse(mappingOverride) {
  const columns = ['Name', 'Email', 'Source', 'Status'];
  const sampleRows = [
    { Name: 'Avery Stone', Email: 'avery@example.test', Source: 'CSV Intake', Status: 'Lead' },
    { Name: 'Blake Chen', Email: 'blake@example.test', Source: 'CSV Intake', Status: 'Client' },
    { Name: 'Casey Rivera', Email: 'casey@example.test', Source: 'CSV Intake', Status: 'Duplicate' },
  ];
  const mapping = mappingOverride || {
    entityType: 'lead',
    mappings: [
      { sourceColumn: 'Name', targetField: 'name', targetPath: 'name', status: 'mapped', confidence: 0.98 },
      { sourceColumn: 'Email', targetField: 'email', targetPath: 'email', status: 'mapped', confidence: 0.99 },
      { sourceColumn: 'Source', targetField: 'lead_source', targetPath: 'lead_source', status: 'mapped', confidence: 0.82 },
      { sourceColumn: 'Status', targetField: 'status', targetPath: 'status', status: 'mapped', confidence: 0.74 },
    ],
  };
  return {
    import_session: {
      id: IMPORT_JOB_ID,
      status: 'mapping',
      source_name: 'Playwright CSV Intake',
      target_entity_type: 'lead',
      mapping_state: mapping,
      upload_metadata: {
        headers: columns,
        sample_rows: sampleRows,
        total_rows: 3,
        column_count: 4,
        detected_delimiter: ',',
      },
    },
    mapping,
    preview: {
      headers: columns,
      sample_rows: sampleRows,
      total_rows: 3,
      column_count: 4,
      detected_delimiter: ',',
    },
  };
}

function mappedEntityForSampleRow(sampleRow, mapping) {
  const mapped = {};
  for (const row of mapping.mappings || []) {
    const source = row.sourceColumn || row.source_column;
    const value = sampleRow[source];
    if (value === undefined || value === null || value === '') continue;
    const targetField = row.targetField || row.target_field || '';
    const targetPath = row.targetPath || row.target_path || '';
    const isCustomField = row.status === 'custom_field' ||
      targetField === 'custom_fields' ||
      targetPath === 'custom_fields' ||
      targetPath.startsWith('custom_fields.');
    if (isCustomField) {
      const key = row.customFieldKey || row.custom_field_key ||
        (targetPath.startsWith('custom_fields.') ? targetPath.slice('custom_fields.'.length) : '') ||
        source.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      mapped.custom_fields = mapped.custom_fields || {};
      mapped.custom_fields[key] = value;
    } else if (row.status === 'mapped' && targetField) {
      mapped[targetField] = value;
    }
  }
  return mapped;
}

function validationResponse(mappingOverride) {
  const uploaded = previewResponse();
  const mapping = mappingOverride || uploaded.mapping;
  const outcomes = uploaded.preview.sample_rows.map((sampleRow, index) => ({
    rowId: `row-${index + 1}`,
    rowNumber: index + 1,
    status: 'valid',
    mappedEntity: mappedEntityForSampleRow(sampleRow, mapping),
  }));
  return {
    import_session: {
      ...uploaded.import_session,
      status: 'validated',
      target_entity_type: mapping.entityType || mapping.entity_type || 'lead',
      mapping_state: mapping,
      valid_rows: 3,
      invalid_rows: 0,
      metadata: {
        validation_summary: {
          totalRows: 3,
          validRows: 3,
          invalidRows: 0,
        },
      },
    },
    summary: {
      totalRows: 3,
      validRows: 3,
      invalidRows: 0,
    },
    outcomes,
  };
}

function duplicateValidationResponse(mappingOverride) {
  const response = validationResponse(mappingOverride);
  response.summary = {
    totalRows: 3,
    validRows: 1,
    importableRows: 1,
    invalidRows: 0,
    duplicateRows: 2,
  };
  response.import_session.metadata.validation_summary = {
    totalRows: 3,
    validRows: 1,
    importableRows: 1,
    invalidRows: 0,
    duplicateRows: 2,
  };
  response.outcomes = response.outcomes.map((row) => {
    if (row.rowId === 'row-2') {
      return {
        ...row,
        status: 'likely_duplicate',
        duplicate_metadata: {
          match_name: 'Blake Chen',
          matched_on: 'email',
          confidence: 0.94,
          reason: 'Email matches an existing lead',
        },
      };
    }
    if (row.rowId === 'row-3') {
      return {
        ...row,
        status: 'valid',
        duplicateMetadata: {
          outcome: 'needs_review',
          matchName: 'Casey Rivera',
          matchReason: 'Similar name and company',
          matchScore: 88,
        },
      };
    }
    return row;
  });
  return response;
}

function rowsResponse(mappingOverride) {
  const validation = validationResponse(mappingOverride);
  return {
    data: {
      data: validation.outcomes.map((row) => {
        const promotedEntity = row.rowId === 'row-1'
          ? {
              entityType: 'lead',
              entityId: 'lead-1',
              displayName: 'Avery Stone',
              canonicalUrl: 'workspace-details.html?id=lead-workspace&tab=summary',
            }
          : null;
        return {
          id: row.rowId,
          row_number: row.rowNumber,
          validation_status: row.status,
          status: row.rowId === 'row-3' ? 'skipped' : 'promoted',
          promotion_action: row.rowId === 'row-2' ? 'update' : (row.rowId === 'row-3' ? 'skip' : 'create'),
          promotion_status: row.rowId === 'row-2' ? 'updated' : (row.rowId === 'row-3' ? 'skipped' : 'created'),
          mapped_data: row.mappedEntity,
          raw_data: { row_data: row.mappedEntity },
          validation_errors: [],
          promoted_entity: promotedEntity,
          entity: promotedEntity,
        };
      }),
      pagination: { limit: 100, offset: 0, total: 3 },
    },
  };
}

function completedImportJob() {
  const uploaded = previewResponse();
  return {
    ...uploaded.import_session,
    status: 'completed',
    updated_at: '2026-08-25T14:30:00.000Z',
    metadata: {
      validation_summary: {
        totalRows: 3,
        validRows: 3,
        invalidRows: 0,
      },
      promotion_summary: {
        totalRows: 3,
        promotedRows: 2,
        createdRows: 1,
        updatedRows: 1,
        failedRows: 0,
        skippedRows: 1,
      },
    },
  };
}

function validatingImportJob() {
  const uploaded = previewResponse();
  return {
    ...uploaded.import_session,
    id: VALIDATING_IMPORT_JOB_ID,
    status: 'validating',
    source_name: 'Validating CSV Intake',
    updated_at: '2026-08-25T15:30:00.000Z',
    metadata: {
      validation_summary: {
        totalRows: 3,
        validRows: 3,
        invalidRows: 0,
      },
    },
  };
}

function importHistoryResponse() {
  return {
    data: [completedImportJob(), validatingImportJob()],
    pagination: { limit: 5, offset: 0, total: 2 },
  };
}

function importInsightsResponse() {
  return {
    workspace_id: WORKSPACE_ID,
    workspace_code: 'CSV-INTAKE',
    workspace_name: 'CSV Intake Workspace',
    summary: {
      session_count: 2,
      total_rows: 8,
      promoted_rows: 4,
      duplicate_rows: 2,
      invalid_rows: 1,
      failed_rows: 0,
    },
    sessions_by_status: {
      completed: 1,
      validated: 1,
    },
    rows_by_status: {
      promoted: 4,
      skipped: 2,
      invalid: 1,
    },
    sessions_by_entity_type: [
      { entity_type: 'lead', session_count: 2, promoted_rows: 4 },
      { entity_type: 'campaign', session_count: 1, promoted_rows: 1 },
      { entity_type: 'opportunity', session_count: 1, promoted_rows: 2 },
      { entity_type: 'task', session_count: 1, promoted_rows: 1 },
    ],
    rows_by_entity_type: [
      { entity_type: 'lead', row_count: 4, promoted_rows: 4 },
      { entity_type: 'campaign', row_count: 1, promoted_rows: 1 },
      { entity_type: 'opportunity', row_count: 2, promoted_rows: 2 },
      { entity_type: 'task', row_count: 1, promoted_rows: 1 },
    ],
    recent_sessions: [
      {
        id: IMPORT_JOB_ID,
        source_name: 'Event Leads Rollup',
        total_rows: 8,
        promoted_rows: 4,
        updated_at: '2026-08-25T12:00:00Z',
      },
    ],
    promoted_entities: [
      { entity_type: 'lead', entity_id: 'lead-1', import_session_id: IMPORT_JOB_ID },
    ],
  };
}

function growthEngineRollupResponse() {
  const insights = importInsightsResponse();
  return {
    workspace: {
      id: WORKSPACE_UUID,
      code: WORKSPACE_ID,
      name: 'CSV Intake Workspace',
      type: 'workspace',
    },
    generated_at: '2026-08-25T12:15:00.000Z',
    counts: {
      canonical: {
        by_entity_type: [
          { entity_type: 'lead', count: 4 },
          { entity_type: 'campaign', count: 1 },
          { entity_type: 'opportunity', count: 2 },
          { entity_type: 'task', count: 1 },
        ],
        by_entity_status: [],
      },
      imports: {
        summary: insights.summary,
        sessions_by_status: insights.sessions_by_status,
        rows_by_status: insights.rows_by_status,
        rows_by_entity_type: insights.rows_by_entity_type,
      },
    },
    recent: {
      entities: [],
      imports: insights.recent_sessions,
      promoted_entities: insights.promoted_entities,
    },
    signals: {
      tasks: [],
      opportunities: [],
      activity: [],
    },
  };
}

function promotionResponse(approvedRowIds = ['row-1', 'row-2', 'row-3']) {
  const uploaded = previewResponse();
  const row2Approved = approvedRowIds.includes('row-2');
  const promotedRows = row2Approved ? 2 : 1;
  const updatedRows = row2Approved ? 1 : 0;
  const skippedRows = row2Approved ? 1 : 2;
  return {
    import_session: {
      ...uploaded.import_session,
      status: 'completed',
      promoted_rows: promotedRows,
      failed_rows: 0,
      skipped_rows: skippedRows,
      metadata: {
        promotion_summary: {
          totalRows: 3,
          promotedRows,
          createdRows: 1,
          updatedRows,
          failedRows: 0,
          skippedRows,
        },
      },
    },
    summary: {
      totalRows: 3,
      promotedRows,
      createdRows: 1,
      updatedRows,
      failedRows: 0,
      skippedRows,
    },
    results: [
      {
        rowId: 'row-1',
        rowNumber: 1,
        status: 'created',
        entity: {
          entityType: 'lead',
          entityId: 'lead-1',
          displayName: 'Avery Stone',
          canonicalUrl: 'workspace-details.html?id=lead-workspace&tab=summary',
        },
      },
      {
        rowId: 'row-2',
        rowNumber: 2,
        status: row2Approved ? 'updated' : 'skipped_unapproved',
        reason: row2Approved ? '' : 'Not selected for import',
        entity: row2Approved ? {
          entityType: 'lead',
          entityId: 'lead-2',
          displayName: 'Blake Chen',
        } : undefined,
      },
      {
        rowId: 'row-3',
        rowNumber: 3,
        status: 'skipped',
        reason: 'Matched an existing canonical lead',
        entity: {
          entityType: 'lead',
          entityId: 'lead-3',
          displayName: 'Casey Rivera',
          canonicalUrl: 'javascript:alert("bad-link")',
        },
      },
    ],
  };
}

async function installWorkspaceDataApiStubs(page, calls, options = {}) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.toLowerCase();
    const method = request.method();

    if (method === 'GET' && pathname === '/api/v1/auth/me') {
      return json(route, {
        user: {
          id: 'user-csv-import',
          organization_id: 'org-csv-import',
          role: 'member',
        },
      });
    }

    if (method === 'GET' && pathname === `/api/v1/matters/${WORKSPACE_ID}`) {
      const matter = workspaceMatterResponse();
      if (url.searchParams.get('full_details') === 'true') {
        return json(route, { success: true, matter, tasks: [], notes: [], contacts: [] });
      }
      return json(route, {
        id: matter.id,
        matter_id: matter.matter_id,
        matter_name: matter.matter_name,
        name: matter.name,
      });
    }

    if (method === 'GET' && pathname === `/api/v1/matters/${WORKSPACE_ID}/permissions`) {
      return json(route, { permissions: [] });
    }

    if (method === 'GET' && pathname === `/api/v1/activity/matter/${WORKSPACE_ID}`) {
      return json(route, { activities: [], pagination: {} });
    }

    if (method === 'GET' && pathname === `/api/v1/matters/${WORKSPACE_ID}/tasks`) {
      return json(route, { tasks: [], total_count: 0 });
    }

    if (method === 'GET' && pathname === `/api/v1/matters/${WORKSPACE_ID}/comments`) {
      return json(route, { data: [], pagination: { total: 0 } });
    }

    if (method === 'GET' && pathname === `/api/v1/matters/${WORKSPACE_ID}/workspace-state`) {
      return json(route, { data: { summary: {}, tasks: [] } });
    }

    if (method === 'GET' && pathname === `/api/v1/matters/${WORKSPACE_ID}/connector-data`) {
      return json(route, {
        data: {
          lead: [{
            connector_name: 'CSV Import',
            entity_type: 'lead',
            external_id: 'lead-1',
            data: { name: 'Avery Stone' },
          }],
        },
      });
    }

    if (method === 'GET' && pathname === `/api/v1/matters/${WORKSPACE_ID}/growth-engine/rollup`) {
      calls.growthRollup = {
        pathname: url.pathname,
        search: url.search,
      };
      return json(route, options.growthRollupResponse !== undefined
        ? options.growthRollupResponse
        : { data: growthEngineRollupResponse() },
      options.growthRollupStatus || 200);
    }

    if (method === 'GET' && pathname === `/api/v1/matters/${WORKSPACE_ID}/connected-data`) {
      calls.connectedDataRequests = calls.connectedDataRequests || [];
      calls.connectedDataRequests.push({
        pathname: url.pathname,
        search: url.search,
      });
      return json(route, connectedDataListResponse());
    }

    if (method === 'GET' && pathname === `/api/v1/matters/${WORKSPACE_ID}/imports/insights`) {
      calls.importInsights = {
        pathname: url.pathname,
        search: url.search,
      };
      return json(route, options.importInsightsResponse !== undefined
        ? options.importInsightsResponse
        : { data: importInsightsResponse() },
      options.importInsightsStatus || 200);
    }

    if (method === 'GET' && pathname === `/api/v1/matters/${WORKSPACE_ID}/imports`) {
      calls.importHistory = {
        pathname: url.pathname,
        search: url.search,
      };
      return json(route, { data: importHistoryResponse() });
    }

    if (method === 'GET' && pathname === `/api/v1/matters/${WORKSPACE_ID}/imports/${IMPORT_JOB_ID}`) {
      calls.importGet = {
        pathname: url.pathname,
      };
      return json(route, { data: completedImportJob() });
    }

    if (method === 'GET' && pathname === `/api/v1/matters/${WORKSPACE_ID}/imports/${VALIDATING_IMPORT_JOB_ID}`) {
      calls.validatingImportGet = {
        pathname: url.pathname,
      };
      return json(route, { data: validatingImportJob() });
    }

    if (method === 'GET' && pathname.endsWith('/connected-data/annotations/total-count')) {
      return json(route, { data: { total: 0 } });
    }

    if (method === 'GET' && pathname.endsWith('/connected-data/change-summary')) {
      return json(route, { data: { total: 0 } });
    }

    if (method === 'GET' && pathname.includes('/conversations')) {
      return json(route, { conversations: [], data: [] });
    }

    if (method === 'POST' && pathname === `/api/v1/matters/${WORKSPACE_ID}/imports/csv`) {
      calls.preview = {
        pathname: url.pathname,
        contentType: request.headers()['content-type'] || '',
        body: request.postData() || '',
      };
      return json(route, previewResponse(options.previewMapping), 201);
    }

    if (['POST', 'PUT', 'PATCH'].includes(method) && pathname === `/api/v1/matters/${WORKSPACE_ID}/imports/${IMPORT_JOB_ID}/mapping`) {
      const body = JSON.parse(request.postData() || '{}');
      const savedMapping = body.mapping || previewResponse().mapping;
      calls.savedMapping = savedMapping;
      calls.mapping = {
        pathname: url.pathname,
        body: request.postData() || '',
      };
      const returnedMapping = options.stripPolicyFromMappingResponse
        ? {
            ...savedMapping,
            customFieldPolicy: undefined,
            custom_field_policy: undefined,
            customFieldApprovalPolicy: undefined,
            custom_field_approval_policy: undefined,
          }
        : savedMapping;
      return json(route, {
        data: {
          ...previewResponse().import_session,
          target_entity_type: savedMapping.entityType || savedMapping.entity_type || 'lead',
          mapping_state: returnedMapping,
        },
      });
    }

    if (method === 'POST' && pathname === `/api/v1/matters/${WORKSPACE_ID}/imports/${IMPORT_JOB_ID}/validate`) {
      calls.validation = {
        pathname: url.pathname,
        body: request.postData() || '',
      };
      const response = options.validationResponse
        ? options.validationResponse(calls.savedMapping)
        : validationResponse(calls.savedMapping);
      if (calls.savedMapping) {
        response.import_session = {
          ...response.import_session,
          target_entity_type: calls.savedMapping.entityType || calls.savedMapping.entity_type || 'lead',
          mapping_state: calls.savedMapping,
        };
      }
      return json(route, response);
    }

    if (method === 'GET' && pathname === `/api/v1/matters/${WORKSPACE_ID}/imports/${IMPORT_JOB_ID}/rows`) {
      calls.rows = {
        pathname: url.pathname,
        search: url.search,
      };
      return json(route, rowsResponse(calls.savedMapping));
    }

    if (method === 'GET' && pathname === `/api/v1/matters/${WORKSPACE_ID}/imports/${VALIDATING_IMPORT_JOB_ID}/rows`) {
      calls.validatingRows = {
        pathname: url.pathname,
        search: url.search,
      };
      return json(route, rowsResponse(calls.savedMapping));
    }

    if (method === 'POST' && pathname === `/api/v1/matters/${WORKSPACE_ID}/imports/${IMPORT_JOB_ID}/promote`) {
      calls.promotion = {
        pathname: url.pathname,
        body: request.postData() || '',
      };
      const body = JSON.parse(calls.promotion.body || '{}');
      const approvedRowIds = body.approved_row_ids || body.approvedRowIds || body.row_ids || body.rowIds;
      return json(route, promotionResponse(Array.isArray(approvedRowIds) ? approvedRowIds : undefined));
    }

    return json(route, {});
  });
}

async function firstVisible(page, selectors, label) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await expect(locator, label).toBeVisible({ timeout: 1500 });
        return locator;
      } catch (_error) {
        // Continue checking alternate selectors before producing a useful error.
      }
    }
  }
  throw new Error(`${label} was not found. Expected one of: ${selectors.join(', ')}`);
}

async function clickControl(page, selectors, label) {
  const locator = await firstVisible(page, selectors, label);
  await locator.click();
  return locator;
}

async function setControlValue(locator, value) {
  const tagName = await locator.evaluate((node) => node.tagName.toLowerCase());
  if (tagName === 'select') {
    await locator.selectOption(value);
    return;
  }
  if (tagName === 'input' || tagName === 'textarea') {
    await locator.fill(value);
    return;
  }
  await locator.evaluate((node, nextValue) => {
    node.value = nextValue;
    node.setAttribute('value', nextValue);
    node.dispatchEvent(new CustomEvent('lex-change', {
      bubbles: true,
      detail: { value: nextValue },
    }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function setMapping(page, sourceColumn, targetField) {
  const row = page.locator('#wsImportMappingRows tr').filter({
    has: page.locator(`.ws-import-column-name:text-is("${sourceColumn}")`),
  }).first();

  await expect(row, `mapping row for ${sourceColumn}`).toBeVisible();
  const control = row.locator([
    '[data-testid="workspace-csv-mapping-target"]',
    'lex-select',
    'select',
    'input',
  ].join(', ')).first();
  await expect(control, `mapping control for ${sourceColumn}`).toBeVisible();
  const tagName = await control.evaluate((node) => node.tagName.toLowerCase());
  if (tagName === 'select') {
    const values = await control.locator('option').evaluateAll((options) => options.map((option) => option.value));
    await control.selectOption(values.includes(targetField) ? targetField : `field:${targetField}`);
    return;
  }
  await setControlValue(control, targetField);
}

async function setCustomMapping(page, sourceColumn, customFieldKey) {
  await setMapping(page, sourceColumn, 'custom');
  const row = page.locator('#wsImportMappingRows tr').filter({
    has: page.locator(`.ws-import-column-name:text-is("${sourceColumn}")`),
  }).first();
  const customKey = row.locator('.ws-import-custom-key').first();
  await expect(customKey, `custom key input for ${sourceColumn}`).toBeVisible();
  await customKey.fill(customFieldKey);
}

async function runCsvImportToValidation(page, calls, options = {}) {
  await clickControl(page, [
    '[data-testid="workspace-csv-import-open"]',
    '#wsDataImportBtn',
    'lex-btn:has-text("Import CSV")',
    'button:has-text("Import CSV")',
  ], 'CSV import trigger');

  const fileInput = await firstVisible(page, [
    '#wsImportFile',
    'input[type="file"][accept*="csv"]',
    'input[type="file"][accept*=".csv"]',
  ], 'CSV file input');
  await fileInput.setInputFiles({
    name: 'workspace-contacts.csv',
    mimeType: 'text/csv',
    buffer: CSV_BUFFER,
  });

  try {
    await expect.poll(() => calls.preview, { timeout: 1000 }).not.toBeUndefined();
  } catch (_error) {
    await clickControl(page, ['#wsImportUploadAction', 'lex-btn:has-text("Upload and Infer")'], 'CSV upload/infer control');
  }

  await expect.poll(() => calls.preview).not.toBeUndefined();
  await firstVisible(page, ['#wsImportMappingRows', '.ws-import-map-table'], 'CSV mapping step');

  if (options.entityType) {
    await page.locator('#wsImportEntityType').selectOption(options.entityType);
  }

  const mappings = options.mappings || {
    Name: 'name',
    Email: 'email',
    Source: 'lead_source',
    Status: 'status',
  };
  for (const [sourceColumn, targetField] of Object.entries(mappings)) {
    await setMapping(page, sourceColumn, targetField);
  }

  await clickControl(page, ['#wsImportValidateAction', 'lex-btn:has-text("Validate")'], 'CSV validation control');
  await expect.poll(() => calls.validation).not.toBeUndefined();
  await expect(page.locator('[data-testid="workspace-csv-import-selection-summary"]'))
    .toContainText(options.selectionSummary || /3 of 3 valid rows selected/i);
}

async function openPromotionStep(page) {
  await clickControl(page, ['#wsImportPromoteAction', 'lex-btn:has-text("Review Promotion")'], 'CSV promotion review control');
  await expect(page.locator('[data-step-pane="promotion"]')).toHaveClass(/is-active/);
  return page.locator('[data-testid="workspace-csv-import-promotion-preview"]');
}

async function runPromotionFromStep(page) {
  return clickControl(page, [
    '[data-testid="workspace-csv-import-run-promotion"]',
    '#wsImportRunPromotion',
    'lex-btn:has-text("Promote Import")',
  ], 'CSV promotion run control');
}

async function expectLexControl(locator, expectedTag, label) {
  const isLex = await locator.evaluate((node, tag) => {
    const tagName = tag.toLowerCase();
    return node.tagName.toLowerCase() === tagName || Boolean(node.closest(tagName));
  }, expectedTag);
  expect(isLex, `${label} should use ${expectedTag}`).toBe(true);
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(0, root.scrollWidth - window.innerWidth);
  });
  expect(overflow, 'page should not have obvious horizontal overflow').toBeLessThanOrEqual(8);
}

async function waitForVisualReady(page) {
  await page.waitForFunction(() => !document.querySelector('[lex-redacted]'));
  await page.locator('lex-loader, #lex-loader-overlay').evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  await page.waitForTimeout(150);
}

test.describe('Workspace connected data CSV import', () => {
  test('auto-opens the CSV import wizard from a routed workspace data entry point', async ({ page }, testInfo) => {
    const calls = {};

    await installMockSession(page);
    await installWorkspaceDataApiStubs(page, calls);

    await page.goto(`/workspace-data.html?id=${WORKSPACE_ID}&import=csv`);

    await expect(page.locator('#wsDataImportModal')).toBeVisible();
    await expect(page.locator('[data-step-pane="upload"]')).toHaveClass(/is-active/);
    await expect(page.locator('[data-import-wizard]')).toBeVisible();
    await expect(page.locator('[data-import-wizard]')).toContainText(/Upload CSV/i);
    await expect(page.locator('[data-import-wizard]')).toContainText(/Choose a CSV file/i);
    await expect(page.locator('#wsImportFile')).toBeAttached();
    await expect(page.locator('#wsImportUploadAction')).toBeVisible();
    await expect(page.locator('[data-testid="workspace-csv-import-history"]')).toBeVisible();
    await waitForVisualReady(page);

    const screenshot = await page.locator('[data-import-wizard]').screenshot({
      path: testInfo.outputPath('workspace-connected-data-csv-import-routed-open.png'),
    });
    expect(screenshot.length, 'routed CSV import screenshot should include the open wizard').toBeGreaterThan(3000);
  });

  test('hydrates routed connected-data filters into controls and API query', async ({ page }) => {
    const calls = {};

    await installMockSession(page);
    await installWorkspaceDataApiStubs(page, calls);

    await page.goto(`/workspace-data.html?id=${WORKSPACE_ID}&entity_type=lead&connector_id=manual&search=Avery&page=2`);

    await expect.poll(() => calls.connectedDataRequests && calls.connectedDataRequests[0], 'connected data should load')
      .not.toBeUndefined();
    const requestUrl = new URL(`http://lana.test${calls.connectedDataRequests[0].search}`);
    expect(requestUrl.searchParams.get('entity_type')).toBe('lead');
    expect(requestUrl.searchParams.get('connector_id')).toBe('manual');
    expect(requestUrl.searchParams.get('search')).toBe('Avery');
    expect(requestUrl.searchParams.get('page')).toBe('2');
    await expect(page.locator('#wsDataSearch')).toHaveValue('Avery');
    await expect(page.locator('#wsDataEntityFilter')).toHaveAttribute('value', 'lead');
    await expect(page.locator('#wsDataConnectorFilter')).toHaveAttribute('value', 'manual');
    await expect(page.locator('#wsDataEntityFilter')).toHaveAttribute('options', /"value":"lead"/);
  });

  test('routes Workspace Summary connected-data import action into the CSV wizard', async ({ page }, testInfo) => {
    const calls = {};

    await installMockSession(page);
    await installWorkspaceDataApiStubs(page, calls);

    await page.goto(`/workspace-details.html?id=${WORKSPACE_ID}`);

    const connectedDataCard = page.locator('#connectedDataCard');
    await expect(connectedDataCard).toBeVisible();
    await expect(connectedDataCard).toContainText(/Connected Data/i);
    await expect(connectedDataCard).toContainText(/Avery Stone/i);
    const growthEngine = page.locator('[data-testid="workspace-summary-growth-engine"]');
    await expect(growthEngine).toBeVisible();
    await expect(growthEngine).toContainText(/Growth Engine/i);
    await expect(growthEngine).toContainText(/8 imported records/i);
    await expect(growthEngine).toContainText(/Prospects\s*4/i);
    await expect(growthEngine).toContainText(/Campaigns\s*1/i);
    await expect(growthEngine).toContainText(/Opportunities\s*2/i);
    await expect(growthEngine).toContainText(/Tasks\s*1/i);
    await expect(growthEngine).toContainText(/Source runs\s*2/i);
    await expect(growthEngine).toContainText(/Needs review\s*3/i);
    await expect(growthEngine).toContainText(/Latest source:\s*Event Leads Rollup/i);
    await expect(growthEngine.locator('a[data-growth-entity="lead"]'))
      .toHaveAttribute('href', /workspace-data\.html\?id=matter-csv-import-e2e&entity_type=lead/);
    await expect(growthEngine.locator('a[data-growth-entity="opportunity"]'))
      .toHaveAttribute('href', /workspace-data\.html\?id=matter-csv-import-e2e&entity_type=opportunity/);
    await expect(growthEngine).not.toContainText(/\{"summary"|"promoted_entities"/i);
    await expect.poll(() => calls.growthRollup, 'workspace summary should load Growth Engine rollup')
      .not.toBeUndefined();
    expect(calls.growthRollup.pathname).toBe(`/api/v1/matters/${WORKSPACE_ID}/growth-engine/rollup`);
    const importAction = page.locator('[data-testid="workspace-summary-import-csv"]');
    await expect(importAction).toBeVisible();
    await expect(importAction).toContainText(/Import CSV/i);
    await waitForVisualReady(page);

    const growthScreenshot = await growthEngine.screenshot({
      path: testInfo.outputPath('workspace-summary-growth-engine.png'),
    });
    expect(growthScreenshot.length, 'summary growth engine screenshot should include rendered rollup').toBeGreaterThan(2000);

    const summaryScreenshot = await connectedDataCard.screenshot({
      path: testInfo.outputPath('workspace-summary-connected-data-import-action.png'),
    });
    expect(summaryScreenshot.length, 'summary connected data card screenshot should include rendered content').toBeGreaterThan(800);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/workspace-details.html?id=${WORKSPACE_ID}`);
    const mobileConnectedDataCard = page.locator('#connectedDataCard');
    const mobileImportAction = page.locator('[data-testid="workspace-summary-import-csv"]');
    await expect(mobileConnectedDataCard).toBeVisible();
    await expect(mobileImportAction).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await waitForVisualReady(page);
    const mobileSummaryScreenshot = await mobileConnectedDataCard.screenshot({
      path: testInfo.outputPath('workspace-summary-connected-data-import-action-mobile.png'),
    });
    expect(mobileSummaryScreenshot.length, 'mobile summary connected data card screenshot should include rendered content').toBeGreaterThan(800);

    await mobileImportAction.click();

    await expect(page).toHaveURL(new RegExp(`workspace-data\\.html\\?id=${WORKSPACE_ID}&import=csv`));
    await expect(page.locator('#wsDataImportModal')).toBeVisible();
    await expect(page.locator('[data-step-pane="upload"]')).toHaveClass(/is-active/);
  });

  test('falls back to import insights when the summary Growth Engine rollup is empty', async ({ page }) => {
    const calls = {};

    await installMockSession(page);
    await installWorkspaceDataApiStubs(page, calls, {
      growthRollupResponse: { data: null },
    });

    await page.goto(`/workspace-details.html?id=${WORKSPACE_ID}`);

    const growthEngine = page.locator('[data-testid="workspace-summary-growth-engine"]');
    await expect(growthEngine).toBeVisible();
    await expect(growthEngine).toContainText(/8 imported records/i);
    await expect(growthEngine).toContainText(/Latest source:\s*Event Leads Rollup/i);
    await expect.poll(() => calls.growthRollup, 'preferred Growth Engine rollup should be attempted first')
      .not.toBeUndefined();
    await expect.poll(() => calls.importInsights, 'summary should fall back to import insights when rollup is empty')
      .not.toBeUndefined();
  });

  test('renders recent CSV imports and reopens completed import results', async ({ page }, testInfo) => {
    const calls = {};

    await installMockSession(page);
    await installWorkspaceDataApiStubs(page, calls);

    await page.goto(`/workspace-data.html?id=${WORKSPACE_ID}`);

    const history = page.locator('[data-testid="workspace-csv-import-history"]');
    await expect(history).toBeVisible();
    const growthSummary = page.locator('[data-testid="workspace-import-growth-summary"]');
    await expect(growthSummary).toBeVisible();
    await expect(growthSummary).toHaveAttribute('data-rollup-source', 'rollup');
    await expect(growthSummary).toContainText(/Growth intake summary/i);
    await expect(growthSummary).toContainText(/Workspace rollup/i);
    await expect(growthSummary).toContainText(/Sources\s*2/i);
    await expect(growthSummary).toContainText(/Records\s*8/i);
    await expect(growthSummary).toContainText(/Ready\s*4/i);
    await expect(growthSummary).toContainText(/Needs review\s*3/i);
    await expect(growthSummary).toContainText(/Event Leads Rollup/i);
    await expect(history).toContainText(/Recent imports/i);
    await expect(history).toContainText(/Playwright CSV Intake/i);
    await expect(history).toContainText(/Validating CSV Intake/i);
    await expect(history).toContainText(/Completed/i);
    await expect(history).toContainText(/Validating/i);
    await expect(history).toContainText(/3 rows/i);
    await expect(history).toContainText(/2 imported/i);
    await expect(history).not.toContainText(/avery@example\.test/i);
    await expect.poll(() => calls.importHistory, 'history should load from the workspace imports API')
      .not.toBeUndefined();
    await expect.poll(() => calls.growthRollup, 'rollup should load from the workspace Growth Engine API')
      .not.toBeUndefined();
    expect(calls.importHistory.search).toContain('sortBy=updated_at');
    expect(calls.growthRollup.pathname).toBe(`/api/v1/matters/${WORKSPACE_ID}/growth-engine/rollup`);

    await waitForVisualReady(page);
    const growthScreenshot = await growthSummary.screenshot({
      path: testInfo.outputPath('workspace-import-growth-summary-rollup.png'),
    });
    expect(growthScreenshot.length, 'growth intake summary screenshot should include rollup content').toBeGreaterThan(5000);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(growthSummary).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const mobileGrowthScreenshot = await growthSummary.screenshot({
      path: testInfo.outputPath('workspace-import-growth-summary-rollup-mobile.png'),
    });
    expect(mobileGrowthScreenshot.length, 'mobile growth intake summary screenshot should include rollup content')
      .toBeGreaterThan(5000);
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.locator('[data-testid="workspace-csv-import-history-open"]').first().click();

    await expect.poll(() => calls.importGet, 'reopen should fetch the import job from the API')
      .not.toBeUndefined();
    await expect.poll(() => calls.rows, 'reopen should fetch row details for completed imports')
      .not.toBeUndefined();
    await expect(page.locator('#wsDataImportModal')).toBeVisible();
    await expect(page.locator('[data-step-pane="promotion"]')).toHaveClass(/is-active/);
    await expect(page.locator('#wsImportPromotionSummary')).toContainText(/Imported\s*2/i);
    await expect(page.locator('#wsImportPromotionSummary')).toContainText(/Created\s*1/i);
    await expect(page.locator('#wsImportPromotionSummary')).toContainText(/Updated\s*1/i);
    await expect(page.locator('#wsImportPromotionSummary')).toContainText(/Skipped\s*1/i);
    await expect(page.locator('#wsImportPromotionRows')).toContainText(/Avery Stone/i);
    await expect(page.locator('#wsImportPromotionRows a.ws-import-entity-link', { hasText: 'Avery Stone' }))
      .toHaveAttribute('href', /workspace-details\.html\?id=lead-workspace&tab=summary/);

    const screenshot = await page.screenshot({
      path: testInfo.outputPath('workspace-connected-data-csv-import-history-reopen.png'),
      fullPage: true,
    });
    expect(screenshot.length, 'history reopen screenshot should include rendered import result').toBeGreaterThan(50000);

    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await expect(history).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator('#wsImportCloseDone').click();
    await page.locator('[data-testid="workspace-csv-import-history-item"]', { hasText: 'Validating CSV Intake' })
      .locator('[data-testid="workspace-csv-import-history-open"]')
      .click();

    await expect.poll(() => calls.validatingImportGet, 'validating import reopen should fetch job details')
      .not.toBeUndefined();
    await expect.poll(() => calls.validatingRows, 'validating import reopen should fetch current rows')
      .not.toBeUndefined();
    await expect(page.locator('[data-step-pane="validation"]')).toHaveClass(/is-active/);
    await expect(page.locator('#wsImportValidationSummary')).toContainText(/Valid\s*3/i);
    await expect(page.locator('[data-testid="workspace-csv-import-selection-summary"]')).toContainText(/3 of 3 valid rows selected/i);
  });

  test('falls back to import history when workspace rollup and import insights are absent', async ({ page }) => {
    const calls = {};

    await installMockSession(page);
    await installWorkspaceDataApiStubs(page, calls, {
      growthRollupResponse: { data: null },
      importInsightsResponse: { data: null },
    });

    await page.goto(`/workspace-data.html?id=${WORKSPACE_ID}`);

    const growthSummary = page.locator('[data-testid="workspace-import-growth-summary"]');
    await expect(growthSummary).toBeVisible();
    await expect(growthSummary).toHaveAttribute('data-rollup-source', 'history');
    await expect(growthSummary).toContainText(/Growth intake summary/i);
    await expect(growthSummary).toContainText(/From recent import history/i);
    await expect(growthSummary).toContainText(/Sources\s*2/i);
    await expect(growthSummary).toContainText(/Records\s*6/i);
    await expect(growthSummary).toContainText(/Ready\s*2/i);
    await expect.poll(() => calls.growthRollup, 'Growth Engine rollup endpoint should be attempted before history fallback')
      .not.toBeUndefined();
    await expect.poll(() => calls.importInsights, 'import insights endpoint should be attempted before history fallback')
      .not.toBeUndefined();
    await expectNoHorizontalOverflow(page);
  });

  test('promotes all valid rows without sending a row allowlist when nothing is deselected', async ({ page }) => {
    const calls = {};

    await installMockSession(page);
    await installWorkspaceDataApiStubs(page, calls);

    await page.goto(`/workspace-data.html?id=${WORKSPACE_ID}`);
    await runCsvImportToValidation(page, calls);

    const importPlan = page.locator('[data-testid="workspace-csv-import-plan"]');
    await expect(importPlan).toBeVisible();
    await expect(importPlan).toContainText(/Import Plan/i);
    await expect(importPlan).toContainText(/Target entity\s*Lead/i);
    await expect(importPlan).toContainText(/Selected rows\s*3 of 3 importable/i);
    await expect(importPlan).toContainText(/Mapped columns\s*4 of 4/i);
    await expect(importPlan).toContainText(/Skipped rows\s*0/i);
    await expect(importPlan).toContainText(/Invalid rows\s*0/i);
    await expect(importPlan).toContainText(/No elevated risk reasons detected/i);
    await expect(importPlan).not.toContainText(/avery@example\.test|Blake Chen|\{"name"/i);

    const promoteControl = page.locator('#wsImportPromoteAction').first();
    await expect(promoteControl).toHaveAttribute('disabled', /.*/);
    await page.locator('[data-testid="workspace-csv-import-spot-check-confirmed"]').click();
    await expect(promoteControl).not.toHaveAttribute('disabled', /.*/);

    const promotionPreview = await openPromotionStep(page);
    await expect(promotionPreview).toContainText(/Promotion Preview/i);
    await expect(promotionPreview).toContainText(/Create\s*1 record/i);
    await expect(promotionPreview).toContainText(/Update\s*1 record/i);
    await expect(promotionPreview).toContainText(/Skip\s*1 record/i);
    await expect(promotionPreview).toContainText(/Avery Stone/i);
    await expect(promotionPreview).toContainText(/Blake Chen/i);
    await expect(promotionPreview).toContainText(/Casey Rivera/i);
    await expect(promotionPreview).toContainText(/Email:\s*avery@example\.test/i);
    await expect(promotionPreview).not.toContainText(/\{"name"|"lead_source"/i);
    expect(calls.promotion).toBeUndefined();

    await runPromotionFromStep(page);
    await expect.poll(() => calls.promotion, 'Import should call the CSV promotion API')
      .not.toBeUndefined();
    expect(calls.promotion.pathname).toBe(`/api/v1/matters/${WORKSPACE_ID}/imports/${IMPORT_JOB_ID}/promote`);
    expect(JSON.parse(calls.promotion.body || '{}')).toEqual({
      spot_check_confirmed: true,
      import_plan_confirmed: true,
      import_plan_confirmation: '',
      review_metadata: {
        target_entity_type: 'lead',
        selected_rows: 3,
        importable_rows: 3,
        total_rows: 3,
        valid_rows: 3,
        invalid_rows: 0,
        duplicate_rows: 0,
        skipped_rows: 0,
        mapped_column_count: 4,
        custom_field_column_count: 0,
        unmapped_column_count: 0,
        risk_reasons: [],
        requires_typed_confirmation: false,
        large_import_threshold: 500,
        all_valid_rows_selected: true,
      },
    });

    const promotionResults = page.locator('[data-testid="workspace-csv-import-promotion-results"]');
    await expect(promotionResults).toBeVisible();
    await expect(promotionResults).toContainText(/Lead - Created/i);
    await expect(promotionResults).toContainText(/Lead - Updated/i);
    await expect(promotionResults).toContainText(/Lead - Skipped/i);
    await expect(promotionResults).toContainText(/Avery Stone/i);
    await expect(promotionResults).toContainText(/Blake Chen/i);
    await expect(promotionResults).not.toContainText(/\{"entityType"|"canonicalUrl"/i);
  });

  test('requires explicit approval before saving or validating custom field mappings', async ({ page }, testInfo) => {
    const calls = {};

    await installMockSession(page);
    await installWorkspaceDataApiStubs(page, calls, { stripPolicyFromMappingResponse: true });

    await page.goto(`/workspace-data.html?id=${WORKSPACE_ID}`);

    await clickControl(page, [
      '[data-testid="workspace-csv-import-open"]',
      '#wsDataImportBtn',
      'lex-btn:has-text("Import CSV")',
      'button:has-text("Import CSV")',
    ], 'CSV import trigger');

    const fileInput = await firstVisible(page, [
      '#wsImportFile',
      'input[type="file"][accept*="csv"]',
      'input[type="file"][accept*=".csv"]',
    ], 'CSV file input');
    await fileInput.setInputFiles({
      name: 'workspace-contacts.csv',
      mimeType: 'text/csv',
      buffer: CSV_BUFFER,
    });
    await clickControl(page, ['#wsImportUploadAction', 'lex-btn:has-text("Upload and Infer")'], 'CSV upload/infer control');
    await expect.poll(() => calls.preview).not.toBeUndefined();
    await firstVisible(page, ['#wsImportMappingRows', '.ws-import-map-table'], 'CSV mapping step');

    await setMapping(page, 'Name', 'name');
    await setMapping(page, 'Email', 'email');
    await setCustomMapping(page, 'Source', 'intake_source');
    await setMapping(page, 'Status', 'status');

    const customApproval = page.locator('[data-testid="workspace-csv-custom-field-approval"]');
    await expect(customApproval).toBeVisible();
    await expect(customApproval).toContainText(/Custom field approval required/i);
    await expect(customApproval).toContainText(/Source/i);
    await expect(customApproval).toContainText(/Intake Source/i);
    await expect(customApproval).toContainText(/custom_fields\.intake_source/i);
    const customApprovalScreenshot = await customApproval.screenshot({
      path: testInfo.outputPath('workspace-connected-data-csv-custom-field-approval.png'),
    });
    expect(customApprovalScreenshot.length, 'custom field approval screenshot should include rendered content').toBeGreaterThan(8000);

    const sourceMappingRow = page.locator('#wsImportMappingRows tr').filter({
      has: page.locator('.ws-import-column-name:text-is("Source")'),
    }).first();
    await expect(sourceMappingRow).toHaveClass(/is-custom-field/);
    await expect(sourceMappingRow.locator('[data-custom-preview]')).toContainText(/Custom field:\s*Intake Source/i);
    await expect(sourceMappingRow.locator('[data-custom-preview]')).toContainText(/custom_fields\.intake_source/i);

    await expect(page.locator('#wsImportSaveMapping')).toHaveAttribute('disabled', /.*/);
    await expect(page.locator('#wsImportValidateAction')).toHaveAttribute('disabled', /.*/);
    await page.locator('#wsImportSaveMapping').dispatchEvent('click');
    await page.locator('#wsImportValidateAction').dispatchEvent('click');
    expect(calls.mapping).toBeUndefined();
    expect(calls.validation).toBeUndefined();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(customApproval).toBeVisible();
    await expect(page.locator('[data-testid="workspace-csv-custom-field-approved"]')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const mobileApprovalScreenshot = await customApproval.screenshot({
      path: testInfo.outputPath('workspace-connected-data-csv-custom-field-approval-mobile.png'),
    });
    expect(mobileApprovalScreenshot.length, 'mobile custom field approval screenshot should include rendered content').toBeGreaterThan(8000);
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.locator('[data-testid="workspace-csv-custom-field-approved"]').click();
    await expect(page.locator('#wsImportSaveMapping')).not.toHaveAttribute('disabled', /.*/);
    await expect(page.locator('#wsImportValidateAction')).not.toHaveAttribute('disabled', /.*/);

    await clickControl(page, ['#wsImportValidateAction', 'lex-btn:has-text("Validate")'], 'CSV validation control');
    await expect.poll(() => calls.mapping, 'custom field validation should save approved mapping first')
      .not.toBeUndefined();
    await expect.poll(() => calls.validation, 'custom field validation should call validation API')
      .not.toBeUndefined();

    const mappingBody = JSON.parse(calls.mapping.body || '{}');
    const expectedPolicy = {
      mode: 'explicit_user_approval',
      required: true,
      approved: true,
      approvedKeys: ['intake_source'],
      approved_keys: ['intake_source'],
      allow_unapproved_custom_fields: false,
      custom_field_count: 1,
      custom_fields: [{
        source_column: 'Source',
        custom_field_key: 'intake_source',
        target_path: 'custom_fields.intake_source',
        label: 'Intake Source',
      }],
    };
    expect(mappingBody.customFieldPolicy).toEqual(expectedPolicy);
    expect(mappingBody.custom_field_policy).toEqual(expectedPolicy);
    expect(mappingBody.customFieldApprovalPolicy).toEqual(expectedPolicy);
    expect(mappingBody.custom_field_approval_policy).toEqual(expectedPolicy);
    expect(mappingBody.mapping.customFieldPolicy).toEqual(expectedPolicy);
    expect(mappingBody.mapping.customFieldApprovalPolicy).toEqual(expectedPolicy);
    expect(mappingBody.mapping.mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceColumn: 'Source',
        targetField: 'custom_fields',
        targetPath: 'custom_fields.intake_source',
        customFieldKey: 'intake_source',
        status: 'custom_field',
      }),
    ]));

    const validationBody = JSON.parse(calls.validation.body || '{}');
    expect(validationBody.customFieldPolicy).toEqual(expectedPolicy);
    expect(validationBody.custom_field_policy).toEqual(expectedPolicy);
    expect(validationBody.customFieldApprovalPolicy).toEqual(expectedPolicy);
    expect(validationBody.custom_field_approval_policy).toEqual(expectedPolicy);

    const firstMappedData = page.locator('#wsImportValidationRows tr').first().locator('td').nth(3);
    await expect(firstMappedData).toContainText(/Name\s*Avery Stone/i);
    await expect(firstMappedData).toContainText(/Email\s*avery@example\.test/i);
    await expect(firstMappedData).toContainText(/Custom Fields\s*Intake Source: CSV Intake/i);
    await expect(firstMappedData).toContainText(/Status\s*Lead/i);
    await expect(firstMappedData).not.toContainText(/\{"custom_fields"|"intake_source"/i);

    const importPlan = page.locator('[data-testid="workspace-csv-import-plan"]');
    await expect(importPlan).toContainText(/Mapped columns\s*3 of 4/i);
    await expect(importPlan).not.toContainText(/CSV Intake|avery@example\.test|\{"custom_fields"/i);
  });

  test('shows duplicate validation context and leaves duplicate rows unselected by default', async ({ page }, testInfo) => {
    const calls = {};

    await installMockSession(page);
    await installWorkspaceDataApiStubs(page, calls, { validationResponse: duplicateValidationResponse });

    await page.goto(`/workspace-data.html?id=${WORKSPACE_ID}`);
    await runCsvImportToValidation(page, calls, {
      selectionSummary: /1 of 1 valid rows selected/i,
    });

    await expect(page.locator('#wsImportValidationSummary')).toContainText(/Duplicates\s*2/i);
    await expect(page.locator('#wsImportValidationSummary')).toContainText(/Selected\s*1/i);
    await expect(page.locator('[data-testid="workspace-csv-import-selection-summary"]'))
      .toContainText(/1 of 1 valid rows selected for import; 2 duplicate\/review rows are not importable without resolution/i);
    await expect(page.locator('[data-testid="workspace-csv-import-row-selector"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="workspace-csv-import-row-selector"][checked]')).toHaveCount(1);
    await expect(page.locator('[data-testid="workspace-csv-import-row-selector"][disabled]')).toHaveCount(2);

    const likelyDuplicateRow = page.locator('#wsImportValidationRows tr', { hasText: 'Blake Chen' });
    await expect(likelyDuplicateRow).toContainText(/Likely duplicate/i);
    await expect(likelyDuplicateRow).toContainText(/Matches Blake Chen/i);
    await expect(likelyDuplicateRow).toContainText(/Email matches an existing lead/i);
    await expect(likelyDuplicateRow).toContainText(/Match confidence 94%/i);
    await expect(likelyDuplicateRow).toHaveClass(/is-duplicate-review/);

    const metadataDuplicateRow = page.locator('#wsImportValidationRows tr', { hasText: 'Casey Rivera' });
    await expect(metadataDuplicateRow).toContainText(/Needs review/i);
    await expect(metadataDuplicateRow).toContainText(/Matches Casey Rivera/i);
    await expect(metadataDuplicateRow).toContainText(/Similar name and company/i);
    await expect(metadataDuplicateRow).toContainText(/Match confidence 88%/i);
    await expect(metadataDuplicateRow).toHaveClass(/is-duplicate-review/);

    const importPlan = page.locator('[data-testid="workspace-csv-import-plan"]');
    await expect(importPlan).toContainText(/Selected rows\s*1 of 1 importable/i);
    await expect(importPlan).toContainText(/Skipped rows\s*2/i);

    const screenshot = await page.screenshot({
      path: testInfo.outputPath('workspace-connected-data-csv-import-duplicate-validation.png'),
      fullPage: true,
    });
    expect(screenshot.length, 'duplicate validation screenshot should include rendered duplicate context').toBeGreaterThan(50000);

    await expectNoHorizontalOverflow(page);

    const promoteControl = page.locator('#wsImportPromoteAction').first();
    await expect(promoteControl).toHaveAttribute('disabled', /.*/);
    await page.locator('[data-testid="workspace-csv-import-spot-check-confirmed"]').click();
    await expect(promoteControl).not.toHaveAttribute('disabled', /.*/);
    const promotionPreview = await openPromotionStep(page);
    await expect(promotionPreview).toContainText(/Promotion Preview/i);
    await expect(promotionPreview).toContainText(/Create\s*1 record/i);
    await expect(promotionPreview).toContainText(/Skip\s*2 records/i);
    await expect(promotionPreview).toContainText(/Avery Stone/i);
    await expect(promotionPreview).not.toContainText(/\{"name"|"lead_source"/i);

    await runPromotionFromStep(page);
    await expect.poll(() => calls.promotion, 'Import should call the CSV promotion API')
      .not.toBeUndefined();
    const promotionBody = JSON.parse(calls.promotion.body || '{}');
    expect(promotionBody.approved_row_ids).toEqual(['row-1']);
    expect(promotionBody.review_metadata).toEqual(expect.objectContaining({
      selected_rows: 1,
      importable_rows: 1,
      duplicate_rows: 2,
      skipped_rows: 2,
    }));
  });

  test('requires approval for backend mappings that target custom_fields without custom status', async ({ page }) => {
    const calls = {};
    const previewMapping = {
      entityType: 'lead',
      mappings: [
        { sourceColumn: 'Name', targetField: 'name', targetPath: 'name', status: 'mapped', confidence: 0.98 },
        { sourceColumn: 'Email', targetField: 'email', targetPath: 'email', status: 'mapped', confidence: 0.99 },
        {
          sourceColumn: 'Source',
          targetField: 'custom_fields',
          targetPath: 'custom_fields.intake_source',
          customFieldKey: 'intake_source',
          status: 'mapped',
          confidence: 0.82,
        },
        { sourceColumn: 'Status', targetField: 'status', targetPath: 'status', status: 'mapped', confidence: 0.74 },
      ],
    };

    await installMockSession(page);
    await installWorkspaceDataApiStubs(page, calls, { previewMapping });

    await page.goto(`/workspace-data.html?id=${WORKSPACE_ID}`);
    await clickControl(page, [
      '[data-testid="workspace-csv-import-open"]',
      '#wsDataImportBtn',
      'lex-btn:has-text("Import CSV")',
      'button:has-text("Import CSV")',
    ], 'CSV import trigger');

    const fileInput = await firstVisible(page, [
      '#wsImportFile',
      'input[type="file"][accept*="csv"]',
      'input[type="file"][accept*=".csv"]',
    ], 'CSV file input');
    await fileInput.setInputFiles({
      name: 'workspace-contacts.csv',
      mimeType: 'text/csv',
      buffer: CSV_BUFFER,
    });
    await clickControl(page, ['#wsImportUploadAction', 'lex-btn:has-text("Upload and Infer")'], 'CSV upload/infer control');
    await expect.poll(() => calls.preview).not.toBeUndefined();

    const customApproval = page.locator('[data-testid="workspace-csv-custom-field-approval"]');
    await expect(customApproval).toBeVisible();
    await expect(customApproval).toContainText(/Intake Source/i);
    await expect(customApproval).toContainText(/custom_fields\.intake_source/i);

    const sourceMappingRow = page.locator('#wsImportMappingRows tr').filter({
      has: page.locator('.ws-import-column-name:text-is("Source")'),
    }).first();
    await expect(sourceMappingRow).toHaveClass(/is-custom-field/);
    await expect(sourceMappingRow.locator('[data-custom-preview]')).toBeVisible();

    await expect(page.locator('#wsImportSaveMapping')).toHaveAttribute('disabled', /.*/);
    await expect(page.locator('#wsImportValidateAction')).toHaveAttribute('disabled', /.*/);
    await page.locator('#wsImportValidateAction').dispatchEvent('click');
    expect(calls.mapping).toBeUndefined();
    expect(calls.validation).toBeUndefined();
  });

  test('requires typed import plan confirmation for opportunity imports', async ({ page }) => {
    const calls = {};

    await installMockSession(page);
    await installWorkspaceDataApiStubs(page, calls);

    await page.goto(`/workspace-data.html?id=${WORKSPACE_ID}`);
    await runCsvImportToValidation(page, calls, {
      entityType: 'opportunity',
      mappings: {
        Name: 'name',
        Email: 'external_id',
        Source: 'description',
        Status: 'stage',
      },
    });

    const importPlan = page.locator('[data-testid="workspace-csv-import-plan"]');
    await expect(importPlan).toBeVisible();
    await expect(importPlan).toContainText(/Target entity\s*Opportunity/i);
    await expect(importPlan).toContainText(/Selected rows\s*3 of 3 importable/i);
    await expect(importPlan).toContainText(/Mapped columns\s*4 of 4/i);
    await expect(importPlan).toContainText(/Opportunity imports can affect revenue pipeline reporting/i);
    await expect(importPlan).not.toContainText(/avery@example\.test|Blake Chen|\{"name"/i);

    const promoteControl = page.locator('#wsImportPromoteAction').first();
    const confirmation = page.locator('[data-testid="workspace-csv-import-plan-confirmation"]');
    await expect(promoteControl).toHaveAttribute('disabled', /.*/);
    await page.locator('[data-testid="workspace-csv-import-spot-check-confirmed"]').click();
    await expect(promoteControl).toHaveAttribute('disabled', /.*/);
    await confirmation.fill('import');
    await expect(promoteControl).not.toHaveAttribute('disabled', /.*/);

    const promotionPreview = await openPromotionStep(page);
    await expect(promotionPreview).toContainText(/Promotion Preview/i);
    await expect(promotionPreview).toContainText(/Opportunity/i);
    await expect(promotionPreview).not.toContainText(/\{"name"|"lead_source"/i);

    await runPromotionFromStep(page);
    await expect.poll(() => calls.promotion, 'Import should call the CSV promotion API')
      .not.toBeUndefined();
    const body = JSON.parse(calls.promotion.body || '{}');
    expect(body).toEqual(expect.objectContaining({
      spot_check_confirmed: true,
      import_plan_confirmed: true,
      import_plan_confirmation: 'import',
    }));
    expect(body.review_metadata).toEqual(expect.objectContaining({
      target_entity_type: 'opportunity',
      selected_rows: 3,
      importable_rows: 3,
      mapped_column_count: 4,
      requires_typed_confirmation: true,
      large_import_threshold: 500,
      all_valid_rows_selected: true,
    }));
    expect(body.review_metadata.risk_reasons).toEqual([
      'Opportunity imports can affect revenue pipeline reporting.',
    ]);
  });

  test('previews, maps, validates, and imports a CSV through Lex UI controls', async ({ page }, testInfo) => {
    const consoleErrors = [];
    const pageErrors = [];
    const calls = {};

    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await installMockSession(page);
    await installWorkspaceDataApiStubs(page, calls);

    await page.goto(`/workspace-data.html?id=${WORKSPACE_ID}`);

    await expect(page.locator('lex-app')).toBeVisible();
    await expect(page.locator('#wsDataBanner')).toBeVisible();
    await expect(page.getByRole('table', { name: /Data table/i })).toBeVisible();
    await expect(page.locator('#wsDataTable')).toHaveAttribute('columns', /external_id,entity_type,connector_id,raw_data/);
    await expect(page.locator('#wsDataTable')).toHaveAttribute('labels', /ID,Entity Type,Connector,Data/);

    const openImport = await clickControl(page, [
      '[data-testid="workspace-csv-import-open"]',
      '#wsDataImportBtn',
      '#wsDataCsvImportBtn',
      'lex-btn:has-text("Import CSV")',
      'lex-btn:has-text("CSV")',
      'button:has-text("Import CSV")',
      'button:has-text("CSV")',
    ], 'CSV import trigger');
    await expectLexControl(openImport, 'lex-btn', 'CSV import trigger');

    const wizard = await firstVisible(page, [
      '[data-testid="workspace-csv-import-wizard"]',
      '#wsDataImportModal',
      '[data-import-wizard]',
      '#wsDataCsvImportWizard',
      '#csvImportWizard',
      'lex-modal:has-text("CSV")',
      '[role="dialog"]:has-text("CSV")',
    ], 'CSV import wizard');
    await expectLexControl(wizard, 'lex-modal', 'CSV import wizard');
    await expect(wizard.locator('lex-card, [data-testid="workspace-csv-import-card"]').first(), 'wizard should use a Lex card for primary content').toBeVisible();

    const steps = page.locator([
      '[data-testid="workspace-csv-import-step"]',
      '[data-testid^="workspace-csv-import-step-"]',
      '.ws-import-step',
      'lex-step',
      '[aria-current="step"]',
    ].join(', '));
    await expect.poll(async () => steps.count(), 'wizard should expose upload, mapping, validation, and import steps')
      .toBeGreaterThanOrEqual(3);

    const fileInput = await firstVisible(page, [
      '[data-testid="workspace-csv-file-input"]',
      '#wsImportFile',
      '#wsDataCsvFileInput',
      '#csvImportFileInput',
      'input[type="file"][accept*="csv"]',
      'input[type="file"][accept*=".csv"]',
    ], 'CSV file input');
    await fileInput.setInputFiles({
      name: 'workspace-contacts.csv',
      mimeType: 'text/csv',
      buffer: CSV_BUFFER,
    });

    const sourceName = page.locator('#wsImportSourceName, [data-testid="workspace-csv-source-name"]').first();
    if (await sourceName.count()) {
      await sourceName.fill('Playwright CSV Intake');
    }

    try {
      await expect.poll(() => calls.preview, {
        message: 'file selection can auto-trigger CSV preview/upload',
        timeout: 1000,
      }).not.toBeUndefined();
    } catch (_error) {
      await clickControl(page, [
        '[data-testid="workspace-csv-import-upload"]',
        '#wsImportUploadAction',
        '[data-testid="workspace-csv-import-next"]',
        '#wsDataCsvImportNext',
        'lex-btn:has-text("Upload and Infer")',
        'button:has-text("Upload and Infer")',
        'lex-btn:has-text("Next")',
        'button:has-text("Next")',
        'lex-btn:has-text("Map")',
        'button:has-text("Map")',
      ], 'CSV upload/infer control');
    }

    await expect.poll(() => calls.preview, 'file selection should trigger a CSV preview/upload API call')
      .not.toBeUndefined();
    expect(calls.preview.pathname).toBe(`/api/v1/matters/${WORKSPACE_ID}/imports/csv`);
    expect(calls.preview.contentType).toContain('multipart/form-data');

    await firstVisible(page, [
      '[data-testid="workspace-csv-import-mapping"]',
      '[data-step-pane="mapping"].is-active',
      '#wsImportMappingRows',
      '.ws-import-map-table',
    ], 'CSV mapping step');

    await expect(page.locator('.ws-import-column-name', { hasText: /^Name$/ })).toBeVisible();
    await expect(page.locator('.ws-import-column-name', { hasText: /^Email$/ })).toBeVisible();
    await expect(page.locator('.ws-import-column-name', { hasText: /^Status$/ })).toBeVisible();
    await setMapping(page, 'Name', 'name');
    await setMapping(page, 'Email', 'email');
    await setMapping(page, 'Source', 'lead_source');
    await setMapping(page, 'Status', 'status');

    await clickControl(page, [
      '[data-testid="workspace-csv-import-validate"]',
      '#wsImportValidateAction',
      '#wsDataCsvImportValidate',
      'lex-btn:has-text("Validate")',
      'button:has-text("Validate")',
    ], 'CSV validation control');

    await expect.poll(() => calls.mapping, 'Validate should save mapping before row validation')
      .not.toBeUndefined();
    expect(calls.mapping.pathname).toBe(`/api/v1/matters/${WORKSPACE_ID}/imports/${IMPORT_JOB_ID}/mapping`);
    const mappingBody = JSON.parse(calls.mapping.body);
    expect(mappingBody.mapping.entityType).toBe('lead');
    expect(mappingBody.mapping.mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceColumn: 'Name', targetField: 'name', status: 'mapped' }),
      expect.objectContaining({ sourceColumn: 'Email', targetField: 'email', status: 'mapped' }),
      expect.objectContaining({ sourceColumn: 'Source', targetField: 'lead_source', status: 'mapped' }),
      expect.objectContaining({ sourceColumn: 'Status', targetField: 'status', status: 'mapped' }),
    ]));

    await expect.poll(() => calls.validation, 'Validate should call the CSV validation API')
      .not.toBeUndefined();
    expect(calls.validation.pathname).toBe(`/api/v1/matters/${WORKSPACE_ID}/imports/${IMPORT_JOB_ID}/validate`);
    await expect(page.locator('#wsImportValidationSummary')).toContainText(/Valid\s*3/i);
    await expect(page.locator('#wsImportValidationSummary')).toContainText(/Selected\s*3/i);
    await expect(page.locator('#wsImportValidationSummary')).toContainText(/Importable\s*3/i);
    await expect(page.locator('#wsImportValidationSummary')).toContainText(/Invalid\s*0/i);
    await expect(page.locator('[data-testid="workspace-csv-import-selection-summary"]')).toContainText(/3 of 3 valid rows selected/i);
    await expect(page.locator('[data-testid="workspace-csv-import-row-selector"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="workspace-csv-import-row-selector"][checked]')).toHaveCount(3);
    const firstMappedData = page.locator('#wsImportValidationRows tr').first().locator('td').nth(3);
    await expect(firstMappedData).toContainText(/Name\s*Avery Stone/i);
    await expect(firstMappedData).toContainText(/Email\s*avery@example\.test/i);
    await expect(firstMappedData).toContainText(/Lead Source\s*CSV Intake/i);
    await expect(firstMappedData).toContainText(/Status\s*Lead/i);
    await expect(firstMappedData).not.toContainText(/"name":|"email":|\{"name"/i);
    await expect(firstMappedData.locator('.ws-import-field-row')).toHaveCount(4);

    const promoteControl = page.locator('#wsImportPromoteAction').first();
    await expect(promoteControl).toHaveAttribute('disabled', /.*/);
    await page.locator('[data-testid="workspace-csv-import-spot-check-confirmed"]').click();
    await expect(promoteControl).not.toHaveAttribute('disabled', /.*/);

    const secondRowSelector = page.locator('#wsImportValidationRows tr', { hasText: 'Blake Chen' })
      .locator('[data-testid="workspace-csv-import-row-selector"]')
      .first();
    await secondRowSelector.click();
    await expect(page.locator('[data-testid="workspace-csv-import-selection-summary"]')).toContainText(/2 of 3 valid rows selected/i);
    await expect(page.locator('#wsImportValidationSummary')).toContainText(/Selected\s*2/i);
    await expect(page.locator('[data-testid="workspace-csv-import-row-selector"][checked]')).toHaveCount(2);
    await expect(promoteControl).toHaveAttribute('disabled', /.*/);
    await page.locator('[data-testid="workspace-csv-import-spot-check-confirmed"]').click();
    await expect(promoteControl).not.toHaveAttribute('disabled', /.*/);

    const screenshot = await page.screenshot({
      path: testInfo.outputPath('workspace-connected-data-csv-import-validation.png'),
      fullPage: true,
    });
    expect(screenshot.length, 'wizard screenshot should include rendered content').toBeGreaterThan(50000);
    const importPlanScreenshot = await page.locator('[data-testid="workspace-csv-import-plan"]').screenshot({
      path: testInfo.outputPath('workspace-connected-data-csv-import-plan.png'),
    });
    expect(importPlanScreenshot.length, 'import plan screenshot should include rendered content').toBeGreaterThan(8000);

    await expectNoHorizontalOverflow(page);

    const promotionPreview = await openPromotionStep(page);
    await expect(promotionPreview).toContainText(/Promotion Preview/i);
    await expect(promotionPreview).toContainText(/Create\s*1 record/i);
    await expect(promotionPreview).toContainText(/Update\s*0 records/i);
    await expect(promotionPreview).toContainText(/Skip\s*2 records/i);
    await expect(promotionPreview).toContainText(/Avery Stone/i);
    await expect(promotionPreview).toContainText(/Blake Chen/i);
    await expect(promotionPreview).not.toContainText(/\{"name"|"lead_source"/i);

    const promote = await runPromotionFromStep(page);
    await expectLexControl(promote, 'lex-btn', 'CSV promotion run control');

    await expect.poll(() => calls.promotion, 'Import should call the CSV promotion API')
      .not.toBeUndefined();
    expect(calls.promotion.pathname).toBe(`/api/v1/matters/${WORKSPACE_ID}/imports/${IMPORT_JOB_ID}/promote`);
    expect(JSON.parse(calls.promotion.body)).toEqual({
      approved_row_ids: ['row-1', 'row-3'],
      spot_check_confirmed: true,
      import_plan_confirmed: true,
      import_plan_confirmation: '',
      review_metadata: {
        target_entity_type: 'lead',
        selected_rows: 2,
        importable_rows: 3,
        total_rows: 3,
        valid_rows: 3,
        invalid_rows: 0,
        duplicate_rows: 0,
        skipped_rows: 1,
        mapped_column_count: 4,
        custom_field_column_count: 0,
        unmapped_column_count: 0,
        risk_reasons: [],
        requires_typed_confirmation: false,
        large_import_threshold: 500,
        all_valid_rows_selected: false,
      },
    });
    await expect(page.locator('#wsImportPromotionSummary')).toContainText(/Imported\s*1/i);
    await expect(page.locator('#wsImportPromotionSummary')).toContainText(/Created\s*1/i);
    await expect(page.locator('#wsImportPromotionSummary')).toContainText(/Updated\s*0/i);
    await expect(page.locator('#wsImportPromotionSummary')).toContainText(/Skipped\s*2/i);
    await expect(page.locator('[data-testid="workspace-csv-import-readiness"]')).toContainText(/Automation ready/i);
    await expect(page.locator('#wsImportPromotionRows')).toContainText(/Not selected for import/i);
    await expect(page.locator('#wsImportPromotionRows')).toContainText(/Matched an existing canonical lead/i);
    const canonicalLink = page.locator('#wsImportPromotionRows a.ws-import-entity-link', { hasText: 'Avery Stone' });
    await expect(canonicalLink).toHaveAttribute('href', /workspace-details\.html\?id=lead-workspace&tab=summary/);
    await expect(page.locator('#wsImportPromotionRows')).toContainText(/Row 2/i);
    await expect(page.locator('#wsImportPromotionRows')).toContainText(/Casey Rivera/i);
    await expect(page.locator('#wsImportPromotionRows a.ws-import-entity-link', { hasText: 'Casey Rivera' })).toHaveCount(0);

    const promotionScreenshot = await page.screenshot({
      path: testInfo.outputPath('workspace-connected-data-csv-import-promotion.png'),
      fullPage: true,
    });
    expect(promotionScreenshot.length, 'promotion screenshot should include rendered result content').toBeGreaterThan(50000);

    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    const promotionMobileScreenshot = await page.screenshot({
      path: testInfo.outputPath('workspace-connected-data-csv-import-promotion-mobile.png'),
      fullPage: true,
    });
    expect(promotionMobileScreenshot.length, 'mobile promotion screenshot should include rendered result content').toBeGreaterThan(30000);
    await page.locator('#wsImportReloadData').scrollIntoViewIfNeeded();
    await expect(page.locator('#wsImportReloadData')).toBeVisible();
    await expect(page.locator('#wsImportPromotionRows')).toContainText(/Row 3/i);
    await expectNoHorizontalOverflow(page);
    const promotionMobileBottomScreenshot = await page.screenshot({
      path: testInfo.outputPath('workspace-connected-data-csv-import-promotion-mobile-bottom.png'),
      fullPage: true,
    });
    expect(promotionMobileBottomScreenshot.length, 'mobile promotion bottom screenshot should include final actions').toBeGreaterThan(30000);

    expect(pageErrors, 'page errors').toEqual([]);
    expect(consoleErrors, 'console errors').toEqual([]);
  });
});
