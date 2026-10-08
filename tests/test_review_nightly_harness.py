"""The reviewer's own checks of the nightly harness's prepared data
(spec/features/nightly-harness.md, Prepared data; Acceptance criteria
20, 22, 24, 28, 42, 43 and 44; net-worth-view.md, Acceptance criteria
69), of the gold window it takes from the app (Known prices, The
source checks; Acceptance criteria 13 and 40), of the source checks'
exit codes and route-out test (Acceptance criteria 17 and 18), of the
composition its oracle applies (Known prices; rate-lookup.md,
Providers), and of a registration form that never shows (fixtures.mjs;
Acceptance criterion 45), written from the spec alone.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_EVEN, Decimal
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
def test_with_no_holding_valued_the_total_and_the_sides_are_null(holdings, snapshots):
    from decimal import Decimal

    snapshots = {k: [(d, Decimal(v)) for d, v in s] for k, s in snapshots.items()}
    result = prices.expected("CHF", holdings, snapshots, {})
    for mode in ("latest", "asRecorded"):
        assert [result[mode][key] for key in ("total", "assets", "debts")] == [None] * 3, mode


def test_a_valued_vault_keeps_a_total_even_when_it_sums_to_zero():
    from decimal import Decimal

    holdings = {"Cash": {"unit": "CHF", "archived": False}, "Loan": {"unit": "CHF", "archived": False}}
    snapshots = {"Cash": [(D1, Decimal(5))], "Loan": [(D1, Decimal(-5))]}
    assert prices.expected("CHF", holdings, snapshots, {})["latest"]["total"] == ZERO


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
    dashes = {key: "\u2014" for key in ("total", "assets", "debts")}
    no_hero = dict.fromkeys(dashes)  # an empty vault shows its first-holding prompt instead
    for username, figures in generated.manifest["expected"].items():
        if username not in shown:
            continue  # a backup file
        for mode in ("latest", "asRecorded"):
            seen = shown[username].get(mode)
            if figures[mode]["total"] is None:
                assert seen in (None, dashes, no_hero), (username, mode, seen)
                continue
            wanted = {key: figures[mode][key]["display"] for key in ("total", "assets", "debts")}
            assert seen == wanted, (username, mode)
    archived = covering_names(generated.manifest, "all-archived")
    assert archived and all(shown[u]["latest"] == dashes for u in archived)


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


# The gold window comes from the app (The source checks; Known prices;
# Acceptance criteria 13 and 40). The source check runs as the workflow
# runs it, with HTTPS answered in-process by `SOURCES_STAND_IN`, which a
# `sitecustomize` loads before the script, so nothing leaves the runner.

import ast  # noqa: E402

import solvent.rates as rates  # noqa: E402

RATE_LOOKUP = (REPO_ROOT / "spec" / "features" / "rate-lookup.md").read_text()
EXPOSED = RATE_LOOKUP.split("- `solvent.rates` exposes ", 1)[1].split("\n  under those names", 1)[0]
SPEC_CONSTANTS = set(re.findall(r"`([A-Z_]+)`", EXPOSED))

SOURCES_STAND_IN = '''
import http.client
import io
import json
import os
from datetime import date, timedelta

import solvent.rates

if os.environ.get("REVIEW_WINDOW_DAYS"):
    solvent.rates.NBP_WINDOW = timedelta(days=int(os.environ["REVIEW_WINDOW_DAYS"]))


def frankfurter(target):
    on = target.split("/v1/", 1)[1].split("?", 1)[0]
    codes = [s["symbol"] for s in solvent.rates.SEEDED_SYMBOLS if s["kind"] == "currency"]
    return {"amount": 1.0, "base": "CHF", "date": on, "rates": {c: 1.5 for c in codes if c != "CHF"}}


def nbp(target):
    end = date.fromisoformat(target.split("?", 1)[0].rstrip("/").rsplit("/", 1)[1])
    backs = sorted((int(b) for b in os.environ["REVIEW_NBP_BACK"].split(",")), reverse=True)
    return [{"data": (end - timedelta(days=b)).isoformat(), "cena": 250.0} for b in backs]


class _Socket:
    def __init__(self, raw):
        self.raw = raw

    def makefile(self, mode):
        return io.BytesIO(self.raw)

    def close(self):
        pass


def request(self, method, url, body=None, headers=None, **_):
    self.target = url
    with open(os.environ["REVIEW_LOG"], "a") as log:
        log.write(json.dumps([self.host, url]) + "\\n")


def getresponse(self):
    body = json.dumps(frankfurter(self.target) if "frankfurter" in self.host else nbp(self.target)).encode()
    head = f"HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nContent-Length: {len(body)}\\r\\n\\r\\n"
    response = http.client.HTTPResponse(_Socket(head.encode() + body), method="GET")
    response.begin()
    return response


http.client.HTTPSConnection.request = request
http.client.HTTPSConnection.getresponse = getresponse
'''


def check_sources(tmp_path, nbp_back: "list[int]", window_days: "int | None" = None):
    """`sources.py check` against the in-process stand-in: NBP answers
    one entry `b` days before the range's end for each `b`. Returns the
    printed lines by source and the hosts and targets asked."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "sitecustomize.py").write_text(SOURCES_STAND_IN)
    log = tmp_path / "asked.jsonl"
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join([str(tmp_path), str(REPO_ROOT)]),
        "REVIEW_LOG": str(log),
        "REVIEW_NBP_BACK": ",".join(map(str, nbp_back)),
        "REVIEW_WINDOW_DAYS": "" if window_days is None else str(window_days),
    }
    run = subprocess.run(
        [sys.executable, str(TOOLS / "sources.py"), "check"],
        env=env, capture_output=True, text=True, timeout=30,
    )
    lines = dict(line.split(" ", 1) for line in run.stdout.splitlines())
    asked = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
    return lines, asked, run


