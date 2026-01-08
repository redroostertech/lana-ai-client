# LANA-AI API Endpoints Documentation & Coverage Report

> **IMPORTANT NOTE (December 2025):** This report is outdated. The `/rag/stream` endpoints listed in this report have been removed. RAG functionality is now built into `/chat/stream` automatically. This report is preserved for historical reference.

**Generated:** 2025-12-14
**Status:** Outdated - See note above

## Executive Summary

This report provides a comprehensive analysis of all API endpoints in the LANA-AI application, comparing the implemented codebase with the documented Postman collection.

### Key Statistics

| Metric | Value |
|--------|-------|
| **Total Endpoints in Codebase** | 508 |
| **Total Endpoints in Postman** | 350 |
| **Matched (Documented)** | 92 |
| **Missing in Postman** | 416 |
| **Missing in Code** | 186 |
| **Overall Coverage** | 18.1% |

---

## Coverage by Service

| Service | Total Endpoints | Documented | Undocumented | Coverage % |
|---------|----------------|------------|--------------|-----------|
| memory | 9 | 0 | 9 | 0.0% ░░░░░░░░░░ |
| vpn | 16 | 1 | 15 | 6.3% ░░░░░░░░░░ |
| processor | 468 | 82 | 386 | 17.5% █░░░░░░░░░ |
| health | 5 | 1 | 4 | 20.0% ██░░░░░░░░ |
| context-compiler | 10 | 8 | 2 | 80.0% ████████░░ |


---

## Coverage by API Mount Point

| API Mount Point | Total | Documented | Undocumented | Coverage % |
|----------------|-------|------------|--------------|-----------|
| `/api/v1/memory` | 5 | 0 | 5 | 0.0% ░░░░░░░░░░ |
| `/api/v1/conversation` | 4 | 0 | 4 | 0.0% ░░░░░░░░░░ |
| `/api/v1/admin/vpn` | 5 | 0 | 5 | 0.0% ░░░░░░░░░░ |
| `/api/v1/vpn` | 6 | 0 | 6 | 0.0% ░░░░░░░░░░ |
| `/api/v1/document-automation` | 11 | 0 | 11 | 0.0% ░░░░░░░░░░ |
| `/api/v1/notifications` | 12 | 0 | 12 | 0.0% ░░░░░░░░░░ |
| `/api/v1/activity` | 8 | 0 | 8 | 0.0% ░░░░░░░░░░ |
| `/api/v1/chat` | 7 | 0 | 7 | 0.0% ░░░░░░░░░░ |
| `/api/v1/admin/health` | 3 | 0 | 3 | 0.0% ░░░░░░░░░░ |
| `/api/v1/smart-query` | 5 | 0 | 5 | 0.0% ░░░░░░░░░░ |
| `/api/v1/annotations` | 10 | 0 | 10 | 0.0% ░░░░░░░░░░ |
| `/api/v1/actionstep` | 18 | 0 | 18 | 0.0% ░░░░░░░░░░ |
| `/api/v1/integration` | 3 | 0 | 3 | 0.0% ░░░░░░░░░░ |
| `/api/v1/insights` | 12 | 0 | 12 | 0.0% ░░░░░░░░░░ |
| `/api/v1/organizations` | 10 | 0 | 10 | 0.0% ░░░░░░░░░░ |
| `/api/v1/document-templates` | 8 | 0 | 8 | 0.0% ░░░░░░░░░░ |
| `/api/v1/admin/sessions` | 2 | 0 | 2 | 0.0% ░░░░░░░░░░ |
| `/api/v1/documents` | 5 | 0 | 5 | 0.0% ░░░░░░░░░░ |
| `/api/v1/integrations` | 10 | 0 | 10 | 0.0% ░░░░░░░░░░ |
| `/api/client` | 4 | 0 | 4 | 0.0% ░░░░░░░░░░ |
| `/api/v1/batch-process` | 4 | 0 | 4 | 0.0% ░░░░░░░░░░ |
| `/api/v1/system` | 9 | 0 | 9 | 0.0% ░░░░░░░░░░ |
| `/api/v1/leadly` | 20 | 0 | 20 | 0.0% ░░░░░░░░░░ |
| `/api/v1/workflows` | 7 | 0 | 7 | 0.0% ░░░░░░░░░░ |
| `/api/v1/dlq` | 4 | 0 | 4 | 0.0% ░░░░░░░░░░ |
| `/api/v1/audit` | 12 | 0 | 12 | 0.0% ░░░░░░░░░░ |
| `/api/v1/jobs` | 5 | 0 | 5 | 0.0% ░░░░░░░░░░ |
| `/api/v1/webhook` | 6 | 0 | 6 | 0.0% ░░░░░░░░░░ |
| `/api/v1/context` | 1 | 0 | 1 | 0.0% ░░░░░░░░░░ |
| `/api/v1/files` | 21 | 1 | 20 | 4.8% ░░░░░░░░░░ |
| `/api/v1/matters` | 23 | 2 | 21 | 8.7% ░░░░░░░░░░ |
| `/api/v1/workers` | 11 | 1 | 10 | 9.1% ░░░░░░░░░░ |
| `/api/v1/rbac` | 15 | 2 | 13 | 13.3% █░░░░░░░░░ |
| `/api/v1/sharing` | 13 | 2 | 11 | 15.4% █░░░░░░░░░ |
| `/api/v1` | 5 | 1 | 4 | 20.0% ██░░░░░░░░ |
| `/health` | 5 | 1 | 4 | 20.0% ██░░░░░░░░ |
| `/api/v1/comments` | 10 | 2 | 8 | 20.0% ██░░░░░░░░ |
| `/api/v1/plugins` | 10 | 2 | 8 | 20.0% ██░░░░░░░░ |
| `/api/v1/admin/users` | 24 | 5 | 19 | 20.8% ██░░░░░░░░ |
| `/api/v1/groups` | 9 | 2 | 7 | 22.2% ██░░░░░░░░ |
| `/api/v1/storage` | 30 | 7 | 23 | 23.3% ██░░░░░░░░ |
| `/api/v1/permissions` | 6 | 2 | 4 | 33.3% ███░░░░░░░ |
| `/api/v1/users` | 30 | 12 | 18 | 40.0% ████░░░░░░ |
| `/api/v1/ingest` | 10 | 4 | 6 | 40.0% ████░░░░░░ |
| `/api/v1/session` | 11 | 5 | 6 | 45.5% ████░░░░░░ |
| `/api/v1/auth/service` | 4 | 2 | 2 | 50.0% █████░░░░░ |
| `/api/v1/streaming` | 13 | 7 | 6 | 53.8% █████░░░░░ |
| `/api/v1/auth/session` | 5 | 3 | 2 | 60.0% ██████░░░░ |
| `/api/v1/search` | 9 | 6 | 3 | 66.7% ██████░░░░ |
| `/api/v1/auth` | 8 | 6 | 2 | 75.0% ███████░░░ |
| `/api/v1/cache` | 8 | 6 | 2 | 75.0% ███████░░░ |
| `/api/v1/rag` | 9 | 8 | 1 | 88.9% ████████░░ |
| `/api/v1/database` | 3 | 3 | 0 | 100.0% ██████████ |


---

## All Implemented Endpoints (Grouped by Mount Point)


### /api/v1/memory (5 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/memory/` | memory.routes | ❌ |
| `GET` | `/api/v1/memory/` | memory.routes | ❌ |
| `GET` | `/api/v1/memory/:memory_id` | memory.routes | ❌ |
| `PUT` | `/api/v1/memory/:memory_id` | memory.routes | ❌ |
| `DELETE` | `/api/v1/memory/:memory_id` | memory.routes | ❌ |

### /api/v1/conversation (4 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/conversation/` | conversation.routes | ❌ |
| `GET` | `/api/v1/conversation/thread/:thread_id` | conversation.routes | ❌ |
| `GET` | `/api/v1/conversation/threads` | conversation.routes | ❌ |
| `DELETE` | `/api/v1/conversation/thread/:thread_id` | conversation.routes | ❌ |

### /api/v1/admin/vpn (5 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/admin/vpn/devices` | admin-vpn.routes | ❌ |
| `DELETE` | `/api/v1/admin/vpn/devices/:device_id` | admin-vpn.routes | ❌ |
| `POST` | `/api/v1/admin/vpn/regenerate-bootstrap-psk` | admin-vpn.routes | ❌ |
| `GET` | `/api/v1/admin/vpn/status` | admin-vpn.routes | ❌ |
| `GET` | `/api/v1/admin/vpn/discovery-config` | admin-vpn.routes | ❌ |

### /api/v1 (5 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/client-config` | vpn.routes | ❌ |
| `GET` | `/api/v1/status` | vpn.routes | ✅ |
| `DELETE` | `/api/v1/revoke` | vpn.routes | ❌ |
| `GET` | `/api/v1/server-status` | vpn.routes | ❌ |
| `GET` | `/api/v1/peers` | vpn.routes | ❌ |

### /api/v1/vpn (6 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/vpn/bootstrap-register` | device-registration.routes | ❌ |
| `POST` | `/api/v1/vpn/register-device` | device-registration.routes | ❌ |
| `GET` | `/api/v1/vpn/my-devices` | device-registration.routes | ❌ |
| `GET` | `/api/v1/vpn/config` | device-registration.routes | ❌ |
| `DELETE` | `/api/v1/vpn/devices/:device_id` | device-registration.routes | ❌ |
| `POST` | `/api/v1/vpn/heartbeat` | device-registration.routes | ❌ |

### /health (5 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/health` | health.routes | ✅ |
| `GET` | `/health/detailed` | health.routes | ❌ |
| `GET` | `/health/ready` | health.routes | ❌ |
| `GET` | `/health/live` | health.routes | ❌ |
| `GET` | `/health/discovery` | health.routes | ❌ |

### /api/v1/matters (23 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/matters/:matter_id/stats` | matter-analytics.routes | ❌ |
| `GET` | `/api/v1/matters/:matter_id/documents-summary` | matter-analytics.routes | ❌ |
| `POST` | `/api/v1/matters/:matter_id/access` | matter-access.routes | ❌ |
| `GET` | `/api/v1/matters/:matter_id/access` | matter-access.routes | ❌ |
| `DELETE` | `/api/v1/matters/:matter_id/access/:user_id` | matter-access.routes | ❌ |
| `GET` | `/api/v1/matters/:matter_id/groups` | matter-access.routes | ❌ |
| `POST` | `/api/v1/matters/:matter_id/groups` | matter-access.routes | ❌ |
| `DELETE` | `/api/v1/matters/:matter_id/groups/:group_id` | matter-access.routes | ❌ |
| `GET` | `/api/v1/matters/:matter_id/permissions` | matter-access.routes | ❌ |
| `POST` | `/api/v1/matters/:matter_id/share/users` | matter-access.routes | ❌ |
| `DELETE` | `/api/v1/matters/:matter_id/share/users/:user_id` | matter-access.routes | ❌ |
| `GET` | `/api/v1/matters/search` | matters.routes | ❌ |
| `GET` | `/api/v1/matters/recent` | matters.routes | ❌ |
| `POST` | `/api/v1/matters/` | matters.routes | ✅ |
| `GET` | `/api/v1/matters/` | matters.routes | ✅ |
| `GET` | `/api/v1/matters/:matter_id` | matters.routes | ❌ |
| `PUT` | `/api/v1/matters/:matter_id` | matters.routes | ❌ |
| `DELETE` | `/api/v1/matters/:matter_id` | matters.routes | ❌ |
| `POST` | `/api/v1/matters/:matter_id/archive` | matters.routes | ❌ |
| `POST` | `/api/v1/matters/:matter_id/unarchive` | matters.routes | ❌ |
| `POST` | `/api/v1/matters/:matter_id/clone` | matters.routes | ❌ |
| `GET` | `/api/v1/matters/:matter_id/settings` | matters.routes | ❌ |
| `PUT` | `/api/v1/matters/:matter_id/settings` | matters.routes | ❌ |

### /api/v1/document-automation (11 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/document-automation/rules` | document-automation.routes | ❌ |
| `GET` | `/api/v1/document-automation/trigger-types` | document-automation.routes | ❌ |
| `GET` | `/api/v1/document-automation/action-types` | document-automation.routes | ❌ |
| `POST` | `/api/v1/document-automation/rules` | document-automation.routes | ❌ |
| `GET` | `/api/v1/document-automation/rules/:ruleId` | document-automation.routes | ❌ |
| `PUT` | `/api/v1/document-automation/rules/:ruleId` | document-automation.routes | ❌ |
| `DELETE` | `/api/v1/document-automation/rules/:ruleId` | document-automation.routes | ❌ |
| `POST` | `/api/v1/document-automation/rules/:ruleId/enable` | document-automation.routes | ❌ |
| `POST` | `/api/v1/document-automation/rules/:ruleId/disable` | document-automation.routes | ❌ |
| `POST` | `/api/v1/document-automation/rules/:ruleId/trigger` | document-automation.routes | ❌ |
| `GET` | `/api/v1/document-automation/rules/:ruleId/history` | document-automation.routes | ❌ |

### /api/v1/files (21 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/files/list` | file-management.routes | ✅ |
| `GET` | `/api/v1/files/:file_id/info` | file-management.routes | ❌ |
| `PATCH` | `/api/v1/files/:file_id/metadata` | file-management.routes | ❌ |
| `GET` | `/api/v1/files/:file_id/permissions` | file-management.routes | ❌ |
| `POST` | `/api/v1/files/:file_id/permissions` | file-management.routes | ❌ |
| `DELETE` | `/api/v1/files/:file_id/permissions` | file-management.routes | ❌ |
| `POST` | `/api/v1/files/:file_id/move` | file-management.routes | ❌ |
| `POST` | `/api/v1/files/:file_id/copy` | file-management.routes | ❌ |
| `POST` | `/api/v1/files/:file_id/rename` | file-management.routes | ❌ |
| `GET` | `/api/v1/files/:file_id/activity` | file-management.routes | ❌ |
| `PUT` | `/api/v1/files/:file_id/tags` | file-management.routes | ❌ |
| `POST` | `/api/v1/files/:file_id/tags` | file-management.routes | ❌ |
| `DELETE` | `/api/v1/files/:file_id/tags/:tag` | file-management.routes | ❌ |
| `POST` | `/api/v1/files/:file_id/versions` | file-versions.routes | ❌ |
| `GET` | `/api/v1/files/:file_id/versions` | file-versions.routes | ❌ |
| `GET` | `/api/v1/files/:file_id/versions/:version_number` | file-versions.routes | ❌ |
| `GET` | `/api/v1/files/:file_id/versions/:version_number/download` | file-versions.routes | ❌ |
| `POST` | `/api/v1/files/:file_id/versions/restore` | file-versions.routes | ❌ |
| `DELETE` | `/api/v1/files/:file_id/versions/:version_number` | file-versions.routes | ❌ |
| `GET` | `/api/v1/files/:file_id/versions/compare` | file-versions.routes | ❌ |
| `GET` | `/api/v1/files/:file_id/versions/summary` | file-versions.routes | ❌ |

