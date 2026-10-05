"""Reviewed XS effect-function adapters; unknown functions stay unsupported."""
import re


def infantry_loot(common, hashes):
    """Chieftains' actual XS tasks, not the conflicting English summary."""
    from import_content import sha256
    path = common / 'xs/Effects.xs'
    text = path.read_text(encoding='utf-8-sig')
    constants = (common / 'xs/Constants.xs').read_text(encoding='utf-8-sig')
    hashes['xs/Effects.xs'] = sha256(path)
    body = re.search(r'void EffectFunction5\(int playerId = -1\)\s*\{(.*?)\n\}', text, re.S)
    if body is None:
        raise ValueError('missing reviewed EffectFunction5')
    for statement in ('xsTaskAmount(cTaskAttrProductivityResource, cAttributeInfantryKillReward);',
                      'xsTaskAmount(cTaskAttrResourceOut, cAttributeGold);'):
        if body[1].count(statement) != 1:
            raise ValueError('EffectFunction5 loot resource changed')
    # Fail closed if this small reviewed script changes. Parse the ordered task
    # amounts; repeated MonkWithRelic tasks describe one target, not two rewards.
    symbols = {k: int(v) for k, v in re.findall(r'(?:extern const int|int) (\w+) = (\d+);', constants + body[1])}
    amount, targets = None, {}
    for line in body[1].splitlines():
        line = line.strip()
        if not line or re.fullmatch(r'int \w+ = \d+;', line) or line == 'xsResetTaskAmount();':
            continue
        m = re.fullmatch(r'xsTaskAmount\(cTaskAttrWorkValue1, ([\d.]+)\);', line)
        if m:
            amount = float(m[1])
            continue
        if line in ('xsTaskAmount(cTaskAttrProductivityResource, cAttributeInfantryKillReward);',
                    'xsTaskAmount(cTaskAttrResourceOut, cAttributeGold);'):
            continue
        m = re.fullmatch(r'xsTask\(cInfantryClass, cTaskTypeLoot, (\w+), playerId\);', line)
        if not m or amount is None:
            raise ValueError(f'EffectFunction5 changed: {line}')
        name = m[1]
        targets[name] = {'classId' if name.endswith('Class') else 'unitId': symbols[name] - (900 if name.endswith('Class') else 0), 'amount': amount}
    if not targets:
        raise ValueError('EffectFunction5 has no loot targets')
    return {'sourceClass': symbols['cInfantryClass'] - 900, 'resource': 'infantryKillReward',
            'targets': list(targets.values())}


def stronghold_aura(common, hashes):
    """EffectFunction8 is the building-source member of the healing family."""
    from import_content import sha256
    path = common / 'xs/Effects.xs'
    constants_path = common / 'xs/Constants.xs'
    text = path.read_text(encoding='utf-8-sig')
    constants = constants_path.read_text(encoding='utf-8-sig')
    hashes['xs/Effects.xs'] = sha256(path)
    hashes['xs/Constants.xs'] = sha256(constants_path)
    function = re.search(r'void EffectFunction8\(int playerId = -1\)\s*\{(.*?)\n\}', text, re.S)
    if function is None:
        raise ValueError('missing reviewed EffectFunction8')
    body = function[1]
    # Validate the whole ordered program before collapsing assignments into
    # maps. A reset/reassignment between tasks changes their meaning even when
    # the final dictionary would contain the same values.
    statements = [line.strip() for line in body.splitlines() if line.strip()]
    number = r'\d+(?:\.\d+)?'
    shape = [r'int WarriorPriestWithRelicID = \d+;', r'int CastleID = \d+;',
             re.escape('xsResetTaskAmount();'),
             re.escape('xsEffectAmount(cAddAttribute, CastleID, cCombatAbility, 32, playerId);')]
    for attr in ['WorkValue1', 'WorkValue2', 'WorkRange', 'GatheringSoundInt32',
                 'DepositSoundInt32', 'OwnerType', 'CombatLevelFlag', 'SearchWaitTime', 'GatherType']:
        shape.append(r'xsTaskAmount\(cTaskAttr' + attr + ', ' + number + r'\);')
    shape.extend(re.escape(line) for line in [
        'xsTask(CastleID, cTaskTypeAura, cInfantryClass, playerId);',
        'xsTask(CastleID, cTaskTypeAura, WarriorPriestWithRelicID, playerId);',
        'xsResetTaskAmount();'])
    if len(statements) != len(shape) or any(not re.fullmatch(pattern, line)
                                           for pattern, line in zip(shape, statements)):
        raise ValueError('EffectFunction8 statement order/count changed')
    ids = {k: int(v) for k, v in re.findall(r'int (\w+) = (\d+);', body)}
    values = {k: float(v) for k, v in re.findall(r'xsTaskAmount\((\w+), ([\d.]+)\);', body)}
    expected = {'cTaskAttrWorkValue2': 1, 'cTaskAttrOwnerType': 4,
                'cTaskAttrCombatLevelFlag': 4, 'cTaskAttrSearchWaitTime': 109,
                'cTaskAttrGatherType': 21}
    if any(values.get(k) != v for k, v in expected.items()):
        raise ValueError('EffectFunction8 healing semantics changed')
    infantry = re.search(r'extern const int cInfantryClass = (\d+);', constants)
    return {'sourceUnitIds': [ids['CastleID']], 'sourceClasses': [], 'excludedSourceIds': [],
            'targetClasses': [int(infantry[1]) - 900],
            'targetUnitIds': [ids['WarriorPriestWithRelicID']],
            'range': values['cTaskAttrWorkRange'],
            'hitPointsPerSecond': values['cTaskAttrWorkValue1'] / 60,
            'helpStringId': int(values['cTaskAttrGatheringSoundInt32'])}


