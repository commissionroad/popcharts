use rayon::prelude::*;
use serde::Serialize;

use crate::analysis::{FEE_POLICIES, FeePolicy, TrialMetrics, analyze_book};
use crate::pinning::{PinningPoint, pinning_grid};
use crate::rng::mix;
use crate::scenario::{Scenario, generate_book};

#[derive(Clone, Debug, Serialize)]
pub struct SimulationConfig {
    pub receipt_counts: Vec<usize>,
    pub root_seed: u64,
    pub scenarios: Vec<Scenario>,
    pub threads: usize,
    pub trials_per_scenario: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct Report {
    pub config: SimulationConfig,
    pub engine_version: &'static str,
    pub model: ModelSpecification,
    pub performance: PerformanceSummary,
    pub pinning: Vec<PinningPoint>,
    pub scenarios: Vec<ScenarioSummary>,
    pub schema_version: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct ModelSpecification {
    pub coordinate_units_per_b: i64,
    pub opening_path_b_range: [f64; 2],
    pub trade_width_b_range: [f64; 2],
    pub width_fee_is_capped_at_gross_cost: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct PerformanceSummary {
    pub elapsed_seconds: f64,
    pub receipts_per_second: f64,
    pub receipts_total: usize,
    pub trials_per_second: f64,
    pub trials_total: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ScenarioSummary {
    pub fee_policies: Vec<FeeSummary>,
    pub free_escrow_percent_mean: f64,
    pub free_escrow_percent_p50: f64,
    pub free_escrow_percent_p95: f64,
    pub matched_width_percent_mean: f64,
    pub max_remaining_fragments_mean: f64,
    pub max_remaining_fragments_observed: u32,
    pub retractable_receipts_percent_mean: f64,
    pub receipts_per_trial: usize,
    pub scenario: Scenario,
    pub trials: usize,
    pub receipts_with_withdrawable_capital_percent_mean: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct FeeSummary {
    pub basis: crate::analysis::FeeBasis,
    pub fee_as_percent_of_gross_withdrawal: f64,
    pub rate_bps: u16,
    pub retraction_probability_points_per_b_of_fee: Option<f64>,
}

/// Runs every configured scenario in a private deterministic thread pool.
///
/// # Errors
///
/// Returns an error if Rayon cannot construct the requested thread pool.
pub fn run(config: SimulationConfig) -> Result<Report, rayon::ThreadPoolBuildError> {
    let started = std::time::Instant::now();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(config.threads)
        .build()?;
    let mut scenarios = Vec::with_capacity(config.scenarios.len() * config.receipt_counts.len());
    for scenario in &config.scenarios {
        for receipt_count in &config.receipt_counts {
            let trials = pool.install(|| {
                (0..config.trials_per_scenario)
                    .into_par_iter()
                    .map(|trial| {
                        let seed = trial_seed(config.root_seed, *scenario, *receipt_count, trial);
                        analyze_book(&generate_book(*scenario, *receipt_count, seed))
                    })
                    .collect::<Vec<_>>()
            });
            scenarios.push(aggregate(*scenario, *receipt_count, &trials));
        }
    }
    let elapsed_seconds = started.elapsed().as_secs_f64();
    let trials_total =
        config.trials_per_scenario * config.scenarios.len() * config.receipt_counts.len();
    let receipts_total = config.trials_per_scenario
        * config.scenarios.len()
        * config.receipt_counts.iter().sum::<usize>();
    #[allow(clippy::cast_precision_loss)]
    let trials_per_second = trials_total as f64 / elapsed_seconds;
    #[allow(clippy::cast_precision_loss)]
    let receipts_per_second = receipts_total as f64 / elapsed_seconds;
    Ok(Report {
        config,
        engine_version: env!("CARGO_PKG_VERSION"),
        model: ModelSpecification {
            coordinate_units_per_b: crate::model::COORDINATE_SCALE,
            opening_path_b_range: [-2.0, 2.0],
            trade_width_b_range: [0.05, 0.75],
            width_fee_is_capped_at_gross_cost: true,
        },
        performance: PerformanceSummary {
            elapsed_seconds,
            receipts_per_second,
            receipts_total,
            trials_per_second,
            trials_total,
        },
        pinning: pinning_grid(),
        scenarios,
        schema_version: 1,
    })
}

#[must_use]
pub fn render_human(report: &Report) -> String {
    use std::fmt::Write;

    let mut output = String::new();
    writeln!(
        output,
        "Pop Charts withdrawal simulation: {} trials x {} scenarios x {} receipt counts",
        report.config.trials_per_scenario,
        report.config.scenarios.len(),
        report.config.receipt_counts.len()
    )
    .unwrap();
    writeln!(
        output,
        "seed={} threads={} elapsed={:.3}s\n",
        report.config.root_seed, report.config.threads, report.performance.elapsed_seconds
    )
    .unwrap();
    writeln!(
        output,
        "scenario          n   free escrow mean/p50/p95  receipts free   matched width   retractable   fragments mean/max"
    )
    .unwrap();
    for summary in &report.scenarios {
        writeln!(
            output,
            "{:<17} {:>3} {:>6.2}%/{:>5.2}%/{:>5.2}% {:>10.2}% {:>13.2}% {:>11.2}% {:>9.2}/{:<3}",
            summary.scenario.label(),
            summary.receipts_per_trial,
            summary.free_escrow_percent_mean,
            summary.free_escrow_percent_p50,
            summary.free_escrow_percent_p95,
            summary.receipts_with_withdrawable_capital_percent_mean,
            summary.matched_width_percent_mean,
            summary.retractable_receipts_percent_mean,
            summary.max_remaining_fragments_mean,
            summary.max_remaining_fragments_observed,
        )
        .unwrap();
    }

    writeln!(output, "\nfee sensitivity").unwrap();
    for summary in &report.scenarios {
        writeln!(
            output,
            "{} ({} receipts)",
            summary.scenario.label(),
            summary.receipts_per_trial
        )
        .unwrap();
        for fee in &summary.fee_policies {
            let efficiency = fee
                .retraction_probability_points_per_b_of_fee
                .map_or_else(|| "unbounded".to_owned(), |value| format!("{value:.3}"));
            writeln!(
                output,
                "  {:<5} {:>4} bps: fee/gross {:>6.2}%  retractable pp per b of fee {}",
                fee.basis.label(),
                fee.rate_bps,
                fee.fee_as_percent_of_gross_withdrawal,
                efficiency,
            )
            .unwrap();
        }
    }

    writeln!(output, "\npinning grid").unwrap();
    writeln!(
        output,
        "YES band   victim cost   opposing NO cost   opponent/victim"
    )
    .unwrap();
    for point in &report.pinning {
        writeln!(
            output,
            "{:>2.0}%->{:<2.0}% {:>12.6} {:>18.6} {:>16.2}%",
            point.start_probability_percent,
            point.end_probability_percent,
            point.victim_cost,
            point.opponent_cost,
            point.opponent_to_victim_cost_percent,
        )
        .unwrap();
    }
    writeln!(
        output,
        "\nperformance: {:.0} trials/s, {:.0} receipts/s",
        report.performance.trials_per_second, report.performance.receipts_per_second
    )
    .unwrap();
    output
}

fn trial_seed(root_seed: u64, scenario: Scenario, receipt_count: usize, trial: usize) -> u64 {
    let domain = scenario.seed_domain().wrapping_mul(0xd6e8_feb8_6659_fd93);
    let receipt_domain = u64::try_from(receipt_count)
        .expect("receipt count fits in u64")
        .wrapping_mul(0xa076_1d64_78bd_642f);
    let trial = u64::try_from(trial).expect("trial index fits in u64");
    mix(root_seed ^ domain ^ receipt_domain ^ trial.wrapping_mul(0x9e37_79b9_7f4a_7c15))
}

fn aggregate(
    scenario: Scenario,
    receipts_per_trial: usize,
    trials: &[TrialMetrics],
) -> ScenarioSummary {
    let count = trials.len();
    assert!(count > 0);
    #[allow(clippy::cast_precision_loss)]
    let denominator = count as f64;
    let mut free_ratios = trials
        .iter()
        .map(|trial| trial.free_cost_ratio * 100.0)
        .collect::<Vec<_>>();
    free_ratios.sort_unstable_by(f64::total_cmp);

    let total_free_cost: f64 = trials.iter().map(|trial| trial.free_cost).sum();
    let total_retraction_display_move: f64 = trials
        .iter()
        .map(|trial| trial.retraction_display_move)
        .sum();
    let fee_policies = FEE_POLICIES
        .iter()
        .enumerate()
        .map(|(index, policy)| {
            aggregate_fee(
                *policy,
                trials,
                index,
                total_free_cost,
                total_retraction_display_move,
            )
        })
        .collect();

    ScenarioSummary {
        fee_policies,
        free_escrow_percent_mean: mean(trials, |trial| trial.free_cost_ratio) * 100.0,
        free_escrow_percent_p50: quantile(&free_ratios, 0.50),
        free_escrow_percent_p95: quantile(&free_ratios, 0.95),
        matched_width_percent_mean: mean(trials, |trial| trial.matched_width_ratio) * 100.0,
        max_remaining_fragments_mean: trials
            .iter()
            .map(|trial| f64::from(trial.max_remaining_fragments))
            .sum::<f64>()
            / denominator,
        max_remaining_fragments_observed: trials
            .iter()
            .map(|trial| trial.max_remaining_fragments)
            .max()
            .unwrap_or(0),
        retractable_receipts_percent_mean: mean(trials, |trial| trial.retractable_receipt_ratio)
            * 100.0,
        receipts_per_trial,
        scenario,
        trials: count,
        receipts_with_withdrawable_capital_percent_mean: mean(trials, |trial| {
            trial.free_receipt_ratio
        }) * 100.0,
    }
}

fn aggregate_fee(
    policy: FeePolicy,
    trials: &[TrialMetrics],
    index: usize,
    total_free_cost: f64,
    total_retraction_display_move: f64,
) -> FeeSummary {
    let total_fee: f64 = trials.iter().map(|trial| trial.fee_totals[index]).sum();
    let total_retraction_fee: f64 = trials
        .iter()
        .map(|trial| trial.retraction_fee_totals[index])
        .sum();
    FeeSummary {
        basis: policy.basis,
        fee_as_percent_of_gross_withdrawal: ratio(total_fee, total_free_cost) * 100.0,
        rate_bps: policy.rate_bps,
        retraction_probability_points_per_b_of_fee: if total_retraction_fee == 0.0 {
            None
        } else {
            Some(total_retraction_display_move * 100.0 / total_retraction_fee)
        },
    }
}

fn mean(trials: &[TrialMetrics], field: impl Fn(&TrialMetrics) -> f64) -> f64 {
    #[allow(clippy::cast_precision_loss)]
    let count = trials.len() as f64;
    trials.iter().map(field).sum::<f64>() / count
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

#[cfg(test)]
mod tests {
    use super::{SimulationConfig, run};
    use crate::scenario::Scenario;

    #[test]
    fn parallelism_does_not_change_results() {
        let base = SimulationConfig {
            receipt_counts: vec![16, 32],
            root_seed: 0x00c0_ffee,
            scenarios: vec![Scenario::BalancedNoise, Scenario::Mixed],
            threads: 1,
            trials_per_scenario: 500,
        };
        let serial = run(base.clone()).unwrap();
        let parallel = run(SimulationConfig { threads: 4, ..base }).unwrap();
        assert_eq!(serial.scenarios, parallel.scenarios);
        assert_eq!(serial.pinning.len(), parallel.pinning.len());
    }
}
