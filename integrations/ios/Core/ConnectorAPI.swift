import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

final class ConnectorAPI {
    let settings: ConnectionSettings
    private let session: URLSession
    init(settings: ConnectionSettings, session: URLSession? = nil) {
        self.settings = settings
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 25
        configuration.timeoutIntervalForResource = 35
        configuration.urlCache = nil
        self.session = session ?? URLSession(configuration: configuration, delegate: NoRedirect(), delegateQueue: nil)
    }
    private func request<T: Decodable>(_ path: String, body: Data? = nil) async throws -> T {
        var request = URLRequest(url: settings.origin.appendingPathComponent(path))
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("Bearer \(settings.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let data: Data, response: URLResponse
        do { (data, response) = try await session.data(for: request) }
        catch { throw ConnectorError.network }
        guard let http = response as? HTTPURLResponse else { throw ConnectorError.invalidResponse }
        switch http.statusCode {
        case 200: break
        case 401, 403: throw ConnectorError.accessDenied
        case 409: throw ConnectorError.batchConflict
        case 400..<500: throw ConnectorError.requestRejected
        case 500..<600: throw ConnectorError.serverFailure
        default: throw ConnectorError.invalidResponse
        }
        guard data.count < 131072 else { throw ConnectorError.invalidResponse }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw ConnectorError.invalidResponse }
    }
    func preflight() async throws -> ConnectionIdentity { try await request("api/health-sync/connection") }
    func upload(_ batch: SyncBatch) async throws -> SyncReceipt {
        let receipt: SyncReceipt = try await request("api/health-sync", body: batch.encoded())
        guard receipt.patientId == settings.patientId, receipt.batchId == batch.batchId,
              receipt.acceptedDays >= 0, receipt.ignoredDays >= 0,
              receipt.acceptedDays + receipt.ignoredDays == batch.days.count else { throw ConnectorError.invalidResponse }
        return receipt
    }
}
