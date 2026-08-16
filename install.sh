#!/bin/bash
# ============================================================================
# Lana AI Client CLI Installer
# ============================================================================
# Installs the lana-client CLI globally on this machine.
#
#   ./install.sh
#
# What it does:
#   - Verifies Node.js 18+, npm, git, gh
#   - Creates ~/.lana-client/credentials skeleton (chmod 600) if missing
#   - Installs the CLI globally:        npm install -g ./cli
#   - Verifies the binary is on PATH
#
# What it does NOT do:
#   - Fill in your credentials (edit ~/.lana-client/credentials yourself)
#   - Build or release anything
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="${SCRIPT_DIR}/cli"
CREDS_DIR="${HOME}/.lana-client"
CREDS_PATH="${CREDS_DIR}/credentials"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
    echo ""
    echo -e "${BLUE}=================================================${NC}"
    echo -e "${BLUE}  Lana AI Client CLI Installer${NC}"
    echo -e "${BLUE}=================================================${NC}"
    echo ""
}

print_step() { echo -e "${GREEN}[+]${NC} $1"; }
print_warn() { echo -e "${YELLOW}[!]${NC} $1"; }
print_err()  { echo -e "${RED}[ERROR]${NC} $1" >&2; }

check_node() {
    if ! command -v node >/dev/null 2>&1; then
        print_err "node is not installed (required: 18+)"
        exit 1
    fi
    local major
    major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
    if [ "${major}" -lt 18 ]; then
        print_err "node ${major} found; 18+ required"
        exit 1
    fi
    print_step "node $(node -v)"
}

check_npm() {
    if ! command -v npm >/dev/null 2>&1; then
        print_err "npm is not installed"
        exit 1
    fi
    print_step "npm $(npm -v)"
}

check_git() {
    if ! command -v git >/dev/null 2>&1; then
        print_err "git is not installed"
        exit 1
    fi
    print_step "git $(git --version | awk '{print $3}')"
}

check_gh() {
    if command -v gh >/dev/null 2>&1; then
        print_step "gh $(gh --version | head -1 | awk '{print $3}')"
    else
        print_warn "gh CLI not installed — required for 'generate builds --publish' (install: brew install gh)"
    fi
}

ensure_credentials() {
    if [ ! -d "${CREDS_DIR}" ]; then
        mkdir -p "${CREDS_DIR}"
        chmod 700 "${CREDS_DIR}"
    fi
    if [ ! -f "${CREDS_PATH}" ]; then
        cat > "${CREDS_PATH}" <<'EOF'
# lana-client credentials — chmod 600
# Apple Developer (required for mac signing/notarization)
APPLE_TEAM_ID=
APPLE_ID=
APPLE_APP_SPECIFIC_PASSWORD=

# GitHub (optional — falls back to gh auth)
GITHUB_TOKEN=

# Release email To: line (optional, may be left blank)
RELEASE_EMAIL_TO=
EOF
        chmod 600 "${CREDS_PATH}"
        print_step "Created ${CREDS_PATH} (fill in before running 'generate builds')"
    else
        chmod 600 "${CREDS_PATH}"
        print_step "Using existing ${CREDS_PATH}"
    fi
}

install_cli() {
    print_step "Installing CLI globally from ${CLI_DIR}…"
    cd "${CLI_DIR}"
    if [ ! -d node_modules ]; then
        npm install
    fi
    if npm install -g . >/dev/null 2>&1; then
        :
    else
        print_warn "npm install -g . failed without sudo; retrying with sudo"
        sudo npm install -g .
    fi
    cd "${SCRIPT_DIR}"
}

