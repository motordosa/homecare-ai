package ai.homecare.connector;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Union of confirmed asleep stages, clipped to [start, end). Does not infer sleep from a session. */
public final class SleepIntervals {
    private SleepIntervals() {}

    public static final class Interval {
        public final Instant start;
        public final Instant end;

        public Interval(Instant start, Instant end) {
            if (start == null || end == null || !start.isBefore(end)) {
                throw new IllegalArgumentException("Invalid sleep interval");
            }
            this.start = start;
            this.end = end;
        }
    }

    public static double unionMinutes(Instant start, Instant end, List<Interval> asleep) {
        if (!start.isBefore(end)) throw new IllegalArgumentException("Invalid day range");
        List<Interval> clipped = new ArrayList<>();
        for (Interval interval : asleep) {
            Instant left = interval.start.isAfter(start) ? interval.start : start;
            Instant right = interval.end.isBefore(end) ? interval.end : end;
            if (left.isBefore(right)) clipped.add(new Interval(left, right));
        }
        clipped.sort(Comparator.comparing(interval -> interval.start));
        if (clipped.isEmpty()) return 0;
        Instant left = clipped.get(0).start;
        Instant right = clipped.get(0).end;
        double seconds = 0;
        for (int index = 1; index < clipped.size(); index++) {
            Interval interval = clipped.get(index);
            if (!interval.start.isAfter(right)) {
                if (interval.end.isAfter(right)) right = interval.end;
            } else {
                seconds += Duration.between(left, right).toNanos() / 1_000_000_000.0;
                left = interval.start;
                right = interval.end;
            }
        }
        seconds += Duration.between(left, right).toNanos() / 1_000_000_000.0;
        return seconds / 60.0;
    }
}
