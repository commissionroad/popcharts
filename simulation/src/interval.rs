use crate::model::{Coordinate, Receipt, Segment, Side};

#[derive(Clone, Debug, Default)]
pub struct OpposedFree {
    pub free: Vec<Segment>,
    pub opposed: Vec<Segment>,
}

/// Returns the canonical union after removing zero-width segments and merging
/// every overlap or touching boundary.
///
/// # Panics
///
/// Panics when any input segment is inverted.
#[must_use]
pub fn normalize(mut segments: Vec<Segment>) -> Vec<Segment> {
    for segment in &segments {
        assert!(segment.high >= segment.low, "inverted path segment");
    }
    segments.retain(|segment| segment.high > segment.low);
    segments.sort_unstable_by_key(|segment| segment.low);
    let mut merged: Vec<Segment> = Vec::with_capacity(segments.len());
    for segment in segments {
        if let Some(last) = merged.last_mut()
            && segment.low <= last.high
        {
            last.high = last.high.max(segment.high);
            continue;
        }
        merged.push(segment);
    }
    merged
}

pub fn insert_into_union(union: &mut Vec<Segment>, segment: Segment) {
    if segment.high <= segment.low {
        return;
    }
    union.push(segment);
    *union = normalize(std::mem::take(union));
}

#[must_use]
pub fn coverage_union(receipts: &[Receipt], side: Side) -> Vec<Segment> {
    normalize(
        receipts
            .iter()
            .filter(|receipt| receipt.side == side)
            .flat_map(|receipt| receipt.segments.iter().copied())
            .collect(),
    )
}

#[must_use]
pub fn split_segments(segments: &[Segment], opposite_union: &[Segment]) -> OpposedFree {
    let own = normalize(segments.to_vec());
    let mut result = OpposedFree::default();

    for segment in own {
        let mut cursor = segment.low;
        let start = opposite_union.partition_point(|cover| cover.high <= cursor);
        for cover in &opposite_union[start..] {
            if cover.low >= segment.high {
                break;
            }
            let overlap_low = cover.low.max(cursor);
            let overlap_high = cover.high.min(segment.high);
            if overlap_low > cursor {
                result.free.push(Segment::new(cursor, overlap_low));
            }
            if overlap_high > overlap_low {
                result.opposed.push(Segment::new(overlap_low, overlap_high));
            }
            cursor = overlap_high;
        }
        if cursor < segment.high {
            result.free.push(Segment::new(cursor, segment.high));
        }
    }
    result
}

#[derive(Clone, Copy, Debug)]
struct CoverageEvent {
    coordinate: Coordinate,
    no_delta: i32,
    yes_delta: i32,
}

#[must_use]
pub fn matched_market_cap(receipts: &[Receipt]) -> i128 {
    let mut events = Vec::new();
    for receipt in receipts {
        for segment in &receipt.segments {
            let (yes_delta, no_delta) = match receipt.side {
                Side::Yes => (1, 0),
                Side::No => (0, 1),
            };
            events.push(CoverageEvent {
                coordinate: segment.low,
                no_delta,
                yes_delta,
            });
            events.push(CoverageEvent {
                coordinate: segment.high,
                no_delta: -no_delta,
                yes_delta: -yes_delta,
            });
        }
    }
    events.sort_unstable_by_key(|event| event.coordinate);
    if events.is_empty() {
        return 0;
    }

    let mut matched = 0_i128;
    let mut yes = 0_i32;
    let mut no = 0_i32;
    let mut index = 0;
    while index < events.len() {
        let coordinate = events[index].coordinate;
        while index < events.len() && events[index].coordinate == coordinate {
            yes += events[index].yes_delta;
            no += events[index].no_delta;
            index += 1;
        }
        if let Some(next) = events.get(index) {
            let width = i128::from(next.coordinate - coordinate);
            matched += i128::from(yes.min(no)) * width;
        }
    }
    matched
}

#[cfg(test)]
mod tests {
    use super::{matched_market_cap, normalize, split_segments};
    use crate::lmsr::{coordinate_as_b_units, side_cost};
    use crate::model::{COORDINATE_SCALE, Coordinate, Receipt, Segment, Side};

    #[test]
    fn normalization_merges_touching_segments() {
        assert_eq!(
            normalize(vec![
                Segment::new(2, 4),
                Segment::new(0, 2),
                Segment::new(9, 9),
                Segment::new(7, 8),
            ]),
            vec![Segment::new(0, 4), Segment::new(7, 8)]
        );
    }

    #[test]
    #[should_panic(expected = "inverted path segment")]
    fn normalization_rejects_inverted_segments() {
        let _ = normalize(vec![Segment::new(2, 1)]);
    }

    #[test]
    fn interior_opposition_splits_twice() {
        let split = split_segments(&[Segment::new(0, 10)], &[Segment::new(4, 6)]);
        assert_eq!(split.opposed, vec![Segment::new(4, 6)]);
        assert_eq!(split.free, vec![Segment::new(0, 4), Segment::new(6, 10)]);
    }

    #[test]
    fn event_sweep_counts_crowded_overlap() {
        let receipts = vec![
            receipt(1, Side::Yes, 0, 10),
            receipt(2, Side::Yes, 0, 10),
            receipt(3, Side::No, 4, 8),
        ];
        assert_eq!(matched_market_cap(&receipts), 4);
    }

    #[test]
    fn whitepaper_example_a_matches_withdrawal_golden() {
        let r20 = coordinate_for_probability(20.0);
        let r30 = coordinate_for_probability(30.0);
        let r40 = coordinate_for_probability(40.0);
        let alice = Segment::new(r20, r40);
        let split = split_segments(&[alice], &[Segment::new(r30, r40)]);

        assert_eq!(split.free, vec![Segment::new(r20, r30)]);
        assert_eq!(split.opposed, vec![Segment::new(r30, r40)]);
        let free_width = coordinate_as_b_units(split.free[0].width());
        let opposed_width = coordinate_as_b_units(split.opposed[0].width());
        assert!((free_width - 0.5390).abs() < 0.0001);
        assert!((opposed_width - 0.4418).abs() < 0.0001);
        assert!((side_cost(alice, Side::Yes) - 0.2877).abs() < 0.0001);
        assert!((side_cost(split.free[0], Side::Yes) - 0.1335).abs() < 0.0001);
    }

    fn coordinate_for_probability(percent: f64) -> Coordinate {
        let probability = percent / 100.0;
        #[allow(clippy::cast_possible_truncation, clippy::cast_precision_loss)]
        {
            ((probability / (1.0 - probability)).ln() * COORDINATE_SCALE as f64).round()
                as Coordinate
        }
    }

    fn receipt(id: u32, side: Side, low: i64, high: i64) -> Receipt {
        Receipt {
            id,
            segments: vec![Segment::new(low, high)],
            side,
        }
    }
}
