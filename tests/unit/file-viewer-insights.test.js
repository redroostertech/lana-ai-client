'use strict';

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../../src/file-viewer.html'), 'utf8');
const pageJs = fs.readFileSync(path.join(__dirname, '../../src/js/file-viewer-page.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../src/css/file-viewer.css'), 'utf8');

describe('file viewer insights panel', () => {
  test('the review rail carries an Insights tab and panel, and the page loads the enrichment datasource', () => {
    expect(html).toContain('{"value":"insights","label":"Insights"}');
    expect(html).toContain('id="reviewPanelInsights"');
    expect(html).toContain('id="reviewInsightsBody"');
    expect(html).toContain('js/services/document-enrichment.service.js');
    expect(html.indexOf('js/services/document-enrichment.service.js')).toBeLessThan(html.indexOf('js/file-viewer-page.js'));
  });

  test('the page loads insights beside the document, shows the rail for non-review files, delegates the actions, and resets per file', () => {
    expect(pageJs).toContain("state.reviewTab = tab === 'releases' || tab === 'insights' ? tab : 'changes';");
    expect(pageJs).toContain("if (insightsPanel) insightsPanel.classList.toggle('hidden', state.reviewTab !== 'insights');");
    expect(pageJs).toContain('await loadFileContent(response);\n      // Insights load beside the document');
    expect(pageJs).toContain("rail.classList.add('file-viewer-review-rail--insights-only');");
    expect(pageJs).toContain("insightsPanel.addEventListener('click', onEnrichmentAction);");
    expect(pageJs).toContain("closest('[data-enrichment-action]')");
    expect(pageJs).toContain('resetEnrichmentPanel();');
    expect(pageJs).toContain("if (settled && run.id !== state.enrichmentRerunFrom) clearInterval(timer);");
  });

  test('insights styles exist and the workflow footer is hidden in insights-only mode', () => {
    expect(css).toContain('.file-viewer-review-rail--insights-only .file-viewer-review-workflow');
    for (const cls of ['.file-viewer-insights__item', '.file-viewer-insights__evidence', '.file-viewer-insights__badge', '.file-viewer-insights__chip']) {
      expect(css).toContain(cls + ' {');
    }
  });
});

describe('metadata formatter reads the enrichment shape', () => {
  test('returns the legacy lists and the typed lists the enrichment lane writes; a missing key is an empty list', () => {
    global.window = {};
    // eslint-disable-next-line global-require
    require(path.join(__dirname, '../../src/js/utils/metadata-formatter.js'));
    const formatter = global.window.metadataFormatter;
    const shaped = formatter.formatExtractedEntities({
      case_numbers: ['25TB679'], people: ['Auritela Burgos'], organizations: ['Title Bond Agency LLC'],
      dates: ['2025-08-29'], locations: ['Garfield, NJ'], amounts: ['885000'], emails: ['a@b.co'], phones: ['2013668021'],
      generated_by: 'document_enrichment'
    });
    expect(shaped.people).toEqual(['Auritela Burgos']);
    expect(shaped.amounts).toEqual(['885000']);
    expect(shaped.emails).toEqual(['a@b.co']);
    expect(shaped.phones).toEqual(['2013668021']);
    expect(shaped.caseNumbers).toEqual(['25TB679']);
    expect(shaped.dates).toHaveLength(1);
    expect(formatter.formatExtractedEntities(null)).toMatchObject({ people: [], amounts: [], emails: [], phones: [], matterIds: [] });
    delete global.window;
  });
});
