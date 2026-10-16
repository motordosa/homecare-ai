package ai.homecare.connector

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Instant
import java.time.ZoneId

internal class HealthReader(private val context: Context) {
    fun availability(): Int = HealthConnectClient.getSdkStatus(context)

    private fun client(): HealthConnectClient {
        when (availability()) {
            HealthConnectClient.SDK_UNAVAILABLE -> throw ConnectorFailure("이 기기에서 Health Connect를 사용할 수 없습니다.")
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED ->
                throw ConnectorFailure("Health Connect 설치 또는 업데이트가 필요합니다.")
        }
        return HealthConnectClient.getOrCreate(context)
    }

    fun backgroundAvailable(): Boolean = client().features.getFeatureStatus(
        HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND,
    ) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE

    suspend fun grantedPermissions(): Set<String> = client().permissionController.getGrantedPermissions()

    suspend fun readRecentDays(background: Boolean): List<DailyReading> {
        val health = client()
        val granted = health.permissionController.getGrantedPermissions()
        if (!granted.containsAll(READ_PERMISSIONS)) {
            // A revoked permission must not overwrite earlier valid observations with null.
            throw ConnectorFailure("걸음 수·수면 읽기 권한을 모두 허용해야 동기화할 수 있습니다. 기존 서버 자료는 변경하지 않았습니다.")
        }
        if (background && (!backgroundAvailable() || BACKGROUND_PERMISSION !in granted)) {
            throw ConnectorFailure("백그라운드 읽기가 허용되지 않았습니다. 앱을 열어 동기화하세요.")
        }
        val now = Instant.now()
        val today = now.atZone(STUDY_ZONE).toLocalDate()
        val first = today.minusDays(6)
        // Include the preceding day so a session spanning the first midnight can be clipped.
        val sleep = mutableListOf<SleepSessionRecord>()
        var page: String? = null
        var pages = 0
        do {
            val result = health.readRecords(ReadRecordsRequest(
                recordType = SleepSessionRecord::class,
                timeRangeFilter = TimeRangeFilter.between(first.minusDays(1).atStartOfDay(STUDY_ZONE).toInstant(), now),
                pageSize = 1000,
                pageToken = page,
            ))
            sleep.addAll(result.records)
            page = result.pageToken
            pages++
            if (pages >= 100 && page != null) throw ConnectorFailure("수면 기록이 너무 많아 완전한 집계를 하지 못했습니다. 담당자 확인이 필요합니다.")
        } while (page != null)

        return (0L..6L).map { offset ->
            val day = first.plusDays(offset)
            val start = day.atStartOfDay(STUDY_ZONE).toInstant()
            val end = minOf(day.plusDays(1).atStartOfDay(STUDY_ZONE).toInstant(), now)
            if (!start.isBefore(end)) return@map DailyReading(day.toString(), null, null)
            val aggregate = health.aggregate(AggregateRequest(
                metrics = setOf(StepsRecord.COUNT_TOTAL),
                timeRangeFilter = TimeRangeFilter.between(start, end),
            ))
            val steps = aggregate[StepsRecord.COUNT_TOTAL]
            if (steps != null && steps !in 0L..100_000L) throw ConnectorFailure("걸음 수가 서버의 허용 범위를 벗어났습니다. 원본 기록을 확인하세요.")
            DailyReading(day.toString(), steps, asleepMinutes(sleep, start, end))
        }
    }

    private fun asleepMinutes(records: List<SleepSessionRecord>, start: Instant, end: Instant): Double? {
        val relevant = records.filter { it.startTime < end && it.endTime > start }
        if (relevant.isEmpty() || relevant.any { it.stages.isEmpty() }) return null
        val intervals = mutableListOf<SleepIntervals.Interval>()
        var knownStage = false
        for (record in relevant) {
            for (stage in record.stages) {
                if (stage.startTime >= end || stage.endTime <= start) continue
                when (stage.stage) {
                    SleepSessionRecord.STAGE_TYPE_SLEEPING,
                    SleepSessionRecord.STAGE_TYPE_LIGHT,
                    SleepSessionRecord.STAGE_TYPE_DEEP,
                    SleepSessionRecord.STAGE_TYPE_REM -> {
                        knownStage = true
                        intervals += SleepIntervals.Interval(stage.startTime, stage.endTime)
                    }
                    SleepSessionRecord.STAGE_TYPE_AWAKE,
                    SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED,
                    SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> knownStage = true
                    else -> return null // Unknown/new stage semantics must be reviewed before use.
                }
            }
        }
        return if (knownStage) SleepIntervals.unionMinutes(start, end, intervals) else null
    }

    companion object {
        val STUDY_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
        val READ_PERMISSIONS = setOf(
            HealthPermission.getReadPermission(StepsRecord::class),
            HealthPermission.getReadPermission(SleepSessionRecord::class),
        )
        const val BACKGROUND_PERMISSION = "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND"
    }
}
