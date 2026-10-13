"""Reviewed XS effect-function adapters; unknown functions stay unsupported."""
import re


def file_int_constant(text, name):
    """Resolve a single literal file-scope int, never evaluate arbitrary XS."""
    scope = text[:re.search(r'^void\s', text, re.M).start()]
    values = re.findall(r'^const int ' + re.escape(name) + r' = (\d+);\s*$', scope, re.M)
    if len(values) != 1:
        raise ValueError(f'unresolved/ambiguous XS constant: {name}')
    return int(values[0])


class UnsupportedBimaristanMask(ValueError):
    """Recognized source program whose dynamic target predicate is not modelled."""


def deferred_script_exclusion(civ_key, civ_index, tech_id, tech_civ, effect_id, error, *, commands):
    # #324 coordinator-authorized exclusion, not a generic catch-and-continue.
    if ((civ_key, civ_index, tech_id, tech_civ, effect_id) != ('saracens', 9, 28, 9, 28)
            or not isinstance(error, UnsupportedBimaristanMask)):
        raise error
    actual = [(c.type, c.a, c.b, c.c, c.d) for c in commands]
    if actual != [(1, 33, 0, -1, 7.0)]:
        raise ValueError(f'Saracens Bimaristan tech28/effect28 commands changed: {actual}; '
                         'exclusion requires exactly the reviewed EffectFunction7 invocation')
    return f'deferred-civ exclusion #324: Saracens Bimaristan tech28/effect28: {error}'


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
        if name not in symbols:
            symbols[name] = file_int_constant(text, name)
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
    if statements and statements[0] == 'xsResetTaskAmount();':
        statements[:0] = [f'int {name} = {file_int_constant(text, name)};'
                          for name in ('WarriorPriestWithRelicID', 'CastleID')]
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
    ids = {k: int(v) for k, v in re.findall(r'int (\w+) = (\d+);', '\n'.join(statements))}
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
    if 'xsModifyObjectTasks' in body:
        # Recognize this particular rewrite before authorizing a narrow deferred
        # exclusion. Other script changes must still fail loudly, including for
        # Saracens. Never approximate this complement mask with the old list.
        statements = [line.split('//', 1)[0].strip() for line in body.splitlines()]
        statements = [line for line in statements if line]
        expected = ['int TargetClass = 0;', 'xsResetTaskAmount();']
        expected += [f'xsEffectAmount(cAddAttribute, {name}, cCombatAbility, {amount}, playerId);'
                     for name, amount in [('cMonkClass', 32), ('cMonkWithRelicClass', 32),
                                          ('WarriorPriestWithRelicID', -32)]]
        expected += [f'xsTaskAmount(cTaskAttr{name}, {value});' for name, value in [
            ('WorkValue1', 75), ('WorkValue2', 1), ('WorkRange', 5),
            ('GatheringSoundInt32', 13404), ('DepositSoundInt32', 13404),
            ('OwnerType', 4), ('CombatLevelFlag', 2), ('SearchWaitTime', 109), ('GatherType', 21)]]
        expected += [
            'TargetClass = cFlagClassRemoval * (cFlagClassOffset + cFlagClassBuilding + cFlagClassSiege + cFlagClassShip);',
            'xsTaskAmount(cTaskAttrObjectClass, TargetClass);',
            'xsTaskAmount(cTaskAttrTaskType, cTaskTypeAura);',
            'xsModifyObjectTasks(cMonkClass, playerId, 0);',
            'xsModifyObjectTasks(cMonkWithRelicClass, playerId, 0);',
            'xsModifyObjectTasks(WarriorPriestWithRelicID, playerId, -1);',
            'xsResetTaskAmount();']
        if statements != expected:
            raise ValueError('EffectFunction7 xsModifyObjectTasks program changed beyond reviewed build185872; review semantics')
        # Symbolically identical statements are not proof of identical semantics.
        # Resolve every constant operand, including task-field IDs, and reject
        # missing, nonliteral, duplicate or shadowing file-scope definitions.
        expected_constants = {
            'WarriorPriestWithRelicID': 1831, 'cAddAttribute': 4, 'cCombatAbility': 63,
            'cMonkClass': 918, 'cMonkWithRelicClass': 943,
            'cFlagClassRemoval': -1, 'cFlagClassOffset': 1000,
            'cFlagClassBuilding': 256, 'cFlagClassSiege': 128, 'cFlagClassShip': 64,
            'cTaskAttrWorkValue1': 0, 'cTaskAttrWorkValue2': 1, 'cTaskAttrWorkRange': 2,
            'cTaskAttrGatheringSoundInt32': 18, 'cTaskAttrDepositSoundInt32': 21,
            'cTaskAttrOwnerType': 6, 'cTaskAttrCombatLevelFlag': 5,
            'cTaskAttrSearchWaitTime': 4, 'cTaskAttrGatherType': 25,
            'cTaskAttrObjectClass': 30, 'cTaskAttrTaskType': 28, 'cTaskTypeAura': 155,
        }
        scope = text[:re.search(r'^void\s', text, re.M).start()]
        for name, value in expected_constants.items():
            definitions = re.findall(r'^(?:extern )?const (\w+) ' + re.escape(name)
                                     + r'\s*=\s*([^;\n]+);', constants + '\n' + scope, re.M)
            if [(kind, expression.strip()) for kind, expression in definitions] != [('int', str(value))]:
                raise ValueError(f'EffectFunction7 constant {name} changed: {definitions}; expected int {value}')
        raise UnsupportedBimaristanMask(
            'EffectFunction7 now uses xsModifyObjectTasks with a complement class mask '
            '(excluding Building/Siege/Ship) instead of enumerated aura targets; '
            'dynamic target-mask semantics are not represented by the current healingAura contract')
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