@pytest.mark.parametrize("window_days", [None, 30], ids=["the app's window", "a changed app window"])
def test_the_source_check_asks_nbp_for_the_apps_window_up_to_d(tmp_path, window_days):
    """The source checks: NBP from `D − NBP_WINDOW` to `D`, the window
    read from `solvent.rates`, so a change to the app's moves it."""
    window = rates.NBP_WINDOW if window_days is None else timedelta(days=window_days)
    lines, asked, run = check_sources(tmp_path, [0], window_days)

    (target,) = [t for host, t in asked if host == "api.nbp.pl"]
    end = datetime.now(timezone.utc).date() - timedelta(days=7)
    assert target == "/api/cenyzlota/{start}/{end}?format=json".format(start=end - window, end=end), run
    assert lines["nbp"].startswith("ok"), run


@pytest.mark.parametrize("window_days", [None, 30], ids=["the app's window", "a changed app window"])
def test_the_nbp_shape_holds_days_from_d_minus_the_apps_window_to_d(tmp_path, window_days):
    """The source checks, Shape: `data` within `[D − NBP_WINDOW, D]`, so
    the window's first day is in it and the day before is a change."""
    days = (rates.NBP_WINDOW if window_days is None else timedelta(days=window_days)).days

    at_edge, _, run = check_sources(tmp_path / "edge", [days, 0], window_days)
    before, _, _ = check_sources(tmp_path / "before", [days + 1, 0], window_days)

    assert at_edge["nbp"].startswith("ok"), run
    assert before["nbp"].startswith("changed")


def test_prices_keeps_a_gold_window_equal_to_the_apps():
    """Criterion 13: `prices.py` keeps its own `NBP_WINDOW`, and it is
    the app's."""
    assert prices.NBP_WINDOW == rates.NBP_WINDOW


def test_the_oracle_offers_gold_only_where_nbp_published_within_its_window(monkeypatch):
    """Known prices: `XAU-g` and `XAU-ozt` where NBP published within
    `NBP_WINDOW`. A Sunday's last publication is the Friday two days
    back, inside the app's window and outside a one-day one."""
    sunday = date(2026, 7, 26)
    assert {"XAU-g", "XAU-ozt"} <= prices.known_table(sunday, "PLN").keys()

    monkeypatch.setattr(prices, "NBP_WINDOW", timedelta(days=1))

    assert not {"XAU-g", "XAU-ozt"} & prices.known_table(sunday, "PLN").keys()


def python_imports(path) -> "dict[str, set[str]]":
    """Each module a Python file imports, with the names it takes from it."""
    found: dict[str, set[str]] = {}
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            for alias in node.names:
                found.setdefault(alias.name, set())
        elif isinstance(node, ast.ImportFrom):
            found.setdefault("." * node.level + (node.module or ""), set()).update(a.name for a in node.names)
    return found


