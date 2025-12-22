#!/bin/bash
# =============================================================================
# Test OTA Update Flow
# =============================================================================
# Quick script to verify all OTA update components are working
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

PORT=${PORT:-8080}
HOST=${HOST:-localhost}
BASE_URL="http://${HOST}:${PORT}"

echo ""
echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}                    Testing OTA Update Flow                                ${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

# Check if jq is available
if ! command -v jq &> /dev/null; then
    echo -e "${YELLOW}Note: Install 'jq' for prettier output: brew install jq${NC}"
    JQ="cat"
else
    JQ="jq ."
fi

# 1. Test server health
echo -e "${GREEN}[1/6]${NC} Testing server health..."
HEALTH=$(curl -s ${BASE_URL}/api/health 2>/dev/null)
if echo "$HEALTH" | grep -q "healthy"; then
    echo -e "      ${GREEN}✓${NC} Server is healthy"
else
    echo -e "      ${RED}✗${NC} Server not responding at ${BASE_URL}"
    echo "      Make sure the server is running: npm run dev"
    exit 1
fi

# 2. Test discovery endpoint
echo -e "${GREEN}[2/6]${NC} Testing discovery endpoint..."
DISCOVERY=$(curl -s ${BASE_URL}/api/health/discovery 2>/dev/null)
if echo "$DISCOVERY" | grep -q "org_id"; then
    ORG_ID=$(echo "$DISCOVERY" | grep -o '"org_id":"[^"]*"' | cut -d'"' -f4)
    ORG_NAME=$(echo "$DISCOVERY" | grep -o '"org_name":"[^"]*"' | cut -d'"' -f4)
    echo -e "      ${GREEN}✓${NC} Discovery endpoint working"
    echo -e "      Organization: ${CYAN}${ORG_NAME}${NC} (${ORG_ID})"
else
    echo -e "      ${YELLOW}!${NC} Discovery endpoint returned unexpected response"
    echo "      Response: $DISCOVERY"
    echo ""
    echo "      Run setup script first:"
    echo "      ./scripts/setup/setup-thin-client.sh --org-id 'test-org' --org-name 'Test Org'"
fi

# 3. Test update policy endpoint
echo -e "${GREEN}[3/6]${NC} Testing update policy endpoint (as client v1.0.0)..."
POLICY=$(curl -s -H "x-client-version: 1.0.0" ${BASE_URL}/api/client/update-policy 2>/dev/null)
if echo "$POLICY" | grep -q "allowed_client_version"; then
    ALLOWED=$(echo "$POLICY" | grep -o '"allowed_client_version":"[^"]*"' | cut -d'"' -f4)
    AVAILABLE=$(echo "$POLICY" | grep -o '"update_available":[^,}]*' | cut -d':' -f2)
    echo -e "      ${GREEN}✓${NC} Update policy endpoint working"
    echo -e "      Allowed version: ${CYAN}${ALLOWED}${NC}"
    echo -e "      Update available: ${CYAN}${AVAILABLE}${NC}"
else
    echo -e "      ${YELLOW}!${NC} Update policy endpoint returned unexpected response"
    echo "      Response: $POLICY"
fi

# 4. Test setting a new update policy
echo -e "${GREEN}[4/6]${NC} Testing update policy admin endpoint..."
UPDATE_RESULT=$(curl -s -X PUT ${BASE_URL}/api/client/update-policy/admin \
    -H "Content-Type: application/json" \
    -d '{"allowed_version": "1.1.0", "force_update": false, "release_notes": "Test update"}' 2>/dev/null)
if echo "$UPDATE_RESULT" | grep -q "success\|policy"; then
    echo -e "      ${GREEN}✓${NC} Admin endpoint working (set allowed_version to 1.1.0)"
else
    echo -e "      ${YELLOW}!${NC} Admin endpoint response: $UPDATE_RESULT"
fi

# 5. Verify update is now available
echo -e "${GREEN}[5/6]${NC} Verifying update is now available..."
POLICY2=$(curl -s -H "x-client-version: 1.0.0" ${BASE_URL}/api/client/update-policy 2>/dev/null)
if echo "$POLICY2" | grep -q '"update_available":true'; then
    echo -e "      ${GREEN}✓${NC} Update correctly shows as available for v1.0.0 clients"
else
    echo -e "      ${YELLOW}!${NC} Update not showing as available"
fi

# 6. Check Bonjour service
echo -e "${GREEN}[6/6]${NC} Checking Bonjour service..."
echo -e "      ${YELLOW}!${NC} Manual check required. Run in another terminal:"
echo -e "      ${CYAN}dns-sd -B _lana._tcp${NC}"
echo ""

# Summary
echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}                           Summary                                         ${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

# Get current app version
APP_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")

echo -e "${GREEN}Server Status:${NC}"
echo -e "  Base URL:        ${CYAN}${BASE_URL}${NC}"
echo -e "  App Version:     ${CYAN}${APP_VERSION}${NC}"
echo ""

echo -e "${GREEN}Endpoints Tested:${NC}"
echo -e "  ✓ GET  /api/health"
echo -e "  ✓ GET  /api/health/discovery"
echo -e "  ✓ GET  /api/client/update-policy"
echo -e "  ✓ PUT  /api/client/update-policy/admin"
echo ""

echo -e "${GREEN}OTA Update Flow:${NC}"
echo -e "  1. Client v1.0.0 launches"
echo -e "  2. Client calls /api/client/update-policy"
echo -e "  3. Server returns: allowed_version=1.1.0, update_available=true"
echo -e "  4. Client shows update dialog"
echo -e "  5. User clicks 'Update Now'"
echo -e "  6. Client downloads from GitHub releases"
echo -e "  7. Client installs and restarts"
echo ""

echo -e "${YELLOW}Next Steps:${NC}"
echo ""
echo -e "  1. ${BLUE}Build the client:${NC}"
echo -e "     ${CYAN}npm run build:mac${NC}"
echo ""
echo -e "  2. ${BLUE}Install v1.0.0:${NC}"
echo -e "     ${CYAN}open dist/LanaAI--genesis--01-arm64.dmg${NC}"
echo ""
echo -e "  3. ${BLUE}Bump to v1.1.0 and rebuild:${NC}"
echo -e "     ${CYAN}npm version minor && npm run build:mac${NC}"
echo ""
echo -e "  4. ${BLUE}Create GitHub release for v1.1.0:${NC}"
echo -e "     ${CYAN}gh release create v1.1.0 dist/*.dmg --title 'v1.1.0'${NC}"
echo ""
echo -e "  5. ${BLUE}Launch installed v1.0.0 client:${NC}"
echo -e "     ${CYAN}open /Applications/Lana\\ AI\\ Client.app${NC}"
echo ""
echo -e "  6. ${BLUE}Watch for update dialog!${NC}"
echo ""
