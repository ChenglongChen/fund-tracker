import Foundation

enum AppPaths {
    /// 打包后 Resources/app；开发时可用环境变量 FUND_TRACKER_APP_ROOT 指向仓库根
    static var appRoot: URL {
        if let root = ProcessInfo.processInfo.environment["FUND_TRACKER_APP_ROOT"], !root.isEmpty {
            return URL(fileURLWithPath: root, isDirectory: true)
        }
        return Bundle.main.resourceURL!.appendingPathComponent("app", isDirectory: true)
    }

    static var distIndex: URL {
        appRoot.appendingPathComponent("dist/index.html")
    }

    static var serverEntry: URL {
        appRoot.appendingPathComponent("server/index.js")
    }

    static var bundledNode: URL {
        appRoot.appendingPathComponent("node/bin/node")
    }

    static func resolveNodeExecutable() -> URL {
        if FileManager.default.isExecutableFile(atPath: bundledNode.path) {
            return bundledNode
        }
        for candidate in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] {
            if FileManager.default.isExecutableFile(atPath: candidate) {
                return URL(fileURLWithPath: candidate)
            }
        }
        return URL(fileURLWithPath: "/usr/bin/env")
    }

    static var usesEnvNode: Bool {
        resolveNodeExecutable().lastPathComponent == "env"
    }

    static var bootHTML: URL {
        Bundle.main.url(forResource: "boot", withExtension: "html")
            ?? appRoot.appendingPathComponent("boot.html")
    }
}

final class ServerProcess {
    static let defaultPort = 8790

    private var process: Process?
    private(set) var port = ServerProcess.defaultPort

    var isRunning: Bool {
        process?.isRunning ?? false
    }

    func start() throws {
        guard !isRunning else { return }
        let root = AppPaths.appRoot
        guard FileManager.default.fileExists(atPath: AppPaths.serverEntry.path) else {
            throw NSError(domain: "FundTracker", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "找不到 server/index.js（\(AppPaths.serverEntry.path)）",
            ])
        }

        try FileManager.default.createDirectory(at: DesktopSettings.dataDirectory, withIntermediateDirectories: true)

        let node = AppPaths.resolveNodeExecutable()
        let proc = Process()
        if AppPaths.usesEnvNode {
            proc.executableURL = node
            proc.arguments = ["node", AppPaths.serverEntry.path]
        } else {
            proc.executableURL = node
            proc.arguments = [AppPaths.serverEntry.path]
        }
        proc.currentDirectoryURL = root

        var env = ProcessInfo.processInfo.environment
        env["FUND_TRACKER_DATA_DIR"] = DesktopSettings.dataDirectory.path
        env["PORT"] = String(ServerProcess.defaultPort)
        env["HOST"] = "0.0.0.0"
        proc.environment = env

        let errPipe = Pipe()
        proc.standardError = errPipe
        proc.standardOutput = Pipe()

        try proc.run()
        process = proc
        port = ServerProcess.defaultPort
    }

    func stop() {
        guard let process, process.isRunning else { return }
        process.terminate()
        process.waitUntilExit()
        self.process = nil
    }

    func waitForHealth(timeout: TimeInterval = 15) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        let url = URL(string: "http://127.0.0.1:\(port)/api/health")!
        while Date() < deadline {
            if let (_, response) = try? await URLSession.shared.data(from: url),
               (response as? HTTPURLResponse)?.statusCode == 200 {
                return
            }
            try await Task.sleep(nanoseconds: 125_000_000)
        }
        throw NSError(domain: "FundTracker", code: 2, userInfo: [
            NSLocalizedDescriptionKey: "API 健康检查超时（端口 \(port)）",
        ])
    }
}
