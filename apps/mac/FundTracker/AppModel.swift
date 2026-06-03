import AppKit
import Combine
import Foundation
import WebKit

@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    @Published var isBooting = true
    @Published var bootMessage = "正在启动…"
    @Published var bootError: String?
    @Published var pendingURL: URL?

    private let server = ServerProcess()
    private weak var webView: WKWebView?
    private var windowObserver: NSObjectProtocol?

    private init() {}

    func attach(webView: WKWebView, coordinator: WebView.Coordinator) {
        self.webView = webView
    }

    func start() async {
        bootError = nil
        isBooting = true
        let settings = DesktopSettings.load()

        do {
            if settings.apiMode == .local {
                bootMessage = "正在启动本地 API…"
                try server.start()
                try await server.waitForHealth()
                pendingURL = URL(string: "http://127.0.0.1:\(server.port)/")!
            } else {
                bootMessage = "正在加载…"
                pendingURL = AppPaths.distIndex
            }
            isBooting = false
        } catch {
            bootError = error.localizedDescription
            isBooting = false
        }
    }

    func didFinishNavigation() {
        isBooting = false
        bootError = nil
    }

    func reload() {
        webView?.reload()
    }

    func notifyWindowResize() {
        webView?.evaluateJavaScript("window.dispatchEvent(new Event('resize'));", completionHandler: nil)
    }

    func openDataFolder() {
        try? FileManager.default.createDirectory(at: DesktopSettings.dataDirectory, withIntermediateDirectories: true)
        NSWorkspace.shared.open(DesktopSettings.dataDirectory)
    }

    func openInBrowser() {
        guard DesktopSettings.load().apiMode == .local else { return }
        if let url = URL(string: "http://127.0.0.1:\(server.port)/") {
            NSWorkspace.shared.open(url)
        }
    }

    func restartApplication() {
        server.stop()
        let url = Bundle.main.bundleURL
        let config = NSWorkspace.OpenConfiguration()
        NSWorkspace.shared.openApplication(at: url, configuration: config, completionHandler: nil)
        NSApp.terminate(nil)
    }

    func applyWindowFrame(_ window: NSWindow) {
        let screen = window.screen ?? NSScreen.main ?? NSScreen.screens.first!
        let visible = screen.visibleFrame
        let minSize = NSSize(width: WindowPlacement.minWidth, height: WindowPlacement.minHeight)
        let settings = DesktopSettings.load()

        let frame: NSRect
        if let b = settings.windowBounds,
           b.width >= Int(WindowPlacement.minWidth),
           b.width <= Int(WindowPlacement.maxRestorableWidth),
           b.height >= Int(WindowPlacement.minHeight) {
            let saved = NSRect(
                x: CGFloat(b.x ?? Int(visible.origin.x)),
                y: CGFloat(b.y ?? Int(visible.origin.y)),
                width: CGFloat(b.width),
                height: CGFloat(b.height)
            )
            frame = WindowPlacement.constrain(saved, to: visible, minSize: minSize)
        } else {
            frame = WindowPlacement.defaultFrame(on: screen)
        }

        window.setFrame(frame, display: true)
        window.minSize = minSize
    }

    func saveWindowFrame(_ window: NSWindow) {
        let frame = window.frame
        DesktopSettings.save(windowBounds: WindowBounds(
            x: Int(frame.origin.x),
            y: Int(frame.origin.y),
            width: Int(frame.size.width),
            height: Int(frame.size.height)
        ))
    }

    func shutdown() {
        server.stop()
    }
}
