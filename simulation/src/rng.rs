#[derive(Clone, Debug)]
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    #[must_use]
    pub const fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    #[must_use]
    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        mix(self.state)
    }

    #[must_use]
    pub fn unit_f64(&mut self) -> f64 {
        let mantissa = self.next_u64() >> 11;
        #[allow(clippy::cast_precision_loss)]
        {
            mantissa as f64 * (1.0 / ((1_u64 << 53) as f64))
        }
    }

    #[must_use]
    pub fn chance(&mut self, probability: f64) -> bool {
        self.unit_f64() < probability
    }

    #[must_use]
    pub fn range_f64(&mut self, low: f64, high: f64) -> f64 {
        low + self.unit_f64() * (high - low)
    }
}

#[must_use]
pub const fn mix(mut value: u64) -> u64 {
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

#[cfg(test)]
mod tests {
    use super::{SplitMix64, mix};

    #[test]
    fn same_seed_repeats_exactly() {
        let mut first = SplitMix64::new(42);
        let mut second = SplitMix64::new(42);
        for _ in 0..100 {
            assert_eq!(first.next_u64(), second.next_u64());
        }
    }

    #[test]
    fn trial_mix_changes_adjacent_seeds() {
        assert_ne!(mix(1), mix(2));
    }
}
