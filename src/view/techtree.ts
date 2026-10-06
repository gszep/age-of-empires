import type { GameState, PlayerId, BuildingKind, UnitKind } from '../sim/types';
import { rulesForPlayer } from '../sim/civilizations';
import { civHas, trainableUnitsAt } from '../sim/game';
import { technologyRequirementsMet } from '../sim/technologies';
import type { UiAssets } from './assets';
import { buildMenu } from './build-menu';
import { plainHelp } from './names';

export interface TechTreeNode {
  nodeId: number; buildingId: number; ageId: number; simId?: number;
  useType: 'Tech' | 'Unit' | 'Building'; nodeType?: string; nodeStatus: string;
  iconId: number; nameStringId: number; helpStringId: number; name?: string; help?: string;
  newColumn?: boolean; upgradedFromId?: number;
  linkId?: number; linkType?: string; triggerTechId?: number;
  prerequisites: { id: number; type: string }[];
}
export interface TechTreeData { civId: string; nodes: TechTreeNode[] }
export interface TechTreeLayout {
  width: number; height: number; ageWidth: number;
  ages: { name: string; height: number }[]; title: string; close: string;
}
export type TreeStatus = 'disabled' | 'unsupported' | 'researched' | 'available' | 'locked';
export interface TreeNodeModel extends TechTreeNode { name: string; help: string; status: TreeStatus; simKey?: string; category: 'Units' | 'Buildings' | 'Techs' }
export interface TechTreeModel { civilization: string; nodes: TreeNodeModel[] }

/** Read-only tree availability, not a promise that a command is payable or has
 * a producer. Use the same sim gates as the command grid, never native static
 * ResearchedCompleted as a player's research history. IDs are typed namespaces. */
export function techTreeModel(tree: TechTreeData, state: GameState, owner: PlayerId,
  strings: Record<string, string> = {}): TechTreeModel {
  const rules = rulesForPlayer(state, owner), player = state.players[owner];
  const techs = Object.entries(rules.technologies);
  const buildings = Object.entries(rules.buildings), units = Object.entries(rules.units);
  const buildable = new Set([...buildMenu(rules, player.age, 'economic', player.researched),
    ...buildMenu(rules, player.age, 'military', player.researched)]);
  const trainable = new Map(buildings.map(([key, rule]) => [rule.datId,
    new Set(trainableUnitsAt(state, owner, key as BuildingKind))]));
  const ready = (key: string) => {
    const tech = rules.technologies[key];
    return civHas(state, owner, 'technologies', tech.techId)
      && !rules.civilizationBonuses?.nodes[tech.techId]?.disabled
      && (tech.requiredTechCount !== undefined || player.age >= tech.requiresAge)
      && technologyRequirementsMet(state, owner, tech);
  };
  return { civilization: rules.civilization.displayName ?? rules.civilization.name,
    nodes: tree.nodes.map(node => {
      const techNode = node.useType === 'Tech', buildingNode = node.useType === 'Building';
      const entityId = node.simId ?? node.nodeId;
      const entity = buildingNode
        ? buildings.find(([, b]) => (b.availabilityId ?? b.datId) === entityId || b.datId === entityId)
        : units.find(([, u]) => (u.treeUnitId ?? u.datId) === entityId);
      const tech = techs.find(([, t]) => t.techId === (techNode ? node.nodeId : node.triggerTechId))
        ?? (!techNode && entity ? techs.find(([, t]) => t.upgrades?.some(u => u.to === entity[0])) : undefined);
      const simKey = techNode ? tech?.[0] : entity?.[0];
      let status: TreeStatus = 'locked';
      if (node.nodeStatus === 'NotAvailable') status = 'disabled';
      else if (!simKey) status = 'unsupported';
      else if (node.simId !== undefined && (player.age < node.ageId - 1
        || (!buildingNode && !technologyRequirementsMet(state, owner, {
          requiredTechs: node.prerequisites.filter(p => p.type === 'Tech').map(p => p.id),
          requiredTechCount: node.prerequisites.filter(p => p.type === 'Tech').length,
        })))) status = 'locked';
      else if (tech && player.researched.includes(tech[0])) status = 'researched';
      else if (techNode || tech) { if (tech && ready(tech[0])) status = 'available'; }
      else if (buildingNode ? buildable.has(simKey as BuildingKind) : trainable.get(node.buildingId)?.has(simKey as UnitKind)) status = 'available';
      return { ...node, name: plainHelp(strings[node.nameStringId] ?? node.name ?? String(node.nodeId)).replace(/\n/g, ' '),
        help: strings[node.helpStringId] ?? node.help ?? '', simKey, status,
        category: techNode ? 'Techs' : buildingNode ? 'Buildings' : 'Units' };
    }) };
}

/** Native false keeps a building in an existing column. Prefer the source's
 * upgrade/identity/link target; unlinked auxiliaries follow the preceding
 * building. Union rather than recursive links also handles forward targets
 * (Market precedes Mill in the source) without losing either node. */
export function techTreeColumns<T extends TechTreeNode>(nodes: T[]): { id: number; nodes: T[] }[] {
  const buildings = nodes.filter(n => n.useType === 'Building');
  const byId = new Map(buildings.map(n => [n.nodeId, n]));
  const parents = new Map<number, number>();
  const root = (id: number): number => {
    while (parents.has(id)) id = parents.get(id)!;
    return id;
  };
  for (const [i, building] of buildings.entries()) {
    if (building.newColumn !== false) continue;
    const target = [building.upgradedFromId, building.simId, building.linkId, buildings[i - 1]?.nodeId]
      .find(id => id !== undefined && id !== building.nodeId && byId.has(id));
    if (target !== undefined && root(building.nodeId) !== root(target)) parents.set(root(building.nodeId), root(target));
  }
  const columns = new Map<number, T[]>();
  for (const node of nodes) {
    const id = root(node.useType === 'Building' ? node.nodeId : node.buildingId);
    if (!columns.has(id)) columns.set(id, []);
    columns.get(id)!.push(node);
  }
  return [...columns].map(([id, nodes]) => ({ id, nodes }));
}

