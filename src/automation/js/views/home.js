import { badge } from '../shared/ui.js';
import { escapeAttribute, escapeHtml } from '../shared/utils.js';
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

  context.els.viewContent.innerHTML = `
    <section class="home-shell">
      <div class="home-hero">
        <h2>What would you like to automate, ${escapeHtml(firstName)}?</h2>
        <div class="home-composer-wrap">
          <lex-chat-composer
            id="home-lex-composer"
            placeholder="Enter an idea or connector name to get started."
            max-height="96"
          ></lex-chat-composer>
        </div>
        <div class="badge-row">
          ${badge(`${countReadyConnectors(context)} ready connectors`, countReadyConnectors(context) ? 'success' : '')}
          ${badge(`${context.state.automations.length} automations`)}
        </div>
      </div>

      <section class="home-section">
        <h3>Starter templates</h3>
        <div class="home-card-grid">
          ${starterTemplates.map((template) => `
            <article class="home-mini-card">
              <strong>${escapeHtml(template.name)}</strong>
              <p>${escapeHtml(template.description || template.bestFor || 'Template for repeatable workflow setup.')}</p>
              <div class="badge-row">
                ${badge(template.category)}
                ${badge(template.trigger)}
              </div>
              <lex-btn variant="secondary" size="sm" data-template-id="${escapeAttribute(template.id)}">Use Template</lex-btn>
            </article>
          `).join('')}
        </div>
      </section>
    </section>
  `;
}
