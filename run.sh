#!/bin/bash
# LanaAI Chef - Application Start Script
# Starts the Node.js application with PM2 for continuous background operation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="lana-api"
APP_ENTRY="${SCRIPT_DIR}/src/index.js"
ENV_FILE="${SCRIPT_DIR}/.env"
LOG_DIR="${HOME}/Library/Logs/LanaAI"
PM2_LOG_FILE="${LOG_DIR}/pm2-lana.log"
SKIP_WARMING=false

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${GREEN}[+]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_header() {
    echo ""
    echo -e "${BLUE}============================================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}============================================================================${NC}"
}

# Check if PM2 is installed
check_pm2() {
    if ! command -v pm2 &> /dev/null; then
        print_error "PM2 is not installed. Installing..."
        npm install -g pm2
    fi
}

# Check if thin client is configured
check_thin_client_setup() {
    # Check if organization_identity table exists and has data
    if psql -h 127.0.0.1 -U "$(whoami)" -d lana_chef -c "SELECT 1 FROM organization_identity LIMIT 1;" &>/dev/null 2>&1; then
        local org_count=$(psql -h 127.0.0.1 -U "$(whoami)" -d lana_chef -t -c "SELECT COUNT(*) FROM organization_identity;" 2>/dev/null | xargs)
        if [[ "$org_count" -gt 0 ]]; then
            print_status "Thin client is configured"
            return 0
        fi
    fi
    
    print_warning "Thin client is not configured"
    echo ""
    echo "Thin client support enables:"
    echo "  - Electron app auto-discovery via Bonjour/mDNS"
    echo "  - Per-organization update policy management"
    echo "  - Organization identity configuration"
    echo ""
    echo "Options:"
    echo "  1) Run setup now (requires org-id and org-name)"
    echo "  2) Skip and continue without thin client support"
    echo "  3) Cancel and run setup-thin-client.sh manually"
    echo ""
    read -p "Choose option (1-3): " -n 1 -r
    echo
    
    case $REPLY in
        1)
            echo ""
            read -p "Enter organization ID (e.g., 'norton-estate-planning'): " ORG_ID
            read -p "Enter organization name (e.g., 'Norton Estate Planning'): " ORG_NAME
            read -p "Enter static IP (optional, press Enter to auto-detect): " STATIC_IP
            
            if [[ -z "$ORG_ID" || -z "$ORG_NAME" ]]; then
                print_error "Organization ID and name are required"
                exit 1
            fi
            
            print_status "Running thin client setup..."
            if [[ -n "$STATIC_IP" ]]; then
                ./scripts/setup/setup-thin-client.sh --org-id "$ORG_ID" --org-name "$ORG_NAME" --static-ip "$STATIC_IP"
            else
                ./scripts/setup/setup-thin-client.sh --org-id "$ORG_ID" --org-name "$ORG_NAME"
            fi
            
            if [[ $? -eq 0 ]]; then
                print_status "Thin client setup completed"
            else
                print_error "Thin client setup failed"
                exit 1
            fi
            ;;
        2)
            print_warning "Continuing without thin client support"
            ;;
        3)
            print_error "Aborted. Please run setup-thin-client.sh manually."
            exit 1
            ;;
        *)
            print_warning "Invalid option. Continuing without thin client support."
            ;;
    esac
}

