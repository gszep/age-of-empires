import { playerAttributeFor } from './rules';
import type { Command, GameState, PlayerId, ResourceKind } from './types';
import type { CommandResult } from './game';

export type Commodity = Exclude<ResourceKind, 'gold'>;
export const COMMODITIES: Commodity[] = ['wood', 'food', 'stone'];
// Closed-engine price curve, explicitly inferred in the ledger. DAT owns fees.
const INITIAL_PRICES = { wood: 100, food: 100, stone: 130 };
const bounded = (price: number) => Math.max(20, Math.min(10000, price));
export const hasMarket = (state: GameState, owner: PlayerId) => state.entities.some(e =>
  e.kind === 'market' && e.owner === owner && !e.dead && e.buildProgress === undefined);

/** Pure quote: bulk orders advance each 100-unit lot's price before the next. */
export function marketQuote(state: GameState, owner: PlayerId, resource: Commodity, side: 'buy' | 'sell', amount = 100) {
  const prices = { ...(state.marketPrices ?? INITIAL_PRICES) };
  const fee = playerAttributeFor(state, owner, 'tradeVigRate') ?? 0.3;
  let gold = 0;
  for (let n = 0; n < amount; n += 100) {
    const price = prices[resource] * (side === 'buy' ? 1 + fee : 1 - fee);
    gold += side === 'buy' ? Math.ceil(price - 1e-9) : Math.floor(price + 1e-9);
    prices[resource] = bounded(prices[resource] + (side === 'buy' ? 3 : -3));
  }
  return { gold, prices };
}

export function tributeFee(state: GameState, owner: PlayerId, amount: number): number {
  return Math.ceil(amount * (playerAttributeFor(state, owner, 'tributeInefficency') ?? 0.3) - 1e-9);
}

export function applyMarketCommand(state: GameState, command: Extract<Command, { kind: 'exchange' | 'tribute' }>): CommandResult {
  const no = (reason: string): CommandResult => ({ ok: false, reason });
  const player = state.players[command.player];
  if (command.kind === 'exchange') {
    if (!COMMODITIES.includes(command.resource) || !['buy', 'sell'].includes(command.side)
      || ![100, 500].includes(command.amount)) return no('invalid market order');
    const market = state.entities.find(e => e.id === command.marketId && e.kind === 'market'
      && e.owner === command.player && !e.dead && e.buildProgress === undefined);
    if (!market) return no('market is not owned and complete');
    const quote = marketQuote(state, command.player, command.resource, command.side, command.amount);
    if (command.side === 'buy' && player.gold < quote.gold) return no('not enough gold');
    if (command.side === 'sell' && player[command.resource] < command.amount) return no(`not enough ${command.resource}`);
    player.gold += command.side === 'buy' ? -quote.gold : quote.gold;
    player[command.resource] += command.side === 'buy' ? command.amount : -command.amount;
    state.marketPrices = quote.prices;
    return { ok: true };
  }
  if (![1, 2].includes(command.recipient) || command.recipient === command.player
    || !['wood', 'food', 'gold', 'stone'].includes(command.resource)
    || !Number.isSafeInteger(command.amount) || command.amount <= 0) return no('invalid tribute');
  if (!hasMarket(state, command.player)) return no('tribute needs a completed market');
  const total = command.amount + tributeFee(state, command.player, command.amount);
  const recipient = state.players[command.recipient];
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(recipient[command.resource] + command.amount)) return no('invalid tribute amount');
  if (player[command.resource] < total) return no(`not enough ${command.resource}`);
  player[command.resource] -= total;
  recipient[command.resource] += command.amount;
  return { ok: true };
}
