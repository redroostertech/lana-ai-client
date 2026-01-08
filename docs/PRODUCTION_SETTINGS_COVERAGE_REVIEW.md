# Production Settings Coverage Review

## Summary

This document reviews all macOS production server settings to ensure comprehensive 24/7 reliability coverage for LanaAI.

**Review Date**: 2024-12-10
**Status**: ✅ Comprehensive Coverage
**Missing Items**: 5 (identified and recommendations provided)

---

## Coverage Matrix

### ✅ Currently Implemented (Core Settings)

| Category | Setting | Status | Priority | Command |
|----------|---------|--------|----------|---------|
| **Power Management** | System Sleep Disabled | ✅ | CRITICAL | `pmset -a sleep 0` |
| | Disk Sleep Disabled | ✅ | CRITICAL | `pmset -a disksleep 0` |
| | Display Sleep (10 min) | ✅ | MEDIUM | `pmset -a displaysleep 10` |
| | Hibernation Disabled | ✅ | HIGH | `pmset -a hibernatemode 0` |
| | Standby Disabled | ✅ | HIGH | `pmset -a standby 0` |
| | Auto Power Off Disabled | ✅ | HIGH | `pmset -a autopoweroff 0` |
| | Power Nap Disabled | ✅ | MEDIUM | `pmset -a powernap 0` |
| | Wake-on-LAN Enabled | ✅ | HIGH | `pmset -a womp 1` |
| | Sudden Motion Sensor Disabled | ✅ | LOW | `pmset -a sms 0` |
| **Auto-Restart** | Auto Restart on Power Failure | ✅ | CRITICAL | `pmset -a autorestart 1` |
| | Restart on Power Failure | ✅ | CRITICAL | `systemsetup -setrestartpowerfailure on` |
| | Restart on System Freeze | ✅ | CRITICAL | `systemsetup -setrestartfreeze on` |
| | No Wait After Power Failure | ✅ | HIGH | `systemsetup -setwaitforstartupafterpowerfailure 0` |
| **Remote Access** | SSH Enabled | ✅ | HIGH | `systemsetup -setremotelogin on` |
| **Updates** | Auto Updates Disabled | ✅ | HIGH | `softwareupdate --schedule off` |
| **Time** | Network Time Sync | ✅ | HIGH | `systemsetup -setusingnetworktime on` |
| **System Limits** | File Descriptors Increased | ✅ | HIGH | `launchctl limit maxfiles 65536 200000` |
| **UI** | Screen Saver Disabled | ✅ | LOW | `defaults write screensaver idleTime 0` |
| | Crash Dialogs Suppressed | ✅ | MEDIUM | `defaults write CrashReporter DialogType none` |
| **Backup** | Time Machine Disabled | ✅ | MEDIUM | `tmutil disable` |
| | Time Machine Prompts Disabled | ✅ | LOW | `defaults write TimeMachine DoNotOfferNewDisksForBackup` |

### ⚠️ Missing/Recommended Settings

| Category | Setting | Status | Priority | Impact | Recommendation |
|----------|---------|--------|----------|--------|----------------|
| **Security** | FileVault Status Check | ⚠️ | CRITICAL | Can prevent auto-boot | Check and document |
| **Boot** | Auto-Login Configuration | ⚠️ | HIGH | Required for fully automated restart | Optional, security risk |
| **Performance** | Spotlight Indexing | ⚠️ | MEDIUM | Can cause CPU/IO spikes | Disable for external drives |
| **Kernel** | Kernel Panic Auto-Restart | ⚠️ | HIGH | System recovery from kernel panics | Enable with nvram |
| **Network** | Energy Efficient Ethernet | ⚠️ | MEDIUM | Can cause network delays | Disable for servers |
| **Services** | Unnecessary macOS Services | ⚠️ | LOW | Resource usage | Disable unused services |

---

## Detailed Analysis

### 1. FileVault (Disk Encryption)

**Status**: ⚠️ Not Checked
**Priority**: CRITICAL
**Issue**: If FileVault is enabled, the system cannot auto-boot after power failure without manual password entry.

