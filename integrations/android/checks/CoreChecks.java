package ai.homecare.connector;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;

/** Android-independent correctness checks; not an APK build or Health Connect integration test. */
public final class CoreChecks {
    private static int passed;
    private static Instant at(String value) { return Instant.parse(value); }
    private static SleepIntervals.Interval interval(String start, String end) {
        return new SleepIntervals.Interval(at(start), at(end));
    }
    private static void equal(double expected, double actual, String name) {
        if (Math.abs(expected - actual) > 0.000001) throw new AssertionError(name);
        passed++;
    }
    private static void rejected(String origin) {
        try { ServerOrigin.normalize(origin); } catch (IllegalArgumentException expected) { passed++; return; }
        throw new AssertionError("Unsafe origin accepted");
    }
    public static void main(String[] args) {
        Instant start = LocalDate.parse("2026-10-16").atStartOfDay(ZoneId.of("Asia/Seoul")).toInstant();
        Instant end = start.plusSeconds(24 * 60 * 60);
        equal(0, SleepIntervals.unionMinutes(start, end, List.of()), "empty union");
        equal(120, SleepIntervals.unionMinutes(start, end, List.of(
                interval("2026-10-15T14:00:00Z", "2026-10-15T17:00:00Z"))), "KST midnight clipping");
        equal(180, SleepIntervals.unionMinutes(start, end, List.of(
                interval("2026-10-15T15:00:00Z", "2026-10-15T17:00:00Z"),
                interval("2026-10-15T16:00:00Z", "2026-10-15T18:00:00Z"),
                interval("2026-10-15T15:00:00Z", "2026-10-15T17:00:00Z"))), "overlap and duplicate source union");
        equal(120, SleepIntervals.unionMinutes(start, end, List.of(
                interval("2026-10-15T15:00:00Z", "2026-10-15T16:00:00Z"),
                interval("2026-10-15T17:00:00Z", "2026-10-15T18:00:00Z"))), "awake gap excluded");
        equal(1440, SleepIntervals.unionMinutes(start, end, List.of(
                interval("2026-10-14T15:00:00Z", "2026-10-17T15:00:00Z"))), "day maximum");
        equal(0.5, SleepIntervals.unionMinutes(start, end, List.of(
                interval("2026-10-15T15:00:00Z", "2026-10-15T15:00:30Z"))), "fractional minutes");
        if (!"https://example.org".equals(ServerOrigin.normalize("https://EXAMPLE.ORG:443/"))) throw new AssertionError("normalize");
        passed++;
        for (String origin : List.of("http://example.org", "https://user:pass@example.org", "https://example.org/path",
                "https://example.org?key=value", "https://example.org/#fragment", "https://example.org:0", "https://example.org:65536",
                "https://example.org\\@other.example", "https:///missing-host")) rejected(origin);
        System.out.println("Android-independent core checks passed: " + passed);
    }
}