def test_the_spec_names_the_gold_window_among_what_the_source_check_imports():
    assert "NBP_WINDOW" in SPEC_CONSTANTS
    assert {name for name in SPEC_CONSTANTS if not hasattr(rates, name)} == set()


def test_the_source_check_imports_from_the_app_exactly_the_constants_rate_lookup_names():
    """Criterion 40 for `sources.py`: from `solvent.rates`, exactly the
    names rate-lookup.md lists (SSRF and egress hardening), and from
    `solvent` nothing else."""
    imports = python_imports(TOOLS / "sources.py")

    assert imports.get("solvent.rates") == SPEC_CONSTANTS
    assert {m for m in imports if m.split(".")[0] == "solvent"} == {"solvent.rates"}


@pytest.mark.parametrize("path", sorted(TOOLS.glob("*.py")), ids=lambda p: p.name)
def test_every_harness_python_file_imports_the_standard_library_and_only_what_files_lists(path):
    """Criterion 40, blind: beyond the standard library, the sibling
    `prices` for `standin.py`, `mcp.py` and `prices.py`, and
    `solvent.rates` for `sources.py`."""
    allowed = {"prices"} if path.name in {"standin.py", "mcp.py", "prices.py"} else set()
    if path.name == "sources.py":
        allowed = {"solvent.rates"}
    rest = {
        module for module in python_imports(path)
        if module.split(".")[0] not in sys.stdlib_module_names | {"__future__"}
    }

    assert rest <= allowed, rest


# ---- Known prices: the oracle applies rate-lookup.md's composition ----


def spec_proposal(figure: Decimal) -> str:
    """rate-lookup.md, Providers: once, half to even, to 10 significant
    digits but never past the twelfth place, written plain."""
    step = Decimal(1).scaleb(max(figure.adjusted() - 9, -12))
    return format(figure.quantize(step, ROUND_HALF_EVEN).normalize(), "f")


def spec_rate(code: str, quote: str, on: str) -> Decimal:
    """Known prices, Frankfurter: `ref[C] / ref[Q] × f(p)` at 5
    significant digits."""
    p = date.fromisoformat(on)
    figure = prices.REF[code] / prices.REF[quote] * (1 + (Decimal(p.toordinal() % 101) - 50) / 2000)
    return figure.quantize(Decimal(1).scaleb(figure.adjusted() - 4), ROUND_HALF_EVEN)


def spec_cena(on: str) -> Decimal:
    p = date.fromisoformat(on)
    return (250 * (1 + (Decimal(p.toordinal() % 89) - 44) / 1000)).quantize(Decimal("0.01"), ROUND_HALF_EVEN)


@pytest.mark.parametrize("quote", ["EUR", "CHF", "PLN", "JPY", "IDR"])
@pytest.mark.parametrize("on", ["2026-07-29", "2024-02-29", "2013-01-02"])
def test_known_table_rounds_every_proposal_as_rate_lookup_pins_it(quote, on):
    """On a weekday both sources published, every currency is `1 /
    rates[C]` and gold `cena × (1 / rates["PLN"])`, the latter times
    31.1034768, each rounded once."""
    table = prices.known_table(on, quote)

    for code in prices.REF:
        if code != quote:
            assert table[code]["rate"] == spec_proposal(1 / spec_rate(code, quote, on)), code
    grams = spec_cena(on) if quote == "PLN" else spec_cena(on) * (1 / spec_rate("PLN", quote, on))
    assert table["XAU-g"]["rate"] == spec_proposal(grams)
    assert table["XAU-ozt"]["rate"] == spec_proposal(grams * Decimal("31.1034768"))


# ---- criteria 17 and 18 ------------------------------------------------

import io  # noqa: E402
import socket  # noqa: E402
import urllib.error  # noqa: E402

import sources  # noqa: E402