# ============================================================================
# lana-ai:// protocol handler (dev + live)
#
# macOS LaunchServices won't reliably route lana-ai:// to a dev Electron app:
# the generic Electron bundle id can point at the wrong Electron process or
# launch a bare Electron welcome screen. Packaged production builds own the
# scheme through electron-builder. For development, install one small .app
# helper as the default handler. It prefers a running packaged Lana app, and
# otherwise launches this checkout's Electron entry with the deep-link URL so
# requestSingleInstanceLock delivers it to the running dev app when present.
#
# Skipped on non-macOS. Idempotent.
# ============================================================================
install_dev_url_handler() {
    if [ "$(uname -s)" != "Darwin" ]; then
        return 0
    fi

    local handler_dir="${HOME}/.lana-client"
    local handler_app="${handler_dir}/LanaAIDevHelper.app"
    local applescript_src="${handler_dir}/_lana-ai-helper.applescript"
    local plist="${handler_app}/Contents/Info.plist"

    # Sanity-check that osacompile, PlistBuddy, and lsregister exist
    if ! command -v osacompile >/dev/null 2>&1; then
        print_warn "osacompile not found; skipping dev URL handler install"
        return 0
    fi
    if [ ! -x "/usr/libexec/PlistBuddy" ]; then
        print_warn "PlistBuddy not found; skipping dev URL handler install"
        return 0
    fi
    local lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
    if [ ! -x "${lsregister}" ]; then
        print_warn "lsregister not found; skipping dev URL handler install"
        return 0
    fi

    print_step "Installing lana-ai:// URL handler (dev + live)…"

    local dev_electron="${SCRIPT_DIR}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
    local dev_entry="${SCRIPT_DIR}/electron-main.js"

    if [ ! -x "${dev_electron}" ]; then
        print_warn "Electron binary not found at ${dev_electron}; run npm install before installing the dev URL handler"
        return 0
    fi

    # Write the AppleScript handler. macOS delivers a GetURL Apple Event to
    # this helper. Production installs normally own lana-ai:// directly; this
    # helper is for dev installs and machines that switch between dev/live.
    cat > "${applescript_src}" <<APPLESCRIPT
on open location URL_arg
    set prodId to "com.redroostertech.lana-ai-client"
    set devElectron to "${dev_electron}"
    set devEntry to "${dev_entry}"
    tell application "System Events"
        set prodRunning to (exists (processes whose bundle identifier is prodId))
    end tell
    if prodRunning then
        try
            tell application id prodId to open location URL_arg
            return
        end try
    end if
    do shell script "nohup " & quoted form of devElectron & " " & quoted form of devEntry & " " & quoted form of URL_arg & " >/dev/null 2>&1 &"
end open location
APPLESCRIPT

    # Compile the AppleScript into a .app bundle
    rm -rf "${handler_app}"
    if ! osacompile -o "${handler_app}" "${applescript_src}" >/dev/null 2>&1; then
        print_warn "osacompile failed; skipping dev URL handler install"
        rm -f "${applescript_src}"
        return 0
    fi

    # Stable bundle identifier — required so we can set this app as the
    # *default* handler (not just one of many registered handlers) for
    # lana-ai:// via LSSetDefaultHandlerForURLScheme below.
    local helper_bundle_id="com.redroostertech.lana-ai.dev-helper"
    /usr/libexec/PlistBuddy -c "Delete :CFBundleIdentifier" "${plist}" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string ${helper_bundle_id}" "${plist}"

    # Add CFBundleURLTypes so macOS knows this app handles lana-ai:// URLs.
    # Drop any pre-existing entry first so re-runs are idempotent.
    /usr/libexec/PlistBuddy -c "Delete :CFBundleURLTypes" "${plist}" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "${plist}"
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "${plist}"
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string Lana AI" "${plist}"
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "${plist}"
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string lana-ai" "${plist}"

    # Hide from the dock when triggered
    /usr/libexec/PlistBuddy -c "Delete :LSUIElement" "${plist}" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "${plist}"

    # The .app was code-signed by osacompile against the *original* plist.
    # Re-sign now that we've changed CFBundleIdentifier / CFBundleURLTypes,
    # otherwise lsregister may refuse to register it (Gatekeeper kVErrorMisc).
    if command -v codesign >/dev/null 2>&1; then
        codesign --force --deep --sign - "${handler_app}" >/dev/null 2>&1 || true
    fi

    # Re-register with LaunchServices so macOS picks up the new bundle ID
    # and CFBundleURLTypes.
    "${lsregister}" -f "${handler_app}" >/dev/null 2>&1 || true

    # Set the helper as the *default* handler for lana-ai://. lsregister only
    # lists it as a candidate; LSSetDefaultHandlerForURLScheme is what makes
    # macOS actually route the URL to it instead of the stale npx Electron.
    if command -v swift >/dev/null 2>&1; then
        swift - <<SWIFT >/dev/null 2>&1 || true
import Foundation
import CoreServices
let result = LSSetDefaultHandlerForURLScheme("lana-ai" as CFString, "${helper_bundle_id}" as CFString)
exit(result == 0 ? 0 : 1)
SWIFT
        if [ $? -eq 0 ]; then
            print_step "lana-ai:// is now routed through the dev helper"
        else
            print_warn "Could not set dev helper as default lana-ai:// handler. Run: ./install.sh again, or set manually."
        fi
    else
        print_warn "swift CLI not available — cannot programmatically set lana-ai:// default handler."
        print_warn "Install Xcode Command Line Tools: xcode-select --install"
    fi

    rm -f "${applescript_src}"
    print_step "Dev URL handler installed: ${handler_app}"
}

verify_install() {
    if command -v lana-client >/dev/null 2>&1; then
        print_step "Installed: lana-client $(lana-client --version)"
    else
        print_err "lana-client not found on PATH after install"
        print_err "Check that npm's global bin is on your PATH: $(npm config get prefix)/bin"
        exit 1
    fi
}

print_next_steps() {
    echo ""
    echo "Done. Next:"
    echo "  1. Edit ${CREDS_PATH} and fill in your Apple credentials"
    echo "  2. Try: lana-client --help"
    echo "  3. Run dev:           lana-client run dev"
    echo "  4. Cut a release:     lana-client prepare release"
    echo "                        lana-client generate builds --publish"
    echo "                        lana-client finish release"
    echo ""
}

main() {
    print_header
    if [ "${INSTALL_DEV_URL_HANDLER_ONLY:-}" = "1" ]; then
        install_dev_url_handler
        return 0
    fi
    check_node
    check_npm
    check_git
    check_gh
    ensure_credentials
    install_cli
    install_dev_url_handler
    verify_install
    print_next_steps
}

main "$@"