### /api/v1/auth/session (5 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/auth/session/refresh` | session.routes | ✅ |
| `GET` | `/api/v1/auth/session/list` | session.routes | ✅ |
| `GET` | `/api/v1/auth/session/:session_id` | session.routes | ❌ |
| `DELETE` | `/api/v1/auth/session/:session_id` | session.routes | ❌ |
| `DELETE` | `/api/v1/auth/session/` | session.routes | ✅ |

### /api/v1/notifications (12 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/notifications/` | notifications.routes | ❌ |
| `GET` | `/api/v1/notifications/unread-count` | notifications.routes | ❌ |
| `POST` | `/api/v1/notifications/:notification_id/read` | notifications.routes | ❌ |
| `POST` | `/api/v1/notifications/mark-all-read` | notifications.routes | ❌ |
| `DELETE` | `/api/v1/notifications/:notification_id` | notifications.routes | ❌ |
| `POST` | `/api/v1/notifications/clear` | notifications.routes | ❌ |
| `GET` | `/api/v1/notifications/preferences` | notifications.routes | ❌ |
| `PUT` | `/api/v1/notifications/preferences` | notifications.routes | ❌ |
| `POST` | `/api/v1/notifications/send` | notifications.routes | ❌ |
| `POST` | `/api/v1/notifications/broadcast` | notifications.routes | ❌ |
| `GET` | `/api/v1/notifications/types` | notifications.routes | ❌ |
| `GET` | `/api/v1/notifications/grouped` | notifications.routes | ❌ |

### /api/v1/activity (8 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/activity/feed` | activity.routes | ❌ |
| `GET` | `/api/v1/activity/user/:user_id` | activity.routes | ❌ |
| `GET` | `/api/v1/activity/resource/:resource_type/:resource_id` | activity.routes | ❌ |
| `GET` | `/api/v1/activity/matter/:matter_id` | activity.routes | ❌ |
| `GET` | `/api/v1/activity/recent` | activity.routes | ❌ |
| `GET` | `/api/v1/activity/stats` | activity.routes | ❌ |
| `POST` | `/api/v1/activity/log` | activity.routes | ❌ |
| `GET` | `/api/v1/activity/my` | activity.routes | ❌ |

### /api/v1/chat (7 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/chat/sessions` | chat.routes | ❌ |
| `POST` | `/api/v1/chat/sessions` | chat.routes | ❌ |
| `GET` | `/api/v1/chat/sessions/:sessionId` | chat.routes | ❌ |
| `PUT` | `/api/v1/chat/sessions/:sessionId` | chat.routes | ❌ |
| `DELETE` | `/api/v1/chat/sessions/:sessionId` | chat.routes | ❌ |
| `POST` | `/api/v1/chat/sessions/:sessionId/messages` | chat.routes | ❌ |
| `GET` | `/api/v1/chat/sessions/:sessionId/messages` | chat.routes | ❌ |

### /api/v1/users (30 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/users/` | user-management.routes | ❌ |
| `GET` | `/api/v1/users/` | user-management.routes | ❌ |
| `GET` | `/api/v1/users/:user_id` | user-management.routes | ❌ |
| `PUT` | `/api/v1/users/:user_id` | user-management.routes | ❌ |
| `DELETE` | `/api/v1/users/:user_id` | user-management.routes | ❌ |
| `POST` | `/api/v1/users/:user_id/activate` | user-management.routes | ❌ |
| `GET` | `/api/v1/users/me/profile` | user-profile.routes | ✅ |
| `PATCH` | `/api/v1/users/me/profile` | user-profile.routes | ❌ |
| `GET` | `/api/v1/users/me/preferences` | user-profile.routes | ✅ |
| `PATCH` | `/api/v1/users/me/preferences` | user-profile.routes | ✅ |
| `PUT` | `/api/v1/users/me/preferences/reset` | user-profile.routes | ✅ |
| `GET` | `/api/v1/users/me/security` | user-profile.routes | ✅ |
| `POST` | `/api/v1/users/me/security/mfa/setup` | user-profile.routes | ✅ |
| `POST` | `/api/v1/users/me/security/mfa/verify` | user-profile.routes | ✅ |
| `DELETE` | `/api/v1/users/me/security/mfa` | user-profile.routes | ✅ |
| `POST` | `/api/v1/users/me/security/mfa/backup-codes/regenerate` | user-profile.routes | ✅ |
| `PATCH` | `/api/v1/users/me/security/password` | user-profile.routes | ✅ |
| `PATCH` | `/api/v1/users/me/security/session-timeout` | user-profile.routes | ✅ |
| `PATCH` | `/api/v1/users/me/security/ip-restrictions` | user-profile.routes | ✅ |
| `POST` | `/api/v1/users/:user_id/mfa/setup` | mfa.routes | ❌ |
| `POST` | `/api/v1/users/:user_id/mfa/enable` | mfa.routes | ❌ |
| `POST` | `/api/v1/users/:user_id/mfa/verify` | mfa.routes | ❌ |
| `POST` | `/api/v1/users/:user_id/mfa/disable` | mfa.routes | ❌ |
| `POST` | `/api/v1/users/:user_id/api-tokens` | api-tokens.routes | ❌ |
| `GET` | `/api/v1/users/:user_id/api-tokens` | api-tokens.routes | ❌ |
| `DELETE` | `/api/v1/users/:user_id/api-tokens/:token_id` | api-tokens.routes | ❌ |
| `GET` | `/api/v1/users/:user_id/preferences` | user-preferences.routes | ❌ |
| `GET` | `/api/v1/users/:user_id/preferences/:key` | user-preferences.routes | ❌ |
| `PUT` | `/api/v1/users/:user_id/preferences/:key` | user-preferences.routes | ❌ |
| `DELETE` | `/api/v1/users/:user_id/preferences/:key` | user-preferences.routes | ❌ |

### /api/v1/workers (11 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/workers/status` | worker-status.routes | ✅ |
| `GET` | `/api/v1/workers/:worker_id/status` | worker-status.routes | ❌ |
| `POST` | `/api/v1/workers/:worker_id/pause` | worker-status.routes | ❌ |
| `POST` | `/api/v1/workers/:worker_id/resume` | worker-status.routes | ❌ |
| `GET` | `/api/v1/workers/queues` | worker-status.routes | ❌ |
| `GET` | `/api/v1/workers/jobs/pending` | worker-status.routes | ❌ |
| `GET` | `/api/v1/workers/jobs/failed` | worker-status.routes | ❌ |
| `POST` | `/api/v1/workers/jobs/:job_id/retry` | worker-status.routes | ❌ |
| `DELETE` | `/api/v1/workers/jobs/:job_id` | worker-status.routes | ❌ |
| `POST` | `/api/v1/workers/jobs/bulk-retry` | worker-status.routes | ❌ |
| `DELETE` | `/api/v1/workers/jobs/failed/clear` | worker-status.routes | ❌ |

### /api/v1/database (3 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/database/health` | database.routes | ✅ |
| `POST` | `/api/v1/database/query` | database.routes | ✅ |
| `POST` | `/api/v1/database/execute` | database.routes | ✅ |

### /api/v1/admin/health (3 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/admin/health/summary` | health-admin.routes | ❌ |
| `GET` | `/api/v1/admin/health/services` | health-admin.routes | ❌ |
| `GET` | `/api/v1/admin/health/metrics` | health-admin.routes | ❌ |

### /api/v1/permissions (6 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/permissions/all` | permissions.routes | ✅ |
| `POST` | `/api/v1/permissions/validate` | permissions.routes | ✅ |
| `GET` | `/api/v1/permissions/suggestions` | permissions.routes | ❌ |
| `POST` | `/api/v1/permissions/validate-batch` | permissions.routes | ❌ |
| `GET` | `/api/v1/permissions/matrix` | permissions.routes | ❌ |
| `GET` | `/api/v1/permissions/categories` | permissions.routes | ❌ |

### /api/v1/smart-query (5 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/smart-query/query` | smart-query.routes | ❌ |
| `POST` | `/api/v1/smart-query/stream` | smart-query.routes | ❌ |
| `POST` | `/api/v1/smart-query/classify` | smart-query.routes | ❌ |
| `GET` | `/api/v1/smart-query/sources` | smart-query.routes | ❌ |
| `GET` | `/api/v1/smart-query/keywords` | smart-query.routes | ❌ |

### /api/v1/auth (8 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/auth/login` | auth.routes | ✅ |
| `POST` | `/api/v1/auth/logout` | auth.routes | ✅ |
| `POST` | `/api/v1/auth/refresh` | auth.routes | ✅ |
| `GET` | `/api/v1/auth/me` | auth.routes | ✅ |
| `POST` | `/api/v1/auth/request-password-reset` | auth.routes | ✅ |
| `POST` | `/api/v1/auth/reset-password` | auth.routes | ✅ |
| `POST` | `/api/v1/auth/activate` | auth.routes | ❌ |
| `GET` | `/api/v1/auth/refresh` | auth.routes | ❌ |

### /api/v1/rbac (15 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/rbac/roles` | rbac.routes | ✅ |
| `GET` | `/api/v1/rbac/roles` | rbac.routes | ✅ |
| `GET` | `/api/v1/rbac/roles/:role_id` | rbac.routes | ❌ |
| `PUT` | `/api/v1/rbac/roles/:role_id` | rbac.routes | ❌ |
| `DELETE` | `/api/v1/rbac/roles/:role_id` | rbac.routes | ❌ |
| `GET` | `/api/v1/rbac/roles/:role_id/permissions` | rbac.routes | ❌ |
| `GET` | `/api/v1/rbac/roles/:role_id/permissions/inherited` | rbac.routes | ❌ |
| `POST` | `/api/v1/rbac/users/:user_id/roles` | rbac.routes | ❌ |
| `GET` | `/api/v1/rbac/users/:user_id/roles` | rbac.routes | ❌ |
| `DELETE` | `/api/v1/rbac/users/:user_id/roles/:role_id` | rbac.routes | ❌ |
| `POST` | `/api/v1/rbac/roles/:role_id/clone` | rbac.routes | ❌ |
| `GET` | `/api/v1/rbac/templates` | rbac.routes | ❌ |
| `POST` | `/api/v1/rbac/templates/:template_name/apply` | rbac.routes | ❌ |
| `POST` | `/api/v1/rbac/users/bulk-assign` | rbac.routes | ❌ |
| `GET` | `/api/v1/rbac/users/:user_id/permissions` | rbac.routes | ❌ |

### /api/v1/storage (30 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/storage/upload` | storage.routes | ✅ |
| `GET` | `/api/v1/storage/download/:document_id` | storage.routes | ❌ |
| `GET` | `/api/v1/storage/documents` | storage.routes | ❌ |
| `POST` | `/api/v1/storage/files/upload` | storage-v2.routes | ✅ |
| `GET` | `/api/v1/storage/files/:file_id/download` | storage-v2.routes | ❌ |
| `GET` | `/api/v1/storage/files/:file_id/view` | storage-v2.routes | ❌ |
| `GET` | `/api/v1/storage/files/:file_id` | storage-v2.routes | ❌ |
| `DELETE` | `/api/v1/storage/files/:file_id` | storage-v2.routes | ❌ |
| `GET` | `/api/v1/storage/files` | storage-v2.routes | ✅ |
| `POST` | `/api/v1/storage/batch/upload` | storage-v2.routes | ❌ |
| `POST` | `/api/v1/storage/batch/download` | storage-v2.routes | ❌ |
| `POST` | `/api/v1/storage/batch/delete` | storage-v2.routes | ❌ |
| `POST` | `/api/v1/storage/batch/metadata` | storage-v2.routes | ❌ |
| `POST` | `/api/v1/storage/batch/permissions/grant` | storage-v2.routes | ❌ |
| `POST` | `/api/v1/storage/files/:file_id/versions` | storage-v2.routes | ❌ |
| `GET` | `/api/v1/storage/files/:file_id/versions` | storage-v2.routes | ❌ |
| `GET` | `/api/v1/storage/files/:file_id/versions/:version/download` | storage-v2.routes | ❌ |
| `POST` | `/api/v1/storage/files/:file_id/versions/:version/restore` | storage-v2.routes | ❌ |
| `DELETE` | `/api/v1/storage/files/:file_id/versions/:version` | storage-v2.routes | ❌ |
| `GET` | `/api/v1/storage/health` | storage-v2.routes | ✅ |
| `GET` | `/api/v1/storage/stats` | storage-v2.routes | ✅ |
| `GET` | `/api/v1/storage/usage` | storage-v2.routes | ✅ |
| `GET` | `/api/v1/storage/usage/matters` | storage-v2.routes | ✅ |
| `GET` | `/api/v1/storage/usage/matters/:matter_id` | storage-v2.routes | ❌ |
| `POST` | `/api/v1/storage/files/:file_id/share` | storage-v2.routes | ❌ |
| `GET` | `/api/v1/storage/files/:file_id/shares` | storage-v2.routes | ❌ |
| `DELETE` | `/api/v1/storage/files/:file_id/shares/:share_id` | storage-v2.routes | ❌ |
| `GET` | `/api/v1/storage/shared/:token/download` | storage-v2.routes | ❌ |
| `GET` | `/api/v1/storage/shared/:token/info` | storage-v2.routes | ❌ |
| `GET` | `/api/v1/storage/shared/:token/view` | storage-v2.routes | ❌ |

### /api/v1/annotations (10 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/annotations/` | annotations.routes | ❌ |
| `GET` | `/api/v1/annotations/` | annotations.routes | ❌ |
| `GET` | `/api/v1/annotations/:annotation_id` | annotations.routes | ❌ |
| `PUT` | `/api/v1/annotations/:annotation_id` | annotations.routes | ❌ |
| `DELETE` | `/api/v1/annotations/:annotation_id` | annotations.routes | ❌ |
| `GET` | `/api/v1/annotations/document/:document_id/summary` | annotations.routes | ❌ |
| `POST` | `/api/v1/annotations/bulk` | annotations.routes | ❌ |
| `DELETE` | `/api/v1/annotations/document/:document_id` | annotations.routes | ❌ |
| `GET` | `/api/v1/annotations/my` | annotations.routes | ❌ |
| `GET` | `/api/v1/annotations/export/:document_id` | annotations.routes | ❌ |

### /api/v1/groups (9 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/groups/` | groups.routes | ✅ |
| `GET` | `/api/v1/groups/` | groups.routes | ✅ |
| `GET` | `/api/v1/groups/:group_id` | groups.routes | ❌ |
| `PUT` | `/api/v1/groups/:group_id` | groups.routes | ❌ |
| `DELETE` | `/api/v1/groups/:group_id` | groups.routes | ❌ |
| `POST` | `/api/v1/groups/:group_id/members` | groups.routes | ❌ |
| `GET` | `/api/v1/groups/:group_id/members` | groups.routes | ❌ |
| `POST` | `/api/v1/groups/:group_id/members/batch` | groups.routes | ❌ |
| `DELETE` | `/api/v1/groups/:group_id/members/:user_id` | groups.routes | ❌ |

