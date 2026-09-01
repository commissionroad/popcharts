use serde::Serialize;

use crate::interval::{coverage_union, matched_market_cap, split_segments};
use crate::lmsr::{coordinate_as_b_units, segments_cost};
use crate::model::{Book, Receipt, Side};

pub const FEE_POLICIES: [FeePolicy; 8] = [
    FeePolicy::new(FeeBasis::Cost, 0),
    FeePolicy::new(FeeBasis::Cost, 100),
    FeePolicy::new(FeeBasis::Cost, 200),
    FeePolicy::new(FeeBasis::Cost, 500),
    FeePolicy::new(FeeBasis::Width, 0),
    FeePolicy::new(FeeBasis::Width, 100),
    FeePolicy::new(FeeBasis::Width, 200),
    FeePolicy::new(FeeBasis::Width, 500),
];

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FeeBasis {
    Cost,
    Width,
}

impl FeeBasis {
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Cost => "cost",
            Self::Width => "width",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct FeePolicy {
    pub basis: FeeBasis,
    pub rate_bps: u16,
}

impl FeePolicy {
    #[must_use]
    pub const fn new(basis: FeeBasis, rate_bps: u16) -> Self {
        Self { basis, rate_bps }
    }

    #[must_use]
    pub fn fee(self, gross_cost: f64, width: i64) -> f64 {
        let rate = f64::from(self.rate_bps) / 10_000.0;
        match self.basis {
            FeeBasis::Cost => gross_cost * rate,
            FeeBasis::Width => (coordinate_as_b_units(width) * rate).min(gross_cost),
        }
    }
}

#[derive(Clone, Debug)]
pub struct TrialMetrics {
    pub fee_totals: [f64; FEE_POLICIES.len()],
    pub free_cost: f64,
    pub free_cost_ratio: f64,
    pub free_receipt_ratio: f64,
    pub matched_width_ratio: f64,
    pub max_remaining_fragments: u32,
    pub retraction_display_move: f64,
    pub retraction_fee_totals: [f64; FEE_POLICIES.len()],
    pub retractable_receipt_ratio: f64,
}

/// Computes one trial's withdrawal, fee, and manipulation metrics while
/// checking every geometry and matched-cap invariant.
///
/// # Panics
///
/// Panics when the generated book is malformed or when removing all free
/// bands changes matched market cap, receipt cost, or the signed path state.
#[must_use]
pub fn analyze_book(book: &Book) -> TrialMetrics {
    assert_book_shape(book);
    let yes_union = coverage_union(&book.receipts, Side::Yes);
    let no_union = coverage_union(&book.receipts, Side::No);
    let original_matched = matched_market_cap(&book.receipts);
    let mut reduced = Vec::with_capacity(book.receipts.len());
    let mut total_cost = 0.0;
    let mut free_cost = 0.0;
    let mut free_users = 0_u32;
    let mut max_remaining_fragments = 0_u32;
    let mut fee_totals = [0.0; FEE_POLICIES.len()];
    let mut signed_free_width = 0_i64;
    let mut total_width = 0_i128;

    for receipt in &book.receipts {
        let opposite = match receipt.side {
            Side::Yes => &no_union,
            Side::No => &yes_union,
        };
        let split = split_segments(&receipt.segments, opposite);
        let receipt_cost = segments_cost(&receipt.segments, receipt.side);
        let receipt_free_cost = segments_cost(&split.free, receipt.side);
        let receipt_opposed_cost = segments_cost(&split.opposed, receipt.side);
        assert_close(
            receipt_cost,
            receipt_free_cost + receipt_opposed_cost,
            "free and opposed cost partition",
        );
        let receipt_width = receipt.width();
        let free_width: i64 = split.free.iter().map(|segment| segment.width()).sum();
        let opposed_width: i64 = split.opposed.iter().map(|segment| segment.width()).sum();
        assert_eq!(receipt_width, free_width + opposed_width);

        total_cost += receipt_cost;
        free_cost += receipt_free_cost;
        total_width += i128::from(receipt_width);
        signed_free_width += receipt.side.path_sign() * free_width;
        if free_width > 0 {
            free_users += 1;
        }
        max_remaining_fragments = max_remaining_fragments
            .max(u32::try_from(split.opposed.len()).expect("fragment count fits in u32"));
        for (index, policy) in FEE_POLICIES.iter().enumerate() {
            fee_totals[index] += policy.fee(receipt_free_cost, free_width);
        }
        if !split.opposed.is_empty() {
            reduced.push(Receipt {
                id: receipt.id,
                segments: split.opposed,
                side: receipt.side,
            });
        }
    }

    assert_eq!(matched_market_cap(&reduced), original_matched);
    let reduced_path = book.current_path - signed_free_width;
    let path_from_support = book.opening_path
        + reduced
            .iter()
            .map(|receipt| receipt.side.path_sign() * receipt.width())
            .sum::<i64>();
    assert_eq!(reduced_path, path_from_support);

    let mut retraction_display_move = 0.0;
    let mut retractable = 0_u32;
    let mut retraction_fee_totals = [0.0; FEE_POLICIES.len()];
    for probe in &book.retractions {
        retraction_display_move += probe.display_move;
        if probe.free_width > 0 {
            retractable += 1;
        }
        for (index, policy) in FEE_POLICIES.iter().enumerate() {
            retraction_fee_totals[index] += policy.fee(probe.free_cost, probe.free_width);
        }
    }

    #[allow(clippy::cast_precision_loss)]
    let receipt_count = book.receipts.len() as f64;
    let matched_width_ratio = if total_width == 0 {
        0.0
    } else {
        #[allow(clippy::cast_precision_loss)]
        {
            original_matched as f64 / total_width as f64
        }
    };
    TrialMetrics {
        fee_totals,
        free_cost,
        free_cost_ratio: ratio(free_cost, total_cost),
        free_receipt_ratio: f64::from(free_users) / receipt_count,
        matched_width_ratio,
        max_remaining_fragments,
        retraction_display_move,
        retraction_fee_totals,
        retractable_receipt_ratio: f64::from(retractable) / receipt_count,
    }
}

fn assert_book_shape(book: &Book) {
    let signed_width: i64 = book
        .receipts
        .iter()
        .map(|receipt| {
            for segment in &receipt.segments {
                assert!(segment.high > segment.low);
            }
            receipt.side.path_sign() * receipt.width()
        })
        .sum();
    assert_eq!(book.current_path, book.opening_path + signed_width);
}

fn assert_close(left: f64, right: f64, label: &str) {
    let tolerance = 1e-11 * left.abs().max(right.abs()).max(1.0);
    assert!(
        (left - right).abs() <= tolerance,
        "{label}: {left} != {right}"
    );
}

fn ratio(numerator: f64, denominator: f64) -> f64 {
    if denominator == 0.0 {
        0.0
    } else {
        numerator / denominator
    }
}

#[cfg(test)]
mod tests {
    use super::analyze_book;
    use crate::scenario::{Scenario, generate_book};

    #[test]
    fn withdrawal_invariants_hold_for_many_books() {
        for scenario in Scenario::ALL {
            for seed in 0..2_000 {
                let book = generate_book(scenario, 40, seed);
                let metrics = analyze_book(&book);
                assert!((0.0..=1.0).contains(&metrics.free_cost_ratio));
                assert!((0.0..=1.0).contains(&metrics.matched_width_ratio));
            }
        }
    }
}