const labels: Record<TreeStatus, string> = {
  disabled: 'Unavailable to this civilization', unsupported: 'Not supported in this simulation',
  researched: 'Researched', available: 'Available in tree', locked: 'Requirements not met',
};

/** Read-only current-player adaptation of screentechtree.json. */
export class TechTreeDialog {
  readonly element: HTMLDialogElement;
  private previousFocus?: HTMLElement;
  private buttons: HTMLButtonElement[] = [];
  private nodes: TreeNodeModel[] = [];
  private preview: HTMLElement;
  private selected = -1;
  constructor(root: HTMLElement, private ui: UiAssets | undefined,
    private icon: (category: TreeNodeModel['category'], index: number) => string | undefined,
    private sound: () => void = () => {}) {
    const dialog = this.element = document.createElement('dialog');
    dialog.id = 'techtree-dialog'; dialog.setAttribute('aria-labelledby', 'techtree-title');
    dialog.innerHTML = `<header><h2 id="techtree-title"></h2><button data-techtree-close></button></header>
      <p class="techtree-legend">Available in tree ≠ ready to pay/train. Costs, producers and queues still apply. Grey: civilization-disabled; dashed: unsupported; green: researched.</p>
      <div class="techtree-scroll"><table><thead></thead><tbody></tbody></table></div>
      <section class="techtree-preview" aria-label="Node details"></section>`;
    const layout = ui?.techTreeLayout;
    if (layout) dialog.style.aspectRatio = `${layout.width} / ${layout.height}`;
    const close = dialog.querySelector<HTMLButtonElement>('[data-techtree-close]')!;
    close.textContent = layout?.close ?? 'Back';
    close.addEventListener('click', () => { this.sound(); this.close(); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    dialog.addEventListener('keydown', event => event.stopPropagation());
    this.preview = dialog.querySelector('.techtree-preview')!;
    root.append(dialog);
  }
  get open(): boolean { return this.element.open; }
  show(model: TechTreeModel): void {
    if (this.open) { this.update(model); return; }
    this.previousFocus = document.activeElement as HTMLElement;
    this.element.querySelector('h2')!.textContent = `${this.ui?.techTreeLayout?.title ?? 'Technology Tree'} — ${model.civilization}`;
    this.nodes = model.nodes; this.buttons = []; this.selected = -1;
    this.preview.textContent = 'Hover, focus or click a node for its original description.';
    const head = this.element.querySelector('thead')!, body = this.element.querySelector('tbody')!;
    head.replaceChildren(); body.replaceChildren();
    const columns = techTreeColumns(model.nodes);
    const header = document.createElement('tr'); header.append(document.createElement('th'));
    for (const { id } of columns) {
      const th = document.createElement('th');
      th.textContent = model.nodes.find(n => n.useType === 'Building' && n.nodeId === id)?.name ?? `Building ${id}`;
      header.append(th);
    }
    head.append(header);
    for (const [age, row] of (this.ui?.techTreeLayout?.ages ?? []).entries()) {
      const tr = document.createElement('tr'), label = document.createElement('th');
      label.textContent = row.name; label.scope = 'row';
      label.style.minWidth = `${(this.ui!.techTreeLayout!.ageWidth / this.ui!.techTreeLayout!.width) * 100}vw`;
      tr.style.height = `${row.height / this.ui!.techTreeLayout!.height * 65}vh`;
      tr.append(label);
      for (const column of columns) {
        const td = document.createElement('td'), group = document.createElement('div');
        td.dataset.column = String(column.id);
        group.className = 'techtree-group'; td.append(group);
        for (const [i, node] of model.nodes.entries()) {
          if (!column.nodes.includes(node) || node.ageId !== age + 1) continue;
          const button = document.createElement('button'); button.className = 'techtree-node';
          button.dataset.node = `${node.useType}:${node.nodeId}`;
          const image = this.icon(node.category, node.iconId);
          if (image) { const icon = document.createElement('span'); icon.className = 'techtree-icon'; icon.style.backgroundImage = image; button.append(icon); }
          const name = document.createElement('span'); name.className = 'techtree-name'; name.textContent = node.name; button.append(name);
          for (const event of ['mouseenter', 'focus', 'click']) button.addEventListener(event, () => { this.selected = i; this.describe(); });
          this.buttons[i] = button; group.append(button);
        }
        tr.append(td);
      }
      body.append(tr);
    }
    this.update(model); this.element.showModal();
  }
  update(model: TechTreeModel): void {
    this.nodes = model.nodes;
    for (const [i, node] of model.nodes.entries()) {
      const button = this.buttons[i]; if (!button) continue;
      button.dataset.status = node.status;
      button.title = `${node.name} — ${labels[node.status]}\n${plainHelp(node.help)}`;
      button.setAttribute('aria-label', `${node.name}: ${labels[node.status]}`);
    }
    this.describe();
  }
  private describe(): void {
    const node = this.nodes[this.selected]; if (!node) return;
    const previous = this.nodes.find(n => n.nodeId === node.linkId && n.nodeType === node.linkType);
    this.preview.textContent = `${node.name} — ${labels[node.status]}${node.simKey ? ` (${node.simKey})` : ''}\n${plainHelp(node.help).replace(/\s*\(\s*\)/g, '')}${previous ? `\nLinked from: ${previous.name}` : ''}`;
  }
  close(): void {
    this.element.close();
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }
}
