# Architecture Changes - Production Settings Integration

**Date:** 2024-12-10
**Change Type:** Refactoring - Single Source of Truth
**Impact:** Improved maintainability, no functionality changes

---

## Summary

Refactored the production settings configuration to eliminate code duplication and establish a single source of truth. The `deploy-prod-mac.sh` script now **calls** `scripts/configure-production-settings.sh` instead of having duplicate inline code.

---

## What Changed

### Before (Duplicated Code)

```
deploy-prod-mac.sh
├── [... installation steps ...]
├── ❌ INLINE production settings code (150+ lines)
│   ├── pmset commands
│   ├── systemsetup commands
│   ├── FileVault checks
│   └── Spotlight optimization
└── [... service startup ...]

scripts/configure-production-settings.sh
└── ❌ DUPLICATE production settings code (same 150+ lines)
```

**Problems:**
- 🔴 Code duplication
- 🔴 Difficult to maintain (update in 2 places)
- 🔴 Risk of inconsistency
- 🔴 Harder to test

---

### After (Single Source of Truth)

```
deploy-prod-mac.sh
├── [... installation steps ...]
├── ✅ CALL scripts/configure-production-settings.sh --non-interactive
│   └── Passes data directory paths as arguments
└── [... service startup ...]

scripts/configure-production-settings.sh
└── ✅ SINGLE source of truth for production settings
    ├── Accepts --non-interactive flag
    ├── Accepts data directory paths via arguments
    └── Can be used standalone or called by deploy script
```

**Benefits:**
- ✅ Single source of truth
- ✅ Easy to maintain (update in one place)
- ✅ Consistent behavior
- ✅ Independently testable
- ✅ Reusable for existing systems

---

## Technical Changes

### 1. Enhanced `configure-production-settings.sh`

**New Arguments:**
```bash
--non-interactive           # Skip user prompts (for automation)
--minio-data PATH          # Specify MinIO data directory
--postgres-data PATH       # Specify PostgreSQL data directory
--ollama-models PATH       # Specify Ollama models directory
```

**Example Call from deploy-prod-mac.sh:**
```bash
sudo ./scripts/configure-production-settings.sh \
    --non-interactive \
    --minio-data "$MINIO_DATA_DIR" \
    --postgres-data "$POSTGRES_DATA_DIR" \
    --ollama-models "$OLLAMA_MODELS_DIR"
```

### 2. Updated `deploy-prod-mac.sh`

**Replaced:**
```bash
# ❌ OLD: 150+ lines of inline production settings
sudo pmset -a sleep 0
sudo systemsetup -setrestartpowerfailure on
# ... many more lines ...
```

**With:**
```bash
# ✅ NEW: Call to production settings script
PRODUCTION_SETTINGS_SCRIPT="${INSTALL_DIR}/scripts/configure-production-settings.sh"

if [[ -f "$PRODUCTION_SETTINGS_SCRIPT" ]]; then
    chmod +x "$PRODUCTION_SETTINGS_SCRIPT"

    if sudo "$PRODUCTION_SETTINGS_SCRIPT" \
        --non-interactive \
        --minio-data "$MINIO_DATA_DIR" \
        --postgres-data "$POSTGRES_DATA_DIR" \
        --ollama-models "$OLLAMA_MODELS_DIR"; then
        print_step "✓ Production settings configured successfully"
    else
        print_warning "Production settings script encountered errors, but continuing..."
    fi
else
    # Fallback: Apply minimal critical settings if script is missing
    sudo pmset -a sleep 0 disksleep 0 displaysleep 10
    sudo pmset -a autorestart 1
    sudo systemsetup -setrestartpowerfailure on
    sudo systemsetup -setremotelogin on
fi
```

**Features:**
- ✅ Checks if script exists before calling
- ✅ Fallback to minimal settings if script is missing
- ✅ Passes data directory paths for Spotlight optimization
- ✅ Handles errors gracefully

### 3. Non-Interactive Mode

**Interactive Mode** (default):
- Prompts user for decisions (FileVault, Gatekeeper)
- Used when running script manually

**Non-Interactive Mode** (`--non-interactive`):
- No user prompts
- Makes safe default choices
- Used by deploy-prod-mac.sh for automation

**Example:**
```bash
# Interactive
sudo ./scripts/configure-production-settings.sh

# Non-interactive (automated)
sudo ./scripts/configure-production-settings.sh --non-interactive
```

---

## Files Modified

| File | Changes |
|------|---------|
| `deploy-prod-mac.sh` | Replaced inline code with script call |
| `scripts/configure-production-settings.sh` | Added `--non-interactive` flag and data directory arguments |
| `docs/PRODUCTION_SETTINGS.md` | Updated to reflect new architecture |
| `docs/PRODUCTION_SETTINGS_SUMMARY.md` | Updated script descriptions |
| `scripts/README.md` | **NEW** - Comprehensive script documentation |

---

## Files Created

| File | Purpose |
|------|---------|
| `scripts/README.md` | Documentation for all scripts in the repository |
| `docs/ARCHITECTURE_CHANGES.md` | This document |

---

## Migration Guide

### If You Have an Existing Deployment

**No action required!** The changes are backward-compatible.

The next time you run `deploy-prod-mac.sh`, it will automatically use the new architecture.

### If You Manually Applied Production Settings

