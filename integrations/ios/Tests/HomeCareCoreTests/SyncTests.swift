import XCTest
@testable import HomeCareCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

final class SyncTests: XCTestCase {
    let token = "hc_" + String(repeating: "a", count: 43)
    var now: Date { SeoulDays.parseTimestamp("2026-10-17T01:30:00.000Z")! }
    func settings() throws -> ConnectionSettings { try ConnectionSettings(origin: "https://example.com/", patientId: "p1", token: token) }
    func testOriginAndPatientURLExcludeCredentials() throws {
        let settings = try settings()
        XCTAssertEqual(settings.origin.absoluteString, "https://example.com")
        let url = URLComponents(url: settings.patientURL, resolvingAgainstBaseURL: false)!
        XCTAssertEqual(url.path, "/patient")
        XCTAssertEqual(url.queryItems?.first(where: { $0.name == "patientId" })?.value, "p1")
        XCTAssertFalse(settings.patientURL.absoluteString.contains(token))
        for origin in ["http://example.com", "https://a:b@example.com", "https://example.com/patient", "https://example.com?token=a", "https://example.com#fragment", "https://example.com:8443"] {
            XCTAssertThrowsError(try ConnectionSettings(origin: origin, patientId: "p1", token: token), origin)
        }
        XCTAssertThrowsError(try ConnectionSettings(origin: "https://example.com", patientId: "", token: token))
        XCTAssertThrowsError(try ConnectionSettings(origin: "https://example.com", patientId: "p1", token: "bad"))
    }
    func testPreflightRejectsWrongPatientPlatformSelectionAndOldServer() throws {
        let settings = try settings()
        for (patient, platform, selected, partial, time) in [
            ("p2", "apple-health", true, true, "2026-10-17T01:30:00Z"),
            ("p1", "health-connect", true, true, "2026-10-17T01:30:00Z"),
            ("p1", "apple-health", false, true, "2026-10-17T01:30:00Z"),
            ("p1", "apple-health", true, false, "2026-10-17T01:30:00Z"),
            ("p1", "apple-health", true, true, "invalid")
        ] {
            let identity = ConnectionIdentity(connectionId: "c", patientId: patient, platform: platform, partialMetrics: partial, selected: selected, serverTime: time)
            XCTAssertThrowsError(try identity.validate(for: settings))
        }
        let identity = ConnectionIdentity(connectionId: "c", patientId: "p1", platform: "apple-health", partialMetrics: true, selected: true, serverTime: "2026-10-17T01:30:00.000Z")
        XCTAssertEqual(try identity.validate(for: settings), now)
    }
    func testSeoulBoundaryAndSevenDays() {
        XCTAssertEqual(SeoulDays.key(SeoulDays.parseTimestamp("2026-10-16T15:01:00Z")!), "2026-10-17")
        let days = SeoulDays.recent(now: now)
        XCTAssertEqual(days.count, 7)
        XCTAssertEqual(days.first?.date, "2026-10-11")
        XCTAssertEqual(days.last?.date, "2026-10-17")
        XCTAssertEqual(days.last!.end.timeIntervalSince(days.last!.start), 86400)
    }
    func testSleepUnionRemovesDuplicateStagesAndExcludesInBedAwake() {
        let day = SeoulDays.recent(now: now).last!
        func sample(_ start: Double, _ end: Double, _ category: Int) -> SleepInterval {
            SleepInterval(start: day.start.addingTimeInterval(start * 60), end: day.start.addingTimeInterval(end * 60), category: category)
        }
        XCTAssertEqual(SleepUnion.minutes([sample(0,60,1), sample(30,90,3), sample(40,50,4), sample(0,120,0), sample(90,110,2)], in: day), 90)
        XCTAssertNil(SleepUnion.minutes([sample(0,120,0), sample(0,90,2)], in: day))
    }
    func testSleepCrossingMidnightIsClippedPerSeoulDate() {
        let days = SeoulDays.recent(now: now), today = days.last!, yesterday = days[5]
        let sleep = SleepInterval(start: today.start.addingTimeInterval(-3600), end: today.start.addingTimeInterval(7200), category: 5)
        XCTAssertEqual(SleepUnion.minutes([sleep], in: yesterday), 60)
        XCTAssertEqual(SleepUnion.minutes([sleep], in: today), 120)
    }
    func testSelectedAndEmptyMetricsAreOmittedWithoutNullingStoredValues() throws {
        let day = DayReading(date: "2026-10-17", steps: 0, sleepMinutes: 420, updatedAt: "unused")
        let batch = try SyncBatch.make(readings: [day], metrics: MetricSelection(steps: true, sleep: false), revision: now, batchId: "fixture")
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(batch)) as! [String: Any]
        let encoded = (json["days"] as! [[String: Any]])[0]
        XCTAssertEqual(encoded["steps"] as? Int, 0)
        XCTAssertNil(encoded["sleepMinutes"])
        XCTAssertEqual(encoded["updatedAt"] as? String, "2026-10-17T01:30:00.000Z")
        let sleep = try SyncBatch.make(readings: [day], metrics: MetricSelection(steps: false, sleep: true), revision: now)
        XCTAssertNil(sleep.days[0].steps)
        XCTAssertEqual(sleep.days[0].sleepMinutes, 420)
        XCTAssertThrowsError(try SyncBatch.make(readings: [day], metrics: MetricSelection(steps: false, sleep: false), revision: now))
        XCTAssertThrowsError(try SyncBatch.make(readings: [DayReading(date: day.date, updatedAt: "")], metrics: MetricSelection(), revision: now))
    }
    func testPayloadRejectsFutureDuplicateAndOutOfRangeData() {
        for readings in [
            [DayReading(date: "2026-10-18", steps: 2, updatedAt: "")],
            [DayReading(date: "2026-10-17", steps: -1, updatedAt: "")],
            [DayReading(date: "2026-10-17", sleepMinutes: .nan, updatedAt: "")],
            [DayReading(date: "2026-10-17", sleepMinutes: 1441, updatedAt: "")],
            [DayReading(date: "2026-10-17", steps: 1, updatedAt: ""), DayReading(date: "2026-10-17", steps: 2, updatedAt: "")]
        ] { XCTAssertThrowsError(try SyncBatch.make(readings: readings, metrics: MetricSelection(), revision: now)) }
    }
    func testRetryKeepsBodyOnlyWhenFreshReadHasSameValues() throws {
        let reading = DayReading(date: "2026-10-17", steps: 10, sleepMinutes: 300, updatedAt: "")
        let original = try SyncBatch.make(readings: [reading], metrics: MetricSelection(), revision: now)
        let fresh = try SyncBatch.make(readings: [reading], metrics: MetricSelection(), revision: now.addingTimeInterval(60))
        XCTAssertTrue(original.hasSameValues(as: fresh))
        let revoked = try SyncBatch.make(readings: [reading], metrics: MetricSelection(steps: true, sleep: false), revision: now)
        XCTAssertFalse(original.hasSameValues(as: revoked))
        let restored = try JSONDecoder().decode(SyncBatch.self, from: JSONEncoder().encode(original))
        XCTAssertEqual(original, restored)
        XCTAssertEqual(try original.encoded(), try restored.encoded())
    }
}

