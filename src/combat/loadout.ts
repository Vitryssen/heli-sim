import { combatParams } from './params';

export type WeaponMode = 'gun' | 'missile';
export interface WeaponInput { fire: boolean; mode: WeaponMode; flare: boolean }
export const NO_WEAPON: WeaponInput = { fire: false, mode: 'gun', flare: false };

export interface Lock { targetId: number | null; progress: number; locked: boolean; lostFor: number }

/** One aircraft's weapons and combat bookkeeping. */
export interface Loadout {
  mode: WeaponMode;
  ammo: number;
  missiles: number;
  flares: number;
  gunAcc: number;
  gunRound: number;           // alternates mounts, counts tracers
  missileCd: number;
  flareCd: number;
  lock: Lock;
  firing: boolean;
  prevFire: boolean;
  prevFlare: boolean;
  lastHitBy: number | null;
  lastHitAt: number;
  rearm: number;              // s settled on a pad
}

export function createLoadout(): Loadout {
  return {
    mode: 'gun', ammo: combatParams.gun.ammo, missiles: combatParams.missile.count, flares: combatParams.flares.count,
    gunAcc: 0, gunRound: 0, missileCd: 0, flareCd: 0, lock: { targetId: null, progress: 0, locked: false, lostFor: 0 },
    firing: false, prevFire: false, prevFlare: false, lastHitBy: null, lastHitAt: -1e9, rearm: 0,
  };
}

export function refill(l: Loadout): void {
  l.ammo = combatParams.gun.ammo; l.missiles = combatParams.missile.count; l.flares = combatParams.flares.count;
}

export const lockState = (l: Loadout): 'none' | 'search' | 'locked' => (l.lock.locked ? 'locked' : l.lock.targetId !== null ? 'search' : 'none');