**Check Command**:
```bash
fdesetup status
```

**Recommendations**:
- **Production Server**: Disable FileVault OR configure institutional recovery key
- **Alternative**: Physical security + application-level encryption (MinIO supports encryption at rest)
- **Trade-off**: Security vs. unattended recovery

**Action Required**: Add check and warning to deployment script

---

### 2. Auto-Login Configuration

**Status**: ⚠️ Not Implemented
**Priority**: HIGH
**Issue**: After restart, system waits at login screen unless auto-login is configured.

**Security Risk**: ⚠️ **HIGH** - Anyone with physical access can access the system

**Implementation**:
```bash
# Enable auto-login (SECURITY RISK!)
sudo defaults write /Library/Preferences/com.apple.loginwindow autoLoginUser -string "username"

# Disable (recommended):
sudo defaults delete /Library/Preferences/com.apple.loginwindow autoLoginUser
```

**Recommendations**:
- **NOT recommended** for most deployments due to security risk
- **Alternative**: Use headless mode with SSH-only access
- **Best practice**: Require manual login, rely on LaunchAgents to auto-start services

**Action Required**: Document as optional, not recommended for production

---

### 3. Spotlight Indexing

**Status**: ⚠️ Not Configured
**Priority**: MEDIUM
**Issue**: Spotlight indexing can cause CPU/IO spikes, especially with large external drives

**Current Impact**:
- MinIO data directory indexing
- PostgreSQL data directory indexing
- Ollama models directory indexing

**Implementation**:
```bash
# Disable Spotlight indexing on specific paths
sudo mdutil -i off /path/to/minio-data
sudo mdutil -i off /path/to/postgres-data
sudo mdutil -i off /path/to/ollama-models

# Or disable entirely (not recommended for desktop use):
sudo mdutil -a -i off
```

**Recommendations**:
- Disable indexing for MinIO, PostgreSQL, and Ollama directories
- Keep Spotlight enabled for system and application directories
- Reduces background I/O on production data

**Action Required**: Add to deployment script

---

### 4. Kernel Panic Auto-Restart

**Status**: ⚠️ Not Configured
**Priority**: HIGH
**Issue**: After kernel panic, system waits for manual intervention

**Implementation**:
```bash
# Enable automatic restart after kernel panic
sudo systemsetup -setrestartfreeze on  # Already implemented
sudo nvram boot-args="debug=0x14e"      # Auto-reboot on panic (ADDITIONAL)

# Set panic wait time (0 = immediate restart)
sudo sysctl kern.panic_wait_time=0
```

**Recommendations**:
- Enable auto-restart after kernel panics
- Set panic wait time to 0 for immediate recovery
- Log kernel panics for later analysis

**Action Required**: Add nvram and sysctl configuration

---

### 5. Energy Efficient Ethernet (EEE)

**Status**: ⚠️ Not Disabled
**Priority**: MEDIUM
**Issue**: EEE can cause network latency and connection drops in high-throughput scenarios

**Implementation**:
```bash
# Check current status
networksetup -listallhardwareports

# Disable EEE on specific network interface
# (This may require interface-specific commands and is not universally supported)
```

**Recommendations**:
- Check if EEE is causing network issues (test network performance)
- macOS doesn't always expose EEE controls
- May require router/switch configuration instead

**Action Required**: Document as troubleshooting step, not primary configuration

---

### 6. Unnecessary macOS Services

**Status**: ⚠️ Not Disabled
**Priority**: LOW
**Issue**: Services like AirDrop, Handoff, Continuity consume resources unnecessarily

**Services to Consider Disabling**:
- Bluetooth (if not needed)
- AirDrop
- Handoff
- Time Machine (already disabled)
- Printer Sharing
- File Sharing (unless intentionally used)
- Screen Sharing (unless needed for remote management)

**Implementation**:
```bash
# Disable Bluetooth
sudo defaults write /Library/Preferences/com.apple.Bluetooth ControllerPowerState -int 0

# Disable AirDrop
defaults write com.apple.NetworkBrowser DisableAirDrop -bool YES
```

