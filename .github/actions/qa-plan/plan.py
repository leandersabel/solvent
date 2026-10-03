"""Splits tonight's QA walk into shards that run at once (CLAUDE.md,
The loop, Nightly and stable), and prints them for the workflow's
matrix as `shards=<json>`. A feature is a `spec/product/` file, walked
in full when qa-full.txt names it, or always when LAST is empty.
"""
import json
import os
import pathlib

SHARDS = 6

features = {path.stem: len(path.read_text().splitlines()) for path in pathlib.Path("spec/product").glob("*.md")}
if os.environ["LAST"]:
    full = set(pathlib.Path("qa-full.txt").read_text().split())
    unknown = full - features.keys()
    if unknown:
        raise SystemExit(f"Not a feature: {' '.join(sorted(unknown))}")
else:
    full = set(features)

# A feature costs about its file's length to walk in full, and a tenth
# of that for its main path. Each goes to the shard with least so far,
# and there are no more shards than features walked in full.
cost = {name: lines if name in full else lines // 10 for name, lines in features.items()}
shards = [{"full": [], "smoke": [], "cost": 0} for _ in range(min(SHARDS, max(1, len(full))))]
for name in sorted(cost, key=cost.get, reverse=True):
    shard = min(shards, key=lambda shard: shard["cost"])
    shard["full" if name in full else "smoke"].append(name)
    shard["cost"] += cost[name]
matrix = [{"id": i, "full": s["full"], "smoke": s["smoke"]} for i, s in enumerate(shards, 1)]
print("shards=" + json.dumps(matrix))
