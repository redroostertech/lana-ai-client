@preconcurrency import CoreBluetooth
import Foundation

// LANA desktop BLE wake helper.
//
// Protocol (one JSON object per line):
//   stdin  {"cmd":"advertise","uuids":["<UUID>", ...]}   advertise exactly these services (empty: stop)
//          {"cmd":"stop"}                                 stop advertising
//          {"cmd":"quit"}                                 stop and exit
//   stdout {"event":"state","state":"powered_on|powered_off|unauthorized|unsupported|resetting|unknown"}
//          {"event":"advertising","count":N}             N services on air (0: stopped)
//          {"event":"error","message":"..."}
//
// It holds no keys: the main process derives the per-phone wake UUIDs and passes only those.
// When stdin closes (the app quit or crashed) it stops advertising and exits.

@MainActor
final class WakeAdvertiser: NSObject, CBPeripheralManagerDelegate {
    private var manager: CBPeripheralManager?
    private var wanted: [CBUUID] = []

    func start() {
        manager = CBPeripheralManager(delegate: self, queue: .main)
    }

    func advertise(_ uuids: [CBUUID]) {
        wanted = uuids
        apply()
    }

    func stop() {
        wanted = []
        apply()
    }

    private func apply() {
        guard let manager, manager.state == .poweredOn else { return }
        manager.stopAdvertising()
        manager.removeAllServices()
        guard !wanted.isEmpty else {
            emit(["event": "advertising", "count": 0])
            return
        }
        for uuid in wanted { manager.add(CBMutableService(type: uuid, primary: true)) }
        manager.startAdvertising([CBAdvertisementDataServiceUUIDsKey: wanted])
    }

    nonisolated func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        let state = peripheral.state
        MainActor.assumeIsolated {
            emit(["event": "state", "state": Self.name(state)])
            if state == .poweredOn { apply() }
        }
    }

    nonisolated func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        MainActor.assumeIsolated {
            if let error {
                emit(["event": "error", "message": "advertising failed: \((error as NSError).code)"])
            } else {
                emit(["event": "advertising", "count": wanted.count])
            }
        }
    }

    private static func name(_ state: CBManagerState) -> String {
        switch state {
        case .poweredOn: "powered_on"
        case .poweredOff: "powered_off"
        case .unauthorized: "unauthorized"
        case .unsupported: "unsupported"
        case .resetting: "resetting"
        default: "unknown"
        }
    }
}

@MainActor
func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return }
    FileHandle.standardOutput.write(data + Data([0x0A]))
}

@MainActor
func handle(_ line: String, advertiser: WakeAdvertiser) {
    guard let object = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any], let command = object["cmd"] as? String else {
        emit(["event": "error", "message": "bad command"])
        return
    }
    switch command {
    case "advertise":
        let strings = object["uuids"] as? [String] ?? []
        let uuids = strings.compactMap { UUID(uuidString: $0) }.map { CBUUID(nsuuid: $0) }
        guard uuids.count == strings.count else {
            emit(["event": "error", "message": "bad uuid"])
            return
        }
        advertiser.advertise(uuids)
    case "stop":
        advertiser.stop()
    case "quit":
        advertiser.stop()
        exit(0)
    default:
        emit(["event": "error", "message": "unknown command"])
    }
}

let advertiser = MainActor.assumeIsolated { WakeAdvertiser() }
MainActor.assumeIsolated { advertiser.start() }

// Read stdin on a background thread; hop to the main actor per line. EOF: stop and exit.
Thread.detachNewThread {
    while let line = readLine(strippingNewline: true) {
        let text = line
        DispatchQueue.main.async { MainActor.assumeIsolated { handle(text, advertiser: advertiser) } }
    }
    DispatchQueue.main.async {
        MainActor.assumeIsolated { advertiser.stop() }
        exit(0)
    }
}

RunLoop.main.run()
