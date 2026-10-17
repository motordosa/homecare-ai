import Foundation
import HealthKit

final class HealthReader {
    private let store = HKHealthStore()
    private var observers: [HKObserverQuery] = []
    static var available: Bool { HKHealthStore.isHealthDataAvailable() }
    private var stepsType: HKQuantityType { HKObjectType.quantityType(forIdentifier: .stepCount)! }
    private var sleepType: HKCategoryType { HKObjectType.categoryType(forIdentifier: .sleepAnalysis)! }
    private func types(_ metrics: MetricSelection) -> [HKSampleType] {
        (metrics.steps ? [stepsType as HKSampleType] : []) + (metrics.sleep ? [sleepType as HKSampleType] : [])
    }
    func requestAccess(_ metrics: MetricSelection) async throws {
        guard metrics.any else { throw ConnectorError.noMetrics }
        guard Self.available else { throw ConnectorError.noReadableData }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            store.requestAuthorization(toShare: [], read: Set(types(metrics).map { $0 as HKObjectType })) { success, error in
                if error != nil || !success { continuation.resume(throwing: ConnectorError.noReadableData) }
                else { continuation.resume() } // Request completed; read permission is intentionally not inferred.
            }
        }
    }
    private func steps(in windows: [DayWindow]) async throws -> [String: Int] {
        guard let first = windows.first, let last = windows.last else { return [:] }
        return try await withCheckedThrowingContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: first.start, end: last.end, options: [])
            var interval = DateComponents(); interval.day = 1; interval.timeZone = SeoulDays.calendar.timeZone
            let query = HKStatisticsCollectionQuery(quantityType: stepsType, quantitySamplePredicate: predicate,
                                                    options: .cumulativeSum, anchorDate: first.start, intervalComponents: interval)
            query.initialResultsHandler = { _, result, error in
                guard error == nil, let result = result else { continuation.resume(throwing: ConnectorError.noReadableData); return }
                var readings: [String: Int] = [:]
                result.enumerateStatistics(from: first.start, to: last.end) { statistics, _ in
                    if let quantity = statistics.sumQuantity() {
                        let number = quantity.doubleValue(for: .count())
                        if number.isFinite && number >= 0 && number <= 100000 {
                            readings[SeoulDays.key(statistics.startDate)] = Int(number.rounded())
                        }
                    }
                }
                continuation.resume(returning: readings)
            }
            store.execute(query)
        }
    }
    private func sleep(in windows: [DayWindow]) async throws -> [String: Double] {
        guard let first = windows.first, let last = windows.last else { return [:] }
        let samples: [SleepInterval] = try await withCheckedThrowingContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: first.start, end: last.end, options: [])
            let query = HKSampleQuery(sampleType: sleepType, predicate: predicate, limit: 50000, sortDescriptors: nil) { _, samples, error in
                guard error == nil, let samples = samples as? [HKCategorySample], samples.count < 50000 else {
                    continuation.resume(throwing: ConnectorError.noReadableData); return
                }
                continuation.resume(returning: samples.map { SleepInterval(start: $0.startDate, end: $0.endDate, category: $0.value) })
            }
            store.execute(query)
        }
        return Dictionary(uniqueKeysWithValues: windows.compactMap { window in
            SleepUnion.minutes(samples, in: window).map { (window.date, $0) }
        })
    }
    func read(_ metrics: MetricSelection, now: Date) async throws -> [DayReading] {
        guard metrics.any else { throw ConnectorError.noMetrics }
        let windows = SeoulDays.recent(now: now)
        // Query only selected types. Empty results never mean granted access.
        let stepValues = metrics.steps ? try await steps(in: windows) : [:]
        let sleepValues = metrics.sleep ? try await sleep(in: windows) : [:]
        return windows.map { DayReading(date: $0.date, steps: stepValues[$0.date], sleepMinutes: sleepValues[$0.date], updatedAt: "") }
    }
    func stopObservers() {
        observers.forEach { store.stop($0) }; observers.removeAll()
    }
    func disableDelivery() async {
        stopObservers()
        await withCheckedContinuation { continuation in
            store.disableAllBackgroundDelivery { _, _ in continuation.resume() }
        }
    }
    func observe(_ metrics: MetricSelection, onChange: @escaping (@escaping () -> Void) -> Void) async throws {
        await disableDelivery()
        do {
            for type in types(metrics) {
                let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, error in
                    guard error == nil else { completion(); return }
                    onChange(completion)
                }
                observers.append(query); store.execute(query)
                try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                    store.enableBackgroundDelivery(for: type, frequency: .hourly) { success, error in
                        if success && error == nil { continuation.resume() }
                        else { continuation.resume(throwing: ConnectorError.noReadableData) }
                    }
                }
            }
        } catch { await disableDelivery(); throw error }
    }
}
