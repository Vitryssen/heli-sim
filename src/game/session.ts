import type { HeliState } from '../sim/state';
import { placeOnGround } from '../sim/state';
import type { WorldQuery } from '../world/query';
import { crashCheck, MAP_LIMIT } from '../sim/collisions';
import type { Mission, Notice } from './mission';

/** Per-frame game rules around the flight model: crashes, damage notices, map edge, reset. */
export class Session {
  constructor(readonly s: HeliState, private world: WorldQuery, readonly mission: Mission) {}

  reset(): Notice {
    const base = this.mission.pads[0];
    placeOnGround(this.s, base.x, base.top, base.z);
    this.mission.onReset();
    return { title: 'Engine off', detail: 'Raise the collective to start it and spool up the rotor', kind: 'info', ttl: 3.5 };
  }

  /** Returns at most one notice for the HUD this frame. */
  update(dt: number): Notice | null {
    const s = this.s;
    if (!s.crashed) {
      const reason = crashCheck(s, this.world);
      if (reason) {
        s.crashed = true; s.hdgHold = s.altHold = s.attHold = null;
        return { title: 'Crashed', detail: `${reason}\nPress R to reset`, kind: 'bad', ttl: 0 };
      }
    }
    if (s.crashed) {
      const g = this.world.groundAt(s.pos.x, s.pos.z, s.pos.y) + 0.4;
      if (s.pos.y < g) { s.pos.y = g; s.vel.multiplyScalar(0.85); s.vel.y = Math.max(0, s.vel.y); s.w.multiplyScalar(0.9); }
      return null;
    }
    if (s.hurt > 2) { s.hurt = 0; return { title: 'Hard landing', detail: `Hull ${Math.round(s.hull)}%`, kind: 'bad', ttl: 2 }; }
    const landing = this.mission.update(dt, s);
    if (landing) return landing;
    if (Math.max(Math.abs(s.pos.x), Math.abs(s.pos.z)) > MAP_LIMIT - 500) return { title: 'Leaving the area', detail: 'Turn back toward the beacon', kind: 'info', ttl: 2 };
    return null;
  }
}
