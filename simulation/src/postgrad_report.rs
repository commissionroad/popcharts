use clap::ValueEnum;
use rayon::prelude::*;
use serde::Serialize;

use crate::postgrad::{Direction, OutcomeSide, Trade, Venue, VenueKind};
use crate::rng::{SplitMix64, mix};

const MATCHED_CAP: f64 = 100.0;
const EQUAL_CAPITAL: f64 = 10.0;
const FLOW_REFERENCE_DEPTH: f64 = 10.0;
const EXIT_SIZES: [f64; 5] = [0.1, 0.5, 1.0, 2.0, 5.0];

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, ValueEnum)]
#[serde(rename_all = "snake_case")]
pub enum PostgradScenario {
    Noise,
    Informed,
    ExitWave,
    ProbabilityShock,
    OneSided,
    Mixed,
}

impl PostgradScenario {
    pub const ALL: [Self; 6] = [
        Self::Noise,
        Self::Informed,
        Self::ExitWave,
        Self::ProbabilityShock,
        Self::OneSided,
        Self::Mixed,
    ];

    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Noise => "noise",
            Self::Informed => "informed",
            Self::ExitWave => "exit_wave",
            Self::ProbabilityShock => "probability_shock",
            Self::OneSided => "one_sided",
            Self::Mixed => "mixed",
        }
    }

    const fn seed_domain(self) -> u64 {
        match self {
            Self::Noise => 101,
            Self::Informed => 102,
            Self::ExitWave => 103,
            Self::ProbabilityShock => 104,
            Self::OneSided => 105,
            Self::Mixed => 106,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct PostgradConfig {
    pub root_seed: u64,
    pub scenarios: Vec<PostgradScenario>,
    pub threads: usize,
    pub trades_per_trial: usize,
    pub trials_per_scenario: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct PostgradReport {
    pub config: PostgradConfig,
    pub engine_version: &'static str,
    pub exit_size_benchmark: Vec<ExitSizeSummary>,
    pub model: PostgradModelSpecification,
    pub performance: PostgradPerformance,
    pub scenarios: Vec<PostgradScenarioSummary>,
    pub schema_version: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct PostgradModelSpecification {
    pub common_flow_reference_depth: f64,
    pub equal_capital_per_venue: f64,
    pub fee_only_capital: f64,
    pub lp_fee_percent: f64,
    pub matched_cap: f64,
    pub maker_bands_per_side: usize,
    pub pool_price_bounds: [f64; 2],
    pub protocol_fee_percent: f64,
    pub tick_spacing: i32,
}

#[derive(Clone, Debug, Serialize)]
pub struct PostgradPerformance {
    pub elapsed_seconds: f64,
    pub trade_attempts_per_second: f64,
    pub trade_attempts_total: usize,
    pub venue_trials_per_second: f64,
    pub venue_trials_total: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PostgradScenarioSummary {
    pub scenario: PostgradScenario,
    pub trials: usize,
    pub venues: Vec<VenueSummary>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct VenueSummary {
    pub capital: f64,
    pub coherence_error_percentage_points_mean: f64,
    pub conservation_error_max: f64,
    pub exit_fill_percent: f64,
    pub exit_requests_partially_or_unfilled_percent: f64,
    pub fees_as_percent_of_capital_mean: f64,
    pub price_error_percentage_points_mean: f64,
    pub provider_loss_probability_percent: f64,
    pub provider_profit_percent_mean: f64,
    pub provider_profit_percent_p05: f64,
    pub provider_profit_percent_p50: f64,
    pub sell_slippage_bps_p50: f64,
    pub sell_slippage_bps_p95: f64,
    pub traded_collateral_as_percent_of_capital_mean: f64,
    pub venue: VenueKind,
}

#[derive(Clone, Debug, Serialize)]
pub struct ExitSizeSummary {
    pub capital: f64,
    pub exit_fill_percent: f64,
    pub opening_price: f64,
    pub realized_price: f64,
    pub requested_outcome_as_percent_of_matched_cap: f64,
    pub slippage_bps: f64,
    pub venue: VenueKind,
}

#[derive(Clone, Debug)]
struct GeneratedTrial {
    final_probability: f64,
    opening_price: f64,
    trades: Vec<GeneratedTrade>,
    yes_wins: bool,
}

#[derive(Clone, Copy, Debug)]
struct GeneratedTrade {
    latent_probability: f64,
    trade: Trade,
}

#[derive(Clone, Debug, Default)]
struct TrialMetrics {
    capital: f64,
    coherence_error_sum: f64,
    conservation_error_max: f64,
    fees: f64,
    partially_or_unfilled_sells: usize,
    price_error_sum: f64,
    sell_filled: f64,
    sell_requested: f64,
    sell_slippages: Vec<f64>,
    sell_trades: usize,
    terminal_profit: f64,
    trade_attempts: usize,
    traded_collateral: f64,
}

/// Runs the post-graduation venue comparison in a deterministic private thread pool.
///
/// # Errors
///
/// Returns an error if Rayon cannot construct the requested thread pool.
///
/// # Panics
///
/// Panics if the configured trial or trade count is zero.
pub fn run_postgrad(config: PostgradConfig) -> Result<PostgradReport, rayon::ThreadPoolBuildError> {
    assert!(config.trades_per_trial > 0);
    assert!(config.trials_per_scenario > 0);
    let started = std::time::Instant::now();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(config.threads)
        .build()?;
    let mut scenarios = Vec::with_capacity(config.scenarios.len());
    for scenario in &config.scenarios {
        let trials = pool.install(|| {
            (0..config.trials_per_scenario)
                .into_par_iter()
                .map(|trial_index| {
                    let seed = trial_seed(config.root_seed, *scenario, trial_index);
                    let generated = generate_trial(*scenario, config.trades_per_trial, seed);
                    VenueKind::ALL.map(|kind| run_trial(kind, &generated))
                })
                .collect::<Vec<_>>()
        });
        scenarios.push(aggregate(*scenario, &trials));
    }
    let elapsed_seconds = started.elapsed().as_secs_f64();
    let venue_trials_total =
        config.trials_per_scenario * config.scenarios.len() * VenueKind::ALL.len();
    let trade_attempts_total = venue_trials_total * config.trades_per_trial;
    #[allow(clippy::cast_precision_loss)]
    let venue_trials_per_second = venue_trials_total as f64 / elapsed_seconds;
    #[allow(clippy::cast_precision_loss)]
    let trade_attempts_per_second = trade_attempts_total as f64 / elapsed_seconds;
    Ok(PostgradReport {
        config,
        engine_version: env!("CARGO_PKG_VERSION"),
        exit_size_benchmark: exit_size_benchmark(),
        model: PostgradModelSpecification {
            common_flow_reference_depth: FLOW_REFERENCE_DEPTH,
            equal_capital_per_venue: EQUAL_CAPITAL,
            fee_only_capital: EQUAL_CAPITAL * 0.05,
            lp_fee_percent: 0.3,
            matched_cap: MATCHED_CAP,
            maker_bands_per_side: 64,
            pool_price_bounds: [0.001, 0.999],
            protocol_fee_percent: 0.1,
            tick_spacing: 60,
        },
        performance: PostgradPerformance {
            elapsed_seconds,
            trade_attempts_per_second,
            trade_attempts_total,
            venue_trials_per_second,
            venue_trials_total,
        },
        scenarios,
        schema_version: 1,
    })
}

#[must_use]
pub fn render_postgrad_human(report: &PostgradReport) -> String {
    use std::fmt::Write;

    let mut output = String::new();
    writeln!(
        output,
        "Pop Charts post-graduation simulation: {} trials x {} scenarios x {} venues x {} trades",
        report.config.trials_per_scenario,
        report.config.scenarios.len(),
        VenueKind::ALL.len(),
        report.config.trades_per_trial,
    )
    .unwrap();
    writeln!(
        output,
        "seed={} threads={} elapsed={:.3}s\n",
        report.config.root_seed, report.config.threads, report.performance.elapsed_seconds
    )
    .unwrap();
    for scenario in &report.scenarios {
        writeln!(output, "{}", scenario.scenario.label()).unwrap();
        writeln!(
            output,
            "venue                  capital exit fill partial exits slip p50/p95  provider P&L mean/p05  loss prob  fees/capital"
        )
        .unwrap();
        for venue in &scenario.venues {
            writeln!(
                output,
                "{:<22} {:>7.2} {:>8.2}% {:>12.2}% {:>6.0}/{:<6.0} {:>8.2}%/{:<8.2}% {:>8.2}% {:>9.2}%",
                venue.venue.label(),
                venue.capital,
                venue.exit_fill_percent,
                venue.exit_requests_partially_or_unfilled_percent,
                venue.sell_slippage_bps_p50,
                venue.sell_slippage_bps_p95,
                venue.provider_profit_percent_mean,
                venue.provider_profit_percent_p05,
                venue.provider_loss_probability_percent,
                venue.fees_as_percent_of_capital_mean,
            )
            .unwrap();
        }
        writeln!(output).unwrap();
    }
    writeln!(output, "fresh 35% market exit-size benchmark").unwrap();
    writeln!(
        output,
        "venue                  capital request/cap fill       realized price  slippage"
    )
    .unwrap();
    for row in &report.exit_size_benchmark {
        writeln!(
            output,
            "{:<22} {:>7.2} {:>10.2}% {:>8.2}% {:>15.4} {:>9.0} bps",
            row.venue.label(),
            row.capital,
            row.requested_outcome_as_percent_of_matched_cap,
            row.exit_fill_percent,
            row.realized_price,
            row.slippage_bps,
        )
        .unwrap();
    }
    writeln!(
        output,
        "\nperformance: {:.0} venue trials/s, {:.0} trade attempts/s",
        report.performance.venue_trials_per_second, report.performance.trade_attempts_per_second,
    )
    .unwrap();
    output
}

fn generate_trial(scenario: PostgradScenario, trade_count: usize, seed: u64) -> GeneratedTrial {
    let mut rng = SplitMix64::new(seed);
    let opening_price = rng.range_f64(0.15, 0.85);
    let mut latent = opening_price;
    let mut reference_logit = (opening_price / (1.0 - opening_price)).ln();
    let dominant = if rng.chance(0.5) {
        Direction::Buy
    } else {
        Direction::Sell
    };
    let shock_up = rng.chance(0.5);
    let mut trades = Vec::with_capacity(trade_count);
    for index in 0..trade_count {
        latent = (latent + rng.range_f64(-0.025, 0.025)).clamp(0.02, 0.98);
        if scenario == PostgradScenario::ProbabilityShock && index == trade_count / 2 {
            latent = if shock_up {
                (latent + 0.30).min(0.98)
            } else {
                (latent - 0.30).max(0.02)
            };
        }
        let reference_price = sigmoid(reference_logit);
        let probability_direction = choose_direction(
            scenario,
            index,
            trade_count,
            reference_price,
            latent,
            dominant,
            &mut rng,
        );
        let side = if rng.chance(0.5) {
            OutcomeSide::Yes
        } else {
            OutcomeSide::No
        };
        let direction = match side {
            OutcomeSide::Yes => probability_direction,
            OutcomeSide::No => opposite(probability_direction),
        };
        let size_scale = if scenario == PostgradScenario::ExitWave && index >= trade_count * 2 / 5 {
            2.5
        } else {
            1.0
        };
        let outcome_amount = rng.range_f64(0.05, 1.0) * size_scale;
        reference_logit += match probability_direction {
            Direction::Buy => outcome_amount / FLOW_REFERENCE_DEPTH,
            Direction::Sell => -outcome_amount / FLOW_REFERENCE_DEPTH,
        };
        trades.push(GeneratedTrade {
            latent_probability: latent,
            trade: Trade {
                direction,
                side,
                outcome_amount,
            },
        });
    }
    let yes_wins = rng.chance(latent);
    GeneratedTrial {
        final_probability: latent,
        opening_price,
        trades,
        yes_wins,
    }
}

fn choose_direction(
    scenario: PostgradScenario,
    index: usize,
    trade_count: usize,
    reference_price: f64,
    latent: f64,
    dominant: Direction,
    rng: &mut SplitMix64,
) -> Direction {
    match scenario {
        PostgradScenario::Noise => random_direction(rng),
        PostgradScenario::Informed | PostgradScenario::ProbabilityShock => {
            informed_direction(reference_price, latent, rng)
        }
        PostgradScenario::ExitWave => {
            if index < trade_count * 2 / 5 {
                Direction::Buy
            } else {
                Direction::Sell
            }
        }
        PostgradScenario::OneSided => {
            if rng.chance(0.85) {
                dominant
            } else {
                opposite(dominant)
            }
        }
        PostgradScenario::Mixed => {
            let agent = rng.unit_f64();
            if agent < 0.45 {
                random_direction(rng)
            } else if agent < 0.75 {
                informed_direction(reference_price, latent, rng)
            } else if rng.chance(0.8) {
                dominant
            } else {
                opposite(dominant)
            }
        }
    }
}

fn informed_direction(reference_price: f64, latent: f64, rng: &mut SplitMix64) -> Direction {
    let favored = if latent >= reference_price {
        Direction::Buy
    } else {
        Direction::Sell
    };
    if rng.chance(0.85) {
        favored
    } else {
        opposite(favored)
    }
}

fn random_direction(rng: &mut SplitMix64) -> Direction {
    if rng.chance(0.5) {
        Direction::Buy
    } else {
        Direction::Sell
    }
}

const fn opposite(direction: Direction) -> Direction {
    match direction {
        Direction::Buy => Direction::Sell,
        Direction::Sell => Direction::Buy,
    }
}

fn run_trial(kind: VenueKind, trial: &GeneratedTrial) -> TrialMetrics {
    let mut venue = Venue::new(kind, trial.opening_price, EQUAL_CAPITAL);
    let mut metrics = TrialMetrics {
        capital: venue.capital(),
        ..TrialMetrics::default()
    };
    for generated in &trial.trades {
        metrics.trade_attempts += 1;
        let pretrade_spot = venue.spot(generated.trade.side);
        let execution = venue.execute(generated.trade);
        venue.rebalance();
        let conservation_error = venue.conservation_error();
        assert!(
            conservation_error <= venue.capital().max(1.0) * 1e-9,
            "asset conservation failed for {kind:?}: {conservation_error}"
        );
        metrics.conservation_error_max = metrics.conservation_error_max.max(conservation_error);
        metrics.traded_collateral += execution.collateral;
        metrics.coherence_error_sum += venue.coherence_error();
        let latent_outcome_price = generated
            .trade
            .side
            .complement_price(generated.latent_probability);
        metrics.price_error_sum += (venue.spot(generated.trade.side) - latent_outcome_price).abs();
        if generated.trade.direction == Direction::Sell {
            metrics.sell_trades += 1;
            metrics.sell_requested += execution.requested_outcome;
            metrics.sell_filled += execution.filled_outcome;
            if execution.fill_ratio() < 1.0 - 1e-10 {
                metrics.partially_or_unfilled_sells += 1;
            }
            if execution.filled_outcome > 0.0 {
                let reference = pretrade_spot * execution.filled_outcome;
                metrics
                    .sell_slippages
                    .push((1.0 - execution.collateral / reference) * 10_000.0);
            }
        }
    }
    metrics.fees = venue.lp_fees_at_price(trial.final_probability)
        + venue.protocol_fees_at_price(trial.final_probability);
    metrics.terminal_profit = venue.terminal_profit(trial.yes_wins);
    metrics
}

fn aggregate(scenario: PostgradScenario, trials: &[[TrialMetrics; 6]]) -> PostgradScenarioSummary {
    let venues = VenueKind::ALL
        .iter()
        .enumerate()
        .map(|(venue_index, kind)| {
            let metrics = trials
                .iter()
                .map(|trial| &trial[venue_index])
                .collect::<Vec<_>>();
            aggregate_venue(*kind, &metrics)
        })
        .collect();
    PostgradScenarioSummary {
        scenario,
        trials: trials.len(),
        venues,
    }
}

fn aggregate_venue(kind: VenueKind, trials: &[&TrialMetrics]) -> VenueSummary {
    assert!(!trials.is_empty());
    let capital = trials[0].capital;
    let total_sell_requested: f64 = trials.iter().map(|trial| trial.sell_requested).sum();
    let total_sell_filled: f64 = trials.iter().map(|trial| trial.sell_filled).sum();
    let total_sell_trades: usize = trials.iter().map(|trial| trial.sell_trades).sum();
    let total_partial: usize = trials
        .iter()
        .map(|trial| trial.partially_or_unfilled_sells)
        .sum();
    let mut profits = trials
        .iter()
        .map(|trial| trial.terminal_profit / capital * 100.0)
        .collect::<Vec<_>>();
    profits.sort_unstable_by(f64::total_cmp);
    let mut slippages = trials
        .iter()
        .flat_map(|trial| trial.sell_slippages.iter().copied())
        .collect::<Vec<_>>();
    slippages.sort_unstable_by(f64::total_cmp);
    let total_trade_attempts: usize = trials.iter().map(|trial| trial.trade_attempts).sum();
    #[allow(clippy::cast_precision_loss)]
    let trade_denominator = total_trade_attempts as f64;
    VenueSummary {
        capital,
        coherence_error_percentage_points_mean: trials
            .iter()
            .map(|trial| trial.coherence_error_sum)
            .sum::<f64>()
            / trade_denominator
            * 100.0,
        conservation_error_max: trials
            .iter()
            .map(|trial| trial.conservation_error_max)
            .fold(0.0, f64::max),
        exit_fill_percent: ratio(total_sell_filled, total_sell_requested) * 100.0,
        exit_requests_partially_or_unfilled_percent: if total_sell_trades == 0 {
            0.0
        } else {
            #[allow(clippy::cast_precision_loss)]
            {
                total_partial as f64 / total_sell_trades as f64 * 100.0
            }
        },
        fees_as_percent_of_capital_mean: mean(trials, |trial| trial.fees / capital) * 100.0,
        price_error_percentage_points_mean: trials
            .iter()
            .map(|trial| trial.price_error_sum)
            .sum::<f64>()
            / trade_denominator
            * 100.0,
        provider_loss_probability_percent: mean(trials, |trial| {
            if trial.terminal_profit < 0.0 {
                1.0
            } else {
                0.0
            }
        }) * 100.0,
        provider_profit_percent_mean: {
            #[allow(clippy::cast_precision_loss)]
            let denominator = profits.len() as f64;
            profits.iter().sum::<f64>() / denominator
        },
        provider_profit_percent_p05: quantile(&profits, 0.05),
        provider_profit_percent_p50: quantile(&profits, 0.50),
        sell_slippage_bps_p50: quantile_or_zero(&slippages, 0.50),
        sell_slippage_bps_p95: quantile_or_zero(&slippages, 0.95),
        traded_collateral_as_percent_of_capital_mean: mean(trials, |trial| {
            trial.traded_collateral / capital
        }) * 100.0,
        venue: kind,
    }
}

fn exit_size_benchmark() -> Vec<ExitSizeSummary> {
    let opening_price = 0.35;
    VenueKind::ALL
        .iter()
        .flat_map(|&kind| {
            EXIT_SIZES.map(move |size| {
                let mut venue = Venue::new(kind, opening_price, EQUAL_CAPITAL);
                let capital = venue.capital();
                let execution = venue.execute(Trade {
                    direction: Direction::Sell,
                    side: OutcomeSide::Yes,
                    outcome_amount: size,
                });
                let realized_price = ratio(execution.collateral, execution.filled_outcome);
                ExitSizeSummary {
                    capital,
                    exit_fill_percent: execution.fill_ratio() * 100.0,
                    opening_price,
                    realized_price,
                    requested_outcome_as_percent_of_matched_cap: size / MATCHED_CAP * 100.0,
                    slippage_bps: (1.0 - realized_price / opening_price) * 10_000.0,
                    venue: kind,
                }
            })
        })
        .collect()
}

fn trial_seed(root_seed: u64, scenario: PostgradScenario, trial: usize) -> u64 {
    let domain = scenario.seed_domain().wrapping_mul(0xd6e8_feb8_6659_fd93);
    let trial = u64::try_from(trial).expect("trial index fits in u64");
    mix(root_seed ^ domain ^ trial.wrapping_mul(0x9e37_79b9_7f4a_7c15))
}

fn mean(trials: &[&TrialMetrics], field: impl Fn(&TrialMetrics) -> f64) -> f64 {
    #[allow(clippy::cast_precision_loss)]
    let denominator = trials.len() as f64;
    trials.iter().map(|trial| field(trial)).sum::<f64>() / denominator
}

fn quantile_or_zero(sorted: &[f64], probability: f64) -> f64 {
    if sorted.is_empty() {
        0.0
    } else {
        quantile(sorted, probability)
    }
}

fn quantile(sorted: &[f64], probability: f64) -> f64 {
    if sorted.len() == 1 {
        return sorted[0];
    }
    #[allow(clippy::cast_precision_loss)]
    let position = probability * (sorted.len() - 1) as f64;
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let lower = position.floor() as usize;
    let upper = (lower + 1).min(sorted.len() - 1);
    let fraction = position - position.floor();
    sorted[lower] + (sorted[upper] - sorted[lower]) * fraction
}

fn ratio(numerator: f64, denominator: f64) -> f64 {
    if denominator == 0.0 {
        0.0
    } else {
        numerator / denominator
    }
}

fn sigmoid(value: f64) -> f64 {
    if value >= 0.0 {
        1.0 / (1.0 + (-value).exp())
    } else {
        let exp = value.exp();
        exp / (1.0 + exp)
    }
}

#[cfg(test)]
mod tests {
    use super::{PostgradConfig, PostgradScenario, run_postgrad};

    #[test]
    fn parallelism_does_not_change_economic_results() {
        let base = PostgradConfig {
            root_seed: 0x00c0_ffee,
            scenarios: vec![PostgradScenario::Mixed],
            threads: 1,
            trades_per_trial: 8,
            trials_per_scenario: 10,
        };
        let serial = run_postgrad(base.clone()).unwrap();
        let parallel = run_postgrad(PostgradConfig { threads: 4, ..base }).unwrap();
        assert_eq!(serial.scenarios, parallel.scenarios);
        assert_eq!(
            serde_json::to_value(serial.exit_size_benchmark).unwrap(),
            serde_json::to_value(parallel.exit_size_benchmark).unwrap()
        );
    }
}
