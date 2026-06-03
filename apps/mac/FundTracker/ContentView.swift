import AppKit
import SwiftUI
import WebKit

struct WebView: NSViewRepresentable {
    @ObservedObject var model: AppModel

    func makeCoordinator() -> Coordinator {
        Coordinator(model: model)
    }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let controller = WKUserContentController()
        controller.add(context.coordinator.bridge, name: "fundTracker")
        controller.addUserScript(context.coordinator.bridge.makeUserScript())
        config.userContentController = controller

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = context.coordinator
        context.coordinator.bridge.webView = webView
        context.coordinator.bridge.onRestart = { [weak model] in
            model?.restartApplication()
        }
        model.attach(webView: webView, coordinator: context.coordinator)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        guard let target = model.pendingURL, context.coordinator.lastLoadedURL != target else { return }
        context.coordinator.lastLoadedURL = target
        if target.isFileURL {
            let readAccess = target.deletingLastPathComponent()
            webView.loadFileURL(target, allowingReadAccessTo: readAccess)
        } else {
            webView.load(URLRequest(url: target))
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let model: AppModel
        let bridge = FundTrackerBridge()
        var lastLoadedURL: URL?

        init(model: AppModel) {
            self.model = model
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.evaluateJavaScript(
                """
                document.documentElement.classList.add('is-desktop-app');
                document.body?.style?.setProperty('overflow','hidden');
                window.dispatchEvent(new Event('resize'));
                """,
                completionHandler: nil
            )
            model.didFinishNavigation()
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard navigationAction.navigationType == .linkActivated,
                  let url = navigationAction.request.url,
                  url.scheme?.hasPrefix("http") == true
            else {
                decisionHandler(.allow)
                return
            }
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }
    }
}

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        ZStack {
            WebView(model: model)
                .ignoresSafeArea()
            if model.isBooting {
                BootOverlay(message: model.bootMessage)
            }
            if let error = model.bootError {
                ErrorOverlay(message: error) {
                    Task { await model.start() }
                }
            }
        }
        .frame(minWidth: WindowPlacement.minWidth, minHeight: WindowPlacement.minHeight)
        .task {
            await model.start()
        }
    }
}

private struct BootOverlay: View {
    let message: String

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.large)
            Text("Fund Tracker")
                .font(.title2.weight(.semibold))
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(32)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct ErrorOverlay: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("启动失败")
                .font(.title2.weight(.semibold))
            Text(message)
                .font(.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("重试", action: retry)
                .keyboardShortcut(.defaultAction)
        }
        .padding(32)
        .frame(maxWidth: 420)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
    }
}
