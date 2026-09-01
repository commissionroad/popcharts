use crate::model::{COORDINATE_SCALE, Coordinate, Segment, Side};

#[must_use]
pub fn coordinate_as_b_units(value: Coordinate) -> f64 {
    #[allow(clippy::cast_precision_loss)]
    {
        value as f64 / COORDINATE_SCALE as f64
    }
}

#[must_use]
pub fn sigmoid(path: Coordinate) -> f64 {
    let x = coordinate_as_b_units(path);
    if x >= 0.0 {
        1.0 / (1.0 + (-x).exp())
    } else {
        let exp = x.exp();
        exp / (1.0 + exp)
    }
}

#[must_use]
pub fn side_cost(segment: Segment, side: Side) -> f64 {
    let yes = softplus(coordinate_as_b_units(segment.high))
        - softplus(coordinate_as_b_units(segment.low));
    match side {
        Side::Yes => yes,
        Side::No => coordinate_as_b_units(segment.width()) - yes,
    }
}

#[must_use]
pub fn segments_cost(segments: &[Segment], side: Side) -> f64 {
    segments
        .iter()
        .map(|segment| side_cost(*segment, side))
        .sum()
}

fn softplus(x: f64) -> f64 {
    x.max(0.0) + (-x.abs()).exp().ln_1p()
}

#[cfg(test)]
mod tests {
    use super::{side_cost, sigmoid};
    use crate::model::{COORDINATE_SCALE, Segment, Side};

    #[test]
    fn complementary_costs_equal_width() {
        let segment = Segment::new(-2 * COORDINATE_SCALE, 3 * COORDINATE_SCALE);
        let total = side_cost(segment, Side::Yes) + side_cost(segment, Side::No);
        assert!((total - 5.0).abs() < 1e-12);
    }

    #[test]
    fn stable_sigmoid_handles_extremes() {
        assert!(sigmoid(40 * COORDINATE_SCALE) > 0.999_999);
        assert!(sigmoid(-40 * COORDINATE_SCALE) < 0.000_001);
    }
}
