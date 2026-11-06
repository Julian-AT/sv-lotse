import SwiftUI

/// The companion's triangle: apex up, centred in its box, turned by the flight's rotation.
struct PointerShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

/// Draws the triangle on a fully transparent canvas with room for its glow, so nothing is boxed or
/// clipped. The shadow follows the triangle's path; the glyph is centred on its position.
/// Rotation and glow animate, so the turn back to the resting angle after a flight eases like Clicky's.
struct PointerGlyph: View, Animatable {
    let size: Double
    let fill: Color
    var rotation: Double = 0
    /// Clicky's glow grows with the flight's scale pulse (`6 + (scale - 1) * 20`).
    var glowRadius = Self.glowRadius

    static let glowRadius = 6.0
    static let maximumGlowRadius = 14.0
    nonisolated var animatableData: AnimatablePair<Double, Double> {
        get { AnimatablePair(rotation, glowRadius) }
        set {
            rotation = newValue.first
            glowRadius = newValue.second
        }
    }
    /// Enough room for the rotated triangle plus its brightest glow on every side.
    var padding: Double { size * 0.25 + Self.maximumGlowRadius * 2.5 }
    var side: Double { size + 2 * padding }

    var body: some View {
        Canvas { context, canvasSize in
            let center = CGPoint(x: canvasSize.width / 2, y: canvasSize.height / 2)
            let box = CGRect(x: -size / 2, y: -size / 2, width: size, height: size)
            let transform = CGAffineTransform(translationX: center.x, y: center.y)
                .rotated(by: rotation * .pi / 180)
            let path = PointerShape().path(in: box).applying(transform)
            var glowing = context
            glowing.addFilter(.shadow(color: fill.opacity(0.6), radius: min(glowRadius, Self.maximumGlowRadius)))
            glowing.fill(path, with: .color(fill))
        }
        .frame(width: side, height: side)
        .accessibilityHidden(true)
    }
}
