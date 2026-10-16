package ai.homecare.connector

import org.json.JSONObject
import java.time.Instant

/** Never print these objects: they contain the connection secret or health data. */
internal class ConnectionConfig(
    val origin: String,
    val token: String,
    val patientId: String,
    val connectionId: String,
    val ownerConfirmedAt: String,
    val backgroundEnabled: Boolean = false,
) {
    fun toJson(): String = JSONObject().apply {
        put("origin", origin)
        put("token", token)
        put("patientId", patientId)
        put("connectionId", connectionId)
        put("ownerConfirmedAt", ownerConfirmedAt)
        put("backgroundEnabled", backgroundEnabled)
    }.toString()

    fun withBackground(enabled: Boolean) = ConnectionConfig(
        origin, token, patientId, connectionId, ownerConfirmedAt, enabled,
    )

    companion object {
        fun fromJson(value: String): ConnectionConfig = JSONObject(value).let {
            ConnectionConfig(
                it.getString("origin"), it.getString("token"), it.getString("patientId"),
                it.getString("connectionId"), it.getString("ownerConfirmedAt"),
                it.getBoolean("backgroundEnabled"),
            )
        }
    }
}

internal class ConnectorFailure(val safeMessage: String, val retryable: Boolean = false) :
    Exception(safeMessage)

internal class Identity(val patientId: String, val connectionId: String)

internal class SyncReceipt(val receivedAt: String, val acceptedDays: Int, val ignoredDays: Int, val duplicate: Boolean)

internal class DailyReading(
    val date: String, val steps: Long?, val sleepMinutes: Double?,
    val includesSteps: Boolean = true, val includesSleep: Boolean = true,
) {
    fun toJson(revision: Instant): JSONObject = JSONObject().apply {
        require(includesSteps || includesSleep)
        put("date", date)
        if (includesSteps) put("steps", steps ?: JSONObject.NULL)
        if (includesSleep) put("sleepMinutes", sleepMinutes ?: JSONObject.NULL)
        put("updatedAt", revision.toString())
    }
}
