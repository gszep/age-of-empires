import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../sim/game';
import { FALLBACK_RULES } from '../sim/data';
import { techTreeModel, techTreeColumns, TechTreeDialog, type TechTreeNode, type TechTreeData } from './techtree';
import type { UiAssets } from './assets';
import { existsSync, readFileSync } from 'node:fs';
import { rulesFromManifest } from '../sim/data';

const node = (values: Partial<TechTreeNode>): TechTreeNode => ({ nodeId: 22, buildingId: 109,
  useType: 'Tech', nodeType: 'Research', nodeStatus: 'ResearchedCompleted', ageId: 1,
  iconId: 6, nameStringId: 17022, helpStringId: 107022, name: 'Loom', help: 'Original help', prerequisites: [], ...values });
const tree = (...nodes: TechTreeNode[]): TechTreeData => ({ civId: 'BRITONS', nodes });
function fixture() {
  const rules = structuredClone(FALLBACK_RULES);
  rules.units.archer.datId = 4; rules.units.villager.datId = 83;
  rules.buildings['archery-range'].datId = 87; rules.buildings.barracks.datId = 12;
  return createGame(138, rules);
}

describe('technology tree model', () => {
  it('resolves shared source localization rather than showing IDs or missing preview text', () => {
    const model = techTreeModel(tree(node({ name: undefined, help: undefined })), fixture(), 1,
      { '17022': 'Translated\\nLoom', '107022': 'Localized help' });
    expect(model.nodes[0].name).toBe('Translated Loom');
    expect(model.nodes[0].help).toBe('Localized help');
  });
  it('groups source upgrade chains/forward targets but preserves explicit new columns and age gates', () => {
    const building = (id: number, extra: Partial<TechTreeNode> = {}) => node({ useType: 'Building', nodeId: id, buildingId: id, ...extra });
    const data = tree(building(109), building(70, { newColumn: false }),
      building(621, { newColumn: false, simId: 109, ageId: 3 }),
      building(598), building(79, { newColumn: false, linkId: 598 }),
      building(234, { newColumn: false, upgradedFromId: 79, ageId: 3 }),
      building(235, { newColumn: false, upgradedFromId: 234, ageId: 4 }),
      building(236, { newColumn: true, upgradedFromId: 235, ageId: 4 }),
      building(84, { newColumn: false, upgradedFromId: 68 }), building(68, { newColumn: false }),
      node({ buildingId: 234 }));
    const groups = techTreeColumns(data.nodes);
    const group = (id: number) => groups.find(c => c.nodes.some(n => n.nodeId === id && n.useType === 'Building'))!;
    expect(group(109).nodes.map(n => n.nodeId)).toEqual([109, 70, 621]);
    expect(group(598).nodes.map(n => n.nodeId)).toEqual([598, 79, 234, 235, 22]);
    expect(group(236)).not.toBe(group(235));
    expect(group(84)).toBe(group(68));
    expect(groups.flatMap(c => c.nodes)).toHaveLength(data.nodes.length);
    const state = fixture(); state.rules.buildings['town-center'].datId = 109;
    const status = (id: number) => techTreeModel(data, state, 1).nodes.find(n => n.nodeId === id)!.status;
    expect(status(109)).toBe('available'); expect(status(621)).toBe('locked');
    state.players[1].age = 2; expect(status(621)).toBe('available');
  });
  it('uses typed sim identities, not English names or Building ID, without mutating state', () => {
    const state = fixture(), before = JSON.stringify(state);
    const model = techTreeModel(tree(node({ name: 'Translated name' }),
      node({ useType: 'Unit', nodeId: 4, buildingId: 87, name: 'Translated Archer' }),
      node({ useType: 'Building', nodeId: 12, buildingId: 12 })), state, 1);
    expect(model.nodes.map(n => [n.simKey, n.status])).toEqual([
      ['loom', 'available'], ['archer', 'locked'], ['barracks', 'available']]);
    expect(JSON.stringify(state)).toBe(before);
  });
  it('does not confuse static ResearchedCompleted with live research, and greys civ-disabled first', () => {
    const state = fixture(); state.players[1].researched.push('loom');
    const data = tree(node({}), node({ nodeStatus: 'NotAvailable' }), node({ nodeId: 999999 }));
    expect(techTreeModel(data, state, 1).nodes.map(n => n.status)).toEqual(['researched', 'disabled', 'unsupported']);
    expect(techTreeModel(data, state, 2).nodes[0].status).toBe('available');
  });
  it('checks age and sim prerequisites rather than trusting native ResearchRequired', () => {
    const state = fixture();
    const data = tree(node({ nodeId: 102, nodeStatus: 'ResearchRequired' }));
    expect(techTreeModel(data, state, 1).nodes[0].status).toBe('locked');
    state.players[1].age = 1; state.players[1].researched.push('feudal-age');
    expect(techTreeModel(data, state, 1).nodes[0].status).toBe('available');
  });
  it('highlights upgrade unit nodes from their trigger tech and handles construction-head aliases', () => {
    const state = fixture();
    state.rules.units.archer.treeUnitId = 24;
    state.rules.technologies.test = { ...state.rules.technologies.loom, techId: 100 };
    state.rules.buildings.barracks.availabilityId = 999;
    const data = tree(node({ useType: 'Unit', nodeId: 24, triggerTechId: 100 }),
      node({ useType: 'Building', nodeId: 999 }));
    state.players[1].researched.push('test');
    expect(techTreeModel(data, state, 1).nodes.map(n => [n.simKey, n.status])).toEqual([
      ['archer', 'researched'], ['barracks', 'available']]);
  });
});

