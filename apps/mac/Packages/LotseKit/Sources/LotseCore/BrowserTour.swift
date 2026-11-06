import AppKit
import ApplicationServices
import LotseOverlay
import LotseResolver

/// The visible tour on a page Lotse opened in the default browser: the cursor leaves the mouse,
/// outlines the heading's block, scrolls the page down by itself, outlines the application section
/// and points at the application or PDF link. It only reads and scrolls: nothing is pressed,
/// nothing navigates, so submit, sign-in and payment controls are never touched.
extension BrowserPageCapability {
    /// Pixels per frame (1/60 s) while scrolling, slower once the target is on screen.
    static let tourScrollSpeed: Int32 = 26
    static let tourScrollSlow: Int32 = 10
    static let tourScrollLimit: Duration = .milliseconds(5200)

    struct TourNode: @unchecked Sendable {
        let node: LiveAXNode
        let frame: CGRect
        let label: String
        var role = "heading"
    }

    struct TourPlan: @unchecked Sendable {
        let page: CGRect
        let title: String
        let heading: TourNode?
        let headingBlock: CGRect?
        let target: TourNode?
        let headings: [TourNode]
    }

    /// How the tour moves: `step` speaks each sentence and waits for it to finish before the next
    /// step; `fast` keeps moving with short sentences. Sent by the server as the open action's
    /// `payload.style` ("step" or "fast"); step is the default.
    enum TourPace: String, Sendable {
        case step, fast
        init(hint: String?) { self = hint?.lowercased() == "fast" ? .fast : .step }
    }

    struct TourCopy {
        let english: Bool
        let fast: Bool
        private func line(_ german: (step: String, fast: String), _ english: (step: String, fast: String)) -> String {
            let pair = self.english ? english : german
            return fast ? pair.fast : pair.step
        }
        var opened: String {
            line(("Das ist die offizielle Seite. Ich zeige Ihnen, wo Sie den Antrag finden.", "Die offizielle Seite."),
                 ("This is the official page. I'll show you where to find the application.", "The official page."))
        }
        var scrolling: String {
            line(("Ich scrolle nach unten zum Antrag.", "Ich scrolle zum Antrag."),
                 ("I'm scrolling down to the application.", "Scrolling to the application."))
        }
        var section: String {
            line(("Hier steht, wie Sie den Antrag stellen.", "Hier steht der Antrag."),
                 ("This part explains how to apply.", "Here is the application."))
        }
        var form: String {
            line(("Und hier ist das Antragsformular zum Herunterladen.", "Hier ist das Formular."),
                 ("And here is the application form to download.", "Here is the form."))
        }
        var link: String {
            line(("Dieser Link führt zum Antrag.", "Hier geht es zum Antrag."),
                 ("This link leads to the application.", "This leads to the application."))
        }
        var related: String {
            line(("Hier finden Sie mehr dazu.", "Mehr dazu hier."), ("Here is more on this.", "More on this here."))
        }
        var document: String {
            line(("Hier finden Sie das Dokument dazu.", "Hier ist das Dokument."),
                 ("Here is the document for it.", "Here is the document."))
        }
        var content: String {
            line(("Hier steht das Wichtigste.", "Das Wichtigste."), ("Here is the main content.", "The main content."))
        }
    }

    /// Keeps a step on screen: in step mode until its sentence finished (at most a few seconds) plus
    /// a short pause, never shorter than `minimum`.
    private func hold(_ line: Task<Void, Never>?, pace: TourPace, minimum: Duration) async {
        let clock = ContinuousClock()
        let started = clock.now
        if pace == .step, let line {
            await withTaskGroup(of: Void.self) { group in
                group.addTask { await line.value }
                group.addTask { try? await Task.sleep(for: .seconds(9)) }
                await group.next()
                group.cancelAll()
            }
            try? await Task.sleep(for: .milliseconds(400))
        }
        let left = minimum - (clock.now - started)
        if left > .zero { try? await Task.sleep(for: left) }
    }

