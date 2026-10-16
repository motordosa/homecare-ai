package ai.homecare.connector

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class MetricAccessTest {
    private val revision = Instant.parse("2026-01-03T03:00:00Z")
    private fun payload(vararg days: JSONObject): String = JSONObject()
        .put("batchId", "unit-fixture")
        .put("timeZone", "Asia/Seoul")
        .put("days", JSONArray(days.toList())).toString()

    @Test fun stepsOnlyOmitsSleepWithoutTurningItIntoNull() {
        val day = DailyReading("2026-01-02", 0, null, true, false).toJson(revision)
        assertTrue(day.has("steps"))
        assertEquals(0, day.getLong("steps"))
        assertFalse(day.has("sleepMinutes"))
        assertEquals("2026-01-03T03:00:00Z", day.getString("updatedAt"))
    }

    @Test fun authorizedMissingSleepIsAnExplicitNull() {
        val day = DailyReading("2026-01-02", null, null, false, true).toJson(revision)
        assertFalse(day.has("steps"))
        assertTrue(day.has("sleepMinutes"))
        assertTrue(day.isNull("sleepMinutes"))
    }

    @Test fun fullSnapshotsRetainLegacyZeroAndNullSemantics() {
        val day = DailyReading("2026-01-02", null, 0.0).toJson(revision)
        assertTrue(day.has("steps"))
        assertTrue(day.isNull("steps"))
        assertEquals(0.0, day.getDouble("sleepMinutes"), 0.0)
    }

    @Test(expected = IllegalArgumentException::class)
    fun noSelectedMetricCannotCreateAnEmptyDay() {
        DailyReading("2026-01-02", null, null, false, false).toJson(revision)
    }

    @Test fun permissionSetsSupportBothSingleMetricsAndNone() {
        assertFalse(MetricAccess.from(emptySet()).any)
        assertEquals(MetricAccess(true, false), MetricAccess.from(setOf(MetricAccess.STEPS_PERMISSION)))
        assertEquals(MetricAccess(false, true), MetricAccess.from(setOf(MetricAccess.SLEEP_PERMISSION)))
        assertEquals(MetricAccess(true, true), MetricAccess.from(setOf(MetricAccess.STEPS_PERMISSION, MetricAccess.SLEEP_PERMISSION)))
    }

    @Test fun revokedMetricBlocksEvenANullFieldInAPendingBatch() {
        val both = payload(DailyReading("2026-01-02", 4, null).toJson(revision))
        assertTrue(MetricAccess(true, true).permitsPayload(both))
        assertFalse(MetricAccess(true, false).permitsPayload(both))
        assertFalse(MetricAccess(false, true).permitsPayload(both))
        assertFalse(MetricAccess(false, false).permitsPayload(both))
    }

    @Test fun authorizedSingleMetricPendingBatchCanBeRetriedUnchanged() {
        val step = payload(DailyReading("2026-01-02", 4, null, true, false).toJson(revision))
        assertTrue(MetricAccess(true, false).permitsPayload(step))
        assertTrue(MetricAccess(true, true).permitsPayload(step))
        assertFalse(MetricAccess(false, true).permitsPayload(step))
    }

    @Test fun permissionCheckCoversEveryDayAndRejectsAnEmptyBatch() {
        val mixed = payload(
            DailyReading("2026-01-01", 5, null, true, false).toJson(revision),
            DailyReading("2026-01-02", null, 300.0, false, true).toJson(revision),
        )
        assertFalse(MetricAccess(true, false).permitsPayload(mixed))
        assertFalse(MetricAccess(false, true).permitsPayload(mixed))
        assertTrue(MetricAccess(true, true).permitsPayload(mixed))
        assertFalse(MetricAccess(true, true).permitsPayload(payload()))
    }
}
