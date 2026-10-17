import Foundation
import Combine

@MainActor final class ConnectorModel: ObservableObject {
    static let shared = ConnectorModel()
    @Published var origin = "https://homecare-ai-demo.onrender.com"
    @Published var patientId = ""
    @Published var token = ""
    @Published var confirmed = false
    @Published var metrics = MetricSelection()
    @Published private(set) var saved: SavedConnection?
    @Published private(set) var busy = false
    @Published private(set) var status = "웹의 건강 연결에서 iPhone 연결 코드를 준비해 주세요."
    private let secure = SecureStore()
    private let reader = HealthReader()
    private var started = false

    func start() async {
        guard !started else { return }; started = true
        busy = true; defer { busy = false }
        do {
            if let stored = try secure.load(SavedConnection.self, account: "connection") {
                // Revalidate decoded settings, including credentials-free HTTPS origin.
                _ = try ConnectionSettings(origin: stored.settings.origin.absoluteString, patientId: stored.settings.patientId, token: stored.settings.token)
                saved = stored; origin = stored.settings.origin.absoluteString; patientId = stored.settings.patientId; metrics = stored.metrics
                status = "저장한 연결을 불러왔습니다. 권한·자료 공유는 Apple 건강에서 확인해 주세요."
                if stored.background { await configureObservers() }
            }
        } catch { status = ConnectorError.invalidSettings.localizedDescription }
    }
    func save() async {
        guard !busy else { return }
        guard confirmed else { status = "건강자료의 주체와 시험용 사용 확인이 필요합니다."; return }
        busy = true; defer { busy = false }
        do {
            guard metrics.any else { throw ConnectorError.noMetrics }
            let settings = try ConnectionSettings(origin: origin, patientId: patientId, token: token)
            let identity = try await ConnectorAPI(settings: settings).preflight()
            _ = try identity.validate(for: settings)
            let value = SavedConnection(settings: settings, metrics: metrics, background: false)
            try secure.save(value, account: "connection")
            await reader.disableDelivery(); secure.remove("pending")
            saved = value; token = ""; confirmed = false
            status = "같은 환자의 Apple 건강 연결을 저장했습니다. 읽기 권한을 요청한 뒤 동기화해 주세요."
        } catch { status = safeMessage(error) }
    }
    func requestAccess() async {
        guard !busy, saved != nil else { return }
        busy = true; defer { busy = false }
        do {
            try await reader.requestAccess(metrics)
            status = "읽기 권한 요청을 마쳤습니다. 실제 허용·자료 공유 여부는 동기화 결과와 Apple 건강에서 확인해 주세요."
        } catch { status = safeMessage(error) }
    }
    func updateMetrics() async {
        guard !busy, var value = saved else { return }
        busy = true; defer { busy = false }
        await reader.disableDelivery(); value.metrics = metrics; value.background = false
        do { try secure.save(value, account: "connection"); saved = value; secure.remove("pending")
            status = "수집 항목을 변경하고 자동 수신을 껐습니다. 읽기 권한을 다시 확인해 주세요."
        } catch { metrics = saved?.metrics ?? MetricSelection(); status = safeMessage(error) }
    }
    func sync() async {
        guard !busy, let connection = saved else { return }
        busy = true; defer { busy = false }
        do {
            let api = ConnectorAPI(settings: connection.settings)
            let identity = try await api.preflight()
            let now = try identity.validate(for: connection.settings)
            let readings = try await reader.read(connection.metrics, now: now)
            let freshIdentity = try await api.preflight()
            let revision = try freshIdentity.validate(for: connection.settings)
            guard freshIdentity.connectionId == identity.connectionId else { throw ConnectorError.wrongTarget }
            let fresh = try SyncBatch.make(readings: readings, metrics: connection.metrics, revision: revision)
            let pending = try secure.load(PendingUpload.self, account: "pending")
            let batch = pending?.connectionId == identity.connectionId && pending?.metrics == connection.metrics && pending?.batch.hasSameValues(as: fresh) == true ? pending!.batch : fresh
            try secure.save(PendingUpload(batch: batch, metrics: connection.metrics, connectionId: identity.connectionId), account: "pending")
            let receipt = try await api.upload(batch)
            guard receipt.connectionId == identity.connectionId else { throw ConnectorError.invalidResponse }
            secure.remove("pending")
            var updated = connection; updated.lastReceivedAt = receipt.receivedAt
            try secure.save(updated, account: "connection"); saved = updated
            status = "서버 수신 확인: \(receipt.acceptedDays)일 반영 · \(receipt.ignoredDays)일 기존/중복 보존. 수신 시각 \(receipt.receivedAt)"
        } catch {
            // A fresh HealthKit read is required before retrying a persisted batch.
            // Revoked read permission looks empty: never upload yesterday's queue blindly.
            if let issue = error as? ConnectorError {
                switch issue {
                case .network, .serverFailure: break
                default: secure.remove("pending")
                }
            }
            status = safeMessage(error)
        }
    }
    func setBackground(_ enabled: Bool) async {
        guard !busy, var value = saved else { return }
        busy = true; defer { busy = false }
        if !enabled { await reader.disableDelivery() }
        value.background = enabled
        do {
            guard !enabled || value.metrics.any else { throw ConnectorError.noMetrics }
            try secure.save(value, account: "connection"); saved = value
            if enabled { await configureObservers() }
            else { status = "자동 수신을 껐습니다. 앱을 열어 수동 동기화할 수 있습니다." }
        } catch { status = safeMessage(error) }
    }
    private func configureObservers() async {
        guard let connection = saved, connection.background else { return }
        do {
            try await reader.observe(connection.metrics) { [weak self] completion in
                Task { @MainActor in
                    defer { completion() }
                    guard let self = self, self.saved?.background == true else { return }
                    await self.sync()
                }
            }
            status = "자동 수신을 요청했습니다. 잠금·절전·강제 종료 등 iOS 정책에 따라 지연되며 정시 전송을 보장하지 않습니다."
        } catch {
            if var value = saved { value.background = false; try? secure.save(value, account: "connection"); saved = value }
            status = "자동 수신을 설정하지 못했습니다. 앱을 열어 동기화해 주세요."
        }
    }
    func foreground() async { if saved?.background == true { await sync() } }
    func disconnect() async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        await reader.disableDelivery(); secure.remove("connection"); secure.remove("pending")
        saved = nil; token = ""; confirmed = false
        status = "이 휴대폰의 연결과 대기 자료를 지웠습니다. 서버 연결 폐기는 웹의 건강 연결에서 실행해 주세요."
    }
    private func safeMessage(_ error: Error) -> String { (error as? ConnectorError)?.localizedDescription ?? "작업을 완료하지 못했습니다. 연결과 기기 설정을 확인해 주세요." }
}
