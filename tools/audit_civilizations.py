#!/usr/bin/env python3
"""Audit every owned civilisation before widening the playable roster.

This is an inventory of data/decoder gaps, not a claim that recognised effect
encodings work in gameplay. Detailed source-derived output stays under .local;
the Markdown report contains coverage counts and implementation conclusions.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
from typing import Any

from genieutils.datfile import DatFile

from depot import depot_root
from import_content import ATTRIBUTE_NAMES, SUPPORTED_PLAYER_ATTRIBUTES, player_attribute_ids, sha256
from naval import specs as naval_specs


def prerequisites(tech: Any) -> dict[str, Any]:
    ids = [int(value) for value in tech.required_techs if value >= 0]
    count = int(tech.required_tech_count)
    return {"ids": ids, "count": count, "choice": 0 < count < len(ids),
            "unsatisfiedSlots": count > len(ids)}


def classify_command(command: Any, units: Any, roster: set[int], resources: dict[int, str]) -> str:
    """Conservative capability classification against today's consumer surface."""
    kind = int(command.type)
    if kind == 1:
        name = resources.get(int(command.a))
        if name not in SUPPORTED_PLAYER_ATTRIBUTES:
            return "unmodelled-player-attribute"
        return "decoded-player-effect" if command.b in (0, 1) else "unmodelled-resource-operation"
    if kind in (0, 4, 5):
        attribute = ATTRIBUTE_NAMES.get(int(command.c))
        if attribute is None:
            return "unmodelled-unit-attribute"
        targets = [int(command.a)] if command.a >= 0 else [
            index for index in roster if units[index] is not None and units[index].class_ == command.b
        ]
        targets = [index for index in targets if index in roster]
        if not targets:
            return "target-outside-roster"
        # Work rate is a gather-task consumer, not yet production/research speed.
        if attribute == "workRate" and any(units[index].type == 80 for index in targets):
            return "unmodelled-building-work-rate"
        return "decoded-unit-effect"
    if kind == 3:
        return "decoded-upgrade" if command.a in roster and command.b in roster else "upgrade-outside-roster"
    if kind == 2:
        return "enable-disable-needs-runtime"
    if kind == 102:
        return "disable-tech-needs-runtime"
    return "unmodelled-command-type"