    /// Runs the tour on the page Lotse opened. `show(nil)` returns the cursor to the mouse.
    func visibleTour(english: Bool = false, pace: TourPace = .step, show: @MainActor (TourFrame?) -> Void,
                     say: @MainActor (String) -> Task<Void, Never>? = { _ in nil }) async {
        let copy = TourCopy(english: english, fast: pace == .fast)
        let generation = navigationGeneration
        defer { show(nil) }
        guard AXIsProcessTrusted(), let (pid, _) = currentBrowser() else {
            log.error("tour skipped: accessibility or browser unavailable")
            return
        }
        let policy = policy
        let top = Self.primaryTop
        let expected = active?.url.absoluteString
        let preferred = active?.area
        NSRunningApplication(processIdentifier: pid)?.activate()
        let read = { (waitForLoad: Bool) async -> TourPlan? in
            await Task.detached { () -> TourPlan? in
                guard let area = Self.pageArea(pid: pid, top: top, policy: policy, expected: expected, preferred: preferred),
                    let url = area.url, BrowserPageSafety.isLoginPage(url) == false, let page = area.frame
                else { return nil }
                area.raiseWindow()
                // The page reports ready before its content is in the tree: wait for the load to finish.
                var waited = 0
                while waitForLoad, area.refreshed().isLoaded == false, waited < 40 {
                    usleep(100_000)
                    waited += 1
                }
                return Self.tourPlan(area: area, page: page, pageURL: url)
            }.value
        }
        guard var plan = await read(true) else {
            log.error("tour skipped: the opened page is not readable")
            return
        }
        log.info("""
            tour plan: heading \(plan.heading != nil), target \(plan.target?.label ?? "none", privacy: .public), \
            \(plan.headings.count) headings
            """)

        // 1. The heading's block.
        if let heading = plan.heading {
            show(TourFrame(point: Self.hoverPoint(heading.frame), highlight: plan.headingBlock, caption: copy.opened))
            await hold(say(copy.opened), pace: pace, minimum: .milliseconds(1500))
        }
        guard generation == navigationGeneration else { return }
        // Late content (accordions, download tiles) is in the tree by now: read the targets again.
        for attempt in 0..<3 where plan.target == nil {
            if attempt > 0 { try? await Task.sleep(for: .milliseconds(500)) }
            if let fresh = await read(false) { plan = fresh }
        }
        log.info("tour target: \(plan.target?.label ?? "none", privacy: .public), \(plan.headings.count) headings")

        // 2. Scroll down by itself until the application part is in view.
        let anchor = plan.headingBlock ?? plan.page
        let wheel = CGPoint(x: min(max(anchor.midX, plan.page.minX + 80), plan.page.maxX - 80), y: plan.page.midY)
        let scrollLine = say(copy.scrolling)
        let target = await scroll(plan: plan, at: wheel, caption: copy.scrolling, generation: generation, pid: pid, show: show)
        await hold(scrollLine, pace: pace, minimum: .zero)
        guard generation == navigationGeneration, NSRunningApplication(processIdentifier: pid)?.isActive == true else { return }

        // 3. The application section, then 4. the link itself.
        if let target {
            let text = target.label.lowercased()
            let about = Self.applicationWords.contains { text.contains($0) }
            // Let a smooth scroll or the bounce at the page end settle before measuring.
            try? await Task.sleep(for: .milliseconds(300))
            let block = await Task.detached { () -> CGRect? in
                guard target.role == "heading" else { return Self.block(around: target.node, page: plan.page) }
                return target.node.refreshedFrame().map { Self.section(below: $0, page: plan.page) }
            }.value
            if let block {
                let words = about ? copy.section : copy.related
                show(TourFrame(point: Self.hoverPoint(block, inset: true), highlight: block, caption: words))
                await hold(say(words), pace: pace, minimum: .milliseconds(1600))
                guard generation == navigationGeneration else { return }
            }
            let rect = await Task.detached { target.node.refreshedFrame() }.value ?? target.frame
            if target.role == "link", rect.height > 2 {
                let document = target.node.url.map(BrowserPageSafety.isDocument) == true || text.contains("pdf")
                let words = document ? (about ? copy.form : copy.document) : (about ? copy.link : copy.related)
                show(TourFrame(point: Self.hoverPoint(rect), highlight: rect.insetBy(dx: -8, dy: -6), caption: words))
                log.info("tour pointed at the application link")
                await hold(say(words), pace: pace, minimum: .milliseconds(1800))
            }
        } else {
            // Fallback: the main content block in view.
            let main = await Task.detached { () -> CGRect? in
                guard let area = Self.pageArea(pid: pid, top: top, policy: policy, expected: expected, preferred: preferred),
                    let page = area.frame
                else { return nil }
                return Self.mainBlock(in: area, page: page)
            }.value
            if let main {
                show(TourFrame(point: Self.hoverPoint(main, inset: true), highlight: main, caption: copy.content))
                await hold(say(copy.content), pace: pace, minimum: .milliseconds(1800))
            }
            log.info("tour found no application part; showed the main content")
        }
    }

