import type { HeliState } from '../sim/state';
import type { WorldQuery } from '../world/query';
import { params as defaultParams, type Params } from '../sim/params';
import { SIM_DT, step } from '../sim/step';
import { NET_DT, SUBSTEPS, type InputMsg } from './protocol';

/**
 * One net tick for one aircraft. Client prediction and the server both call this with the same
 * message, and sim time comes from the input's seq, so they compute the same result.
 */
export function simulateTick(s: HeliState, msg: InputMsg, world: WorldQuery, p: Params = defaultParams): void {
  const t0 = msg.seq * NET_DT;
  for (let k = 0; k < SUBSTEPS; k++) step(s, msg.input, msg.assists, world, SIM_DT, t0 + k * SIM_DT, p);
}
