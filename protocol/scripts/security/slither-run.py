"""Run Slither over the prepared `.slither/` tree and report project findings.

Driven through Slither's Python API rather than the `slither` CLI: the CLI's
project-structure detection treats the synthetic `.slither/` tree's virtualized
source names (`project/…`) as out-of-project and reports zero contracts, while
the API analyzes them correctly. See scripts/security/slither-prepare.mjs for
why the tree is synthetic (Hardhat 3 build-info shape).

Findings are scoped to `project/contracts/**` excluding `mocks` and `test`, so
dependency noise (Uniswap v4, OpenZeppelin) is filtered out. Writes a JSON
baseline next to this run and prints a by-impact summary plus High/Medium detail.

Usage (from protocol/):
    uv tool run --from slither-analyzer python scripts/security/slither-run.py [target] [--json out.json]
"""

import json
import logging
import sys

logging.disable(logging.WARNING)

from crytic_compile import CryticCompile  # noqa: E402
from slither import Slither  # noqa: E402
from slither.__main__ import get_detectors_and_printers  # noqa: E402

IMPACT_ORDER = {"High": 0, "Medium": 1, "Low": 2, "Informational": 3, "Optimization": 4}


def in_scope(result: dict) -> bool:
    for element in result.get("elements", []):
        mapping = element.get("source_mapping", {}) or {}
        filename = mapping.get("filename_used", "") or mapping.get("filename_relative", "")
        if "project/contracts/" in filename and "/mocks/" not in filename and "/test/" not in filename:
            return True
    return False


def main() -> int:
    args = [a for a in sys.argv[1:]]
    json_out = None
    if "--json" in args:
        i = args.index("--json")
        json_out = args[i + 1]
        del args[i : i + 2]
    target = args[0] if args else ".slither"

    compilation = CryticCompile(target, compile_force_framework="hardhat", ignore_compile=True)
    slither = Slither(compilation)
    detectors, _ = get_detectors_and_printers()
    for detector in detectors:
        slither.register_detector(detector)

    results = [r for group in slither.run_detectors() for r in group]
    scoped = sorted(
        (r for r in results if in_scope(r)),
        key=lambda r: IMPACT_ORDER.get(r.get("impact"), 9),
    )

    counts: dict[str, int] = {}
    for r in scoped:
        counts[r.get("impact")] = counts.get(r.get("impact"), 0) + 1

    print("=== Slither — project/contracts findings by impact ===")
    for impact in ["High", "Medium", "Low", "Informational", "Optimization"]:
        if counts.get(impact):
            print(f"  {impact}: {counts[impact]}")
    print(f"  (in-scope: {len(scoped)}; total incl. dependencies: {len(results)})")

    print("=== High / Medium detail ===")
    for r in scoped:
        if r.get("impact") in ("High", "Medium"):
            first_line = r["description"].strip().splitlines()[0]
            print(f"[{r['impact']}/{r['confidence']}] {r['check']}: {first_line}")

    if json_out:
        with open(json_out, "w", encoding="utf8") as fh:
            json.dump(
                [
                    {
                        "check": r["check"],
                        "impact": r["impact"],
                        "confidence": r["confidence"],
                        "description": r["description"],
                    }
                    for r in scoped
                ],
                fh,
                indent=2,
            )
        print(f"Wrote {len(scoped)} scoped finding(s) to {json_out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
