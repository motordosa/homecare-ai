package ai.homecare.connector

import org.json.JSONObject

/** Production policy: a revoked permission must never travel in a queued or new batch. */
internal data class MetricAccess(val steps: Boolean, val sleep: Boolean) {
    val any: Boolean get() = steps || sleep

    fun permitsPayload(body: String): Boolean {
        if (!any) return false
        val days = JSONObject(body).getJSONArray("days")
        if (days.length() == 0) return false
        return (0 until days.length()).all { index ->
            val day = days.getJSONObject(index)
            val hasSteps = day.has("steps")
            val hasSleep = day.has("sleepMinutes")
            (hasSteps || hasSleep) && (!hasSteps || steps) && (!hasSleep || sleep)
        }
    }

    companion object {
        const val STEPS_PERMISSION = "android.permission.health.READ_STEPS"
        const val SLEEP_PERMISSION = "android.permission.health.READ_SLEEP"
        fun from(granted: Set<String>) = MetricAccess(STEPS_PERMISSION in granted, SLEEP_PERMISSION in granted)
    }
}
