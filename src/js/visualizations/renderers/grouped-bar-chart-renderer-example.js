/**
 * GroupedBarChartRenderer Usage Example
 *
 * This file demonstrates how to use the GroupedBarChartRenderer class
 * to render multi-series bar charts with LANA AI data.
 *
 * @example
 * Include this file in your HTML:
 * <script type="module" src="../js/visualizations/renderers/grouped-bar-chart-renderer-example.js"></script>
 */

import { GroupedBarChartRenderer, createGroupedBarChart } from './grouped-bar-chart-renderer.js';

/**
 * Example 1: Lead Source Performance (from module-execution.html)
 * Shows contact rate and qualified rate by lead source
 */
export function renderLeadSourcePerformance() {
  const data = [
    {
      source_name: 'Referrals',
      contact_rate: 85.2,
      qualified_rate: 62.5,
      lead_count: 120
    },
    {
      source_name: 'Website',
      contact_rate: 72.4,
      qualified_rate: 45.8,
      lead_count: 85
    },
    {
      source_name: 'Paid Ads',
      contact_rate: 65.0,
      qualified_rate: 38.2,
      lead_count: 45
    },
    {
      source_name: 'Direct Outreach',
      contact_rate: 58.3,
      qualified_rate: 32.1,
      lead_count: 30
    }
  ];

  const renderer = new GroupedBarChartRenderer('lead-source-chart', data, {
    title: 'Lead Source Performance Analysis',
    description: 'Contact and qualification rates across all lead sources',
    xAxis: {
      field: 'source_name',
      label: 'Lead Source'
    },
    yAxis: {
      label: 'Conversion Rate (%)',
      min: 0,
      max: 100,
      beginAtZero: true
    },
    series: [
      {
        label: 'Contact Rate',
        field: 'contact_rate',
        color: '#3b82f6'  // Blue
      },
      {
        label: 'Qualified Rate',
        field: 'qualified_rate',
        color: '#10b981'  // Green
      }
    ],
    annotations: {
      field: 'lead_count',
      label: 'Total Leads: {value}'
    },
    legend: {
      position: 'bottom',
      display: true
    },
    helpText: {
      content: `
        <p><strong>Contact Rate:</strong> Percentage of leads successfully contacted</p>
        <p><strong>Qualified Rate:</strong> Percentage of contacted leads that became qualified opportunities</p>
        <p>Hover over bars to see total lead count for each source.</p>
      `
    },
    onBarClick: (dataIndex, seriesIndex, value, label, series) => {
      console.log(`Clicked: ${series.label} for ${label} = ${value}%`);
      // In real implementation, open drill-down view
      alert(`Viewing ${series.label} details for ${label}: ${value}%`);
    }
  });

  renderer.render();
  return renderer;
}

/**
 * Example 2: Quarterly Sales by Region
 * Demonstrates multiple series with different colors
 */
export function renderQuarterlySales() {
  const data = [
    { region: 'North', q1: 125000, q2: 145000, q3: 162000, q4: 178000 },
    { region: 'South', q1: 98000, q2: 112000, q3: 128000, q4: 135000 },
    { region: 'East', q1: 110000, q2: 128000, q3: 142000, q4: 158000 },
    { region: 'West', q1: 88000, q2: 95000, q3: 108000, q4: 122000 }
  ];

  return createGroupedBarChart('quarterly-sales-chart', data, {
    title: 'Quarterly Sales Performance by Region',
    description: 'Revenue across all regions for the current year',
    xAxis: { field: 'region', label: 'Region' },
    yAxis: { label: 'Revenue ($)', min: 0 },
    series: [
      { label: 'Q1 2024', field: 'q1', color: '#3b82f6' },
      { label: 'Q2 2024', field: 'q2', color: '#10b981' },
      { label: 'Q3 2024', field: 'q3', color: '#f59e0b' },
      { label: 'Q4 2024', field: 'q4', color: '#ef4444' }
    ],
    legend: { position: 'top' }
  });
}

/**
 * Example 3: Matter Status by Type
 * Shows distribution of matter statuses across matter types
 */
