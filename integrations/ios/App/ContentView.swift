import SwiftUI

@MainActor struct ContentView: View {
    @ObservedObject private var model = ConnectorModel.shared
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @State private var confirmDisconnect = false
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("환자 기록은 기존 모바일 웹에서 이용합니다. 이 앱은 Apple 건강의 선택 자료를 같은 환자에게 전달합니다.")
                    Text("개발·시험용 연결 앱입니다. 실제 환자 자료를 로그인 없는 공개 데모에 연결하지 마세요.").font(.footnote)
                }
                Section("1. 웹에서 준비한 iPhone 연결 정보") {
                    TextField("HTTPS 서버 주소", text: $model.origin).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("환자 ID · 이름이 아닙니다", text: $model.patientId).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("한 번만 표시된 연결 코드", text: $model.token).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Toggle("이 휴대폰 건강자료의 주체와 선택 환자가 같으며 시험용 사용을 확인합니다", isOn: $model.confirmed)
                    Button("환자 대조 후 연결 저장") { Task { await model.save() } }.disabled(!model.confirmed)
                }.disabled(model.busy)
                Section("2. 수집할 항목과 Apple 건강 권한") {
                    Toggle("걸음 수", isOn: Binding(get: { model.metrics.steps }, set: { value in model.metrics.steps = value; Task { await model.updateMetrics() } }))
                    Toggle("실제 수면 시간", isOn: Binding(get: { model.metrics.sleep }, set: { value in model.metrics.sleep = value; Task { await model.updateMetrics() } }))
                    Button("선택 항목의 읽기 권한 요청") { Task { await model.requestAccess() } }.disabled(model.saved == nil || !model.metrics.any)
                    Text("권한 요청 완료가 실제 허용을 뜻하지 않습니다. 수면은 워치나 호환 앱이 Apple 건강에 기록해야 합니다. 비어 있는 항목은 웹 기록을 지우지 않습니다.").font(.footnote)
                }.disabled(model.busy)
                Section("3. 수신 확인") {
                    if let saved = model.saved {
                        Text("저장된 환자 ID: \(saved.settings.patientId)").textSelection(.enabled)
                        Text(saved.lastReceivedAt.map { "마지막 서버 수신: \($0)" } ?? "아직 서버 수신을 확인하지 않았습니다.").font(.footnote)
                        Button("최근 7일 동기화") { Task { await model.sync() } }.disabled(!model.metrics.any)
                        Toggle("iOS가 허용할 때 자동 수신", isOn: Binding(get: { model.saved?.background == true }, set: { value in Task { await model.setBackground(value) } }))
                        Text("정시·실시간 동기화가 아닙니다. 앱 강제 종료·잠금·절전·자료 공유 지연 시 앱을 열어 다시 동기화해 주세요.").font(.footnote)
                        Button("같은 환자의 웹 기록 열기") { openURL(saved.settings.patientURL) }
                        Button("이 휴대폰 연결 해제", role: .destructive) { confirmDisconnect = true }
                    } else { Text("연결을 먼저 저장해 주세요.") }
                }.disabled(model.busy)
                Section("작업 상태") {
                    if model.busy { ProgressView("처리 중…") }
                    Text(model.status).accessibilityIdentifier("connector-status")
                }
            }
            .navigationTitle("HomeCare 건강 연결")
            .task { await model.start() }
            .onChange(of: scenePhase) { phase in if phase == .active { Task { await model.foreground() } } }
            .confirmationDialog("로컬 연결과 대기 자료를 지울까요?", isPresented: $confirmDisconnect) {
                Button("연결 해제", role: .destructive) { Task { await model.disconnect() } }
                Button("취소", role: .cancel) {}
            }
        }
    }
}
