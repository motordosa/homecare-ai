import Foundation

enum ConnectorError: Error, LocalizedError {
    case invalidOrigin, invalidSettings, wrongTarget, oldServer, noMetrics, noReadableData, invalidReading
    case accessDenied, batchConflict, requestRejected, serverFailure, invalidResponse, network
    var errorDescription: String? {
        switch self {
        case .invalidOrigin: return "서버 주소는 경로·쿼리·계정 정보 없는 HTTPS 주소를 입력해 주세요."
        case .invalidSettings: return "환자 ID와 연결 코드를 웹의 일회성 안내와 대조해 주세요."
        case .wrongTarget: return "환자·Apple 건강 연결·선택 출처가 일치하지 않습니다. 웹에서 새 연결을 확인해 주세요."
        case .oldServer: return "서버를 최신 버전으로 배포한 뒤 다시 연결해 주세요."
        case .noMetrics: return "걸음 또는 수면을 하나 이상 선택해 주세요."
        case .noReadableData: return "읽을 수 있는 자료가 없습니다. Apple 건강의 자료 공유·읽기 권한을 확인해 주세요. 기존 웹 기록은 유지됩니다."
        case .invalidReading: return "건강 집계의 날짜·범위를 확인할 수 없어 전송하지 않았습니다."
        case .accessDenied: return "연결 코드가 폐기되었거나 유효하지 않습니다. 웹에서 새 코드를 준비해 주세요."
        case .batchConflict: return "전송 배치가 충돌했습니다. 연결을 확인하고 다시 수집해 주세요."
        case .requestRejected: return "서버가 자료를 받지 못했습니다. 최신 서버·연결·날짜를 확인해 주세요."
        case .serverFailure: return "서버가 잠시 응답하지 못했습니다. 다음 동기화 때 다시 조회합니다."
        case .invalidResponse: return "서버 응답을 확인할 수 없습니다. 주소와 배포 상태를 확인해 주세요."
        case .network: return "서버에 연결하지 못했습니다. HTTPS 주소와 네트워크를 확인해 주세요."
        }
    }
}

struct MetricSelection: Codable, Equatable {
    var steps = true
    var sleep = true
    var any: Bool { steps || sleep }
}

struct ConnectionSettings: Codable, Equatable {
    let origin: URL
    let patientId: String
    let token: String
    init(origin: String, patientId: String, token: String) throws {
        let source = origin.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parts = URLComponents(string: source), parts.scheme?.lowercased() == "https",
              let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil, ["", "/"].contains(parts.percentEncodedPath),
              parts.port == nil || parts.port == 443, let url = parts.url else { throw ConnectorError.invalidOrigin }
        let id = patientId.trimmingCharacters(in: .whitespacesAndNewlines)
        let secret = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, id.count <= 128, id.rangeOfCharacter(from: .controlCharacters) == nil,
              secret.range(of: "^hc_[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { throw ConnectorError.invalidSettings }
        var normalized = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        normalized.path = ""; normalized.scheme = "https"
        self.origin = normalized.url!; self.patientId = id; self.token = secret
    }
    var patientURL: URL {
        var parts = URLComponents(url: origin.appendingPathComponent("patient"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "patientId", value: patientId), URLQueryItem(name: "view", value: "connections")]
        return parts.url!
    }
}

struct ConnectionIdentity: Codable {
    let connectionId: String
    let patientId: String
    let platform: String
    let partialMetrics: Bool
    let selected: Bool
    let serverTime: String?
    func validate(for settings: ConnectionSettings) throws -> Date {
        guard patientId == settings.patientId, platform == "apple-health", selected else { throw ConnectorError.wrongTarget }
        guard partialMetrics, let time = serverTime, let date = SeoulDays.parseTimestamp(time) else { throw ConnectorError.oldServer }
        return date
    }
}

struct DayWindow {
    let date: String
    let start: Date
    let end: Date
}

enum SeoulDays {
    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        return calendar
    }
    static func key(_ date: Date) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
    }
    static func recent(now: Date, count: Int = 7) -> [DayWindow] {
        let today = calendar.startOfDay(for: now)
        return (0..<count).reversed().map { offset in
            let start = calendar.date(byAdding: .day, value: -offset, to: today)!
            return DayWindow(date: key(start), start: start, end: calendar.date(byAdding: .day, value: 1, to: start)!)
        }
    }
    static func parseTimestamp(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
    static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

struct SleepInterval {
    let start: Date
    let end: Date
    let category: Int // HealthKit: asleep unspecified=1, core=3, deep=4, REM=5.
}

enum SleepUnion {
    static func minutes(_ samples: [SleepInterval], in window: DayWindow) -> Double? {
        let ranges = samples.filter { [1, 3, 4, 5].contains($0.category) }
            .map { (max($0.start, window.start), min($0.end, window.end)) }
            .filter { $0.1 > $0.0 }.sorted { $0.0 < $1.0 }
        guard var current = ranges.first else { return nil }
        var seconds: Double = 0
        for range in ranges.dropFirst() {
            if range.0 <= current.1 { current.1 = max(current.1, range.1) }
            else { seconds += current.1.timeIntervalSince(current.0); current = range }
        }
        seconds += current.1.timeIntervalSince(current.0)
        return seconds / 60
    }
}

struct DayReading: Codable, Equatable {
    let date: String
    var steps: Int?
    var sleepMinutes: Double?
    var updatedAt: String
}

struct SyncBatch: Codable, Equatable {
    func encoded() throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }
    let batchId: String
    let timeZone: String
    let days: [DayReading]
    static func make(readings: [DayReading], metrics: MetricSelection, revision: Date, batchId: String = UUID().uuidString) throws -> SyncBatch {
        guard metrics.any else { throw ConnectorError.noMetrics }
        let allowed = Set(SeoulDays.recent(now: revision).map(\.date))
        var dates = Set<String>()
        let days = try readings.compactMap { reading -> DayReading? in
            guard allowed.contains(reading.date), dates.insert(reading.date).inserted else { throw ConnectorError.invalidReading }
            let steps = metrics.steps ? reading.steps : nil
            let sleep = metrics.sleep ? reading.sleepMinutes : nil
            if let steps = steps, !(0...100000).contains(steps) { throw ConnectorError.invalidReading }
            if let sleep = sleep, !sleep.isFinite || !(0...1440).contains(sleep) { throw ConnectorError.invalidReading }
            guard steps != nil || sleep != nil else { return nil }
            return DayReading(date: reading.date, steps: steps, sleepMinutes: sleep, updatedAt: SeoulDays.timestamp(revision))
        }
        guard !days.isEmpty else { throw ConnectorError.noReadableData }
        return SyncBatch(batchId: batchId, timeZone: "Asia/Seoul", days: days.sorted { $0.date < $1.date })
    }
    // Compare values after a fresh read; revisions/UUIDs deliberately differ.
    func hasSameValues(as other: SyncBatch) -> Bool {
        guard days.count == other.days.count else { return false }
        return zip(days, other.days).allSatisfy { $0.date == $1.date && $0.steps == $1.steps && $0.sleepMinutes == $1.sleepMinutes }
    }
}

struct SyncReceipt: Codable {
    let connectionId: String
    let patientId: String
    let batchId: String
    let duplicate: Bool
    let acceptedDays: Int
    let ignoredDays: Int
    let receivedAt: String
}
