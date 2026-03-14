package com.thisux.droidclaw.connection

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class RegisterRequest(
    val deviceFingerprint: String,
    val name: String,
    val model: String,
    val androidVersion: String
)

@Serializable
data class RegisterResponse(
    val deviceId: String,
    val status: String
)

@Serializable
data class StatusResponse(
    val status: String,
    val token: String? = null,
    val deviceId: String? = null
)

@Serializable
data class RegistrationError(val error: String)

object DeviceRegistrationApi {
    private val json = Json { ignoreUnknownKeys = true }

    private val client = HttpClient(OkHttp) {
        install(ContentNegotiation) {
            json(json)
        }
    }

    /**
     * Register this device with the server.
     * Returns the deviceId and initial status ("pending").
     */
    suspend fun register(
        serverUrl: String,
        deviceFingerprint: String,
        name: String,
        model: String,
        androidVersion: String
    ): Result<RegisterResponse> {
        return try {
            val httpBase = serverUrl
                .replace("wss://", "https://")
                .replace("ws://", "http://")
                .trimEnd('/')

            val response = client.post("$httpBase/devices/register") {
                contentType(ContentType.Application.Json)
                setBody(RegisterRequest(
                    deviceFingerprint = deviceFingerprint,
                    name = name,
                    model = model,
                    androidVersion = androidVersion
                ))
            }

            val body = response.bodyAsText()

            if (response.status.value in 200..299) {
                val result = json.decodeFromString<RegisterResponse>(body)
                Result.success(result)
            } else {
                val error = try {
                    json.decodeFromString<RegistrationError>(body).error
                } catch (_: Exception) {
                    "Registration failed"
                }
                Result.failure(Exception(error))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Connection failed: ${e.message}"))
        }
    }

    /**
     * Poll the server for the current registration status.
     * When approved, returns status="active" with a token.
     */
    suspend fun pollStatus(
        serverUrl: String,
        deviceFingerprint: String
    ): Result<StatusResponse> {
        return try {
            val httpBase = serverUrl
                .replace("wss://", "https://")
                .replace("ws://", "http://")
                .trimEnd('/')

            val response = client.get(
                "$httpBase/devices/register/status?deviceFingerprint=$deviceFingerprint"
            )

            val body = response.bodyAsText()

            if (response.status.value in 200..299) {
                val result = json.decodeFromString<StatusResponse>(body)
                Result.success(result)
            } else {
                val error = try {
                    json.decodeFromString<RegistrationError>(body).error
                } catch (_: Exception) {
                    "Status check failed"
                }
                Result.failure(Exception(error))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Connection failed: ${e.message}"))
        }
    }
}
