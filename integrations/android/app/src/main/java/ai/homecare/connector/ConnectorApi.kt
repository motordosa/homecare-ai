package ai.homecare.connector

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URL
import java.time.Instant
import javax.net.ssl.HttpsURLConnection

/** Default platform TLS validation; redirects are refused to prevent credential forwarding. */
internal class ConnectorApi {
    suspend fun identity(origin: String, token: String): Identity {
        val result = request(origin, token, "/api/health-sync/connection", null)
        if (result.optString("platform") != "health-connect") {
            throw ConnectorFailure("Android Health Connect용 연결 토큰이 아닙니다.")
        }
        if (!result.optBoolean("partialMetrics", false)) {
            throw ConnectorFailure("서버가 부분 권한 동기화를 지원하지 않습니다. 웹 서버를 최신 버전으로 배포한 뒤 다시 연결하세요.")
        }
        if (!result.optBoolean("selected", false)) {
            throw ConnectorFailure("웹에서 다른 연결이 선택되었습니다. 현재 선택 환자의 새 연결 토큰으로 다시 설정하세요.")
        }
        val patientId = result.optString("patientId")
        val connectionId = result.optString("connectionId")
        if (patientId.isBlank() || connectionId.isBlank()) throw ConnectorFailure("서버의 연결 확인 응답이 올바르지 않습니다.")
        return Identity(patientId, connectionId)
    }

    suspend fun send(config: ConnectionConfig, body: String): SyncReceipt {
        val result = request(config.origin, config.token, "/api/health-sync", body)
        if (result.optString("patientId") != config.patientId || result.optString("connectionId") != config.connectionId ||
            result.optString("batchId") != JSONObject(body).getString("batchId")) {
            throw ConnectorFailure("수신 응답의 연결 대상이 일치하지 않습니다. 전송을 중지하고 담당자에게 확인하세요.")
        }
        try {
            val receivedAt = result.getString("receivedAt")
            Instant.parse(receivedAt)
            val accepted = result.getInt("acceptedDays")
            val ignored = result.getInt("ignoredDays")
            val sentDays = JSONObject(body).getJSONArray("days").length()
            val duplicate = result.getBoolean("duplicate")
            require(accepted >= 0 && ignored >= 0 && accepted + ignored == sentDays)
            require(!duplicate || accepted == 0)
            return SyncReceipt(receivedAt, accepted, ignored, duplicate)
        } catch (_: Exception) {
            throw ConnectorFailure("서버 수신 확인을 해석하지 못했습니다. 같은 배치를 보관했습니다.", retryable = true)
        }
    }

    private suspend fun request(origin: String, token: String, path: String, body: String?): JSONObject = withContext(Dispatchers.IO) {
        if (!TOKEN.matches(token)) throw ConnectorFailure("연결 토큰 형식을 확인하세요.")
        val canonical = try { ServerOrigin.normalize(origin) } catch (_: IllegalArgumentException) {
            throw ConnectorFailure("HTTPS 서버 주소 형식을 확인하세요.")
        }
        val connection = URL(canonical + path).openConnection() as HttpsURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.requestMethod = if (body == null) "GET" else "POST"
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Accept", "application/json")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                val bytes = body.toByteArray(Charsets.UTF_8)
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            if (status !in 200..299) {
                throw when (status) {
                    401, 403 -> ConnectorFailure("연결이 만료·폐기되었거나 허용되지 않았습니다. 웹에서 새 토큰을 발급하세요.")
                    409 -> ConnectorFailure("배치 ID 충돌입니다. 자동 전송을 중지했습니다. 담당자의 확인이 필요합니다.")
                    429 -> ConnectorFailure("서버 요청이 많습니다. 같은 배치를 잠시 후 다시 전송하세요.", true)
                    in 500..599 -> ConnectorFailure("서버가 응답을 완료하지 못했습니다. 같은 배치를 보관했습니다.", true)
                    in 300..399 -> ConnectorFailure("서버 주소가 다른 위치로 이동합니다. 토큰 보호를 위해 전송을 중지했습니다.")
                    else -> ConnectorFailure("서버가 요청을 거부했습니다. 서버 버전·기기 시각·연결 설정을 확인하세요.")
                }
            }
            val bytes = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(4096)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    if (bytes.size() + read > 32_768) throw ConnectorFailure("서버 응답이 허용 크기를 초과했습니다.")
                    bytes.write(buffer, 0, read)
                }
            }
            try { JSONObject(bytes.toString("UTF-8")) } catch (_: Exception) {
                throw ConnectorFailure("서버 응답 형식을 확인할 수 없습니다. 연결 API 지원 여부를 확인하세요.")
            }
        } catch (failure: ConnectorFailure) {
            throw failure
        } catch (_: IOException) {
            throw ConnectorFailure("네트워크 또는 보안 연결에 실패했습니다. 같은 배치로 다시 시도할 수 있습니다.", true)
        } finally {
            connection.disconnect()
        }
    }

    companion object { val TOKEN = Regex("^hc_[A-Za-z0-9_-]{43}$") }
}
