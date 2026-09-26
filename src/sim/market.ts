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

/** CTRL-all includes the fee in the budget. Resolve again at command execution,
 * not against a potentially stale dialog/shared snapshot. Integer fee rounding
 * leaves at most the indivisible remainder in the sender's stockpile. */
export function maximumTribute(state: GameState, owner: PlayerId, resource: ResourceKind): number {
  let low = 0, high = Math.floor(state.players[owner][resource]);
  while (low < high) {
    const mid = low + Math.ceil((high - low) / 2);
    if (mid + tributeFee(state, owner, mid) <= state.players[owner][resource]) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function applyMarketCommand(state: GameState, command: Extract<Command, { kind: 'exchange' | 'tribute' | 'tribute-batch' }>): CommandResult {
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
  if (![1, 2].includes(command.recipient) || command.recipient === command.player) return no('invalid tribute');
  if (!hasMarket(state, command.player)) return no('tribute needs a completed market');
  const recipient = state.players[command.recipient];
  const amounts = command.kind === 'tribute' ? { [command.resource]: command.amount } : command.amounts;
  if (!amounts || typeof amounts !== 'object' || Array.isArray(amounts)) return no('invalid tribute');
  const entries = Object.entries(amounts);
  if (!entries.length || entries.length > 4) return no('invalid tribute');
  const transfers: { resource: ResourceKind; amount: number; total: number }[] = [];
  for (const [key, value] of entries) {
    if (!['wood', 'food', 'gold', 'stone'].includes(key)) return no('invalid tribute');
    const resource = key as ResourceKind;
    const amount = value === 'all' && command.kind === 'tribute-batch' ? maximumTribute(state, command.player, resource) : value;
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) return no('invalid tribute amount');
    const total = amount + tributeFee(state, command.player, amount);
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(recipient[resource] + amount)) return no('invalid tribute amount');
    if (player[resource] < total) return no(`not enough ${resource}`);
    transfers.push({ resource, amount, total });
  }
  // Confirm is one atomic payment. A stale/invalid fourth resource cannot
  // spend the first three, and all resources use the current research fee.
  for (const { resource, amount, total } of transfers) {
    player[resource] -= total;
    recipient[resource] += amount;
  }
  return { ok: true };
}
