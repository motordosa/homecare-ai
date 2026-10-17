import Foundation
import Security

struct SavedConnection: Codable {
    var settings: ConnectionSettings
    var metrics: MetricSelection
    var background: Bool
    var lastReceivedAt: String?
}
struct PendingUpload: Codable {
    let batch: SyncBatch
    let metrics: MetricSelection
    let connectionId: String
}

final class SecureStore {
    private let service = "ai.homecare.connector.ios"
    func load<T: Decodable>(_ type: T.Type, account: String) throws -> T? {
        var query = base(account)
        query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw ConnectorError.invalidSettings }
        do { return try JSONDecoder().decode(type, from: data) }
        catch { throw ConnectorError.invalidSettings }
    }
    func save<T: Encodable>(_ value: T, account: String) throws {
        let attributes: [String: Any] = [kSecValueData as String: try JSONEncoder().encode(value),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(base(account) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(base(account).merging(attributes) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw ConnectorError.invalidSettings }
    }
    func remove(_ account: String) { SecItemDelete(base(account) as CFDictionary) }
    private func base(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: account, kSecAttrSynchronizable as String: false]
    }
}
