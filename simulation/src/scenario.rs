use clap::ValueEnum;
use serde::Serialize;

use crate::interval::{insert_into_union, split_segments};
use crate::lmsr::{segments_cost, sigmoid};
use crate::model::{Book, COORDINATE_SCALE, Coordinate, Receipt, RetractionProbe, Segment, Side};
use crate::rng::SplitMix64;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, ValueEnum)]
#[serde(rename_all = "snake_case")]
pub enum Scenario {
    BalancedNoise,
    Momentum,
    Informed,
    OneSided,
    Mixed,
}

impl Scenario {
    pub const ALL: [Self; 5] = [
        Self::BalancedNoise,
        Self::Momentum,
        Self::Informed,
        Self::OneSided,
        Self::Mixed,
    ];

    #[must_use]
    pub const fn seed_domain(self) -> u64 {
        match self {
            Self::BalancedNoise => 1,
            Self::Momentum => 2,
            Self::Informed => 3,
            Self::OneSided => 4,
            Self::Mixed => 5,
        }
    }

    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::BalancedNoise => "balanced_noise",
            Self::Momentum => "momentum",
            Self::Informed => "informed",
            Self::OneSided => "one_sided",
            Self::Mixed => "mixed",
        }
    }
}

#[must_use]
/// Generates one deterministic sequential receipt book.
///
/// # Panics
///
/// Panics if `receipt_count` is larger than `u32::MAX`, which cannot be
/// represented by the simulation receipt identifier.
pub fn generate_book(scenario: Scenario, receipt_count: usize, seed: u64) -> Book {
    let mut rng = SplitMix64::new(seed);
    let opening_path = coordinate(rng.range_f64(-2.0, 2.0));
    let mut path = opening_path;
    let mut fair_path = opening_path;
    let mut previous_side = if rng.chance(0.5) { Side::Yes } else { Side::No };
    let dominant_side = previous_side;
    let mut receipts = Vec::with_capacity(receipt_count);
    let mut retractions = Vec::with_capacity(receipt_count);
    let mut yes_union = Vec::new();
    let mut no_union = Vec::new();

    for index in 0..receipt_count {
        fair_path += coordinate(rng.range_f64(-0.12, 0.12));
        if rng.chance(0.04) {
            fair_path += coordinate(if rng.chance(0.5) { 0.9 } else { -0.9 });
        }

        let side = choose_side(
            scenario,
            path,
            fair_path,
            previous_side,
            dominant_side,
            &mut rng,
        );
        let width = coordinate(rng.range_f64(0.05, 0.75)).max(1);
        let segment = match side {
            Side::Yes => Segment::new(path, path + width),
            Side::No => Segment::new(path - width, path),
        };
        path += side.path_sign() * width;

        let opposite_union = match side {
            Side::Yes => &no_union,
            Side::No => &yes_union,
        };
        let split = split_segments(&[segment], opposite_union);
        let free_width: Coordinate = split.free.iter().map(|part| part.width()).sum();
        let free_cost = segments_cost(&split.free, side);
        let path_without_free = path - side.path_sign() * free_width;
        retractions.push(RetractionProbe {
            display_move: (sigmoid(path) - sigmoid(path_without_free)).abs(),
            free_cost,
            free_width,
        });

        receipts.push(Receipt {
            id: u32::try_from(index + 1).expect("receipt count fits in u32"),
            segments: vec![segment],
            side,
        });
        match side {
            Side::Yes => insert_into_union(&mut yes_union, segment),
            Side::No => insert_into_union(&mut no_union, segment),
        }
        previous_side = side;
    }

    Book {
        current_path: path,
        opening_path,
        receipts,
        retractions,
    }
}

fn choose_side(
    scenario: Scenario,
    path: Coordinate,
    fair_path: Coordinate,
    previous: Side,
    dominant: Side,
    rng: &mut SplitMix64,
) -> Side {
    match scenario {
        Scenario::BalancedNoise => random_side(rng),
        Scenario::Momentum => {
            if rng.chance(0.75) {
                previous
            } else {
                previous.opposite()
            }
        }
        Scenario::Informed => informed_side(path, fair_path, rng),
        Scenario::OneSided => {
            if rng.chance(0.85) {
                dominant
            } else {
                dominant.opposite()
            }
        }
        Scenario::Mixed => {
            let agent = rng.unit_f64();
            if agent < 0.50 {
                random_side(rng)
            } else if agent < 0.72 {
                if rng.chance(0.75) {
                    previous
                } else {
                    previous.opposite()
                }
            } else {
                informed_side(path, fair_path, rng)
            }
        }
    }
}

fn informed_side(path: Coordinate, fair_path: Coordinate, rng: &mut SplitMix64) -> Side {
    let favored = match fair_path.cmp(&path) {
        std::cmp::Ordering::Greater => Side::Yes,
        std::cmp::Ordering::Less => Side::No,
        std::cmp::Ordering::Equal => return random_side(rng),
    };
    if rng.chance(0.85) {
        favored
    } else {
        favored.opposite()
    }
}

fn random_side(rng: &mut SplitMix64) -> Side {
    if rng.chance(0.5) { Side::Yes } else { Side::No }
}

fn coordinate(value: f64) -> Coordinate {
    #[allow(clippy::cast_possible_truncation, clippy::cast_precision_loss)]
    {
        (value * COORDINATE_SCALE as f64).round() as Coordinate
    }
}

#[cfg(test)]
mod tests {
    use super::{Scenario, generate_book};

    #[test]
    fn generation_is_seed_deterministic() {
        let first = generate_book(Scenario::Mixed, 64, 7);
        let second = generate_book(Scenario::Mixed, 64, 7);
        assert_eq!(first.current_path, second.current_path);
        assert_eq!(first.receipts.len(), second.receipts.len());
        for (left, right) in first.receipts.iter().zip(&second.receipts) {
            assert_eq!(left.side, right.side);
            assert_eq!(left.segments, right.segments);
        }
    }
}