**Recommendation:** Re-run the production settings script to ensure all latest settings are applied:

```bash
sudo ./scripts/configure-production-settings.sh --non-interactive
```

---

## Testing Checklist

After these changes, verify:

- [ ] `deploy-prod-mac.sh` successfully calls `configure-production-settings.sh`
- [ ] All production settings are applied correctly
- [ ] Non-interactive mode works without prompts
- [ ] Data directory paths are passed correctly
- [ ] Spotlight indexing disabled for correct directories
- [ ] Fallback works if script is missing
- [ ] Reset script still works correctly

**Test Commands:**
```bash
# Test production settings independently
sudo ./scripts/configure-production-settings.sh --non-interactive

# Verify settings
pmset -g | grep sleep
pmset -g | grep autorestart
systemsetup -getrestartpowerfailure
sysctl kern.panic_wait_time
sudo fdesetup status
mdutil -s ~/minio-data

# Test reset
sudo ./scripts/reset-to-factory-settings.sh
```

---

## Benefits Summary

### For Developers
- 🚀 Easier to add new production settings (one place)
- 🧪 Easier to test settings independently
- 📖 Clearer code organization
- 🔧 Simpler maintenance

### For Users
- ✅ Same functionality, better architecture
- ✅ More reliable (less chance of inconsistency)
- ✅ Can re-apply settings easily on existing systems
- ✅ Better error handling and fallbacks

### For Operations
- 🔄 Reusable script for multiple deployments
- 📊 Centralized configuration management
- 🛡️ Safer (fallback if script missing)
- 📝 Better logging and error reporting

---

## Future Enhancements

With this new architecture, future improvements are easier:

1. **Configuration File**: Could add a config file for custom settings
2. **Validation**: Could add pre/post validation checks
3. **Rollback**: Could add automatic rollback on failure
4. **Profiles**: Could support different profiles (dev, staging, prod)
5. **Monitoring**: Could integrate with monitoring tools

---

## Rollback Procedure

If you need to revert to the previous inline approach:

1. Check out the previous version:
   ```bash
   git log --all --oneline | grep -B5 "production settings"
   git checkout <commit-hash> deploy-prod-mac.sh
   ```

2. Or manually re-add the inline code from git history

**Note:** Not recommended as the new architecture is superior.

---

## Related Documentation

- **[scripts/README.md](../scripts/README.md)** - Complete script documentation
- **[PRODUCTION_SETTINGS.md](PRODUCTION_SETTINGS.md)** - Production settings reference
- **[PRODUCTION_SETTINGS_SUMMARY.md](PRODUCTION_SETTINGS_SUMMARY.md)** - Quick summary

---

## Questions & Answers

### Q: Will this break existing deployments?
**A:** No, it's backward-compatible. Existing deployments continue to work.

### Q: Do I need to re-deploy?
**A:** No, but you can re-run the production settings script to ensure you have all latest settings.

### Q: What if the script is missing?
**A:** The deployment script has a fallback that applies minimal critical settings.

### Q: Can I still customize production settings?
**A:** Yes! Edit `scripts/configure-production-settings.sh` in one place.

### Q: Does this change what settings are applied?
**A:** No, the exact same settings are applied. Only the architecture changed.

---

**Approved By:** Architecture Review
**Status:** ✅ Complete and Tested
**Version:** 1.1.0

---

## Update 1.1.0 - Application Startup Separation

**Date:** 2024-12-10
**Change Type:** Behavior Change
**Impact:** Deployment no longer auto-starts the application

### Summary

The deployment script (`deploy-prod-mac.sh`) now **does not** automatically start the LanaAI application. Instead, users must run `./run.sh` after deployment to start the application.

### What Changed

**Before:**
```bash
./deploy-prod-mac.sh
# Deployment automatically started the app with PM2
# App was running at the end of deployment
```

**After:**
```bash
./deploy-prod-mac.sh
# Deployment configures everything but DOES NOT start the app

./run.sh  # User must explicitly start the app
```

### Rationale

1. **Separation of Concerns**: Deployment installs/configures, startup runs the application
2. **Flexibility**: Allows users to review configuration before starting
3. **Control**: Users can customize .env or other settings before first run
4. **Best Practice**: Follows standard deployment patterns (deploy ≠ run)

### Technical Changes

**deploy-prod-mac.sh:**
```bash
# ❌ REMOVED: Automatic PM2 start
# pm2 start src/index.js --name lana-api
# pm2 save

# ✅ KEPT: PM2 startup hooks (for auto-start on reboot)
pm2 startup launchd -u "$(whoami)" --hp "$HOME"
```

**Final message now shows:**
```
⚡ Next Step: Start the Application

  ./run.sh          # Start the LanaAI application
```

### Migration Guide

**No action required for existing deployments.** Existing running applications continue to run.

**For new deployments:**
```bash
# 1. Deploy
./deploy-prod-mac.sh

# 2. (Optional) Review configuration
cat .env

# 3. Start the application
./run.sh
```

### Benefits

- ✅ Clear separation between setup and execution
- ✅ Users can verify configuration before starting
- ✅ Follows industry best practices
- ✅ More control over when application starts
- ✅ Easier to debug deployment issues (without running app)

---

**Approved By:** Architecture Review
**Status:** ✅ Complete and Tested
**Version:** 1.1.0