# Start a missing service
start_service() {
    local service_name="$1"
    case "$service_name" in
        postgresql)
            print_status "Starting PostgreSQL..."
            brew services start postgresql@17 2>/dev/null || {
                # Try LaunchAgent if brew services fails
                launchctl load ~/Library/LaunchAgents/com.lana.postgresql.plist 2>/dev/null || true
            }
            sleep 2
            ;;
        minio)
            print_status "Starting MinIO..."
            "$SCRIPT_DIR/scripts/start_minio.sh" --background
            sleep 2
            ;;
        ollama)
            print_status "Starting Ollama..."
            ollama serve &>/dev/null &
            sleep 3

            # Pre-warm models to avoid first-request delay
            if [[ "$SKIP_WARMING" == false ]] && [[ -f "$SCRIPT_DIR/scripts/warm-ollama-models.sh" ]]; then
                print_status "Pre-warming Ollama models..."
                "$SCRIPT_DIR/scripts/warm-ollama-models.sh" 2>/dev/null || print_warning "Model pre-warming failed (non-critical)"
            elif [[ "$SKIP_WARMING" == true ]]; then
                print_warning "Skipping Ollama model pre-warming (--skip-warming flag set)"
            fi
            ;;
        unstructured)
            print_status "Starting Unstructured API..."
            "$SCRIPT_DIR/scripts/start_unstructured_api.sh" --background
            sleep 2
            ;;
        tailscale)
            print_status "Starting Tailscale VPN..."
            if command -v tailscale &>/dev/null; then
                # Start via LaunchDaemon
                sudo launchctl load /Library/LaunchDaemons/com.tailscale.tailscaled.plist 2>/dev/null || \
                sudo launchctl start com.tailscale.tailscaled 2>/dev/null || \
                print_warning "Tailscale may already be running or LaunchDaemon not configured"
                sleep 2
            else
                print_error "Tailscale not installed. Run deploy-prod-mac.sh to install."
            fi
            ;;
        wireguard)
            print_status "Starting WireGuard VPN..."
            if command -v wg-quick &>/dev/null; then
                sudo wg-quick up wg0 2>/dev/null || print_warning "WireGuard may already be running or config is missing"
                sleep 2
            else
                print_error "WireGuard not installed. Run deploy-prod-mac.sh to install."
            fi
            ;;
    esac
}

