"""The reviewer's own checks of the nightly harness's prepared data
(spec/features/nightly-harness.md, Prepared data; Acceptance criteria
20, 22, 24, 28, 42, 43 and 44; net-worth-view.md, Acceptance criteria
69), written from the spec alone.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from datetime import date, timedelta
from fractions import Fraction

import pytest

from tests.helpers import REPO_ROOT

TOOLS = REPO_ROOT / "tools" / "nightly"
FIXTURES = TOOLS / "fixtures"
sys.path.insert(0, str(TOOLS))

import prices  # noqa: E402

SPEC = (REPO_ROOT / "spec" / "features" / "nightly-harness.md").read_text()
COVERAGE_TABLE = SPEC.split("| Coverage | What the prepared item must be |", 1)[1].split("\n\n", 1)[0]
SPEC_COVERAGE = re.findall(r"^\| `([a-z-]+)` \|", COVERAGE_TABLE, re.M)

D1, D2, D3 = "2024-01-31", "2024-02-29", "2024-03-28"
MARKUP = re.compile(r"<[a-z/!][^>]*>|javascript:", re.I)


def today() -> date:
    return prices.utc_today()


def plan() -> dict:
    return json.loads((FIXTURES / "plan.json").read_text())


def vault(steps: list, holdings: "list[dict] | None" = None) -> dict:
    return {
        "username": "review.owner", "password": "unused", "kind": "vault_owner", "mainCurrency": "CHF",
        "covers": [], "about": "",
        "holdings": holdings if holdings is not None else [
            {"name": "Cash", "unit": "CHF"}, {"name": "Dollars", "unit": "USD"}, {"name": "Old", "unit": "USD"},
        ],
        "steps": steps,
    }


def recording(on: str, figures: dict, manual: "dict | None" = None) -> dict:
    step = {"recording": {"date": on, "figures": figures}}
    if manual:
        step["recording"]["prices"] = {unit: {"manual": rate} for unit, rate in manual.items()}
    return step


def three_recordings() -> list:
    # "Old" is last recorded at D2, so clearing D2 moves its latest quantity
    # back to D1, at D1's price.
    return [
        recording(D1, {"Cash": "100", "Dollars": "10", "Old": "5"}),
        recording(D2, {"Cash": "200", "Dollars": "20", "Old": "7"}),
        recording(D3, {"Cash": "300", "Dollars": "30"}),
    ]


def off_the_line(a: "tuple[str, str]", b: "tuple[str, str]", c: "tuple[str, str]") -> bool:
    day = lambda s: date.fromisoformat(s).toordinal()  # noqa: E731
    (da, pa), (db, pb), (dc, pc) = [(day(d), Fraction(p)) for d, p in (a, b, c)]
    return pb != pa + (pc - pa) * Fraction(db - da, dc - da)


def usd(on: str) -> str:
    return prices.known_table(on, "CHF")["USD"]["rate"]


# ---- criterion 20 ------------------------------------------------------


def test_the_spec_table_lists_the_new_coverage_names():
    assert {"cleared-date", "deleted-recording", "staggered-starts", "all-archived", "code-like-names",
            "session-ends-mid-action"} <= set(SPEC_COVERAGE)


@pytest.mark.parametrize("name", SPEC_COVERAGE)
def test_prepare_exits_1_naming_any_coverage_name_of_the_spec_the_plan_leaves_out(name, tmp_path):
    left_out = plan()
    for group in ("accounts", "invites", "backups"):
        for item in left_out.get(group, []):
            item["covers"] = [c for c in item["covers"] if c != name]
    path = tmp_path / "plan.json"
    path.write_text(json.dumps(left_out))
    done = subprocess.run(
        [sys.executable, str(TOOLS / "prices.py"), "prepare", str(path), str(tmp_path / "out")],
        capture_output=True, text=True, cwd=FIXTURES,
    )
    assert done.returncode == 1 and name in done.stderr, done.stderr


# ---- criterion 42 ------------------------------------------------------


@pytest.mark.parametrize("kind", ["clear", "deleteRecording"])
def test_a_cleared_or_deleted_date_is_valued_as_the_app_values_the_vault_without_it(kind):
    assert off_the_line((D1, usd(D1)), (D2, usd(D2)), (D3, usd(D3)))
    _, figures = prices.build_vault(vault(three_recordings() + [{kind: {"date": D2}}]), today())
    steps = three_recordings()
    if kind == "clear":
        steps[1]["recording"]["figures"] = {}
    else:
        del steps[1]
    _, without = prices.build_vault(vault(steps), today())
    assert figures == without
    # Old's latest quantity is now D1's, at D1's price as recorded.
    old = Fraction(5) * Fraction(usd(D1))
    assert Fraction(figures["asRecorded"]["holdings"]["Old"]["exact"]) == old


def test_clear_writes_an_op_that_keeps_the_rates_and_delete_recording_writes_its_own():
    ops = {}
    for kind in ("clear", "deleteRecording"):
        built, _ = prices.build_vault(vault(three_recordings() + [{kind: {"date": D2}}]), today())
        after = built["ops"][[op["op"] for op in built["ops"]].index("recording") + 3:]
        assert len(after) == 1 and after[0]["date"] == D2, after
        ops[kind] = after[0]["op"]
    assert ops["clear"] != ops["deleteRecording"]
    assert "recording" not in ops.values() and "editRate" not in ops.values()


# ---- criterion 43 ------------------------------------------------------


def with_spare_archived_on_d2(kind: str) -> list:
    steps = three_recordings()
    steps[0]["recording"]["figures"]["Spare"] = "1"
    return steps + [{"archive": {"holding": "Spare", "date": D2}}, {kind: {"date": D2}}]


ON_THE_LINE = [  # 0.1, 0.2, 0.4 across one day and two: exactly on the line, not in floating point
    recording("2024-01-08", {"Cash": "1", "Flat": "1"}, {"m²": "0.1"}),
    recording("2024-01-09", {"Cash": "1", "Flat": "1"}, {"m²": "0.2"}),
    recording("2024-01-11", {"Cash": "1", "Flat": "1"}, {"m²": "0.4"}),
]
OWN_UNIT = [{"name": "Cash", "unit": "CHF"}, {"name": "Flat", "unit": "m²"}]


@pytest.mark.parametrize("kind", ["clear", "deleteRecording"])
@pytest.mark.parametrize(
    "steps, holdings",
    [
        pytest.param(three_recordings() + [{"KIND": {"date": "2023-12-29"}}], None, id="before-the-first"),
        pytest.param(three_recordings() + [{"KIND": {"date": "2024-04-30"}}], None, id="after-the-last"),
        pytest.param(three_recordings() + [{"KIND": {"date": "2024-02-15"}}], None, id="no-recording"),
        pytest.param(three_recordings() + [{"KIND": {"date": D3}}], None, id="the-last-recording"),
        pytest.param(three_recordings() + [{"KIND": {"date": D1}}], None, id="the-first-recording"),
        pytest.param("archive", None, id="an-archive-date"),
        pytest.param(ON_THE_LINE + [{"KIND": {"date": "2024-01-09"}}], OWN_UNIT, id="prices-on-the-line"),
        pytest.param(
            [recording(d, {"Cash": v}) for d, v in ((D1, "1"), (D2, "2"), (D3, "3"))] + [{"KIND": {"date": D2}}],
            [{"name": "Cash", "unit": "CHF"}], id="no-foreign-price",
        ),
    ],
)
def test_prepare_refuses_a_cleared_or_deleted_date_that_bends_nothing(kind, steps, holdings):
    if steps == "archive":
        steps = with_spare_archived_on_d2(kind)
        holdings = vault([])["holdings"] + [{"name": "Spare", "unit": "CHF"}]
    steps = json.loads(json.dumps(steps).replace('"KIND"', json.dumps(kind)))
    with pytest.raises(prices.PlanError):
        prices.build_vault(vault(steps, holdings), today())


@pytest.mark.parametrize("kind", ["clear", "deleteRecording"])
def test_prepare_accepts_a_date_with_one_price_off_the_line_by_the_least_digit(kind):
    steps = json.loads(json.dumps(ON_THE_LINE))
    steps[1]["recording"]["prices"]["m²"]["manual"] = "0.2000000001"
    prices.build_vault(vault(steps + [{kind: {"date": "2024-01-09"}}], OWN_UNIT), today())


@pytest.mark.parametrize("kind", ["clear", "deleteRecording"])
def test_one_unit_off_the_line_is_enough_though_another_lies_on_it(kind):
    holdings = OWN_UNIT + [{"name": "Dollars", "unit": "USD"}]
    steps = json.loads(json.dumps(ON_THE_LINE))
    for step in steps:
        step["recording"]["figures"]["Dollars"] = "1"
    days = [s["recording"]["date"] for s in steps]
    assert off_the_line(*((d, usd(d)) for d in days))
    prices.build_vault(vault(steps + [{kind: {"date": days[1]}}], holdings), today())


def test_an_archive_after_a_deleted_recording_on_its_date_is_refused():
    steps = three_recordings()
    steps[0]["recording"]["figures"]["Spare"] = "1"
    steps += [{"deleteRecording": {"date": D2}}, {"archive": {"holding": "Spare", "date": D2}}]
    with pytest.raises(prices.PlanError):
        prices.build_vault(vault(steps, vault([])["holdings"] + [{"name": "Spare", "unit": "CHF"}]), today())


# ---- criterion 44 ------------------------------------------------------

ZERO = {"exact": "0", "display": "0"}


@pytest.mark.parametrize(
    "holdings, snapshots",
    [
        pytest.param({}, {}, id="no-holdings"),
        pytest.param({"Gone": {"unit": "CHF", "archived": True}}, {"Gone": [(D1, 5)]}, id="all-archived"),
        pytest.param({"Flat": {"unit": "m²", "archived": False}, "New": {"unit": "CHF", "archived": False}},
                     {"Flat": [(D1, 90)]}, id="unpriced-and-unrecorded"),
    ],
)
def test_with_no_holding_valued_the_total_is_null_and_the_sides_zero(holdings, snapshots):
    from decimal import Decimal

    snapshots = {k: [(d, Decimal(v)) for d, v in s] for k, s in snapshots.items()}
    result = prices.expected("CHF", holdings, snapshots, {}, 2)
    for mode in ("latest", "asRecorded"):
        assert result[mode]["total"] is None, mode
        assert result[mode]["assets"] == ZERO and result[mode]["debts"] == ZERO, mode


def test_a_valued_vault_keeps_a_total_even_when_it_sums_to_zero():
    from decimal import Decimal

    holdings = {"Cash": {"unit": "CHF", "archived": False}, "Loan": {"unit": "CHF", "archived": False}}
    snapshots = {"Cash": [(D1, Decimal(5))], "Loan": [(D1, Decimal(-5))]}
    assert prices.expected("CHF", holdings, snapshots, {}, 2)["latest"]["total"] == ZERO


# ---- the committed plan against the new coverage rows -----------------


@pytest.fixture(scope="module")
def prepared(tmp_path_factory):
    out = tmp_path_factory.mktemp("prepared")
    done = subprocess.run(
        [sys.executable, str(TOOLS / "prices.py"), "prepare", str(FIXTURES / "plan.json"), str(out)],
        capture_output=True, text=True,
    )
    assert done.returncode == 0, done.stderr
    script = json.loads((out / "script.json").read_text())
    return script, json.loads((out / "expected.json").read_text())


def covering(script: dict, name: str) -> "list[dict]":
    found = [a for a in script["accounts"] if name in a["covers"]]
    assert found, name
    return found


def first_snapshots(ops: list) -> "dict[str, str]":
    firsts: "dict[str, str]" = {}
    for op in ops:
        if op["op"] == "recording":
            for name in op["figures"]:
                firsts.setdefault(name, op["date"])
    return firsts


def test_all_archived_is_a_vault_with_holdings_every_one_archived_and_a_null_total(prepared):
    script, expected = prepared
    for account in covering(script, "all-archived"):
        names = {op["name"] for op in account["ops"] if op["op"] == "holding"}
        archived = {op["name"] for op in account["ops"] if op["op"] == "archive"}
        assert names and names == archived
        figures = expected[account["username"]]
        for mode in ("latest", "asRecorded"):
            assert figures[mode]["total"] is None
            assert set(figures[mode]["excluded"]) == names


def test_staggered_starts_holds_two_holdings_whose_first_snapshots_are_years_apart(prepared):
    script, _ = prepared
    account = covering(script, "staggered-starts")[0]
    firsts = sorted(date.fromisoformat(d) for d in first_snapshots(account["ops"]).values())
    assert firsts[-1] - firsts[0] >= timedelta(days=2 * 365), firsts


def test_code_like_names_name_a_holding_a_dimension_and_a_held_dimension_value_like_markup():
    account = next(a for a in plan()["accounts"] if "code-like-names" in a["covers"])
    holding = next(h for h in account["holdings"] if MARKUP.search(h["name"]))
    dimension = next(d for d in account["profile"]["dimensions"] if MARKUP.search(d["label"]))
    value = next(v for v in dimension["values"] if MARKUP.search(v["label"]))
    # For qa to read the value in the legend, a valued holding carries it.
    assert any(h.get("dims", {}).get(dimension["id"]) == value["id"] for h in account["holdings"])
    assert holding


def test_session_ends_mid_action_is_a_vault_owner_used_for_nothing_else():
    accounts = [a for a in plan()["accounts"] if "session-ends-mid-action" in a["covers"]]
    assert len(accounts) == 1
    account = accounts[0]
    assert account["kind"] == "vault_owner" and account["covers"] == ["session-ends-mid-action"]
    assert not {"agedSession", "backup", "kdfMemory"} & set(account)


@pytest.mark.parametrize("name, kind", [("cleared-date", "clear"), ("deleted-recording", "deleteRecording")])
def test_the_cleared_and_deleted_dates_sit_between_recordings_with_a_foreign_price(prepared, name, kind):
    script, _ = prepared
    source = {a["username"]: a for a in plan()["accounts"]}
    account = covering(script, name)[0]
    steps = source[account["username"]]["steps"]
    marked = [prices.resolve(s[kind]["date"], date.fromisoformat(script["today"])) for s in steps if kind in s]
    assert marked
    recorded = sorted({op["date"] for op in account["ops"] if op["op"] == "recording"})
    for on in marked:
        assert recorded[0] < on < recorded[-1]
        at = next(op for op in account["ops"] if op["op"] == "recording" and op["date"] == on)
        assert set(at["proposals"]) | set(at["manual"]), on


# ---- criteria 24, 28, 42 end to end, and net-worth-view 69 ------------

from tests.test_nightly_browser import CHROME, generated, patched  # noqa: E402,F401

needs_browser = pytest.mark.skipif(
    shutil.which("node") is None or not CHROME.exists(), reason="needs Node and a local Chrome"
)


def marked_dates(account: dict, kind: str, on: date) -> "list[str]":
    return [prices.resolve(s[kind]["date"], on) for s in account.get("steps", []) if kind in s]


@pytest.fixture(scope="module")
def shown(generated, patched):
    on = date.fromisoformat(generated.manifest["today"])
    checks = []
    for account in plan()["accounts"]:
        if account["kind"] != "vault_owner":
            continue
        entry = {"username": account["username"], "password": account["password"],
                 "dates": marked_dates(account, "clear", on) + marked_dates(account, "deleteRecording", on)}
        if "code-like-names" in account["covers"]:
            dimension = next(d for d in account["profile"]["dimensions"] if MARKUP.search(d["label"]))
            entry["literal"] = {
                "holding": next(h["name"] for h in account["holdings"] if MARKUP.search(h["name"])),
                "dimension": dimension["label"],
                "value": next(v["label"] for v in dimension["values"] if MARKUP.search(v["label"])),
            }
        checks.append(entry)
    ran = subprocess.run(
        ["node", str(REPO_ROOT / "tests" / "browser" / "review-nightly.mjs")],
        cwd=REPO_ROOT, env=dict(os.environ, SOLVENT_BASE=generated.base, REVIEW_CHECKS=json.dumps(checks)),
        capture_output=True, text=True, timeout=900,
    )
    assert ran.returncode == 0, ran.stdout + ran.stderr
    return json.loads(ran.stdout.strip().splitlines()[-1])


@needs_browser
def test_every_dashboard_shows_the_manifest_figures_and_a_null_total_as_a_dash(generated, shown):
    for username, figures in generated.manifest["expected"].items():
        if username not in shown:
            continue  # a backup file
        for mode in ("latest", "asRecorded"):
            seen = shown[username].get(mode)
            if figures[mode]["total"] is None:
                assert seen is None or seen["total"] in (None, "\u2014"), (username, mode, seen)
                continue
            wanted = {key: figures[mode][key]["display"] for key in ("total", "assets", "debts")}
            assert seen == wanted, (username, mode)
    archived = covering_names(generated.manifest, "all-archived")
    assert all(shown[u]["latest"]["total"] == "\u2014" for u in archived)


def covering_names(manifest: dict, name: str) -> "list[str]":
    return [a["username"] for a in manifest["accounts"] if name in a["covers"]]


@needs_browser
def test_the_cleared_date_keeps_its_rates_and_the_deleted_recording_keeps_nothing(generated, shown):
    on = date.fromisoformat(generated.manifest["today"])
    source = {a["username"]: a for a in plan()["accounts"]}
    for name, kind, wanted_prices in (("cleared-date", "clear", True), ("deleted-recording", "deleteRecording", False)):
        for username in covering_names(generated.manifest, name):
            for stamp in marked_dates(source[username], kind, on):
                held = shown[username]["recordings"][stamp]
                assert held["figures"] == 0 and (held["prices"] > 0) == wanted_prices, (username, stamp, held)


@needs_browser
def test_code_like_names_read_as_literal_text_in_the_list_the_legend_and_the_tooltip(generated, shown):
    (username,) = covering_names(generated.manifest, "code-like-names")
    literal = shown[username]["literal"]
    assert literal == {"row": True, "legend": True, "tooltip": True, "scriptsAdded": 0, "alerted": False}, literal
