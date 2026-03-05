/**
 * Insights Module - AI-powered Business Intelligence
 * Handles aging analysis, missed follow-ups, attribution, predictions, and more
 */

// Mock data for insights
const InsightsMockData = {
  // KPI Summary Data
  kpiSummary: {
    openOpportunities: 47,
    agingOpportunities: 12,
    missedFollowups: 8,
    predictedNoShows: 3,
    revenueForecast30: 125000,
    revenueForecast60: 285000,
    revenueForecast90: 420000,
    conversionRate: 32.5,
    avgResponseTime: 2.4 // hours
  },

  // Aging Opportunities
  agingOpportunities: [
    { id: 'opp-001', name: 'John Smith', source: 'Google Ads', value: 15000, daysSinceContact: 18, assignedRep: 'Sarah Johnson', status: 'red', email: 'john.smith@email.com', phone: '(555) 123-4567', practiceArea: 'Personal Injury' },
    { id: 'opp-002', name: 'Maria Garcia', source: 'Referral', value: 25000, daysSinceContact: 16, assignedRep: 'Mike Williams', status: 'red', email: 'maria.g@email.com', phone: '(555) 234-5678', practiceArea: 'Family Law' },
    { id: 'opp-003', name: 'Robert Chen', source: 'Facebook', value: 8000, daysSinceContact: 15, assignedRep: 'Sarah Johnson', status: 'red', email: 'rchen@email.com', phone: '(555) 345-6789', practiceArea: 'Estate Planning' },
    { id: 'opp-004', name: 'Emily Brown', source: 'Website', value: 12000, daysSinceContact: 11, assignedRep: 'Lisa Anderson', status: 'yellow', email: 'ebrown@email.com', phone: '(555) 456-7890', practiceArea: 'Personal Injury' },
    { id: 'opp-005', name: 'David Wilson', source: 'Google Ads', value: 20000, daysSinceContact: 10, assignedRep: 'Mike Williams', status: 'yellow', email: 'dwilson@email.com', phone: '(555) 567-8901', practiceArea: 'Criminal Defense' },
    { id: 'opp-006', name: 'Jennifer Lee', source: 'Referral', value: 18000, daysSinceContact: 9, assignedRep: 'Sarah Johnson', status: 'yellow', email: 'jlee@email.com', phone: '(555) 678-9012', practiceArea: 'Business Law' },
    { id: 'opp-007', name: 'Michael Taylor', source: 'Yelp', value: 10000, daysSinceContact: 5, assignedRep: 'Lisa Anderson', status: 'green', email: 'mtaylor@email.com', phone: '(555) 789-0123', practiceArea: 'Real Estate' },
    { id: 'opp-008', name: 'Amanda Martinez', source: 'Website', value: 22000, daysSinceContact: 3, assignedRep: 'Mike Williams', status: 'green', email: 'amartinez@email.com', phone: '(555) 890-1234', practiceArea: 'Personal Injury' },
    { id: 'opp-009', name: 'Christopher Davis', source: 'Google Ads', value: 14000, daysSinceContact: 2, assignedRep: 'Sarah Johnson', status: 'green', email: 'cdavis@email.com', phone: '(555) 901-2345', practiceArea: 'Family Law' },
    { id: 'opp-010', name: 'Jessica Anderson', source: 'Facebook', value: 16000, daysSinceContact: 1, assignedRep: 'Lisa Anderson', status: 'green', email: 'janderson@email.com', phone: '(555) 012-3456', practiceArea: 'Estate Planning' }
  ],

  // Missed Follow-ups
  missedFollowups: [
    { id: 'fu-001', clientName: 'John Smith', followupType: 'call', dueDate: '2024-11-28', daysOverdue: 3, assignedRep: 'Sarah Johnson', priority: 'high', notes: 'Follow up on consultation feedback' },
    { id: 'fu-002', clientName: 'Maria Garcia', followupType: 'email', dueDate: '2024-11-27', daysOverdue: 4, assignedRep: 'Mike Williams', priority: 'high', notes: 'Send engagement letter' },
    { id: 'fu-003', clientName: 'Robert Chen', followupType: 'meeting', dueDate: '2024-11-29', daysOverdue: 2, assignedRep: 'Lisa Anderson', priority: 'medium', notes: 'Schedule second consultation' },
    { id: 'fu-004', clientName: 'Emily Brown', followupType: 'call', dueDate: '2024-11-26', daysOverdue: 5, assignedRep: 'Sarah Johnson', priority: 'high', notes: 'Check decision status' },
    { id: 'fu-005', clientName: 'David Wilson', followupType: 'email', dueDate: '2024-11-30', daysOverdue: 1, assignedRep: 'Mike Williams', priority: 'low', notes: 'Send case update' },
    { id: 'fu-006', clientName: 'Jennifer Lee', followupType: 'call', dueDate: '2024-11-25', daysOverdue: 6, assignedRep: 'Lisa Anderson', priority: 'high', notes: 'Urgent: Contract review needed' },
    { id: 'fu-007', clientName: 'Michael Taylor', followupType: 'meeting', dueDate: '2024-11-28', daysOverdue: 3, assignedRep: 'Sarah Johnson', priority: 'medium', notes: 'Discuss settlement options' },
    { id: 'fu-008', clientName: 'Amanda Martinez', followupType: 'email', dueDate: '2024-11-29', daysOverdue: 2, assignedRep: 'Mike Williams', priority: 'low', notes: 'Thank you note' }
  ],

  // Attribution Data
  attributionData: [
    { channel: 'Google Ads', leads: 145, consultations: 89, clients: 34, revenue: 425000, spend: 45000, cpa: 1324, roi: 844 },
    { channel: 'Facebook Ads', leads: 98, consultations: 52, clients: 18, revenue: 180000, spend: 22000, cpa: 1222, roi: 718 },
    { channel: 'Referrals', leads: 67, consultations: 58, clients: 42, revenue: 520000, spend: 5000, cpa: 119, roi: 10300 },
    { channel: 'Website/SEO', leads: 112, consultations: 67, clients: 28, revenue: 310000, spend: 15000, cpa: 536, roi: 1967 },
    { channel: 'Yelp', leads: 34, consultations: 22, clients: 8, revenue: 85000, spend: 8000, cpa: 1000, roi: 963 },
    { channel: 'LSA (Local Services)', leads: 56, consultations: 38, clients: 15, revenue: 165000, spend: 12000, cpa: 800, roi: 1275 },
    { channel: 'Avvo', leads: 23, consultations: 14, clients: 5, revenue: 48000, spend: 6000, cpa: 1200, roi: 700 },
    { channel: 'Direct/Walk-in', leads: 12, consultations: 10, clients: 6, revenue: 72000, spend: 0, cpa: 0, roi: 0 }
  ],

  // Predictions
  predictions: {
    noShows: [
      { id: 'appt-001', clientName: 'Thomas White', appointmentTime: '2024-12-01T10:00:00', probability: 0.75, riskFactors: ['No confirmation response', 'First-time client', 'Booked 2+ weeks ago'], suggestedAction: 'Send reminder call today' },
      { id: 'appt-002', clientName: 'Sarah Miller', appointmentTime: '2024-12-01T14:00:00', probability: 0.45, riskFactors: ['Rescheduled twice before', 'No deposit paid'], suggestedAction: 'Confirm via SMS' },
      { id: 'appt-003', clientName: 'James Johnson', appointmentTime: '2024-12-01T16:00:00', probability: 0.35, riskFactors: ['Long drive distance', 'Weekend appointment'], suggestedAction: 'Offer video consultation option' }
    ],
    revenueForecasts: {
      '30_day': { value: 125000, confidence: 0.85, comparisonLastPeriod: 12 },
      '60_day': { value: 285000, confidence: 0.72, comparisonLastPeriod: 8 },
      '90_day': { value: 420000, confidence: 0.58, comparisonLastPeriod: 15 }
    },
    caseDurations: [
      { matterId: 'm-001', matterName: 'Smith v. Johnson', estimatedCompletion: '2025-02-15', confidence: 0.78, factors: ['Complex discovery', 'Multiple parties'] },
      { matterId: 'm-002', matterName: 'Garcia Family Trust', estimatedCompletion: '2025-01-30', confidence: 0.85, factors: ['Standard process', 'Client responsive'] },
      { matterId: 'm-003', matterName: 'Chen Estate', estimatedCompletion: '2025-03-10', confidence: 0.65, factors: ['Court backlog', 'Beneficiary disputes'] }
    ]
  },

  // Funnel Data
  funnelData: {
    stages: [
      { name: 'Lead', count: 547, value: 5470000 },
      { name: 'Consultation Scheduled', count: 312, value: 3120000 },
      { name: 'Consultation Completed', count: 245, value: 2450000 },
      { name: 'Verbal Yes', count: 156, value: 1560000 },
      { name: 'Engagement Letter Sent', count: 142, value: 1420000 },
      { name: 'Signed Client', count: 128, value: 1680000 }
    ],
    conversionRates: {
      'Lead to Scheduled': 57.0,
      'Scheduled to Completed': 78.5,
      'Completed to Verbal Yes': 63.7,
      'Verbal Yes to EL Sent': 91.0,
      'EL Sent to Signed': 90.1
    },
    avgStageDuration: {
      'Lead to Scheduled': 2.3,
      'Scheduled to Completed': 5.2,
      'Completed to Verbal Yes': 1.8,
      'Verbal Yes to EL Sent': 0.5,
      'EL Sent to Signed': 3.1
    }
  },

  // Staff Productivity
  staffMetrics: [
    {
      id: 'rep-001',
      name: 'Sarah Johnson',
      role: 'Intake Specialist',
      metrics: {
        followupsAssigned: 45,
        followupsCompleted: 42,
        completionRate: 93.3,
        avgResponseTime: 1.8,
        consultationsBooked: 28,
        clientsSigned: 12,
        conversionRate: 42.9,
        revenueGenerated: 156000
      }
    },
    {
      id: 'rep-002',
      name: 'Mike Williams',
      role: 'Intake Specialist',
      metrics: {
        followupsAssigned: 52,
        followupsCompleted: 44,
        completionRate: 84.6,
        avgResponseTime: 2.4,
        consultationsBooked: 32,
        clientsSigned: 10,
        conversionRate: 31.3,
        revenueGenerated: 128000
      }
    },
    {
      id: 'rep-003',
      name: 'Lisa Anderson',
      role: 'Intake Specialist',
      metrics: {
        followupsAssigned: 38,
        followupsCompleted: 36,
        completionRate: 94.7,
        avgResponseTime: 1.5,
        consultationsBooked: 24,
        clientsSigned: 11,
        conversionRate: 45.8,
        revenueGenerated: 142000
      }
    },
    {
      id: 'rep-004',
      name: 'David Brown',
      role: 'Senior Intake',
      metrics: {
        followupsAssigned: 35,
        followupsCompleted: 35,
        completionRate: 100,
        avgResponseTime: 1.2,
        consultationsBooked: 30,
        clientsSigned: 15,
        conversionRate: 50.0,
        revenueGenerated: 195000
      }
    }
  ]
};

