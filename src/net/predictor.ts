import type { AssistFlags, HeliState, PilotInput } from '../sim/state';
import type { WorldQuery } from '../world/query';
import { params as defaultParams, type Params } from '../sim/params';
import { applyState, type Buttons, type InputMsg } from './protocol';
import { simulateTick } from './tick';
import { NO_WEAPON, type WeaponInput } from '../combat/loadout';

/**
 * Client-side prediction for the local aircraft. Every input is applied locally straight away
 * and kept until the server acknowledges it. When a snapshot arrives, the state is reset to the
 * server's and the inputs it hasn't processed yet are replayed on top.
 */
export class Predictor {
  seq = 0;
  readonly pending: InputMsg[] = [];

  constructor(readonly s: HeliState, private world: WorldQuery, private p: Params = defaultParams) {}

  next(input: PilotInput, assists: AssistFlags, buttons: Buttons, weapon: WeaponInput = NO_WEAPON, viewTick = 0): InputMsg {
    const msg: InputMsg = { type: 'input', seq: ++this.seq, input: { ...input }, assists: { ...assists }, buttons: { ...buttons }, weapon: { ...weapon }, viewTick };
    this.pending.push(msg);
    simulateTick(this.s, msg, this.world, this.p);
    return msg;
  }

  reconcile(serverState: readonly number[], ack: number): void {
    applyState(this.s, serverState);
    let drop = 0;
    while (drop < this.pending.length && this.pending[drop].seq <= ack) drop++;
    this.pending.splice(0, drop);
    for (const m of this.pending) simulateTick(this.s, m, this.world, this.p);
  }
}