def free_llama(common, hashes):
    """Inca team effect spawns a random llama at the TC annex."""
    from import_content import sha256
    path = common / 'xs/Effects.xs'
    text = path.read_text(encoding='utf-8-sig')
    hashes['xs/Effects.xs'] = sha256(path)
    function = re.search(r'void EffectFunction1\(int playerId = -1\)\s*\{(.*?)\n\}', text, re.S)
    if function is None:
        raise ValueError('missing reviewed EffectFunction1')
    body = function[1]
    # Validate the exact structure: two unit IDs, one random choice, one spawn call.
    statements = [line.strip() for line in body.splitlines() if line.strip()]
    # Newer sources lift the two literal IDs into file-scope constants and
    # rename the local. Resolve only those operands, not arbitrary XS code.
    declaration = re.fullmatch(r'int (\w+) = (\w+);', statements[0]) if statements else None
    if declaration is None:
        raise ValueError('EffectFunction1 llama declaration changed')
    if declaration[1] in ('randomNumber', 'playerId'):
        raise ValueError('EffectFunction1 llama variable aliases control state')
    variable = re.escape(declaration[1])
    def unit_id(token):
        if token.isdecimal():
            return int(token)
        return file_int_constant(text, token)

    expected_shape = [
        r'int ' + variable + r' = (\w+);',
        r'int randomNumber = xsGetRandomNumberLH\(0, 2\);',
        r'if \(randomNumber == 1\)',
        r'\{',
        variable + r' = (\w+);',
        r'\}',
        r'xsEffectAmount\(cSpawnUnit, ' + variable + r', 619, 1, playerId\);',
    ]
    if len(statements) != len(expected_shape):
        raise ValueError(f'EffectFunction1 statement count changed: {len(statements)} vs {len(expected_shape)}')
    for i, (pattern, line) in enumerate(zip(expected_shape, statements)):
        if not re.fullmatch(pattern, line):
            raise ValueError(f'EffectFunction1 statement {i} changed: {line}')
    operands = [re.fullmatch(expected_shape[i], statements[i])[1] for i in (0, 4)]
    if (set(operands) & {declaration[1], 'randomNumber', 'playerId'}
            or declaration[1] in ('cSpawnUnit', 'xsEffectAmount', 'xsGetRandomNumberLH')):
        raise ValueError('EffectFunction1 local binding shadows a referenced global')
    ids = [unit_id(token) for token in operands]
    if ids != [305, 1963]:
        raise ValueError(f'EffectFunction1 llama IDs changed: {ids}')
    constants_path = common / 'xs/Constants.xs'
    constants = constants_path.read_text(encoding='utf-8-sig')
    hashes['xs/Constants.xs'] = sha256(constants_path)
    if re.findall(r'^extern const int cSpawnUnit = (\d+);\s*$', constants, re.M) != ['7']:
        raise ValueError('EffectFunction1 cSpawnUnit changed')
    # The reviewed LH draw chooses each integer in [0, 2) equally. Resolve
    # source IDs to imported keys at the call site, not inside the XS adapter.
    return {'unitIds': [305, 1963], 'buildingId': 619, 'count': 1}