PROBE_TODAY = date(2026, 7, 31)
PROBE_DAY = PROBE_TODAY - timedelta(days=7)
OK_FX = {
    "amount": 1.0, "base": "CHF", "date": PROBE_DAY.isoformat(),
    "rates": {row["symbol"]: 0.9 for row in rates.SEEDED_SYMBOLS if row["kind"] == "currency" and row["symbol"] != "CHF"},
}
OK_NBP = [{"data": (PROBE_DAY - timedelta(days=1)).isoformat(), "cena": 480.3}, {"data": PROBE_DAY.isoformat(), "cena": 481.0}]
CHANGED_FX = {**OK_FX, "base": "EUR"}
CHANGED_NBP: list = []
PYTHON_IMAGE = "python:3.12-slim"


class Answer:
    def __init__(self, body: bytes) -> None:
        self.status, self._body = 200, io.BytesIO(body)

    def read(self, size: int = -1) -> bytes:
        return self._body.read(size)

    def __enter__(self):
        return self

    def __exit__(self, *_exc) -> None:
        return None


class Sources:
    """Answers each source with a body, or with an HTTP status to raise."""

    def __init__(self, fx, nbp) -> None:
        self.fx, self.nbp = fx, nbp

    def open(self, request, timeout=None):
        answer = self.nbp if "api.nbp.pl" in request.full_url else self.fx
        if isinstance(answer, int):
            raise urllib.error.HTTPError(request.full_url, answer, "", {}, io.BytesIO(b""))
        return Answer(json.dumps(answer).encode())


class Route:
    """Stands in for socket.create_connection, recording each attempt."""

    def __init__(self, opens: bool) -> None:
        self.opens, self.attempts = opens, []

    def __call__(self, address, timeout=None, *_args, **_kwargs):
        self.attempts.append((address, timeout))
        if not self.opens:
            raise OSError("Network is unreachable")
        return socket.socket()


def run_sources(monkeypatch, command: str, fx, nbp, route_opens: bool) -> "tuple[int, Route]":
    route = Route(route_opens)
    monkeypatch.setattr(sources, "OPENER", Sources(fx, nbp))
    monkeypatch.setattr(socket, "create_connection", route)
    return sources.main(["sources.py", command], PROBE_TODAY), route


@pytest.mark.parametrize(
    "fx, nbp, code",
    [
        (OK_FX, OK_NBP, 0), (503, OK_NBP, 0), (OK_FX, 429, 0), (503, 503, 0),
        (CHANGED_FX, OK_NBP, 1), (OK_FX, CHANGED_NBP, 1), (404, OK_NBP, 1), (CHANGED_FX, 503, 1),
    ],
)
def test_check_exits_1_exactly_when_a_line_is_changed_whatever_the_route_out(monkeypatch, capsys, fx, nbp, code):
    # check runs on the default bridge, where a route out is expected.
    assert run_sources(monkeypatch, "check", fx, nbp, route_opens=True)[0] == code
    lines = capsys.readouterr().out.splitlines()
    assert [line.split()[0] for line in lines] == ["frankfurter", "nbp"]
    assert any(line.split()[1] == "changed" for line in lines) == (code == 1)


@pytest.mark.parametrize(
    "fx, nbp, code",
    [(OK_FX, OK_NBP, 0), (503, OK_NBP, 1), (OK_FX, 429, 1), (CHANGED_FX, OK_NBP, 1), (OK_FX, CHANGED_NBP, 1)],
)
def test_probe_exits_0_only_when_both_sources_are_ok(monkeypatch, capsys, fx, nbp, code):
    assert run_sources(monkeypatch, "probe", fx, nbp, route_opens=False)[0] == code
    capsys.readouterr()


def test_probe_fails_when_a_connection_to_the_public_address_opens(monkeypatch, capsys):
    code, route = run_sources(monkeypatch, "probe", OK_FX, OK_NBP, route_opens=True)
    assert code == 1
    assert route.attempts == [(("1.1.1.1", 443), 3)]
    capsys.readouterr()


# Imports sources.py with solvent.rates standing in, so the container
# needs nothing of the app to run the probe's own route test.
ROUTE_OUT = """
import sys, types
rates = types.ModuleType("solvent.rates")
for name in ("EGRESS_TIMEOUT_SECONDS", "FX_URL", "MAX_RESPONSE_BYTES", "NBP_URL", "NBP_WINDOW", "USER_AGENT"):
    setattr(rates, name, None)
rates.SEEDED_SYMBOLS = []
sys.modules["solvent"] = types.ModuleType("solvent")
sys.modules["solvent.rates"] = rates
sys.path.insert(0, "/harness")
import sources
print(sources.route_out())
"""


