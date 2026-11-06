struct CaptureCopy {
    let english: Bool

    func screenHeading(_ index: Int, selected: Bool) -> String {
        let label = english ? "Screen" : "Bildschirm"
        let suffix = selected ? (english ? " (selected; OCR boxes use this screen)" : " (ausgewählt; OCR-Positionen gelten hier)") : ""
        return "\(label) \(index)\(suffix)"
    }
}
