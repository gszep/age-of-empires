/**
 * #349 stage 2: the match setup surface — the lab dialog's own module.
 *
 * The screen keeps every existing control and id (`#map-setup`, `#map-choice`,
 * `#regicide-mode`, `#population-limit`, `#wonder-victory`, `#map-seed`,
 * `#random-map-seed`, `#civilization-1/2`, `#map-host-note`, `#replay-file`)
 * so all options and behaviours stay preserved, but lays them out after the
 * native `ScreenSinglePlayerCreate.xaml` (docs/aoe2de-menu-evidence.md §4/§7B):
 * a Players panel with one slot per player, separate Game Settings and Map
 * groups, and the bottom action bar Technology Tree | Reset | Randomize |
 * Start Game whose unsupported entries are greyed in place. This remains the
 * labelled Lab surface — not a native match — so it keeps the open dialog
 * skin; the seed field is a lab extension the native screen does not have,
 * and Reset/Randomize stay disabled because their native semantics are
 * unverified (§8.3). All behaviour (submit, replay loading, enabling) stays
 * wired in `src/view/hud.ts`; this module owns the structure and the
 * dialog's open/close mechanics.
 */

export interface SetupBottomEntry {
  id: 'techtree' | 'reset' | 'randomize' | 'start';
  label: string;
  /** The owned key-value table's locale id for the native bottom bar. */
  locale: number;
  /** Present = unsupported in this build: greyed in place by our product policy. */
  reason?: string;
}

/** The native bottom bar, in XAML order (menu-evidence §4). */
export function setupBottomBar(): SetupBottomEntry[] {
  return [
    { id: 'techtree', label: 'Technology Tree', locale: 9799,
      reason: 'the pre-match technology tree view is not built' },
    { id: 'reset', label: 'Reset', locale: 4012,
      reason: 'native ButtonReset semantics are unverified (menu-evidence §8.3)' },
    { id: 'randomize', label: 'Randomize', locale: 13577,
      reason: 'native ButtonRandomize semantics are unverified (menu-evidence §8.3)' },
    { id: 'start', label: 'Start Game', locale: 9710 },
  ];
}

export class SetupScreen {
  readonly element: HTMLDialogElement;
  /** A canceled file picker rides the dialog's close-watcher chain and fires
   * `cancel` at this dialog; that is not the user asking it to close. */
  pickerOpen = false;

  constructor(parent: HTMLElement, private sound: () => void) {
    const dialog = document.createElement('dialog');
    this.element = dialog;
    dialog.id = 'lab-dialog';
    dialog.className = 'dialog';
    dialog.setAttribute('aria-labelledby', 'lab-title');
    dialog.innerHTML = `
      <h2 id="lab-title">Game Setup (Lab)</h2>
      <p class="lab-note">Lab surface: match setup, civilizations and replays. Not a native in-game menu action.</p>
      <form id="map-setup">
        <div class="setup-columns">
          <section class="setup-panel" aria-labelledby="setup-players-title">
            <h3 id="setup-players-title">Players</h3>
            <div class="setup-slots" id="setup-slots"></div>
          </section>
          <section class="setup-panel">
            <h3 data-map-label="gameSettings">Game Settings</h3>
            <label for="regicide-mode" data-map-label="regicideMode">Regicide Mode</label>
            <input id="regicide-mode" name="regicide" type="checkbox">
            <label for="population-limit" data-map-label="populationLimit">Population:</label>
            <select id="population-limit" name="populationLimit"></select>
            <label for="wonder-victory" id="wonder-victory-label">Wonder: 200 Years</label>
            <input id="wonder-victory" name="wonderVictory" type="checkbox">
          </section>
          <section class="setup-panel">
            <h3>Map</h3>
            <label for="map-choice" data-map-label="mapType">Map Type</label>
            <select id="map-choice" name="map"></select>
            <label for="map-seed" data-map-label="mapSeed">Seed</label>
            <div class="seed-row">
              <input id="map-seed" name="seed" type="number" min="1" max="4294967295" step="1" inputmode="numeric" placeholder="Random">
              <button type="button" id="random-map-seed" data-map-label="randomSeed">Random</button>
            </div>
          </section>
        </div>
        <p id="map-host-note" hidden>Ysgramor starts shared matches.</p>
        <div class="setup-actions" role="group" aria-label="Setup actions"></div>
      </form>
      <button data-menu="load-replay">Load replay…</button>
      <input id="replay-file" type="file" accept=".json" style="display:none">
      <button type="button" data-lab-close>Close</button>`;
    const actions = dialog.querySelector<HTMLElement>('.setup-actions')!;
    for (const entry of setupBottomBar()) {
      const button = document.createElement('button');
      if (entry.reason) {
        button.type = 'button';
        button.dataset.unsupported = '';
        button.dataset.setup = entry.id;
        button.disabled = true;
        const policy = `Unavailable in this build (${entry.reason}); `
          + 'greyed in place by our product policy — native runtime behaviour is unverified.';
        button.title = policy;
        button.setAttribute('aria-label', `${entry.label}: ${policy}`);
      } else {
        button.type = 'submit';
        button.dataset.mapLabel = 'startGame';
      }
      button.textContent = entry.label;
      actions.append(button);
    }
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      if (this.pickerOpen) { this.pickerOpen = false; return; }
      this.close();
    });
    // Only swallow game keys while the dialog is actually open: a closed
    // <dialog> is still an ancestor in the DOM (#349).
    dialog.addEventListener('keydown', event => { if (dialog.open) event.stopPropagation(); });
    dialog.querySelector('[data-lab-close]')!.addEventListener('click', () => {
      this.sound();
      this.close();
    });
    parent.append(dialog);
  }

  open(): void {
    if (!this.element.open) this.element.showModal();
    this.element.querySelector<HTMLButtonElement>('[data-lab-close]')!.focus();
  }

  close(): void {
    if (this.element.open) this.element.close();
    if (this.element.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  get shown(): boolean {
    return this.element.open;
  }
}