final class StubProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, data) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
final class APITests: XCTestCase {
    func api() throws -> ConnectorAPI {
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [StubProtocol.self]
        return ConnectorAPI(settings: try ConnectionSettings(origin: "https://example.com", patientId: "p1", token: "hc_" + String(repeating: "a", count: 43)), session: URLSession(configuration: configuration))
    }
    func testPreflightUsesBearerAndFixedRelativePath() async throws {
        StubProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/api/health-sync/connection")
            XCTAssertTrue(request.value(forHTTPHeaderField: "Authorization")!.hasPrefix("Bearer hc_"))
            return (200, Data(#"{"connectionId":"c1","patientId":"p1","platform":"apple-health","partialMetrics":true,"selected":true,"serverTime":"2026-10-17T01:30:00Z"}"#.utf8))
        }
        let identity = try await api().preflight()
        XCTAssertEqual(identity.patientId, "p1")
    }
    func testHTTPFailuresNeverExposeServerOrTokenText() async throws {
        for status in [301,400,401,403,409,429,500] {
            StubProtocol.handler = { _ in (status, Data("private provider error / secret".utf8)) }
            do { _ = try await api().preflight(); XCTFail("Unexpected success") }
            catch { XCTAssertFalse(error.localizedDescription.contains("private provider")); XCTAssertFalse(error.localizedDescription.contains("secret")) }
        }
    }
    func testUploadRejectsMismatchedReceipt() async throws {
        StubProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            return (200, Data(#"{"connectionId":"c1","patientId":"other","batchId":"fixture","duplicate":false,"acceptedDays":1,"ignoredDays":0,"receivedAt":"2026-10-17T01:30:00Z"}"#.utf8))
        }
        let batch = SyncBatch(batchId: "fixture", timeZone: "Asia/Seoul", days: [DayReading(date: "2026-10-17", steps: 1, updatedAt: "")])
        do { _ = try await api().upload(batch); XCTFail("Unexpected success") }
        catch { XCTAssertEqual(error as? ConnectorError, .invalidResponse) }
    }
}
