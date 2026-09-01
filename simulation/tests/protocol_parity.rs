use popcharts_simulation::interval::{coverage_union, matched_market_cap, split_segments};
use popcharts_simulation::lmsr::segments_cost;
use popcharts_simulation::model::{Receipt, Segment, Side};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    books: Vec<FixtureBook>,
    coordinate_units_per_b: i64,
    schema_version: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureBook {
    matched_market_cap: i128,
    receipts: Vec<FixtureReceipt>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureReceipt {
    free_cost_in_b: f64,
    free_segments: Vec<Segment>,
    high: i64,
    id: u32,
    low: i64,
    side: Side,
}

#[test]
fn rust_matches_canonical_protocol_fixtures() {
    let fixture: Fixture =
        serde_json::from_str(include_str!("../fixtures/protocol-parity-v1.json")).unwrap();
    assert_eq!(fixture.schema_version, 1);
    assert_eq!(fixture.coordinate_units_per_b, 1_000_000);
    assert_eq!(fixture.books.len(), 64);

    for fixture_book in fixture.books {
        let receipts = fixture_book
            .receipts
            .iter()
            .map(|receipt| Receipt {
                id: receipt.id,
                segments: vec![Segment::new(receipt.low, receipt.high)],
                side: receipt.side,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            matched_market_cap(&receipts),
            fixture_book.matched_market_cap
        );
        let yes_union = coverage_union(&receipts, Side::Yes);
        let no_union = coverage_union(&receipts, Side::No);

        for (receipt, expected) in receipts.iter().zip(&fixture_book.receipts) {
            let opposite = match receipt.side {
                Side::Yes => &no_union,
                Side::No => &yes_union,
            };
            let split = split_segments(&receipt.segments, opposite);
            assert_eq!(split.free, expected.free_segments);
            let free_cost = segments_cost(&split.free, receipt.side);
            assert!(
                (free_cost - expected.free_cost_in_b).abs() < 1e-9,
                "receipt {} free cost {free_cost} != {}",
                receipt.id,
                expected.free_cost_in_b
            );
        }
    }
}
