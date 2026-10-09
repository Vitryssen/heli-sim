import type { AssistFlags, HeliState, PilotInput } from '../sim/state';
import { params as defaultParams, type Params } from '../sim/params';
import { SIM_DT } from '../sim/step';
import type { WeaponInput } from '../combat/loadout';
import type { CombatEvent, Member } from '../combat/combat';

export const PROTOCOL_VERSION = 2;
/** Net tick: inputs are sent and applied once per tick, each tick runs SUBSTEPS fixed sim steps. */
export const NET_DT = 1 / 60;
export const SUBSTEPS = Math.round(NET_DT / SIM_DT);
export const SNAPSHOT_EVERY = 3;            // ticks → 20 Hz snapshots
export const MAX_NAME = 16;

export interface Buttons { reset: boolean }
export interface InputMsg {
  type: 'input';
  seq: number;
  input: PilotInput;
  assists: AssistFlags;
  buttons: Buttons;
  weapon: WeaponInput;
  /** Server tick the client was showing other aircraft at when this input was made (lag compensation). */
  viewTick: number;
}
export interface JoinMsg { type: 'join'; name: string; room: string; version: number; paramsHash: string }
export type ClientMsg = JoinMsg | InputMsg | { type: 'ping'; t: number };

/** `c` is a packed combat state, see packCombat. */
export interface PlayerSnap { id: number; name: string; respawns: number; reason: string | null; s: number[]; c: number[] }
export interface SnapshotMsg {
  type: 'snapshot';
  tick: number;
  acks: Record<number, number>;
  players: PlayerSnap[];
  /** Combat clock (drones fly a pure function of it). */
  ct: number;
  /** [id, owner, x, y, z, vx, vy, vz] */
  missiles: number[][];
  /** [id, x, y, z, vx, vy, vz] */
  flares: number[][];
  /** Alive flag per practice target, in createTargets order. */
  targets: number[];
}
export type ServerMsg =
  | { type: 'welcome'; id: number; tick: number; room: string }
  | { type: 'reject'; reason: string }
  | SnapshotMsg
  | { type: 'event'; kind: 'join' | 'leave' | 'crash'; id: number; name: string; detail?: string }
  | { type: 'combat'; events: CombatEvent[] }
  | { type: 'pong'; t: number };

export interface PackedCombat {
  mode: 'gun' | 'missile'; ammo: number; missiles: number; flares: number;
  lockId: number | null; lockProgress: number; locked: boolean;
  kills: number; deaths: number; firing: boolean; warning: 'none' | 'locked' | 'missile';
  dead: boolean; respawnIn: number; targetKills: number;
}

const WARNINGS = ['none', 'locked', 'missile'] as const;

export function packCombat(m: Member, warning: 'none' | 'locked' | 'missile'): number[] {
  const l = m.loadout;
  return [l.mode === 'gun' ? 0 : 1, l.ammo, l.missiles, l.flares, l.lock.targetId ?? -1, Math.round(l.lock.progress * 100) / 100, +l.lock.locked,
    m.kills, m.deaths, +l.firing, WARNINGS.indexOf(warning), +m.dead, Math.round(m.respawnIn * 10) / 10, m.targetKills];
}

export function unpackCombat(c: readonly number[]): PackedCombat {
  return {
    mode: c[0] === 1 ? 'missile' : 'gun', ammo: c[1], missiles: c[2], flares: c[3],
    lockId: c[4] < 0 ? null : c[4], lockProgress: c[5], locked: c[6] === 1,
    kills: c[7], deaths: c[8], firing: c[9] === 1, warning: WARNINGS[c[10]] ?? 'none',
    dead: c[11] === 1, respawnIn: c[12], targetKills: c[13],
  };
}

export const encode = (m: ClientMsg | ServerMsg): string => JSON.stringify(m);

function parse(raw: unknown): { type?: unknown } | null {
  try {
    const m = JSON.parse(String(raw)) as unknown;
    return m && typeof m === 'object' ? (m as { type?: unknown }) : null;
  } catch { return null; }
}