def audit(dat: Any, common: Path, spec: dict[str, Any]) -> dict[str, Any]:
    definitions_path = common / "dat/civilizations.json"
    definitions = json.loads(definitions_path.read_text())["civilization_list"]
    if len(definitions) != len(dat.civs):
        raise ValueError("civilizations.json / DAT civilisation counts differ; resolve indexing before auditing")
    constants_path = common / "xs/Constants.xs"
    resource_ids = player_attribute_ids(constants_path.read_text(encoding="utf-8-sig"))
    resource_names = {index: name for name, index in resource_ids.items()}
    entries = [*spec["entities"], *(naval_specs() if spec.get("naval") else [])]
    roster = {entry["unitId"] for entry in entries if entry.get("civ") != "gaia"}
    hashes = {"civilizations.json": sha256(definitions_path), "xs/Constants.xs": sha256(constants_path)}
    rows = []
    global_types: Counter = Counter()
    global_attributes: Counter = Counter()
    global_resources: Counter = Counter()
    for index, (definition, civ) in enumerate(zip(definitions, dat.civs, strict=True)):
        if index == 0:
            continue
        # Check positional metadata against unique research. Some alternate-era
        # definitions reuse another civ's IDs; report this rather than silently
        # interpreting their placeholder techs as playable research.
        metadata_warnings = []
        for field in ("unique_tech_id_1", "unique_tech_id_2"):
            tech_id = definition.get(field, -1)
            if tech_id >= 0 and dat.techs[tech_id].civ not in (-1, index):
                metadata_warnings.append(f"{field} {tech_id} belongs to DAT civ {dat.techs[tech_id].civ}, not {index}")
        tree_path = common / "dat/CivTechTrees" / f"{definition['tech_tree_name']}.json"
        if not tree_path.is_file():
            raise ValueError(f"missing civilisation tree: {tree_path}")
        tree = json.loads(tree_path.read_text())
        if tree["civ_id"] != definition["tech_tree_name"]:
            raise ValueError(f"tree identity mismatch: {tree_path}")
        hashes[f"CivTechTrees/{tree_path.name}"] = sha256(tree_path)
        nodes = tree["civ_techs_buildings"] + tree["civ_techs_units"]
        available = [node for node in nodes if node["Node Status"] != "NotAvailable"]
        offered_ids = {int(node["Node ID"]) for node in available if node["Use Type"] == "Tech"}
        offered_ids.update(int(node["Trigger Tech ID"]) for node in available if node.get("Trigger Tech ID"))
        # These are candidates, not all active in Standard games: impossible
        # prerequisites and scenario/game-mode gates must remain visible.
        own_ids = {i for i, tech in enumerate(dat.techs) if tech.civ == index}
        tech_ids = sorted(offered_ids | own_ids)
        sources = [("tree", civ.tech_tree_id), ("team", civ.team_bonus_id)]
        sources += [(f"tech:{tech_id}", dat.techs[tech_id].effect_id) for tech_id in tech_ids]
        counts: Counter = Counter()
        types: Counter = Counter()
        unit_attributes: Counter = Counter()
        player_attributes: Counter = Counter()
        for role, effect_id in sources:
            if effect_id < 0:
                continue
            for command in dat.effects[effect_id].effect_commands:
                counts[classify_command(command, civ.units, roster, resource_names)] += 1
                types[int(command.type)] += 1
                if command.type in (0, 4, 5):
                    unit_attributes[int(command.c)] += 1
                if command.type in (1, 6):
                    player_attributes[int(command.a)] += 1
        choices = []
        impossible = []
        for tech_id in tech_ids:
            req = prerequisites(dat.techs[tech_id])
            row = {"techId": tech_id, **req}
            if req["choice"]:
                choices.append(row)
            if req["unsatisfiedSlots"]:
                impossible.append(row)
        missing_units = sorted({int(node["Node ID"]) for node in available
                                if node["Use Type"] in ("Unit", "Building")
                                and int(node["Node ID"]) not in roster})
        # Store missing IDs locally for follow-up, not the proprietary source tree.
        rows.append({
            "id": index, "name": definition["internal_name"], "datName": civ.name,
            "metadataWarnings": metadata_warnings,
            "era": definition["era"], "hudStyle": definition["hud_style"],
            "treeEffect": civ.tech_tree_id, "teamEffect": civ.team_bonus_id,
            "offeredResearchCount": len(offered_ids),
            "automaticCivTechIds": sorted(i for i in own_ids
                                         if not any(l.location_id >= 0 for l in dat.techs[i].research_locations)),
            "commandCounts": dict(sorted(types.items())), "coverage": dict(sorted(counts.items())),
            "unitAttributes": dict(sorted(unit_attributes.items())),
            "playerAttributes": {resource_names.get(i, f"resource-{i}"): n for i, n in sorted(player_attributes.items())},
            "choicePrerequisites": choices, "unsatisfiedPrerequisites": impossible,
            "missingUnitOrBuildingIds": missing_units,
            "uniqueUnitIds": [definition.get("unique_unit_id"), definition.get("elite_unique_unit_id")],
        })
        global_types.update(types)
        global_attributes.update(unit_attributes)
        global_resources.update(player_attributes)
    return {"schemaVersion": 1, "sourceHashes": hashes, "civilizations": rows,
            "commandCounts": dict(sorted(global_types.items())),
            "unitAttributeCounts": dict(sorted(global_attributes.items())),
            "playerAttributeCounts": {resource_names.get(i, f"resource-{i}"): n for i, n in sorted(global_resources.items())}}


