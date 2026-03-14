package com.thisux.droidclaw.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import org.json.JSONArray
import java.util.UUID

val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

object SettingsKeys {
    val API_KEY = stringPreferencesKey("api_key")
    val SERVER_URL = stringPreferencesKey("server_url")
    val DEVICE_NAME = stringPreferencesKey("device_name")
    val AUTO_CONNECT = booleanPreferencesKey("auto_connect")
    val RECENT_GOALS = stringPreferencesKey("recent_goals")
    val DEVICE_FINGERPRINT = stringPreferencesKey("device_fingerprint")
    val DEVICE_STATUS = stringPreferencesKey("device_status") // "pending" | "active" | "rejected"
}

class SettingsStore(private val context: Context) {

    val apiKey: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[SettingsKeys.API_KEY] ?: ""
    }

    val serverUrl: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[SettingsKeys.SERVER_URL] ?: ""
    }

    val deviceName: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[SettingsKeys.DEVICE_NAME] ?: android.os.Build.MODEL
    }

    val autoConnect: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[SettingsKeys.AUTO_CONNECT] ?: false
    }

    val deviceFingerprint: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[SettingsKeys.DEVICE_FINGERPRINT] ?: ""
    }

    val deviceStatus: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[SettingsKeys.DEVICE_STATUS] ?: ""
    }

    suspend fun setApiKey(value: String) {
        context.dataStore.edit { it[SettingsKeys.API_KEY] = value }
    }

    suspend fun setServerUrl(value: String) {
        context.dataStore.edit { it[SettingsKeys.SERVER_URL] = value }
    }

    suspend fun setDeviceName(value: String) {
        context.dataStore.edit { it[SettingsKeys.DEVICE_NAME] = value }
    }

    suspend fun setAutoConnect(value: Boolean) {
        context.dataStore.edit { it[SettingsKeys.AUTO_CONNECT] = value }
    }

    suspend fun setDeviceStatus(value: String) {
        context.dataStore.edit { it[SettingsKeys.DEVICE_STATUS] = value }
    }

    /**
     * Returns the device fingerprint, generating and storing a UUID on first access.
     */
    suspend fun getOrCreateFingerprint(): String {
        val existing = deviceFingerprint.first()
        if (existing.isNotBlank()) return existing
        val newFingerprint = UUID.randomUUID().toString()
        context.dataStore.edit { it[SettingsKeys.DEVICE_FINGERPRINT] = newFingerprint }
        return newFingerprint
    }

    suspend fun clearApiKey() {
        context.dataStore.edit { it.remove(SettingsKeys.API_KEY) }
    }

    val recentGoals: Flow<List<String>> = context.dataStore.data.map { prefs ->
        val json = prefs[SettingsKeys.RECENT_GOALS] ?: "[]"
        try {
            JSONArray(json).let { arr ->
                (0 until arr.length()).map { arr.getString(it) }
            }
        } catch (_: Exception) { emptyList() }
    }

    suspend fun addRecentGoal(goal: String) {
        context.dataStore.edit { prefs ->
            val current = try {
                JSONArray(prefs[SettingsKeys.RECENT_GOALS] ?: "[]").let { arr ->
                    (0 until arr.length()).map { arr.getString(it) }
                }
            } catch (_: Exception) { emptyList() }
            val updated = (listOf(goal) + current.filter { it != goal }).take(5)
            prefs[SettingsKeys.RECENT_GOALS] = JSONArray(updated).toString()
        }
    }
}