# Check if required services are running
check_services() {
    print_header "Checking Required Services"

    local missing_services=()

    # PostgreSQL
    if lsof -i :5432 &>/dev/null; then
        print_status "PostgreSQL is running (port 5432)"
    else
        print_warning "PostgreSQL is not running"
        missing_services+=("postgresql")
    fi

    # MinIO
    if lsof -i :9000 &>/dev/null; then
        print_status "MinIO is running (port 9000)"
    else
        print_warning "MinIO is not running"
        missing_services+=("minio")
    fi

    # Ollama
    if lsof -i :11434 &>/dev/null; then
        print_status "Ollama is running (port 11434)"
    else
        print_warning "Ollama is not running"
        missing_services+=("ollama")
    fi

    # Unstructured (optional but recommended)
    if lsof -i :8000 &>/dev/null; then
        print_status "Unstructured API is running (port 8000)"
    else
        print_warning "Unstructured API is not running (document parsing may fail)"
        missing_services+=("unstructured")
    fi

    # Tailscale (if enabled)
    if [[ -f "$ENV_FILE" ]]; then
        TAILSCALE_ENABLED=$(grep "^TAILSCALE_ENABLED=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2)

        if [[ "$TAILSCALE_ENABLED" == "true" ]]; then
            if command -v tailscale &>/dev/null && tailscale status &>/dev/null 2>&1; then
                TAILSCALE_IP=$(tailscale ip -4 2>/dev/null | head -1)
                print_status "Tailscale VPN is running ($TAILSCALE_IP)"
            else
                print_warning "Tailscale VPN is not running"
                missing_services+=("tailscale")
            fi
        fi
    fi

    # WireGuard VPN (legacy, if enabled)
    if [[ -f "$ENV_FILE" ]]; then
        VPN_ENABLED=$(grep "^VPN_ENABLED=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2)
        WIREGUARD_ENABLED=$(grep "^WIREGUARD_ENABLED=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2)

        if [[ "$VPN_ENABLED" == "true" ]] && [[ "$WIREGUARD_ENABLED" == "true" ]]; then
            # Check for any WireGuard interface (macOS uses utun interfaces)
            if command -v wg &>/dev/null && sudo wg show 2>/dev/null | grep -q "interface:"; then
                WG_INTERFACE=$(sudo wg show 2>/dev/null | grep "interface:" | head -1 | awk '{print $2}')
                print_status "WireGuard VPN is running (interface $WG_INTERFACE)"
            else
                print_warning "WireGuard VPN is not running"
                missing_services+=("wireguard")
            fi
        fi
    fi

    if [[ ${#missing_services[@]} -gt 0 ]]; then
        echo ""
        echo "Missing services: ${missing_services[*]}"
        echo ""
        echo "Options:"
        echo "  1) Start missing services automatically"
        echo "  2) Continue without starting services"
        echo "  3) Cancel"
        echo ""
        read -p "Choose option (1-3): " -n 1 -r
        echo

        case $REPLY in
            1)
                for service in "${missing_services[@]}"; do
                    start_service "$service"
                done
                # Verify services started
                echo ""
                print_status "Verifying services..."
                sleep 2
                local still_missing=false
                [[ " ${missing_services[*]} " =~ " postgresql " ]] && ! lsof -i :5432 &>/dev/null && { print_error "PostgreSQL failed to start"; still_missing=true; }
                [[ " ${missing_services[*]} " =~ " minio " ]] && ! lsof -i :9000 &>/dev/null && { print_error "MinIO failed to start"; still_missing=true; }
                [[ " ${missing_services[*]} " =~ " ollama " ]] && ! lsof -i :11434 &>/dev/null && { print_error "Ollama failed to start"; still_missing=true; }
                [[ " ${missing_services[*]} " =~ " tailscale " ]] && ! tailscale status &>/dev/null 2>&1 && { print_error "Tailscale failed to start"; still_missing=true; }
                [[ " ${missing_services[*]} " =~ " wireguard " ]] && ! sudo wg show 2>/dev/null | grep -q "interface:" && { print_error "WireGuard failed to start"; still_missing=true; }

                if [[ "$still_missing" == true ]]; then
                    print_warning "Some services failed to start. Continuing anyway..."
                else
                    print_status "All services started successfully"
                fi
                ;;
            2)
                print_warning "Continuing without starting services..."
                ;;
            3)
                print_error "Aborted."
                exit 1
                ;;
            *)
                print_warning "Invalid option. Continuing without starting services..."
                ;;
        esac
    fi
}

# Start the application
start_app() {
    print_header "Starting LanaAI Application"

    cd "$SCRIPT_DIR"

    # Check if .env exists
    if [[ ! -f "$ENV_FILE" ]]; then
        print_error ".env file not found at $ENV_FILE"
        print_error "Run deploy-prod-mac.sh first to configure the application."
        exit 1
    fi

    # Pre-warm Ollama models if Ollama is running
    # This ensures models are loaded into memory for instant first-request responses
    if [[ "$SKIP_WARMING" == false ]]; then
        if lsof -i :11434 &>/dev/null; then
            if [[ -f "$SCRIPT_DIR/scripts/warm-ollama-models.sh" ]]; then
                print_status "Pre-warming Ollama models for instant responses..."
                "$SCRIPT_DIR/scripts/warm-ollama-models.sh" 2>/dev/null || print_warning "Model pre-warming failed (non-critical)"
            fi
        fi
    else
        print_warning "Skipping Ollama model pre-warming (--skip-warming flag set)"
    fi
    
    # Check if already running
    if pm2 describe "$APP_NAME" &>/dev/null; then
        print_warning "Application '$APP_NAME' is already registered in PM2"
        echo ""
        echo "Options:"
        echo "  1) Restart the application"
        echo "  2) Stop and remove, then start fresh"
        echo "  3) View logs"
        echo "  4) Cancel"
        echo ""
        read -p "Choose option (1-4): " -n 1 -r
        echo
        
        case $REPLY in
            1)
                print_status "Restarting $APP_NAME..."
                pm2 restart "$APP_NAME" --update-env
                ;;

            2)
                print_status "Stopping and removing $APP_NAME..."
                pm2 delete "$APP_NAME" 2>/dev/null || true
                print_status "Starting $APP_NAME fresh..."
                pm2 start "$APP_ENTRY" --name "$APP_NAME" --log "$PM2_LOG_FILE" --time
                ;;
            3)
                pm2 logs "$APP_NAME" --lines 50
                exit 0
                ;;
            *)
                print_status "Cancelled."
                exit 0
                ;;
        esac
    else
        print_status "Starting $APP_NAME with PM2..."
        pm2 start "$APP_ENTRY" --name "$APP_NAME" --log "$PM2_LOG_FILE" --time
    fi
    
    # Save PM2 process list
    print_status "Saving PM2 process list..."
    pm2 save
    
    # Show status
    echo ""
    pm2 list
}

