/**
 * FunnelChartRenderer - Reusable ES6 module for rendering funnel visualizations
 *
 * Renders visual funnel charts showing stage-by-stage progression with:
 * - Tabbed pipeline selector when multiple pipelines detected (via stage_detail)
 * - Stage labels and values
 * - Conversion rates and percentages
 * - Dropoff indicators between stages
 * - Color-coded stage types
 * - Responsive bar width based on conversion
 *
 * @module FunnelChartRenderer
 */

import { escapeHtml } from '../chart-utils.js';

export class FunnelChartRenderer {
  /**
   * @param {string} containerId - DOM element ID where the funnel will be rendered
   * @param {Array<Object>} data - Funnel stage data array
   * @param {string} data[].label - Stage label
   * @param {number} data[].value - Number of items at this stage
   * @param {number} data[].percentage - Percentage of initial stage (0-100)
   * @param {number} [data[].dropoff_rate] - Percentage dropped from previous stage
   * @param {number} [data[].previous_stage_count] - Count at previous stage
   * @param {string} [data[].stage_detail] - Pipeline/group name for tab grouping
   * @param {Object} config - Configuration options
   * @param {Function} [config.onStageClick] - Callback when a stage card is clicked: onStageClick({ label, value, pipeline_id, position, pipelineName })
   */
  constructor(containerId, data, config) {
    config = config || {};
    this.containerId = containerId;
    this.data = data || [];
    this.config = {
      title: config.title || 'Funnel Chart',
      description: config.description || null,
      showLegend: config.showLegend !== undefined ? config.showLegend : true,
      helpText: config.helpText || null,
      onStageClick: config.onStageClick || null,
      onTabSwitch: config.onTabSwitch || null,
      colors: {
        initial: (config.colors && config.colors.initial) || 'bg-indigo-500',
        opportunity: (config.colors && config.colors.opportunity) || 'bg-purple-500',
        won: (config.colors && config.colors.won) || 'bg-green-500',
        default: (config.colors && config.colors.default) || 'bg-blue-500'
      }
    };

    this._activeTab = 0;
    this._groups = [];
    this.container = null;
    this.rendered = false;
  }

  render() {
    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      throw new Error('Container element with id "' + this.containerId + '" not found');
    }

    this.container.innerHTML = '';

    if (!Array.isArray(this.data) || this.data.length === 0) {
      this._renderEmptyState();
      return this.container;
    }

    this._groups = this._groupByPipeline(this.data);

    if (this._groups.length > 1) {
      this._renderTabbedFunnels();
    } else {
      var wrapper = this._buildSingleFunnel(this._groups[0].stages);
      this.container.appendChild(wrapper);

      // Fire onTabSwitch for single pipeline mode
      if (this.config.onTabSwitch) {
        var firstStage = this._groups[0].stages[0];
        this.config.onTabSwitch({
          tabIndex: 0,
          pipelineId: firstStage ? (firstStage.pipeline_id || '') : '',
          pipelineName: this._groups[0].name || '',
          group: this._groups[0]
        });
      }
    }