    /// Scrolls with small wheel steps under the cursor, outlining each section heading it passes,
    /// until the target sits in the upper half of the page. Returns the target when it is in view.
    private func scroll(plan: TourPlan, at wheel: CGPoint, caption: String, generation: Int, pid: pid_t,
                        show: @MainActor (TourFrame?) -> Void) async -> TourNode? {
        let page = plan.page
        var passing: CGRect?
        show(TourFrame(point: wheel, highlight: nil, caption: caption, scrolling: true))
        try? await Task.sleep(for: .milliseconds(450))
        // The wheel runs on its own at a steady pace while the page is read, so the motion stays smooth.
        let motor = TourScrollMotor(point: wheel, primaryTop: Self.primaryTop, pid: pid)
        motor.start(speed: Self.tourScrollSpeed)
        defer { motor.stop() }
        let clock = ContinuousClock()
        let started = clock.now
        let limit = plan.target == nil ? Duration.milliseconds(1400) : Self.tourScrollLimit
        var lastProbe: CGFloat?
        var stuck = 0
        var moved = false
        while clock.now - started < limit, generation == navigationGeneration {
            try? await Task.sleep(for: .milliseconds(90))
            guard NSRunningApplication(processIdentifier: pid)?.isActive == true else {
                log.info("tour stopped: the browser is no longer in front")
                return nil
            }
            let target = plan.target
            let headings = plan.headings
            let first = plan.heading
            let reading = await Task.detached { () -> (CGRect?, CGRect?, CGFloat?) in
                let current = target?.node.refreshedFrame()
                let frames = headings.map { $0.node.refreshedFrame() }
                // The heading in the middle band, outlined while the page passes under the cursor.
                let middle = frames.indices.first { index in
                    guard let rect = frames[index], rect.height > 4 else { return false }
                    return Self.inBand(rect, page: page, from: 0.28, to: 0.6)
                }.flatMap { Self.block(around: headings[$0].node, page: page) }
                // Off-screen elements sit clipped at the page edge; only visible ones show movement.
                let shown = ([first?.node.refreshedFrame(), current] + frames).compactMap { $0 }.filter { $0.height > 4 }
                let probe = shown.isEmpty ? nil : shown.reduce(CGFloat(shown.count) * 10_000) { $0 + $1.minY }
                return (current, middle, probe)
            }.value
            if let middle = reading.1, middle != passing {
                passing = middle
                show(TourFrame(point: wheel, highlight: middle, caption: caption, scrolling: true))
            }
            if let probe = reading.2 {
                if let lastProbe, abs(lastProbe - probe) < 1 { stuck += 1 } else { stuck = 0 }
                if let lastProbe, abs(lastProbe - probe) >= 1 { moved = true }
                lastProbe = probe
            } else {
                lastProbe = nil
            }
            if let current = reading.0, current.height > 2, Self.inBand(current, page: page, from: 0, to: 1) {
                motor.speed = Self.tourScrollSlow
                if Self.inBand(current, page: page, from: 0, to: 0.5) || stuck >= 3 {
                    motor.stop()
                    log.info("tour scrolled to the application part")
                    await settle(plan.target, page: page, at: wheel)
                    return plan.target
                }
            }
            // Bottom of the page, or the wheel does not reach this browser: stop rather than stall.
            if stuck >= 5 { break }
        }
        motor.stop()
        guard let target = plan.target, generation == navigationGeneration,
            NSRunningApplication(processIdentifier: pid)?.isActive == true
        else { return nil }
        log.info("tour scroll ended before the target (moved: \(moved)); scrolling it into view via accessibility")
        let rect = await Task.detached { () -> CGRect? in
            target.node.perform("AXScrollToVisible")
            usleep(350_000)
            return target.node.refreshedFrame()
        }.value
        guard let rect, rect.height > 2, page.intersects(rect) else { return nil }
        await settle(target, page: page, at: wheel)
        return target
    }

