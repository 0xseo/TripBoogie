package com.tripboogie.app

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.credentials.*
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.lifecycle.lifecycleScope
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.kakao.sdk.common.KakaoSdk
import com.kakao.sdk.common.model.ClientError
import com.kakao.sdk.common.model.ClientErrorCause
import com.kakao.sdk.auth.model.OAuthToken
import com.kakao.sdk.user.UserApiClient
import kotlinx.coroutines.launch
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@CapacitorPlugin(name = "TripBoogieAuth")
class TripBoogieAuthPlugin : Plugin() {
    private var pending: PluginCall? = null
    private val preferences by lazy { context.getSharedPreferences("tripboogie-auth-encrypted", android.content.Context.MODE_PRIVATE) }
    override fun load() { KakaoSdk.init(context, context.getString(R.string.kakao_native_app_key)) }

    @PluginMethod fun signIn(call: PluginCall) {
        activity.runOnUiThread {
            if (pending != null) { call.reject("Login already running", "BUSY"); return@runOnUiThread }
            val nonce = call.getString("nonce") ?: ""
            if (!Regex("^[a-f0-9]{64}$").matches(nonce)) { call.reject("Invalid nonce", "INVALID_NONCE"); return@runOnUiThread }
            pending = call
            when (call.getString("provider")) {
                "google" -> google(nonce)
                "kakao" -> kakao(nonce)
                else -> finish(null, "INVALID_PROVIDER")
            }
        }
    }
    private fun finish(token: String?, code: String? = null) {
        val call = pending ?: return
        pending = null
        if (token.isNullOrBlank()) call.reject("Native authentication did not complete", code ?: "ID_TOKEN_MISSING")
        else call.resolve(JSObject().put("idToken", token))
    }
    private fun google(nonce: String) {
        activity.lifecycleScope.launch {
            try {
                val option = GetSignInWithGoogleOption.Builder(context.getString(R.string.google_web_client_id)).setNonce(nonce).build()
                val result = CredentialManager.create(activity).getCredential(activity, GetCredentialRequest.Builder().addCredentialOption(option).build())
                val credential = result.credential
                if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL)
                    finish(GoogleIdTokenCredential.createFrom(credential.data).idToken)
                else finish(null, "INVALID_CREDENTIAL")
            } catch (_: GetCredentialCancellationException) { finish(null, "CANCELLED") }
            catch (_: Exception) { finish(null, "GOOGLE_LOGIN_FAILED") }
        }
    }
    private fun kakao(nonce: String) {
        val account: (OAuthToken?, Throwable?) -> Unit = { token, error ->
            when {
                error is ClientError && error.reason == ClientErrorCause.Cancelled -> finish(null, "CANCELLED")
                error != null -> finish(null, "KAKAO_LOGIN_FAILED")
                else -> finish(token?.idToken)
            }
        }
        if (UserApiClient.instance.isKakaoTalkLoginAvailable(context)) {
            UserApiClient.instance.loginWithKakaoTalk(activity, nonce = nonce) { token, error ->
                if (error is ClientError && error.reason == ClientErrorCause.Cancelled) finish(null, "CANCELLED")
                else if (error != null) UserApiClient.instance.loginWithKakaoAccount(activity, nonce = nonce, callback = account)
                else finish(token?.idToken)
            }
        } else UserApiClient.instance.loginWithKakaoAccount(activity, nonce = nonce, callback = account)
    }
    @PluginMethod fun clearProviderSession(call: PluginCall) {
        activity.lifecycleScope.launch {
            try { CredentialManager.create(activity).clearCredentialState(ClearCredentialStateRequest()) } catch (_: Exception) { }
            UserApiClient.instance.logout { call.resolve() }
        }
    }
    private fun storageKey(call: PluginCall): String? {
        val key = call.getString("key") ?: ""
        if (!Regex("^tripboogie-auth(?:[-.][A-Za-z0-9_-]+)*$").matches(key) || key.length > 128) {
            call.reject("Invalid storage key", "INVALID_KEY"); return null
        }
        return key
    }
    @Synchronized private fun encryptionKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val alias = "com.tripboogie.app.auth.v1"
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @PluginMethod fun getItem(call: PluginCall) {
        val key = storageKey(call) ?: return
        try {
            val saved = preferences.getString(key, null)
            if (saved == null) { call.resolve(JSObject().put("value", org.json.JSONObject.NULL)); return }
            val bytes = Base64.decode(saved, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            call.resolve(JSObject().put("value", String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)))
        } catch (_: Exception) { call.reject("Could not read secure session", "SECURE_STORAGE_FAILED") }
    }
    @PluginMethod fun setItem(call: PluginCall) {
        val key = storageKey(call) ?: return
        val value = call.getString("value")
        if (value == null || value.length > 1048576) { call.reject("Invalid storage value", "INVALID_VALUE"); return }
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
            val bytes = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            if (!preferences.edit().putString(key, Base64.encodeToString(bytes, Base64.NO_WRAP)).commit()) throw IllegalStateException()
            call.resolve()
        } catch (_: Exception) { call.reject("Could not save secure session", "SECURE_STORAGE_FAILED") }
    }
    @PluginMethod fun removeItem(call: PluginCall) {
        val key = storageKey(call) ?: return
        if (preferences.edit().remove(key).commit()) call.resolve()
        else call.reject("Could not remove secure session", "SECURE_STORAGE_FAILED")
    }
    override fun handleOnDestroy() { finish(null, "CANCELLED"); super.handleOnDestroy() }
}
