package ai.homecare.connector

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import java.util.concurrent.TimeUnit

class HealthSyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        return try {
            SyncCoordinator(applicationContext).sync(background = true)
            Result.success()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: ConnectorFailure) {
            if (failure.retryable && runAttemptCount < 3) Result.retry() else {
                if (!failure.retryable) BackgroundSync.cancel(applicationContext)
                Result.failure()
            }
        } catch (_: Exception) {
            // No raw exception / token / health value in WorkManager output or logs.
            BackgroundSync.cancel(applicationContext)
            Result.failure()
        }
    }
}

internal object BackgroundSync {
    private const val NAME = "homecare-health-connect-sync"

    fun schedule(context: Context) {
        val request = PeriodicWorkRequestBuilder<HealthSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    fun cancel(context: Context) { WorkManager.getInstance(context).cancelUniqueWork(NAME) }
}