const ownedUi = `${process.env.TECHTREE_UI ?? 'public/imported/aoe2/ui'}/manifest.json`;
const ownedContent = `${process.env.OWNED_PUBLIC ?? 'public'}/imported/aoe2/manifest.json`;
it.skipIf(!existsSync(ownedUi) || !existsSync(ownedContent))('maps the real shipped node sets against loaded sim profiles', () => {
  const ui = JSON.parse(readFileSync(ownedUi, 'utf8')) as UiAssets;
  expect(ui.techTrees).toBeDefined();
  const rules = rulesFromManifest(JSON.parse(readFileSync(ownedContent, 'utf8')));
  const state = createGame(138, rules);
  const coverage: Record<string, { nodes: number; mapped: number; unsupported: string[] }> = {};
  for (const [civ, data] of Object.entries(ui.techTrees!)) {
    state.players[1].civilization = civ;
    const model = techTreeModel(data, state, 1, ui.techTreeStrings);
    expect(model.nodes).toHaveLength(data.nodes.length);
    const loom = model.nodes.find(n => n.useType === 'Tech' && n.nodeId === 22)!;
    expect(loom.simKey).toBe('loom');
    expect(model.nodes.find(n => n.useType === 'Unit' && n.nodeId === 4)?.simKey).toBe('archer');
    expect(model.nodes.find(n => n.useType === 'Building' && n.nodeId === 621)?.simKey).toBe('town-center');
    const groups = techTreeColumns(model.nodes);
    const column = (id: number) => groups.find(c => c.nodes.some(n => n.useType === 'Building' && n.nodeId === id));
    expect(column(621)).toBe(column(109));
    for (const id of [79, 234, 235, 236]) expect(column(id)).toBe(column(598));
    expect(groups.flatMap(c => c.nodes)).toHaveLength(model.nodes.length);
    expect(loom.name).toBe('Loom'); expect(loom.help).toContain('Villagers +15 HP');
    if (civ === 'goths') {
      const barracksHuskarl = () => techTreeModel(data, state, 1).nodes.find(n => n.useType === 'Unit' && n.nodeId === 759)!;
      state.players[1].age = 3;
      expect(barracksHuskarl().simKey).toBe('dat-unit-41');
      expect(barracksHuskarl().status).toBe('locked');
      state.players[1].researched.push('anarchy');
      expect(barracksHuskarl().status).toBe('available');
      state.players[1].age = 0;
    }
    for (const n of model.nodes) {
      if (n.nodeStatus === 'NotAvailable') expect(n.status).toBe('disabled');
      if (!n.simKey && n.nodeStatus !== 'NotAvailable') expect(n.status).toBe('unsupported');
    }
    coverage[civ] = { nodes: model.nodes.length, mapped: model.nodes.filter(n => n.simKey).length,
      unsupported: model.nodes.filter(n => n.status === 'unsupported').map(n => `${n.useType}:${n.nodeId}:${n.name}`) };
    state.players[1].researched.push('loom');
    expect(techTreeModel(data, state, 1).nodes.find(n => n.useType === 'Tech' && n.nodeId === 22)?.status).toBe('researched');
    state.players[1].researched = [];
  }
  console.log('Owned tree mapping:', JSON.stringify(coverage));
});

// Lifecycle contract only; tools/techtree_smoke.mts covers real DOM/rendering.
class ElementStub extends EventTarget {
  open = false; isConnected = true; style = {}; dataset = {}; textContent = ''; innerHTML = '';
  children: ElementStub[] = []; queries = new Map<string, ElementStub>();
  focus = vi.fn(); setAttribute = vi.fn();
  append(...children: ElementStub[]) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
  querySelector(key: string) { if (!this.queries.has(key)) this.queries.set(key, new ElementStub()); return this.queries.get(key)!; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}
afterEach(() => vi.unstubAllGlobals());
it('opens, closes through Back/cancel, restores focus and keeps live node buttons stable', () => {
  const focus = new ElementStub(), root = new ElementStub();
  vi.stubGlobal('document', { activeElement: focus, createElement: () => new ElementStub() });
  const ui = { techTreeLayout: { width: 3840, height: 2160, ageWidth: 256,
    ages: [{ name: 'Dark Age', height: 380 }], title: 'Technology Tree', close: 'Back' } } as UiAssets;
  const dialog = new TechTreeDialog(root as unknown as HTMLElement, ui, () => undefined);
  const state = fixture(), data = tree(node({}));
  dialog.show(techTreeModel(data, state, 1)); expect(dialog.open).toBe(true);
  const tbody = (dialog.element as unknown as ElementStub).querySelector('tbody');
  const row = tbody.children[0];
  state.players[1].researched.push('loom'); dialog.update(techTreeModel(data, state, 1));
  expect(tbody.children[0]).toBe(row);
  expect(row.children[1].children[0].children[0].dataset).toEqual({ node: 'Tech:22', status: 'researched' });
  dialog.element.dispatchEvent(new Event('cancel', { cancelable: true }));
  expect(dialog.open).toBe(false); expect(focus.focus).toHaveBeenCalledOnce();
  dialog.show(techTreeModel(data, state, 1));
  dialog.element.querySelector('[data-techtree-close]')!.dispatchEvent(new Event('click'));
  expect(dialog.open).toBe(false);
});