    /// Brings a target that ended up under a sticky header (or just past the top) back to about a
    /// third of the page with a few gentle wheel steps upwards.
    private func settle(_ target: TourNode?, page: CGRect, at wheel: CGPoint) async {
        guard let target else { return }
        try? await Task.sleep(for: .milliseconds(150))
        guard let rect = await Task.detached(operation: { target.node.refreshedFrame() }).value else { return }
        let offset = (page.maxY - rect.maxY) / max(page.height, 1)
        guard rect.height > 2, offset < 0.25 else { return }
        var remaining = Int32((0.32 - offset) * page.height)
        while remaining > 0, NSRunningApplication(processIdentifier: active?.pid ?? 0)?.isActive == true {
            let step = min(remaining, 12)
            BrowserAccessibility.scrollWheel(pixels: -step, at: wheel, primaryTop: Self.primaryTop)
            remaining -= step
            try? await Task.sleep(for: .milliseconds(16))
        }
        try? await Task.sleep(for: .milliseconds(150))
    }

    // MARK: Reading the page

    /// Headings and links in document order, also those below the fold: browsers report their
    /// frames clipped to the visible page (zero height), which the page outline leaves out.
    nonisolated static func tourElements(in area: LiveAXNode, limit: Int = BrowserPageReader.maximumNodes) -> [TourNode] {
        var result: [TourNode] = []
        var visited = 0
        func visit(_ node: LiveAXNode) {
            guard visited < limit else { return }
            visited += 1
            if BrowserPageReader.isSecure(node) { return }
            if let role = node.role, role == "AXHeading" || role == "AXLink" {
                let label = BrowserPageReader.label(node)
                if label.isEmpty == false, let frame = node.frame {
                    result.append(TourNode(node: node, frame: frame, label: label, role: role == "AXLink" ? "link" : "heading"))
                }
                return
            }
            for child in node.children { visit(child) }
        }
        visit(area)
        return result
    }

    nonisolated static func tourPlan(area: LiveAXNode, page: CGRect, pageURL: String) -> TourPlan {
        let elements = tourElements(in: area)
        let candidates = elements.map { (role: $0.role, label: $0.label, url: $0.node.url) }
        let visible = elements.indices.filter {
            elements[$0].role == "heading" && isVisible(elements[$0].frame, page: page) && inPageChrome(elements[$0].node) == false
        }
        let headingIndex = mainHeading(visible.map { (elements[$0].label, elements[$0].frame) }).map { visible[$0] }
        let heading = headingIndex.map { elements[$0] }
        let target = applicationTargets(candidates, page: pageURL).prefix(12).lazy
            .map { elements[$0] }.first { inPageChrome($0.node) == false }
        // Section headings below the first screen, passed while scrolling.
        let headings = elements.indices.filter { index in
            elements[index].role == "heading" && index != headingIndex && isVisible(elements[index].frame, page: page) == false
        }.prefix(40).map { elements[$0] }
        return TourPlan(page: page, title: heading?.label ?? "", heading: heading,
            headingBlock: heading.flatMap { block(around: $0.node, page: page) } ?? heading.map { $0.frame.insetBy(dx: -10, dy: -8) },
            target: target, headings: Array(headings))
    }