### /api/v1/actionstep (18 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/actionstep/config` | actionstep.routes | ❌ |
| `POST` | `/api/v1/actionstep/config` | actionstep.routes | ❌ |
| `DELETE` | `/api/v1/actionstep/config` | actionstep.routes | ❌ |
| `POST` | `/api/v1/actionstep/config/verify` | actionstep.routes | ❌ |
| `POST` | `/api/v1/actionstep/sync` | actionstep.routes | ❌ |
| `POST` | `/api/v1/actionstep/documents/import` | actionstep.routes | ❌ |
| `GET` | `/api/v1/actionstep/documents/status` | actionstep.routes | ❌ |
| `GET` | `/api/v1/actionstep/documents/failed` | actionstep.routes | ❌ |
| `POST` | `/api/v1/actionstep/documents/retry/:importId` | actionstep.routes | ❌ |
| `GET` | `/api/v1/actionstep/sync-logs` | actionstep.routes | ❌ |
| `GET` | `/api/v1/actionstep/dashboard` | actionstep.routes | ❌ |
| `GET` | `/api/v1/actionstep/matters` | actionstep.routes | ❌ |
| `GET` | `/api/v1/actionstep/matters/:matterId` | actionstep.routes | ❌ |
| `GET` | `/api/v1/actionstep/participants` | actionstep.routes | ❌ |
| `GET` | `/api/v1/actionstep/participants/:participantId` | actionstep.routes | ❌ |
| `GET` | `/api/v1/actionstep/tasks` | actionstep.routes | ❌ |
| `GET` | `/api/v1/actionstep/file-notes` | actionstep.routes | ❌ |
| `POST` | `/api/v1/actionstep/search` | actionstep.routes | ❌ |

### /api/v1/comments (10 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/comments/` | comments.routes | ✅ |
| `GET` | `/api/v1/comments/` | comments.routes | ✅ |
| `GET` | `/api/v1/comments/:comment_id` | comments.routes | ❌ |
| `PUT` | `/api/v1/comments/:comment_id` | comments.routes | ❌ |
| `DELETE` | `/api/v1/comments/:comment_id` | comments.routes | ❌ |
| `GET` | `/api/v1/comments/:comment_id/replies` | comments.routes | ❌ |
| `POST` | `/api/v1/comments/:comment_id/reply` | comments.routes | ❌ |
| `GET` | `/api/v1/comments/mentions/me` | comments.routes | ❌ |
| `POST` | `/api/v1/comments/:comment_id/read` | comments.routes | ❌ |
| `GET` | `/api/v1/comments/stats` | comments.routes | ❌ |

### /api/v1/integration (3 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/integration/ingest` | integration-ingestion.routes | ❌ |
| `GET` | `/api/v1/integration/sources` | integration-ingestion.routes | ❌ |
| `GET` | `/api/v1/integration/ingestions` | integration-ingestion.routes | ❌ |

### /api/v1/admin/users (24 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/admin/users/` | admin-users.routes | ✅ |
| `GET` | `/api/v1/admin/users/check-email` | admin-users.routes | ✅ |
| `GET` | `/api/v1/admin/users/check-username` | admin-users.routes | ✅ |
| `GET` | `/api/v1/admin/users/count-superusers` | admin-users.routes | ✅ |
| `GET` | `/api/v1/admin/users/email/:email` | admin-users.routes | ❌ |
| `GET` | `/api/v1/admin/users/:user_id` | admin-users.routes | ❌ |
| `GET` | `/api/v1/admin/users/:user_id/details` | admin-users.routes | ❌ |
| `GET` | `/api/v1/admin/users/:user_id/simple` | admin-users.routes | ❌ |
| `POST` | `/api/v1/admin/users/` | admin-users.routes | ✅ |
| `PUT` | `/api/v1/admin/users/:user_id` | admin-users.routes | ❌ |
| `DELETE` | `/api/v1/admin/users/:user_id` | admin-users.routes | ❌ |
| `POST` | `/api/v1/admin/users/:user_id/deactivate` | admin-users.routes | ❌ |
| `POST` | `/api/v1/admin/users/:user_id/activate` | admin-users.routes | ❌ |
| `PATCH` | `/api/v1/admin/users/:user_id/status` | admin-users.routes | ❌ |
| `POST` | `/api/v1/admin/users/:user_id/force-logout` | admin-users.routes | ❌ |
| `POST` | `/api/v1/admin/users/:user_id/regenerate-activation-key` | admin-users.routes | ❌ |
| `PATCH` | `/api/v1/admin/users/:user_id/activation-code` | admin-users.routes | ❌ |
| `POST` | `/api/v1/admin/users/:user_id/temporary-password` | admin-users.routes | ❌ |
| `POST` | `/api/v1/admin/users/:user_id/reset-password` | admin-users.routes | ❌ |
| `GET` | `/api/v1/admin/users/:user_id/sessions` | admin-users.routes | ❌ |
| `DELETE` | `/api/v1/admin/users/:user_id/sessions` | admin-users.routes | ❌ |
| `POST` | `/api/v1/admin/users/:user_id/roles` | admin-users.routes | ❌ |
| `GET` | `/api/v1/admin/users/:user_id/roles` | admin-users.routes | ❌ |
| `DELETE` | `/api/v1/admin/users/:user_id/roles/:role_id` | admin-users.routes | ❌ |

### /api/v1/auth/service (4 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/auth/service/token` | service-token.routes | ❌ |
| `POST` | `/api/v1/auth/service/validate` | service-token.routes | ❌ |
| `GET` | `/api/v1/auth/service/token/info` | service-token.routes | ✅ |
| `POST` | `/api/v1/auth/service/refresh` | service-token.routes | ✅ |

### /api/v1/insights (12 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/insights/kpi-summary` | insights.routes | ❌ |
| `GET` | `/api/v1/insights/aging` | insights.routes | ❌ |
| `GET` | `/api/v1/insights/missed-followups` | insights.routes | ❌ |
| `POST` | `/api/v1/insights/followups/:followupId/reschedule` | insights.routes | ❌ |
| `POST` | `/api/v1/insights/followups/:followupId/complete` | insights.routes | ❌ |
| `GET` | `/api/v1/insights/predictions` | insights.routes | ❌ |
| `GET` | `/api/v1/insights/attribution` | insights.routes | ❌ |
| `GET` | `/api/v1/insights/funnel` | insights.routes | ❌ |
| `GET` | `/api/v1/insights/staff-metrics` | insights.routes | ❌ |
| `GET` | `/api/v1/insights/staff-metrics/:repId` | insights.routes | ❌ |
| `POST` | `/api/v1/insights/opportunities/:opportunityId/create-task` | insights.routes | ❌ |
| `GET` | `/api/v1/insights/export/:dataType` | insights.routes | ❌ |

### /api/v1/organizations (10 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/organizations/:org_id` | organizations.routes | ❌ |
| `PUT` | `/api/v1/organizations/:org_id` | organizations.routes | ❌ |
| `GET` | `/api/v1/organizations/:org_id/stats` | organizations.routes | ❌ |
| `GET` | `/api/v1/organizations/:org_id/members` | organizations.routes | ❌ |
| `POST` | `/api/v1/organizations/:org_id/members/invite` | organizations.routes | ❌ |
| `GET` | `/api/v1/organizations/:org_id/invitations` | organizations.routes | ❌ |
| `DELETE` | `/api/v1/organizations/:org_id/invitations/:invitation_id` | organizations.routes | ❌ |
| `GET` | `/api/v1/organizations/:org_id/settings` | organizations.routes | ❌ |
| `PUT` | `/api/v1/organizations/:org_id/settings` | organizations.routes | ❌ |
| `GET` | `/api/v1/organizations/:org_id/usage` | organizations.routes | ❌ |

### /api/v1/sharing (13 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/sharing/grant` | sharing.routes | ✅ |
| `GET` | `/api/v1/sharing/resources/:resource_type/:resource_id` | sharing.routes | ❌ |
| `GET` | `/api/v1/sharing/my-access` | sharing.routes | ❌ |
| `POST` | `/api/v1/sharing/revoke` | sharing.routes | ❌ |
| `GET` | `/api/v1/sharing/check-access` | sharing.routes | ❌ |
| `POST` | `/api/v1/sharing/check-access` | sharing.routes | ❌ |
| `GET` | `/api/v1/sharing/check` | sharing.routes | ❌ |
| `POST` | `/api/v1/sharing/check` | sharing.routes | ✅ |
| `POST` | `/api/v1/sharing/bulk` | sharing.routes | ❌ |
| `POST` | `/api/v1/sharing/create-link` | sharing.routes | ❌ |
| `DELETE` | `/api/v1/sharing/link/:token` | sharing.routes | ❌ |
| `POST` | `/api/v1/sharing/transfer-ownership` | sharing.routes | ❌ |
| `GET` | `/api/v1/sharing/links` | sharing.routes | ❌ |

### /api/v1/plugins (10 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/plugins/install` | plugin.routes | ✅ |
| `GET` | `/api/v1/plugins/installed` | plugin.routes | ❌ |
| `GET` | `/api/v1/plugins/marketplace` | plugin.routes | ❌ |
| `GET` | `/api/v1/plugins/` | plugin.routes | ✅ |
| `GET` | `/api/v1/plugins/:plugin_id` | plugin.routes | ❌ |
| `PUT` | `/api/v1/plugins/:plugin_id` | plugin.routes | ❌ |
| `POST` | `/api/v1/plugins/:plugin_id/start` | plugin.routes | ❌ |
| `POST` | `/api/v1/plugins/:plugin_id/stop` | plugin.routes | ❌ |
| `POST` | `/api/v1/plugins/:plugin_id/restart` | plugin.routes | ❌ |
| `DELETE` | `/api/v1/plugins/:plugin_id` | plugin.routes | ❌ |

### /api/v1/document-templates (8 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/document-templates/` | document-templates.routes | ❌ |
| `GET` | `/api/v1/document-templates/categories` | document-templates.routes | ❌ |
| `POST` | `/api/v1/document-templates/` | document-templates.routes | ❌ |
| `GET` | `/api/v1/document-templates/:templateId` | document-templates.routes | ❌ |
| `PUT` | `/api/v1/document-templates/:templateId` | document-templates.routes | ❌ |
| `DELETE` | `/api/v1/document-templates/:templateId` | document-templates.routes | ❌ |
| `POST` | `/api/v1/document-templates/:templateId/generate` | document-templates.routes | ❌ |
| `POST` | `/api/v1/document-templates/:templateId/clone` | document-templates.routes | ❌ |

### /api/v1/streaming (13 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/streaming/chat/stream` | streaming.routes | ✅ |
| `POST` | `/api/v1/streaming/rag/stream` | streaming.routes | ✅ |
| `GET` | `/api/v1/streaming/connections` | streaming.routes | ✅ |
| `GET` | `/api/v1/streaming/connections/status` | streaming.routes | ✅ |
| `POST` | `/api/v1/streaming/broadcast` | streaming.routes | ✅ |
| `POST` | `/api/v1/streaming/cleanup` | streaming.routes | ✅ |
| `GET` | `/api/v1/streaming/health` | streaming.routes | ✅ |
| `GET` | `/api/v1/streaming/ws/chat` | streaming.routes | ❌ |
| `GET` | `/api/v1/streaming/ws/rag` | streaming.routes | ❌ |
| `POST` | `/api/v1/streaming/disconnect/:client_id` | streaming.routes | ❌ |
| `GET` | `/api/v1/streaming/tools` | streaming.routes | ❌ |
| `POST` | `/api/v1/streaming/tools/:toolName/execute` | streaming.routes | ❌ |
| `GET` | `/api/v1/streaming/context/preview` | streaming.routes | ❌ |

### /api/v1/admin/sessions (2 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/admin/sessions/` | admin-sessions.routes | ❌ |
| `DELETE` | `/api/v1/admin/sessions/:session_id` | admin-sessions.routes | ❌ |

### /api/v1/documents (5 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/documents/:document_id` | document-metadata.routes | ❌ |
| `PUT` | `/api/v1/documents/:document_id/metadata` | document-metadata.routes | ❌ |
| `GET` | `/api/v1/documents/` | document-metadata.routes | ❌ |
| `POST` | `/api/v1/documents/:document_id/reindex` | document-metadata.routes | ❌ |
| `POST` | `/api/v1/documents/reindex/bulk` | document-metadata.routes | ❌ |

### /api/v1/integrations (10 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/integrations/connectors` | integrations.routes | ❌ |
| `GET` | `/api/v1/integrations/connectors/available` | integrations.routes | ❌ |
| `POST` | `/api/v1/integrations/connectors` | integrations.routes | ❌ |
| `GET` | `/api/v1/integrations/connectors/:connectorId` | integrations.routes | ❌ |
| `PUT` | `/api/v1/integrations/connectors/:connectorId` | integrations.routes | ❌ |
| `DELETE` | `/api/v1/integrations/connectors/:connectorId` | integrations.routes | ❌ |
| `POST` | `/api/v1/integrations/connectors/:connectorId/sync` | integrations.routes | ❌ |
| `GET` | `/api/v1/integrations/connectors/:connectorId/status` | integrations.routes | ❌ |
| `GET` | `/api/v1/integrations/stats` | integrations.routes | ❌ |
| `GET` | `/api/v1/integrations/sync-history` | integrations.routes | ❌ |

### /api/v1/session (11 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/session/create` | session-state.routes | ✅ |
| `POST` | `/api/v1/session/create-anonymous` | session-state.routes | ✅ |
| `GET` | `/api/v1/session/:session_id` | session-state.routes | ❌ |
| `POST` | `/api/v1/session/token/:concierge_token` | session-state.routes | ❌ |
| `PUT` | `/api/v1/session/state` | session-state.routes | ✅ |
| `POST` | `/api/v1/session/service/connect` | session-state.routes | ✅ |
| `DELETE` | `/api/v1/session/service/:session_id/:service_name` | session-state.routes | ❌ |
| `DELETE` | `/api/v1/session/:session_id` | session-state.routes | ❌ |
| `GET` | `/api/v1/session/user/:user_id/sessions` | session-state.routes | ❌ |
| `POST` | `/api/v1/session/convert-anonymous/:session_id` | session-state.routes | ❌ |
| `GET` | `/api/v1/session/health` | session-state.routes | ✅ |

### /api/client (4 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/client/update-policy` | client-updates.routes | ❌ |
| `GET` | `/api/client/update-policy/admin` | client-updates.routes | ❌ |
| `PUT` | `/api/client/update-policy/admin` | client-updates.routes | ❌ |
| `GET` | `/api/client/releases` | client-updates.routes | ❌ |

### /api/v1/batch-process (4 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/batch-process/submit` | batch-process.routes | ❌ |
| `GET` | `/api/v1/batch-process/:batch_id` | batch-process.routes | ❌ |
| `GET` | `/api/v1/batch-process/` | batch-process.routes | ❌ |
| `GET` | `/api/v1/batch-process/:batch_id/progress` | batch-process.routes | ❌ |

### /api/v1/system (9 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/system/info` | system.routes | ❌ |
| `GET` | `/api/v1/system/config` | system.routes | ❌ |
| `GET` | `/api/v1/system/metrics` | system.routes | ❌ |
| `POST` | `/api/v1/system/gc` | system.routes | ❌ |
| `GET` | `/api/v1/system/logs` | system.routes | ❌ |
| `POST` | `/api/v1/system/maintenance` | system.routes | ❌ |
| `GET` | `/api/v1/system/dependencies` | system.routes | ❌ |
| `GET` | `/api/v1/system/status` | system.routes | ❌ |
| `GET` | `/api/v1/system/version` | system.routes | ❌ |

