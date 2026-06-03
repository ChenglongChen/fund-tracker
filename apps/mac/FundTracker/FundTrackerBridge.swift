import AppKit
import Foundation
import WebKit

final class FundTrackerBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    var onRestart: (() -> Void)?

    private static let bridgeScript = """
    (function () {
      if (window.fundTrackerDesktop) return;
      const pending = new Map();
      window.__fundTrackerNativeReply = function (id, result, error) {
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        if (error) p.reject(new Error(error));
        else p.resolve(result);
      };
      function call(method, args) {
        return new Promise(function (resolve, reject) {
          const id = crypto.randomUUID();
          pending.set(id, { resolve: resolve, reject: reject });
          window.webkit.messageHandlers.fundTracker.postMessage({ id: id, method: method, args: args || {} });
        });
      }
      window.fundTrackerDesktop = {
        isDesktop: true,
        getApiMode: function () { return call('getApiMode'); },
        saveDesktopSettings: function (patch) { return call('saveDesktopSettings', patch || {}); },
        restartApp: function () {
          window.webkit.messageHandlers.fundTracker.postMessage({ method: 'restartApp' });
        },
        getDataDir: function () { return call('getDataDir'); },
        openDataDir: function () { return call('openDataDir'); },
        getLocalApiUrl: function () { return call('getLocalApiUrl'); },
        getLanApiUrl: function () { return call('getLanApiUrl'); },
      };
    })();
    """

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "fundTracker", let body = message.body as? [String: Any] else { return }

        if let method = body["method"] as? String, method == "restartApp" {
            DispatchQueue.main.async { self.onRestart?() }
            return
        }

        guard let id = body["id"] as? String, let method = body["method"] as? String else { return }
        let args = body["args"] as? [String: Any] ?? [:]

        Task { @MainActor in
            do {
                let result = try await self.handle(method: method, args: args)
                self.reply(id: id, result: result)
            } catch {
                self.reply(id: id, error: error.localizedDescription)
            }
        }
    }

    func makeUserScript() -> WKUserScript {
        WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    @MainActor
    private func handle(method: String, args: [String: Any]) async throws -> Any {
        switch method {
        case "getApiMode":
            return DesktopSettings.load().apiMode.rawValue
        case "saveDesktopSettings":
            if let mode = args["apiMode"] as? String {
                DesktopSettings.save(apiMode: mode == "remote" ? .remote : .local)
            }
            return true
        case "getDataDir":
            return DesktopSettings.dataDirectory.path
        case "openDataDir":
            try FileManager.default.createDirectory(at: DesktopSettings.dataDirectory, withIntermediateDirectories: true)
            NSWorkspace.shared.open(DesktopSettings.dataDirectory)
            return true
        case "getLocalApiUrl":
            return "http://127.0.0.1:\(ServerProcess.defaultPort)"
        case "getLanApiUrl":
            if let ip = DesktopSettings.lanIPv4() {
                return "http://\(ip):\(ServerProcess.defaultPort)"
            }
            return NSNull()
        default:
            throw NSError(domain: "FundTracker", code: 3, userInfo: [
                NSLocalizedDescriptionKey: "Unknown method: \(method)",
            ])
        }
    }

    private func reply(id: String, result: Any? = nil, error: String? = nil) {
        guard let webView else { return }
        if error == nil {
            webView.evaluateJavaScript(
                "window.__fundTrackerNativeReply('\(id)', \(jsValue(result)), undefined)",
                completionHandler: nil
            )
        } else {
            let esc = error!.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
            webView.evaluateJavaScript(
                "window.__fundTrackerNativeReply('\(id)', undefined, '\(esc)')",
                completionHandler: nil
            )
        }
    }

    private func jsValue(_ value: Any?) -> String {
        guard let value else { return "null" }
        if value is NSNull { return "null" }
        if let s = value as? String {
            let esc = s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
            return "'\(esc)'"
        }
        if let b = value as? Bool { return b ? "true" : "false" }
        if let n = value as? NSNumber { return "\(n)" }
        if JSONSerialization.isValidJSONObject(value),
           let data = try? JSONSerialization.data(withJSONObject: value),
           let str = String(data: data, encoding: .utf8) {
            return str
        }
        return "null"
    }
}
