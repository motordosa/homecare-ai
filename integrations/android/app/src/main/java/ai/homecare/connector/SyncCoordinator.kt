package ai.homecare.connector

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

/** Serializes foreground, Worker, configuration changes, and encrypted pending-batch updates. */
internal class SyncCoordinator(private val context: Context) {
    private val store = SecureStore(context)
    private val api = ConnectorApi()
    private val health = HealthReader(context)

    suspend fun saveConnection(origin: String, token: String, patientId: String) = LOCK.withLock {
        val canonical = try { ServerOrigin.normalize(origin) } catch (_: Exception) {
            throw ConnectorFailure("HTTPS 서버 주소(경로·계정 정보 제외)를 입력하세요.")
        }
        if (patientId.isBlank() || patientId.length > 80 || patientId.any { it.isISOControl() }) {
            throw ConnectorFailure("웹에 표시된 환자 ID를 확인하세요.")
        }
        val identity = api.identity(canonical, token)
        if (identity.patientId != patientId) {
            throw ConnectorFailure("토큰의 환자 ID와 입력한 환자 ID가 다릅니다. 건강자료를 읽거나 전송하지 않았습니다.")
        }
        BackgroundSync.cancel(context)
        store.clear()
        store.saveConfig(ConnectionConfig(canonical, token, patientId, identity.connectionId, Instant.now().toString()))
        store.setStatus("서버의 연결 대상을 확인했습니다. 아직 건강자료를 전송하지 않았습니다.")
    }

    suspend fun clearConnection() = LOCK.withLock {
        BackgroundSync.cancel(context)
        store.clear()
    }

    suspend fun setBackground(enabled: Boolean) = LOCK.withLock {
        val config = store.config() ?: throw ConnectorFailure("연결을 먼저 저장하세요.")
        if (enabled) {
            if (!health.backgroundAvailable()) throw ConnectorFailure("이 기기는 백그라운드 읽기를 지원하지 않습니다. 앱을 열어 동기화하세요.")
            val granted = health.grantedPermissions()
            if (!granted.containsAll(HealthReader.READ_PERMISSIONS) || HealthReader.BACKGROUND_PERMISSION !in granted) {
                throw ConnectorFailure("걸음 수·수면·백그라운드 읽기 권한이 필요합니다.")
            }
        }
        store.saveConfig(config.withBackground(enabled))
        if (enabled) BackgroundSync.schedule(context) else BackgroundSync.cancel(context)
        store.setStatus(if (enabled) "자동 동기화를 요청했습니다. OS 상태에 따라 지연될 수 있습니다." else "자동 동기화를 껐습니다. 앱을 열어 수동 동기화할 수 있습니다.")
    }

    suspend fun sync(background: Boolean): String = LOCK.withLock {
        val config = store.config() ?: throw ConnectorFailure("연결 설정이 없습니다.")
        if (background && !config.backgroundEnabled) throw ConnectorFailure("자동 동기화가 꺼져 있습니다.")
        try {
            // Preflight BEFORE reading the health store or sending even a pending batch.
            val identity = api.identity(config.origin, config.token)
            if (identity.patientId != config.patientId || identity.connectionId != config.connectionId) {
                throw ConnectorFailure("연결 대상이 바뀌었습니다. 건강자료 전송을 중지했습니다.")
            }
            val granted = health.grantedPermissions()
            if (!granted.containsAll(HealthReader.READ_PERMISSIONS) ||
                (background && (!health.backgroundAvailable() || HealthReader.BACKGROUND_PERMISSION !in granted))) {
                // Revocation stops pending uploads too; no previously queued data is sent.
                throw ConnectorFailure("건강정보 읽기 권한을 확인하세요. 전송을 중지했습니다.")
            }

            // An interrupted request keeps its exact serialized payload and batchId on disk.
            val pending = store.pending()
            val payload = pending ?: run {
                val readings = health.readRecentDays(background)
                val revision = Instant.now().truncatedTo(ChronoUnit.MILLIS)
                JSONObject().apply {
                    put("batchId", UUID.randomUUID().toString())
                    put("timeZone", HealthReader.STUDY_ZONE.id)
                    put("days", JSONArray().apply { readings.forEach { put(it.toJson(revision)) } })
                }.toString().also(store::savePending)
            }
            val receipt = api.send(config, payload)
            store.savePending(null)
            val days = JSONObject(payload).getJSONArray("days")
            val withSteps = (0 until days.length()).count { !days.getJSONObject(it).isNull("steps") }
            val withSleep = (0 until days.length()).count { !days.getJSONObject(it).isNull("sleepMinutes") }
            val message = (if (pending != null) "보관한 배치의 재전송을 확인했습니다. 다음 동기화에서 최신 자료를 다시 집계합니다.\n" else "") +
                "서버 수신 확인: ${receipt.receivedAt}\n" +
                "반영 ${receipt.acceptedDays}일 · 기존/재전송 ${receipt.ignoredDays}일\n" +
                "전송한 걸음 자료 ${withSteps}일 · 수면 단계 자료 ${withSleep}일" +
                if (withSteps == 0 || withSleep == 0) "\n없는 자료는 0으로 채우지 않았습니다. 삼성 헬스 공유·기록 여부를 확인하세요." else ""
            store.setStatus(message)
            message
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: ConnectorFailure) {
            store.setStatus(failure.safeMessage)
            if (!failure.retryable) {
                // Explicitly cancel periodic work. WorkManager periodic failures otherwise recur.
                BackgroundSync.cancel(context)
                // Manual recovery is explicit; permanent failures never keep periodic work running.
                store.saveConfig(config.withBackground(false))
            }
            throw failure
        } catch (_: SecurityException) {
            BackgroundSync.cancel(context)
            store.saveConfig(config.withBackground(false))
            store.setStatus("건강정보 접근이 거부되었습니다. 권한을 확인한 뒤 앱에서 다시 동기화하세요.")
            throw ConnectorFailure("건강정보 접근이 거부되었습니다. 권한을 확인하세요.")
        } catch (_: Exception) {
            // Do not surface exception messages: providers can include source data or URLs.
            BackgroundSync.cancel(context)
            store.saveConfig(config.withBackground(false))
            store.setStatus("기기 자료를 처리하지 못했습니다. 전송 대기 자료는 보존했습니다. 앱에서 다시 확인하세요.")
            throw ConnectorFailure("기기 자료를 처리하지 못했습니다. 동기화가 완료되지 않았습니다.")
        }
    }

    companion object { val LOCK = Mutex() }
}