### /api/v1/leadly (20 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/leadly/config` | leadly.routes | ❌ |
| `POST` | `/api/v1/leadly/config` | leadly.routes | ❌ |
| `DELETE` | `/api/v1/leadly/config` | leadly.routes | ❌ |
| `POST` | `/api/v1/leadly/config/test` | leadly.routes | ❌ |
| `GET` | `/api/v1/leadly/diagnostics` | leadly.routes | ❌ |
| `POST` | `/api/v1/leadly/sync` | leadly.routes | ❌ |
| `GET` | `/api/v1/leadly/dashboard` | leadly.routes | ❌ |
| `GET` | `/api/v1/leadly/contacts` | leadly.routes | ❌ |
| `GET` | `/api/v1/leadly/contacts/:contact_id` | leadly.routes | ❌ |
| `GET` | `/api/v1/leadly/contacts/analytics/sources` | leadly.routes | ❌ |
| `GET` | `/api/v1/leadly/contacts/analytics/tags` | leadly.routes | ❌ |
| `GET` | `/api/v1/leadly/opportunities` | leadly.routes | ❌ |
| `GET` | `/api/v1/leadly/pipelines` | leadly.routes | ❌ |
| `GET` | `/api/v1/leadly/opportunities/analytics/performance` | leadly.routes | ❌ |
| `GET` | `/api/v1/leadly/conversations` | leadly.routes | ❌ |
| `GET` | `/api/v1/leadly/conversations/analytics/channels` | leadly.routes | ❌ |
| `GET` | `/api/v1/leadly/tasks` | leadly.routes | ❌ |
| `GET` | `/api/v1/leadly/events` | leadly.routes | ❌ |
| `GET` | `/api/v1/leadly/sync-logs` | leadly.routes | ❌ |
| `GET` | `/api/v1/leadly/analytics/activity` | leadly.routes | ❌ |

### /api/v1/cache (8 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/cache/get/:key` | cache.routes | ❌ |
| `POST` | `/api/v1/cache/set` | cache.routes | ✅ |
| `DELETE` | `/api/v1/cache/delete/:key` | cache.routes | ❌ |
| `POST` | `/api/v1/cache/mget` | cache.routes | ✅ |
| `POST` | `/api/v1/cache/mset` | cache.routes | ✅ |
| `POST` | `/api/v1/cache/increment` | cache.routes | ✅ |
| `POST` | `/api/v1/cache/expire` | cache.routes | ✅ |
| `GET` | `/api/v1/cache/health` | cache.routes | ✅ |

### /api/v1/workflows (7 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/workflows/` | workflows.routes | ❌ |
| `POST` | `/api/v1/workflows/` | workflows.routes | ❌ |
| `GET` | `/api/v1/workflows/:workflowId` | workflows.routes | ❌ |
| `PUT` | `/api/v1/workflows/:workflowId` | workflows.routes | ❌ |
| `DELETE` | `/api/v1/workflows/:workflowId` | workflows.routes | ❌ |
| `POST` | `/api/v1/workflows/:workflowId/execute` | workflows.routes | ❌ |
| `GET` | `/api/v1/workflows/:workflowId/executions` | workflows.routes | ❌ |

### /api/v1/dlq (4 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/dlq/failed` | dlq.routes | ❌ |
| `GET` | `/api/v1/dlq/failed/:job_id` | dlq.routes | ❌ |
| `POST` | `/api/v1/dlq/:job_id/retry` | dlq.routes | ❌ |
| `POST` | `/api/v1/dlq/batch-retry` | dlq.routes | ❌ |

### /api/v1/ingest (10 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/ingest/by-file-id` | ingestion.routes | ❌ |
| `POST` | `/api/v1/ingest/external` | ingestion.routes | ✅ |
| `POST` | `/api/v1/ingest/external/batch` | ingestion.routes | ✅ |
| `POST` | `/api/v1/ingest/local` | ingestion.routes | ✅ |
| `POST` | `/api/v1/ingest/local/bulk` | ingestion.routes | ✅ |
| `GET` | `/api/v1/ingest/status/:job_id` | ingestion.routes | ❌ |
| `GET` | `/api/v1/ingest/jobs` | ingestion.routes | ❌ |
| `POST` | `/api/v1/ingest/jobs/:job_id/cancel` | ingestion.routes | ❌ |
| `GET` | `/api/v1/ingest/stats` | ingestion.routes | ❌ |
| `GET` | `/api/v1/ingest/health` | ingestion.routes | ❌ |

### /api/v1/audit (12 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/audit/logs` | audit.routes | ❌ |
| `POST` | `/api/v1/audit/query` | audit.routes | ❌ |
| `GET` | `/api/v1/audit/logs/:log_id` | audit.routes | ❌ |
| `GET` | `/api/v1/audit/archives` | audit.routes | ❌ |
| `GET` | `/api/v1/audit/archives/:archive_id` | audit.routes | ❌ |
| `POST` | `/api/v1/audit/validate/:archive_id` | audit.routes | ❌ |
| `GET` | `/api/v1/audit/retention-status` | audit.routes | ❌ |
| `GET` | `/api/v1/audit/compliance-report` | audit.routes | ❌ |
| `GET` | `/api/v1/audit/user/:user_id/logs` | audit.routes | ❌ |
| `GET` | `/api/v1/audit/event-types` | audit.routes | ❌ |
| `GET` | `/api/v1/audit/statistics` | audit.routes | ❌ |
| `POST` | `/api/v1/audit/export` | audit.routes | ❌ |

### /api/v1/jobs (5 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `GET` | `/api/v1/jobs/:job_id` | job-status.routes | ❌ |
| `GET` | `/api/v1/jobs/` | job-status.routes | ❌ |
| `GET` | `/api/v1/jobs/batch/:batch_id` | job-status.routes | ❌ |
| `POST` | `/api/v1/jobs/:job_id/cancel` | job-cancel.routes | ❌ |
| `POST` | `/api/v1/jobs/batch/:batch_id/cancel` | job-cancel.routes | ❌ |

### /api/v1/search (9 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/search/` | search.routes | ❌ |
| `POST` | `/api/v1/search/query` | search.routes | ✅ |
| `POST` | `/api/v1/search/hybrid` | search.routes | ✅ |
| `POST` | `/api/v1/search/autocomplete` | search.routes | ✅ |
| `GET` | `/api/v1/search/collections` | search.routes | ✅ |
| `POST` | `/api/v1/search/create-collection` | search.routes | ✅ |
| `DELETE` | `/api/v1/search/collection/:matter_id` | search.routes | ❌ |
| `GET` | `/api/v1/search/health` | search.routes | ✅ |
| `GET` | `/api/v1/search/stats` | search.routes | ❌ |

### /api/v1/webhook (6 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/webhook/register` | webhook.routes | ❌ |
| `GET` | `/api/v1/webhook/list` | webhook.routes | ❌ |
| `GET` | `/api/v1/webhook/:webhook_id` | webhook.routes | ❌ |
| `PUT` | `/api/v1/webhook/:webhook_id` | webhook.routes | ❌ |
| `DELETE` | `/api/v1/webhook/:webhook_id` | webhook.routes | ❌ |
| `POST` | `/api/v1/webhook/:webhook_id/test` | webhook.routes | ❌ |

### /api/v1/context (1 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/context/compile` | context.routes | ❌ |

### /api/v1/rag (9 endpoints)

| Method | Path | File | Documented |
|--------|------|------|------------|
| `POST` | `/api/v1/rag/query` | rag.routes | ✅ |
| `POST` | `/api/v1/rag/retrieve` | rag.routes | ✅ |
| `POST` | `/api/v1/rag/stream` | rag.routes | ✅ |
| `GET` | `/api/v1/rag/health` | rag.routes | ✅ |
| `GET` | `/api/v1/rag/stats` | rag.routes | ✅ |
| `POST` | `/api/v1/rag/concierge/query` | rag.routes | ✅ |
| `POST` | `/api/v1/rag/concierge/stream` | rag.routes | ✅ |
| `POST` | `/api/v1/rag/librarian/retrieve` | rag.routes | ✅ |
| `GET` | `/api/v1/rag/librarian/collections/:matter/stats` | rag.routes | ❌ |


---

## Endpoints Missing in Postman (416 endpoints)

These endpoints are implemented in the codebase but not documented in the Postman collection.


### /api/v1/memory (5 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `POST` | `/api/v1/memory/` | memory.routes |
| `GET` | `/api/v1/memory/` | memory.routes |
| `GET` | `/api/v1/memory/:memory_id` | memory.routes |
| `PUT` | `/api/v1/memory/:memory_id` | memory.routes |
| `DELETE` | `/api/v1/memory/:memory_id` | memory.routes |

### /api/v1/conversation (4 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `POST` | `/api/v1/conversation/` | conversation.routes |
| `GET` | `/api/v1/conversation/thread/:thread_id` | conversation.routes |
| `GET` | `/api/v1/conversation/threads` | conversation.routes |
| `DELETE` | `/api/v1/conversation/thread/:thread_id` | conversation.routes |

### /api/v1/admin/vpn (5 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/admin/vpn/devices` | admin-vpn.routes |
| `DELETE` | `/api/v1/admin/vpn/devices/:device_id` | admin-vpn.routes |
| `POST` | `/api/v1/admin/vpn/regenerate-bootstrap-psk` | admin-vpn.routes |
| `GET` | `/api/v1/admin/vpn/status` | admin-vpn.routes |
| `GET` | `/api/v1/admin/vpn/discovery-config` | admin-vpn.routes |

### /api/v1 (4 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/client-config` | vpn.routes |
| `DELETE` | `/api/v1/revoke` | vpn.routes |
| `GET` | `/api/v1/server-status` | vpn.routes |
| `GET` | `/api/v1/peers` | vpn.routes |

### /api/v1/vpn (6 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `POST` | `/api/v1/vpn/bootstrap-register` | device-registration.routes |
| `POST` | `/api/v1/vpn/register-device` | device-registration.routes |
| `GET` | `/api/v1/vpn/my-devices` | device-registration.routes |
| `GET` | `/api/v1/vpn/config` | device-registration.routes |
| `DELETE` | `/api/v1/vpn/devices/:device_id` | device-registration.routes |
| `POST` | `/api/v1/vpn/heartbeat` | device-registration.routes |

### /health (4 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/health/detailed` | health.routes |
| `GET` | `/health/ready` | health.routes |
| `GET` | `/health/live` | health.routes |
| `GET` | `/health/discovery` | health.routes |

### /api/v1/matters (21 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/matters/:matter_id/stats` | matter-analytics.routes |
| `GET` | `/api/v1/matters/:matter_id/documents-summary` | matter-analytics.routes |
| `POST` | `/api/v1/matters/:matter_id/access` | matter-access.routes |
| `GET` | `/api/v1/matters/:matter_id/access` | matter-access.routes |
| `DELETE` | `/api/v1/matters/:matter_id/access/:user_id` | matter-access.routes |
| `GET` | `/api/v1/matters/:matter_id/groups` | matter-access.routes |
| `POST` | `/api/v1/matters/:matter_id/groups` | matter-access.routes |
| `DELETE` | `/api/v1/matters/:matter_id/groups/:group_id` | matter-access.routes |
| `GET` | `/api/v1/matters/:matter_id/permissions` | matter-access.routes |
| `POST` | `/api/v1/matters/:matter_id/share/users` | matter-access.routes |
| `DELETE` | `/api/v1/matters/:matter_id/share/users/:user_id` | matter-access.routes |
| `GET` | `/api/v1/matters/search` | matters.routes |
| `GET` | `/api/v1/matters/recent` | matters.routes |
| `GET` | `/api/v1/matters/:matter_id` | matters.routes |
| `PUT` | `/api/v1/matters/:matter_id` | matters.routes |
| `DELETE` | `/api/v1/matters/:matter_id` | matters.routes |
| `POST` | `/api/v1/matters/:matter_id/archive` | matters.routes |
| `POST` | `/api/v1/matters/:matter_id/unarchive` | matters.routes |
| `POST` | `/api/v1/matters/:matter_id/clone` | matters.routes |
| `GET` | `/api/v1/matters/:matter_id/settings` | matters.routes |
| `PUT` | `/api/v1/matters/:matter_id/settings` | matters.routes |

### /api/v1/document-automation (11 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/document-automation/rules` | document-automation.routes |
| `GET` | `/api/v1/document-automation/trigger-types` | document-automation.routes |
| `GET` | `/api/v1/document-automation/action-types` | document-automation.routes |
| `POST` | `/api/v1/document-automation/rules` | document-automation.routes |
| `GET` | `/api/v1/document-automation/rules/:ruleId` | document-automation.routes |
| `PUT` | `/api/v1/document-automation/rules/:ruleId` | document-automation.routes |
| `DELETE` | `/api/v1/document-automation/rules/:ruleId` | document-automation.routes |
| `POST` | `/api/v1/document-automation/rules/:ruleId/enable` | document-automation.routes |
| `POST` | `/api/v1/document-automation/rules/:ruleId/disable` | document-automation.routes |
| `POST` | `/api/v1/document-automation/rules/:ruleId/trigger` | document-automation.routes |
| `GET` | `/api/v1/document-automation/rules/:ruleId/history` | document-automation.routes |

### /api/v1/files (20 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/files/:file_id/info` | file-management.routes |
| `PATCH` | `/api/v1/files/:file_id/metadata` | file-management.routes |
| `GET` | `/api/v1/files/:file_id/permissions` | file-management.routes |
| `POST` | `/api/v1/files/:file_id/permissions` | file-management.routes |
| `DELETE` | `/api/v1/files/:file_id/permissions` | file-management.routes |
| `POST` | `/api/v1/files/:file_id/move` | file-management.routes |
| `POST` | `/api/v1/files/:file_id/copy` | file-management.routes |
| `POST` | `/api/v1/files/:file_id/rename` | file-management.routes |
| `GET` | `/api/v1/files/:file_id/activity` | file-management.routes |
| `PUT` | `/api/v1/files/:file_id/tags` | file-management.routes |
| `POST` | `/api/v1/files/:file_id/tags` | file-management.routes |
| `DELETE` | `/api/v1/files/:file_id/tags/:tag` | file-management.routes |
| `POST` | `/api/v1/files/:file_id/versions` | file-versions.routes |
| `GET` | `/api/v1/files/:file_id/versions` | file-versions.routes |
| `GET` | `/api/v1/files/:file_id/versions/:version_number` | file-versions.routes |
| `GET` | `/api/v1/files/:file_id/versions/:version_number/download` | file-versions.routes |
| `POST` | `/api/v1/files/:file_id/versions/restore` | file-versions.routes |
| `DELETE` | `/api/v1/files/:file_id/versions/:version_number` | file-versions.routes |
| `GET` | `/api/v1/files/:file_id/versions/compare` | file-versions.routes |
| `GET` | `/api/v1/files/:file_id/versions/summary` | file-versions.routes |

### /api/v1/auth/session (2 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/auth/session/:session_id` | session.routes |
| `DELETE` | `/api/v1/auth/session/:session_id` | session.routes |