    this.rendered = true;
    return this.container;
  }

  destroy() {
    if (this.container) this.container.innerHTML = '';
    this.rendered = false;
    this.container = null;
  }

  update(newData) {
    this.data = newData || [];
    if (this.rendered) this.render();
  }

  // --- Grouping ---

  _groupByPipeline(data) {
    var hasGroups = false;
    var groupMap = {};
    var groupOrder = [];

    for (var i = 0; i < data.length; i++) {
      var stage = data[i];
      var groupName = stage.stage_detail || '';
      if (groupName) hasGroups = true;

      if (!groupMap[groupName]) {
        groupMap[groupName] = [];
        groupOrder.push(groupName);
      }
      groupMap[groupName].push(stage);
    }

    if (!hasGroups) return [{ name: '', stages: data }];

    var groups = [];
    for (var g = 0; g < groupOrder.length; g++) {
      var name = groupOrder[g];
      var stages = groupMap[name];
      var prefix = name + ': ';

      var cleanedStages = stages.map(function (s) {
        var cleaned = Object.assign({}, s);
        if (name && cleaned.label && cleaned.label.indexOf(prefix) === 0) {
          cleaned.label = cleaned.label.substring(prefix.length);
        }
        return cleaned;
      });

      // Compute summary stats
      var stageCount = cleanedStages.length;
      var firstVal = stageCount > 0 ? (cleanedStages[0].value || 0) : 0;
      // Find "Won" stage value for true conversion rate
      var wonVal = 0;
      for (var w = 0; w < cleanedStages.length; w++) {
        var wonLbl = (cleanedStages[w].label || '').toLowerCase();
        if (wonLbl.indexOf('won') !== -1) {
          wonVal = cleanedStages[w].value || 0;
          break;
        }
      }
      var lastVal = stageCount > 0 ? (cleanedStages[stageCount - 1].value || 0) : 0;
      var conversion = firstVal > 0 ? ((wonVal / firstVal) * 100).toFixed(1) : '0.0';
      var flowThrough = firstVal > 0 ? ((lastVal / firstVal) * 100).toFixed(1) : '0.0';
      // Total opportunities = "Became Opportunity" stage value (unique count, not sum of all stages)
      var totalOpps = 0;
      for (var j = 0; j < cleanedStages.length; j++) {
        var lbl = (cleanedStages[j].label || '').toLowerCase();
        if (lbl.indexOf('became opportunity') !== -1 || lbl.indexOf('opportunity') !== -1) {
          totalOpps = cleanedStages[j].value || 0;
          break;
        }
      }
      // Fallback: if no opportunity stage found, use second stage (first non-initial)
      if (totalOpps === 0 && stageCount > 1) {
        totalOpps = cleanedStages[1].value || 0;
      }

      groups.push({
        name: name,
        stages: cleanedStages,
        stageCount: stageCount,
        conversion: conversion,
        flowThrough: flowThrough,
        wonCount: wonVal,
        totalOpps: totalOpps
      });
    }

    return groups;
  }

  // --- Tabbed multi-pipeline layout ---

  _renderTabbedFunnels() {
    var self = this;

    // Outer card
    var card = document.createElement('div');
    card.className = 'bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6 min-w-0 max-w-full';

    // Header
    var header = document.createElement('div');
    header.className = 'px-6 pt-6 pb-0';

    var titleRow = document.createElement('div');
    titleRow.className = 'flex items-center justify-between mb-1';

    var title = document.createElement('h3');
    title.className = 'text-lg font-semibold text-gray-900';
    title.textContent = this.config.title;
    titleRow.appendChild(title);

    if (this.config.helpText) {
      titleRow.appendChild(this._buildHelpButton());
    }
    header.appendChild(titleRow);

    if (this.config.description) {
      var desc = document.createElement('p');
      desc.className = 'text-sm text-gray-500 mb-4';
      desc.textContent = this.config.description;
      header.appendChild(desc);
    }

    card.appendChild(header);

    // Tab bar — scrollable when tabs exceed container width
    var tabBarWrapper = document.createElement('div');
    tabBarWrapper.className = 'border-b border-gray-200 overflow-hidden';
    var tabBar = document.createElement('div');
    tabBar.className = 'px-6 flex gap-1 overflow-x-auto';
    tabBar.style.cssText = 'scrollbar-width: thin; -webkit-overflow-scrolling: touch; scroll-behavior: smooth;';
    this._tabBar = tabBar;
    tabBarWrapper.appendChild(tabBar);

    for (var i = 0; i < this._groups.length; i++) {
      var tab = this._buildTab(this._groups[i], i);
      tabBar.appendChild(tab);
    }
    card.appendChild(tabBarWrapper);

    // Content area (swapped per tab)
    var contentArea = document.createElement('div');
    contentArea.className = 'px-6 py-6';
    this._contentArea = contentArea;
    card.appendChild(contentArea);

    // Legend
    if (this.config.showLegend) {
      card.appendChild(this._buildLegend());
    }

    this.container.appendChild(card);

    // Show first tab
    this._switchTab(0);
  }

  _buildTab(group, index) {
    var self = this;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'funnel-tab flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ' +
      'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300';
    btn.setAttribute('data-tab-index', index);

    // Tab label with mini stats
    btn.innerHTML =
      '<span>' + escapeHtml(group.name || 'Pipeline ' + (index + 1)) + '</span>' +
      '<span class="ml-2 text-xs text-gray-400">' + group.conversion + '%</span>';

    btn.onclick = function () {
      self._switchTab(index);
    };

    return btn;
  }

  _switchTab(index) {
    this._activeTab = index;
    var group = this._groups[index];

    // Update tab active states
    var tabs = this._tabBar.querySelectorAll('.funnel-tab');
    for (var i = 0; i < tabs.length; i++) {
      if (i === index) {
        tabs[i].className = 'funnel-tab flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ' +
          'border-indigo-500 text-indigo-600';
        // Scroll active tab into view
        tabs[i].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      } else {
        tabs[i].className = 'funnel-tab flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ' +
          'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300';
      }
    }

    // Render content for this tab
    this._contentArea.innerHTML = '';

    // Pipeline summary bar
    var summaryBar = document.createElement('div');
    summaryBar.className = 'flex items-center gap-6 mb-6 pb-4 border-b border-gray-100';
    summaryBar.innerHTML =
      '<div>' +
        '<div class="text-xs text-gray-500 uppercase tracking-wide mb-1">Stages</div>' +
        '<div class="text-lg font-semibold text-gray-900">' + group.stageCount + '</div>' +
      '</div>' +
      '<div>' +
        '<div class="text-xs text-gray-500 uppercase tracking-wide mb-1">Won Conversion</div>' +
        '<div class="text-lg font-semibold ' + (parseFloat(group.conversion) >= 10 ? 'text-green-600' : 'text-gray-900') + '">' + group.conversion + '%</div>' +
        '<div class="text-xs text-gray-400">' + group.wonCount + ' won of ' + (group.stages.length > 0 ? group.stages[0].value || 0 : 0) + ' leads</div>' +
      '</div>' +
      '<div>' +
        '<div class="text-xs text-gray-500 uppercase tracking-wide mb-1">Opportunities</div>' +
        '<div class="text-lg font-semibold text-gray-900">' + group.totalOpps.toLocaleString() + '</div>' +
      '</div>';
    this._contentArea.appendChild(summaryBar);

    // Funnel stages (with branch detection)
    var stagesContainer = document.createElement('div');
    stagesContainer.className = 'space-y-2';
    this._renderStagesWithBranching(group.stages, stagesContainer);
    this._contentArea.appendChild(stagesContainer);

    // Notify listeners of tab switch (for syncing insight panels)
    if (this.config.onTabSwitch) {
      var firstStage = group.stages[0];
      this.config.onTabSwitch({
        tabIndex: index,
        pipelineId: firstStage ? (firstStage.pipeline_id || '') : '',
        pipelineName: group.name,
        group: group
      });
    }
  }

  // --- Single pipeline (no tabs) ---

  _buildSingleFunnel(stages) {
    var div = document.createElement('div');
    div.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6';

    div.appendChild(this._buildHeader());

    if (this.config.description) {
      div.appendChild(this._buildDescription());
    }

    var container = document.createElement('div');
    container.className = 'space-y-2';
    this._renderStagesWithBranching(stages, container);
    div.appendChild(container);

    if (this.config.showLegend) {
      div.appendChild(this._buildLegend());
    }

    return div;
  }

  // --- Branch detection and rendering ---

  /**
   * Detect branch groups in stages and render accordingly.
   * Stages sharing the same non-empty stage_group are treated as outcomes of a common parent.
   * The first stage in a group is the "entry" stage, subsequent ones are "outcome" branches.
   */
  _renderStagesWithBranching(stages, container) {
    // Drop zero-value stages before any rendering. A stage with 0 leads
    // (count or value) adds visual noise + produces nonsense connectors
    // like "All 0 leads continue". Hide them entirely. If every stage is
    // 0 we still need to emit something so the container isn't blank --
    // keep the first stage as a marker in that case.
    var nonZeroStages = stages.filter(function (s) {
      var v = parseFloat(s && (s.value != null ? s.value : s.count)) || 0;
      return v > 0;
    });
    if (nonZeroStages.length === 0 && stages.length > 0) {
      nonZeroStages = [stages[0]];
    }
    stages = nonZeroStages;

    // Build branch group map: find consecutive stages sharing a stage_group
    var branchGroups = this._detectBranchGroups(stages);
    var renderedIndices = {};
    var logicalIndex = 0;

    var afterOutcomeGroup = false;
    for (var i = 0; i < stages.length; i++) {
      if (renderedIndices[i]) continue;

      var group = branchGroups[i];
      if (group && group.outcomes.length > 0) {
        // Check if any outcome has leads — skip branch rendering if all are 0
        var hasAnyOutcomeLeads = false;
        for (var ck = 0; ck < group.outcomes.length; ck++) {
          if (parseInt(group.outcomes[ck].at_stage_count) > 0) {
            hasAnyOutcomeLeads = true;
            break;
          }
        }

        if (hasAnyOutcomeLeads) {
          // Render the entry stage normally
          container.appendChild(this._buildStage(group.entry, logicalIndex, stages.length));
          logicalIndex++;

          // Render the outcome group
          container.appendChild(this._buildOutcomeGroup(group));

          // Mark all outcome indices as rendered
          for (var oi = 0; oi < group.outcomeIndices.length; oi++) {
            renderedIndices[group.outcomeIndices[oi]] = true;
          }
          afterOutcomeGroup = true;
        } else {
          // No leads in any outcome — render all stages sequentially instead
          container.appendChild(this._buildStage(group.entry, logicalIndex, stages.length));
          logicalIndex++;
          for (var oi2 = 0; oi2 < group.outcomeIndices.length; oi2++) {
            renderedIndices[group.outcomeIndices[oi2]] = true;
          }
          afterOutcomeGroup = false;
        }
      } else if (!renderedIndices[i]) {
        // Regular sequential stage
        // If this stage comes right after an outcome group, suppress the drop-off indicator
        // since the SQL's LAG references the last outcome stage which is misleading
        if (afterOutcomeGroup) {
          var modifiedStage = Object.assign({}, stages[i]);
          modifiedStage._suppressDropoff = true;
          container.appendChild(this._buildStage(modifiedStage, logicalIndex, stages.length));
        } else {
          container.appendChild(this._buildStage(stages[i], logicalIndex, stages.length));
        }
        logicalIndex++;
        afterOutcomeGroup = false;
      }
    }
  }

  /**
   * Detect branch groups from stage_group field.
   * Returns a map: entryIndex -> { entry, outcomes[], outcomeIndices[], groupName }
   */
  _detectBranchGroups(stages) {
    var groups = {};

    // Find all non-empty stage_groups and their stage indices
    var groupStages = {};
    for (var i = 0; i < stages.length; i++) {
      var sg = stages[i].stage_group || '';
      if (sg) {
        if (!groupStages[sg]) groupStages[sg] = [];
        groupStages[sg].push(i);
      }
    }

    // For groups with 3+ stages (entry + at least 2 outcomes), treat as branch group.
    // Groups with only 2 stages (e.g., "Consultation: Booked" → "Consultation: Showed")
    // are sequential progressions, not branching outcomes.
    for (var groupName in groupStages) {
      var indices = groupStages[groupName];
      if (indices.length >= 3) {
        var entryIdx = indices[0];
        var outcomeIndices = indices.slice(1);
        var outcomes = [];
        for (var j = 0; j < outcomeIndices.length; j++) {
          outcomes.push(stages[outcomeIndices[j]]);
        }
        groups[entryIdx] = {
          entry: stages[entryIdx],
          outcomes: outcomes,
          outcomeIndices: outcomeIndices,
          groupName: groupName
        };
      }
    }

    return groups;
  }

  /**
   * Build a visual outcome group showing branching results from a parent stage.
   * Renders with a tree-style branch connector from the parent stage.
   */
  _buildOutcomeGroup(group) {
    var self = this;
    var wrapper = document.createElement('div');
    wrapper.className = 'my-2';

    // Calculate totals for the outcome group
    var totalAtOutcomes = 0;
    for (var i = 0; i < group.outcomes.length; i++) {
      totalAtOutcomes += parseInt(group.outcomes[i].at_stage_count) || 0;
    }
    var entryValue = group.entry.value || 0;

    // Branch container: vertical trunk line on the left with outcome rows branching right
    var branchContainer = document.createElement('div');
    branchContainer.className = 'relative ml-7 pl-6';

    // Vertical trunk line (positioned absolutely on the left)
    // Spans from top of first outcome to middle of last outcome
    var trunk = document.createElement('div');
    trunk.className = 'absolute left-0 top-0 bottom-0 w-px';
    trunk.style.cssText = 'left: 7px; top: 12px; bottom: 12px; width: 2px; background: #c7d2fe; border-radius: 1px;';
    branchContainer.appendChild(trunk);

    // Label above the branches
    var branchLabel = document.createElement('div');
    branchLabel.className = 'flex items-center gap-2 mb-3 -ml-1';
    branchLabel.innerHTML =
      '<svg class="w-4 h-4 text-indigo-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">' +
        '<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"></path>' +
      '</svg>' +
      '<span class="text-xs font-semibold text-indigo-500 uppercase tracking-wide">Outcomes</span>' +
      '<span class="text-xs text-gray-400">' + totalAtOutcomes + ' leads across ' + group.outcomes.length + ' paths</span>';
    branchContainer.appendChild(branchLabel);

    for (var o = 0; o < group.outcomes.length; o++) {
      var outcome = group.outcomes[o];
      var atCount = parseInt(outcome.at_stage_count) || 0;
      var pctOfEntry = entryValue > 0 ? ((atCount / entryValue) * 100).toFixed(1) : '0.0';

      // Determine color based on stage name
      var stageName = (outcome.stage_name || outcome.label || '').toLowerCase();
      var dotColor = '#3b82f6';
      var barBg = 'bg-blue-500';
      var textColorClass = 'text-blue-600';
      var borderHover = 'hover:border-blue-300';
      if (stageName.indexOf('cancel') !== -1 || stageName.indexOf('no-show') !== -1 || stageName.indexOf('no show') !== -1 || stageName.indexOf('opt out') !== -1) {
        dotColor = '#f87171';
        barBg = 'bg-red-400';
        textColorClass = 'text-red-500';
        borderHover = 'hover:border-red-300';
      } else if (stageName.indexOf('complet') !== -1 || stageName.indexOf('won') !== -1 || stageName.indexOf('showed') !== -1 || stageName.indexOf('show') !== -1) {
        dotColor = '#22c55e';
        barBg = 'bg-green-500';
        textColorClass = 'text-green-600';
        borderHover = 'hover:border-green-300';
      }

      // Each outcome row: horizontal connector + card
      var row = document.createElement('div');
      row.className = 'relative flex items-stretch mb-2';

      // Horizontal branch connector (extends from trunk to the card)
      var connector = document.createElement('div');
      connector.className = 'absolute flex items-center';
      connector.style.cssText = 'left: -24px; top: 50%; transform: translateY(-50%); width: 24px; height: 2px;';
      connector.innerHTML =
        '<div style="width: 100%; height: 2px; background: #c7d2fe;"></div>' +
        '<div style="position: absolute; right: -1px; top: 50%; transform: translateY(-50%); width: 8px; height: 8px; border-radius: 50%; background: ' + dotColor + '; border: 2px solid white; box-shadow: 0 0 0 1px ' + dotColor + ';"></div>';
      row.appendChild(connector);

      // Outcome card
      var card = document.createElement('div');
      var clickable = !!self.config.onStageClick;
      card.className = 'flex-1 rounded-lg p-3 border border-gray-200 bg-gray-50 transition-all ' + borderHover +
        (clickable ? ' cursor-pointer hover:shadow-sm' : '');

      if (clickable) {
        (function(outcomeStage, count) {
          card.onclick = function () {
            self.config.onStageClick({
              label: outcomeStage.label,
              value: count,
              pipeline_id: outcomeStage.pipeline_id || '',
              position: outcomeStage.position !== undefined ? outcomeStage.position : 0,
              pipelineName: outcomeStage.stage_detail || ''
            });
          };
        })(outcome, atCount);
      }

      // Extract clean label (remove pipeline + group prefix)
      var cleanLabel = outcome.label || '';
      var groupPrefix = group.groupName + ': ';
      var prefixPos = cleanLabel.indexOf(groupPrefix);
      if (prefixPos !== -1) {
        cleanLabel = cleanLabel.substring(prefixPos + groupPrefix.length);
      }

      var barWidth = Math.max(parseFloat(pctOfEntry), 3);
      card.innerHTML =
        '<div class="flex items-center justify-between gap-4">' +
          '<div class="flex items-center gap-3 flex-1 min-w-0">' +
            '<div class="flex-1 min-w-0">' +
              '<div class="flex items-center gap-2">' +
                '<span class="font-semibold text-sm text-gray-900">' + escapeHtml(cleanLabel) + '</span>' +
                '<span class="text-xs text-gray-400">' + atCount.toLocaleString() + ' leads</span>' +
              '</div>' +
              '<div class="mt-1.5 w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">' +
                '<div class="' + barBg + ' h-full rounded-full transition-all duration-500" style="width: ' + barWidth + '%; opacity: 0.8;"></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="flex-shrink-0 text-right pl-3">' +
            '<div class="text-lg font-bold ' + textColorClass + '">' + pctOfEntry + '%</div>' +
          '</div>' +
        '</div>';

      row.appendChild(card);
      branchContainer.appendChild(row);
    }

    wrapper.appendChild(branchContainer);
    return wrapper;
  }

  // --- Stage rendering ---

  _buildStage(stage, index, totalStages) {
    var self = this;
    var wrapper = document.createElement('div');
    wrapper.className = 'mb-3';

    var colors = this._getStageColors(stage.label);
    var bgColor = colors.bgColor;
    var textColor = colors.textColor;

    var value = stage.value || 0;
    var percentage = stage.percentage || 0;
    var dropoffRate = stage.dropoff_rate || 0;
    var previousCount = stage.previous_stage_count || 0;
    var dropped = previousCount - value;
    var barWidth = Math.max(percentage, 5);

    var card = document.createElement('div');
    var clickable = !!this.config.onStageClick;
    card.className = 'relative bg-white rounded-lg p-4 border-2 border-gray-200 hover:shadow-md transition-all' +
      (clickable ? ' cursor-pointer hover:border-indigo-300' : '');

    if (clickable) {
      card.onclick = function () {
        self.config.onStageClick({
          label: stage.label,
          value: value,
          pipeline_id: stage.pipeline_id || '',
          position: stage.position !== undefined ? stage.position : index,
          pipelineName: stage.stage_detail || ''
        });
      };
    }

    card.innerHTML =
      '<div class="flex items-start justify-between gap-4 mb-3">' +
        '<div class="flex items-start gap-3 flex-1 min-w-0">' +
          '<div class="flex-shrink-0 mt-1">' +
            '<div class="w-4 h-4 rounded-full ' + bgColor + '"></div>' +
          '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<div class="font-semibold text-gray-900 mb-1">' + escapeHtml(stage.label) + '</div>' +
            '<div class="text-sm text-gray-600">' + value.toLocaleString() + ' leads</div>' +
          '</div>' +
        '</div>' +
        '<div class="flex-shrink-0 text-right">' +
          '<div class="text-2xl font-bold ' + textColor + '">' + percentage.toFixed(1) + '%</div>' +
          '<div class="text-xs text-gray-500">of initial</div>' +
        '</div>' +
      '</div>' +
      '<div class="w-full bg-gray-100 rounded-full h-3 overflow-hidden">' +
        '<div class="' + bgColor + ' h-full rounded-full transition-all duration-500" style="width: ' + barWidth + '%"></div>' +
      '</div>';

    // Show dropoff indicator BEFORE the stage card (for all stages after the first)
    // This shows how many leads were lost entering this stage from the previous one
    // Skip if this stage follows an outcome group (the drop-off would be misleading)
    if (index > 0 && !stage._suppressDropoff) {
      wrapper.appendChild(this._buildDropoffIndicator(dropoffRate, dropped, value, previousCount));
    }

    wrapper.appendChild(card);

    return wrapper;
  }

  _buildDropoffIndicator(dropoffRate, dropped, continuingValue, previousCount) {
    var indicator = document.createElement('div');
    indicator.className = 'flex items-center gap-2 my-3 ml-6';

    if (dropoffRate > 0 && dropped > 0) {
      // Show "X of Y leads dropped" for clarity (e.g., "70 of 136 leads dropped here")
      var fromText = previousCount > 0 ? ' of ' + previousCount.toLocaleString() : '';
      indicator.innerHTML =
        '<svg class="w-5 h-5 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">' +
          '<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z" clip-rule="evenodd"></path>' +
        '</svg>' +
        '<span class="text-sm text-red-600 font-semibold">' +
          dropped.toLocaleString() + fromText + ' leads dropped (' + dropoffRate.toFixed(1) + '%)' +
        '</span>';
    } else {
      indicator.innerHTML =
        '<svg class="w-5 h-5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">' +
          '<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3-8a1 1 0 01-1 1H8a1 1 0 010-2h4a1 1 0 011 1z" clip-rule="evenodd"></path>' +
        '</svg>' +
        '<span class="text-sm text-green-600 font-semibold">All ' + continuingValue.toLocaleString() + ' leads continue</span>';
    }

    return indicator;
  }

  // --- Shared UI elements ---

  _buildHeader() {
    var header = document.createElement('div');
    header.className = 'flex items-center justify-between mb-4';

    var title = document.createElement('h3');
    title.className = 'text-lg font-semibold text-gray-900';
    title.textContent = this.config.title;
    header.appendChild(title);

    if (this.config.helpText) {
      header.appendChild(this._buildHelpButton());
    }
    return header;
  }

  _buildHelpButton() {
    var button = document.createElement('button');
    button.className = 'text-gray-400 hover:text-gray-600 transition-colors';
    button.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
    button.setAttribute('aria-label', 'Show help');
    var self = this;
    button.onclick = function () { self._showHelpModal(); };
    return button;
  }

  _buildDescription() {
    var p = document.createElement('p');
    p.className = 'text-sm text-gray-500 mb-6';
    p.textContent = this.config.description;
    return p;
  }

  _buildLegend() {
    var legend = document.createElement('div');
    legend.className = 'px-6 py-4 border-t border-gray-200';

    legend.innerHTML =
      '<div class="grid grid-cols-2 gap-4 text-xs">' +
        '<div class="flex items-center gap-2 text-gray-600">' +
          '<div class="w-3 h-3 rounded-full ' + this.config.colors.initial + '"></div>' +
          '<span>Initial Contact</span>' +
        '</div>' +
        '<div class="flex items-center gap-2 text-gray-600">' +
          '<div class="w-3 h-3 rounded-full ' + this.config.colors.opportunity + '"></div>' +
          '<span>Became Opportunity</span>' +
        '</div>' +
        '<div class="flex items-center gap-2 text-gray-600">' +
          '<div class="w-3 h-3 rounded-full ' + this.config.colors.default + '"></div>' +
          '<span>Pipeline Stages</span>' +
        '</div>' +
        '<div class="flex items-center gap-2 text-gray-600">' +
          '<div class="w-3 h-3 rounded-full ' + this.config.colors.won + '"></div>' +
          '<span>Won (Client)</span>' +
        '</div>' +
      '</div>';

    return legend;
  }

  _renderEmptyState() {
    this.container.innerHTML =
      '<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">' +
        '<div class="flex items-center mb-4">' +
          '<h3 class="text-lg font-semibold text-gray-900">' + escapeHtml(this.config.title) + '</h3>' +
        '</div>' +
        '<p class="text-gray-500 text-center py-8">No funnel data available</p>' +
      '</div>';
  }

  // --- Utilities ---

  _getStageColors(label) {
    var lowerLabel = (label || '').toLowerCase();

    if (lowerLabel.indexOf('initial contact') !== -1) {
      return { bgColor: this.config.colors.initial, textColor: this.config.colors.initial.replace('bg-', 'text-') };
    } else if (lowerLabel.indexOf('became opportunity') !== -1 || lowerLabel.indexOf('opportunity') !== -1) {
      return { bgColor: this.config.colors.opportunity, textColor: this.config.colors.opportunity.replace('bg-', 'text-') };
    } else if (lowerLabel.indexOf('won') !== -1 || lowerLabel.indexOf('matter') !== -1 || lowerLabel.indexOf('client') !== -1) {
      return { bgColor: this.config.colors.won, textColor: this.config.colors.won.replace('bg-', 'text-') };
    }
    return { bgColor: this.config.colors.default, textColor: this.config.colors.default.replace('bg-', 'text-') };
  }

  _showHelpModal() {
    if (this.config.helpText) {
      console.log('[FunnelChartRenderer] Help text:', this.config.helpText);
      alert(this.config.helpText);
    }
  }

  getState() {
    return {
      rendered: this.rendered,
      dataLength: this.data.length,
      activeTab: this._activeTab,
      groupCount: this._groups.length,
      config: Object.assign({}, this.config)
    };
  }
}
