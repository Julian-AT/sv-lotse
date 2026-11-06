import CryptoKit
import Foundation
import Security

enum UploadQueueKey {
    static func load() throws -> SymmetricKey {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: UploadQueueConfiguration.keychainService,
            kSecAttrAccount as String: UploadQueueConfiguration.keychainAccount,
            kSecReturnData as String: true
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, data.count == 32 {
            return SymmetricKey(data: data)
        }
        guard status == errSecItemNotFound else { throw UploadQueueError.keyUnavailable }
        let key = SymmetricKey(size: .bits256)
        var attributes = query
        attributes.removeValue(forKey: kSecReturnData as String)
        attributes[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let added = SecItemAdd(attributes as CFDictionary, nil)
        if added == errSecDuplicateItem { return try load() }
        guard added == errSecSuccess else { throw UploadQueueError.keyUnavailable }
        return key
    }

    static func loadOrCreate() throws -> SymmetricKey {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: ImportConfiguration.keychainService,
            kSecAttrAccount as String: ImportConfiguration.keychainAccount,
            kSecAttrSynchronizable as String: false
        ]
        var result: CFTypeRef?
        let read = query.merging([kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]) { _, new in new }
        let status = SecItemCopyMatching(read as CFDictionary, &result)
        if status == errSecSuccess, let data = result as? Data, data.count == 32 {
            return SymmetricKey(data: data)
        }
        guard status == errSecItemNotFound else { throw DocumentImportError.keychainUnavailable }
        let key = SymmetricKey(size: .bits256)
        let attributes = query.merging([
            kSecValueData as String: key.withUnsafeBytes { Data($0) },
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]) { _, new in new }
        let added = SecItemAdd(attributes as CFDictionary, nil)
        if added == errSecDuplicateItem { return try loadOrCreate() }
        guard added == errSecSuccess else { throw DocumentImportError.keychainUnavailable }
        return key
    }
}
