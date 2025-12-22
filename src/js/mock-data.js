/**
 * Lana AI Mock Data
 *
 * Comprehensive mock data for demo mode.
 * This data is used when DEMO_MODE is true in config.js
 */

window.MockData = {
  // ============================================================
  // USERS (admin/users.html)
  // ============================================================
  users: [
    {
      id: 'u-001',
      email: 'john.doe@acmecorp.com',
      username: 'john_doe',
      first_name: 'John',
      last_name: 'Doe',
      is_active: true,
      roles: ['admin'],
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      created_at: '2024-01-15T10:00:00Z',
      last_login: '2024-11-30T14:30:00Z',
      mfa_enabled: true
    },
    {
      id: 'u-002',
      email: 'jane.smith@acmecorp.com',
      username: 'jane_smith',
      first_name: 'Jane',
      last_name: 'Smith',
      is_active: true,
      roles: ['user', 'legal_analyst'],
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      created_at: '2024-02-20T14:30:00Z',
      last_login: '2024-11-29T09:15:00Z',
      mfa_enabled: true
    },
    {
      id: 'u-003',
      email: 'michael.johnson@acmecorp.com',
      username: 'michael_j',
      first_name: 'Michael',
      last_name: 'Johnson',
      is_active: true,
      roles: ['user'],
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      created_at: '2024-03-10T09:00:00Z',
      last_login: '2024-11-28T16:45:00Z',
      mfa_enabled: false
    },
    {
      id: 'u-004',
      email: 'sarah.williams@acmecorp.com',
      username: 'sarah_w',
      first_name: 'Sarah',
      last_name: 'Williams',
      is_active: true,
      roles: ['user', 'document_manager'],
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      created_at: '2024-04-05T11:20:00Z',
      last_login: '2024-11-30T08:00:00Z',
      mfa_enabled: true
    },
    {
      id: 'u-005',
      email: 'david.brown@acmecorp.com',
      username: 'david_b',
      first_name: 'David',
      last_name: 'Brown',
      is_active: false,
      roles: ['user'],
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      created_at: '2024-05-15T08:30:00Z',
      last_login: '2024-10-20T14:00:00Z',
      mfa_enabled: false
    },
    {
      id: 'u-006',
      email: 'emily.davis@acmecorp.com',
      username: 'emily_d',
      first_name: 'Emily',
      last_name: 'Davis',
      is_active: true,
      roles: ['admin', 'user'],
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      created_at: '2024-06-01T13:45:00Z',
      last_login: '2024-11-30T10:20:00Z',
      mfa_enabled: true
    },
    {
      id: 'u-007',
      email: 'robert.miller@acmecorp.com',
      username: 'robert_m',
      first_name: 'Robert',
      last_name: 'Miller',
      is_active: true,
      roles: ['user'],
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      created_at: '2024-06-15T10:00:00Z',
      last_login: '2024-11-29T15:30:00Z',
      mfa_enabled: false
    },
    {
      id: 'u-008',
      email: 'jennifer.wilson@acmecorp.com',
      username: 'jennifer_w',
      first_name: 'Jennifer',
      last_name: 'Wilson',
      is_active: true,
      roles: ['system_admin', 'user', 'legal_analyst'],
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      created_at: '2024-07-20T09:15:00Z',
      last_login: '2024-11-30T11:45:00Z',
      mfa_enabled: true
    },
    {
      id: 'u-009',
      email: 'chris.taylor@acmecorp.com',
      username: 'chris_t',
      first_name: 'Chris',
      last_name: 'Taylor',
      is_active: true,
      roles: ['user'],
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      created_at: '2024-08-10T14:20:00Z',
      last_login: '2024-11-28T09:00:00Z',
      mfa_enabled: false
    },
    {
      id: 'u-010',
      email: 'amanda.anderson@acmecorp.com',
      username: 'amanda_a',
      first_name: 'Amanda',
      last_name: 'Anderson',
      is_active: true,
      roles: ['user'],
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      created_at: '2024-09-05T16:00:00Z',
      last_login: '2024-11-30T07:30:00Z',
      mfa_enabled: true
    }
  ],

  // ============================================================
  // ROLES (admin/roles.html, admin/roles_manager.html)
  // ============================================================
  roles: [
    {
      id: 'r-001',
      name: 'admin',
      display_name: 'Administrator',
      description: 'Full system access with administrative privileges',
      is_system: true,
      level: 100,
      user_count: 2,
      permission_count: 13,
      permissions: [
        'admin:access', 'users:read', 'users:write', 'users:delete',
        'matters:read', 'matters:write', 'matters:delete',
        'documents:read', 'documents:write', 'documents:delete',
        'settings:read', 'settings:write', 'audit:read'
      ],
      created_at: '2024-01-01T00:00:00Z'
    },
    {
      id: 'r-002',
      name: 'user',
      display_name: 'Standard User',
      description: 'Standard user access for daily operations',
      is_system: true,
      level: 10,
      user_count: 8,
      permission_count: 6,
      permissions: [
        'matters:read', 'matters:write',
        'documents:read', 'documents:write',
        'chat:access', 'settings:read'
      ],
      created_at: '2024-01-01T00:00:00Z'
    },
    {
      id: 'r-003',
      name: 'legal_analyst',
      display_name: 'Legal Analyst',
      description: 'Access to legal research and document analysis tools',
      is_system: false,
      level: 25,
      user_count: 2,
      permission_count: 6,
      permissions: [
        'matters:read', 'documents:read', 'documents:write',
        'chat:access', 'rag:query', 'search:advanced'
      ],
      created_at: '2024-02-15T10:00:00Z'
    },
    {
      id: 'r-004',
      name: 'document_manager',
      display_name: 'Document Manager',
      description: 'Full control over document management and organization',
      is_system: false,
      level: 30,
      user_count: 1,
      permission_count: 5,
      permissions: [
        'documents:read', 'documents:write', 'documents:delete',
        'documents:share', 'documents:version'
      ],
      created_at: '2024-03-01T14:30:00Z'
    },
    {
      id: 'r-005',
      name: 'viewer',
      display_name: 'Viewer',
      description: 'Read-only access to matters and documents',
      is_system: false,
      level: 5,
      user_count: 0,
      permission_count: 2,
      permissions: ['matters:read', 'documents:read'],
      created_at: '2024-04-10T09:00:00Z'
    }
  ],

  // ============================================================
  // PERMISSIONS
  // ============================================================
  permissions: [
    { id: 'p-001', name: 'admin:access', description: 'Access admin panel', category: 'Admin' },
    { id: 'p-002', name: 'users:read', description: 'View users', category: 'Users' },
    { id: 'p-003', name: 'users:write', description: 'Create/edit users', category: 'Users' },
    { id: 'p-004', name: 'users:delete', description: 'Delete users', category: 'Users' },
    { id: 'p-005', name: 'matters:read', description: 'View matters', category: 'Matters' },
    { id: 'p-006', name: 'matters:write', description: 'Create/edit matters', category: 'Matters' },
    { id: 'p-007', name: 'matters:delete', description: 'Delete matters', category: 'Matters' },
    { id: 'p-008', name: 'documents:read', description: 'View documents', category: 'Documents' },
    { id: 'p-009', name: 'documents:write', description: 'Upload/edit documents', category: 'Documents' },
    { id: 'p-010', name: 'documents:delete', description: 'Delete documents', category: 'Documents' },
    { id: 'p-011', name: 'documents:share', description: 'Share documents', category: 'Documents' },
    { id: 'p-012', name: 'documents:version', description: 'Manage versions', category: 'Documents' },
    { id: 'p-013', name: 'chat:access', description: 'Use AI chat', category: 'AI' },
    { id: 'p-014', name: 'rag:query', description: 'Query documents with AI', category: 'AI' },
    { id: 'p-015', name: 'search:advanced', description: 'Advanced search', category: 'Search' },
    { id: 'p-016', name: 'settings:read', description: 'View settings', category: 'Settings' },
    { id: 'p-017', name: 'settings:write', description: 'Modify settings', category: 'Settings' },
    { id: 'p-018', name: 'audit:read', description: 'View audit logs', category: 'Admin' }
  ],

  // ============================================================
  // ORGANIZATIONS (admin/organizations.html)
  // ============================================================
  organizations: [
    {
      id: 'demo-org-001',
      name: 'Demo Organization',
      slug: 'demo-org',
      status: 'active',
      tier: 'professional',
      user_count: 10,
      matter_count: 47,
      storage_used: 52428800000, // 50 GB
      storage_limit: 107374182400, // 100 GB
      created_at: '2024-01-01T00:00:00Z',
      settings: {
        features: { chat: true, documents: true, canvas: true }
      }
    },
    {
      id: 'org-002',
      name: 'Acme Legal Partners',
      slug: 'acme-legal',
      status: 'active',
      tier: 'enterprise',
      user_count: 45,
      matter_count: 156,
      storage_used: 214748364800, // 200 GB
      storage_limit: 536870912000, // 500 GB
      created_at: '2023-08-15T10:00:00Z',
      settings: {
        features: { chat: true, documents: true, canvas: true, api: true }
      }
    },
    {
      id: 'org-003',
      name: 'Smith & Associates',
      slug: 'smith-assoc',
      status: 'active',
      tier: 'starter',
      user_count: 5,
      matter_count: 23,
      storage_used: 5368709120, // 5 GB
      storage_limit: 10737418240, // 10 GB
      created_at: '2024-06-01T14:30:00Z',
      settings: {
        features: { chat: true, documents: true }
      }
    },
    {
      id: 'org-004',
      name: 'Legal Innovations Inc',
      slug: 'legal-innovations',
      status: 'suspended',
      tier: 'professional',
      user_count: 12,
      matter_count: 34,
      storage_used: 32212254720, // 30 GB
      storage_limit: 107374182400, // 100 GB
      created_at: '2024-02-20T09:00:00Z',
      settings: {
        features: { chat: true, documents: true, canvas: true }
      }
    },
    {
      id: 'org-005',
      name: 'Trial Account Corp',
      slug: 'trial-corp',
      status: 'trial',
      tier: 'trial',
      user_count: 2,
      matter_count: 3,
      storage_used: 104857600, // 100 MB
      storage_limit: 1073741824, // 1 GB
      created_at: '2024-11-15T10:00:00Z',
      settings: {
        features: { chat: true, documents: true }
      }
    }
  ],

  // ============================================================
  // MATTERS (matters.html)
  // ============================================================
  matters: [
    {
      id: 'm-001',
      name: 'Smith v. Johnson - Contract Dispute',
      description: 'Commercial contract breach case involving software licensing agreement',
      status: 'active',
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      matter_number: 'MAT-2024-001',
      client_name: 'Smith Industries',
      practice_area: 'Commercial Litigation',
      created_at: '2024-03-01T09:00:00Z',
      updated_at: '2024-11-30T14:00:00Z',
      document_count: 47,
      owner: { id: 'u-001', name: 'John Doe' }
    },
    {
      id: 'm-002',
      name: 'Acme Corp Merger Review',
      description: 'Due diligence for proposed merger with TechStart Inc',
      status: 'active',
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      matter_number: 'MAT-2024-002',
      client_name: 'Acme Corporation',
      practice_area: 'Mergers & Acquisitions',
      created_at: '2024-04-15T10:30:00Z',
      updated_at: '2024-11-29T16:20:00Z',
      document_count: 89,
      owner: { id: 'u-002', name: 'Jane Smith' }
    },
    {
      id: 'm-003',
      name: 'Employee Handbook Review 2024',
      description: 'Annual review and update of company employment policies',
      status: 'active',
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      matter_number: 'MAT-2024-003',
      client_name: 'Internal',
      practice_area: 'Employment Law',
      created_at: '2024-05-01T08:00:00Z',
      updated_at: '2024-11-28T11:15:00Z',
      document_count: 23,
      owner: { id: 'u-004', name: 'Sarah Williams' }
    },
    {
      id: 'm-004',
      name: 'Patent Portfolio Analysis',
      description: 'Comprehensive review of client patent portfolio and licensing opportunities',
      status: 'active',
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      matter_number: 'MAT-2024-004',
      client_name: 'Innovation Labs LLC',
      practice_area: 'Intellectual Property',
      created_at: '2024-06-10T14:00:00Z',
      updated_at: '2024-11-30T09:30:00Z',
      document_count: 156,
      owner: { id: 'u-008', name: 'Jennifer Wilson' }
    },
    {
      id: 'm-005',
      name: 'Real Estate Transaction - Downtown Office',
      description: 'Commercial real estate purchase for new headquarters',
      status: 'completed',
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      matter_number: 'MAT-2024-005',
      client_name: 'Metro Holdings',
      practice_area: 'Real Estate',
      created_at: '2024-02-15T09:00:00Z',
      updated_at: '2024-08-20T17:00:00Z',
      document_count: 34,
      owner: { id: 'u-001', name: 'John Doe' }
    },
    {
      id: 'm-006',
      name: 'Data Privacy Compliance Audit',
      description: 'GDPR and CCPA compliance review for multinational operations',
      status: 'active',
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      matter_number: 'MAT-2024-006',
      client_name: 'Global Tech Solutions',
      practice_area: 'Data Privacy',
      created_at: '2024-07-01T11:00:00Z',
      updated_at: '2024-11-29T14:45:00Z',
      document_count: 67,
      owner: { id: 'u-006', name: 'Emily Davis' }
    },
    {
      id: 'm-007',
      name: 'Vendor Contract Negotiations',
      description: 'Master service agreement negotiations with key vendors',
      status: 'on_hold',
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      matter_number: 'MAT-2024-007',
      client_name: 'Supply Chain Partners',
      practice_area: 'Commercial Contracts',
      created_at: '2024-08-15T10:00:00Z',
      updated_at: '2024-10-30T12:00:00Z',
      document_count: 28,
      owner: { id: 'u-003', name: 'Michael Johnson' }
    },
    {
      id: 'm-008',
      name: 'Securities Offering Review',
      description: 'Prospectus review for upcoming public offering',
      status: 'active',
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      matter_number: 'MAT-2024-008',
      client_name: 'FinTech Ventures',
      practice_area: 'Securities',
      created_at: '2024-09-01T09:30:00Z',
      updated_at: '2024-11-30T16:00:00Z',
      document_count: 112,
      owner: { id: 'u-002', name: 'Jane Smith' }
    },
    {
      id: 'm-009',
      name: 'Trademark Registration Portfolio',
      description: 'International trademark filings for new product line',
      status: 'active',
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      matter_number: 'MAT-2024-009',
      client_name: 'Brand Holdings Inc',
      practice_area: 'Intellectual Property',
      created_at: '2024-09-20T08:00:00Z',
      updated_at: '2024-11-28T10:30:00Z',
      document_count: 45,
      owner: { id: 'u-008', name: 'Jennifer Wilson' }
    },
    {
      id: 'm-010',
      name: 'Insurance Coverage Dispute',
      description: 'Business interruption insurance claim analysis',
      status: 'archived',
      organization_id: 'demo-org-001',
      organization_name: 'Demo Organization',
      matter_number: 'MAT-2023-045',
      client_name: 'Retail Solutions Inc',
      practice_area: 'Insurance',
      created_at: '2023-11-15T10:00:00Z',
      updated_at: '2024-06-30T15:00:00Z',
      document_count: 78,
      owner: { id: 'u-001', name: 'John Doe' }
    }
  ],

  // ============================================================
  // DOCUMENTS
  // ============================================================
  documents: [
    {
      id: 'd-001',
      filename: 'Master_Service_Agreement_v3.pdf',
      content_type: 'application/pdf',
      file_size: 2457600,
      matter_id: 'm-001',
      matter_name: 'Smith v. Johnson - Contract Dispute',
      status: 'processed',
      created_at: '2024-03-05T10:00:00Z',
      created_by: 'John Doe',
      tags: ['contract', 'agreement', 'signed']
    },
    {
      id: 'd-002',
      filename: 'Deposition_Transcript_Smith.docx',
      content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_size: 156000,
      matter_id: 'm-001',
      matter_name: 'Smith v. Johnson - Contract Dispute',
      status: 'processed',
      created_at: '2024-04-10T14:30:00Z',
      created_by: 'Jane Smith',
      tags: ['deposition', 'transcript']
    },
    {
      id: 'd-003',
      filename: 'Due_Diligence_Checklist.xlsx',
      content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      file_size: 89000,
      matter_id: 'm-002',
      matter_name: 'Acme Corp Merger Review',
      status: 'processed',
      created_at: '2024-04-20T09:00:00Z',
      created_by: 'Jane Smith',
      tags: ['due-diligence', 'checklist']
    },
    {
      id: 'd-004',
      filename: 'Patent_Application_US12345.pdf',
      content_type: 'application/pdf',
      file_size: 5242880,
      matter_id: 'm-004',
      matter_name: 'Patent Portfolio Analysis',
      status: 'processed',
      created_at: '2024-06-15T11:00:00Z',
      created_by: 'Jennifer Wilson',
      tags: ['patent', 'application']
    },
    {
      id: 'd-005',
      filename: 'Privacy_Policy_Draft.docx',
      content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_size: 98000,
      matter_id: 'm-006',
      matter_name: 'Data Privacy Compliance Audit',
      status: 'processing',
      created_at: '2024-11-28T10:00:00Z',
      created_by: 'Emily Davis',
      tags: ['privacy', 'policy', 'draft']
    }
  ],

  // ============================================================
  // AUDIT LOGS (admin/audit.html)
  // ============================================================
  auditLogs: [
    { id: 'a-001', action: 'user.login', user_email: 'john.doe@acmecorp.com', user_name: 'John Doe', created_at: '2024-11-30T14:30:00Z', ip_address: '192.168.1.50', details: 'Successful login' },
    { id: 'a-002', action: 'document.upload', user_email: 'jane.smith@acmecorp.com', user_name: 'Jane Smith', created_at: '2024-11-30T14:25:00Z', ip_address: '192.168.1.51', details: 'Uploaded: Contract_Amendment.pdf' },
    { id: 'a-003', action: 'matter.create', user_email: 'john.doe@acmecorp.com', user_name: 'John Doe', created_at: '2024-11-30T14:00:00Z', ip_address: '192.168.1.50', details: 'Created matter: New Client Onboarding' },
    { id: 'a-004', action: 'user.password_change', user_email: 'sarah.williams@acmecorp.com', user_name: 'Sarah Williams', created_at: '2024-11-30T12:00:00Z', ip_address: '192.168.1.52', details: 'Password changed successfully' },
    { id: 'a-005', action: 'document.download', user_email: 'michael.johnson@acmecorp.com', user_name: 'Michael Johnson', created_at: '2024-11-30T11:45:00Z', ip_address: '192.168.1.53', details: 'Downloaded: Financial_Report_Q3.xlsx' },
    { id: 'a-006', action: 'user.logout', user_email: 'emily.davis@acmecorp.com', user_name: 'Emily Davis', created_at: '2024-11-30T11:30:00Z', ip_address: '192.168.1.54', details: 'User logged out' },
    { id: 'a-007', action: 'settings.update', user_email: 'john.doe@acmecorp.com', user_name: 'John Doe', created_at: '2024-11-30T10:00:00Z', ip_address: '192.168.1.50', details: 'Updated organization settings' },
    { id: 'a-008', action: 'role.assign', user_email: 'john.doe@acmecorp.com', user_name: 'John Doe', created_at: '2024-11-30T09:30:00Z', ip_address: '192.168.1.50', details: 'Assigned role "legal_analyst" to jane.smith@acmecorp.com' },
    { id: 'a-009', action: 'document.delete', user_email: 'sarah.williams@acmecorp.com', user_name: 'Sarah Williams', created_at: '2024-11-29T16:00:00Z', ip_address: '192.168.1.52', details: 'Deleted: Old_Template_v1.docx' },
    { id: 'a-010', action: 'user.create', user_email: 'john.doe@acmecorp.com', user_name: 'John Doe', created_at: '2024-11-29T14:00:00Z', ip_address: '192.168.1.50', details: 'Created user: new.employee@acmecorp.com' },
    { id: 'a-011', action: 'matter.share', user_email: 'jane.smith@acmecorp.com', user_name: 'Jane Smith', created_at: '2024-11-29T11:00:00Z', ip_address: '192.168.1.51', details: 'Shared matter with external counsel' },
    { id: 'a-012', action: 'api.key_create', user_email: 'john.doe@acmecorp.com', user_name: 'John Doe', created_at: '2024-11-28T15:00:00Z', ip_address: '192.168.1.50', details: 'Created new API key' },
    { id: 'a-013', action: 'user.mfa_enable', user_email: 'jennifer.wilson@acmecorp.com', user_name: 'Jennifer Wilson', created_at: '2024-11-28T10:00:00Z', ip_address: '192.168.1.55', details: 'Enabled two-factor authentication' },
    { id: 'a-014', action: 'document.share', user_email: 'michael.johnson@acmecorp.com', user_name: 'Michael Johnson', created_at: '2024-11-27T14:30:00Z', ip_address: '192.168.1.53', details: 'Created share link for: Report_Summary.pdf' },
    { id: 'a-015', action: 'user.login_failed', user_email: 'unknown@attacker.com', user_name: 'Unknown', created_at: '2024-11-27T03:00:00Z', ip_address: '203.0.113.50', details: 'Failed login attempt - invalid credentials' }
  ],

  // ============================================================
  // SESSIONS (admin/sessions.html)
  // ============================================================
  sessions: [
    {
      id: 's-001',
      user_id: 'u-001',
      user_email: 'john.doe@acmecorp.com',
      user_name: 'John Doe',
      ip_address: '192.168.1.50',
      browser: 'Chrome 120',
      os: 'Windows 11',
      device: 'Desktop',
      location: 'New York, NY',
      created_at: '2024-11-30T08:00:00Z',
      last_activity: new Date().toISOString(),
      is_current: true
    },
    {
      id: 's-002',
      user_id: 'u-002',
      user_email: 'jane.smith@acmecorp.com',
      user_name: 'Jane Smith',
      ip_address: '192.168.1.51',
      browser: 'Safari 17',
      os: 'macOS Sonoma',
      device: 'Desktop',
      location: 'San Francisco, CA',
      created_at: '2024-11-30T09:15:00Z',
      last_activity: new Date(Date.now() - 300000).toISOString(),
      is_current: false
    },
    {
      id: 's-003',
      user_id: 'u-004',
      user_email: 'sarah.williams@acmecorp.com',
      user_name: 'Sarah Williams',
      ip_address: '192.168.1.52',
      browser: 'Firefox 121',
      os: 'Ubuntu 22.04',
      device: 'Desktop',
      location: 'Austin, TX',
      created_at: '2024-11-30T07:30:00Z',
      last_activity: new Date(Date.now() - 600000).toISOString(),
      is_current: false
    },
    {
      id: 's-004',
      user_id: 'u-006',
      user_email: 'emily.davis@acmecorp.com',
      user_name: 'Emily Davis',
      ip_address: '192.168.1.100',
      browser: 'Chrome 120',
      os: 'iOS 17',
      device: 'Mobile',
      location: 'Chicago, IL',
      created_at: '2024-11-30T10:00:00Z',
      last_activity: new Date(Date.now() - 120000).toISOString(),
      is_current: false
    },
    {
      id: 's-005',
      user_id: 'u-008',
      user_email: 'jennifer.wilson@acmecorp.com',
      user_name: 'Jennifer Wilson',
      ip_address: '192.168.1.55',
      browser: 'Edge 120',
      os: 'Windows 10',
      device: 'Desktop',
      location: 'Boston, MA',
      created_at: '2024-11-30T11:30:00Z',
      last_activity: new Date(Date.now() - 1800000).toISOString(),
      is_current: false
    }
  ],

  // ============================================================
  // HEALTH STATUS (admin/health.html)
  // ============================================================
  health: {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.2.0',
    services: {
      database: { status: 'healthy', latency_ms: 5, message: 'PostgreSQL connected' },
      minio: { status: 'healthy', latency_ms: 12, message: 'MinIO storage available' },
      pgboss: { status: 'healthy', latency_ms: 3, message: 'Job queue operational' },
      pgvector: { status: 'healthy', latency_ms: 8, message: 'Vector search ready' },
      ollama: { status: 'healthy', latency_ms: 25, message: 'LLM service connected' }
    },
    memory: {
      heapUsed: 150000000,
      heapTotal: 256000000,
      rss: 300000000,
      external: 15000000
    },
    uptime: 864000, // 10 days in seconds
    cpu: {
      usage: 15.5,
      cores: 8
    },
    connections: {
      database: { active: 12, idle: 8, max: 50 },
      http: { active: 45, max: 1000 }
    }
  },

  // ============================================================
  // PLUGINS (admin/plugins.html)
  // ============================================================
  plugins: {
    installed: [
      {
        id: 'p-001',
        name: 'Document OCR',
        version: '1.2.0',
        status: 'running',
        description: 'Extract text from images and scanned PDFs using advanced OCR',
        author: 'Lana AI',
        enabled: true,
        settings: { language: 'eng', quality: 'high' }
      },
      {
        id: 'p-002',
        name: 'Legal Citation Finder',
        version: '2.0.1',
        status: 'running',
        description: 'Automatically detect and validate legal citations in documents',
        author: 'Lana AI',
        enabled: true,
        settings: { jurisdictions: ['US', 'UK'] }
      },
      {
        id: 'p-003',
        name: 'Contract Analyzer',
        version: '1.5.0',
        status: 'running',
        description: 'AI-powered contract analysis and risk identification',
        author: 'Lana AI',
        enabled: true,
        settings: { auto_analyze: true }
      },
      {
        id: 'p-004',
        name: 'Email Connector',
        version: '1.1.0',
        status: 'stopped',
        description: 'Import and organize emails from Exchange and Gmail',
        author: 'Lana AI',
        enabled: false,
        settings: {}
      }
    ],
    marketplace: [
      {
        id: 'mp-001',
        name: 'E-Signature Integration',
        version: '2.0.0',
        description: 'Digital signature integration with DocuSign and Adobe Sign',
        author: 'Lana AI',
        downloads: 1500,
        rating: 4.8
      },
      {
        id: 'mp-002',
        name: 'Billing & Time Tracking',
        version: '1.3.0',
        description: 'Track billable hours and generate invoices',
        author: 'Legal Tech Partners',
        downloads: 890,
        rating: 4.5
      },
      {
        id: 'mp-003',
        name: 'Court Filing Assistant',
        version: '1.0.5',
        description: 'Automated court filing preparation and validation',
        author: 'Lana AI',
        downloads: 650,
        rating: 4.2
      },
      {
        id: 'mp-004',
        name: 'Client Portal',
        version: '2.1.0',
        description: 'Secure client portal for document sharing and communication',
        author: 'Legal Tech Partners',
        downloads: 2100,
        rating: 4.7
      },
      {
        id: 'mp-005',
        name: 'Conflict Check',
        version: '1.2.0',
        description: 'Automated conflict of interest checking',
        author: 'Lana AI',
        downloads: 1200,
        rating: 4.6
      }
    ]
  },

  // ============================================================
  // INTEGRATIONS (admin/integrations.html)
  // ============================================================
  integrations: {
    ollama: {
      status: 'connected',
      endpoint: 'http://localhost:11434',
      models: ['llama2', 'mistral', 'codellama'],
      default_model: 'llama2',
      last_checked: new Date().toISOString()
    },
    qdrant: {
      status: 'connected',
      endpoint: 'http://localhost:6333',
      collections: 5,
      vectors: 125000,
      last_checked: new Date().toISOString()
    },
    minio: {
      status: 'connected',
      endpoint: 'http://localhost:9000',
      buckets: ['documents', 'attachments', 'exports'],
      total_size: '52.4 GB',
      last_checked: new Date().toISOString()
    },
    smtp: {
      status: 'configured',
      host: 'smtp.company.com',
      port: 587,
      from_address: 'noreply@lana.ai',
      last_checked: new Date().toISOString()
    },
    slack: {
      status: 'not_configured',
      workspace: null,
      channels: [],
      last_checked: null
    },
    m365: {
      status: 'not_configured',
      tenant_id: null,
      connected_accounts: 0,
      last_checked: null
    },
    google: {
      status: 'not_configured',
      project_id: null,
      connected_accounts: 0,
      last_checked: null
    }
  },

  // ============================================================
  // REPORTING (admin/reporting.html)
  // ============================================================
  reporting: {
    summary: {
      activeUsers: 156,
      totalUsers: 180,
      docsProcessed: 2400,
      docsThisMonth: 320,
      aiQueries: 12500,
      queriesThisMonth: 1850,
      storageUsed: '127 GB',
      storageLimit: '500 GB'
    },
    userActivity: {
      labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
      logins: [120, 145, 156, 162],
      queries: [450, 520, 480, 550],
      uploads: [89, 112, 95, 124]
    },
    documentTypes: {
      labels: ['PDF', 'Word', 'Excel', 'Images', 'Other'],
      values: [45, 25, 15, 10, 5]
    },
    topUsers: [
      { name: 'Jane Smith', email: 'jane.smith@acmecorp.com', queries: 450, documents: 89 },
      { name: 'John Doe', email: 'john.doe@acmecorp.com', queries: 380, documents: 67 },
      { name: 'Emily Davis', email: 'emily.davis@acmecorp.com', queries: 320, documents: 54 },
      { name: 'Jennifer Wilson', email: 'jennifer.wilson@acmecorp.com', queries: 290, documents: 48 },
      { name: 'Sarah Williams', email: 'sarah.williams@acmecorp.com', queries: 250, documents: 42 }
    ],
    matterActivity: [
      { name: 'Acme Corp Merger Review', documents: 89, queries: 520 },
      { name: 'Patent Portfolio Analysis', documents: 156, queries: 380 },
      { name: 'Securities Offering Review', documents: 112, queries: 290 },
      { name: 'Data Privacy Compliance Audit', documents: 67, queries: 245 },
      { name: 'Smith v. Johnson - Contract Dispute', documents: 47, queries: 180 }
    ]
  },

  // ============================================================
  // SETTINGS (admin/settings.html, settings.html)
  // ============================================================
  settings: {
    general: {
      app_name: 'Lana AI',
      support_email: 'support@lana.ai',
      timezone: 'America/New_York',
      date_format: 'MM/DD/YYYY',
      time_format: '12h',
      language: 'en'
    },
    security: {
      min_password_length: 8,
      require_uppercase: true,
      require_numbers: true,
      require_special_chars: true,
      password_expiry_days: 90,
      max_login_attempts: 5,
      lockout_duration_minutes: 30,
      require_mfa: false,
      session_timeout_minutes: 60,
      allowed_domains: []
    },
    features: {
      chat: true,
      documents: true,
      canvas: true,
      plugins: true,
      api: true,
      webhooks: false,
      audit_logs: true,
      advanced_search: true
    },
    notifications: {
      email_enabled: true,
      slack_enabled: false,
      in_app_enabled: true,
      digest_frequency: 'daily'
    },
    tier: {
      current: 'professional',
      limits: {
        users: 100,
        storage_gb: 100,
        matters: 500,
        api_calls_per_day: 10000
      }
    },
    branding: {
      logo_url: null,
      primary_color: '#2563eb',
      favicon_url: null
    }
  },

  // ============================================================
  // ONBOARDING (admin/onboarding_management.html)
  // ============================================================
  onboarding: {
    steps: [
      { id: 'welcome', name: 'Welcome', description: 'Introduction to Lana AI', required: true, order: 1 },
      { id: 'profile', name: 'Profile Setup', description: 'Complete your profile information', required: true, order: 2 },
      { id: 'security', name: 'Security', description: 'Configure two-factor authentication', required: false, order: 3 },
      { id: 'tour', name: 'Product Tour', description: 'Take a guided tour of features', required: false, order: 4 },
      { id: 'first_matter', name: 'Create Matter', description: 'Create your first matter', required: false, order: 5 }
    ],
    settings: {
      enabled: true,
      allow_skip: true,
      show_progress: true,
      auto_complete_delay_days: 7
    },
    statistics: {
      completed: 145,
      in_progress: 12,
      skipped: 23,
      average_completion_time_minutes: 8
    }
  },

  // ============================================================
  // CHAT CONVERSATIONS (chat/index.html)
  // ============================================================
  conversations: [
    {
      id: 'conv-001',
      title: 'Contract Analysis - MSA Review',
      matter_id: 'm-001',
      matter_name: 'Smith v. Johnson - Contract Dispute',
      updated_at: '2024-11-30T14:00:00Z',
      message_count: 12,
      messages: [
        { role: 'user', content: 'Can you analyze the key terms in the Master Service Agreement?', timestamp: '2024-11-30T13:45:00Z' },
        { role: 'assistant', content: 'I\'d be happy to analyze the Master Service Agreement. Based on my review, here are the key terms:\n\n**1. Service Scope (Section 2)**\nThe agreement defines specific services to be provided...\n\n**2. Payment Terms (Section 4)**\nPayment is due within 30 days of invoice...\n\n**3. Limitation of Liability (Section 8)**\nLiability is capped at the total fees paid in the preceding 12 months...', timestamp: '2024-11-30T13:46:00Z' }
      ]
    },
    {
      id: 'conv-002',
      title: 'Due Diligence Questions',
      matter_id: 'm-002',
      matter_name: 'Acme Corp Merger Review',
      updated_at: '2024-11-29T16:20:00Z',
      message_count: 8,
      messages: [
        { role: 'user', content: 'What are the key risks identified in the due diligence documents?', timestamp: '2024-11-29T16:00:00Z' },
        { role: 'assistant', content: 'Based on my analysis of the due diligence materials, I\'ve identified several key risk areas:\n\n**Financial Risks:**\n- Outstanding litigation valued at $2.5M\n- Pending tax audit for FY2023\n\n**Operational Risks:**\n- Key employee retention concerns\n- Legacy system dependencies\n\n**Regulatory Risks:**\n- Pending regulatory approval in 3 jurisdictions', timestamp: '2024-11-29T16:01:00Z' }
      ]
    },
    {
      id: 'conv-003',
      title: 'Patent Validity Research',
      matter_id: 'm-004',
      matter_name: 'Patent Portfolio Analysis',
      updated_at: '2024-11-30T09:30:00Z',
      message_count: 15,
      messages: [
        { role: 'user', content: 'Search for prior art related to patent US12345', timestamp: '2024-11-30T09:00:00Z' },
        { role: 'assistant', content: 'I\'ve conducted a prior art search for patent US12345. Here are the relevant findings:\n\n**Potentially Relevant Prior Art:**\n1. US Patent 9,876,543 (2018) - Similar mechanism described in claims 1-3\n2. Academic paper "Novel Approaches..." (2017) - Describes related methodology\n3. EP Patent 2,345,678 (2019) - Overlapping claim scope\n\nWould you like me to provide a detailed comparison of any of these references?', timestamp: '2024-11-30T09:02:00Z' }
      ]
    }
  ],

  // ============================================================
  // DASHBOARD STATS (index.html)
  // ============================================================
  dashboardStats: {
    matters: { total: 47, active: 38, recent: 5 },
    documents: { total: 2400, this_week: 45, processing: 3 },
    users: { total: 10, active_today: 6 },
    storage: { used_gb: 52.4, limit_gb: 100, percentage: 52 },
    ai_queries: { today: 125, this_week: 850, trend: '+12%' }
  },

  // ============================================================
  // NOTIFICATIONS
  // ============================================================
  notifications: [
    { id: 'n-001', title: 'Document processed', body: 'Contract_Amendment.pdf has been processed and indexed', type: 'success', read: false, created_at: '2024-11-30T14:30:00Z' },
    { id: 'n-002', title: 'New comment', body: 'Jane Smith commented on Smith v. Johnson matter', type: 'info', read: false, created_at: '2024-11-30T14:00:00Z' },
    { id: 'n-003', title: 'Shared with you', body: 'John Doe shared "Due Diligence Report" with you', type: 'info', read: false, created_at: '2024-11-30T12:30:00Z' },
    { id: 'n-004', title: 'Matter updated', body: 'Acme Corp Merger Review status changed to "In Review"', type: 'info', read: true, created_at: '2024-11-30T10:00:00Z' },
    { id: 'n-005', title: 'Weekly summary', body: 'Your weekly activity summary is ready', type: 'info', read: true, created_at: '2024-11-29T09:00:00Z' }
  ],

  // ============================================================
  // RECENT ACTIVITY
  // ============================================================
  recentActivity: [
    { type: 'document_upload', user: 'Jane Smith', action: 'uploaded', target: 'Contract_Amendment.pdf', matter: 'Smith v. Johnson', timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
    { type: 'chat_stream', user: 'Jessica Harris', action: 'started a chat about', target: 'contract terms', matter: 'Acme Corp Merger', timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
    { type: 'matter_update', user: 'John Doe', action: 'updated', target: 'Acme Corp Merger Review', matter: null, timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() },
    { type: 'comment', user: 'Emily Davis', action: 'commented on', target: 'Due Diligence Report', matter: 'Acme Corp Merger Review', timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() },
    { type: 'ai_query', user: 'Jennifer Wilson', action: 'queried AI about', target: 'patent validity', matter: 'Patent Portfolio Analysis', timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString() },
    { type: 'share', user: 'John Doe', action: 'shared', target: 'Financial Summary.xlsx', matter: 'Securities Offering Review', timestamp: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString() },
    { type: 'document_download', user: 'Sarah Williams', action: 'downloaded', target: 'NDA_Final.pdf', matter: 'Smith v. Johnson', timestamp: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString() },
    { type: 'matter_create', user: 'Michael Johnson', action: 'created matter', target: 'New Client Onboarding', matter: null, timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString() },
    { type: 'login', user: 'Emily Davis', action: 'signed in', target: '', matter: null, timestamp: new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString() },
    { type: 'document_update', user: 'Jane Smith', action: 'updated', target: 'Engagement_Letter_v2.docx', matter: 'New Client Onboarding', timestamp: new Date(Date.now() - 16 * 60 * 60 * 1000).toISOString() },
    { type: 'export', user: 'John Doe', action: 'exported', target: 'Monthly Report', matter: null, timestamp: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString() },
    { type: 'user_create', user: 'Admin', action: 'created user', target: 'new.user@company.com', matter: null, timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
    { type: 'role_change', user: 'Admin', action: 'changed role for', target: 'Sarah Williams to Legal Analyst', matter: null, timestamp: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString() },
    { type: 'document_view', user: 'Jennifer Wilson', action: 'viewed', target: 'Settlement_Agreement.pdf', matter: 'Smith v. Johnson', timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() },
    { type: 'comment_create', user: 'Michael Johnson', action: 'added a comment on', target: 'Discovery Documents', matter: 'Patent Portfolio Analysis', timestamp: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString() }
  ],

  // ============================================================
  // CHAT AI RESPONSES (for demo mode chat)
  // ============================================================
  chatResponses: {
    default: `I understand your question. Based on the documents in this matter, here's what I found:

**Summary:**
The relevant information relates to the key aspects you're asking about. Let me break this down:

1. **Primary Finding:** The documents indicate clear terms and conditions that apply to this situation.

2. **Supporting Evidence:** I found 3 documents that directly address this topic.

3. **Recommendations:** Based on my analysis, I would suggest reviewing Section 4.2 of the main agreement for specific guidance.

Would you like me to elaborate on any of these points or search for additional information?`,

    contract: `**Contract Analysis Results**

I've analyzed the contract and identified the following key elements:

**Parties:**
- Party A: [Client Company]
- Party B: [Counterparty]

**Key Terms:**
1. **Term:** 3-year initial period with auto-renewal
2. **Compensation:** Fixed fee of $X per month
3. **Termination:** 90-day notice required

**Risk Areas:**
- Limitation of liability clause (Section 8) may be overly broad
- Indemnification provisions favor the counterparty
- IP assignment clause needs clarification

**Recommendations:**
- Consider negotiating the liability cap
- Request clarification on IP ownership
- Add mutual termination rights

Shall I provide more details on any specific section?`,

    search: `**Search Results**

I found **12 relevant documents** matching your query:

**Most Relevant:**
1. **Master_Service_Agreement_v3.pdf** (95% match)
   - Contains specific terms related to your query
   - Last modified: 2024-03-15

2. **Addendum_A_Pricing.docx** (87% match)
   - Pricing and payment terms
   - Last modified: 2024-04-20

3. **Email_Correspondence_March.pdf** (82% match)
   - Discussion of key terms
   - Last modified: 2024-03-28

**Key Excerpts:**
> "The parties agree that all deliverables shall be provided within the timeframes specified in Exhibit B..."

Would you like me to open any of these documents or search with different criteria?`,

    legal: `**Legal Research Summary**

Based on my analysis of the relevant legal principles:

**Applicable Law:**
- This matter appears to be governed by [State] commercial law
- UCC Article 2 may apply to goods-related provisions

**Key Precedents:**
1. *Smith v. Jones* (2020) - Established the standard for commercial reasonableness
2. *ABC Corp v. XYZ Inc* (2019) - Relevant to interpretation of force majeure clauses

**Analysis:**
The facts of this case suggest that the client has a strong position because:
- Clear documentation of performance
- Counterparty's failure to provide required notice
- Industry standard practices support client's interpretation

**Recommendations:**
- Document all communications going forward
- Consider sending a demand letter
- Preserve all relevant evidence

Would you like me to draft any documents or research additional issues?`
  }
};

// Helper function to get a random item from an array
MockData.getRandomItem = function(array) {
  return array[Math.floor(Math.random() * array.length)];
};

// Helper function to simulate API delay
MockData.delay = function(ms = 500) {
  return new Promise(resolve => setTimeout(resolve, ms + Math.random() * 500));
};

// Helper to generate a fake ID
MockData.generateId = function(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};
