"""The known-price model of the nightly harness, the expected figures,
and `prepare` (spec/features/nightly-harness.md, Known prices and
Prepared data).

Every price the stand-in publishes is a pure function of the source,
the date and the currency, so every process that asks gets the same
answer and `qa` can check any proposal against `known_table`.

    python3 tools/nightly/prices.py prepare <plan> <out>
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_EVEN, Context, Decimal
from pathlib import Path

FRANKFURTER_START = date(1999, 1, 4)
NBP_START = date(2013, 1, 2)
NBP_WINDOW = timedelta(days=14)
GRAMS_PER_TROY_OUNCE = Decimal("31.1034768")

# Units of each currency per euro. The same set as the seeded currency
# half of the app's symbol table, which a test compares.
REF = {
    code: Decimal(value)
    for code, value in {
        "AUD": "1.62", "BRL": "6.25", "CAD": "1.60", "CHF": "0.94", "CNY": "8.2",
        "CZK": "24.5", "DKK": "7.46", "EUR": "1", "GBP": "0.86", "HKD": "9.1",
        "HUF": "395", "IDR": "18900", "ILS": "3.9", "INR": "99", "ISK": "143",
        "JPY": "172", "KRW": "1620", "MXN": "21.8", "MYR": "4.95", "NOK": "11.7",
        "NZD": "1.95", "PHP": "66", "PLN": "4.25", "RON": "5.05", "SEK": "11.1",
        "SGD": "1.5", "THB": "38", "TRY": "47", "USD": "1.17", "ZAR": "20.5",
    }.items()
}
CURRENCIES = sorted(REF)

SCALE = Decimal("1e-12")
# Wide enough that no figure a vault can hold overflows the context's
# precision when it is rounded to scale 12.
EXACT = Context(prec=80, rounding=ROUND_HALF_EVEN)


def _day(value: "date | str") -> date:
    return value if isinstance(value, date) else date.fromisoformat(value)


def utc_today() -> date:
    return datetime.now(timezone.utc).date()


# ---- Publication days -------------------------------------------------


def _start(source: str) -> date:
    return FRANKFURTER_START if source == "frankfurter" else NBP_START


def last_publication_day(source: str, on: "date | str", today: "date | None" = None) -> "date | None":
    """The last Monday-to-Friday on or before `on`, never after today
    and never before the source's first day."""
    day = min(_day(on), today or utc_today())
    while day >= _start(source):
        if day.weekday() < 5:
            return day
        day -= timedelta(days=1)
    return None


def publication_days(source: str, first: "date | str", last: "date | str", today: "date | None" = None) -> "list[date]":
    day = max(_day(first), _start(source))
    end = min(_day(last), today or utc_today())
    days = []
    while day <= end:
        if day.weekday() < 5:
            days.append(day)
        day += timedelta(days=1)
    return days


# ---- Prices -----------------------------------------------------------


def _significant(value: Decimal, digits: int) -> Decimal:
    if value == 0:
        return value
    return value.quantize(Decimal(1).scaleb(value.adjusted() - digits + 1), ROUND_HALF_EVEN)


def frankfurter_rates(day: "date | str", quote: str) -> "dict[str, Decimal]":
    """What Frankfurter publishes for publication day `day`: for every
    currency but `quote`, how many of it one `quote` buys."""
    if quote not in REF:
        raise ValueError(f"not a known currency: {quote}")
    factor = 1 + Decimal((_day(day).toordinal() % 101) - 50) / 2000
    return {
        code: _significant(REF[code] / REF[quote] * factor, 5)
        for code in CURRENCIES
        if code != quote
    }


def nbp_cena(day: "date | str") -> Decimal:
    """PLN per gram of fine gold on publication day `day`."""
    factor = 1 + Decimal((_day(day).toordinal() % 89) - 44) / 1000
    return (250 * factor).quantize(Decimal("0.01"), ROUND_HALF_EVEN)


def json_number(value: Decimal) -> float:
    """A number with exactly the value's digits: the app reads a body
    through float and str, which returns the same decimal."""
    return float(value)