export function renderMatterStatusDistribution() {
  const data = [
    { matter_type: 'Litigation', active: 45, closed: 32, on_hold: 8 },
    { matter_type: 'Corporate', active: 28, closed: 56, on_hold: 3 },
    { matter_type: 'Real Estate', active: 19, closed: 24, on_hold: 2 },
    { matter_type: 'Immigration', active: 34, closed: 18, on_hold: 6 },
    { matter_type: 'Family Law', active: 22, closed: 15, on_hold: 4 }
  ];

  const renderer = new GroupedBarChartRenderer('matter-status-chart', data, {
    title: 'Matter Status Distribution by Type',
    description: 'Current matter counts across all practice areas',
    xAxis: {
      field: 'matter_type',
      label: 'Practice Area'
    },
    yAxis: {
      label: 'Matter Count',
      min: 0
    },
    series: [
      {
        label: 'Active',
        field: 'active',
        color: '#10b981'  // Green
      },
      {
        label: 'Closed',
        field: 'closed',
        color: '#6b7280'  // Gray
      },
      {
        label: 'On Hold',
        field: 'on_hold',
        color: '#f59e0b'  // Amber
      }
    ],
    legend: {
      position: 'bottom'
    }
  });

  renderer.render();
  return renderer;
}

/**
 * Example 4: Staff Productivity Metrics
 * Billable vs non-billable hours
 */
export function renderStaffProductivity() {
  const data = [
    { staff_member: 'John Smith', billable_hours: 145, non_billable_hours: 35 },
    { staff_member: 'Sarah Johnson', billable_hours: 132, non_billable_hours: 48 },
    { staff_member: 'Mike Wilson', billable_hours: 128, non_billable_hours: 52 },
    { staff_member: 'Emily Davis', billable_hours: 156, non_billable_hours: 24 }
  ];

  const renderer = new GroupedBarChartRenderer('staff-productivity-chart', data, {
    title: 'Staff Productivity - Monthly Hours',
    description: 'Billable vs non-billable hours for current month',
    xAxis: {
      field: 'staff_member',
      label: 'Staff Member'
    },
    yAxis: {
      label: 'Hours',
      min: 0,
      max: 200
    },
    series: [
      {
        label: 'Billable Hours',
        field: 'billable_hours',
        color: '#10b981'  // Green (good)
      },
      {
        label: 'Non-Billable Hours',
        field: 'non_billable_hours',
        color: '#6b7280'  // Gray (neutral)
      }
    ],
    helpText: {
      content: `
        <p><strong>Billable Hours:</strong> Time spent on client matters that can be invoiced</p>
        <p><strong>Non-Billable Hours:</strong> Administrative, training, and internal work</p>
        <p><strong>Target:</strong> 80% billable utilization (144+ billable hours per month)</p>
      `
    }
  });

  renderer.render();
  return renderer;
}

/**
 * Example 5: Integration with Module Execution Pattern
 * Shows how to use with LANA AI module configuration
 */
export function renderFromModuleConfig(viz, uniqueId) {
  /**
   * Expected viz structure from module-execution.html:
   * {
   *   type: 'grouped_bar_chart',
   *   title: 'Chart Title',
   *   description: 'Chart description',
   *   data: [...],  // Array of data objects
   *   xAxis: { field: 'category_field', label: 'X Axis Label' },
   *   yAxis: { label: 'Y Axis Label', min: 0, max: 100 },
   *   series: [
   *     { label: 'Series 1', field: 'field1', color: '#3b82f6' },
   *     { label: 'Series 2', field: 'field2', color: '#10b981' }
   *   ],
   *   annotations: { field: 'annotation_field', label: 'Label: {value}' },
   *   helpText: 'Help text content'
   * }
   */

  // Create container for the chart
  const container = document.createElement('div');
  container.id = `grouped-bar-container-${uniqueId}`;

  // Render chart using configuration from module
  const renderer = new GroupedBarChartRenderer(container, viz.data, {
    title: viz.title,
    description: viz.description,
    xAxis: viz.xAxis,
    yAxis: viz.yAxis,
    series: viz.series,
    annotations: viz.annotations,
    helpText: viz.helpText ? { content: viz.helpText } : null,
    uniqueId: uniqueId,
    onBarClick: (dataIndex, seriesIndex, value, label, series) => {
      // Handle drill-down if configured in module
      if (viz.drilldown && window.openDrilldown) {
        window.openDrilldown(viz.drilldown.metricKey, {
          category: label,
          series: series.label,
          value: value,
          ...viz.drilldown.filters
        });
      }
    }
  });

  renderer.render();

  return container;
}

/**
 * Demo: Render all examples on page load
 * Uncomment to test all examples
 */
// document.addEventListener('DOMContentLoaded', () => {
//   console.log('[GroupedBarChartRenderer] Rendering examples...');
//
//   renderLeadSourcePerformance();
//   renderQuarterlySales();
//   renderMatterStatusDistribution();
//   renderStaffProductivity();
//
//   console.log('[GroupedBarChartRenderer] All examples rendered successfully');
// });
