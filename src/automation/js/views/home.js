import { badge } from '../shared/ui.js';
import { escapeAttribute, escapeHtml, formatLabel, timeAgo } from '../shared/utils.js';
import { countReadyConnectors } from './connectors.js';

export function buildChecklist(context) {
  return [
    {
      title: 'Review connectors',
      description: 'Confirm that the data sources your automations need are visible and marked ready.',
      done: countReadyConnectors(context) > 0,
      actionLabel: 'Open Connectors',
      view: 'connectors'
    },
    {
      title: 'Choose a template',
      description: 'Select a workflow pattern so the builder starts with sensible defaults.',
      done: Boolean(context.state.builder.templateId),
      actionLabel: 'Open Library',
      view: 'library'
    },
    {
      title: 'Configure the builder',
      description: 'Set the trigger, prompt, and schedule that define how the automation behaves.',
      done: Boolean(context.state.builder.name && context.state.builder.message && context.configIsValid(context.state.builder)),
      actionLabel: 'Open Builder',
      view: 'builder'
    },
    {
      title: 'Publish your first automation',
      description: 'Save the automation and make it live for a matter or the organization.',
      done: context.state.automations.length > 0,
      actionLabel: 'Review Live Automations',
      view: 'library'
    }
  ];
}

export function renderHome(context) {
  const firstName = context.state.user?.firstName || context.state.user?.email?.split('@')[0] || 'there';
  const templates = context.getTemplateLibrary();
  const starterTemplates = templates.slice(0, 3);
  const runnableAutomations = getHomeRunnableAutomations(context);

  context.els.viewContent.innerHTML = `
    <section class="home-shell">
      <section class="automation-page-banner" aria-label="Automation home">
        <lex-banner
          variant="light"
          heading="What would you like to automate, ${escapeAttribute(firstName)}?"
          subtitle="Pick a starter template below or run an existing automation."
        ></lex-banner>
        <div class="automation-page-banner-badges">
          ${badge(`${countReadyConnectors(context)} ready connectors`, countReadyConnectors(context) ? 'success' : '')}
          ${badge(`${context.state.automations.length} automations`)}
        </div>
      </section>

      <!-- Composer hidden for now — un-hide when the home-composer-ai flow ships
           (see TODO at onHomeComposerSend in app.js). Kept in the DOM so the
           configureHomeComposer + lex-composer-send wiring stays warm. -->
      <div class="home-composer-wrap" hidden aria-hidden="true">
        <lex-chat-composer
          id="home-lex-composer"
          placeholder="Enter an idea or connector name to get started."
          max-height="96"
        ></lex-chat-composer>
      </div>

      <section class="home-section">
        <div class="home-section-head">
          <div>
            <h3>Run automations</h3>
            <p>Recently used workflows ready to trigger from Home</p>
          </div>
        </div>
        ${runnableAutomations.length ? `
          <div class="home-card-grid">
            ${runnableAutomations.map(({ automation, run }) => renderRunnableAutomation(context, automation, run)).join('')}
          </div>
        ` : `
          <lex-empty
            message="No runnable automations"
            description="Publish an automation to run it from Home."
          ></lex-empty>
        `}
      </section>

      <section class="home-section">
        <h3>Starter templates</h3>
        <div class="home-card-grid">
          ${starterTemplates.map((template) => `
            <lex-action-card
              class="home-template-card"
              title="${escapeAttribute(template.name)}"
              description="${escapeAttribute(template.description || template.bestFor || 'Template for repeatable workflow setup.')}"
              tag="${escapeAttribute(template.category || template.trigger || 'Template')}"
              action="use-template"
              data-template-id="${escapeAttribute(template.id)}"
            ></lex-action-card>
          `).join('')}
        </div>
      </section>
    </section>
  `;
}

function getHomeRunnableAutomations(context) {
  const automationsById = new Map();
  const picked = [];
  const seen = new Set();

  for (const automation of context.state.automations || []) {
    const id = getAutomationId(automation);
    if (id) automationsById.set(id, automation);
  }

  for (const run of context.state.homeRecentRuns || []) {
    const automationId = String(run.automation_id || run.automationId || '');
    if (!automationId || seen.has(automationId)) continue;
    const automation = automationsById.get(automationId);
    if (!automation) continue;
    picked.push({ automation, run });
    seen.add(automationId);
    if (picked.length >= 3) return picked;
  }

  const fallback = [...(context.state.automations || [])]
    .filter((automation) => automation.is_enabled !== false && automation.status !== 'disabled')
    .sort((left, right) => {
      const leftTime = new Date(left.updated_at || left.created_at || 0).getTime();
      const rightTime = new Date(right.updated_at || right.created_at || 0).getTime();
      return rightTime - leftTime;
    });

  for (const automation of fallback) {
    const automationId = getAutomationId(automation);
    if (!automationId || seen.has(automationId)) continue;
    picked.push({ automation, run: null });
    seen.add(automationId);
    if (picked.length >= 3) break;
  }

  return picked;
}

function renderRunnableAutomation(context, automation, run) {
  const automationId = getAutomationId(automation);
  const name = automation.automation_name || automation.name || 'Untitled automation';
  const description = automation.automation_description
    || automation.description
    || 'Run this published workflow now.';
  const category = automation.category || automation.automation_type || 'Automation';
  const trigger = automation.trigger_type
    || automation.trigger
    || automation.automation_config?.trigger?.type
    || automation.automation_config?.trigger
    || '';
  const runTime = run?.started_at || run?.created_at || run?.completed_at || automation.updated_at || automation.created_at;
  const isBusy = context.state.homeRunBusyId === automationId;

  return `
    <lex-card
      class="home-run-card"
      variant="default"
      padding="compact"
      heading="${escapeAttribute(name)}"
    >
      <div class="home-run-card-main">
        <p class="home-run-description" title="${escapeAttribute(description)}">${escapeHtml(description)}</p>
        <div class="home-run-meta">
          ${badge(formatLabel(category) || 'Automation')}
          ${trigger ? badge(formatLabel(trigger)) : ''}
        </div>
      </div>
      <div class="home-run-card-actions" data-slot="footer">
        <span class="home-run-time">${run ? `Last run ${escapeHtml(timeAgo(runTime))}` : `Updated ${escapeHtml(timeAgo(runTime))}`}</span>
        <lex-btn
          variant="primary"
          size="sm"
          data-home-run-automation-id="${escapeAttribute(automationId)}"
          ${isBusy ? 'loading="true" disabled' : ''}
        >${isBusy ? 'Triggering' : 'Run Now'}</lex-btn>
      </div>
    </lex-card>
  `;
}

function getAutomationId(automation) {
  return String(automation?.automation_id || automation?.id || '');
}
