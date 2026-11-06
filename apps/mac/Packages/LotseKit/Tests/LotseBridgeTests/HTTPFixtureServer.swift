import Foundation
import Network
import Testing

enum FixtureError: Error { case timeout, missingResource }

/// A real loopback HTTP server: WebKit derives securityOrigin from the loaded response.
@MainActor
final class HTTPFixtureServer {
    private let listener: NWListener
    private var connections: [NWConnection] = []
    private(set) var port: UInt16 = 0
    var url: URL { get throws { try #require(URL(string: "http://127.0.0.1:\(port)/echo.html")) } }

    init() throws {
        guard let resource = Bundle.module.url(forResource: "echo", withExtension: "html", subdirectory: "Resources") else {
            throw FixtureError.missingResource
        }
        let html = try Data(contentsOf: resource)
        let header = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: \(html.count)\r\nConnection: close\r\n\r\n"
        let response = Data(header.utf8) + html
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        listener = try NWListener(using: parameters)
        listener.stateUpdateHandler = { [weak self] state in
            MainActor.assumeIsolated {
                if case .ready = state { self?.port = self?.listener.port?.rawValue ?? 0 }
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            MainActor.assumeIsolated {
                self?.connections.append(connection)
                connection.start(queue: .main)
                connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { _, _, _, _ in
                    connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
                }
            }
        }
        listener.start(queue: .main)
    }

    func stop() {
        listener.cancel()
        connections.forEach { $0.cancel() }
    }
}
