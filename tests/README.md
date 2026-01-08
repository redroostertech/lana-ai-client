# LANA-AI API Testing

This directory contains automated API tests for the LANA-AI platform.

## Quick Start

```bash
# Run all API tests
cd /path/to/LANA-AI
./tests/run-api-tests.sh

# Run specific test folder (faster iteration)
./tests/run-api-tests.sh auth           # Authentication & Sessions only
./tests/run-api-tests.sh matters        # Matter Management only

# List available test folders
./tests/run-api-tests.sh --list
```

## Setup

### 1. Install Dependencies

The test script will automatically install required dependencies:
- `newman` - Command-line collection runner for Postman
- `newman-reporter-htmlextra` - Enhanced HTML reporting
- `jq` - JSON processing (for authentication)

Or install manually:
```bash
npm install -g newman newman-reporter-htmlextra
brew install jq
```

### 2. Configure Test Credentials

Create a `.env.test` file in the `tests/` directory:

```bash
# tests/.env.test
TEST_USER_EMAIL=your-email@example.com
TEST_USER_PASSWORD=YourPassword123

# Optional: Override default API endpoint
API_URL=https://localhost
API_PORT=8080
```

**Important:** The `.env.test` file is gitignored and should NEVER be committed to version control.

### 3. Ensure Server is Running

Make sure the LANA-AI server is running before testing:

```bash
pm2 status
# Should show lana-ai-api as "online"
```

If not running:
```bash
./run.sh
```

## Running Tests

### Test Against Different Endpoints

**Localhost (default):**
```bash
./tests/run-api-tests.sh
```

**Local Network:**
```bash
API_URL=https://10.0.0.3 ./tests/run-api-tests.sh
```

**Tailscale VPN:**
```bash
API_URL=tailscale ./tests/run-api-tests.sh
```

**Custom Endpoint:**
```bash
API_URL=https://your-server.com API_PORT=8080 ./tests/run-api-tests.sh
```

### Auto-Opening Test Report

By default, the test report will automatically open in your browser when tests complete.

**To disable auto-open:**
```bash
NO_OPEN=1 ./tests/run-api-tests.sh
```

**To manually open the report later:**
```bash
# macOS
open tests/newman-report.html

# Linux
xdg-open tests/newman-report.html
```

## Test Coverage

The test suite runs the complete Postman collection which includes:

### Authentication & Users
- User login/logout
- Token generation and validation
- User registration
- Password reset
- Profile management

### Matters Management
- Create, read, update, delete matters
- Matter search and filtering
- Matter assignments
- Matter status management

### Document Management
- Document upload (single & batch)
- Document download
- Document metadata
- File versioning
- Document search
- Folder operations

### Storage & Files
- File upload/download
- Storage statistics
- File sharing
- Batch operations
- Storage tier management

### Research & RAG
- Knowledge base queries
- Document ingestion
- Semantic search
- Citation retrieval

### Organizations
- Organization settings
- User management
- Permissions
- API keys

### System
- Health checks
- Service status
- Configuration

## Test Results

### Console Output

The test script provides real-time console output showing:
- ✓ Passed tests (green)
- ✗ Failed tests (red)
- Test execution time
- Request/response details

### HTML Report

After tests complete, an HTML report is automatically generated and opened in your browser:
```
tests/newman-report.html
```

The report opens automatically after tests finish. If it doesn't open or you want to view it again later:
```bash
# macOS
open tests/newman-report.html

# Linux
xdg-open tests/newman-report.html
```

The HTML report includes:
- Summary statistics
- Failed test details
- Request/response data
- Execution timeline
- Environment variables

## Authentication Flow

The test script automatically handles authentication:

1. **Checks for credentials** in `tests/.env.test`
2. **Attempts login** at `/api/v1/auth/login`
3. **Extracts auth token** from response
4. **Passes token** to Newman via `--env-var token=...`
5. **Postman collection** uses `{{token}}` in Authorization headers

### Without Credentials

If no credentials are configured:
- Tests will still run
- Public endpoints will pass
- Protected endpoints will fail with 401 Unauthorized

## Troubleshooting

### Server Not Reachable

```
✗ Could not reach server at https://localhost:8080
```

**Solutions:**
- Check server is running: `pm2 status`
- Start server: `./run.sh`
- Check port: `lsof -i :8080`
- Verify VPN connection (if using Tailscale)

### Authentication Failed

```
⚠ Authentication failed
Response: {"error": "Invalid credentials"}
```

**Solutions:**
- Verify credentials in `tests/.env.test`
- Test login manually:
  ```bash
  curl -k -X POST https://localhost:8080/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"your-email","password":"your-password"}'
  ```
- Check user exists in database
- Reset password if needed

### SSL Certificate Errors

The script uses `--insecure` / `-k` flags to accept self-signed certificates. This is normal for development/testing.

For production testing, remove these flags and ensure proper SSL certificates are installed.

### Tests Timing Out

```
Error: Request timeout
```

**Solutions:**
- Increase timeout: Edit `run-api-tests.sh` and change `--timeout-request 10000` to higher value
- Check server performance: `pm2 monit`
- Check network latency
- Review slow endpoints in logs

## Test Development

### Adding New Tests

1. Edit the Postman collection: `postman/LANA-AI-API.postman_collection.json`
2. Or use Postman GUI:
   - Import the collection
   - Add/modify requests
   - Export back to JSON
   - Replace the file

### Using Environment Variables

The test script provides these variables to Newman:
- `{{url}}` - API base URL (e.g., https://localhost)
- `{{port}}` - API port (e.g., 8080)
- `{{token}}` - Auth token (from login)

Use in Postman requests:
```
GET {{url}}:{{port}}/api/v1/matters
Authorization: Bearer {{token}}
```

### Pre-request Scripts

Postman collections can include JavaScript to run before requests:
```javascript
// Set dynamic variable
pm.environment.set("timestamp", Date.now());

// Generate random data
pm.environment.set("randomId", pm.variables.replaceIn('{{$randomUUID}}'));
```

### Test Scripts

Add assertions to verify responses:
```javascript
// Check status code
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

// Check response body
pm.test("Response has data", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('data');
});

// Save token for next requests
pm.test("Save auth token", function () {
    var jsonData = pm.response.json();
    pm.environment.set("token", jsonData.token);
});
```

## Continuous Integration

### GitHub Actions Example

```yaml
name: API Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Start LANA-AI Server
        run: |
          npm install
          ./run.sh &
          sleep 10

      - name: Run API Tests
        env:
          TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
        run: ./tests/run-api-tests.sh

      - name: Upload Test Report
        if: always()
        uses: actions/upload-artifact@v2
        with:
          name: newman-report
          path: tests/newman-report.html
```

## Files

```
tests/
├── README.md                 # This file
├── run-api-tests.sh         # Main test runner script
├── .env.test                # Test credentials (gitignored)
└── newman-report.html       # Test results (gitignored)
```

## Support

For issues or questions:
1. Check server logs: `pm2 logs lana-ai-api`
2. Review test output in console
3. Check HTML report for detailed request/response data
4. Verify API endpoints in Postman collection

## Security Notes

- **Never commit** `.env.test` - it contains credentials
- **Use test accounts** - don't use production credentials
- **Self-signed certs** - `--insecure` flag is for development only
- **Token exposure** - test reports may contain auth tokens (gitignored)