### /api/v1/notifications (12 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/notifications/` | notifications.routes |
| `GET` | `/api/v1/notifications/unread-count` | notifications.routes |
| `POST` | `/api/v1/notifications/:notification_id/read` | notifications.routes |
| `POST` | `/api/v1/notifications/mark-all-read` | notifications.routes |
| `DELETE` | `/api/v1/notifications/:notification_id` | notifications.routes |
| `POST` | `/api/v1/notifications/clear` | notifications.routes |
| `GET` | `/api/v1/notifications/preferences` | notifications.routes |
| `PUT` | `/api/v1/notifications/preferences` | notifications.routes |
| `POST` | `/api/v1/notifications/send` | notifications.routes |
| `POST` | `/api/v1/notifications/broadcast` | notifications.routes |
| `GET` | `/api/v1/notifications/types` | notifications.routes |
| `GET` | `/api/v1/notifications/grouped` | notifications.routes |

### /api/v1/activity (8 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/activity/feed` | activity.routes |
| `GET` | `/api/v1/activity/user/:user_id` | activity.routes |
| `GET` | `/api/v1/activity/resource/:resource_type/:resource_id` | activity.routes |
| `GET` | `/api/v1/activity/matter/:matter_id` | activity.routes |
| `GET` | `/api/v1/activity/recent` | activity.routes |
| `GET` | `/api/v1/activity/stats` | activity.routes |
| `POST` | `/api/v1/activity/log` | activity.routes |
| `GET` | `/api/v1/activity/my` | activity.routes |

### /api/v1/chat (7 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/chat/sessions` | chat.routes |
| `POST` | `/api/v1/chat/sessions` | chat.routes |
| `GET` | `/api/v1/chat/sessions/:sessionId` | chat.routes |
| `PUT` | `/api/v1/chat/sessions/:sessionId` | chat.routes |
| `DELETE` | `/api/v1/chat/sessions/:sessionId` | chat.routes |
| `POST` | `/api/v1/chat/sessions/:sessionId/messages` | chat.routes |
| `GET` | `/api/v1/chat/sessions/:sessionId/messages` | chat.routes |

### /api/v1/users (18 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `POST` | `/api/v1/users/` | user-management.routes |
| `GET` | `/api/v1/users/` | user-management.routes |
| `GET` | `/api/v1/users/:user_id` | user-management.routes |
| `PUT` | `/api/v1/users/:user_id` | user-management.routes |
| `DELETE` | `/api/v1/users/:user_id` | user-management.routes |
| `POST` | `/api/v1/users/:user_id/activate` | user-management.routes |
| `PATCH` | `/api/v1/users/me/profile` | user-profile.routes |
| `POST` | `/api/v1/users/:user_id/mfa/setup` | mfa.routes |
| `POST` | `/api/v1/users/:user_id/mfa/enable` | mfa.routes |
| `POST` | `/api/v1/users/:user_id/mfa/verify` | mfa.routes |
| `POST` | `/api/v1/users/:user_id/mfa/disable` | mfa.routes |
| `POST` | `/api/v1/users/:user_id/api-tokens` | api-tokens.routes |
| `GET` | `/api/v1/users/:user_id/api-tokens` | api-tokens.routes |
| `DELETE` | `/api/v1/users/:user_id/api-tokens/:token_id` | api-tokens.routes |
| `GET` | `/api/v1/users/:user_id/preferences` | user-preferences.routes |
| `GET` | `/api/v1/users/:user_id/preferences/:key` | user-preferences.routes |
| `PUT` | `/api/v1/users/:user_id/preferences/:key` | user-preferences.routes |
| `DELETE` | `/api/v1/users/:user_id/preferences/:key` | user-preferences.routes |

### /api/v1/workers (10 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/workers/:worker_id/status` | worker-status.routes |
| `POST` | `/api/v1/workers/:worker_id/pause` | worker-status.routes |
| `POST` | `/api/v1/workers/:worker_id/resume` | worker-status.routes |
| `GET` | `/api/v1/workers/queues` | worker-status.routes |
| `GET` | `/api/v1/workers/jobs/pending` | worker-status.routes |
| `GET` | `/api/v1/workers/jobs/failed` | worker-status.routes |
| `POST` | `/api/v1/workers/jobs/:job_id/retry` | worker-status.routes |
| `DELETE` | `/api/v1/workers/jobs/:job_id` | worker-status.routes |
| `POST` | `/api/v1/workers/jobs/bulk-retry` | worker-status.routes |
| `DELETE` | `/api/v1/workers/jobs/failed/clear` | worker-status.routes |

### /api/v1/admin/health (3 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/admin/health/summary` | health-admin.routes |
| `GET` | `/api/v1/admin/health/services` | health-admin.routes |
| `GET` | `/api/v1/admin/health/metrics` | health-admin.routes |

### /api/v1/permissions (4 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/permissions/suggestions` | permissions.routes |
| `POST` | `/api/v1/permissions/validate-batch` | permissions.routes |
| `GET` | `/api/v1/permissions/matrix` | permissions.routes |
| `GET` | `/api/v1/permissions/categories` | permissions.routes |

### /api/v1/smart-query (5 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `POST` | `/api/v1/smart-query/query` | smart-query.routes |
| `POST` | `/api/v1/smart-query/stream` | smart-query.routes |
| `POST` | `/api/v1/smart-query/classify` | smart-query.routes |
| `GET` | `/api/v1/smart-query/sources` | smart-query.routes |
| `GET` | `/api/v1/smart-query/keywords` | smart-query.routes |

### /api/v1/auth (2 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `POST` | `/api/v1/auth/activate` | auth.routes |
| `GET` | `/api/v1/auth/refresh` | auth.routes |

### /api/v1/rbac (13 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/rbac/roles/:role_id` | rbac.routes |
| `PUT` | `/api/v1/rbac/roles/:role_id` | rbac.routes |
| `DELETE` | `/api/v1/rbac/roles/:role_id` | rbac.routes |
| `GET` | `/api/v1/rbac/roles/:role_id/permissions` | rbac.routes |
| `GET` | `/api/v1/rbac/roles/:role_id/permissions/inherited` | rbac.routes |
| `POST` | `/api/v1/rbac/users/:user_id/roles` | rbac.routes |
| `GET` | `/api/v1/rbac/users/:user_id/roles` | rbac.routes |
| `DELETE` | `/api/v1/rbac/users/:user_id/roles/:role_id` | rbac.routes |
| `POST` | `/api/v1/rbac/roles/:role_id/clone` | rbac.routes |
| `GET` | `/api/v1/rbac/templates` | rbac.routes |
| `POST` | `/api/v1/rbac/templates/:template_name/apply` | rbac.routes |
| `POST` | `/api/v1/rbac/users/bulk-assign` | rbac.routes |
| `GET` | `/api/v1/rbac/users/:user_id/permissions` | rbac.routes |

### /api/v1/storage (23 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/storage/download/:document_id` | storage.routes |
| `GET` | `/api/v1/storage/documents` | storage.routes |
| `GET` | `/api/v1/storage/files/:file_id/download` | storage-v2.routes |
| `GET` | `/api/v1/storage/files/:file_id/view` | storage-v2.routes |
| `GET` | `/api/v1/storage/files/:file_id` | storage-v2.routes |
| `DELETE` | `/api/v1/storage/files/:file_id` | storage-v2.routes |
| `POST` | `/api/v1/storage/batch/upload` | storage-v2.routes |
| `POST` | `/api/v1/storage/batch/download` | storage-v2.routes |
| `POST` | `/api/v1/storage/batch/delete` | storage-v2.routes |
| `POST` | `/api/v1/storage/batch/metadata` | storage-v2.routes |
| `POST` | `/api/v1/storage/batch/permissions/grant` | storage-v2.routes |
| `POST` | `/api/v1/storage/files/:file_id/versions` | storage-v2.routes |
| `GET` | `/api/v1/storage/files/:file_id/versions` | storage-v2.routes |
| `GET` | `/api/v1/storage/files/:file_id/versions/:version/download` | storage-v2.routes |
| `POST` | `/api/v1/storage/files/:file_id/versions/:version/restore` | storage-v2.routes |
| `DELETE` | `/api/v1/storage/files/:file_id/versions/:version` | storage-v2.routes |
| `GET` | `/api/v1/storage/usage/matters/:matter_id` | storage-v2.routes |
| `POST` | `/api/v1/storage/files/:file_id/share` | storage-v2.routes |
| `GET` | `/api/v1/storage/files/:file_id/shares` | storage-v2.routes |
| `DELETE` | `/api/v1/storage/files/:file_id/shares/:share_id` | storage-v2.routes |
| `GET` | `/api/v1/storage/shared/:token/download` | storage-v2.routes |
| `GET` | `/api/v1/storage/shared/:token/info` | storage-v2.routes |
| `GET` | `/api/v1/storage/shared/:token/view` | storage-v2.routes |

### /api/v1/annotations (10 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `POST` | `/api/v1/annotations/` | annotations.routes |
| `GET` | `/api/v1/annotations/` | annotations.routes |
| `GET` | `/api/v1/annotations/:annotation_id` | annotations.routes |
| `PUT` | `/api/v1/annotations/:annotation_id` | annotations.routes |
| `DELETE` | `/api/v1/annotations/:annotation_id` | annotations.routes |
| `GET` | `/api/v1/annotations/document/:document_id/summary` | annotations.routes |
| `POST` | `/api/v1/annotations/bulk` | annotations.routes |
| `DELETE` | `/api/v1/annotations/document/:document_id` | annotations.routes |
| `GET` | `/api/v1/annotations/my` | annotations.routes |
| `GET` | `/api/v1/annotations/export/:document_id` | annotations.routes |

### /api/v1/groups (7 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/groups/:group_id` | groups.routes |
| `PUT` | `/api/v1/groups/:group_id` | groups.routes |
| `DELETE` | `/api/v1/groups/:group_id` | groups.routes |
| `POST` | `/api/v1/groups/:group_id/members` | groups.routes |
| `GET` | `/api/v1/groups/:group_id/members` | groups.routes |
| `POST` | `/api/v1/groups/:group_id/members/batch` | groups.routes |
| `DELETE` | `/api/v1/groups/:group_id/members/:user_id` | groups.routes |

### /api/v1/actionstep (18 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/actionstep/config` | actionstep.routes |
| `POST` | `/api/v1/actionstep/config` | actionstep.routes |
| `DELETE` | `/api/v1/actionstep/config` | actionstep.routes |
| `POST` | `/api/v1/actionstep/config/verify` | actionstep.routes |
| `POST` | `/api/v1/actionstep/sync` | actionstep.routes |
| `POST` | `/api/v1/actionstep/documents/import` | actionstep.routes |
| `GET` | `/api/v1/actionstep/documents/status` | actionstep.routes |
| `GET` | `/api/v1/actionstep/documents/failed` | actionstep.routes |
| `POST` | `/api/v1/actionstep/documents/retry/:importId` | actionstep.routes |
| `GET` | `/api/v1/actionstep/sync-logs` | actionstep.routes |
| `GET` | `/api/v1/actionstep/dashboard` | actionstep.routes |
| `GET` | `/api/v1/actionstep/matters` | actionstep.routes |
| `GET` | `/api/v1/actionstep/matters/:matterId` | actionstep.routes |
| `GET` | `/api/v1/actionstep/participants` | actionstep.routes |
| `GET` | `/api/v1/actionstep/participants/:participantId` | actionstep.routes |
| `GET` | `/api/v1/actionstep/tasks` | actionstep.routes |
| `GET` | `/api/v1/actionstep/file-notes` | actionstep.routes |
| `POST` | `/api/v1/actionstep/search` | actionstep.routes |

### /api/v1/comments (8 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/comments/:comment_id` | comments.routes |
| `PUT` | `/api/v1/comments/:comment_id` | comments.routes |
| `DELETE` | `/api/v1/comments/:comment_id` | comments.routes |
| `GET` | `/api/v1/comments/:comment_id/replies` | comments.routes |
| `POST` | `/api/v1/comments/:comment_id/reply` | comments.routes |
| `GET` | `/api/v1/comments/mentions/me` | comments.routes |
| `POST` | `/api/v1/comments/:comment_id/read` | comments.routes |
| `GET` | `/api/v1/comments/stats` | comments.routes |

### /api/v1/integration (3 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `POST` | `/api/v1/integration/ingest` | integration-ingestion.routes |
| `GET` | `/api/v1/integration/sources` | integration-ingestion.routes |
| `GET` | `/api/v1/integration/ingestions` | integration-ingestion.routes |

### /api/v1/admin/users (19 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/admin/users/email/:email` | admin-users.routes |
| `GET` | `/api/v1/admin/users/:user_id` | admin-users.routes |
| `GET` | `/api/v1/admin/users/:user_id/details` | admin-users.routes |
| `GET` | `/api/v1/admin/users/:user_id/simple` | admin-users.routes |
| `PUT` | `/api/v1/admin/users/:user_id` | admin-users.routes |
| `DELETE` | `/api/v1/admin/users/:user_id` | admin-users.routes |
| `POST` | `/api/v1/admin/users/:user_id/deactivate` | admin-users.routes |
| `POST` | `/api/v1/admin/users/:user_id/activate` | admin-users.routes |
| `PATCH` | `/api/v1/admin/users/:user_id/status` | admin-users.routes |
| `POST` | `/api/v1/admin/users/:user_id/force-logout` | admin-users.routes |
| `POST` | `/api/v1/admin/users/:user_id/regenerate-activation-key` | admin-users.routes |
| `PATCH` | `/api/v1/admin/users/:user_id/activation-code` | admin-users.routes |
| `POST` | `/api/v1/admin/users/:user_id/temporary-password` | admin-users.routes |
| `POST` | `/api/v1/admin/users/:user_id/reset-password` | admin-users.routes |
| `GET` | `/api/v1/admin/users/:user_id/sessions` | admin-users.routes |
| `DELETE` | `/api/v1/admin/users/:user_id/sessions` | admin-users.routes |
| `POST` | `/api/v1/admin/users/:user_id/roles` | admin-users.routes |
| `GET` | `/api/v1/admin/users/:user_id/roles` | admin-users.routes |
| `DELETE` | `/api/v1/admin/users/:user_id/roles/:role_id` | admin-users.routes |

### /api/v1/auth/service (2 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `POST` | `/api/v1/auth/service/token` | service-token.routes |
| `POST` | `/api/v1/auth/service/validate` | service-token.routes |

### /api/v1/insights (12 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/insights/kpi-summary` | insights.routes |
| `GET` | `/api/v1/insights/aging` | insights.routes |
| `GET` | `/api/v1/insights/missed-followups` | insights.routes |
| `POST` | `/api/v1/insights/followups/:followupId/reschedule` | insights.routes |
| `POST` | `/api/v1/insights/followups/:followupId/complete` | insights.routes |
| `GET` | `/api/v1/insights/predictions` | insights.routes |
| `GET` | `/api/v1/insights/attribution` | insights.routes |
| `GET` | `/api/v1/insights/funnel` | insights.routes |
| `GET` | `/api/v1/insights/staff-metrics` | insights.routes |
| `GET` | `/api/v1/insights/staff-metrics/:repId` | insights.routes |
| `POST` | `/api/v1/insights/opportunities/:opportunityId/create-task` | insights.routes |
| `GET` | `/api/v1/insights/export/:dataType` | insights.routes |

