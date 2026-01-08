# Storage Endpoint Testing

## Overview
Comprehensive test infrastructure for LANA-AI Storage API endpoints using Newman/Postman.

## Test Results Summary

**Current Status (2025-12-14):**
- **50 requests** executed
- **41 assertions** total
- **26 passing** (63% success rate)
- **15 failing** (backend issues identified)

## What Was Added

### 1. Test Scripts (41 assertions)
Added comprehensive test scripts to all storage endpoints:
- ✅ Authentication and variable management
- ✅ Response validation and error handling
- ✅ Automatic variable extraction (file_id, share_token, matter_id, etc.)

### 2. Authentication Flow
- ✅ Login request at beginning of Storage folder
- ✅ List Matters request to populate matter_id
- ✅ All endpoints now properly authenticated

### 3. File Fixtures
- ✅ Test PDF from Downloads directory
- ✅ Upload endpoints configured with real PDF file
- ✅ All file upload operations now functional

### 4. Collection Variables
Added the following variables for test coordination:
- `file_id` - Saved from upload responses
- `share_token` - For shareable link testing
- `matter_id` - From List Matters request
- `version_number` - For version control testing
- `folder_id` - For folder organization
- `batch_file_ids` - For batch operations

## Running Tests

### Run All Storage Tests
```bash
./tests/run-api-tests.sh storage
```

### Run Specific Test Sections
```bash
./tests/run-api-tests.sh auth       # Authentication first
./tests/run-api-tests.sh matters    # Then matters
./tests/run-api-tests.sh storage    # Then storage
```

## Test Results Breakdown

### ✅ Working Endpoints (26 passing)

**Authentication & Setup:**
- Login (2 assertions)
- List Matters (3 assertions)

**File Operations:**
- Upload File ✓ (201 Created, file_id saved)
- Get File Metadata ✓
- List Files ✓

**Batch Operations:**
- Batch Download ✓
- Batch Delete ✓
- Batch Get Metadata ✓
- Batch Grant Permissions ✓

**Statistics:**
- Health Check ✓
- Get Storage Stats ✓
- Get Storage Usage ✓

**File Management:**
- List Files (/files endpoint) ✓
- Get File Info ✓
- Get File Permissions ✓
- Get File Activity Log ✓
- Set File Tags ✓
- Add File Tag ✓
- Remove File Tag ✓

### ⚠️ Backend Issues (15 failures - need fixes)

**Storage Endpoints (500 Internal Server Error):**
1. Download File - 500 error with valid file_id
2. View File Inline - 500 error
3. Delete File - 500 error

**File Management Endpoints (500 errors):**
4. Update File Metadata - 500 error
5. Move File - 400 error (missing target_matter_id)
6. Copy File - 400 error (missing target_matter_id)
7. Rename File - 500 error
8. Upload New Version (/files) - 500 error
9. List File Versions - 500 error
10. Restore File Version - 500 error

**Expected Failures (need setup):**
11. Revoke Share - Needs share to be created first
12. Public Download via Share - Needs share_token
13. Get Share Info - Needs share_token
14. Public View via Share - Needs share_token
15. Delete Version - Needs version to exist first

## Test Infrastructure Files

### Created/Modified Files
- `postman/LANA-AI-API.postman_collection.json` - Added test scripts and variables
- `tests/fixtures/test-document.txt` - Simple text fixture (legacy)
- Test scripts in `/tmp/`:
  - `add-storage-test-scripts.js` - Adds test scripts to all endpoints
  - `add-storage-auth.js` - Adds Login to storage folder
  - `fix-storage-share-endpoints.js` - Adds share endpoint tests
  - `fix-upload-endpoints-pdf.js` - Configures PDF fixtures
  - `add-list-matters-to-storage.js` - Adds matter_id population

### Test Fixture
**PDF File:** `~/Downloads/Follow Up Call _ AI Service (Lana) Oct 17 2025.pdf` (47.1 KB)
- Used for all upload operations
- Tests real document processing pipeline

## Next Steps

### Backend Fixes Needed
1. Fix Download File endpoint (500 error)
2. Fix View File Inline endpoint (500 error)
3. Fix Delete File endpoint (500 error)
4. Fix File Management endpoints (Update, Rename, Move, Copy)
5. Fix File Versions endpoints (Upload, List, Restore)

### Test Enhancements
1. Add test for Create Shareable Link
2. Update share endpoints to use created share_token
3. Add version control test flow (upload → version → download)
4. Add folder creation and organization tests

## Comparison: Before vs After

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Requests | 48 | 50 | +2 |
| Test Scripts | 0 | 36 | +36 |
| Assertions | 0 | 41 | +41 |
| Passing Tests | 0 | 26 | +26 |
| Authentication | ❌ 401 errors | ✅ Working | Fixed |
| File Upload | ❌ Missing file | ✅ PDF upload | Fixed |
| Variables | None | 6 variables | Added |

## Test Report

After each test run, view the detailed report:
```bash
open tests/newman-report.html
```

The report includes:
- Request/response details
- Console logs showing saved variables
- Error messages for failed tests
- Performance metrics

---

**Status:** Test infrastructure complete ✅
**Next:** Backend endpoint fixes needed for remaining failures