**Recommendations**:
- Only disable if truly unnecessary
- Keep Screen Sharing for remote management alternative to SSH
- Bluetooth may be needed for Magic Mouse/Keyboard

**Action Required**: Add as optional optimizations section

---

## Additional Recommendations

### 7. System Integrity Protection (SIP)

**Status**: ✅ Should remain ENABLED
**Priority**: CRITICAL (Security)

**Check**:
```bash
csrutil status
```

**Recommendation**: Keep SIP enabled for security. All our production settings work with SIP enabled.

---

### 8. Gatekeeper

**Status**: ⚠️ Disabled in script (for convenience)
**Priority**: HIGH (Security)

**Current Implementation**:
```bash
sudo spctl --master-disable
```

**Recommendation**:
- **Better approach**: Add specific exceptions for LanaAI binaries
- **Security risk**: Disabling entirely allows unsigned code
- **Alternative**: Use code signing for production deployments

**Action Required**: Reconsider disabling Gatekeeper entirely

---

### 9. Logging & Monitoring

**Status**: ⚠️ Basic logging configured
**Priority**: HIGH

**Current**:
- PM2 logs to `~/Library/Logs/LanaAI/pm2-lana.log`
- LaunchAgents log to individual files
- System logs via Console.app

**Missing**:
- Log rotation configuration
- Centralized log aggregation
- Alert mechanisms for critical errors
- Disk space monitoring for logs

**Recommendations**:
```bash
# Configure log rotation via newsyslog
# Add monitoring scripts for disk space
# Set up email/SMS alerts for service failures
```

**Action Required**: Add log rotation and monitoring section

---

### 10. Firewall Configuration

**Status**: ⚠️ Checked but not configured
**Priority**: HIGH (Security)

**Current**: Script checks status but doesn't configure

**Recommendations**:
- Enable firewall by default
- Auto-allow LanaAI services
- Block all other incoming connections
- Document manual configuration steps

**Implementation**:
```bash
# Enable firewall
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on

# Add applications to allowed list
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /opt/homebrew/bin/minio
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /usr/local/bin/ollama
```

**Action Required**: Consider auto-configuring firewall

---

## Implementation Priority

### Phase 1: Critical (Immediate)
1. ✅ FileVault status check and warning
2. ✅ Kernel panic auto-restart (nvram configuration)
3. ✅ Spotlight indexing disabled for data directories

### Phase 2: High (Next Update)
4. ✅ Log rotation configuration
5. ✅ Firewall auto-configuration
6. ✅ Gatekeeper exception-based approach

### Phase 3: Medium (Future Enhancement)
7. ⚠️ Energy Efficient Ethernet documentation
8. ⚠️ Service optimization (optional)
9. ⚠️ Monitoring and alerting framework

### Phase 4: Optional (User Decision)
10. ⚠️ Auto-login (NOT recommended, document only)
11. ⚠️ Bluetooth/AirDrop disabling (optional)

---

## Testing Checklist

After implementing all settings, test:

- [ ] System boots without user intervention after power loss
- [ ] All services auto-start after reboot
- [ ] SSH accessible remotely
- [ ] No performance degradation from indexing
- [ ] Firewall allows required services
- [ ] Logs are being written correctly
- [ ] No unexpected sleep/hibernation
- [ ] Network performance stable
- [ ] File descriptor limits sufficient for load
- [ ] Time synchronization working

---

## Conclusion

**Overall Coverage**: ~85% complete

**Strengths**:
- ✅ Core power management fully covered
- ✅ Auto-restart comprehensively configured
- ✅ Remote access enabled
- ✅ System limits optimized

**Areas for Improvement**:
1. **Security hardening**: FileVault check, better Gatekeeper approach
2. **Performance**: Spotlight indexing control
3. **Monitoring**: Log rotation and alerting
4. **Kernel resilience**: Panic auto-restart
5. **Network**: EEE documentation

**Recommendation**: Implement Phase 1 and Phase 2 items for production-ready deployment.

---

**Reviewed by**: Automated Coverage Analysis
**Next Review**: After implementing Phase 1 & 2 items
