#!/bin/bash

# LANA-AI API Testing Suite
# Runs the complete Postman collection with automatic authentication
#
# Usage:
#   ./tests/run-api-tests.sh                    # Run all tests
#   ./tests/run-api-tests.sh auth               # Run only Authentication tests
#   ./tests/run-api-tests.sh matters            # Run only Matter Management tests
#   ./tests/run-api-tests.sh --list             # List available test folders
#
# Server Access Options (ALL USE HTTPS):
# - Localhost:      https://localhost:8080 (same machine - works with VPN on/off)
# - Local Network:  https://10.0.0.3:8080 (LAN access)
# - Tailscale VPN:  https://100.64.13.68:8080 (VPN IP - most reliable)

set -e  # Exit on error

# Parse command line arguments
FOLDER_FILTER=""
if [ "$1" = "--list" ] || [ "$1" = "-l" ]; then
  echo ""
  echo "Available test folders:"
  echo "  auth          - Authentication & Sessions"
  echo "  matters       - Matter Management"
  echo "  storage       - Storage & File Operations"
  echo "  cleanup       - Cleanup (runs last)"
  echo "  all           - Run all tests (default)"
  echo ""
  echo "Usage: ./tests/run-api-tests.sh [folder]"
  echo ""
  exit 0
elif [ -n "$1" ]; then
  FOLDER_FILTER="$1"
fi

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Load environment variables from .env.test if it exists
if [ -f "$SCRIPT_DIR/.env.test" ]; then
  source "$SCRIPT_DIR/.env.test"
fi

# Default to localhost HTTPS (works with or without VPN)
API_URL="${API_URL:-https://localhost}"
API_PORT="${API_PORT:-8080}"

# Auto-open report in browser (set NO_OPEN=1 to disable)
AUTO_OPEN="${AUTO_OPEN:-true}"

# Detect if we should use Tailscale
if [[ "$API_URL" == "tailscale" ]] || [[ "$API_URL" == "vpn" ]]; then
  API_URL="https://100.64.13.68"
  API_PORT="8080"
fi

# Ensure HTTPS for known IPs
if [[ "$API_URL" == "http://localhost" ]]; then
  API_URL="https://localhost"
fi
if [[ "$API_URL" == "http://10.0.0.3" ]]; then
  API_URL="https://10.0.0.3"
fi

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║           LANA-AI API Testing Suite                        ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Target Server:${NC} ${YELLOW}${API_URL}:${API_PORT}${NC}"
echo ""

# Check dependencies
echo -e "${BLUE}Checking dependencies...${NC}"

# Check for jq
if ! command -v jq &> /dev/null; then
  echo -e "${YELLOW}⚠ jq is not installed. Installing via homebrew...${NC}"
  brew install jq
fi

# Check for Newman
if ! command -v newman &> /dev/null; then
  echo -e "${YELLOW}⚠ Newman is not installed. Installing...${NC}"
  npm install -g newman newman-reporter-htmlextra
fi

echo -e "${GREEN}✓ All dependencies installed${NC}"
echo ""

