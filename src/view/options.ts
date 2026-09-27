import type { UiAssets } from './assets';
import { buttonText, slices } from './native-feedback';
import { DEFAULT_PREFERENCES, HOTKEY_PROFILES, UI_PALETTES, normalizePreferences, type Preferences } from './preferences';

export interface OptionsModel { preferences: Preferences; speeds: string[]; profiles: readonly string[]; palettes: readonly string[] }

/** Supported options in an owned WPFG-derived panel. Unimplemented engine
 * controls are omitted rather than offered as inert checkboxes.
 */
export class OptionsDialog {
  readonly element: HTMLDialogElement;
  private form: HTMLFormElement;
  private model?: OptionsModel;

  constructor(parent: HTMLElement, ui: UiAssets | undefined, strings: Record<string, string>,
    private apply: (preferences: Preferences) => void, private sound: () => void) {
    const text = (key: string, fallback: string) => strings[key] ?? fallback;
    const dialog = document.createElement('dialog');
    this.element = dialog; dialog.id = 'options-dialog'; dialog.setAttribute('aria-labelledby', 'options-title');
    const form = document.createElement('form'); this.form = form; form.method = 'dialog';
    const heading = document.createElement('h2'); heading.id = 'options-title'; heading.textContent = text('options', 'Options');
    form.append(heading);
    const field = (name: keyof Preferences, labelText: string, help?: string) => {
      const label = document.createElement('label'); label.htmlFor = `option-${name}`; label.textContent = labelText;
      if (help) label.title = help;
      form.append(label);
    };
    const select = (name: keyof Preferences) => {
      const element = document.createElement('select'); element.name = name; element.id = `option-${name}`;
      form.append(element); return element;
    };
    field('speed', text('gameSpeed', 'Game Speed'), strings.gameSpeedHelp); select('speed');
    field('hotkeys', text('hotkeyProfile', 'Hotkey Profile'));
    const hotkeys = select('hotkeys');
    const hotkeyNames = [text('hotkeysDefinitive', 'Definitive Hotkeys'), text('hotkeysClassic', 'Classic Hotkeys'),
      text('hotkeysHd', 'HD Hotkeys'), text('hotkeysLeft', 'Left-handed Hotkeys')];
    HOTKEY_PROFILES.forEach((id, index) => hotkeys.add(new Option(hotkeyNames[index], id)));
    field('palette', `${text('optionsInterface', 'Interface')}: ${text('colorBlindMode', 'Color Blind Mode')}`);
    const palette = select('palette');
    const paletteNames = [text('paletteDefault', 'Off'), text('paletteDeuteranopia', 'Deuteranopia'),
      text('paletteProtanopia', 'Protanopia'), text('paletteTritanopia', 'Tritanopia')];
    UI_PALETTES.forEach((id, index) => palette.add(new Option(paletteNames[index], id)));
    for (const name of ['music', 'sound'] as const) {
      field(name, text(`${name}Volume`, name === 'music' ? 'Music Volume' : 'Sound Volume'), strings[`${name}VolumeHelp`]);
      const row = document.createElement('div'); row.className = 'option-volume';
      const input = document.createElement('input'); input.name = name; input.id = `option-${name}`;
      input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '1';
      const output = document.createElement('output'); output.setAttribute('for', input.id);
      input.addEventListener('input', () => { output.value = input.value; });
      row.append(input, output); form.append(row);
    }
    const actions = document.createElement('div'); actions.className = 'options-actions';
    for (const [action, label] of [['apply', text('apply', 'Apply')], ['ok', text('optionsOk', 'OK')], ['cancel', text('optionsCancel', 'Cancel')]]) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.optionAction = action;
      button.textContent = label;
      if (ui?.nativeFeedback) { button.classList.add('native-button'); buttonText(button, label); }
      button.addEventListener('click', () => {
        this.sound();
        if (action !== 'cancel') this.apply(this.read());
        if (action !== 'apply') this.close();
      });
      actions.append(button);
    }
    form.append(actions); dialog.append(form); parent.append(dialog);
    form.addEventListener('submit', event => { event.preventDefault(); this.apply(this.read()); this.close(); });
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    const native = ui?.nativeFeedback;
    if (native?.options) {
      dialog.classList.add('native-options');
      dialog.style.setProperty('--options-width', String(native.options.panelWidth));
      dialog.style.setProperty('--options-height', String(native.options.panelHeight));
      dialog.style.setProperty('--options-font', String(native.options.fontSize));
      dialog.style.setProperty('--options-heading', String(native.options.headingSize));
      if (native.options.frame) {
        const frame = document.createElement('div'); slices(frame, native.options.frame, ui!); dialog.prepend(frame);
      }
    }
  }

  show(model: OptionsModel): void {
    this.model = model;
    const speed = this.form.elements.namedItem('speed') as HTMLSelectElement;
    speed.replaceChildren(...model.speeds.map((label, index) => new Option(label, String(index))));
    const hotkeys = this.form.elements.namedItem('hotkeys') as HTMLSelectElement;
    for (const option of hotkeys.options) option.disabled = !model.profiles.includes(option.value);
    const palette = this.form.elements.namedItem('palette') as HTMLSelectElement;
    for (const option of palette.options) option.disabled = !model.palettes.includes(option.value);
    for (const [key, value] of Object.entries(model.preferences)) {
      const input = this.form.elements.namedItem(key) as HTMLInputElement | HTMLSelectElement;
      input.value = String(value);
      if (key === 'music' || key === 'sound') input.dispatchEvent(new Event('input'));
    }
    if (!this.element.open) this.element.showModal();
  }

  close(): void { this.element.close(); }

  private read(): Preferences {
    if (!this.model) return { ...DEFAULT_PREFERENCES };
    const data = new FormData(this.form);
    return normalizePreferences({ speed: Number(data.get('speed')), hotkeys: data.get('hotkeys'), palette: data.get('palette'),
      music: Number(data.get('music')), sound: Number(data.get('sound')) });
  }
}