const num = (v: unknown, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
const bool = (v: unknown): boolean => v === true;

/** Parses and sanitizes anything a client sends. Never trust it: clamp every axis, coerce every flag. */
export function decodeClient(raw: unknown): ClientMsg | null {
  const m = parse(raw) as Record<string, unknown> | null;
  if (!m) return null;
  if (m.type === 'join') {
    return {
      type: 'join',
      name: String(m.name ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, MAX_NAME) || 'Pilot',
      room: roomCode(String(m.room ?? '')),
      version: num(m.version, 0, 1e6),
      paramsHash: String(m.paramsHash ?? ''),
    };
  }
  if (m.type === 'input') {
    const i = (m.input ?? {}) as Record<string, unknown>, a = (m.assists ?? {}) as Record<string, unknown>, b = (m.buttons ?? {}) as Record<string, unknown>;
    const w = (m.weapon ?? {}) as Record<string, unknown>;
    return {
      type: 'input',
      seq: Math.floor(num(m.seq, 0, Number.MAX_SAFE_INTEGER)),
      input: { pitch: num(i.pitch, -1, 1), roll: num(i.roll, -1, 1), yaw: num(i.yaw, -1, 1), collective: num(i.collective, -1, 1) },
      assists: { stability: bool(a.stability), autoHover: bool(a.autoHover), envelope: bool(a.envelope), turnCoord: bool(a.turnCoord) },
      buttons: { reset: bool(b.reset) },
      weapon: { fire: bool(w.fire), mode: w.mode === 'missile' ? 'missile' : 'gun', flare: bool(w.flare) },
      viewTick: Math.floor(num(m.viewTick, 0, Number.MAX_SAFE_INTEGER)),
    };
  }
  if (m.type === 'ping') return { type: 'ping', t: num(m.t, -1e15, 1e15) };
  return null;
}

export function decodeServer(raw: unknown): ServerMsg | null {
  const m = parse(raw);
  return m && typeof m.type === 'string' ? (m as ServerMsg) : null;
}

/** Room codes: lower-case letters, digits and dashes, 1–24 chars. */
export function roomCode(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'lobby';
}

/** Order of HeliState fields on the wire. Everything that influences the next step must be here. */
export function serializeState(s: HeliState): number[] {
  const h = s.attHold;
  return [
    s.pos.x, s.pos.y, s.pos.z, s.vel.x, s.vel.y, s.vel.z, s.q.x, s.q.y, s.q.z, s.q.w, s.w.x, s.w.y, s.w.z,
    +s.engineOn, s.omega, s.spoolTarget, s.engineTorque, s.govI, s.theta, s.lambdaI, s.thrust, s.rotorTorque, s.groundEffect, s.mu,
    h ? 1 : 0, h?.p ?? 0, h?.r ?? 0, s.hdgHold === null ? 0 : 1, s.hdgHold ?? 0, s.altHold === null ? 0 : 1, s.altHold ?? 0, s.colI,
    +s.coordOn, +s.envOn, s.contacts, +s.grounded, ...s.skidContact.map(Number), s.impact, s.agl, s.hull, s.hurt, +s.crashed,
  ];
}

export function applyState(s: HeliState, d: readonly number[]): void {
  let i = 0;
  const n = () => d[i++];
  s.pos.set(n(), n(), n()); s.vel.set(n(), n(), n()); s.q.set(n(), n(), n(), n()); s.w.set(n(), n(), n());
  s.engineOn = n() === 1; s.omega = n(); s.spoolTarget = n(); s.engineTorque = n(); s.govI = n(); s.theta = n(); s.lambdaI = n();
  s.thrust = n(); s.rotorTorque = n(); s.groundEffect = n(); s.mu = n();
  const hasAtt = n() === 1, ap = n(), ar = n(); s.attHold = hasAtt ? { p: ap, r: ar } : null;
  const hasHdg = n() === 1, hdg = n(); s.hdgHold = hasHdg ? hdg : null;
  const hasAlt = n() === 1, alt = n(); s.altHold = hasAlt ? alt : null;
  s.colI = n(); s.coordOn = n() === 1; s.envOn = n() === 1; s.contacts = n(); s.grounded = n() === 1;
  s.skidContact = [n() === 1, n() === 1, n() === 1, n() === 1];
  s.impact = n(); s.agl = n(); s.hull = n(); s.hurt = n(); s.crashed = n() === 1;
}

/** FNV-1a over the flight-model parameters, so a client with different physics can't join. */
export function paramsHash(p: Params = defaultParams): string {
  const str = JSON.stringify(p);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}
