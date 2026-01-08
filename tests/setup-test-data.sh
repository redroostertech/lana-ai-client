#!/bin/bash

# Test Data Setup Script
# Creates necessary test data for API testing

set -e  # Exit on error

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}        LANA-AI Test Data Setup${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

# Load environment variables from .env.test if it exists
if [ -f "$SCRIPT_DIR/.env.test" ]; then
  source "$SCRIPT_DIR/.env.test"
  echo -e "${GREEN}✓ Loaded test credentials from .env.test${NC}"
else
  echo -e "${YELLOW}⚠ No .env.test file found${NC}"
  echo -e "${YELLOW}  Create tests/.env.test with TEST_USER_EMAIL and TEST_USER_PASSWORD${NC}"
  exit 1
fi

# Default to localhost HTTPS
API_URL="${API_URL:-https://localhost}"
API_PORT="${API_PORT:-8080}"

echo -e "${BLUE}Target Server:${NC} ${API_URL}:${API_PORT}"
echo ""

# Test server connectivity
echo -e "${BLUE}Testing server connectivity...${NC}"
if curl -k -sf "${API_URL}:${API_PORT}/health" > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Server is reachable${NC}"
else
  echo -e "${RED}✗ Could not reach server at ${API_URL}:${API_PORT}${NC}"
  echo -e "${YELLOW}  Make sure the server is running: pm2 status${NC}"
  exit 1
fi

echo ""

# Authenticate
echo -e "${BLUE}Authenticating as ${TEST_USER_EMAIL}...${NC}"

LOGIN_PAYLOAD=$(jq -n \
  --arg email "$TEST_USER_EMAIL" \
  --arg password "$TEST_USER_PASSWORD" \
  '{email: $email, password: $password}')

LOGIN_RESPONSE=$(curl -k -s -X POST "${API_URL}:${API_PORT}/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "$LOGIN_PAYLOAD" 2>&1)

# Check if login was successful
if echo "$LOGIN_RESPONSE" | jq -e '.token' > /dev/null 2>&1; then
  AUTH_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token')
  USER_ID=$(echo "$LOGIN_RESPONSE" | jq -r '.user.id')
  ORG_ID=$(echo "$LOGIN_RESPONSE" | jq -r '.user.organizationId')
  echo -e "${GREEN}✓ Authentication successful${NC}"
  echo "  User ID: $USER_ID"
  echo "  Organization ID: $ORG_ID"
else
  echo -e "${RED}✗ Authentication failed${NC}"
  echo "  Response: $LOGIN_RESPONSE"
  exit 1
fi

echo ""
echo -e "${BLUE}Setting up test data...${NC}"
echo ""

# Check how many matters exist
EXISTING_MATTERS=$(curl -k -s -H "Authorization: Bearer $AUTH_TOKEN" \
  "${API_URL}:${API_PORT}/api/v1/matters?limit=1" | jq -r '.matters | length')

echo -e "${BLUE}Checking existing matters...${NC}"
if [ "$EXISTING_MATTERS" -gt 0 ]; then
  echo -e "${GREEN}✓ Found $EXISTING_MATTERS existing matter(s)${NC}"
  echo -e "${BLUE}  Test data is already present - no action needed${NC}"
else
  echo -e "${YELLOW}⚠ No matters found - creating test matters${NC}"

  # Create test matters
  for i in {1..3}; do
    MATTER_PAYLOAD=$(jq -n \
      --arg name "Test Matter $i" \
      --arg client "Test Client $i" \
      --arg desc "Test matter created by setup script for API testing" \
      '{
        matter_id: ("TEST-" + ($RANDOM | tostring)),
        name: $name,
        client_name: $client,
        description: $desc,
        status: "active",
        visibility: "private"
      }')

    echo -e "${BLUE}  Creating Test Matter $i...${NC}"

    CREATE_RESPONSE=$(curl -k -s -X POST "${API_URL}:${API_PORT}/api/v1/matters" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$MATTER_PAYLOAD")

    if echo "$CREATE_RESPONSE" | jq -e '.matter_id' > /dev/null 2>&1; then
      MATTER_ID=$(echo "$CREATE_RESPONSE" | jq -r '.matter_id')
      echo -e "${GREEN}    ✓ Created matter: $MATTER_ID${NC}"
    else
      echo -e "${RED}    ✗ Failed to create matter${NC}"
      echo "    Response: $CREATE_RESPONSE"
    fi
  done
fi

echo ""

# Verify final state
FINAL_MATTER_COUNT=$(curl -k -s -H "Authorization: Bearer $AUTH_TOKEN" \
  "${API_URL}:${API_PORT}/api/v1/matters?limit=100" | jq -r '.matters | length')

echo -e "${BLUE}Final verification:${NC}"
echo -e "${GREEN}  ✓ Total matters in database: $FINAL_MATTER_COUNT${NC}"
echo ""

# Check for sessions (should have at least current session)
SESSION_COUNT=$(curl -k -s -H "Authorization: Bearer $AUTH_TOKEN" \
  "${API_URL}:${API_PORT}/api/v1/auth/session/list" | jq -r '.sessions | length')

echo -e "${GREEN}  ✓ Active sessions: $SESSION_COUNT${NC}"
echo ""

echo -e "${GREEN}✅ Test data setup complete!${NC}"
echo ""
echo -e "${BLUE}Ready to run tests:${NC}"
echo "  ./tests/run-api-tests.sh"
echo ""