// Empty state data (shown when no real data is available)
const InsightsEmptyState = {
  kpiSummary: {
    openOpportunities: 0,
    agingOpportunities: 0,
    missedFollowups: 0,
    predictedNoShows: 0,
    revenueForecast30: 0,
    revenueForecast60: 0,
    revenueForecast90: 0,
    conversionRate: 0,
    avgResponseTime: 0
  },
  agingOpportunities: { opportunities: [], summary: { green: 0, yellow: 0, red: 0, totalValue: 0 } },
  missedFollowups: { followups: [], summary: { total: 0, high: 0, medium: 0, low: 0 } },
  attributionData: { channels: [], totals: { leads: 0, consultations: 0, clients: 0, revenue: 0, spend: 0 } },
  predictions: { noShows: [], forecasts: { '30_day': { value: 0, confidence: 0, comparisonLastPeriod: 0 }, '60_day': { value: 0, confidence: 0, comparisonLastPeriod: 0 }, '90_day': { value: 0, confidence: 0, comparisonLastPeriod: 0 } }, caseDurations: [] },
  funnelData: { stages: [], conversionRates: {}, avgStageDuration: {} },
  staffMetrics: { staff: [] }
};

// Insights API
const Insights = {
  /**
   * Get KPI summary
   */
  async getKPISummary() {
    // DEMO MODE - Uncomment to show mock data
    // if (api.isDemoMode()) {
    //   await MockData.delay(300);
    //   return InsightsMockData.kpiSummary;
    // }
    // return api.get('/api/v1/insights/kpi-summary');

    // Empty state - no data available yet
    return InsightsEmptyState.kpiSummary;
  },

  /**
   * Get aging opportunities
   */
  async getAgingOpportunities(filters = {}) {
    // DEMO MODE - Uncomment to show mock data
    // if (api.isDemoMode()) {
    //   await MockData.delay(400);
    //   let data = [...InsightsMockData.agingOpportunities];
    //   if (filters.status) data = data.filter(o => o.status === filters.status);
    //   if (filters.rep) data = data.filter(o => o.assignedRep === filters.rep);
    //   if (filters.source) data = data.filter(o => o.source === filters.source);
    //   return {
    //     opportunities: data,
    //     summary: {
    //       green: data.filter(o => o.status === 'green').length,
    //       yellow: data.filter(o => o.status === 'yellow').length,
    //       red: data.filter(o => o.status === 'red').length,
    //       totalValue: data.reduce((sum, o) => sum + o.value, 0)
    //     }
    //   };
    // }
    // return api.get('/api/v1/insights/aging', filters);

    // Empty state - no data available yet
    return InsightsEmptyState.agingOpportunities;
  },

  /**
   * Get missed follow-ups
   */
  async getMissedFollowups(filters = {}) {
    // DEMO MODE - Uncomment to show mock data
    // if (api.isDemoMode()) {
    //   await MockData.delay(350);
    //   let data = [...InsightsMockData.missedFollowups];
    //   if (filters.rep) data = data.filter(f => f.assignedRep === filters.rep);
    //   if (filters.type) data = data.filter(f => f.followupType === filters.type);
    //   if (filters.priority) data = data.filter(f => f.priority === filters.priority);
    //   return {
    //     followups: data,
    //     summary: {
    //       total: data.length,
    //       high: data.filter(f => f.priority === 'high').length,
    //       medium: data.filter(f => f.priority === 'medium').length,
    //       low: data.filter(f => f.priority === 'low').length
    //     }
    //   };
    // }
    // return api.get('/api/v1/insights/missed-followups', filters);

    // Empty state - no data available yet
    return InsightsEmptyState.missedFollowups;
  },

  /**
   * Get attribution data
   */
  async getAttributionData(dateRange = {}) {
    // DEMO MODE - Uncomment to show mock data
    // if (api.isDemoMode()) {
    //   await MockData.delay(500);
    //   return {
    //     channels: InsightsMockData.attributionData,
    //     totals: {
    //       leads: InsightsMockData.attributionData.reduce((sum, c) => sum + c.leads, 0),
    //       consultations: InsightsMockData.attributionData.reduce((sum, c) => sum + c.consultations, 0),
    //       clients: InsightsMockData.attributionData.reduce((sum, c) => sum + c.clients, 0),
    //       revenue: InsightsMockData.attributionData.reduce((sum, c) => sum + c.revenue, 0),
    //       spend: InsightsMockData.attributionData.reduce((sum, c) => sum + c.spend, 0)
    //     }
    //   };
    // }
    // return api.get('/api/v1/insights/attribution', dateRange);

    // Empty state - no data available yet
    return InsightsEmptyState.attributionData;
  },

  /**
   * Get predictions
   */
  async getPredictions(type = 'all') {
    // DEMO MODE - Uncomment to show mock data
    // if (api.isDemoMode()) {
    //   await MockData.delay(600);
    //   if (type === 'no-shows') return { noShows: InsightsMockData.predictions.noShows };
    //   if (type === 'revenue') return { forecasts: InsightsMockData.predictions.revenueForecasts };
    //   if (type === 'case-duration') return { caseDurations: InsightsMockData.predictions.caseDurations };
    //   return InsightsMockData.predictions;
    // }
    // return api.get(`/api/v1/insights/predictions${type !== 'all' ? `?type=${type}` : ''}`);

    // Empty state - no data available yet
    if (type === 'no-shows') return { noShows: [] };
    if (type === 'revenue') return { forecasts: InsightsEmptyState.predictions.forecasts };
    if (type === 'case-duration') return { caseDurations: [] };
    return InsightsEmptyState.predictions;
  },

  /**
   * Get funnel data, optionally filtered by pipeline or category.
   *
   * @param {Object} filters - { pipeline_id, pipeline_category }
   *   pipeline_category defaults to 'new_lead' on the backend.
   *   Pass pipeline_category='all' for unfiltered view.
   */
  async getFunnelData(filters = {}) {
    if (api.isDemoMode()) {
      return InsightsEmptyState.funnelData;
    }

    try {
      const params = new URLSearchParams();
      if (filters.pipeline_id) params.set('pipeline_id', filters.pipeline_id);
      if (filters.pipeline_category) params.set('pipeline_category', filters.pipeline_category);

      const queryStr = params.toString();
      const url = queryStr ? `/api/v1/insights/funnel?${queryStr}` : '/api/v1/insights/funnel';
      return await api.get(url);
    } catch (err) {
      console.error('[Insights] Failed to fetch funnel data:', err);
      return InsightsEmptyState.funnelData;
    }
  },

  /**
   * Get available pipelines for funnel filter dropdowns.
   *
   * @param {Object} filters - { pipeline_category }
   * @returns {Promise<Object>} { data: [...], metadata: {...} }
   */
  async getPipelines(filters = {}) {
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (filters.pipeline_category) params.set('pipeline_category', filters.pipeline_category);
      return await api.get(`/api/v1/pipelines?${params.toString()}`);
    } catch (err) {
      console.error('[Insights] Failed to fetch pipelines:', err);
      return { data: [] };
    }
  },

  /**
   * Get staff metrics
   */
  async getStaffMetrics(repId = null) {
    // DEMO MODE - Uncomment to show mock data
    // if (api.isDemoMode()) {
    //   await MockData.delay(400);
    //   if (repId) {
    //     const rep = InsightsMockData.staffMetrics.find(r => r.id === repId);
    //     return { staff: rep ? [rep] : [] };
    //   }
    //   return { staff: InsightsMockData.staffMetrics };
    // }
    // const url = repId ? `/api/v1/insights/staff-metrics/${repId}` : '/api/v1/insights/staff-metrics';
    // return api.get(url);

    // Empty state - no data available yet
    return InsightsEmptyState.staffMetrics;
  },

  /**
   * Reschedule a follow-up
   */
  async rescheduleFollowup(followupId, newDate) {
    // DEMO MODE - Uncomment to enable mock action
    // if (api.isDemoMode()) {
    //   await MockData.delay(300);
    //   return { success: true, followupId, newDate };
    // }
    // return api.post(`/api/v1/insights/followups/${followupId}/reschedule`, { newDate });

    return { success: false, error: 'Feature not available' };
  },

  /**
   * Mark follow-up as complete
   */
  async completeFollowup(followupId, notes = '') {
    // DEMO MODE - Uncomment to enable mock action
    // if (api.isDemoMode()) {
    //   await MockData.delay(300);
    //   const idx = InsightsMockData.missedFollowups.findIndex(f => f.id === followupId);
    //   if (idx !== -1) InsightsMockData.missedFollowups.splice(idx, 1);
    //   return { success: true };
    // }
    // return api.post(`/api/v1/insights/followups/${followupId}/complete`, { notes });

    return { success: false, error: 'Feature not available' };
  },

  /**
   * Create task from opportunity
   */
  async createTaskFromOpportunity(opportunityId, taskType) {
    // DEMO MODE - Uncomment to enable mock action
    // if (api.isDemoMode()) {
    //   await MockData.delay(300);
    //   return { success: true, taskId: `task-${Date.now()}` };
    // }
    // return api.post(`/api/v1/insights/opportunities/${opportunityId}/create-task`, { taskType });

    return { success: false, error: 'Feature not available' };
  },

  /**
   * Export data to CSV
   */
  async exportData(dataType, filters = {}) {
    // DEMO MODE - Uncomment to enable mock export
    // if (api.isDemoMode()) {
    //   let csvContent = '';
    //   let data = [];
    //   switch (dataType) {
    //     case 'aging':
    //       data = InsightsMockData.agingOpportunities;
    //       csvContent = 'Name,Source,Value,Days Since Contact,Assigned Rep,Status,Email,Phone\n';
    //       csvContent += data.map(o => `${o.name},${o.source},${o.value},${o.daysSinceContact},${o.assignedRep},${o.status},${o.email},${o.phone}`).join('\n');
    //       break;
    //     case 'followups':
    //       data = InsightsMockData.missedFollowups;
    //       csvContent = 'Client,Type,Due Date,Days Overdue,Assigned Rep,Priority,Notes\n';
    //       csvContent += data.map(f => `${f.clientName},${f.followupType},${f.dueDate},${f.daysOverdue},${f.assignedRep},${f.priority},"${f.notes}"`).join('\n');
    //       break;
    //     case 'attribution':
    //       data = InsightsMockData.attributionData;
    //       csvContent = 'Channel,Leads,Consultations,Clients,Revenue,Spend,CPA,ROI%\n';
    //       csvContent += data.map(c => `${c.channel},${c.leads},${c.consultations},${c.clients},${c.revenue},${c.spend},${c.cpa},${c.roi}`).join('\n');
    //       break;
    //   }
    //   const blob = new Blob([csvContent], { type: 'text/csv' });
    //   const url = window.URL.createObjectURL(blob);
    //   const a = document.createElement('a');
    //   a.href = url;
    //   a.download = `${dataType}_export_${new Date().toISOString().split('T')[0]}.csv`;
    //   document.body.appendChild(a);
    //   a.click();
    //   document.body.removeChild(a);
    //   window.URL.revokeObjectURL(url);
    //   return { success: true };
    // }
    // return api.get(`/api/v1/insights/export/${dataType}`, filters);

    return { success: false, error: 'Export feature not available' };
  }
};

// Export for use in other modules
window.Insights = Insights;
// Note: InsightsMockData is intentionally NOT exported - only used internally for demo mode
