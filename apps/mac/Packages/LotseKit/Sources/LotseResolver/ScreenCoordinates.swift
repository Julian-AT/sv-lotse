import CoreGraphics

public enum ScreenCoordinates {
    /// Converts AppKit global coordinates into top-left display-local points.
    public static func localPoint(_ point: CGPoint, in frame: CGRect) -> CGPoint {
        CGPoint(x: point.x - frame.minX, y: frame.maxY - point.y)
    }
}
