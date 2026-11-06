// Ported from Clicky's OverlayWindow.swift (BlueCursorWaveformView, BlueCursorSpinnerView and the
// navigation bubble). See THIRD_PARTY_NOTICES.md. Adapted to the brand green and to reduced motion.
import SwiftUI

/// What the companion cursor shows in place of the triangle.
public enum CursorMode: Equatable, Sendable {
    /// The triangle: idle, flying, pointing or speaking.
    case pointer
    /// Clicky's live waveform while speech is captured.
    case listening
    /// Clicky's spinner while the answer is on its way.
    case processing
}

/// Clicky's five bars that replace the triangle while the user speaks, driven by the real mic level.
struct CursorWaveformView: View {
    let level: Double
    let active: Bool
    let reduceMotion: Bool
    private static let profile: [Double] = [0.4, 0.7, 1.0, 0.7, 0.4]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 36.0, paused: active == false || reduceMotion)) { context in
            HStack(alignment: .center, spacing: 2) {
                ForEach(0..<Self.profile.count, id: \.self) { bar in
                    RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                        .fill(OverlayPalette.brand)
                        .frame(width: 2, height: height(bar: bar, date: context.date))
                }
            }
            .shadow(color: OverlayPalette.brand.opacity(0.6), radius: 6)
            .animation(.linear(duration: 0.08), value: level)
        }
        .frame(width: 24, height: 24)
        .accessibilityHidden(true)
    }

    private func height(bar: Int, date: Date) -> Double {
        let phase = date.timeIntervalSinceReferenceDate * 3.6 + Double(bar) * 0.35
        let normalized = max(level - 0.008, 0)
        let eased = pow(min(normalized * 2.85, 1), 0.76)
        let idlePulse = reduceMotion ? 0.75 : (sin(phase) + 1) / 2 * 1.5
        return 3 + eased * 10 * Self.profile[bar] + idlePulse
    }
}

/// Clicky's small spinning arc while the answer is being prepared.
struct CursorSpinnerView: View {
    let active: Bool
    let reduceMotion: Bool

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: active == false || reduceMotion)) { context in
            let turn = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 0.8) / 0.8
            Circle()
                .trim(from: 0.15, to: 0.85)
                .stroke(
                    AngularGradient(colors: [OverlayPalette.brand.opacity(0), OverlayPalette.brand], center: .center),
                    style: StrokeStyle(lineWidth: 2.5, lineCap: .round)
                )
                .frame(width: 14, height: 14)
                .rotationEffect(.degrees(reduceMotion ? 0 : turn * 360))
                .shadow(color: OverlayPalette.brand.opacity(0.6), radius: 6)
        }
        .frame(width: 24, height: 24)
        .accessibilityHidden(true)
    }
}

/// Clicky's small bubble beside the cursor. The companion's words sit on the deep brand green; the
/// user's own words (the live transcript) on a light bubble, so it is always clear who is talking.
struct CursorBubble: View {
    enum Style: Equatable { case companion, user }

    let text: String
    var style: Style = .companion
    var symbol: String?
    var fontSize = 13.0
    var maxWidth = 300.0
    var lineLimit: Int?
    /// Pops in with Clicky's scale bounce and types its text in at a speaking rhythm.
    var animated = true

    /// The text the typed-in count belongs to, and how many of its characters are visible.
    @State private var typed = ""
    @State private var shown = 0
    @State private var popped = false
    private var scale: Double { animated && popped == false ? 0.5 : 1 }
    /// Never shows a stale prefix of the previous sentence for the frame before typing restarts.
    private var visible: String {
        if animated == false { return text }
        let prefix = String(typed.prefix(shown))
        return text.hasPrefix(prefix) ? prefix : ""
    }
    private var unit: Double { fontSize / 11 }
    private var accent: Color { OverlayPalette.brand }

    var body: some View {
        CappedWidthLayout(maxWidth: maxWidth - 16 * unit) {
            HStack(alignment: .firstTextBaseline, spacing: 5 * unit) {
                if let symbol { Image(systemName: symbol).font(.system(size: fontSize, weight: .semibold)) }
                // The full text sizes the bubble so it never reflows while the characters type in.
                Text(verbatim: text).opacity(0)
                    .overlay(alignment: .topLeading) { Text(verbatim: visible) }
            }
        }
        .font(.system(size: fontSize, weight: .medium))
        .lineLimit(lineLimit)
        .truncationMode(.head)
        .foregroundStyle(style == .companion ? Color.white : OverlayPalette.onBrand)
        .padding(.horizontal, 8 * unit)
        .padding(.vertical, 4 * unit)
        .background(
            RoundedRectangle(cornerRadius: 6 * unit, style: .continuous)
                .fill(style == .companion ? OverlayPalette.bubble : Color.white.opacity(0.96))
                .overlay {
                    if style == .user {
                        RoundedRectangle(cornerRadius: 6 * unit, style: .continuous).strokeBorder(accent, lineWidth: 1.5)
                    }
                }
                // Clicky's "materialising" glow: bright while popping in, settling to a soft halo.
                .shadow(color: accent.opacity(0.5 + (1 - scale)), radius: 6 + (1 - scale) * 16)
        )
        .scaleEffect(scale)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
        .task(id: text) { await reveal() }
    }

    private func reveal() async {
        guard animated else { return }
        // A growing text keeps what is already typed; a new sentence pops in afresh.
        let continues = shown > 0 && text.hasPrefix(String(typed.prefix(shown)))
        typed = text
        if continues == false {
            shown = 0
            popped = false
            // One frame at half size first, so Clicky's spring has something to bounce from.
            do { try await Task.sleep(for: .milliseconds(16)) } catch { return }
            withAnimation(.spring(response: 0.4, dampingFraction: 0.6)) { popped = true }
        }
        while shown < text.count {
            shown += 1
            do { try await Task.sleep(for: .milliseconds(Int.random(in: 30...60))) } catch { return }
        }
    }
}

/// Hugs short text and wraps long text at `maxWidth`, like Clicky's `fixedSize` bubble with a cap.
struct CappedWidthLayout: Layout {
    let maxWidth: Double

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let child = subviews.first else { return .zero }
        return child.sizeThatFits(ProposedViewSize(width: min(proposal.width ?? maxWidth, maxWidth), height: nil))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size))
    }
}

/// Places the bubble beside the cursor using its real size, so it never covers the cursor.
struct CursorBubbleLayout: Layout {
    var cursor: CGPoint
    var gap: CGSize

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        proposal.replacingUnspecifiedDimensions()
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            let origin = cursorBubbleOrigin(cursor: cursor, size: size, gap: gap, in: bounds.size)
            subview.place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: ProposedViewSize(size))
        }
    }
}

/// Clicky places its bubble 10 pt right of the cursor and just below it; at the right or bottom
/// edge it flips to the other side so the text always stays on screen.
func cursorBubbleOrigin(cursor: CGPoint, size: CGSize, gap: CGSize, in bounds: CGSize, margin: Double = 8) -> CGPoint {
    var origin = CGPoint(x: cursor.x + gap.width, y: cursor.y + gap.height)
    if origin.x + size.width > bounds.width - margin { origin.x = cursor.x - gap.width - size.width }
    if origin.y + size.height > bounds.height - margin { origin.y = cursor.y - gap.height - size.height - 12 }
    origin.x = min(max(origin.x, margin), max(margin, bounds.width - size.width - margin))
    origin.y = min(max(origin.y, margin), max(margin, bounds.height - size.height - margin))
    return origin
}
