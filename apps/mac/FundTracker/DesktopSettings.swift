import Foundation

enum ApiMode: String {
    case local
    case remote
}

struct WindowBounds: Codable {
    var x: Int?
    var y: Int?
    var width: Int
    var height: Int
}

struct DesktopSettingsFile: Codable {
    var apiMode: String?
    var windowBounds: WindowBounds?
}

enum DesktopSettings {
    private static let appSupportSubpath = "Application Support/@fund-tracker/mac"

    static var supportDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return base.appendingPathComponent("@fund-tracker/mac", isDirectory: true)
    }

    static var settingsURL: URL {
        supportDirectory.appendingPathComponent("desktop-settings.json")
    }

    static var dataDirectory: URL {
        supportDirectory.appendingPathComponent("data", isDirectory: true)
    }

    static func load() -> (apiMode: ApiMode, windowBounds: WindowBounds?) {
        guard FileManager.default.fileExists(atPath: settingsURL.path),
              let data = try? Data(contentsOf: settingsURL),
              let file = try? JSONDecoder().decode(DesktopSettingsFile.self, from: data)
        else {
            return (.local, nil)
        }
        let mode: ApiMode = file.apiMode == ApiMode.remote.rawValue ? .remote : .local
        return (mode, file.windowBounds)
    }

    static func save(apiMode: ApiMode? = nil, windowBounds: WindowBounds? = nil) {
        var current = load()
        if let apiMode { current.apiMode = apiMode }
        if let windowBounds { current.windowBounds = windowBounds }
        let file = DesktopSettingsFile(apiMode: current.apiMode.rawValue, windowBounds: current.windowBounds)
        try? FileManager.default.createDirectory(at: supportDirectory, withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(file) {
            try? data.write(to: settingsURL, options: .atomic)
        }
    }

    static func lanIPv4() -> String? {
        var ifaddrPtr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddrPtr) == 0, let first = ifaddrPtr else { return nil }
        defer { freeifaddrs(ifaddrPtr) }

        for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let interface = ptr.pointee
            let family = interface.ifa_addr.pointee.sa_family
            guard family == UInt8(AF_INET) else { continue }
            let name = String(cString: interface.ifa_name)
            guard name == "en0" || name == "en1" else { continue }
            var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            getnameinfo(
                interface.ifa_addr,
                socklen_t(interface.ifa_addr.pointee.sa_len),
                &hostname,
                socklen_t(hostname.count),
                nil,
                0,
                NI_NUMERICHOST
            )
            let ip = String(cString: hostname)
            if !ip.hasPrefix("127.") { return ip }
        }
        return nil
    }
}
