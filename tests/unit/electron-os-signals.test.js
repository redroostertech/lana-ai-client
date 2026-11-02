/**
 * OS signals for the local engine (electron-os-signals.js, phase 8d): the
 * macOS tool outputs are read as printed, and Electron power events become
 * signals; sleep, lid close and quit are urgent (the engine hands off first).
 */

const { EventEmitter } = require('events');
const { createOsSignals, parsePmsetBattery, parsePmsetLowPower, parseClamshell } = require('../../electron-os-signals');

const BATT_BATTERY = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=22610019)\t71%; discharging; 2:07 remaining present: true\n";
const BATT_AC = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=22610019)\t100%; charged; 0:00 remaining present: true\n";

function fakePowerMonitor(onBattery = false) {
  const pm = new EventEmitter();
  pm.battery = onBattery;
  pm.isOnBatteryPower = () => pm.battery;
  return pm;
}

describe('parsers', () => {
  test.each([
    [BATT_BATTERY, { on_mains: false, battery_percent: 71 }],
    [BATT_AC, { on_mains: true, battery_percent: 100 }],
    ["Now drawing from 'AC Power'\n", { on_mains: true, battery_percent: null }],
    ['', { on_mains: null, battery_percent: null }]
  ])('pmset -g batt', (text, expected) => {
    expect(parsePmsetBattery(text)).toEqual(expected);
  });

  test('low power mode and lid state', () => {
    expect(parsePmsetLowPower('System-wide power settings:\n lowpowermode         1\n sleep 1\n')).toBe(true);
    expect(parsePmsetLowPower(' lowpowermode         0\n')).toBe(false);
    expect(parsePmsetLowPower(' sleep 1\n')).toBeNull();
    expect(parseClamshell('      "AppleClamshellState" = Yes\n')).toBe(true);
    expect(parseClamshell('      "AppleClamshellState" = No\n')).toBe(false);
    expect(parseClamshell('')).toBeNull();
  });
});

describe('signals', () => {
  function setup({ outputs = {}, platform = 'darwin', online = true } = {}) {
    const powerMonitor = fakePowerMonitor(true);
    const changes = [];
    const net = { online, isOnline() { return this.online; } };
    const signals = createOsSignals({
      powerMonitor,
      net,
      platform,
      run: async (command, args) => outputs[`${command} ${args.join(' ')}`] || '',
      onChange: (snapshot, meta) => changes.push({ snapshot, urgent: meta.urgent }),
      timers: { setInterval: () => null, clearInterval: () => {} }
    });
    return { signals, powerMonitor, changes, net, outputs };
  }

  test('a first poll reads battery level, low power mode, lid and network', async () => {
    const { signals } = setup({ outputs: { 'pmset -g batt': BATT_BATTERY, 'pmset -g': ' lowpowermode 1\n', 'ioreg -r -k AppleClamshellState -d 1': '"AppleClamshellState" = No' } });
    expect(await signals.start()).toEqual({
      power: { on_mains: false, battery_percent: 71, low_power_mode: true },
      about_to_sleep: false, lid_closed: false, online: true, app_quitting: false
    });
  });

  test('suspend is urgent and sets about_to_sleep; resume clears it; quit (shutdown or markQuitting) is urgent', async () => {
    const { signals, powerMonitor, changes } = setup();
    await signals.start();
    changes.length = 0;
    powerMonitor.emit('suspend');
    expect(changes[0]).toMatchObject({ urgent: true, snapshot: { about_to_sleep: true } });
    powerMonitor.emit('resume');
    expect(changes[1]).toMatchObject({ urgent: false, snapshot: { about_to_sleep: false } });
    powerMonitor.emit('shutdown');
    expect(changes.at(-1)).toMatchObject({ urgent: true, snapshot: { app_quitting: true } });
    expect(signals.markQuitting()).toMatchObject({ app_quitting: true });
  });

  test('plugging in and unplugging change on_mains at once', async () => {
    const { signals, powerMonitor, changes } = setup({ platform: 'win32' });
    await signals.start();
    changes.length = 0;
    powerMonitor.emit('on-ac');
    expect(changes[0].snapshot.power.on_mains).toBe(true);
    powerMonitor.emit('on-battery');
    expect(changes.find((c) => c.snapshot.power.on_mains === false)).toBeDefined();
  });

  test('a lid that closes is urgent; going offline is reported (not urgent); nothing changed means no report', async () => {
    const lid = { 'ioreg -r -k AppleClamshellState -d 1': '"AppleClamshellState" = No' };
    const { signals, changes, net, outputs } = setup({ outputs: lid });
    await signals.start();
    changes.length = 0;
    await signals.poll();
    expect(changes).toEqual([]);
    outputs['ioreg -r -k AppleClamshellState -d 1'] = '"AppleClamshellState" = Yes';
    await signals.poll();
    expect(changes[0]).toMatchObject({ urgent: true, snapshot: { lid_closed: true } });
    net.online = false;
    await signals.poll();
    expect(changes[1]).toMatchObject({ urgent: false, snapshot: { online: false } });
  });

  test('stop removes every power listener', async () => {
    const { signals, powerMonitor } = setup();
    await signals.start();
    signals.stop();
    expect(['suspend', 'resume', 'on-ac', 'on-battery', 'shutdown'].map((e) => powerMonitor.listenerCount(e))).toEqual([0, 0, 0, 0, 0]);
  });
});