### /api/v1/organizations (10 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/organizations/:org_id` | organizations.routes |
| `PUT` | `/api/v1/organizations/:org_id` | organizations.routes |
| `GET` | `/api/v1/organizations/:org_id/stats` | organizations.routes |
| `GET` | `/api/v1/organizations/:org_id/members` | organizations.routes |
| `POST` | `/api/v1/organizations/:org_id/members/invite` | organizations.routes |
| `GET` | `/api/v1/organizations/:org_id/invitations` | organizations.routes |
| `DELETE` | `/api/v1/organizations/:org_id/invitations/:invitation_id` | organizations.routes |
| `GET` | `/api/v1/organizations/:org_id/settings` | organizations.routes |
| `PUT` | `/api/v1/organizations/:org_id/settings` | organizations.routes |
| `GET` | `/api/v1/organizations/:org_id/usage` | organizations.routes |

### /api/v1/sharing (11 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/sharing/resources/:resource_type/:resource_id` | sharing.routes |
| `GET` | `/api/v1/sharing/my-access` | sharing.routes |
| `POST` | `/api/v1/sharing/revoke` | sharing.routes |
| `GET` | `/api/v1/sharing/check-access` | sharing.routes |
| `POST` | `/api/v1/sharing/check-access` | sharing.routes |
| `GET` | `/api/v1/sharing/check` | sharing.routes |
| `POST` | `/api/v1/sharing/bulk` | sharing.routes |
| `POST` | `/api/v1/sharing/create-link` | sharing.routes |
| `DELETE` | `/api/v1/sharing/link/:token` | sharing.routes |
| `POST` | `/api/v1/sharing/transfer-ownership` | sharing.routes |
| `GET` | `/api/v1/sharing/links` | sharing.routes |

### /api/v1/plugins (8 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/plugins/installed` | plugin.routes |
| `GET` | `/api/v1/plugins/marketplace` | plugin.routes |
| `GET` | `/api/v1/plugins/:plugin_id` | plugin.routes |
| `PUT` | `/api/v1/plugins/:plugin_id` | plugin.routes |
| `POST` | `/api/v1/plugins/:plugin_id/start` | plugin.routes |
| `POST` | `/api/v1/plugins/:plugin_id/stop` | plugin.routes |
| `POST` | `/api/v1/plugins/:plugin_id/restart` | plugin.routes |
| `DELETE` | `/api/v1/plugins/:plugin_id` | plugin.routes |

### /api/v1/document-templates (8 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/document-templates/` | document-templates.routes |
| `GET` | `/api/v1/document-templates/categories` | document-templates.routes |
| `POST` | `/api/v1/document-templates/` | document-templates.routes |
| `GET` | `/api/v1/document-templates/:templateId` | document-templates.routes |
| `PUT` | `/api/v1/document-templates/:templateId` | document-templates.routes |
| `DELETE` | `/api/v1/document-templates/:templateId` | document-templates.routes |
| `POST` | `/api/v1/document-templates/:templateId/generate` | document-templates.routes |
| `POST` | `/api/v1/document-templates/:templateId/clone` | document-templates.routes |

### /api/v1/streaming (6 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/streaming/ws/chat` | streaming.routes |
| `GET` | `/api/v1/streaming/ws/rag` | streaming.routes |
| `POST` | `/api/v1/streaming/disconnect/:client_id` | streaming.routes |
| `GET` | `/api/v1/streaming/tools` | streaming.routes |
| `POST` | `/api/v1/streaming/tools/:toolName/execute` | streaming.routes |
| `GET` | `/api/v1/streaming/context/preview` | streaming.routes |

### /api/v1/admin/sessions (2 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/admin/sessions/` | admin-sessions.routes |
| `DELETE` | `/api/v1/admin/sessions/:session_id` | admin-sessions.routes |

### /api/v1/documents (5 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/documents/:document_id` | document-metadata.routes |
| `PUT` | `/api/v1/documents/:document_id/metadata` | document-metadata.routes |
| `GET` | `/api/v1/documents/` | document-metadata.routes |
| `POST` | `/api/v1/documents/:document_id/reindex` | document-metadata.routes |
| `POST` | `/api/v1/documents/reindex/bulk` | document-metadata.routes |

### /api/v1/integrations (10 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/integrations/connectors` | integrations.routes |
| `GET` | `/api/v1/integrations/connectors/available` | integrations.routes |
| `POST` | `/api/v1/integrations/connectors` | integrations.routes |
| `GET` | `/api/v1/integrations/connectors/:connectorId` | integrations.routes |
| `PUT` | `/api/v1/integrations/connectors/:connectorId` | integrations.routes |
| `DELETE` | `/api/v1/integrations/connectors/:connectorId` | integrations.routes |
| `POST` | `/api/v1/integrations/connectors/:connectorId/sync` | integrations.routes |
| `GET` | `/api/v1/integrations/connectors/:connectorId/status` | integrations.routes |
| `GET` | `/api/v1/integrations/stats` | integrations.routes |
| `GET` | `/api/v1/integrations/sync-history` | integrations.routes |

### /api/v1/session (6 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/session/:session_id` | session-state.routes |
| `POST` | `/api/v1/session/token/:concierge_token` | session-state.routes |
| `DELETE` | `/api/v1/session/service/:session_id/:service_name` | session-state.routes |
| `DELETE` | `/api/v1/session/:session_id` | session-state.routes |
| `GET` | `/api/v1/session/user/:user_id/sessions` | session-state.routes |
| `POST` | `/api/v1/session/convert-anonymous/:session_id` | session-state.routes |

### /api/client (4 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/client/update-policy` | client-updates.routes |
| `GET` | `/api/client/update-policy/admin` | client-updates.routes |
| `PUT` | `/api/client/update-policy/admin` | client-updates.routes |
| `GET` | `/api/client/releases` | client-updates.routes |

### /api/v1/batch-process (4 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `POST` | `/api/v1/batch-process/submit` | batch-process.routes |
| `GET` | `/api/v1/batch-process/:batch_id` | batch-process.routes |
| `GET` | `/api/v1/batch-process/` | batch-process.routes |
| `GET` | `/api/v1/batch-process/:batch_id/progress` | batch-process.routes |

### /api/v1/system (9 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/system/info` | system.routes |
| `GET` | `/api/v1/system/config` | system.routes |
| `GET` | `/api/v1/system/metrics` | system.routes |
| `POST` | `/api/v1/system/gc` | system.routes |
| `GET` | `/api/v1/system/logs` | system.routes |
| `POST` | `/api/v1/system/maintenance` | system.routes |
| `GET` | `/api/v1/system/dependencies` | system.routes |
| `GET` | `/api/v1/system/status` | system.routes |
| `GET` | `/api/v1/system/version` | system.routes |

### /api/v1/leadly (20 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/leadly/config` | leadly.routes |
| `POST` | `/api/v1/leadly/config` | leadly.routes |
| `DELETE` | `/api/v1/leadly/config` | leadly.routes |
| `POST` | `/api/v1/leadly/config/test` | leadly.routes |
| `GET` | `/api/v1/leadly/diagnostics` | leadly.routes |
| `POST` | `/api/v1/leadly/sync` | leadly.routes |
| `GET` | `/api/v1/leadly/dashboard` | leadly.routes |
| `GET` | `/api/v1/leadly/contacts` | leadly.routes |
| `GET` | `/api/v1/leadly/contacts/:contact_id` | leadly.routes |
| `GET` | `/api/v1/leadly/contacts/analytics/sources` | leadly.routes |
| `GET` | `/api/v1/leadly/contacts/analytics/tags` | leadly.routes |
| `GET` | `/api/v1/leadly/opportunities` | leadly.routes |
| `GET` | `/api/v1/leadly/pipelines` | leadly.routes |
| `GET` | `/api/v1/leadly/opportunities/analytics/performance` | leadly.routes |
| `GET` | `/api/v1/leadly/conversations` | leadly.routes |
| `GET` | `/api/v1/leadly/conversations/analytics/channels` | leadly.routes |
| `GET` | `/api/v1/leadly/tasks` | leadly.routes |
| `GET` | `/api/v1/leadly/events` | leadly.routes |
| `GET` | `/api/v1/leadly/sync-logs` | leadly.routes |
| `GET` | `/api/v1/leadly/analytics/activity` | leadly.routes |

### /api/v1/cache (2 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/cache/get/:key` | cache.routes |
| `DELETE` | `/api/v1/cache/delete/:key` | cache.routes |

### /api/v1/workflows (7 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/workflows/` | workflows.routes |
| `POST` | `/api/v1/workflows/` | workflows.routes |
| `GET` | `/api/v1/workflows/:workflowId` | workflows.routes |
| `PUT` | `/api/v1/workflows/:workflowId` | workflows.routes |
| `DELETE` | `/api/v1/workflows/:workflowId` | workflows.routes |
| `POST` | `/api/v1/workflows/:workflowId/execute` | workflows.routes |
| `GET` | `/api/v1/workflows/:workflowId/executions` | workflows.routes |

### /api/v1/dlq (4 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/dlq/failed` | dlq.routes |
| `GET` | `/api/v1/dlq/failed/:job_id` | dlq.routes |
| `POST` | `/api/v1/dlq/:job_id/retry` | dlq.routes |
| `POST` | `/api/v1/dlq/batch-retry` | dlq.routes |

### /api/v1/ingest (6 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `POST` | `/api/v1/ingest/by-file-id` | ingestion.routes |
| `GET` | `/api/v1/ingest/status/:job_id` | ingestion.routes |
| `GET` | `/api/v1/ingest/jobs` | ingestion.routes |
| `POST` | `/api/v1/ingest/jobs/:job_id/cancel` | ingestion.routes |
| `GET` | `/api/v1/ingest/stats` | ingestion.routes |
| `GET` | `/api/v1/ingest/health` | ingestion.routes |

### /api/v1/audit (12 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/audit/logs` | audit.routes |
| `POST` | `/api/v1/audit/query` | audit.routes |
| `GET` | `/api/v1/audit/logs/:log_id` | audit.routes |
| `GET` | `/api/v1/audit/archives` | audit.routes |
| `GET` | `/api/v1/audit/archives/:archive_id` | audit.routes |
| `POST` | `/api/v1/audit/validate/:archive_id` | audit.routes |
| `GET` | `/api/v1/audit/retention-status` | audit.routes |
| `GET` | `/api/v1/audit/compliance-report` | audit.routes |
| `GET` | `/api/v1/audit/user/:user_id/logs` | audit.routes |
| `GET` | `/api/v1/audit/event-types` | audit.routes |
| `GET` | `/api/v1/audit/statistics` | audit.routes |
| `POST` | `/api/v1/audit/export` | audit.routes |

### /api/v1/jobs (5 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/jobs/:job_id` | job-status.routes |
| `GET` | `/api/v1/jobs/` | job-status.routes |
| `GET` | `/api/v1/jobs/batch/:batch_id` | job-status.routes |
| `POST` | `/api/v1/jobs/:job_id/cancel` | job-cancel.routes |
| `POST` | `/api/v1/jobs/batch/:batch_id/cancel` | job-cancel.routes |

### /api/v1/search (3 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `POST` | `/api/v1/search/` | search.routes |
| `DELETE` | `/api/v1/search/collection/:matter_id` | search.routes |
| `GET` | `/api/v1/search/stats` | search.routes |

### /api/v1/webhook (6 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `POST` | `/api/v1/webhook/register` | webhook.routes |
| `GET` | `/api/v1/webhook/list` | webhook.routes |
| `GET` | `/api/v1/webhook/:webhook_id` | webhook.routes |
| `PUT` | `/api/v1/webhook/:webhook_id` | webhook.routes |
| `DELETE` | `/api/v1/webhook/:webhook_id` | webhook.routes |
| `POST` | `/api/v1/webhook/:webhook_id/test` | webhook.routes |

### /api/v1/context (1 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `POST` | `/api/v1/context/compile` | context.routes |

### /api/v1/rag (1 missing)

| Method | Full Path | File |
|--------|-----------|------|
| `GET` | `/api/v1/rag/librarian/collections/:matter/stats` | rag.routes |


---

## Endpoints in Postman but Missing in Code (186 endpoints)

These endpoints are documented in Postman but not found in the codebase.


### Health Monitor API (1 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `/api/v1/metrics` | Get Metrics |

### Monitoring & Metrics (4 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `/api/v1/metrics` | Prometheus - Metrics |
| `GET` | `/api/v1/query` | Prometheus - Query |
| `GET` | `/api/health` | Grafana - Health Check |
| `GET` | `/api/search` | Grafana - List Dashboards |

### Session Management API - COMPLETED (1 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `/api/v1/auth/session/` | Get Session Detail |

### Admin Bootstrap API - COMPLETED (4 endpoints)

| Method | Path | Name |
|--------|------|------|
| `POST` | `/api/v1/admin/create-admin` | Create Admin |
| `POST` | `/api/v1/admin/login` | Admin Login |
| `POST` | `/api/v1/admin/logout` | Admin Logout |
| `POST` | `/api/v1/admin/change-password` | Change Admin Password |

### Onboarding Upload API - COMPLETED (8 endpoints)

| Method | Path | Name |
|--------|------|------|
| `POST` | `/api/v1/onboarding/upload` | Upload Onboarding Configuration |
| `GET` | `/api/v1/onboarding/template` | Download Onboarding Template |
| `GET` | `/api/v1/onboarding/status` | Get Onboarding Status |
| `GET` | `/api/v1/onboarding/status/check` | Check Onboarding Status (Simplified) |
| `POST` | `/api/v1/onboarding/complete` | Complete Onboarding |
| `POST` | `/api/v1/onboarding/public/matters` | Create Matter During Onboarding (Public) |
| `GET` | `/api/v1/onboarding/public/matters` | List Matters During Onboarding (Public) |
| `GET` | `/api/v1/onboarding/public/list-admins` | List Admins During Onboarding (Public) |

### Admin User Management API - COMPLETED (11 endpoints)

| Method | Path | Name |
|--------|------|------|
| `PUT` | `/api/v1/admin/users/` | Update User |
| `POST` | `/api/v1/admin/users/deactivate` | Deactivate User |
| `POST` | `/api/v1/admin/users/activate` | Activate User |
| `POST` | `/api/v1/admin/users/regenerate-activation-key` | Regenerate Activation Key |
| `DELETE` | `/api/v1/admin/users/` | Delete User |
| `GET` | `/api/v1/admin/users/sessions` | Get User Sessions |
| `DELETE` | `/api/v1/admin/users/sessions` | Revoke User Sessions |
| `POST` | `/api/v1/admin/users/force-logout` | Force User Logout |
| `GET` | `/api/v1/admin/users/roles/list` | List Roles |
| `GET` | `/api/v1/admin/users/email/` | Get User by Email |
| `POST` | `/api/v1/admin/users/reset-password` | Reset User Password |

### RBAC API - COMPLETED (9 endpoints)

| Method | Path | Name |
|--------|------|------|
| `PUT` | `/api/v1/rbac/roles/` | Update Role |
| `DELETE` | `/api/v1/rbac/roles/` | Delete Role |
| `GET` | `/api/v1/rbac/hierarchy` | Get Organizational Hierarchy |
| `GET` | `/api/v1/rbac/users/permissions` | Get User Permissions |
| `GET` | `/api/v1/rbac/domains` | Get Domain Access Control |
| `GET` | `/api/v1/rbac/roles/hierarchy` | Get Role Hierarchy |
| `GET` | `/api/v1/rbac/roles/permissions/inherited` | Get Inherited Permissions |
| `POST` | `/api/v1/rbac/users/roles/` | Assign Role to User |
| `DELETE` | `/api/v1/admin/users/role` | Unassign Role for User |