def markdown(report: dict[str, Any]) -> str:
    rows = report["civilizations"]
    eras = Counter(row["era"] for row in rows)
    lines = ["# Civilisation coverage audit", "",
             "Generated by `tools/audit_civilizations.py` from the pinned owned DAT, XS and civilisation trees.",
             "This measures data/decoder coverage, **not playable civilisation support**. Detailed IDs and source hashes stay in `.local/civilizations-audit.json`.",
             "", f"Audited **{len(rows)} non-Gaia civilisations**: " + ", ".join(f"{n} `{era}`" for era, n in sorted(eras.items())) + ".",
             "", "## Interpretation", "",
             "- The tree and team references are **effect IDs**, not technology IDs.",
             "- The metadata list is paired with DAT slots for this inventory; foreign unique-tech references are reported below and must not become runtime bindings.",
             "- Civilisation-specific automatic technologies are candidates: prerequisites and game-mode gates still determine whether they run.",
             "- Counts include offered research, civ-specific research/automatic candidates, tree effects and team effects. Shared effects appear once per source reference; counts are not unique mechanics.",
             "- Recognised unit/player-effect encodings do not prove runtime consumers, target coverage, timing or ownership are correct.",
             "- Missing units/buildings include age variants and supporting tree nodes, not just distinct playable unit lines.",
             "- Initial resource tables are already imported by #53; resource-effect counts below concern mutations, not those initial values.",
             "", "## Per-civilisation coverage", "",
             "| Civilisation | Era | Automatic candidates | Prerequisite choices | Unsatisfied prerequisite slots | Missing unit/building IDs | Unmodelled command/attribute uses |",
             "|---|---|---:|---:|---:|---:|---:|"]
    for row in rows:
        missing = sum(n for key, n in row["coverage"].items() if key.startswith("unmodelled"))
        lines.append(f"| {row['name']} | {row['era']} | {len(row['automaticCivTechIds'])} | {len(row['choicePrerequisites'])} | {len(row['unsatisfiedPrerequisites'])} | {len(row['missingUnitOrBuildingIds'])} | {missing} |")
    lines += ["", "## Effect command inventory", "", "| Command type | Source-reference occurrences |", "|---|---:|"]
    lines += [f"| {kind} | {count} |" for kind, count in report["commandCounts"].items()]
    lines += ["", "## Unit attributes without a decoder mapping", "",
              "| DAT attribute | Source-reference occurrences |", "|---|---:|"]
    lines += [f"| {kind} | {count} |" for kind, count in report["unitAttributeCounts"].items() if int(kind) not in ATTRIBUTE_NAMES]
    lines += ["", "## Player attributes without supported research consumers", "",
              "| Attribute | Source-reference occurrences |", "|---|---:|"]
    lines += [f"| `{name}` | {count} |" for name, count in report["playerAttributeCounts"].items() if name not in SUPPORTED_PLAYER_ATTRIBUTES]
    lines += ["", "## Metadata requiring explicit resolution", ""]
    lines += [f"- **{row['name']}**: {warning}." for row in rows for warning in row["metadataWarnings"]]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path(".local/civilizations-audit.json"))
    parser.add_argument("--markdown", type=Path)
    args = parser.parse_args()
    common = depot_root() / "depot_813781/resources/_common"
    dat_path = common / "dat/empires2_x2_p1.dat"
    spec_path = Path(__file__).with_name("import-spec.json")
    report = audit(DatFile.parse(dat_path), common, json.loads(spec_path.read_text()))
    report["sourceHashes"].update({"dat": sha256(dat_path), "import-spec.json": sha256(spec_path)})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    if args.markdown:
        args.markdown.write_text(markdown(report))
    print(f"{len(report['civilizations'])} civilisations audited -> {args.out}")


if __name__ == "__main__":
    main()