    /// The div-level block around an element: its nearest enclosing group that is clearly larger
    /// than the element but not the whole page, clipped to the visible page.
    nonisolated static func block(around node: LiveAXNode, page: CGRect) -> CGRect? {
        guard let frame = node.refreshedFrame(), frame.height > 2 else { return nil }
        let ancestors = node.ancestors(limit: 8).compactMap { ancestor -> (String, CGRect)? in
            ancestor.frame.map { (ancestor.role ?? "", $0) }
        }
        return blockFrame(element: frame, ancestors: ancestors, page: page)
    }

    nonisolated static func blockFrame(element: CGRect, ancestors: [(role: String, frame: CGRect)], page: CGRect) -> CGRect {
        let fallback = element.insetBy(dx: -10, dy: -8).intersection(page.insetBy(dx: 2, dy: 2))
        for (role, frame) in ancestors {
            guard ["AXGroup", "AXList", "AXSection", "AXArticle", "AXCell", "AXRow"].contains(role) else { continue }
            let visible = frame.intersection(page)
            guard visible.isNull == false else { continue }
            if visible.width > page.width * 0.92 || visible.height > page.height * 0.8 { break }
            if visible.height >= max(element.height * 1.5, element.height + 40), visible.width >= element.width {
                return visible.insetBy(dx: -4, dy: -4).intersection(page.insetBy(dx: 2, dy: 2))
            }
        }
        return fallback.isNull ? element : fallback
    }

    /// A heading's section: the heading and the text below it, about a third of the page.
    nonisolated static func section(below heading: CGRect, page: CGRect) -> CGRect {
        let width = min(max(heading.width, page.width * 0.45), page.maxX - heading.minX + 12)
        let bottom = max(page.minY + 4, heading.minY - page.height * 0.3)
        return CGRect(x: heading.minX - 12, y: bottom, width: width + 12, height: heading.maxY + 10 - bottom)
            .intersection(page.insetBy(dx: 2, dy: 2))
    }

    /// The content block nearest the middle of the page, below any sticky header, for the fallback.
    nonisolated static func mainBlock(in area: LiveAXNode, page: CGRect) -> CGRect? {
        let headings = tourElements(in: area, limit: 4000).filter {
            $0.role == "heading" && isVisible($0.frame, page: page) && inBand($0.frame, page: page, from: 0.15, to: 0.85)
        }
        let middle = headings.min { abs($0.frame.midY - page.midY) < abs($1.frame.midY - page.midY) }
        if let middle, let block = block(around: middle.node, page: page) { return block }
        return page.insetBy(dx: page.width * 0.2, dy: page.height * 0.25)
    }

    nonisolated static func isVisible(_ frame: CGRect, page: CGRect) -> Bool {
        frame.height > 4 && frame.width > 4 && page.contains(CGPoint(x: frame.midX, y: frame.midY))
    }

    /// True when the rect's top lies between the given fractions of the page height, from the top.
    nonisolated static func inBand(_ rect: CGRect, page: CGRect, from: CGFloat, to: CGFloat) -> Bool {
        let offset = (page.maxY - rect.maxY) / max(page.height, 1)
        return offset >= from && offset <= to && rect.minY >= page.minY
    }

    /// The page title among the visible headings: the tallest (largest type), the first on ties.
    nonisolated static func mainHeading(_ headings: [(label: String, frame: CGRect)]) -> Int? {
        headings.indices.max { lhs, rhs in
            let (left, right) = (headings[lhs].frame.height, headings[rhs].frame.height)
            return left == right ? lhs > rhs : left < right
        }
    }

    /// Words that mark an application part on any official page (SV carriers, ministries, cities).
    nonisolated static let applicationWords = ["antrag", "beantrag", "formular", "einreich", "ansuchen", "anmeldung zur"]
    nonisolated static let applicationPhrases = ["antrag stellen", "antragstellung", "antrag auf", "beantragen", "online-antrag",
        "online antrag", "antragsformular", "formular", "wie beantrage", "ansuchen"]

