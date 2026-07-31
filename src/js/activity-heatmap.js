/**
 * Activity Heatmap Component
 * GitHub-style contribution graph for user productivity visualization
 *
 * Usage:
 *   ActivityHeatmap.render(containerId, data, options)
 */

const ActivityHeatmap = (function() {
  'use strict';

  /**
   * Default configuration
   */
  const DEFAULT_CONFIG = {
    cellSize: 6,
    cellGap: 3,
    monthLabels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    dayLabels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    showDayLabels: true,
    showMonthLabels: true,
    tooltip: true,
    colorScheme: {
      0: '#ebedf0',      // No activity (light gray)
      1: '#9be9a8',      // Low activity (light green)
      2: '#40c463',      // Medium activity (green)
      3: '#30a14e',      // High activity (darker green)
      4: '#216e39'       // Very high activity (darkest green)
    },
    thresholds: [0, 10, 50, 150, 300]  // Activity count thresholds for each color level (0, 10-49, 50-149, 150-299, 300+)
  };

  /**
   * Render the activity heatmap
   *
   * @param {string} containerId - ID of the container element
   * @param {Array<{date: string, count: number}>} data - Activity data
   * @param {Object} options - Optional configuration overrides
   */
  function render(containerId, data, options = {}) {
    const config = { ...DEFAULT_CONFIG, ...options };
    const container = document.getElementById(containerId);

    if (!container) {
      console.error(`Container with ID "${containerId}" not found`);
      return;
    }

    // Clear existing content
    container.innerHTML = '';

    // Convert data array to map for quick lookup
    const activityMap = new Map();
    data.forEach(item => {
      activityMap.set(item.date, parseInt(item.count) || 0);
    });

    // Calculate date range (last 90 days by default)
    const endDate = Lex.Utils.nowDate();
    const startDate = Lex.Utils.addDays(endDate, -89); // 90 days including today

    // Generate all dates in range
    const allDates = generateDateRange(startDate, endDate);

    // Group dates by week
    const weeks = groupByWeek(allDates);

    // Create SVG container
    const svg = createSVG(weeks, config);
    container.appendChild(svg);

    // Render cells
    renderCells(svg, weeks, activityMap, config);

    // Render labels
    if (config.showDayLabels) {
      renderDayLabels(svg, config);
    }
    if (config.showMonthLabels) {
      renderMonthLabels(svg, weeks, config);
    }

    // Add legend
    renderLegend(container, config);

    // Add tooltip
    if (config.tooltip) {
      addTooltip(container);
    }
  }


  /**
   * Generate array of dates between start and end
   */
  function generateDateRange(start, end) {
    const dates = [];
    const currentDate = new Date(start);

    while (currentDate <= end) {
      dates.push(new Date(currentDate));
      currentDate = Lex.Utils.addDays(currentDate, 1);
    }

    return dates;
  }

  /**
   * Group dates by week (Sunday start)
   */
  function groupByWeek(dates) {
    const weeks = [];
    let currentWeek = [];

    // Pad beginning with empty cells to align to Sunday
    const firstDayOfWeek = dates[0].getDay();
    for (let i = 0; i < firstDayOfWeek; i++) {
      currentWeek.push(null);
    }

    dates.forEach(date => {
      currentWeek.push(date);

      // Start new week on Sunday
      if (date.getDay() === 6) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    });

    // Add remaining days
    if (currentWeek.length > 0) {
      // Pad end with empty cells
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      weeks.push(currentWeek);
    }

    return weeks;
  }

  /**
   * Create SVG element (responsive: scales to full width of container)
   */
  function createSVG(weeks, config) {
    const width = weeks.length * (config.cellSize + config.cellGap) + 30; // Extra space for day labels
    const height = 7 * (config.cellSize + config.cellGap) + 14; // 7 days + space for month labels (compact)

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
    svg.setAttribute('class', 'activity-heatmap-svg');
    svg.style.width = '100%';
    svg.style.height = 'auto';
    svg.style.maxHeight = '260px';

    return svg;
  }

  /**
   * Render activity cells
   */
  function renderCells(svg, weeks, activityMap, config) {
    const xOffset = config.showDayLabels ? 30 : 0;
    const yOffset = config.showMonthLabels ? 16 : 0;

    weeks.forEach((week, weekIndex) => {
      week.forEach((date, dayIndex) => {
        if (!date) return; // Skip empty cells

        const dateStr = formatDate(date);
        const count = activityMap.get(dateStr) || 0;
        const level = getActivityLevel(count, config.thresholds);
        const color = config.colorScheme[level];

        const x = weekIndex * (config.cellSize + config.cellGap) + xOffset;
        const y = dayIndex * (config.cellSize + config.cellGap) + yOffset;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', config.cellSize);
        rect.setAttribute('height', config.cellSize);
        rect.setAttribute('rx', 2);
        rect.setAttribute('fill', color);
        rect.setAttribute('class', 'activity-cell');
        rect.setAttribute('data-date', dateStr);
        rect.setAttribute('data-count', count);
        rect.setAttribute('data-level', level);

        // Add hover effect
        rect.style.cursor = 'pointer';
        rect.addEventListener('mouseenter', function(e) {
          rect.style.stroke = '#333';
          rect.style.strokeWidth = '1px';
          showTooltip(e, dateStr, count);
        });
        rect.addEventListener('mouseleave', function() {
          rect.style.stroke = 'none';
          hideTooltip();
        });

        svg.appendChild(rect);
      });
    });
  }

  /**
   * Render day labels (Mon, Wed, Fri)
   */
  function renderDayLabels(svg, config) {
    const yOffset = config.showMonthLabels ? 16 : 0;
    const labelsToShow = [1, 3, 5]; // Monday, Wednesday, Friday

    labelsToShow.forEach(dayIndex => {
      const y = dayIndex * (config.cellSize + config.cellGap) + yOffset + config.cellSize / 2;

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', 0);
      text.setAttribute('y', y);
      text.setAttribute('text-anchor', 'start');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('class', 'activity-day-label');
      text.style.fontSize = '7px';
      text.style.fill = '#6b7280';
      text.textContent = config.dayLabels[dayIndex];

      svg.appendChild(text);
    });
  }

  /**
   * Render month labels (with minimum spacing to prevent overlap, e.g. Oct/Nov)
   */
  function renderMonthLabels(svg, weeks, config) {
    const xOffset = config.showDayLabels ? 30 : 0;
    const minLabelGap = 22; // min pixels between start of one month label and the next
    let currentMonth = -1;
    let lastLabelX = -minLabelGap;

    weeks.forEach((week, weekIndex) => {
      const firstDate = week.find(d => d !== null);
      if (!firstDate) return;

      const month = firstDate.getMonth();
      if (month !== currentMonth) {
        currentMonth = month;

        let x = weekIndex * (config.cellSize + config.cellGap) + xOffset;
        if (x < lastLabelX + minLabelGap) {
          x = lastLabelX + minLabelGap;
        }
        lastLabelX = x;

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', 10);
        text.setAttribute('text-anchor', 'start');
        text.setAttribute('class', 'activity-month-label');
        text.style.fontSize = '7px';
        text.style.fill = '#6b7280';
        text.textContent = config.monthLabels[month];

        svg.appendChild(text);
      }
    });
  }

  /**
   * Render legend
   */
  function renderLegend(container, config) {
    const legend = document.createElement('div');
    legend.className = 'activity-legend';
    legend.style.display = 'flex';
    legend.style.alignItems = 'center';
    legend.style.justifyContent = 'center';
    legend.style.marginTop = '8px';
    legend.style.fontSize = '12px';
    legend.style.color = '#6b7280';

    legend.innerHTML = `
      <span style="margin-right: 8px;">Less</span>
      ${Object.entries(config.colorScheme).map(([level, color]) => `
        <div style="width: ${config.cellSize}px; height: ${config.cellSize}px; background-color: ${color}; margin: 0 2px; border-radius: 2px;"></div>
      `).join('')}
      <span style="margin-left: 8px;">More</span>
    `;

    container.appendChild(legend);
  }

  /**
   * Ensure tooltip container exists. Reuses the element from dashboard.html
   * if already present; creates one inside the given container otherwise.
   */
  function addTooltip(container) {
    if (document.getElementById('activity-heatmap-tooltip')) return;

    var tooltip = document.createElement('div');
    tooltip.id = 'activity-heatmap-tooltip';
    tooltip.style.position = 'absolute';
    tooltip.style.display = 'none';
    tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
    tooltip.style.color = 'white';
    tooltip.style.padding = '8px 12px';
    tooltip.style.borderRadius = '6px';
    tooltip.style.fontSize = '12px';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.zIndex = '1000';
    tooltip.style.whiteSpace = 'nowrap';
    tooltip.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';

    container.appendChild(tooltip);
  }

  /**
   * Show tooltip
   */
  function showTooltip(event, date, count) {
    const tooltip = document.getElementById('activity-heatmap-tooltip');
    if (!tooltip) return;

    const formattedDate = formatDateReadable(date);
    const activityText = count === 1 ? 'activity' : 'activities';
    const formattedCount = formatActivityCount(count);

    tooltip.innerHTML = `
      <div><strong>${formattedCount} ${activityText}</strong></div>
      <div style="font-size: 11px; margin-top: 2px; opacity: 0.8;">${formattedDate}</div>
    `;

    tooltip.style.display = 'block';
    tooltip.style.left = (event.pageX + 10) + 'px';
    tooltip.style.top = (event.pageY - 10) + 'px';
  }

  /**
   * Format activity counts for compact tooltip display.
   */
  function formatActivityCount(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return '0';
    const whole = Math.trunc(n);
    if (whole < 1000) return String(whole);

    const format = (scaled, suffix) => {
      const rounded = Math.round(scaled * 10) / 10;
      const str = rounded % 1 === 0 ? String(Math.trunc(rounded)) : rounded.toFixed(1);
      return str + suffix;
    };

    if (whole >= 1000000000) return format(whole / 1000000000, 'B');
    if (whole >= 1000000) return format(whole / 1000000, 'M');
    return format(whole / 1000, 'K');
  }

  /**
   * Hide tooltip
   */
  function hideTooltip() {
    const tooltip = document.getElementById('activity-heatmap-tooltip');
    if (tooltip) {
      tooltip.style.display = 'none';
    }
  }

  /**
   * Get activity level based on count and thresholds
   */
  function getActivityLevel(count, thresholds) {
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (count >= thresholds[i]) {
        return i;
      }
    }
    return 0;
  }

  /**
   * Format date as YYYY-MM-DD
   */
  function formatDate(date) {
    return date.toISOString().split('T')[0];
  }

  /**
   * Format date as readable string (e.g., "Jan 15, 2026")
   */
  function formatDateReadable(dateStr) {
    const date = new Date(dateStr + 'T00:00:00');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }

  // Public API
  return {
    render
  };
})();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ActivityHeatmap;
}
