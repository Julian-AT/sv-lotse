import AppKit
import SwiftUI

@MainActor
private struct GlassSurface: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    let cornerRadius: CGFloat

    func body(content: Content) -> some View {
        surface(content)
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(.primary.opacity(contrast == .increased ? 0.6 : 0.14))
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            .shadow(color: .black.opacity(reduceTransparency ? 0 : 0.12), radius: 16, y: 6)
    }

    @ViewBuilder
    private func surface(_ content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if reduceTransparency || contrast == .increased {
            content.background(Color(nsColor: .windowBackgroundColor), in: shape)
        } else if #available(macOS 26.0, *) {
            content.glassEffect(.regular, in: shape)
        } else {
            content.background(.ultraThinMaterial, in: shape)
        }
    }
}

public extension View {
    @MainActor
    func lotseGlassSurface(cornerRadius: CGFloat = 24) -> some View {
        modifier(GlassSurface(cornerRadius: cornerRadius))
    }
}
