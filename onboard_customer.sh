#!/usr/bin/env bash
# =============================================================================
# Lana AI - Customer Onboarding Script
# =============================================================================
# This script handles the complete customer onboarding process:
#   1. Generates SQL seed file from Excel onboarding data
#   2. Seeds the data into the PostgreSQL database
#   3. Verifies the data was inserted correctly
#
# Usage:
#   ./onboard_customer.sh [OPTIONS]
#
# Options:
#   --excel-path PATH    Path to Excel onboarding file (default: config/onboarding/onboarding.xlsx)
#   --force              Force regeneration even if SQL file exists
#   --dry-run            Generate SQL but don't execute against database
#   --db-host HOST       PostgreSQL host (default: 127.0.0.1)
#   --db-port PORT       PostgreSQL port (default: 5432)
#   --db-name NAME       PostgreSQL database (default: lana_chef)
#   --db-user USER       PostgreSQL user (default: current user)
#   --help               Show this help message
#
# Prerequisites:
#   - PostgreSQL installed and running (via Homebrew or native)
#   - Python 3 with openpyxl package installed
#   - Excel file with organization data
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory (where this script lives)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default configuration
DEFAULT_EXCEL_PATH="${SCRIPT_DIR}/config/onboarding/onboarding.xlsx"

# PostgreSQL connection defaults (native/Homebrew installation)
POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-lana_chef}"
POSTGRES_USER="${POSTGRES_USER:-$(whoami)}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"

# =============================================================================
# Helper Functions
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_help() {
    echo ""
    echo -e "${BLUE}Lana AI - Customer Onboarding Script${NC}"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --excel-path PATH    Path to Excel onboarding file"
    echo "                       (default: config/onboarding/onboarding.xlsx)"
    echo "  --force              Force regeneration even if SQL file exists"
    echo "  --dry-run            Generate SQL but don't execute against database"
    echo "  --db-host HOST       PostgreSQL host (default: 127.0.0.1)"
    echo "  --db-port PORT       PostgreSQL port (default: 5432)"
    echo "  --db-name NAME       PostgreSQL database (default: lana_chef)"
    echo "  --db-user USER       PostgreSQL user (default: current user)"
    echo "  --help               Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  POSTGRES_HOST        PostgreSQL host"
    echo "  POSTGRES_PORT        PostgreSQL port"
    echo "  POSTGRES_DB          PostgreSQL database name"
    echo "  POSTGRES_USER        PostgreSQL user"
    echo "  POSTGRES_PASSWORD    PostgreSQL password (if required)"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Use default Excel path"
    echo "  $0 --excel-path /path/to/custom.xlsx  # Use custom Excel file"
    echo "  $0 --dry-run                          # Generate SQL only"
    echo "  $0 --db-host localhost --db-name mydb # Custom database"
    echo ""
}

# Build psql connection string
build_psql_cmd() {
    local cmd="psql"
    
    if [[ -n "$POSTGRES_HOST" ]]; then
        cmd="$cmd -h $POSTGRES_HOST"
    fi
    
    if [[ -n "$POSTGRES_PORT" ]]; then
        cmd="$cmd -p $POSTGRES_PORT"
    fi
    
    if [[ -n "$POSTGRES_USER" ]]; then
        cmd="$cmd -U $POSTGRES_USER"
    fi
    
    if [[ -n "$POSTGRES_DB" ]]; then
        cmd="$cmd -d $POSTGRES_DB"
    fi
    
    echo "$cmd"
}

# =============================================================================
# Pre-flight Checks
# =============================================================================

check_prerequisites() {
    local dry_run="${1:-false}"
    
    log_info "Checking prerequisites..."
    
    local errors=0
    
    # Check Python 3
    if ! command -v python3 &> /dev/null; then
        log_error "Python 3 is not installed"
        errors=$((errors + 1))
    else
        log_success "Python 3 found"
    fi
    
    # Check openpyxl
    if ! python3 -c "import openpyxl" &> /dev/null; then
        log_error "Python package 'openpyxl' is not installed"
        log_info "Install with: pip3 install openpyxl"
        errors=$((errors + 1))
    else
        log_success "openpyxl package found"
    fi
    
    # Skip PostgreSQL checks in dry-run mode
    if [[ "$dry_run" != "true" ]]; then
        # Check psql command exists
        if ! command -v psql &> /dev/null; then
            log_error "PostgreSQL client (psql) is not installed"
            log_info "Install with: brew install postgresql@17"
            errors=$((errors + 1))
        else
            log_success "PostgreSQL client (psql) found"
            
            # Check PostgreSQL is accessible
            local psql_cmd=$(build_psql_cmd)
            if ! PGPASSWORD="$POSTGRES_PASSWORD" $psql_cmd -c "SELECT 1;" &> /dev/null; then
                log_error "Cannot connect to PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT}"
                log_info "Make sure PostgreSQL is running: brew services start postgresql@17"
                log_info "Or check your connection settings with --db-host, --db-port, --db-user"
                errors=$((errors + 1))
            else
                log_success "PostgreSQL connection verified (${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB})"
            fi
        fi
    else
        log_info "Dry-run mode: Skipping PostgreSQL checks"
    fi
    
    if [[ $errors -gt 0 ]]; then
        log_error "Prerequisites check failed with $errors error(s)"
        return 1
    fi
    
    log_success "All prerequisites met"
    return 0
}

