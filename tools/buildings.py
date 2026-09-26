"""Reviewed building lines; DAT owns stats, gates, costs and replacement edges."""


def age_stat_baselines(dat, civ_index, entities, replacements):
    """Normalize sole-age automatic stat changes, retaining journal provenance.

    This is not a second scheduler: choice/count/building/civ-bonus gates belong
    to civilization_bonuses. Only generic stat-only automatic rows qualify.
    """
    ages = {101: 1, 102: 2, 103: 3}
    disabled = {int(c.d) for c in dat.effects[dat.civs[civ_index].tech_tree_id].effect_commands if c.type == 102}
    candidates = []
    for tid, tech in enumerate(dat.techs):
        required = {r for r in tech.required_techs if r >= 0}
        if tid in disabled or tech.civ != -1 or tech.required_tech_count != 1 or len(required) != 1 \
                or not required.issubset(ages) or tech.effect_id < 0 \
                or any(l.location_id >= 0 or l.research_time > 0 for l in tech.research_locations):
            continue
        commands = dat.effects[tech.effect_id].effect_commands
        if commands and all(c.type in (0, 4, 5) and c.c in (0, 1, 8) for c in commands):
            candidates.append((tid, ages[next(iter(required))], commands))
    units = dat.civs[civ_index].units
    for entity in entities.values():
        if entity.get("category") != "building":
            continue
        base = units[entity["id"]]
        variants = replacements(dat, base.id)
        for age, name in enumerate(("feudal", "castle", "imperial"), 1):
            unit = base
            for previous in ("feudal", "castle", "imperial")[:age]:
                if previous in variants and units[variants[previous]] is not None:
                    unit = units[variants[previous]]
            changes = [(tid, [c for c in commands if c.a in (base.id, unit.id)
                             or c.a < 0 and c.b == unit.class_])
                       for tid, since, commands in candidates if since <= age]
            changes = [(tid, commands) for tid, commands in changes if commands]
            if not changes:
                continue
            stats = {"id": unit.id, "hp": unit.hit_points, "lineOfSight": unit.line_of_sight,
                     "armors": [{"class": a.class_, "amount": a.amount} for a in unit.type_50.armours],
                     "includedTechs": [tid for tid, _ in changes]}
            for _, commands in changes:
                for c in commands:
                    amount = c.d
                    field = "hp" if c.c == 0 else "lineOfSight"
                    target = stats
                    if c.c == 8:
                        armor_class = int(amount) >> 8
                        amount = (int(amount) & 255) / (100 if c.type == 5 else 1)
                        target = next((a for a in stats["armors"] if a["class"] == armor_class), None)
                        if target is None:
                            target = {"class": armor_class, "amount": 0}
                            stats["armors"].append(target)
                        field = "amount"
                    target[field] = amount if c.type == 0 else target[field] + amount if c.type == 4 else target[field] * amount
            entity.setdefault("ageStats", {})[name] = stats


def building_specs():
    result = []
    for key, uid in (("stone-wall", 117), ("fortified-wall", 155),
                     ("guard-tower", 234), ("keep", 235),
                     ("stone-gate", 64), ("stone-gate-y", 88),
                     ("fortified-gate", 63), ("fortified-gate-y", 85)):
        animations = {"idle": {"slot": "standing"},
                      "construction": {"slot": "construction"},
                      "decay": {"slot": "dead"}}
        if "wall" not in key:
            animations["death"] = {"slot": "dying"}
        if "gate" in key:
            animations["open"] = {"slot": "gate-open"}
        entry = {"key": key, "unitId": uid, "category": "building", "animations": animations}
        if "gate" in key:
            entry.update(gate=True, composite=True, availabilityId=487,
                         constructionId={64: 487, 88: 490, 63: 488, 85: 491}[uid])
            animations["construction"]["unitId"] = entry["constructionId"]
        result.append(entry)
    return result