# Test server connectivity
echo -e "${BLUE}Testing server connectivity...${NC}"
if curl -k -sf "${API_URL}:${API_PORT}/health" > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Server is reachable at ${API_URL}:${API_PORT}${NC}"
  # Show health status
  HEALTH=$(curl -k -s "${API_URL}:${API_PORT}/health" 2>&1)
  echo "  Services: $(echo $HEALTH | grep -o '"postgres":"[^"]*"' | cut -d'"' -f4), $(echo $HEALTH | grep -o '"minio":"[^"]*"' | cut -d'"' -f4)"
else
  echo -e "${RED}✗ Could not reach server at ${API_URL}:${API_PORT}${NC}"
  echo -e "${YELLOW}  Make sure the server is running: pm2 status${NC}"
  exit 1
fi

echo ""

# Authenticate and get token
if [ -n "$TEST_USER_EMAIL" ] && [ -n "$TEST_USER_PASSWORD" ]; then
  echo -e "${BLUE}Authenticating as ${TEST_USER_EMAIL}...${NC}"

  # Create login payload using jq to properly escape special characters
  LOGIN_PAYLOAD=$(jq -n \
    --arg email "$TEST_USER_EMAIL" \
    --arg password "$TEST_USER_PASSWORD" \
    '{email: $email, password: $password}')

  # Attempt login
  LOGIN_RESPONSE=$(curl -k -s -X POST "${API_URL}:${API_PORT}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "$LOGIN_PAYLOAD" 2>&1)

  # Check if login was successful
  if echo "$LOGIN_RESPONSE" | jq -e '.token' > /dev/null 2>&1; then
    AUTH_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token')
    USER_INFO=$(echo "$LOGIN_RESPONSE" | jq -r '.user.firstName // .user.email')
    USER_ID=$(echo "$LOGIN_RESPONSE" | jq -r '.user.id')
    echo -e "${GREEN}✓ Authentication successful${NC}"
    echo "  User: $USER_INFO"
    echo "  User ID: $USER_ID"
    echo "  Token: ${AUTH_TOKEN:0:20}..."
  else
    echo -e "${YELLOW}⚠ Authentication failed${NC}"
    echo "  Response: $LOGIN_RESPONSE"
    echo ""
    echo -e "${YELLOW}  Tests requiring authentication will fail.${NC}"
    echo -e "${YELLOW}  Update credentials in tests/.env.test${NC}"
    AUTH_TOKEN=""
  fi
else
  echo -e "${YELLOW}⚠ No test credentials configured${NC}"
  echo -e "${YELLOW}  Create tests/.env.test with TEST_USER_EMAIL and TEST_USER_PASSWORD${NC}"
  echo -e "${YELLOW}  Tests requiring authentication will fail.${NC}"
  AUTH_TOKEN=""
fi

echo ""
if [ -n "$FOLDER_FILTER" ] && [ "$FOLDER_FILTER" != "all" ]; then
  echo -e "${BLUE}Running tests for folder: ${YELLOW}${FOLDER_FILTER}${NC}"
else
  echo -e "${BLUE}Running API test collection...${NC}"
fi
echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
echo ""

# Change to project root for newman
cd "$PROJECT_ROOT"

# Map folder shortcuts to full folder names
FOLDER_NAME=""
case "$FOLDER_FILTER" in
  "auth")
    FOLDER_NAME="1. Authentication & Sessions"
    ;;
  "matters")
    FOLDER_NAME="2. Matters Management"
    ;;
  "storage")
    FOLDER_NAME="3. Storage & File Operations"
    ;;
  "cleanup")
    FOLDER_NAME="99. Cleanup"
    ;;
  "all"|"")
    FOLDER_NAME=""
    ;;
  *)
    # Try using the filter as-is (might be a full folder name)
    FOLDER_NAME="$FOLDER_FILTER"
    ;;
esac

# Run the collection
NEWMAN_ARGS=(
  "postman/LANA-AI-API.postman_collection.json"
  "--env-var" "url=${API_URL}"
  "--env-var" "port=${API_PORT}"
  "--insecure"
  "--reporters" "cli,htmlextra"
  "--reporter-htmlextra-export" "tests/newman-report.html"
  "--reporter-htmlextra-title" "LANA-AI API Test Results"
  "--reporter-htmlextra-logs"
  "--reporter-htmlextra-darkTheme"
  "--suppress-exit-code"
  "--timeout-request" "10000"
  "--color" "on"
)

# Add folder filter if specified
if [ -n "$FOLDER_NAME" ]; then
  NEWMAN_ARGS+=("--folder" "$FOLDER_NAME")
fi

# NOTE: We do NOT pass token/user_id via --env-var because:
# 1. The Login request in the collection will save the token to collection variables
# 2. Environment variables override collection variables in Newman
# 3. This would cause subsequent requests to use the wrong (old) token
# The collection manages its own authentication state via the Login request

# Run newman
newman run "${NEWMAN_ARGS[@]}"

# Check if report was generated
echo ""
echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
echo ""

if [ -f "$PROJECT_ROOT/tests/newman-report.html" ]; then
  echo -e "${GREEN}✓ Test report generated: tests/newman-report.html${NC}"
  echo ""

  # Auto-open report in browser
  if [ "$AUTO_OPEN" = "true" ] && [ "$NO_OPEN" != "1" ]; then
    echo -e "${BLUE}Opening report in browser...${NC}"

    # Detect OS and open appropriately
    if [[ "$OSTYPE" == "darwin"* ]]; then
      # macOS
      open "$PROJECT_ROOT/tests/newman-report.html"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
      # Linux
      xdg-open "$PROJECT_ROOT/tests/newman-report.html" 2>/dev/null || \
        echo -e "${YELLOW}  Could not auto-open. Use: xdg-open tests/newman-report.html${NC}"
    else
      echo -e "${YELLOW}  Unknown OS. View report at: tests/newman-report.html${NC}"
    fi

    echo ""
  else
    echo -e "${BLUE}View results:${NC}"
    echo "  macOS:  open tests/newman-report.html"
    echo "  Linux:  xdg-open tests/newman-report.html"
    echo ""
  fi
else
  echo -e "${RED}✗ Test report was not generated${NC}"
  exit 1
fi

echo -e "${GREEN}✓ API testing complete${NC}"
echo ""