check_excel_file() {
    local excel_path="$1"
    
    if [[ ! -f "$excel_path" ]]; then
        log_error "Excel file not found: $excel_path"
        echo ""
        echo -e "${YELLOW}Please either:${NC}"
        echo -e "  1. Place your Excel file at: ${GREEN}config/onboarding/onboarding.xlsx${NC}"
        echo -e "  2. Specify a custom path: ${GREEN}$0 --excel-path /path/to/file.xlsx${NC}"
        return 1
    fi
    
    log_success "Excel file found: $excel_path"
    return 0
}

# =============================================================================
# Main Functions
# =============================================================================

generate_sql() {
    local excel_path="$1"
    local force="$2"
    
    log_info "Generating SQL seed file from Excel data..."
    
    local python_script="${SCRIPT_DIR}/scripts/onboarding/import_excel_onboarding.py"
    
    if [[ ! -f "$python_script" ]]; then
        log_error "Python import script not found: $python_script"
        return 1
    fi
    
    local cmd="python3 \"$python_script\" --excel-path \"$excel_path\" --output-dir \"$SCRIPT_DIR\""
    
    if [[ "$force" == "true" ]]; then
        cmd="$cmd --force"
    fi
    
    if eval $cmd; then
        log_success "SQL seed file generated successfully"
        return 0
    else
        log_error "Failed to generate SQL seed file"
        return 1
    fi
}

find_generated_sql() {
    # Find the most recently generated seed file (excluding seed-test-data.sql)
    local sql_file
    sql_file=$(ls -t "${SCRIPT_DIR}"/seed-*.sql 2>/dev/null | grep -v "seed-test-data" | head -1)
    
    if [[ -z "$sql_file" ]]; then
        log_error "No generated SQL seed file found"
        return 1
    fi
    
    echo "$sql_file"
}

seed_database() {
    local sql_file="$1"
    
    log_info "Seeding database with: $(basename "$sql_file")"
    
    local psql_cmd=$(build_psql_cmd)
    
    # Execute SQL file
    log_info "Executing SQL seed file against ${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}..."
    if PGPASSWORD="$POSTGRES_PASSWORD" $psql_cmd -f "$sql_file"; then
        log_success "Database seeded successfully"
        return 0
    else
        log_error "Failed to seed database"
        return 1
    fi
}

