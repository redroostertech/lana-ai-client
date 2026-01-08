# macOS Production Server Settings

This document describes the production server settings configured by the deployment script to ensure 24/7 reliability for LanaAI.

## Overview

The deployment script (`deploy-prod-mac.sh`) automatically calls `scripts/configure-production-settings.sh` to configure your Mac Mini/Studio for production server use. The production settings script can also be run independently on an existing system.

## Applied Settings

### 1. Power Management

**Goal**: Prevent the system from sleeping while maintaining energy efficiency.

| Setting | Command | Description |
|---------|---------|-------------|
| System Sleep | `pmset -a sleep 0` | Never sleep the system |
| Display Sleep | `pmset -a displaysleep 10` | Turn off display after 10 min (saves power) |
| Disk Sleep | `pmset -a disksleep 0` | Never sleep hard drives |
| Power Nap | `pmset -a powernap 0` | Disable Power Nap |
| Standby | `pmset -a standby 0` | Disable standby mode |
| Auto Power Off | `pmset -a autopoweroff 0` | Disable automatic power off |
| Hibernation | `pmset -a hibernatemode 0` | Disable hibernation |
| Wake on LAN | `pmset -a womp 1` | Enable Wake-on-LAN |

**Verification**:
```bash
pmset -g
```

### 2. Auto-Restart Configuration

**Goal**: Automatically recover from power failures and system crashes.

| Setting | Command | Description |
|---------|---------|-------------|
| Auto Restart | `pmset -a autorestart 1` | Restart after power failure |
| Restart on Power Failure | `systemsetup -setrestartpowerfailure on` | System-level restart config |
| Restart on Freeze | `systemsetup -setrestartfreeze on` | Restart if system freezes |
| No Wait After Power Loss | `systemsetup -setwaitforstartupafterpowerfailure 0` | Boot immediately |

**Verification**:
```bash
systemsetup -getrestartpowerfailure
systemsetup -getrestartfreeze
pmset -g | grep autorestart
```

### 3. Remote Access

**Goal**: Enable secure remote management.

| Setting | Command | Description |
|---------|---------|-------------|
| SSH | `systemsetup -setremotelogin on` | Enable SSH access |

**Usage**:
```bash
# From another machine on the network:
ssh yourusername@hostname.local

# Check if SSH is enabled:
systemsetup -getremotelogin
```

### 4. Software Updates

**Goal**: Prevent unexpected reboots from automatic updates.

| Setting | Command | Description |
|---------|---------|-------------|
| Disable Auto Updates | `softwareupdate --schedule off` | Manual update control |

**Best Practice**: Check for updates monthly during scheduled maintenance windows.

**Check for updates manually**:
```bash
softwareupdate --list
sudo softwareupdate --install --all
```

### 5. Time Configuration

**Goal**: Ensure accurate timestamps in logs and databases.

| Setting | Command | Description |
|---------|---------|-------------|
| Network Time | `systemsetup -setusingnetworktime on` | Auto-sync with NTP servers |

**Verification**:
```bash
systemsetup -getusingnetworktime
systemsetup -gettimezone
```

### 6. System Limits

**Goal**: Support high-concurrency database and API operations.

| Setting | Command | Description |
|---------|---------|-------------|
| File Descriptors | `launchctl limit maxfiles 65536 200000` | Increase max open files |

**Verification**:
```bash
launchctl limit maxfiles
ulimit -n
```

### 7. User Interface

**Goal**: Minimize user interaction and dialogs on a headless server.

| Setting | Command | Description |
|---------|---------|-------------|
| Screen Saver | `defaults -currentHost write com.apple.screensaver idleTime 0` | Disable screen saver |
| Crash Dialogs | `defaults write com.apple.CrashReporter DialogType none` | Log crashes silently |
| Time Machine Prompts | `tmutil disable` | Disable backup prompts |

### 8. Firewall Configuration

The script checks firewall status but does not modify it automatically for security reasons.

**Required Ports for LanaAI**:
- `8080` - LanaAI App (HTTP API)
- `9000` - MinIO API
- `9001` - MinIO Console
- `11434` - Ollama LLM
- `8000` - Unstructured.io
- `5432` - PostgreSQL (localhost only, no external access needed)

**Configure Firewall** (if enabled):
```bash
# Check firewall status
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

# Via System Settings:
# System Settings > Network > Firewall > Options
# Add each service to allowed applications list
```

## Manual Configuration Scripts

### Apply All Production Settings

Run this on an existing Mac to apply all production settings:

```bash
sudo ./scripts/configure-production-settings.sh
```

### Individual Setting Commands

#### Disable Sleep
```bash
sudo pmset -a sleep 0
sudo pmset -a disksleep 0
sudo pmset -a displaysleep 10
```

#### Enable Auto-Restart
```bash
sudo pmset -a autorestart 1
sudo systemsetup -setrestartpowerfailure on
sudo systemsetup -setrestartfreeze on
```

#### Enable SSH
```bash
sudo systemsetup -setremotelogin on
```

#### Disable Auto Updates
```bash
sudo softwareupdate --schedule off
```

