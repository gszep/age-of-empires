"""The generic Briton dock roster in the pinned DAT (#97), with composite art.

No converted content lives here; ids select the owned objects. Civilisation
availability and upgrade effects still come from CivTechTrees and the DAT.
"""
NAVAL_UNITS = {
    "galley": 539, "war-galley": 21, "galleon": 442,
    "hulk": 2626, "war-hulk": 2627,
    "fire-galley": 1103, "fire-ship": 529, "fast-fire-ship": 532,
    "demolition-raft": 1104, "demolition-ship": 527, "heavy-demolition-ship": 528,
    "cannon-galleon": 420, "transport-ship": 545, "trade-cog": 17,
}


def specs():
    result = [{"key": key, "unitId": unit, "category": "unit", "composite": True,
               "animations": {"idle": {"slot": "standing"}, "walk": {"slot": "walking"},
                              "attack": {"slot": "attack"}, "death": {"slot": "dying"}},
               "sounds": ["select", "train"]} for key, unit in NAVAL_UNITS.items()]
    result.append({"key": "fish-trap", "unitId": 199, "category": "building", "composite": True,
                   "animations": {"idle": {"slot": "standing"}, "construction": {"slot": "construction"},
                                  "decay": {"slot": "dead"}}})
    for key, unit in {"galley-arrow": 512, "war-galley-arrow": 372, "galleon-arrow": 373,
                      "naval-fire": 676, "fire-charge": 2629, "naval-cannonball": 374, "hulk-bolt": 2636}.items():
        result.append({"key": key, "unitId": unit, "category": "projectile", "composite": True,
                       "animations": {"idle": {"slot": "standing"}}})
    return result


def graphic_layers(dat, graphic_id, x=0, y=0, seen=()):
    """Flatten file-bearing DAT deltas, preserving their screen offsets/order."""
    if graphic_id < 0 or graphic_id in seen:
        return []
    graphic = dat.graphics[graphic_id]
    if graphic is None:
        return []
    layers = []
    if graphic.file_name not in (None, "", "None", "W", "X", "M") and not (graphic.slp < 0 and graphic.deltas):
        layers.append((graphic_id, x, y))
    for delta in graphic.deltas or []:
        layers.extend(graphic_layers(dat, delta.graphic_id, x + delta.offset_x,
                                     y + delta.offset_y, (*seen, graphic_id)))
    return layers