### Permissions API - COMPLETED (4 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `/api/v1/permissions/by-scope/` | Get Permissions by Scope |
| `GET` | `/api/v1/permissions/by-vertical/` | Get Permissions by Vertical |
| `POST` | `/api/v1/permissions/suggestions` | Get Permission Suggestions |
| `GET` | `/api/v1/permissions/` | Get Permission Info |

### Sharing API - COMPLETED (4 endpoints)

| Method | Path | Name |
|--------|------|------|
| `DELETE` | `/api/v1/sharing/revoke` | Revoke Access |
| `GET` | `/api/v1/sharing/resource/` | Get Resource Shares |
| `GET` | `/api/v1/sharing/user/` | Get User Access |
| `PUT` | `/api/v1/sharing/sharing-type` | Update Sharing Type |

### Reporting API - COMPLETED (5 endpoints)

| Method | Path | Name |
|--------|------|------|
| `POST` | `/api/v1/reporting/user-activity` | Generate User Activity Report |
| `POST` | `/api/v1/reporting/matter-statistics` | Generate Matter Statistics Report |
| `POST` | `/api/v1/reporting/system-usage` | Generate System Usage Report |
| `POST` | `/api/v1/reporting/security-audit` | Generate Security Audit Report |
| `GET` | `/api/v1/reporting/health` | Reporting API Health Check |

### Organizations API - COMPLETED (8 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `/api/v1/organizations` | List Organizations |
| `GET` | `/api/v1/organizations/` | Get Organization |
| `POST` | `/api/v1/organizations` | Create Organization |
| `PUT` | `/api/v1/organizations/` | Update Organization |
| `DELETE` | `/api/v1/organizations/` | Delete Organization |
| `GET` | `/api/v1/organizations/statistics` | Get Organization Statistics |
| `GET` | `/api/v1/organizations/activity` | Get Organization Activity Timeline |
| `GET` | `/api/v1/organizations/health` | Organization Admin API Health Check |

### Groups API - COMPLETED (7 endpoints)

| Method | Path | Name |
|--------|------|------|
| `PUT` | `/api/v1/groups/` | Update Group |
| `DELETE` | `/api/v1/groups/` | Delete Group |
| `POST` | `/api/v1/groups/members` | Add Member to Group |
| `DELETE` | `/api/v1/groups/members/` | Remove Member from Group |
| `GET` | `/api/v1/groups/members` | List Group Members |
| `PUT` | `/api/v1/groups/members/role` | Update Member Role |
| `POST` | `/api/v1/groups/members/batch` | Batch Add Members |

### Matters API - COMPLETED (33 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `/api/v1/matters/users` | Get Users By Matter |
| `GET` | `/api/v1/matters/groups` | Get Groups By Matter |
| `PUT` | `/api/v1/matters/` | Update Matter |
| `DELETE` | `/api/v1/matters/` | Delete Matter |
| `POST` | `/api/v1/matters/share` | Share Matter with Users |
| `POST` | `/api/v1/matters/share/organization` | Share Matter with Organization |
| `POST` | `/api/v1/matters/share/department` | Share Matter with Department |
| `GET` | `/api/v1/matters/permissions` | Get Matter Permissions (JWT) |
| `GET` | `/api/v1/matters/permissions` | Get Matter Permissions |
| `DELETE` | `/api/v1/matters/share/` | Revoke Matter Access |
| `GET` | `/api/v1/matters/access` | Check Matter Access |
| `GET` | `/api/v1/matters/details` | Get Matter Details (Comprehensive) |
| `GET` | `/api/v1/matters/documents/statistics` | Get Matter Document Statistics |
| `GET` | `/api/v1/matters/embeddings/statistics` | Get Matter Embeddings Statistics |
| `GET` | `/api/v1/matters/activity` | Get Matter Activity |
| `GET` | `/api/v1/matters/details/recent-queries` | Get Matter Recent Queries |
| `GET` | `/api/v1/matters/details/processing-status` | Get Matter Processing Status |
| `GET` | `/api/v1/matters/details/timeline` | Get Matter Timeline |
| `GET` | `/api/v1/matters/chef-details` | Get Matter Chef Details **Full Return** |
| `GET` | `/api/v1/matters/health` | Matter Details Health Check |
| `GET` | `/api/v1/matters/me` | Get My Matters - Default |
| `GET` | `/api/v1/matters/me` | Get My Matters - With Pagination |
| `GET` | `/api/v1/matters/me` | Get My Matters - With Search |
| `GET` | `/api/v1/matters/me` | Get My Matters - With Sorting |
| `GET` | `/api/v1/matters/me` | Get My Matters - With Filtering |
| `GET` | `/api/v1/matters/me` | Get My Matters - Combined (Search + Filter + Sort) |
| `GET` | `/api/v1/matters/me` | Get My Matters - By Department |
| `GET` | `/api/v1/matters/me` | Get My Matters - Recently Created |
| `GET` | `/api/v1/matters/user/` | Get User Matters - Default |
| `GET` | `/api/v1/matters/user/` | Get User Matters - With Pagination |
| `GET` | `/api/v1/matters/user/` | Get User Matters - With Search & Sort |
| `GET` | `/api/v1/matters/user/` | Get User Matters - With Filtering |
| `GET` | `/api/v1/matters/user/` | Get User Matters - Complex Query |

### User Management API - Pre-Onboarding - COMPLETED (12 endpoints)

| Method | Path | Name |
|--------|------|------|
| `POST` | `/api/v1/users/create` | Create Single User |
| `POST` | `/api/v1/users/batch` | Batch Import Users |
| `POST` | `/api/v1/users/activate` | Activate User |
| `POST` | `/api/v1/users/validate-activation-code` | Validate Activation Code |
| `PATCH` | `/api/v1/users/status` | Change User Status |
| `POST` | `/api/v1/users/parse-csv` | Parse CSV |
| `GET` | `/api/v1/users/batch/` | Get Batch Results |
| `GET` | `/api/v1/users/batch/export/csv` | Export Batch Results (CSV) |
| `GET` | `/api/v1/users/batch/export/pdf` | Export Batch Results (PDF) |
| `PATCH` | `/api/v1/users/activation-code` | Update Activation Code |
| `POST` | `/api/v1/users/temporary-password` | Set Temporary Password |
| `GET` | `/api/v1/users/health` | Health Check |

### Comments API - COMPLETED (11 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `/api/v1/comments/object/matter/stats` | Get Comment Statistics |
| `PATCH` | `/api/v1/comments/` | Update Comment Content |
| `PATCH` | `/api/v1/comments/` | Update Comment Type |
| `PATCH` | `/api/v1/comments/` | Update Comment Metadata |
| `POST` | `/api/v1/comments/pin` | Pin Comment |
| `POST` | `/api/v1/comments/pin` | Unpin Comment |
| `GET` | `/api/v1/comments/search` | Full-Text Search (All Objects) |
| `GET` | `/api/v1/comments/search` | Search Comments on Matters Only |
| `GET` | `/api/v1/comments/search` | Search My Comments |
| `DELETE` | `/api/v1/comments/` | Soft Delete Comment |
| `DELETE` | `/api/v1/comments/` | Hard Delete Comment |

### System API - DEFER TO LATER (7 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `/api/v1/system/collections` | List Collections |
| `GET` | `/api/v1/system/collections/stats` | Get Collection Stats |
| `GET` | `/api/v1/system/files` | List Files |
| `GET` | `/api/v1/system/files/` | Get File Info |
| `GET` | `/api/v1/system/files/download` | Download File |
| `GET` | `/api/v1/system/files/permissions` | Get File Permissions |
| `GET` | `/api/v1/system/storage/stats` | Get Storage Stats |

### Session State Management API - WILL REMOVE  *Prefer Session API* (6 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `/api/v1/session/` | Get Session |
| `POST` | `/api/v1/session/token/` | Get Session by Token |
| `DELETE` | `/api/v1/session/service/` | Disconnect Service from Session |
| `DELETE` | `/api/v1/session/` | Invalidate Session |
| `GET` | `/api/v1/session/user/sessions` | Get User Sessions |
| `POST` | `/api/v1/session/convert-anonymous/` | Convert Anonymous Session |

### Plugin Management API (5 endpoints)

| Method | Path | Name |
|--------|------|------|
| `PATCH` | `/api/v1/plugins/start` | Start Plugin |
| `PATCH` | `/api/v1/plugins/stop` | Stop Plugin |
| `DELETE` | `/api/v1/plugins/` | Uninstall Plugin |
| `GET` | `/api/v1/plugins/health` | Check Plugin Health |
| `POST` | `/api/v1/plugins/quota/check` | Check Quota |

### Search API (1 endpoints)

| Method | Path | Name |
|--------|------|------|
| `DELETE` | `/api/v1/search/collection/` | Delete Collection |

### RAG & AI Generation API (5 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `/api/v1/rag/librarian/collections/stats` | Librarian Collection Stats |
| `POST` | `/api/v1/integration/generate` | Integration Generate |
| `POST` | `/api/v1/integration/rag/query` | Integration RAG Query |
| `POST` | `/api/v1/integration/search` | Integration Document Search |
| `GET` | `/api/v1/integration/health` | Integration Health Check |

### Document Layout Analysis API (9 endpoints)

| Method | Path | Name |
|--------|------|------|
| `POST` | `/api/v1/documents/analyze-layout` | Analyze Layout - Full Analysis |
| `POST` | `/api/v1/documents/analyze-layout` | Analyze Layout - Structure Only |
| `POST` | `/api/v1/documents/analyze-layout` | Analyze Layout - Tables Only |
| `POST` | `/api/v1/documents/analyze-layout` | Analyze Layout - Specific Pages |
| `POST` | `/api/v1/documents/analyze-layout` | Analyze Layout - Full Analysis |
| `POST` | `/api/v1/documents/analyze-layout` | Analyze Layout - Structure Only |
| `POST` | `/api/v1/documents/analyze-layout` | Analyze Layout - Tables Only |
| `POST` | `/api/v1/documents/analyze-layout` | Analyze Layout - Specific Pages |
| `GET` | `/api/v1/documents/vllm/status` | Get VLLM Status |

### Document Ingestion API (2 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `/api/v1/ingest/status/` | Get Ingestion Job Status |
| `GET` | `/api/v1/ingest/batch/` | Get Batch Ingestion Status |

### Document Processing API - TO BE DEPRECATED (8 endpoints)

| Method | Path | Name |
|--------|------|------|
| `POST` | `/api/v1/documents/upload` | Upload Document |
| `GET` | `/api/v1/documents/status` | Get Document Status |
| `GET` | `/api/v1/documents/list` | List Documents |
| `POST` | `/api/v1/documents/search` | Search Documents |
| `GET` | `/api/v1/documents/content` | Get Document Content |
| `POST` | `/api/v1/documents/batch-upload` | Batch Upload Documents |
| `GET` | `/api/v1/documents/batch/status` | Get Batch Status |
| `DELETE` | `/api/v1/documents/` | Delete Document |

### File Management API - TO BE DEPRECATED (5 endpoints)

| Method | Path | Name |
|--------|------|------|
| `POST` | `/api/v1/files/upload` | Upload File |
| `GET` | `/api/v1/files/info` | Get File Info |
| `PUT` | `/api/v1/files/` | Update File |
| `DELETE` | `/api/v1/files/` | Delete File |
| `POST` | `/api/v1/files/permissions` | Update File Permissions |

### Storage API > 2. Download File (3 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `/api/v1/storage/files/download` | Download File from Matter A |
| `GET` | `/api/v1/storage/files/download` | Cross-Matter Download (Should Fail) |
| `GET` | `/api/v1/storage/files/download` | Download Nonexistent File (Should Fail) |

### Storage API (17 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `/api/v1/storage/files/download` | Download File |
| `POST` | `/api/v1/storage/files/share` | 2. Create Shareable Link (24 hours, 10 downloads) |
| `POST` | `/api/v1/storage/files/share` | 3. Create Password-Protected Link (1 week, unlimited) |
| `POST` | `/api/v1/storage/files/share` | 11. Cross-Matter Access Test - Should Fail |
| `GET` | `/api/v1/storage/files/shares` | 4. List Shareable Links (Active Only) |
| `GET` | `/api/v1/storage/files/shares` | 5. List Shareable Links (Include Expired) |
| `DELETE` | `/api/v1/storage/files/shares/` | 9. Revoke Shareable Link |
| `GET` | `/api/v1/storage/shared/download` | 6. Public Download (No Auth, No Password) |
| `GET` | `/api/v1/storage/shared/download` | 7. Public Download (Password-Protected) |
| `GET` | `/api/v1/storage/shared/download` | 8. Public Download (Wrong Password) - Should Fail |
| `GET` | `/api/v1/storage/shared/download` | 10. Public Download After Revocation - Should Fail |
| `DELETE` | `/api/v1/storage/files/` | Delete File |
| `POST` | `/api/v1/storage/versions/` | 1. Create New Version |
| `GET` | `/api/v1/storage/versions/` | 2. List File Versions |
| `GET` | `/api/v1/storage/versions/` | 4. Download Specific Version |
| `POST` | `/api/v1/storage/versions/rollback/` | 3. Rollback to Previous Version |
| `DELETE` | `/api/v1/storage/versions/` | 5. Delete Specific Version |

### Storage API > 3. Get File Metadata (2 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `/api/v1/storage/:file_id` | Get Metadata for Matter A File |
| `GET` | `/api/v1/storage/:file_id` | Cross-Matter Metadata Access (Should Fail) |

### Storage API > 4. Delete File (2 endpoints)

| Method | Path | Name |
|--------|------|------|
| `DELETE` | `/api/v1/storage/:file_id` | Soft Delete File |
| `DELETE` | `/api/v1/storage/:file_id` | Cross-Matter Delete (Should Fail) |

### Storage API > 5. List Files (4 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `/api/v1/storage/list` | List Files in Matter A |
| `GET` | `/api/v1/storage/list` | List Files in Matter B (Should Be Different) |
| `GET` | `/api/v1/storage/list` | List Files with Pagination (First Page) |
| `GET` | `/api/v1/storage/list` | List Files with Pagination (Second Page) |

### Storage API > 7. Shareable Links (4 endpoints)

| Method | Path | Name |
|--------|------|------|
| `POST` | `/api/v1/storage/files/share` | Create Shareable Link |
| `GET` | `/api/v1/storage/files/shares` | List Shareable Links |
| `DELETE` | `/api/v1/storage/files/shares/` | Revoke Shareable Link |
| `GET` | `/api/v1/storage/shared/download` | Public Download via Shareable Link |

### Cache API (2 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `/api/v1/cache/get/` | Get Cached Value |
| `DELETE` | `/api/v1/cache/delete/` | Delete Cached Value |

### Streaming API (2 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `ws:/:/api/v1/streaming/ws/chat` | WebSocket Chat |
| `GET` | `ws:/:/api/v1/streaming/ws/rag` | WebSocket RAG |

