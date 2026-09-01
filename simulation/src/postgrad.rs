use serde::{Deserialize, Serialize};

const MIN_PRICE: f64 = 0.001;
const MAX_PRICE: f64 = 0.999;
const LP_FEE_RATE: f64 = 0.003;
const PROTOCOL_FEE_RATE: f64 = 0.001;
const TICK_PRICE_RATIO: f64 = 1.0001;
const TICK_SPACING: i32 = 60;
const MAKER_BANDS_PER_SIDE: usize = 64;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    Buy,
    Sell,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OutcomeSide {
    Yes,
    No,
}

impl OutcomeSide {
    #[must_use]
    pub const fn complement_price(self, yes_price: f64) -> f64 {
        match self {
            Self::Yes => yes_price,
            Self::No => 1.0 - yes_price,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Trade {
    pub direction: Direction,
    pub side: OutcomeSide,
    pub outcome_amount: f64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Execution {
    pub collateral: f64,
    pub filled_outcome: f64,
    pub lp_fee_collateral: f64,
    pub lp_fee_outcome: f64,
    pub protocol_fee_collateral: f64,
    pub protocol_fee_outcome: f64,
    pub requested_outcome: f64,
}

impl Execution {
    #[must_use]
    pub fn fill_ratio(self) -> f64 {
        if self.requested_outcome == 0.0 {
            1.0
        } else {
            self.filled_outcome / self.requested_outcome
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VenueKind {
    FeeOnlyPool,
    BroadPool,
    ConcentratedPool,
    MakerLadder,
    HybridPool,
    FundedScoringMaker,
}

impl VenueKind {
    pub const ALL: [Self; 6] = [
        Self::FeeOnlyPool,
        Self::BroadPool,
        Self::ConcentratedPool,
        Self::MakerLadder,
        Self::HybridPool,
        Self::FundedScoringMaker,
    ];

    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::FeeOnlyPool => "fee-only pool",
            Self::BroadPool => "broad pool",
            Self::ConcentratedPool => "concentrated pool",
            Self::MakerLadder => "maker ladder",
            Self::HybridPool => "pool + maker ladder",
            Self::FundedScoringMaker => "funded scoring maker",
        }
    }
}

#[derive(Clone, Debug)]
pub enum Venue {
    Pool(PoolPair),
    Scoring(FundedScoringMaker),
}

impl Venue {
    #[must_use]
    /// Creates a venue with the requested opening price and capital policy.
    ///
    /// # Panics
    ///
    /// Panics if the opening price is outside the configured pool bounds or
    /// if the capital budget is not positive.
    pub fn new(kind: VenueKind, opening_price: f64, equal_capital: f64) -> Self {
        assert!(opening_price > MIN_PRICE && opening_price < MAX_PRICE);
        assert!(equal_capital > 0.0);
        match kind {
            VenueKind::FeeOnlyPool => Self::Pool(PoolPair::new(
                PoolShape::Broad,
                opening_price,
                equal_capital * 0.05,
            )),
            VenueKind::BroadPool => Self::Pool(PoolPair::new(
                PoolShape::Broad,
                opening_price,
                equal_capital,
            )),
            VenueKind::ConcentratedPool => Self::Pool(PoolPair::new(
                PoolShape::Concentrated,
                opening_price,
                equal_capital,
            )),
            VenueKind::MakerLadder => Self::Pool(PoolPair::new(
                PoolShape::MakerLadder,
                opening_price,
                equal_capital,
            )),
            VenueKind::HybridPool => Self::Pool(PoolPair::new(
                PoolShape::Hybrid,
                opening_price,
                equal_capital,
            )),
            VenueKind::FundedScoringMaker => {
                Self::Scoring(FundedScoringMaker::new(opening_price, equal_capital))
            }
        }
    }

    #[must_use]
    pub fn capital(&self) -> f64 {
        match self {
            Self::Pool(pair) => pair.initial_capital,
            Self::Scoring(maker) => maker.capital,
        }
    }

    #[must_use]
    pub fn spot(&self, side: OutcomeSide) -> f64 {
        match self {
            Self::Pool(pair) => pair.spot(side),
            Self::Scoring(maker) => maker.spot(side),
        }
    }

    #[must_use]
    pub fn coherence_error(&self) -> f64 {
        (self.spot(OutcomeSide::Yes) + self.spot(OutcomeSide::No) - 1.0).abs()
    }

    pub fn execute(&mut self, trade: Trade) -> Execution {
        match self {
            Self::Pool(pair) => pair.execute(trade),
            Self::Scoring(maker) => maker.execute(trade),
        }
    }

    pub fn rebalance(&mut self) {
        if let Self::Pool(pair) = self {
            pair.rebalance();
        }
    }

    #[must_use]
    pub fn terminal_profit(&self, yes_wins: bool) -> f64 {
        match self {
            Self::Pool(pair) => pair.terminal_profit(yes_wins),
            Self::Scoring(maker) => {
                maker.cash
                    - maker.net_yes_sold * f64::from(yes_wins)
                    - maker.net_no_sold * f64::from(!yes_wins)
            }
        }
    }

    #[must_use]
    pub fn lp_fees_at_price(&self, outcome_price: f64) -> f64 {
        match self {
            Self::Pool(pair) => pair.lp_fees_at_price(outcome_price),
            Self::Scoring(maker) => maker.fees,
        }
    }

    #[must_use]
    pub fn protocol_fees_at_price(&self, outcome_price: f64) -> f64 {
        match self {
            Self::Pool(pair) => pair.protocol_fees_at_price(outcome_price),
            Self::Scoring(_) => 0.0,
        }
    }

    #[must_use]
    pub fn conservation_error(&self) -> f64 {
        match self {
            Self::Pool(pair) => pair.conservation_error(),
            Self::Scoring(_) => 0.0,
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum PoolShape {
    Broad,
    Concentrated,
    MakerLadder,
    Hybrid,
}

#[derive(Clone, Debug)]
pub struct PoolPair {
    initial_capital: f64,
    no: ConcentratedLiquidityPool,
    yes: ConcentratedLiquidityPool,
}

impl PoolPair {
    fn new(shape: PoolShape, yes_price: f64, capital: f64) -> Self {
        let yes = Self::pool(shape, yes_price, capital * yes_price);
        let no = Self::pool(shape, 1.0 - yes_price, capital * (1.0 - yes_price));
        let initial_capital = yes.initial_capital + no.initial_capital;
        Self {
            initial_capital,
            no,
            yes,
        }
    }

    fn pool(shape: PoolShape, price: f64, capital: f64) -> ConcentratedLiquidityPool {
        match shape {
            PoolShape::Broad => ConcentratedLiquidityPool::broad(price, capital),
            PoolShape::Concentrated => ConcentratedLiquidityPool::concentrated(price, capital),
            PoolShape::MakerLadder => ConcentratedLiquidityPool::maker_ladder(price, capital),
            PoolShape::Hybrid => ConcentratedLiquidityPool::hybrid(price, capital),
        }
    }

    fn pool_for(&self, side: OutcomeSide) -> &ConcentratedLiquidityPool {
        match side {
            OutcomeSide::Yes => &self.yes,
            OutcomeSide::No => &self.no,
        }
    }

    fn pool_for_mut(&mut self, side: OutcomeSide) -> &mut ConcentratedLiquidityPool {
        match side {
            OutcomeSide::Yes => &mut self.yes,
            OutcomeSide::No => &mut self.no,
        }
    }

    fn spot(&self, side: OutcomeSide) -> f64 {
        self.pool_for(side).spot()
    }

    fn execute(&mut self, trade: Trade) -> Execution {
        self.pool_for_mut(trade.side).execute(trade)
    }

    fn rebalance(&mut self) {
        let lower_sum = fee_multiplier();
        let upper_sum = 1.0 / fee_multiplier();
        for _ in 0..512 {
            let sum = self.yes.spot() + self.no.spot();
            if sum > upper_sum + 1e-10 {
                let Some((yes_capacity, yes_derivative)) = self.yes.arbitrage_step(Direction::Sell)
                else {
                    break;
                };
                let Some((no_capacity, no_derivative)) = self.no.arbitrage_step(Direction::Sell)
                else {
                    break;
                };
                let amount = ((sum - upper_sum) / (yes_derivative + no_derivative) * 0.9)
                    .min(yes_capacity)
                    .min(no_capacity);
                if amount <= 1e-12 {
                    break;
                }
                let _ = self.yes.execute(Trade {
                    direction: Direction::Sell,
                    side: OutcomeSide::Yes,
                    outcome_amount: amount,
                });
                let _ = self.no.execute(Trade {
                    direction: Direction::Sell,
                    side: OutcomeSide::No,
                    outcome_amount: amount,
                });
            } else if sum < lower_sum - 1e-10 {
                let Some((yes_capacity, yes_derivative)) = self.yes.arbitrage_step(Direction::Buy)
                else {
                    break;
                };
                let Some((no_capacity, no_derivative)) = self.no.arbitrage_step(Direction::Buy)
                else {
                    break;
                };
                let amount = ((lower_sum - sum) / (yes_derivative + no_derivative) * 0.9)
                    .min(yes_capacity)
                    .min(no_capacity);
                if amount <= 1e-12 {
                    break;
                }
                let _ = self.yes.execute(Trade {
                    direction: Direction::Buy,
                    side: OutcomeSide::Yes,
                    outcome_amount: amount,
                });
                let _ = self.no.execute(Trade {
                    direction: Direction::Buy,
                    side: OutcomeSide::No,
                    outcome_amount: amount,
                });
            } else {
                break;
            }
        }
    }

    fn terminal_profit(&self, yes_wins: bool) -> f64 {
        self.yes.terminal_value(yes_wins) + self.no.terminal_value(!yes_wins) - self.initial_capital
    }

    fn lp_fees_at_price(&self, yes_price: f64) -> f64 {
        self.yes.lp_fees_at_price(yes_price) + self.no.lp_fees_at_price(1.0 - yes_price)
    }

    fn protocol_fees_at_price(&self, yes_price: f64) -> f64 {
        self.yes.protocol_fees_at_price(yes_price) + self.no.protocol_fees_at_price(1.0 - yes_price)
    }

    fn conservation_error(&self) -> f64 {
        self.yes
            .conservation_error()
            .max(self.no.conservation_error())
    }
}

#[derive(Clone, Debug)]
struct Position {
    liquidity: f64,
    lower_sqrt: f64,
    upper_sqrt: f64,
    fee_collateral: f64,
    fee_outcome: f64,
}

impl Position {
    fn amounts(&self, sqrt_price: f64) -> (f64, f64) {
        let price = sqrt_price.clamp(self.lower_sqrt, self.upper_sqrt);
        let outcome = self.liquidity * (self.upper_sqrt - price) / (price * self.upper_sqrt);
        let collateral = self.liquidity * (price - self.lower_sqrt);
        (outcome, collateral)
    }
}

#[derive(Clone, Debug)]
pub struct ConcentratedLiquidityPool {
    initial_capital: f64,
    initial_collateral: f64,
    initial_outcome: f64,
    positions: Vec<Position>,
    protocol_fee_collateral: f64,
    protocol_fee_outcome: f64,
    sqrt_price: f64,
    user_collateral_delta: f64,
    user_outcome_delta: f64,
}

impl ConcentratedLiquidityPool {
    fn broad(opening_price: f64, capital: f64) -> Self {
        Self::from_ranges(opening_price, &[(MIN_PRICE, MAX_PRICE, capital)])
    }

    fn concentrated(opening_price: f64, capital: f64) -> Self {
        let factor = tick_factor(25);
        let lower = (opening_price / factor).max(MIN_PRICE);
        let upper = (opening_price * factor).min(MAX_PRICE);
        Self::from_ranges(opening_price, &[(lower, upper, capital)])
    }

    fn maker_ladder(opening_price: f64, capital: f64) -> Self {
        Self::from_ranges(opening_price, &maker_ranges(opening_price, capital))
    }

    fn hybrid(opening_price: f64, capital: f64) -> Self {
        let mut ranges = vec![(MIN_PRICE, MAX_PRICE, capital * 0.25)];
        ranges.extend(maker_ranges(opening_price, capital * 0.75));
        Self::from_ranges(opening_price, &ranges)
    }

    fn from_ranges(opening_price: f64, ranges: &[(f64, f64, f64)]) -> Self {
        let sqrt_price = opening_price.sqrt();
        let mut positions = Vec::with_capacity(ranges.len());
        let mut initial_outcome = 0.0;
        let mut initial_collateral = 0.0;
        for &(lower, upper, capital) in ranges {
            let lower_sqrt = lower.sqrt();
            let upper_sqrt = upper.sqrt();
            let unit = Position {
                liquidity: 1.0,
                lower_sqrt,
                upper_sqrt,
                fee_collateral: 0.0,
                fee_outcome: 0.0,
            };
            let (unit_outcome, unit_collateral) = unit.amounts(sqrt_price);
            let marked_unit = unit_collateral + unit_outcome * opening_price;
            assert!(marked_unit > 0.0);
            let position = Position {
                liquidity: capital / marked_unit,
                ..unit
            };
            let (outcome, collateral) = position.amounts(sqrt_price);
            initial_outcome += outcome;
            initial_collateral += collateral;
            positions.push(position);
        }
        let initial_capital = initial_collateral + initial_outcome * opening_price;
        Self {
            initial_capital,
            initial_collateral,
            initial_outcome,
            positions,
            protocol_fee_collateral: 0.0,
            protocol_fee_outcome: 0.0,
            sqrt_price,
            user_collateral_delta: 0.0,
            user_outcome_delta: 0.0,
        }
    }

    #[must_use]
    pub fn spot(&self) -> f64 {
        self.sqrt_price * self.sqrt_price
    }

    fn execute(&mut self, trade: Trade) -> Execution {
        assert!(trade.outcome_amount >= 0.0 && trade.outcome_amount.is_finite());
        match trade.direction {
            Direction::Buy => self.buy(trade.outcome_amount),
            Direction::Sell => self.sell(trade.outcome_amount),
        }
    }

    fn arbitrage_step(&self, direction: Direction) -> Option<(f64, f64)> {
        let active = self.active_indices(direction);
        let liquidity = self.active_liquidity(&active);
        if liquidity == 0.0 {
            return None;
        }
        let boundary = self.next_boundary(direction);
        let (capacity, derivative) = match direction {
            Direction::Buy => (
                liquidity * (1.0 / self.sqrt_price - 1.0 / boundary),
                2.0 * self.sqrt_price.powi(3) / liquidity,
            ),
            Direction::Sell => (
                liquidity * (1.0 / boundary - 1.0 / self.sqrt_price) / fee_multiplier(),
                2.0 * self.sqrt_price.powi(3) * fee_multiplier() / liquidity,
            ),
        };
        (capacity > 0.0 && derivative > 0.0).then_some((capacity, derivative))
    }

    fn buy(&mut self, requested: f64) -> Execution {
        let mut remaining = requested;
        let mut effective_collateral = 0.0;
        let mut lp_fee_total = 0.0;
        while remaining > tolerance(requested) {
            let active = self.active_indices(Direction::Buy);
            let liquidity = self.active_liquidity(&active);
            if liquidity == 0.0 {
                break;
            }
            let boundary = self.next_boundary(Direction::Buy);
            let capacity = liquidity * (1.0 / self.sqrt_price - 1.0 / boundary);
            if capacity <= tolerance(requested) {
                self.sqrt_price = boundary;
                continue;
            }
            let filled = remaining.min(capacity);
            let next = 1.0 / (1.0 / self.sqrt_price - filled / liquidity);
            let collateral = liquidity * (next - self.sqrt_price);
            let segment_gross = collateral / fee_multiplier();
            let segment_protocol = segment_gross * PROTOCOL_FEE_RATE;
            let segment_lp = (segment_gross - segment_protocol) * LP_FEE_RATE;
            self.allocate_fee_to(&active, Direction::Buy, segment_lp);
            lp_fee_total += segment_lp;
            effective_collateral += collateral;
            remaining -= filled;
            self.sqrt_price = next.min(boundary);
        }
        let filled = requested - remaining;
        let multiplier = fee_multiplier();
        let gross_collateral = effective_collateral / multiplier;
        let protocol_fee = gross_collateral * PROTOCOL_FEE_RATE;
        self.protocol_fee_collateral += protocol_fee;
        self.user_collateral_delta += gross_collateral;
        self.user_outcome_delta -= filled;
        Execution {
            collateral: gross_collateral,
            filled_outcome: filled,
            lp_fee_collateral: lp_fee_total,
            protocol_fee_collateral: protocol_fee,
            requested_outcome: requested,
            ..Execution::default()
        }
    }

    fn sell(&mut self, requested: f64) -> Execution {
        let multiplier = fee_multiplier();
        let mut remaining_effective = requested * multiplier;
        let mut collateral_out = 0.0;
        let mut lp_fee_total = 0.0;
        while remaining_effective > tolerance(requested) {
            let active = self.active_indices(Direction::Sell);
            let liquidity = self.active_liquidity(&active);
            if liquidity == 0.0 {
                break;
            }
            let boundary = self.next_boundary(Direction::Sell);
            let capacity = liquidity * (1.0 / boundary - 1.0 / self.sqrt_price);
            if capacity <= tolerance(requested) {
                self.sqrt_price = boundary;
                continue;
            }
            let effective = remaining_effective.min(capacity);
            let next = 1.0 / (1.0 / self.sqrt_price + effective / liquidity);
            let segment_gross = effective / multiplier;
            let segment_protocol = segment_gross * PROTOCOL_FEE_RATE;
            let segment_lp = (segment_gross - segment_protocol) * LP_FEE_RATE;
            self.allocate_fee_to(&active, Direction::Sell, segment_lp);
            lp_fee_total += segment_lp;
            collateral_out += liquidity * (self.sqrt_price - next);
            remaining_effective -= effective;
            self.sqrt_price = next.max(boundary);
        }
        let effective_filled = requested * multiplier - remaining_effective;
        let gross_filled = effective_filled / multiplier;
        let protocol_fee = gross_filled * PROTOCOL_FEE_RATE;
        self.protocol_fee_outcome += protocol_fee;
        self.user_collateral_delta -= collateral_out;
        self.user_outcome_delta += gross_filled;
        Execution {
            collateral: collateral_out,
            filled_outcome: gross_filled,
            lp_fee_outcome: lp_fee_total,
            protocol_fee_outcome: protocol_fee,
            requested_outcome: requested,
            ..Execution::default()
        }
    }

    fn active_indices(&self, direction: Direction) -> Vec<usize> {
        self.positions
            .iter()
            .enumerate()
            .filter_map(|(index, position)| {
                let active = match direction {
                    Direction::Buy => {
                        position.lower_sqrt <= self.sqrt_price
                            && self.sqrt_price < position.upper_sqrt
                    }
                    Direction::Sell => {
                        position.lower_sqrt < self.sqrt_price
                            && self.sqrt_price <= position.upper_sqrt
                    }
                };
                active.then_some(index)
            })
            .collect()
    }

    fn active_liquidity(&self, active: &[usize]) -> f64 {
        active
            .iter()
            .map(|&index| self.positions[index].liquidity)
            .sum()
    }

    fn next_boundary(&self, direction: Direction) -> f64 {
        match direction {
            Direction::Buy => self
                .positions
                .iter()
                .flat_map(|position| [position.lower_sqrt, position.upper_sqrt])
                .filter(|&boundary| boundary > self.sqrt_price)
                .fold(f64::INFINITY, f64::min),
            Direction::Sell => self
                .positions
                .iter()
                .flat_map(|position| [position.lower_sqrt, position.upper_sqrt])
                .filter(|&boundary| boundary < self.sqrt_price)
                .fold(0.0, f64::max),
        }
    }

    fn allocate_fee_to(&mut self, active: &[usize], direction: Direction, amount: f64) {
        if amount == 0.0 {
            return;
        }
        let liquidity = self.active_liquidity(active);
        if liquidity == 0.0 {
            return;
        }
        for &index in active {
            let share = self.positions[index].liquidity / liquidity;
            match direction {
                Direction::Buy => self.positions[index].fee_collateral += amount * share,
                Direction::Sell => self.positions[index].fee_outcome += amount * share,
            }
        }
    }

    fn terminal_value(&self, yes_wins: bool) -> f64 {
        self.positions
            .iter()
            .map(|position| {
                let (outcome, collateral) = position.amounts(self.sqrt_price);
                collateral
                    + position.fee_collateral
                    + (outcome + position.fee_outcome) * f64::from(yes_wins)
            })
            .sum()
    }

    fn lp_fees_at_price(&self, outcome_price: f64) -> f64 {
        self.positions
            .iter()
            .map(|position| position.fee_collateral + position.fee_outcome * outcome_price)
            .sum()
    }

    fn protocol_fees_at_price(&self, outcome_price: f64) -> f64 {
        self.protocol_fee_collateral + self.protocol_fee_outcome * outcome_price
    }

    fn conservation_error(&self) -> f64 {
        let outcome: f64 = self
            .positions
            .iter()
            .map(|position| {
                let (amount, _) = position.amounts(self.sqrt_price);
                amount + position.fee_outcome
            })
            .sum();
        let collateral: f64 = self
            .positions
            .iter()
            .map(|position| {
                let (_, amount) = position.amounts(self.sqrt_price);
                amount + position.fee_collateral
            })
            .sum();
        let outcome_error =
            outcome + self.protocol_fee_outcome - self.initial_outcome - self.user_outcome_delta;
        let collateral_error = collateral + self.protocol_fee_collateral
            - self.initial_collateral
            - self.user_collateral_delta;
        outcome_error.abs().max(collateral_error.abs())
    }
}

#[derive(Clone, Debug)]
pub struct FundedScoringMaker {
    b: f64,
    capital: f64,
    cash: f64,
    fees: f64,
    net_no_sold: f64,
    net_yes_sold: f64,
    path: f64,
}

impl FundedScoringMaker {
    fn new(opening_price: f64, capital: f64) -> Self {
        let worst_log_loss = -opening_price.min(1.0 - opening_price).ln();
        let b = capital / worst_log_loss;
        Self {
            b,
            capital,
            cash: 0.0,
            fees: 0.0,
            net_no_sold: 0.0,
            net_yes_sold: 0.0,
            path: b * (opening_price / (1.0 - opening_price)).ln(),
        }
    }

    #[must_use]
    pub fn spot(&self, side: OutcomeSide) -> f64 {
        side.complement_price(sigmoid(self.path / self.b))
    }

    fn execute(&mut self, trade: Trade) -> Execution {
        let signed_amount = match trade.direction {
            Direction::Buy => trade.outcome_amount,
            Direction::Sell => -trade.outcome_amount,
        };
        let (next_path, raw_cost) = match trade.side {
            OutcomeSide::Yes => {
                let next = self.path + signed_amount;
                (next, self.cost(next) - self.cost(self.path))
            }
            OutcomeSide::No => {
                let next = self.path - signed_amount;
                (next, signed_amount + self.cost(next) - self.cost(self.path))
            }
        };
        let fee_rate = 1.0 - fee_multiplier();
        let fee = raw_cost.abs() * fee_rate;
        self.path = next_path;
        match trade.side {
            OutcomeSide::Yes => self.net_yes_sold += signed_amount,
            OutcomeSide::No => self.net_no_sold += signed_amount,
        }
        self.fees += fee;
        self.cash += raw_cost + fee;
        Execution {
            collateral: match trade.direction {
                Direction::Buy => raw_cost + fee,
                Direction::Sell => -raw_cost - fee,
            },
            filled_outcome: trade.outcome_amount,
            lp_fee_collateral: fee,
            requested_outcome: trade.outcome_amount,
            ..Execution::default()
        }
    }

    fn cost(&self, path: f64) -> f64 {
        self.b * softplus(path / self.b)
    }
}

fn maker_ranges(opening_price: f64, capital: f64) -> Vec<(f64, f64, f64)> {
    let mut boundaries = Vec::with_capacity(MAKER_BANDS_PER_SIDE * 2);
    let factor = tick_factor(1);
    let mut sell_lower = opening_price;
    let mut buy_upper = opening_price;
    for _ in 0..MAKER_BANDS_PER_SIDE {
        let sell_upper = (sell_lower * factor).min(MAX_PRICE);
        if sell_upper > sell_lower {
            boundaries.push((sell_lower, sell_upper));
        }
        sell_lower = sell_upper;
        let buy_lower = (buy_upper / factor).max(MIN_PRICE);
        if buy_upper > buy_lower {
            boundaries.push((buy_lower, buy_upper));
        }
        buy_upper = buy_lower;
    }
    #[allow(clippy::cast_precision_loss)]
    let budget = capital / boundaries.len() as f64;
    boundaries
        .into_iter()
        .map(|(lower, upper)| (lower, upper, budget))
        .collect()
}

fn tick_factor(spacings: i32) -> f64 {
    TICK_PRICE_RATIO.powi(TICK_SPACING * spacings)
}

fn fee_multiplier() -> f64 {
    (1.0 - PROTOCOL_FEE_RATE) * (1.0 - LP_FEE_RATE)
}

fn tolerance(scale: f64) -> f64 {
    scale.abs().max(1.0) * 1e-12
}

fn sigmoid(value: f64) -> f64 {
    if value >= 0.0 {
        1.0 / (1.0 + (-value).exp())
    } else {
        let exp = value.exp();
        exp / (1.0 + exp)
    }
}

fn softplus(value: f64) -> f64 {
    if value > 0.0 {
        value + (-value).exp().ln_1p()
    } else {
        value.exp().ln_1p()
    }
}

#[cfg(test)]
mod tests {
    use super::{Direction, OutcomeSide, Trade, Venue, VenueKind, fee_multiplier};
    use crate::rng::SplitMix64;

    #[test]
    fn pool_round_trip_conserves_assets() {
        for kind in [
            VenueKind::BroadPool,
            VenueKind::ConcentratedPool,
            VenueKind::MakerLadder,
            VenueKind::HybridPool,
        ] {
            let mut venue = Venue::new(kind, 0.35, 10.0);
            for direction in [Direction::Buy, Direction::Sell] {
                let _ = venue.execute(Trade {
                    direction,
                    side: OutcomeSide::Yes,
                    outcome_amount: 0.25,
                });
                assert!(venue.conservation_error() < 1e-9, "{kind:?}");
            }
        }
    }

    #[test]
    fn fees_make_pool_round_trip_costly_to_taker() {
        let mut venue = Venue::new(VenueKind::BroadPool, 0.5, 100.0);
        let buy = venue.execute(Trade {
            direction: Direction::Buy,
            side: OutcomeSide::Yes,
            outcome_amount: 1.0,
        });
        let sell = venue.execute(Trade {
            direction: Direction::Sell,
            side: OutcomeSide::Yes,
            outcome_amount: buy.filled_outcome,
        });
        assert!(buy.collateral > sell.collateral);
        assert!((venue.spot(OutcomeSide::Yes) - 0.5).abs() < 1e-3);
        assert!(venue.conservation_error() < 1e-9);
    }

    #[test]
    fn funded_maker_respects_binary_worst_loss_budget() {
        for opening_price in [0.1, 0.35, 0.5, 0.8] {
            let capital = 10.0;
            let mut yes = Venue::new(VenueKind::FundedScoringMaker, opening_price, capital);
            let _ = yes.execute(Trade {
                direction: Direction::Buy,
                side: OutcomeSide::Yes,
                outcome_amount: 10_000.0,
            });
            assert!(yes.terminal_profit(true) >= -capital - 1e-9);

            let mut no = Venue::new(VenueKind::FundedScoringMaker, opening_price, capital);
            let _ = no.execute(Trade {
                direction: Direction::Buy,
                side: OutcomeSide::No,
                outcome_amount: 10_000.0,
            });
            assert!(no.terminal_profit(false) >= -capital - 1e-9);
        }
    }

    #[test]
    fn funded_maker_at_even_odds_uses_standard_budget_mapping() {
        let venue = Venue::new(VenueKind::FundedScoringMaker, 0.5, std::f64::consts::LN_2);
        match venue {
            Venue::Scoring(maker) => assert!((maker.b - 1.0).abs() < 1e-12),
            Venue::Pool(_) => panic!("expected scoring maker"),
        }
    }

    #[test]
    fn funded_maker_loss_bound_holds_under_signed_two_outcome_flow() {
        let capital = 10.0;
        for seed in 0..100 {
            let mut rng = SplitMix64::new(seed);
            let opening_price = rng.range_f64(0.05, 0.95);
            let mut venue = Venue::new(VenueKind::FundedScoringMaker, opening_price, capital);
            for _ in 0..500 {
                let _ = venue.execute(Trade {
                    direction: if rng.chance(0.5) {
                        Direction::Buy
                    } else {
                        Direction::Sell
                    },
                    side: if rng.chance(0.5) {
                        OutcomeSide::Yes
                    } else {
                        OutcomeSide::No
                    },
                    outcome_amount: rng.range_f64(0.0, 5.0),
                });
            }
            assert!(venue.terminal_profit(true) >= -capital - 1e-8);
            assert!(venue.terminal_profit(false) >= -capital - 1e-8);
        }
    }

    #[test]
    fn broad_pair_keeper_stays_inside_the_fee_band_and_conserves() {
        let mut venue = Venue::new(VenueKind::BroadPool, 0.35, 10.0);
        let mut rng = SplitMix64::new(7);
        for _ in 0..500 {
            let _ = venue.execute(Trade {
                direction: if rng.chance(0.5) {
                    Direction::Buy
                } else {
                    Direction::Sell
                },
                side: if rng.chance(0.5) {
                    OutcomeSide::Yes
                } else {
                    OutcomeSide::No
                },
                outcome_amount: rng.range_f64(0.01, 0.5),
            });
            venue.rebalance();
            let sum = venue.spot(OutcomeSide::Yes) + venue.spot(OutcomeSide::No);
            assert!(sum >= fee_multiplier() - 1e-8);
            assert!(sum <= 1.0 / fee_multiplier() + 1e-8);
            assert!(venue.conservation_error() < 1e-9);
        }
    }
}
