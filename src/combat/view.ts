import type { Quaternion, Vector3 } from 'three';
import type { Combat } from './combat';
import type { Lock, WeaponMode } from './loadout';
import type { TargetKind } from './targets';

/** What the local player's HUD needs about their own weapons. */
export interface SelfCombat {
  mode: WeaponMode;
  ammo: number;
  missiles: number;
  flares: number;
  lock: Lock;
  firing: boolean;
  warning: 'none' | 'locked' | 'missile';
  kills: number;
  deaths: number;
  targetKills: number;
  dead: boolean;
  respawnIn: number;
}

export interface TargetView { id: number; kind: TargetKind; pos: Vector3; q: Quaternion; alive: boolean }
export interface ProjectileView { id: number; pos: Vector3; vel: Vector3 }
export interface ScoreRow { id: number; name: string; kills: number; deaths: number; self: boolean }

/**
 * Everything the screen shows about combat. Solo builds it from the local simulation; multiplayer
 * builds it from server snapshots. Renderers, HUD and minimap only ever see this.
 */
export interface CombatView {
  self: SelfCombat;
  targets: TargetView[];
  missiles: ProjectileView[];
  flares: ProjectileView[];
  /** Other aircraft currently firing their guns (for their tracers). */
  firing: Set<number>;
  scores: ScoreRow[];
}

export function soloView(c: Combat, selfId: number): CombatView {
  const m = c.members.get(selfId)!;
  const l = m.loadout;
  return {
    self: {
      mode: l.mode, ammo: l.ammo, missiles: l.missiles, flares: l.flares, lock: l.lock, firing: l.firing,
      warning: c.warning(selfId), kills: m.kills, deaths: m.deaths, targetKills: m.targetKills, dead: m.dead, respawnIn: m.respawnIn,
    },
    targets: c.targets,
    missiles: c.missiles,
    flares: c.flares,
    firing: new Set([...c.members.values()].filter(o => o.id !== selfId && o.loadout.firing).map(o => o.id)),
    scores: [...c.members.values()].map(o => ({ id: o.id, name: o.name, kills: o.kills, deaths: o.deaths, self: o.id === selfId })),
  };
}