#### Enable Network Time
```bash
sudo systemsetup -setusingnetworktime on
```

## Monitoring & Maintenance

### Daily Checks
```bash
# Check service status
pm2 status
launchctl list | grep com.lana

# Check disk space
df -h

# Check system logs
tail -f ~/Library/Logs/LanaAI/*.log
```

### Weekly Checks
```bash
# Review logs for errors
cat ~/Library/Logs/LanaAI/*.error.log

# Check PostgreSQL status
psql -d lana_chef -c "SELECT version();"

# Verify MinIO health
curl http://localhost:9000/minio/health/live
```

### Monthly Maintenance
```bash
# Check for system updates
softwareupdate --list

# Review disk usage
du -sh ~/minio-data
du -sh ~/.ollama/models

# Backup database
pg_dump lana_chef > backup_$(date +%Y%m%d).sql
```

## Troubleshooting

### System Still Sleeping

Check power assertions:
```bash
pmset -g assertions
```

Look for processes preventing sleep. If system still sleeps:
```bash
sudo pmset -a sleep 0 displaysleep 0 disksleep 0
```

### Services Not Starting After Reboot

Check LaunchAgent status:
```bash
launchctl list | grep com.lana
```

Reload services:
```bash
launchctl unload ~/Library/LaunchAgents/com.lana.*.plist
launchctl load ~/Library/LaunchAgents/com.lana.*.plist
```

Check PM2:
```bash
pm2 startup launchd
pm2 save
```

### Auto-Restart Not Working

Verify settings:
```bash
pmset -g | grep autorestart
systemsetup -getrestartpowerfailure
```

Test by simulating power loss (if safe to do so):
1. Connect to system via SSH
2. Monitor with `uptime`
3. Safely test restart behavior

### High File Descriptor Usage

Check current usage:
```bash
lsof | wc -l
launchctl limit maxfiles
```

Increase limits further if needed:
```bash
sudo launchctl limit maxfiles 131072 262144
```

## Best Practices

### 1. UPS (Uninterruptible Power Supply)
- **Critical**: Protects against power outages
- **Recommendation**: APC or CyberPower with network management
- **Capacity**: Enough for 10-15 minutes runtime
- **Configure**: Auto-shutdown scripts if battery runs low

### 2. Network Configuration
- **Static IP**: Assign via router DHCP reservation
- **DNS**: Use reliable DNS servers (8.8.8.8, 1.1.1.1)
- **Hostname**: Set descriptive hostname for easy identification

```bash
# Set hostname
sudo scutil --set ComputerName "lana-production"
sudo scutil --set HostName "lana-production"
sudo scutil --set LocalHostName "lana-production"
```

### 3. Monitoring & Alerts
- **Uptime Monitoring**: UptimeRobot, Pingdom, or similar
- **Log Monitoring**: Centralized logging (syslog, Papertrail)
- **Resource Alerts**: CPU, RAM, disk space thresholds
- **Service Alerts**: Email/SMS when services go down

### 4. Backup Strategy
- **Database**: Daily PostgreSQL dumps
- **Configuration**: Version control for .env and configs
- **Storage**: Regular MinIO bucket backups
- **Testing**: Verify backups can be restored

### 5. Security
- **SSH Keys**: Use key-based authentication, disable password auth
- **Firewall**: Enable and configure properly
- **Updates**: Monthly review and testing
- **Access Control**: Limit SSH access to known IPs if possible

### 6. Documentation
- Keep a runbook with:
  - Common troubleshooting steps
  - Service restart procedures
  - Backup/restore procedures
  - Contact information for escalation
  - Network topology and credentials

## Verification Checklist

After running the deployment script, verify:

- [ ] System does not sleep (`pmset -g`)
- [ ] Auto-restart enabled (`systemsetup -getrestartpowerfailure`)
- [ ] SSH accessible (`ssh localhost`)
- [ ] All services running (`pm2 status` and `launchctl list | grep com.lana`)
- [ ] Network time sync enabled (`systemsetup -getusingnetworktime`)
- [ ] File descriptor limits increased (`launchctl limit maxfiles`)
- [ ] Firewall configured (if enabled)
- [ ] Logs directory exists (`ls ~/Library/Logs/LanaAI`)
- [ ] External storage mounted (if configured)

## Reverting Settings

If you need to revert to standard macOS power settings:

```bash
# Re-enable sleep (1 hour)
sudo pmset -a sleep 60
sudo pmset -a displaysleep 10
sudo pmset -a disksleep 10

# Disable auto-restart
sudo pmset -a autorestart 0
sudo systemsetup -setrestartpowerfailure off

# Re-enable auto updates
sudo softwareupdate --schedule on

# Disable SSH
sudo systemsetup -setremotelogin off
```

## Support

For issues with production settings:
1. Check logs: `~/Library/Logs/LanaAI/`
2. Verify settings with verification commands above
3. Review system logs: Console.app
4. Check LanaAI documentation: `/docs`

---

**Last Updated**: 2024-12-10
**Compatible With**: macOS 13 (Ventura) and later
**Tested On**: Mac Studio M3, Mac Mini M3