def _eight_places(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.00000001"), ROUND_HALF_EVEN).normalize(), "f")


def known_table(on: "date | str", quote: str, today: "date | None" = None) -> "dict[str, dict]":
    """What /api/rates must answer for the whole table on `on` in
    `quote`, without `cached`: rate-lookup.md's composition, in its
    pinned order and rounded once."""
    day = _day(on)
    table: "dict[str, dict]" = {}
    if quote not in REF:
        raise ValueError(f"not a known currency: {quote}")

    published = last_publication_day("frankfurter", day, today)
    if day >= FRANKFURTER_START and published is not None:
        for code, rate in frankfurter_rates(published, quote).items():
            table[code] = {
                "rate": _eight_places(Decimal(1) / rate),
                "base": f"1 {code}",
                "asOf": published.isoformat(),
                "source": "frankfurter",
            }

    gold = last_publication_day("nbp", day, today)
    if day >= NBP_START and gold is not None and gold >= day - NBP_WINDOW:
        per_gram = nbp_cena(gold)
        source = "nbp"
        if quote != "PLN":
            per_gram = per_gram * (Decimal(1) / frankfurter_rates(gold, quote)["PLN"])
            source = "nbp+frankfurter"
        for symbol, figure in (("XAU-g", per_gram), ("XAU-ozt", per_gram * GRAMS_PER_TROY_OUNCE)):
            table[symbol] = {
                "rate": _eight_places(figure),
                "base": f"1 {symbol}",
                "asOf": gold.isoformat(),
                "source": source,
            }
    return table


# ---- Expected figures -------------------------------------------------


def _scale12(value: Decimal) -> Decimal:
    return value.quantize(SCALE, context=EXACT)


def _places(value: Decimal, places: int) -> Decimal:
    return value.quantize(Decimal(1).scaleb(-places), context=EXACT)


def _exact(value: Decimal) -> str:
    return format(value.normalize(), "f") if value else "0"


def _display(value: Decimal, places: int) -> str:
    rounded = _places(value, places)
    if not rounded:
        rounded = abs(rounded)
    return format(rounded, "f")


def _figure(value: Decimal, places: int) -> dict:
    return {"exact": _exact(value), "display": _display(value, places)}


def usable_latest(snapshots: "list[tuple[str, Decimal]]") -> "tuple[str, Decimal] | None":
    """The holding's latest quantity: the greatest date, with a date
    carrying two snapshots dropped from the series until it is
    answered, as the app's model does."""
    seen: "dict[str, int]" = {}
    for stamp, _ in snapshots:
        seen[stamp] = seen.get(stamp, 0) + 1
    usable = sorted((s for s in snapshots if seen[s[0]] == 1), key=lambda s: s[0])
    return usable[-1] if usable else None


def figures(main_currency: str, holdings: "dict[str, dict]", snapshots: "dict[str, list]", prices: "dict[str, list]", places: int, mode: str) -> dict:
    """One vault's expected figures under one pricing mode.

    `holdings` maps a name to {"unit", "archived": bool}, `snapshots` a
    name to [(date, Decimal)], `prices` a unit to [(date, Decimal)]. A
    holding's figure is its latest quantity times its price, rounded
    half to even at scale 12. The aggregates are shown whole, as the
    dashboard's hero and gross sides are, and each holding at `places`.
    """
    total = assets = debts = Decimal(0)
    shown: "dict[str, dict]" = {}
    excluded: "dict[str, str]" = {}
    for name, holding in holdings.items():
        if holding["archived"]:
            excluded[name] = "archived"
            continue
        latest = usable_latest(snapshots.get(name, []))
        if latest is None:
            excluded[name] = "no quantity"
            continue
        stamp, quantity = latest
        unit = holding["unit"]
        if unit == main_currency:
            price = Decimal(1)
        else:
            series = sorted(prices.get(unit, []), key=lambda p: p[0])
            if mode == "asRecorded":
                series = [p for p in series if p[0] <= stamp]
            if not series:
                excluded[name] = "no price"
                continue
            price = series[-1][1]
        value = _scale12(quantity * price)
        shown[name] = _figure(value, places)
        total += value
        if value < 0:
            debts += value
        else:
            assets += value
    return {
        "total": _figure(total, 0),
        "assets": _figure(assets, 0),
        "debts": _figure(debts, 0),
        "holdings": shown,
        "excluded": excluded,
    }


def expected(main_currency: str, holdings: dict, snapshots: dict, prices: dict, places: int) -> dict:
    return {
        mode: figures(main_currency, holdings, snapshots, prices, places, mode)
        for mode in ("latest", "asRecorded")
    }


# ---- Prepare ----------------------------------------------------------

# Where the manifest says each backup file is.
GENERATED = "tools/nightly/fixtures/out"
COMMITTED = "tools/nightly/fixtures"

COVERAGE = [
    "household", "long-history", "many-dimension-values", "rate-edited-long-ago",
    "no-source-unit", "own-unit", "archived-holding", "other-main-currency",
    "damaged-record", "same-date-pair", "older-vault", "empty-vault",
    "aged-session", "expired-invite", "current-backup", "older-backup",
    "harness-admin",
]


class PlanError(Exception):
    pass


def resolve(spec, today: date) -> str:
    """A plan date: absolute, or {"daysAgo": n}."""
    if isinstance(spec, dict):
        return (today - timedelta(days=spec["daysAgo"])).isoformat()
    date.fromisoformat(spec)
    return spec


def month_ends(first: str, today: date) -> "list[str]":
    """Every month end from `first` through the last one before today."""
    day = date.fromisoformat(first)
    ends = []
    while True:
        following = date(day.year + day.month // 12, day.month % 12 + 1, 1)
        end = following - timedelta(days=1)
        if end >= today:
            return ends
        ends.append(end.isoformat())
        day = following


def _expand_steps(account: dict, today: date) -> "list[dict]":
    steps = []
    for step in account.get("steps", []):
        if "monthEnds" not in step:
            steps.append(step)
            continue
        generator = step["monthEnds"]
        for index, stamp in enumerate(month_ends(generator["from"], today)):
            figures_ = {
                name: _decimal_text(Decimal(series["start"]) + Decimal(series["step"]) * index)
                for name, series in generator["series"].items()
            }
            steps.append({"recording": {"date": stamp, "figures": figures_, "prices": generator.get("prices", {})}})
    return steps


def _decimal_text(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.01")), "f")


def build_vault(account: dict, today: date) -> "tuple[dict, dict]":
    """The ordered writes for one vault owner, and its expected figures."""
    main = account["mainCurrency"]
    profile = account.get("profile", {})
    holdings = {}
    ops: "list[dict]" = [{"op": "profile", "patch": profile}] if profile else []
    stamp = account.get("created", today.isoformat())
    for index, holding in enumerate(account.get("holdings", [])):
        holdings[holding["name"]] = {"unit": holding["unit"], "archived": False}
        ops.append({
            "op": "holding", "name": holding["name"], "unit": holding["unit"],
            "dims": holding.get("dims", {}), "note": holding.get("note"),
            "createdAt": f"{stamp}T09:00:{index:02d}Z",
        })

    snapshots: "dict[str, list]" = {name: [] for name in holdings}
    prices: "dict[str, list]" = {}
    proposals_at: "dict[tuple[str, str], dict]" = {}
    archive_dates: "dict[str, str]" = {}
    odd: "list[tuple[str, str, str]]" = []

    def active_units() -> "list[str]":
        return sorted({h["unit"] for h in holdings.values() if not h["archived"]} - {main})

    def has_price(unit: str, on: str) -> bool:
        return any(entry[0] == on for entry in prices.get(unit, []))

    def refresh(on: str, manual: dict) -> "tuple[dict, dict]":
        table = known_table(on, main, today)
        proposals, typed = {}, {}
        for unit in active_units():
            if has_price(unit, on):
                continue
            if unit in table:
                proposals[unit] = table[unit]
                prices.setdefault(unit, []).append((on, Decimal(table[unit]["rate"])))
                proposals_at[(unit, on)] = table[unit]
            elif unit in manual:
                typed[unit] = manual[unit]["manual"]
                prices.setdefault(unit, []).append((on, Decimal(typed[unit])))
        return proposals, typed

    for step in _expand_steps(account, today):
        if "recording" in step:
            recording = step["recording"]
            on = resolve(recording["date"], today)
            for name, value in recording["figures"].items():
                snapshots[name].append((on, Decimal(value)))
            proposals, typed = refresh(on, recording.get("prices", {}))
            ops.append({"op": "recording", "date": on, "figures": recording["figures"], "proposals": proposals, "manual": typed})
        elif "edit" in step:
            edit = step["edit"]
            on = resolve(edit["date"], today)
            proposal = proposals_at.get((edit["unit"], on))
            if proposal is None:
                raise PlanError(f"edit of {edit['unit']} on {on}: no proposed rate there")
            if Decimal(edit["rate"]) == Decimal(proposal["rate"]):
                raise PlanError(f"edit of {edit['unit']} on {on} leaves the known price")
            prices[edit["unit"]] = [(d, Decimal(edit["rate"]) if d == on else r) for d, r in prices[edit["unit"]]]
            ops.append({"op": "editRate", "unit": edit["unit"], "date": on, "rate": edit["rate"]})
        elif "archive" in step:
            archive = step["archive"]
            on = resolve(archive["date"], today)
            name = archive["holding"]
            snapshots[name].append((on, Decimal(0)))
            for unit in active_units():
                if (unit in CURRENCIES or unit.startswith("XAU-")) and not has_price(unit, on):
                    raise PlanError(f"archiving {name} on {on} would look up {unit}")
            holdings[name]["archived"] = True
            archive_dates[name] = on
            ops.append({"op": "archive", "name": name, "date": on})
        elif "damaged" in step or "pair" in step:
            kind = "damaged" if "damaged" in step else "pair"
            plant = step[kind]
            on = resolve(plant["date"], today)
            name = plant["holding"]
            odd.append((kind, name, on))
            if kind == "pair":
                snapshots[name].extend([(on, Decimal(plant["value"])), (on, Decimal(plant["other"]))])
                ops.append({"op": "pair", "name": name, "date": on, "values": [plant["value"], plant["other"]]})
            else:
                ops.append({"op": "damaged", "name": name, "date": on, "value": plant["value"]})
        else:
            raise PlanError(f"unknown step: {sorted(step)}")

    for kind, name, on in odd:
        if archive_dates.get(name) == on:
            raise PlanError(f"the {kind} record of {name} sits on its archive date")
        latest = usable_latest(snapshots[name])
        if latest is None or latest[0] <= on:
            raise PlanError(f"the {kind} record of {name} on {on} is its latest quantity")

    places = 0 if profile.get("moneyPlaces") == "0" else 2
    return {"ops": ops}, expected(main, holdings, snapshots, prices, places)


def check_coverage(plan: dict) -> None:
    covered = set()
    for item in plan.get("accounts", []) + plan.get("invites", []) + plan.get("backups", []):
        covered.update(item.get("covers", []))
    missing = [name for name in COVERAGE if name not in covered]
    if missing:
        raise PlanError(f"the plan covers nothing for: {', '.join(missing)}")


def prepare(plan: dict, today: date, base: Path) -> "tuple[dict, dict]":
    check_coverage(plan)
    accounts, expectations = [], {}
    sessions, credentials = [], []
    for account in plan["accounts"]:
        entry = {key: account[key] for key in ("username", "password", "kind", "mainCurrency", "covers", "about")}
        if account["kind"] == "vault_owner":
            built, figures_ = build_vault(account, today)
            entry["ops"] = built["ops"]
            expectations[account["username"]] = figures_
            if account.get("backup"):
                expectations[f"{GENERATED}/backup-{account['username']}.json"] = figures_
        else:
            entry["ops"] = []
        if "agedSession" in account:
            sessions.append({"username": account["username"], **account["agedSession"]})
        if "kdfMemory" in account:
            credentials.append({"username": account["username"], "kdfMemory": account["kdfMemory"]})
        entry["backup"] = bool(account.get("backup"))
        entry["agedSession"] = "agedSession" in account
        entry["olderVault"] = "kdfMemory" in account
        accounts.append(entry)

    for backup in plan.get("backups", []):
        if "expected" in backup:
            expectations[f"{COMMITTED}/{backup['file']}"] = json.loads((base / backup["expected"]).read_text())

    script = {
        "today": today.isoformat(),
        "coverage": COVERAGE,
        "accounts": accounts,
        "invites": [
            {key: invite[key] for key in ("label", "kind", "covers")}
            for invite in plan.get("invites", [])
        ],
        "backups": plan.get("backups", []),
        "patches": {
            "sessions": sessions,
            "invites": [
                {key: invite[key] for key in ("label", "createdMinutesAgo", "expiresMinutesAgo")}
                for invite in plan.get("invites", [])
            ],
            "credentials": credentials,
        },
    }
    return script, expectations


def main(argv: "list[str]") -> int:
    if len(argv) != 4 or argv[1] != "prepare":
        print("usage: prices.py prepare <plan> <out>", file=sys.stderr)
        return 2
    plan_path, out = Path(argv[2]), Path(argv[3])
    today = utc_today()
    try:
        script, expectations = prepare(json.loads(plan_path.read_text()), today, plan_path.parent)
    except PlanError as error:
        print(f"plan refused: {error}", file=sys.stderr)
        return 1
    out.mkdir(parents=True, exist_ok=True)
    (out / "script.json").write_text(json.dumps(script, indent=1))
    (out / "expected.json").write_text(json.dumps(expectations, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
