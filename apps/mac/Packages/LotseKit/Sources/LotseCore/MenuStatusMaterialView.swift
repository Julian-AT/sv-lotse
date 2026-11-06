import AppKit

@MainActor
final class MenuStatusMaterialView: NSVisualEffectView {
    private let label = NSTextField(labelWithString: "")

    var title: String {
        get { label.stringValue }
        set { label.stringValue = newValue }
    }

    init() {
        super.init(frame: NSRect(x: 0, y: 0, width: 300, height: 44))
        material = .menu
        blendingMode = .behindWindow
        state = .active
        // AppKit updates this semantic material for Reduce Transparency and Increase Contrast.
        wantsLayer = true
        layer?.cornerRadius = 12
        layer?.masksToBounds = true
        label.font = .systemFont(ofSize: NSFont.systemFontSize, weight: .medium)
        label.textColor = .labelColor
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            label.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
            label.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }
}