@pytest.fixture
def python_image() -> str:
    if shutil.which("docker") is None:
        pytest.skip("needs Docker")
    if subprocess.run(["docker", "pull", "-q", PYTHON_IMAGE], capture_output=True, timeout=300).returncode:
        pytest.skip(f"cannot pull {PYTHON_IMAGE}")
    return PYTHON_IMAGE


def route_out_on(image: str, network: str) -> str:
    done = subprocess.run(
        ["docker", "run", "--rm", "--network", network, "--read-only", "--cap-drop", "ALL",
         "--security-opt", "no-new-privileges:true", "-v", f"{TOOLS}:/harness:ro", image,
         "python", "-c", ROUTE_OUT],
        capture_output=True, text=True, timeout=60,
    )
    assert done.returncode == 0, done.stderr
    return done.stdout.strip()


def host_has_a_route_out() -> bool:
    try:
        socket.create_connection(("1.1.1.1", 443), timeout=3).close()
    except OSError:
        return False
    return True


def test_the_probe_finds_no_route_out_on_an_internal_network_and_one_on_a_bridge(python_image):
    network = "review-nightly-internal"
    subprocess.run(["docker", "network", "rm", network], capture_output=True)
    subprocess.run(["docker", "network", "create", "--internal", network], check=True, capture_output=True)
    try:
        assert route_out_on(python_image, network) == "False"
    finally:
        subprocess.run(["docker", "network", "rm", network], capture_output=True)
    if host_has_a_route_out():
        assert route_out_on(python_image, "bridge") == "True"


# ---- criterion 45: a registration form that never shows ---------------

from solvent.register import INVALID_INVITE  # noqa: E402
from tests.helpers import serve  # noqa: E402


@needs_browser
def test_a_refused_invite_fails_the_generator_naming_the_address_and_what_the_page_shows(tmp_path):
    out = tmp_path / "out"
    env = dict(os.environ, SECRET_KEY=secrets.token_hex(32), DATABASE_PATH=str(tmp_path / "solvent.db"))
    plan = FIXTURES / "plan.json"
    done = subprocess.run(
        [sys.executable, str(TOOLS / "prices.py"), "prepare", str(plan), str(out)], capture_output=True, text=True
    )
    assert done.returncode == 0, done.stderr
    invite = f"/register?invite={secrets.token_urlsafe(32)}"
    with serve(env, tmp_path / "server.log") as base:
        ran = subprocess.run(
            ["node", str(TOOLS / "fixtures.mjs"), "--base", base, "--invite", invite, "--plan", str(plan), "--out", str(out)],
            cwd=REPO_ROOT, env=env, capture_output=True, text=True, timeout=300,
        )
    said = ran.stdout + ran.stderr
    assert ran.returncode != 0, said
    assert f"{base}/register?invite=" in said, said
    assert INVALID_INVITE in said, said
    assert "Cannot set properties of undefined" not in said, said
    assert not (out / "manifest.json").exists()


# ---- expected figures in whole units ----------------------------------


@pytest.mark.parametrize(
    "values, total, assets, debts",
    [
        pytest.param(["0.40", "0.40", "0.40"], "1", "1", "0", id="parts-of-0.40"),
        pytest.param(["2.5"], "2", "2", "0", id="half-to-even-down"),
        pytest.param(["3.5"], "4", "4", "0", id="half-to-even-up"),
        pytest.param(["1000.40", "-2.5"], "998", "1000", "-2", id="negative-half"),
        pytest.param(["0.1", "-0.5"], "0", "0", "0", id="rounds-to-zero-unsigned"),
    ],
)
def test_display_rounds_each_figure_half_even_to_whole_units(values, total, assets, debts):
    """nightly-harness.md, Expected figures: `display` rounds `exact`
    half-even to whole units, the total from the exact figures."""
    from decimal import Decimal

    names = [f"Cash {i}" for i in range(len(values))]
    holdings = {name: {"unit": "CHF", "archived": False} for name in names}
    snapshots = {name: [(D1, Decimal(value))] for name, value in zip(names, values)}
    latest = prices.expected("CHF", holdings, snapshots, {})["latest"]
    assert [latest[key]["display"] for key in ("total", "assets", "debts")] == [total, assets, debts]