# Display Tailscale VPN connection details
show_vpn_details() {
    if [[ ! -f "$ENV_FILE" ]]; then
        return
    fi

    TAILSCALE_ENABLED=$(grep "^TAILSCALE_ENABLED=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2)

    if [[ "$TAILSCALE_ENABLED" != "true" ]]; then
        return
    fi

    print_header "Tailscale VPN Status"

    # Check if Tailscale is running
    if command -v tailscale &>/dev/null && tailscale status &>/dev/null 2>&1; then
        TAILSCALE_IP=$(tailscale ip -4 2>/dev/null | head -1)
        TAILSCALE_HOSTNAME=$(tailscale status --json 2>/dev/null | grep -o '"HostName":"[^"]*"' | cut -d'"' -f4 | head -1)
        PORT=$(grep "^PORT=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2)
        PORT=${PORT:-"8080"}

        echo -e "${GREEN}Status:${NC} Connected ✓"
        echo ""
        echo -e "${BLUE}Network Information:${NC}"
        echo "  Tailscale IP:        $TAILSCALE_IP"
        echo "  Hostname:            ${TAILSCALE_HOSTNAME:-lana-ai-chef}"
        echo "  API Port:            $PORT"
        echo "  Network:             100.x.x.x (Tailscale CGNAT)"
        echo ""
        echo -e "${BLUE}Client Access URLs:${NC}"
        echo "  Direct IP:           http://$TAILSCALE_IP:$PORT"
        echo "  Hostname:            http://${TAILSCALE_HOSTNAME:-lana-ai-chef}:$PORT"
        echo "  Login Page:          http://$TAILSCALE_IP:$PORT/login.html"
        echo "  Discovery API:       http://$TAILSCALE_IP:$PORT/api/health/discovery"
        echo ""
        echo -e "${BLUE}Mobile Setup (Simple 3-Step Process):${NC}"
        echo "  1. Install Tailscale app:"
        echo "     • iOS: App Store → Search 'Tailscale'"
        echo "     • Android: Play Store → Search 'Tailscale'"
        echo ""
        echo "  2. Login with same account:"
        echo "     • Open Tailscale app"
        echo "     • Sign in (same account as this server)"
        echo "     • That's it! Device auto-connects"
        echo ""
        echo "  3. Access LanaAI:"
        echo "     • Open browser on phone"
        echo "     • Visit: http://$TAILSCALE_IP:$PORT"
        echo "     • Login with your credentials"
        echo ""
        echo -e "${GREEN}✓ No port forwarding required!${NC}"
        echo -e "${GREEN}✓ No router configuration needed!${NC}"
        echo -e "${GREEN}✓ No QR codes or config files!${NC}"
        echo -e "${GREEN}✓ Works from anywhere in the world!${NC}"
        echo ""

        # Show connected peers
        PEER_COUNT=$(tailscale status 2>/dev/null | grep -cv "$(hostname -s)" || echo "0")
        echo -e "${BLUE}Connected Devices:${NC} $PEER_COUNT"
        if [[ "$PEER_COUNT" -gt 0 ]]; then
            echo ""
            tailscale status 2>/dev/null | grep -v "^$(hostname -s)" | head -10 || true
        fi
        echo ""
    else
        echo -e "${YELLOW}Status:${NC} Not Running"
        echo ""
        echo "To start Tailscale:"
        echo "  1. Start daemon: sudo launchctl load /Library/LaunchDaemons/com.tailscale.tailscaled.plist"
        echo "  2. Authenticate: sudo tailscale up"
        echo ""
        echo "Or re-run deploy-prod-mac.sh and enable Tailscale during setup."
        echo ""
    fi
}

# Show usage
show_usage() {
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  start     Start the application (default)"
    echo "  stop      Stop the application"
    echo "  restart   Restart the application"
    echo "  status    Show application status"
    echo "  logs      Show application logs"
    echo "  monitor   Open PM2 monitoring dashboard"
    echo "  vpn       Show VPN configuration and status"
    echo "  check-ip  Check if public IP changed (for dynamic IPs)"
    echo ""
    echo "Options:"
    echo "  --skip-warming    Skip Ollama model pre-warming (use if models already loaded)"
    echo ""
    echo "Examples:"
    echo "  $0                      # Start the app"
    echo "  $0 start                # Start the app"
    echo "  $0 start --skip-warming # Start without warming models"
    echo "  $0 logs                 # View logs"
    echo "  $0 restart              # Restart the app"
    echo "  $0 vpn                  # Show VPN details"
    echo "  $0 check-ip             # Check public IP status"
}

# Main
main() {
    # Parse flags
    local command="start"

    for arg in "$@"; do
        case "$arg" in
            --skip-warming)
                SKIP_WARMING=true
                ;;
            start|stop|restart|status|logs|monitor|monit|vpn|check-ip|-h|--help|help)
                command="$arg"
                ;;
        esac
    done

    # If no command given, use start as default
    if [[ "$#" -eq 0 ]]; then
        command="start"
    fi

    case "$command" in
        start)
            check_pm2
            check_services
            check_thin_client_setup
            start_app
            
            print_header "Application Started Successfully"
            echo ""
            echo "Service URL:  http://localhost:8080"
            echo ""
            echo "PM2 Commands:"
            echo "  View logs:     pm2 logs $APP_NAME"
            echo "  Restart:       pm2 restart $APP_NAME"
            echo "  Stop:          pm2 stop $APP_NAME"
            echo "  Monitor:       pm2 monit"
            echo ""

            # Show VPN details if VPN is enabled
            show_vpn_details
            ;;
        stop)
            check_pm2
            print_status "Stopping $APP_NAME..."
            pm2 stop "$APP_NAME" 2>/dev/null || print_warning "App not running"
            pm2 save
            print_status "Application stopped"
            ;;
        restart)
            check_pm2
            print_status "Restarting $APP_NAME..."
            pm2 restart "$APP_NAME" --update-env 2>/dev/null || {
                print_warning "App not running, starting fresh..."
                cd "$SCRIPT_DIR"
                pm2 start "$APP_ENTRY" --name "$APP_NAME" --log "$PM2_LOG_FILE" --time
            }
            pm2 save
            pm2 list
            ;;
        status)
            check_pm2
            pm2 describe "$APP_NAME" 2>/dev/null || print_warning "App not registered in PM2"
            ;;
        logs)
            check_pm2
            pm2 logs "$APP_NAME" --lines 100
            ;;
        monitor|monit)
            check_pm2
            pm2 monit
            ;;
        vpn)
            show_vpn_details
            ;;
        check-ip)
            if [[ -f "$SCRIPT_DIR/scripts/check-ip-change.sh" ]]; then
                "$SCRIPT_DIR/scripts/check-ip-change.sh"
            else
                print_error "IP check script not found"
                exit 1
            fi
            ;;
        -h|--help|help)
            show_usage
            ;;
        *)
            print_error "Unknown command: $command"
            show_usage
            exit 1
            ;;
    esac
}

main "$@"

