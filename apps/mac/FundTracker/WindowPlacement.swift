import AppKit

enum WindowPlacement {
    /// iPhone 15 逻辑分辨率（Mac 壳默认「手机窗口」）
    static let phoneWidth: CGFloat = 393
    static let phoneHeight: CGFloat = 852
    static let minWidth: CGFloat = 360
    static let minHeight: CGFloat = 640
    /// 仅恢复此宽度以内的已保存窗口（避免旧版宽窗口布局）
    static let maxRestorableWidth: CGFloat = 430

    /// 将窗口限制在可见区域（菜单栏与 Dock 之间）
    static func constrain(_ frame: NSRect, to visible: NSRect, minSize: NSSize) -> NSRect {
        var f = frame
        f.size.width = min(max(f.size.width, minSize.width), visible.width)
        f.size.height = min(max(f.size.height, minSize.height), visible.height)
        if f.maxX > visible.maxX { f.origin.x = visible.maxX - f.size.width }
        if f.minX < visible.minX { f.origin.x = visible.minX }
        if f.maxY > visible.maxY { f.origin.y = visible.maxY - f.size.height }
        if f.minY < visible.minY { f.origin.y = visible.minY }
        return f
    }

    /// 首次启动默认窗口：iPhone 15 尺寸，居中且底边在 Dock 上方
    static func defaultFrame(on screen: NSScreen, width: CGFloat = phoneWidth, height: CGFloat = phoneHeight) -> NSRect {
        let visible = screen.visibleFrame
        let w = min(max(width, minWidth), visible.width)
        let h = min(max(height, minHeight), visible.height)
        let origin = NSPoint(
            x: visible.origin.x + (visible.width - w) / 2,
            y: visible.origin.y + (visible.height - h) / 2
        )
        return NSRect(origin: origin, size: NSSize(width: w, height: h))
    }
}
