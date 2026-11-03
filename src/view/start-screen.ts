/**
 * #349 stage 2: the start screen — a real pre-match destination for the
 * game, separate from the in-game pause menu.
 *
 * Native-informed, not native-matched. The ribbon's order, labels and sizes
 * come from `screensimplemainmenu.xaml` on its 3840×2160 design canvas
 * (docs/aoe2de-menu-evidence.md §3): a left ribbon (x=265, width 970) whose
 * buttons are 754 wide, `ButtonLarge` height 100 with 52 pt text, and one
 * `mainmenu_hr` divider (544×96). Nothing here proves native navigation
 * semantics: the XAML's runtime twin selection, the DLC bar, the purchase
 * banner and the build label are engine-side and unverified (§8), and no
 * main-menu art is imported (§2), so the screen uses the open fallback
 * composition plus the already-imported `ButtonLarge` state materials when
 * the UI import provides them. Unsupported modes stay visible and greyed in
 * place as our own product policy — native runtime visibility is unverified.
 *
 * Lab extensions are labelled as such: the agent-vs-agent entry is present but
 * disabled ("coming next", integration is #352) so no model-provider call can
 * ever be launched from here, and "Return to Match" exists only because our
 * start screen can open over a live match (Quit Current Game, or a `?menu=1`
 * launch over a restored session) — natively the main menu never has a live
 * local match behind it.
 */

import type { UiAssets } from './assets';
import { buttonText } from './native-feedback';

/** The inspected design canvas every XAML dimension below is stated on. */
const REFERENCE_WIDTH = 3840;
const REFERENCE_HEIGHT = 2160;
const px = (n: number): string => `calc(${n}px * var(--ui-scale))`;
const color = (s: string): string => (s.length === 9 ? `#${s.slice(3)}${s.slice(1, 3)}` : s);
const gradient = (stops: { color: string; offset: number }[]): string =>
  `linear-gradient(to top, ${stops.map(s => `${color(s.color)} ${s.offset * 100}%`).join(', ')})`;

export type StartAction =
  | 'single-player' | 'learn-to-play' | 'co-op' | 'multiplayer'
  | 'editors' | 'mods' | 'more-content' | 'exit' | 'agents' | 'return';

export interface StartEntry {
  action: StartAction;
  label: string;
  /** The owned key-value table's locale id, where the native screen names one. */
  locale?: number;
  /** Present = unsupported in this build: greyed in place by our product policy. */
  reason?: string;
  /** A native `mainmenu_hr` divider sits above this entry in the XAML stack. */
  dividerBefore?: boolean;
}

/**
 * The ribbon's fixed order (menu-evidence §3). Disabled twins are our policy,
 * not a native runtime claim; which button the engine swaps for a disabled
 * twin at runtime is unverified (§8).
 */
export function startMenuEntries(): StartEntry[] {
  return [
    { action: 'single-player', label: 'Single Player', locale: 9202 },
    { action: 'learn-to-play', label: 'Learn to Play', locale: 9503,
      reason: 'no tutorials or campaigns are delivered in this build' },
    { action: 'co-op', label: 'Co-Op Campaigns', locale: 10035,
      reason: 'generated co-op campaigns are the north star, not delivered yet' },
    { action: 'multiplayer', label: 'Multiplayer', locale: 9203,
      reason: 'no matchmaking exists; shared host/guest play connects from a shared-host launch, not from this screen' },
    { action: 'editors', label: 'Editors', locale: 9256, dividerBefore: true,
      reason: 'no scenario editor in this build' },
    { action: 'mods', label: 'Mods', locale: 9543, reason: 'no mod support in this build' },
    { action: 'more-content', label: 'More Content', reason: 'no in-game store in this build' },
    { action: 'exit', label: 'Exit', locale: 9207,
      reason: 'the game runs in a browser tab the page cannot close; close the tab itself to exit' },
    { action: 'agents', label: 'Agent vs Agent (Lab) — coming next', dividerBefore: true,
      reason: 'agent-vs-agent battles are not wired yet (#352); disabled so this entry can never launch model-provider calls' },
    { action: 'return', label: 'Return to Match' },
  ];
}

export interface StartBoot { show: boolean; liveMatch: boolean }

/**
 * Whether a launch opens on the start screen (#349 stage 2, review finding 5).
 * A normal fresh standalone launch — no `?map=`/`?seed=`/`?mode=` pin, no
 * `?menu=0` direct-match request, no successfully restored session, no
 * shared connection — starts here, and so does the deterministic QA entry
 * `?solo=1&menu=1`, solo only (review finding 4: a shared session never gets
 * a solo start screen, even with `?menu=1`). Everything else keeps going
 * straight to its match: `?solo=1` only chooses standalone rather than shared
 * play (`src/shared/client.ts`); `?menu=0` explicitly bypasses startup for QA.
 * Explicit boards are pinned by request,
 * restored sessions resume, shared sessions connect. `liveMatch` marks a real
 * match behind the screen — a restored session, a shared match, or a pinned
 * board — never the fresh pre-dealt placeholder.
 */
export function startScreenBoot(params: URLSearchParams, restored: boolean, shared: boolean): StartBoot {
  const pinned = params.get('map') !== null || params.has('seed') || params.has('mode');
  const freshStandalone = !shared && !pinned && params.get('menu') !== '0' && !restored;
  return {
    show: freshStandalone || (params.get('menu') === '1' && !shared),
    liveMatch: restored || shared || pinned,
  };
}

