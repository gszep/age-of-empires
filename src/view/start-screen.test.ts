import { describe, expect, it } from 'vitest';
import { quitToStartAvailable, startMenuEntries, startScreenBoot } from './start-screen';

/** The native ribbon of screensimplemainmenu.xaml, in XAML order
 * (docs/aoe2de-menu-evidence.md §3), followed by the labelled lab entries. */
const NATIVE_ORDER: [string, string][] = [
  ['single-player', 'Single Player'], ['learn-to-play', 'Learn to Play'],
  ['co-op', 'Co-Op Campaigns'], ['multiplayer', 'Multiplayer'], ['editors', 'Editors'],
  ['mods', 'Mods'], ['more-content', 'More Content'], ['exit', 'Exit'],
];

describe('start screen entries (#349)', () => {
  it('keeps the native main-menu order', () => {
    expect(startMenuEntries().slice(0, NATIVE_ORDER.length).map(entry => [entry.action, entry.label]))
      .toEqual(NATIVE_ORDER);
  });

  it('offers only Single Player among the native entries', () => {
    const enabled = startMenuEntries().filter(entry => !entry.reason);
    expect(enabled.map(entry => entry.action)).toEqual(['single-player', 'return']);
  });

  it('greys every unsupported entry in place with a stated reason', () => {
    for (const entry of startMenuEntries()) {
      if (entry.action === 'single-player' || entry.action === 'return') continue;
      expect(entry.reason, entry.action).toBeTruthy();
    }
  });

  it('cannot fake an Exit in a browser tab', () => {
    const exit = startMenuEntries().find(entry => entry.action === 'exit')!;
    expect(exit.reason).toMatch(/browser tab/);
  });

  it('labels the agent-vs-agent entry as coming next and never wires it', () => {
    const agents = startMenuEntries().find(entry => entry.action === 'agents')!;
    expect(agents.label).toContain('coming next');
    expect(agents.reason).toMatch(/#352/);
    expect(agents.reason).toMatch(/model-provider/);
  });

  it('cites the owned locale ids the labels come from', () => {
    expect(Object.fromEntries(startMenuEntries().filter(e => e.locale).map(e => [e.action, e.locale])))
      .toEqual({
        'single-player': 9202, 'learn-to-play': 9503, 'co-op': 10035, 'multiplayer': 9203,
        editors: 9256, mods: 9543, exit: 9207,
      });
  });
});

describe('start-screen boot decision (#349)', () => {
  it('starts a normal fresh standalone launch on the start screen', () => {
    expect(startScreenBoot(new URLSearchParams(''), false, false))
      .toEqual({ show: true, liveMatch: false });
    expect(startScreenBoot(new URLSearchParams('solo=1'), false, false))
      .toEqual({ show: true, liveMatch: false });
  });

  it('keeps every direct-match launch out of the start screen', () => {
    expect(startScreenBoot(new URLSearchParams('solo=1&menu=0'), false, false).show).toBe(false);
    expect(startScreenBoot(new URLSearchParams('solo=1&map=arabia&seed=349'), false, false).show).toBe(false);
    expect(startScreenBoot(new URLSearchParams('map=arabia'), false, false).show).toBe(false);
    expect(startScreenBoot(new URLSearchParams('seed=349'), false, false).show).toBe(false);
    expect(startScreenBoot(new URLSearchParams('mode=regicide'), false, false).show).toBe(false);
    expect(startScreenBoot(new URLSearchParams(''), true, false).show).toBe(false);
    expect(startScreenBoot(new URLSearchParams(''), false, true).show).toBe(false);
  });

  it('honours ?menu=1 as a deterministic solo-only override', () => {
    expect(startScreenBoot(new URLSearchParams('solo=1&menu=1'), false, false))
      .toEqual({ show: true, liveMatch: false });
    expect(startScreenBoot(new URLSearchParams('solo=1&menu=1'), true, false))
      .toEqual({ show: true, liveMatch: true });
    expect(startScreenBoot(new URLSearchParams('solo=1&menu=1&map=arabia&seed=349'), false, false))
      .toEqual({ show: true, liveMatch: true });
    // Review finding 4: a shared session never gets a solo start screen.
    expect(startScreenBoot(new URLSearchParams('menu=1'), false, true).show).toBe(false);
    expect(startScreenBoot(new URLSearchParams('menu=1'), true, true).show).toBe(false);
  });

  it('marks a real match behind the screen, never the placeholder', () => {
    expect(startScreenBoot(new URLSearchParams(''), false, false).liveMatch).toBe(false);
    expect(startScreenBoot(new URLSearchParams('solo=1&menu=1&map=arabia'), false, false).liveMatch).toBe(true);
    expect(startScreenBoot(new URLSearchParams(''), true, false).liveMatch).toBe(true);
    expect(startScreenBoot(new URLSearchParams('player=2'), false, true).liveMatch).toBe(true);
  });
});

describe('quit-to-start availability (#349)', () => {
  it('is offered to every solo session, pinned launches included', () => {
    expect(quitToStartAvailable(false)).toBe(true);
    expect(quitToStartAvailable(true)).toBe(false);
  });
});