def healing_aura(common, hashes):
    from import_content import sha256
    path = common / 'xs/Effects.xs'
    constants = (common / 'xs/Constants.xs').read_text(encoding='utf-8-sig')
    text = path.read_text(encoding='utf-8-sig')
    hashes['xs/Effects.xs'] = sha256(path)
    function = re.search(r'void EffectFunction7\(int playerId = -1\)\s*\{(.*?)\n\}', text, re.S)
    if function is None:
        raise ValueError('missing reviewed EffectFunction7')
    body = function[1]
    values = {k: float(v) for k, v in re.findall(r'xsTaskAmount\((\w+), ([\d.]+)\);', body)}
    # This adapter implements the healing family, not arbitrary task scripting.
    for key, expected in {'cTaskAttrWorkValue2': 1, 'cTaskAttrOwnerType': 4,
                          'cTaskAttrCombatLevelFlag': 2, 'cTaskAttrSearchWaitTime': 109,
                          'cTaskAttrGatherType': 21}.items():
        if values[key] != expected:
            raise ValueError(f'EffectFunction7 changed {key}; review aura semantics')
    classes = {k: int(v) - 900 for k, v in re.findall(r'extern const int (\w+Class) = (\d+);', constants)}
    tasks = re.findall(r'xsTask\((\w+), cTaskTypeAura, (\w+), playerId\);', body)
    sources = list(dict.fromkeys(source for source, _ in tasks))
    targets = [target for source, target in tasks if source == 'cMonkClass']
    removed = re.findall(r'xsRemoveTask\((\w+), cTaskTypeAura, (\w+), playerId\);', body)
    excluded = list(dict.fromkeys(source for source, _ in removed))
    local_ids = {k: int(v) for k, v in re.findall(r'int (\w+) = (\d+);', body)}
    if sources != ['cMonkClass', 'cMonkWithRelicClass'] or not targets:
        raise ValueError('EffectFunction7 source family changed')
    for source in sources:
        if [t for s, t in tasks if s == source] != targets:
            raise ValueError('EffectFunction7 source tasks diverged')
        if f'xsEffectAmount(cAddAttribute, {source}, cCombatAbility, 32, playerId);' not in body:
            raise ValueError('EffectFunction7 aura activation changed')
    for source in excluded:
        if [t for s, t in removed if s == source] != targets:
            raise ValueError('EffectFunction7 exclusion tasks diverged')
    return {'sourceClasses': [classes[name] for name in sources],
            'targetClasses': [classes[name] for name in targets],
            'excludedSourceIds': [local_ids[name] for name in excluded],
            'range': values['cTaskAttrWorkRange'],
            'hitPointsPerSecond': values['cTaskAttrWorkValue1'] / 60,
            'helpStringId': int(values['cTaskAttrGatheringSoundInt32'])}
