import Capacitor
import Security
import GoogleSignIn
import KakaoSDKCommon
import KakaoSDKAuth
import KakaoSDKUser

@objc(TripBoogieAuthPlugin)
public class TripBoogieAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TripBoogieAuthPlugin"
    public let jsName = "TripBoogieAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearProviderSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getItem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setItem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeItem", returnType: CAPPluginReturnPromise)
    ]
    private var pending: CAPPluginCall?
    @objc func signIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pending == nil else { call.reject("Login already running", "BUSY"); return }
            guard let nonce = call.getString("nonce"), nonce.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { call.reject("Invalid nonce", "INVALID_NONCE"); return }
            self.pending = call
            if call.getString("provider") == "google" { self.google(nonce) }
            else if call.getString("provider") == "kakao" { self.kakao(nonce) }
            else { self.finish(nil, "INVALID_PROVIDER") }
        }
    }
    private func finish(_ token: String?, _ code: String = "ID_TOKEN_MISSING") {
        guard let call = pending else { return }; pending = nil
        guard let token = token, !token.isEmpty else { call.reject("Native authentication did not complete", code); return }
        call.resolve(["idToken": token])
    }
    private func google(_ nonce: String) {
        guard let viewController = bridge?.viewController else { finish(nil, "UNAVAILABLE"); return }
        GIDSignIn.sharedInstance.signIn(withPresenting: viewController, hint: nil, additionalScopes: nil, nonce: nonce) { result, error in
            if let error = error as NSError? {
                self.finish(nil, error.code == -5 ? "CANCELLED" : "GOOGLE_LOGIN_FAILED")
            } else { self.finish(result?.user.idToken?.tokenString) }
        }
    }
    private func kakao(_ nonce: String) {
        let callback: (OAuthToken?, Error?) -> Void = { token, error in
            if error != nil { self.finish(nil, "KAKAO_LOGIN_FAILED") }
            else { self.finish(token?.idToken) }
        }
        if UserApi.isKakaoTalkLoginAvailable() {
            UserApi.shared.loginWithKakaoTalk(nonce: nonce) { token, error in
                if let token = token { self.finish(token.idToken) }
                // A cancelled Talk login must not open a second login prompt.
                else if let error = error as? SdkError, case .ClientFailed(let reason, _) = error, reason == .Cancelled { self.finish(nil, "CANCELLED") }
                else { UserApi.shared.loginWithKakaoAccount(nonce: nonce, completion: callback) }
            }
        } else { UserApi.shared.loginWithKakaoAccount(nonce: nonce, completion: callback) }
    }
    @objc func clearProviderSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            GIDSignIn.sharedInstance.signOut()
            TokenManager.manager.setToken(nil)
            call.resolve()
        }
    }
    private func query(_ call: CAPPluginCall) -> [String: Any]? {
        guard let key = call.getString("key"), key.count <= 128,
              key.range(of: "^tripboogie-auth(?:[-.][A-Za-z0-9_-]+)*$", options: .regularExpression) != nil else {
            call.reject("Invalid storage key", "INVALID_KEY"); return nil
        }
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.tripboogie.app.auth.v1", kSecAttrAccount as String: key]
    }
    @objc func getItem(_ call: CAPPluginCall) {
        guard var query = query(call) else { return }
        query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var data: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &data)
        if status == errSecItemNotFound { call.resolve(["value": NSNull()]); return }
        guard status == errSecSuccess, let bytes = data as? Data, let value = String(data: bytes, encoding: .utf8) else { call.reject("Could not read secure session", "SECURE_STORAGE_FAILED"); return }
        call.resolve(["value": value])
    }
    @objc func setItem(_ call: CAPPluginCall) {
        guard let query = query(call) else { return }
        guard let value = call.getString("value"), value.utf8.count <= 1048576 else { call.reject("Invalid storage value", "INVALID_VALUE"); return }
        let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var newItem = query; attributes.forEach { newItem[$0.key] = $0.value }
            status = SecItemAdd(newItem as CFDictionary, nil)
        }
        if status == errSecSuccess { call.resolve() }
        else { call.reject("Could not save secure session", "SECURE_STORAGE_FAILED") }
    }
    @objc func removeItem(_ call: CAPPluginCall) {
        guard let query = query(call) else { return }
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound { call.resolve() }
        else { call.reject("Could not remove secure session", "SECURE_STORAGE_FAILED") }
    }
}