### Load Balancer & Workers API (12 endpoints)

| Method | Path | Name |
|--------|------|------|
| `POST` | `/api/v1/workers/generate` | Generate Text |
| `POST` | `/api/v1/workers/chat` | Chat |
| `POST` | `/api/v1/workers/legal/chat` | Legal Chat |
| `POST` | `/api/v1/workers/legal/document` | Legal Document Generation |
| `POST` | `/api/v1/workers/legal/analyze` | Legal Analysis |
| `POST` | `/api/v1/workers/scale` | Scale Workers |
| `GET` | `/api/v1/workers/health` | Worker Health Check |
| `GET` | `/api/v1/workers/metrics` | Get Worker Metrics |
| `GET` | `/api/v1/workers/metrics/prometheus` | Get Prometheus Metrics |
| `GET` | `/api/v1/workers/models` | Get Available Models |
| `GET` | `/api/v1/workers/strategy` | Get Load Balancing Strategy |
| `POST` | `/api/v1/workers/strategy` | Set Load Balancing Strategy |

### Core Services API (8 endpoints)

| Method | Path | Name |
|--------|------|------|
| `GET` | `/api/tags` | Ollama - List Models |
| `POST` | `/api/generate` | Ollama - Generate Text |
| `GET` | `/api/v1/collections` | Qdrant - List Collections |
| `PUT` | `/api/v1/collections/` | Qdrant - Create Collection |
| `POST` | `/api/v1/collections/points/search` | Qdrant - Search Vectors |
| `GET` | `/api/v1/minio/health/live` | MinIO - Health Check |
| `GET` | `/healthz` | Unstructured - Health Check |
| `POST` | `/api/v1/general/v0/general` | Unstructured - Process Document |

### Custom Reports API (8 endpoints)

| Method | Path | Name |
|--------|------|------|
| `POST` | `/api/v1/custom-reports/templates` | Create Custom Report Template |
| `GET` | `/api/v1/custom-reports/templates` | List Custom Report Templates |
| `GET` | `/api/v1/custom-reports/templates/` | Get Custom Report Template |
| `PUT` | `/api/v1/custom-reports/templates/` | Update Custom Report Template |
| `DELETE` | `/api/v1/custom-reports/templates/` | Delete Custom Report Template |
| `POST` | `/api/v1/custom-reports/templates/execute` | Execute Custom Report Template |
| `GET` | `/api/v1/custom-reports/templates/audit` | Get Template Audit History |
| `GET` | `/api/v1/custom-reports/health` | Custom Reports API Health Check |


---

## Recommendations

Based on this analysis, here are the key recommendations:

### 1. High Priority - Documentation Gaps

The following areas have extremely low or zero documentation coverage and should be prioritized:

- **/api/v1/memory**: Only 0/5 endpoints documented (0.0%)
- **/api/v1/conversation**: Only 0/4 endpoints documented (0.0%)
- **/api/v1/admin/vpn**: Only 0/5 endpoints documented (0.0%)
- **/api/v1/vpn**: Only 0/6 endpoints documented (0.0%)
- **/api/v1/document-automation**: Only 0/11 endpoints documented (0.0%)
- **/api/v1/notifications**: Only 0/12 endpoints documented (0.0%)
- **/api/v1/activity**: Only 0/8 endpoints documented (0.0%)
- **/api/v1/chat**: Only 0/7 endpoints documented (0.0%)
- **/api/v1/admin/health**: Only 0/3 endpoints documented (0.0%)
- **/api/v1/smart-query**: Only 0/5 endpoints documented (0.0%)
- **/api/v1/annotations**: Only 0/10 endpoints documented (0.0%)
- **/api/v1/actionstep**: Only 0/18 endpoints documented (0.0%)
- **/api/v1/integration**: Only 0/3 endpoints documented (0.0%)
- **/api/v1/insights**: Only 0/12 endpoints documented (0.0%)
- **/api/v1/organizations**: Only 0/10 endpoints documented (0.0%)
- **/api/v1/document-templates**: Only 0/8 endpoints documented (0.0%)
- **/api/v1/admin/sessions**: Only 0/2 endpoints documented (0.0%)
- **/api/v1/documents**: Only 0/5 endpoints documented (0.0%)
- **/api/v1/integrations**: Only 0/10 endpoints documented (0.0%)
- **/api/client**: Only 0/4 endpoints documented (0.0%)
- **/api/v1/batch-process**: Only 0/4 endpoints documented (0.0%)
- **/api/v1/system**: Only 0/9 endpoints documented (0.0%)
- **/api/v1/leadly**: Only 0/20 endpoints documented (0.0%)
- **/api/v1/workflows**: Only 0/7 endpoints documented (0.0%)
- **/api/v1/dlq**: Only 0/4 endpoints documented (0.0%)
- **/api/v1/audit**: Only 0/12 endpoints documented (0.0%)
- **/api/v1/jobs**: Only 0/5 endpoints documented (0.0%)
- **/api/v1/webhook**: Only 0/6 endpoints documented (0.0%)
- **/api/v1/context**: Only 0/1 endpoints documented (0.0%)
- **/api/v1/files**: Only 1/21 endpoints documented (4.8%)
- **/api/v1/matters**: Only 2/23 endpoints documented (8.7%)
- **/api/v1/workers**: Only 1/11 endpoints documented (9.1%)
- **/api/v1/rbac**: Only 2/15 endpoints documented (13.3%)
- **/api/v1/sharing**: Only 2/13 endpoints documented (15.4%)


### 2. Postman Collection Cleanup

There are **186 endpoints** in the Postman collection that don't exist in the codebase. These should be:
- Reviewed to determine if they are deprecated
- Removed from the collection if no longer relevant
- Implemented if they represent planned functionality

### 3. Documentation Best Practices

To improve API documentation coverage:

1. **Establish a Documentation-First Workflow**: Require Postman collection updates before merging new endpoints
2. **Automate Coverage Checks**: Add CI/CD checks to alert when new endpoints are added without documentation
3. **Prioritize High-Traffic Endpoints**: Focus documentation efforts on authentication, matters, storage, and chat endpoints
4. **Add Request/Response Examples**: Enhance existing Postman requests with example payloads and responses
5. **Create API Categories**: Organize endpoints by business function (Auth, Document Management, Matter Management, etc.)

### 4. API Versioning Strategy

Consider implementing proper API versioning:
- All endpoints currently use `/api/v1`
- Plan for backward compatibility when introducing breaking changes
- Document deprecation timelines for old endpoints

### 5. Health & Monitoring Endpoints

The `/health` endpoints have good coverage (20.0%). Consider:
- Adding more health check endpoints for individual services
- Documenting monitoring and observability patterns
- Creating dedicated Postman environments for health checks

---

## Next Steps

1. **Week 1-2**: Document high-priority endpoints (auth, matters, storage, chat)
2. **Week 3-4**: Clean up deprecated Postman endpoints
3. **Week 5-6**: Document remaining processor service endpoints
4. **Week 7-8**: Add examples and test cases to existing documentation
5. **Ongoing**: Implement automated coverage tracking

---

## Appendix: Matched Endpoints

The following 92 endpoints are properly documented in both codebase and Postman:

| Method | Path | Postman Folder |
|--------|------|----------------|
| `GET` | `/api/v1/status` | Health Monitor API |
| `GET` | `/health` | Health Monitor API |
| `GET` | `/api/v1/files/list` | File Management API - TO BE DEPRECATED |
| `POST` | `/api/v1/auth/session/refresh` | Session Management API - COMPLETED |
| `GET` | `/api/v1/auth/session/list` | Session Management API - COMPLETED |
| `DELETE` | `/api/v1/auth/session/` | Session Management API - COMPLETED |
| `GET` | `/api/v1/workers/status` | Load Balancer & Workers API |
| `GET` | `/api/v1/users/me/profile` | User Profile API - COMPLETE | Just remember MFA and Change Password in the experience |
| `GET` | `/api/v1/users/me/preferences` | User Profile API - COMPLETE | Just remember MFA and Change Password in the experience |
| `PATCH` | `/api/v1/users/me/preferences` | User Profile API - COMPLETE | Just remember MFA and Change Password in the experience |
| `PUT` | `/api/v1/users/me/preferences/reset` | User Profile API - COMPLETE | Just remember MFA and Change Password in the experience |
| `GET` | `/api/v1/users/me/security` | User Profile API - COMPLETE | Just remember MFA and Change Password in the experience |
| `POST` | `/api/v1/users/me/security/mfa/setup` | User Profile API - COMPLETE | Just remember MFA and Change Password in the experience |
| `POST` | `/api/v1/users/me/security/mfa/verify` | User Profile API - COMPLETE | Just remember MFA and Change Password in the experience |
| `DELETE` | `/api/v1/users/me/security/mfa` | User Profile API - COMPLETE | Just remember MFA and Change Password in the experience |
| `POST` | `/api/v1/users/me/security/mfa/backup-codes/regenerate` | User Profile API - COMPLETE | Just remember MFA and Change Password in the experience |
| `PATCH` | `/api/v1/users/me/security/password` | User Profile API - COMPLETE | Just remember MFA and Change Password in the experience |
| `PATCH` | `/api/v1/users/me/security/session-timeout` | User Profile API - COMPLETE | Just remember MFA and Change Password in the experience |
| `PATCH` | `/api/v1/users/me/security/ip-restrictions` | User Profile API - COMPLETE | Just remember MFA and Change Password in the experience |
| `GET` | `/api/v1/database/health` | Database Proxy API |
| `POST` | `/api/v1/database/query` | Database Proxy API |
| `POST` | `/api/v1/database/execute` | Database Proxy API |
| `GET` | `/api/v1/permissions/all` | Permissions API - COMPLETED |
| `POST` | `/api/v1/permissions/validate` | Permissions API - COMPLETED |
| `POST` | `/api/v1/auth/login` | Authentication API - COMPLETED |
| `POST` | `/api/v1/auth/logout` | Authentication API - COMPLETED |
| `POST` | `/api/v1/auth/refresh` | Authentication API - COMPLETED |
| `GET` | `/api/v1/auth/me` | Authentication API - COMPLETED |
| `POST` | `/api/v1/auth/request-password-reset` | Authentication API - COMPLETED |
| `POST` | `/api/v1/auth/reset-password` | Authentication API - COMPLETED |
| `POST` | `/api/v1/rbac/roles` | RBAC API - COMPLETED |
| `GET` | `/api/v1/rbac/roles` | RBAC API - COMPLETED |
| `POST` | `/api/v1/storage/upload` | Storage API > Unused |
| `POST` | `/api/v1/groups/` | Groups API - COMPLETED |
| `GET` | `/api/v1/groups/` | Groups API - COMPLETED |
| `POST` | `/api/v1/comments/` | Comments API - COMPLETED |
| `GET` | `/api/v1/comments/` | Comments API - COMPLETED |
| `GET` | `/api/v1/admin/users/` | Admin User Management API - COMPLETED |
| `GET` | `/api/v1/admin/users/check-email` | Admin User Management API - COMPLETED |
| `GET` | `/api/v1/admin/users/check-username` | Admin User Management API - COMPLETED |
| `GET` | `/api/v1/admin/users/count-superusers` | Admin User Management API - COMPLETED |
| `POST` | `/api/v1/admin/users/` | Admin User Management API - COMPLETED |
| `GET` | `/api/v1/auth/service/token/info` | Service Token API - CAN'T TESTED |
| `POST` | `/api/v1/auth/service/refresh` | Service Token API - CAN'T TESTED |
| `POST` | `/api/v1/sharing/grant` | Sharing API - COMPLETED |
| `POST` | `/api/v1/sharing/check` | Sharing API - COMPLETED |
| `POST` | `/api/v1/plugins/install` | Plugin Management API |
| `GET` | `/api/v1/plugins/` | Plugin Management API |
| `POST` | `/api/v1/streaming/chat/stream` | Streaming API |
| `POST` | `/api/v1/streaming/rag/stream` | Streaming API |
| `GET` | `/api/v1/streaming/connections` | Streaming API |
| `GET` | `/api/v1/streaming/connections/status` | Streaming API |
| `POST` | `/api/v1/streaming/broadcast` | Streaming API |
| `POST` | `/api/v1/streaming/cleanup` | Streaming API |
| `GET` | `/api/v1/streaming/health` | Streaming API |
| `POST` | `/api/v1/session/create` | Session State Management API - WILL REMOVE  *Prefer Session API* |
| `POST` | `/api/v1/session/create-anonymous` | Session State Management API - WILL REMOVE  *Prefer Session API* |
| `PUT` | `/api/v1/session/state` | Session State Management API - WILL REMOVE  *Prefer Session API* |
| `POST` | `/api/v1/session/service/connect` | Session State Management API - WILL REMOVE  *Prefer Session API* |
| `GET` | `/api/v1/session/health` | Session State Management API - WILL REMOVE  *Prefer Session API* |
| `POST` | `/api/v1/cache/set` | Cache API |
| `POST` | `/api/v1/cache/mget` | Cache API |
| `POST` | `/api/v1/cache/mset` | Cache API |
| `POST` | `/api/v1/cache/increment` | Cache API |
| `POST` | `/api/v1/cache/expire` | Cache API |
| `GET` | `/api/v1/cache/health` | Cache API |
| `POST` | `/api/v1/matters/` | Matters API - COMPLETED |
| `GET` | `/api/v1/matters/` | Matters API - COMPLETED |
| `POST` | `/api/v1/ingest/external` | Document Ingestion API |
| `POST` | `/api/v1/ingest/external/batch` | Document Ingestion API |
| `POST` | `/api/v1/ingest/local` | Document Ingestion API |
| `POST` | `/api/v1/ingest/local/bulk` | Document Ingestion API |
| `POST` | `/api/v1/storage/files/upload` | Storage API > Unused |
| `GET` | `/api/v1/storage/files` | Storage API |
| `GET` | `/api/v1/storage/health` | Storage API > 6. Health Check |
| `GET` | `/api/v1/storage/stats` | Storage API |
| `GET` | `/api/v1/storage/usage` | Storage Usage API |
| `GET` | `/api/v1/storage/usage/matters` | Storage Usage API |
| `POST` | `/api/v1/search/query` | Search API |
| `POST` | `/api/v1/search/hybrid` | Search API |
| `POST` | `/api/v1/search/autocomplete` | Search API |
| `GET` | `/api/v1/search/collections` | Search API |
| `POST` | `/api/v1/search/create-collection` | Search API |
| `GET` | `/api/v1/search/health` | Search API |
| `POST` | `/api/v1/rag/query` | RAG & AI Generation API |
| `POST` | `/api/v1/rag/retrieve` | RAG & AI Generation API |
| `POST` | `/api/v1/rag/stream` | RAG & AI Generation API |
| `GET` | `/api/v1/rag/health` | RAG & AI Generation API |
| `GET` | `/api/v1/rag/stats` | RAG & AI Generation API |
| `POST` | `/api/v1/rag/concierge/query` | RAG & AI Generation API |
| `POST` | `/api/v1/rag/concierge/stream` | RAG & AI Generation API |
| `POST` | `/api/v1/rag/librarian/retrieve` | RAG & AI Generation API |


---

*Report generated automatically from codebase analysis and Postman collection comparison.*

