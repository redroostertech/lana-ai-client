/**
 * FunnelChartRenderer Usage Examples
 *
 * This file demonstrates how to use the FunnelChartRenderer ES6 module
 */

import { FunnelChartRenderer } from './funnel-chart-renderer.js';

// Example 1: Basic funnel chart
function exampleBasic() {
  const funnelData = [
    {
      label: 'Initial Contact',
      value: 1000,
      percentage: 100,
      dropoff_rate: 0,
      previous_stage_count: 1000
    },
    {
      label: 'Became Opportunity',
      value: 600,
      percentage: 60,
      dropoff_rate: 40,
      previous_stage_count: 1000
    },
    {
      label: 'Stage 1: Qualification',
      value: 450,
      percentage: 45,
      dropoff_rate: 25,
      previous_stage_count: 600
    },
    {
      label: 'Stage 2: Proposal',
      value: 300,
      percentage: 30,
      dropoff_rate: 33.3,
      previous_stage_count: 450
    },
    {
      label: 'Won (Client Matter)',
      value: 150,
      percentage: 15,
      dropoff_rate: 50,
      previous_stage_count: 300
    }
  ];

  const renderer = new FunnelChartRenderer('funnel-container', funnelData, {
    title: 'Sales Funnel',
    description: 'Lead conversion through sales pipeline',
    showLegend: true
  });

  renderer.render();
}

// Example 2: Custom colors
function exampleCustomColors() {
  const funnelData = [
    { label: 'Initial Contact', value: 500, percentage: 100 },
    { label: 'Became Opportunity', value: 300, percentage: 60 },
    { label: 'Won (Client)', value: 150, percentage: 30 }
  ];

  const renderer = new FunnelChartRenderer('funnel-container-2', funnelData, {
    title: 'Custom Color Funnel',
    colors: {
      initial: 'bg-cyan-500',
      opportunity: 'bg-orange-500',
      won: 'bg-emerald-500',
      default: 'bg-slate-500'
    }
  });

  renderer.render();
}

// Example 3: Dynamic update
function exampleDynamicUpdate() {
  const initialData = [
    { label: 'Stage 1', value: 100, percentage: 100 },
    { label: 'Stage 2', value: 75, percentage: 75 },
    { label: 'Stage 3', value: 50, percentage: 50 }
  ];

  const renderer = new FunnelChartRenderer('funnel-container-3', initialData, {
    title: 'Dynamic Funnel',
    showLegend: false
  });

  renderer.render();

  // Update after 2 seconds
  setTimeout(() => {
    const updatedData = [
      { label: 'Stage 1', value: 120, percentage: 100 },
      { label: 'Stage 2', value: 96, percentage: 80 },
      { label: 'Stage 3', value: 72, percentage: 60 }
    ];

    renderer.update(updatedData);
  }, 2000);
}

// Example 4: Integration with module-execution.html pattern
function exampleModuleExecution(viz, data, uniqueId) {
  // Find the metric with funnel progression data
  const metric = data.metrics.find(m => viz.metrics && viz.metrics.includes(m.key));

  if (!metric || !Array.isArray(metric.current)) {
    console.warn('No funnel data available');
    return;
  }

  const funnelData = metric.current;

  const renderer = new FunnelChartRenderer(
    `funnel-chart-${uniqueId}`,
    funnelData,
    {
      title: viz.title || 'Funnel Chart',
      description: viz.description,
      helpText: viz.helpText,
      showLegend: true
    }
  );

  return renderer.render();
}

// Example 5: Cleanup when component unmounts
function exampleCleanup() {
  const renderer = new FunnelChartRenderer('funnel-container-4', [], {
    title: 'Temporary Funnel'
  });

  renderer.render();

  // Later, when component is removed:
  renderer.destroy();
}

// Export examples
export {
  exampleBasic,
  exampleCustomColors,
  exampleDynamicUpdate,
  exampleModuleExecution,
  exampleCleanup
};
