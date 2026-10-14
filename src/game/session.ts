import type { HeliState } from '../sim/state';
import { placeOnGround } from '../sim/state';
import type { WorldQuery } from '../world/query';
import { crashCheck, EDGE_GRACE, edgeTimer } from '../sim/collisions';
import type { Landings, Notice } from './landings';

/** Per-frame game rules around the flight model: crashes, damage notices, map edge, reset. */
export class Session {
  private outside = 0;     // seconds past the map's warning line

  constructor(readonly s: HeliState, private world: WorldQuery, readonly landings: Landings) {}

  reset(): Notice {
    const base = this.landings.pads[0];
    placeOnGround(this.s, base.x, base.top, base.z);
    this.landings.onReset();
    this.outside = 0;
    return { title: 'Engine off', detail: 'Raise the collective to start it and spool up the rotor', kind: 'info', ttl: 3.5 };
  }

  /**
   * Returns at most one notice for the HUD this frame. In multiplayer the server decides crashes
   * (`authoritative` false), so only landings and the map-edge countdown are handled here.
   */
  update(dt: number, authoritative = true): Notice | null {
    const s = this.s;
    if (authoritative && !s.crashed) {
      const reason = crashCheck(s, this.world);
      if (reason) {
        s.crashed = true; s.hdgHold = s.altHold = s.attHold = null;
        return { title: 'Crashed', detail: `${reason}\nPress R to reset`, kind: 'bad', ttl: 0 };
      }
    }
    if (s.crashed) return null;
    if (s.hurt > 2) { s.hurt = 0; return { title: 'Hard landing', detail: `Hull ${Math.round(s.hull)}%`, kind: 'bad', ttl: 2 }; }
    const landing = this.landings.update(dt, s);
    this.outside = edgeTimer(this.outside, s, dt);
    if (this.outside > 0) {
      const left = EDGE_GRACE - this.outside;
      if (authoritative && left <= 0) {
        s.crashed = true; s.hdgHold = s.altHold = s.attHold = null;
        return { title: 'Crashed', detail: 'Left the map\nPress R to reset', kind: 'bad', ttl: 0 };
      }
      return { title: 'Turn back', detail: `Leaving the area · destroyed in ${Math.max(1, Math.ceil(left))} s`, kind: 'bad', ttl: 0.4 };
    }
    return landing;
  }
}
