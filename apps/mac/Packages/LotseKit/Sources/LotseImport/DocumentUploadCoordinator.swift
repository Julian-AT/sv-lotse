import Foundation
import Observation

public enum UploadQueueStatus: Equatable, Sendable {
    case ready, uploading, offline, needsSession, rejected, storageError
}

@MainActor @Observable
public final class DocumentUploadCoordinator {
    public private(set) var status = UploadQueueStatus.ready
    public private(set) var pendingCount = 0
    public var onChange: (() -> Void)?
    private let queue: EncryptedUploadQueue
    private let client: any DocumentUploading
    private var retryTask: Task<Void, Never>?
    private var flushing = false

    public init(queue: EncryptedUploadQueue, client: any DocumentUploading) {
        self.queue = queue
        self.client = client
    }

    public func start() {
        guard retryTask == nil else { return }
        retryTask = Task { @MainActor [weak self] in
            while Task.isCancelled == false {
                await self?.flush()
                do { try await Task.sleep(for: ImportConfiguration.retryInterval) } catch { return }
            }
        }
    }

    public func stop() { retryTask?.cancel(); retryTask = nil }

    public func enqueue(_ payload: ImportPayload) async throws {
        let sessionID = await client.sessionID()
        try await queue.enqueue(payload, workspaceOrigin: client.origin, sessionID: sessionID)
        pendingCount = try await queue.count()
        onChange?()
    }

    public func pending() async throws -> [QueuedUpload] { try await queue.pending() }

    /// Sealed guided-window downloads that still wait for their preview confirmation.
    public func pendingDownloads() async throws -> [GuidedDownload] {
        var downloads: [GuidedDownload] = []
        for id in try await queue.pendingIDs() { downloads.append(try await queue.read(id)) }
        return downloads
    }

    /// After the preview confirmation, a download joins the session-bound upload flow to `/api/documents`.
    /// The sealed download is removed only once its encrypted upload record exists.
    public func acceptDownload(_ id: UUID) async throws {
        let payload = try await queue.read(id).payload()
        try await enqueue(payload)
        try await queue.acknowledgeUpload(id)
        onChange?()
    }

    public func discardDownload(_ id: UUID) async throws {
        try await queue.acknowledgeUpload(id)
        onChange?()
    }

    public func confirmSession(_ id: UUID) async throws {
        try await mutateQueue {
            guard let sessionID = await client.sessionID() else { throw DocumentImportError.sessionRequired }
            try await queue.confirmSession(id, origin: client.origin, sessionID: sessionID)
        }
        await flush()
    }

    public func discard(_ id: UUID) async throws {
        try await mutateQueue { try await queue.remove(id) }
        await flush()
    }

    private func mutateQueue(_ mutation: () async throws -> Void) async throws {
        guard flushing == false else { throw DocumentImportError.busy }
        flushing = true
        defer { flushing = false; onChange?() }
        try await mutation()
        pendingCount = try await queue.count()
    }

    public func flush() async {
        guard flushing == false else { return }
        flushing = true
        defer { flushing = false; onChange?() }
        do {
            pendingCount = try await queue.count()
            let records = try await queue.pending()
            for record in records {
                try Task.checkCancellation()
                status = .uploading
                onChange?()
                try await client.upload(record)
                // Only the matching server confirmation authorizes deletion. A failed delete retries the same id.
                try await queue.remove(record.id)
                pendingCount -= 1
            }
            status = .ready
        } catch DocumentImportError.sessionChanged { status = .needsSession
        } catch DocumentImportError.sessionRequired { status = .needsSession
        } catch DocumentImportError.uploadRejected { status = .rejected
        } catch DocumentImportError.damagedQueue { status = .storageError
        } catch is CancellationError { return
        } catch { status = .offline }
    }
}