    /// Candidates the tour may end on, best first: the application PDF or form link, an
    /// application heading, then other application links and downloads. Same-page jump links,
    /// denied controls and login pages never qualify. Returns indices in rank, then page order.
    nonisolated static func applicationTargets(_ elements: [(role: String, label: String, url: String?)], page: String) -> [Int] {
        func rank(_ element: (role: String, label: String, url: String?)) -> Int? {
            let text = element.label.lowercased()
            let about = applicationWords.contains { text.contains($0) }
            let phrase = applicationPhrases.contains { text.contains($0) }
            guard BrowserPageSafety.isDenied(role: element.role, label: element.label) == false else { return nil }
            switch element.role {
            case "link":
                guard let url = element.url, BrowserPageSafety.isLoginPage(url) == false,
                    BrowserPageSafety.sameDocument(url, page) == false
                else { return nil }
                let document = BrowserPageSafety.isDocument(url) || text.contains("pdf")
                if document && about { return 0 }
                if phrase { return 1 }
                if about { return 3 }
                if document || text.contains("download") { return 5 }
                return nil
            case "heading":
                if phrase { return 2 }
                if about || text.contains("download") || text.contains("formulare") { return 4 }
                return nil
            default: return nil
            }
        }
        var ranked: [(index: Int, rank: Int)] = []
        for index in elements.indices {
            if let value = rank(elements[index]) { ranked.append((index, value)) }
        }
        ranked.sort { lhs, rhs in lhs.rank == rhs.rank ? lhs.index < rhs.index : lhs.rank < rhs.rank }
        return ranked.map(\.index)
    }

    /// The best candidate (see `applicationTargets`).
    nonisolated static func applicationTarget(_ elements: [(role: String, label: String, url: String?)], page: String) -> Int? {
        applicationTargets(elements, page: page).first
    }

    /// Site navigation, header and footer: a "Formulare" menu link is not the application part.
    nonisolated static func inPageChrome(_ node: LiveAXNode) -> Bool {
        node.ancestors(limit: 14).contains { ancestor in
            ["AXLandmarkNavigation", "AXLandmarkBanner", "AXLandmarkContentInfo", "AXLandmarkSearch"]
                .contains(ancestor.subrole ?? "")
        }
    }

    /// Where the cursor tip hovers on a rect: near its leading edge, vertically centred (or inside
    /// the top-left part of a large block).
    nonisolated static func hoverPoint(_ rect: CGRect, inset: Bool = false) -> CGPoint {
        if inset {
            return CGPoint(x: rect.minX + min(rect.width * 0.3, 180), y: rect.maxY - min(rect.height * 0.35, 60))
        }
        return CGPoint(x: rect.minX + min(rect.width * 0.35, 90), y: rect.midY)
    }
}

/// Posts one small wheel step every frame from a background thread until stopped.
final class TourScrollMotor: @unchecked Sendable {
    private let lock = NSLock()
    private var running = false
    private var pixels: Int32 = 0
    private let point: CGPoint
    private let primaryTop: CGFloat

    private let pid: pid_t

    init(point: CGPoint, primaryTop: CGFloat, pid: pid_t) {
        self.point = point
        self.primaryTop = primaryTop
        self.pid = pid
    }

    var speed: Int32 {
        get { lock.withLock { pixels } }
        set { lock.withLock { pixels = newValue } }
    }

    func start(speed: Int32) {
        lock.withLock {
            pixels = speed
            running = true
        }
        let thread = Thread { [self] in
            let browser = NSRunningApplication(processIdentifier: pid)
            while lock.withLock({ running }) {
                // Only while the browser is in front: the wheel scrolls whatever window is under the point.
                if browser?.isActive == true {
                    BrowserAccessibility.scrollWheel(pixels: self.speed, at: point, primaryTop: primaryTop)
                }
                Thread.sleep(forTimeInterval: 1.0 / 60.0)
            }
        }
        thread.qualityOfService = .userInteractive
        thread.start()
    }

    func stop() { lock.withLock { running = false } }
}