/**
 * Whether the pause menu's Quit Current Game can honestly offer the start
 * screen as a destination (menu-evidence §7A/§C). Every solo session has
 * one — pinned `?map=`/`?seed=` launches included, whose provenance is not a
 * behavioural restriction (review finding 6): quitting preserves the match
 * paused behind the screen and Return brings its exact setup back. Shared
 * play keeps Quit disabled — the match keeps running for the other player.
 */
export function quitToStartAvailable(shared: boolean): boolean {
  return !shared;
}

export interface StartScreenCallbacks {
  /** Single Player: open the match setup surface (never the pause menu). */
  onSinglePlayer(): void;
  /** Return to the live match behind the screen (lab extension). */
  onReturnToMatch(): void;
  onSound(alias: string): void;
}

export class StartScreen {
  readonly element: HTMLElement;
  private returnEntry!: HTMLButtonElement;
  private onResize = (): void => this.applyScale();
  /** Review finding 3: an ordinary overlay div has no native focus trap, so
   * Tab wraps inside the screen instead of leaking to the covered HUD. */
  private trapFocus = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(this.element.querySelectorAll<HTMLElement>('button:not(:disabled):not([hidden])'))
      .filter(button => button.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  };

  constructor(parent: HTMLElement, ui: UiAssets | undefined, private callbacks: StartScreenCallbacks) {
    const root = document.createElement('div');
    this.element = root;
    root.id = 'start-screen';
    root.className = 'hidden';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Start');
    const ribbon = document.createElement('div');
    ribbon.className = 'start-ribbon';
    // The XAML's MainMenuLogo row; no logo art is imported, so the title is
    // the project's own name, not a native asset.
    const title = document.createElement('h1');
    title.className = 'start-title';
    title.textContent = 'Open Empires Lab';
    const stack = document.createElement('nav');
    stack.className = 'start-stack';
    stack.setAttribute('aria-label', 'Main menu');
    for (const entry of startMenuEntries()) {
      if (entry.dividerBefore) {
        const rule = document.createElement('div');
        rule.className = 'start-divider';
        rule.setAttribute('role', 'separator');
        stack.append(rule);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.start = entry.action;
      button.className = 'start-entry';
      button.textContent = entry.label;
      if (entry.action === 'return') {
        button.hidden = true;
        this.returnEntry = button;
        button.title = 'Lab extension: the start screen can open over a live match '
          + '(Quit Current Game, or a ?menu=1 launch over a restored session); this returns to it.';
      } else if (entry.reason) {
        button.disabled = true;
        const policy = `Unavailable in this build (${entry.reason}); `
          + 'greyed in place by our product policy — native runtime visibility is unverified.';
        button.title = policy;
        button.setAttribute('aria-label', `${entry.label}: ${policy}`);
      }
      if (ui?.nativeFeedback) {
        // The imported ButtonLarge states are the only native material this
        // screen has (§2); Single Player and Multiplayer natively use
        // ButtonImageMix art that is not imported — a static approximation.
        button.classList.add('native-button');
        buttonText(button, entry.label);
      }
      button.addEventListener('click', () => {
        if (button.disabled) return;
        this.callbacks.onSound('button_ui');
        if (entry.action === 'single-player') this.callbacks.onSinglePlayer();
        else if (entry.action === 'return') this.callbacks.onReturnToMatch();
      });
      stack.append(button);
    }
    ribbon.append(title, stack);
    root.append(ribbon);
    parent.append(root);
    this.installNativeButtons(ui);
    this.applyScale();
    this.element.addEventListener('keydown', this.trapFocus);
    addEventListener('resize', this.onResize);
  }

  /** The same ButtonLarge variables `placeNativeFeedback` installs on #hud;
   * that helper also styles the yes/no dialog, so the button subset is
   * installed here rather than dragging that coupling in. */
  private installNativeButtons(ui: UiAssets | undefined): void {
    const data = ui?.nativeFeedback;
    if (!data) return;
    this.element.style.setProperty('--native-button-height', px(data.button.height));
    this.element.style.setProperty('--native-button-font', px(data.button.fontSize));
    this.element.style.setProperty('--native-button-border', px(data.button.border));
    this.element.style.setProperty('--native-border-color', data.button.borderColor);
    this.element.style.setProperty('--native-button-gradient', gradient(data.button.gradient));
    for (const state of ['normal', 'hover', 'active', 'disable']) {
      this.element.style.setProperty(`--native-button-${state}`, `url('${ui!.base}${data.images[`button_large_${state}`]}')`);
    }
  }

  /** Uniform scale from the same 3840×2160 reference space the HUD uses. */
  private applyScale(): void {
    const scale = Math.max(0.24, Math.min(innerHeight / REFERENCE_HEIGHT, innerWidth / REFERENCE_WIDTH));
    this.element.style.setProperty('--ui-scale', String(scale));
  }

  open({ liveMatch }: { liveMatch: boolean }): void {
    this.returnEntry.hidden = !liveMatch;
    this.element.classList.remove('hidden');
    (this.element.querySelector<HTMLButtonElement>('[data-start="single-player"]') ?? this.element).focus();
  }

  close(): void {
    this.element.classList.add('hidden');
    if (this.element.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  get shown(): boolean {
    return !this.element.classList.contains('hidden');
  }

  destroy(): void {
    removeEventListener('resize', this.onResize);
    this.element.removeEventListener('keydown', this.trapFocus);
    this.element.remove();
  }
}
