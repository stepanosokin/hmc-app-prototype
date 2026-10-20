"""Replay archived browser timings against the agreed T23 cold-show budget.

This checks recorded evidence; it is not a fresh browser run or a backend profiler.
"""
import argparse
import hashlib
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("docs/evidence/t23/continuation"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    index = json.loads((args.root / "artifact-index.json").read_text(encoding="utf-8"))
    artifacts = {item["path"]: item for item in index["artifacts"]}
    results = []
    for selected in index["selected"]:
        relative = selected["report"]
        raw = (args.root / relative).read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest != artifacts[relative]["sha256"]:
            raise ValueError(f"Evidence hash mismatch: {relative}")
        report = json.loads(raw)
        for number, viewport in enumerate(report["viewports"]):
            cold = viewport["cold_first_show_ms"]
            result = {"browser": selected["label"], "viewport": number,
                      "cold_first_show_ms": cold, "limit_ms": 3000,
                      "pass": cold <= 3000, "source": relative, "sha256": digest}
            results.append(result)
            print(f"{'PASS' if result['pass'] else 'FAIL'} {result['browser']}[{number}] "
                  f"cold={cold:.1f}ms limit=3000ms")
    output = {"scope": "archived timing replay, not a fresh runtime validation",
              "results": results, "pass": bool(results) and all(r["pass"] for r in results)}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    return 0 if output["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
