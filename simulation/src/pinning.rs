use serde::Serialize;

use crate::lmsr::side_cost;
use crate::model::{COORDINATE_SCALE, Coordinate, Segment, Side};

#[derive(Clone, Debug, Serialize)]
pub struct PinningPoint {
    pub display_move_percentage_points: f64,
    pub end_probability_percent: f64,
    pub opponent_cost: f64,
    pub opponent_to_victim_cost_percent: f64,
    pub start_probability_percent: f64,
    pub victim_cost: f64,
}

#[must_use]
pub fn pinning_grid() -> Vec<PinningPoint> {
    const BANDS: [(f64, f64); 8] = [
        (5.0, 10.0),
        (10.0, 20.0),
        (20.0, 35.0),
        (35.0, 50.0),
        (50.0, 65.0),
        (65.0, 80.0),
        (80.0, 90.0),
        (90.0, 95.0),
    ];
    BANDS
        .into_iter()
        .map(|(start, end)| {
            let segment = Segment::new(
                coordinate_for_probability(start),
                coordinate_for_probability(end),
            );
            let victim_cost = side_cost(segment, Side::Yes);
            let opponent_cost = side_cost(segment, Side::No);
            PinningPoint {
                display_move_percentage_points: end - start,
                end_probability_percent: end,
                opponent_cost,
                opponent_to_victim_cost_percent: opponent_cost / victim_cost * 100.0,
                start_probability_percent: start,
                victim_cost,
            }
        })
        .collect()
}

fn coordinate_for_probability(percent: f64) -> Coordinate {
    let probability = percent / 100.0;
    let logit = (probability / (1.0 - probability)).ln();
    #[allow(clippy::cast_possible_truncation, clippy::cast_precision_loss)]
    {
        (logit * COORDINATE_SCALE as f64).round() as Coordinate
    }
}

#[cfg(test)]
mod tests {
    use super::pinning_grid;

    #[test]
    fn complementary_pinning_cost_is_cheapest_near_yes_extreme() {
        let grid = pinning_grid();
        assert!(grid.last().unwrap().opponent_to_victim_cost_percent < 10.0);
        assert!(grid.first().unwrap().opponent_to_victim_cost_percent > 900.0);
    }
}