verify_data() {
    log_info "Verifying data in database..."
    
    local psql_cmd=$(build_psql_cmd)
    
    # Run verification query
    local result
    result=$(PGPASSWORD="$POSTGRES_PASSWORD" $psql_cmd -t -c "
        SELECT json_build_object(
            'organizations', (SELECT COUNT(*) FROM organizations),
            'roles', (SELECT COUNT(*) FROM roles),
            'departments', (SELECT COUNT(*) FROM departments),
            'users', (SELECT COUNT(*) FROM users),
            'user_roles', (SELECT COUNT(*) FROM user_roles),
            'user_activations', (SELECT COUNT(*) FROM user_activations),
            'user_preferences', (SELECT COUNT(*) FROM user_preferences),
            'notification_preferences', (SELECT COUNT(*) FROM notification_preferences),
            'matters', (SELECT COUNT(*) FROM client_matters)
        );
    " 2>/dev/null)
    
    if [[ -z "$result" ]]; then
        log_error "Failed to verify data"
        return 1
    fi
    
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║${NC}      ${GREEN}✅ Data Verification Complete${NC}                  ${GREEN}║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════╣${NC}"
    
    # Parse and display counts
    local orgs=$(echo "$result" | python3 -c "import sys, json; print(json.loads(sys.stdin.read())['organizations'])" 2>/dev/null || echo "?")
    local roles=$(echo "$result" | python3 -c "import sys, json; print(json.loads(sys.stdin.read())['roles'])" 2>/dev/null || echo "?")
    local depts=$(echo "$result" | python3 -c "import sys, json; print(json.loads(sys.stdin.read())['departments'])" 2>/dev/null || echo "?")
    local users=$(echo "$result" | python3 -c "import sys, json; print(json.loads(sys.stdin.read())['users'])" 2>/dev/null || echo "?")
    local user_roles=$(echo "$result" | python3 -c "import sys, json; print(json.loads(sys.stdin.read())['user_roles'])" 2>/dev/null || echo "?")
    local activations=$(echo "$result" | python3 -c "import sys, json; print(json.loads(sys.stdin.read())['user_activations'])" 2>/dev/null || echo "?")
    local prefs=$(echo "$result" | python3 -c "import sys, json; print(json.loads(sys.stdin.read())['user_preferences'])" 2>/dev/null || echo "?")
    local notif_prefs=$(echo "$result" | python3 -c "import sys, json; print(json.loads(sys.stdin.read())['notification_preferences'])" 2>/dev/null || echo "?")
    local matters=$(echo "$result" | python3 -c "import sys, json; print(json.loads(sys.stdin.read())['matters'])" 2>/dev/null || echo "?")
    
    printf "${GREEN}║${NC}  %-28s %6s              ${GREEN}║${NC}\n" "Organizations:" "$orgs"
    printf "${GREEN}║${NC}  %-28s %6s              ${GREEN}║${NC}\n" "Roles:" "$roles"
    printf "${GREEN}║${NC}  %-28s %6s              ${GREEN}║${NC}\n" "Departments:" "$depts"
    printf "${GREEN}║${NC}  %-28s %6s              ${GREEN}║${NC}\n" "Users:" "$users"
    printf "${GREEN}║${NC}  %-28s %6s              ${GREEN}║${NC}\n" "User Role Assignments:" "$user_roles"
    printf "${GREEN}║${NC}  %-28s %6s              ${GREEN}║${NC}\n" "User Activations:" "$activations"
    printf "${GREEN}║${NC}  %-28s %6s              ${GREEN}║${NC}\n" "User Preferences:" "$prefs"
    printf "${GREEN}║${NC}  %-28s %6s              ${GREEN}║${NC}\n" "Notification Preferences:" "$notif_prefs"
    printf "${GREEN}║${NC}  %-28s %6s              ${GREEN}║${NC}\n" "Matters:" "$matters"
    
    echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    log_success "Data verification passed"
    return 0
}

# =============================================================================
# Main Entry Point
# =============================================================================

main() {
    local excel_path="$DEFAULT_EXCEL_PATH"
    local force="false"
    local dry_run="false"
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --excel-path)
                excel_path="$2"
                shift 2
                ;;
            --force)
                force="true"
                shift
                ;;
            --dry-run)
                dry_run="true"
                shift
                ;;
            --db-host)
                POSTGRES_HOST="$2"
                shift 2
                ;;
            --db-port)
                POSTGRES_PORT="$2"
                shift 2
                ;;
            --db-name)
                POSTGRES_DB="$2"
                shift 2
                ;;
            --db-user)
                POSTGRES_USER="$2"
                shift 2
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}      ${BLUE}Lana AI - Customer Onboarding${NC}                  ${BLUE}║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    # Step 1: Check prerequisites (pass dry_run flag to skip PostgreSQL checks if needed)
    if ! check_prerequisites "$dry_run"; then
        exit 1
    fi
    
    # Step 2: Check Excel file exists
    if ! check_excel_file "$excel_path"; then
        exit 1
    fi
    
    # Step 3: Generate SQL from Excel
    if ! generate_sql "$excel_path" "$force"; then
        exit 1
    fi
    
    # Step 4: Find generated SQL file
    local sql_file
    sql_file=$(find_generated_sql)
    if [[ $? -ne 0 ]]; then
        exit 1
    fi
    
    log_info "Generated SQL file: $sql_file"
    
    # Step 5: Seed database (unless dry-run)
    if [[ "$dry_run" == "true" ]]; then
        log_warning "Dry-run mode: Skipping database seeding"
        echo ""
        echo -e "${YELLOW}Generated files:${NC}"
        echo -e "  SQL file: ${GREEN}$sql_file${NC}"
        echo -e "  Activation codes: ${GREEN}${SCRIPT_DIR}/exports/${NC}"
        echo ""
        echo -e "To seed the database manually:"
        echo -e "  ${GREEN}psql -h ${POSTGRES_HOST} -p ${POSTGRES_PORT} -U ${POSTGRES_USER} -d ${POSTGRES_DB} -f \"$sql_file\"${NC}"
        exit 0
    fi
    
    if ! seed_database "$sql_file"; then
        exit 1
    fi
    
    # Step 6: Verify data
    if ! verify_data; then
        exit 1
    fi
    
    # Success summary
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║${NC}      ${GREEN}🎉 Onboarding Complete!${NC}                        ${GREEN}║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC}                                                      ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  ${YELLOW}Next Steps:${NC}                                       ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  1. Distribute activation codes to users            ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}     See: exports/activation-codes-*.csv             ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                      ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  2. Users activate at:                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}     http://app.lanaai.io/activate                   ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                      ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  ${RED}⚠️  IMPORTANT:${NC} Activation codes expire in 7 days   ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                      ${GREEN}║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# Run main function
main "$@"
