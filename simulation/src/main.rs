use std::path::PathBuf;

use clap::{Parser, ValueEnum};
use popcharts_simulation::postgrad_report::{
    PostgradConfig, PostgradScenario, render_postgrad_human, run_postgrad,
};
use popcharts_simulation::report::{SimulationConfig, render_human, run};
use popcharts_simulation::scenario::Scenario;

#[derive(Clone, Copy, Debug, ValueEnum)]
enum OutputFormat {
    Human,
    Json,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum Experiment {
    PregradWithdrawal,
    PostgradLiquidity,
}

#[derive(Debug, Parser)]
#[command(about = "Deterministic simulation of Pop Charts market mechanisms")]
struct Args {
    #[arg(long, default_value_t = Experiment::PregradWithdrawal, value_enum)]
    experiment: Experiment,

    #[arg(long, default_value_t = OutputFormat::Human, value_enum)]
    format: OutputFormat,

    #[arg(long)]
    output: Option<PathBuf>,

    #[arg(long, default_value = "64", value_delimiter = ',')]
    receipts: Vec<usize>,

    #[arg(long, value_enum)]
    scenario: Vec<Scenario>,

    #[arg(long, value_enum)]
    postgrad_scenario: Vec<PostgradScenario>,

    #[arg(long, default_value_t = 12_648_430)]
    seed: u64,

    #[arg(long, default_value_t = 0)]
    threads: usize,

    #[arg(long, default_value_t = 100_000)]
    trials: usize,

    #[arg(long, default_value_t = 128)]
    trades: usize,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    if args.trials == 0 {
        return Err("--trials must be positive".into());
    }
    if args.trades == 0 {
        return Err("--trades must be positive".into());
    }
    let threads = if args.threads == 0 {
        std::thread::available_parallelism()?.get()
    } else {
        args.threads
    };
    let (human, json) = match args.experiment {
        Experiment::PregradWithdrawal => {
            if args.receipts.is_empty() || args.receipts.contains(&0) {
                return Err("--receipts must contain positive counts".into());
            }
            let scenarios = if args.scenario.is_empty() {
                Scenario::ALL.to_vec()
            } else {
                args.scenario
            };
            let report = run(SimulationConfig {
                receipt_counts: args.receipts,
                root_seed: args.seed,
                scenarios,
                threads,
                trials_per_scenario: args.trials,
            })?;
            (
                render_human(&report),
                serde_json::to_string_pretty(&report)?,
            )
        }
        Experiment::PostgradLiquidity => {
            let scenarios = if args.postgrad_scenario.is_empty() {
                PostgradScenario::ALL.to_vec()
            } else {
                args.postgrad_scenario
            };
            let report = run_postgrad(PostgradConfig {
                root_seed: args.seed,
                scenarios,
                threads,
                trades_per_trial: args.trades,
                trials_per_scenario: args.trials,
            })?;
            (
                render_postgrad_human(&report),
                serde_json::to_string_pretty(&report)?,
            )
        }
    };
    match args.format {
        OutputFormat::Human => print!("{human}"),
        OutputFormat::Json => println!("{json}"),
    }
    if let Some(path) = args.output {
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, format!("{json}\n"))?;
    }
    Ok(())
}
