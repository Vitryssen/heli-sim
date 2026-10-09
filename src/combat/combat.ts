import { Quaternion, Vector3 } from 'three';
import type { HeliState } from '../sim/state';
import type { WorldQuery } from '../world/query';
import type { Layout, Pad } from '../world/layout';
import { rng } from '../sim/math';
import { combatParams as P } from './params';
import { createLoadout, NO_WEAPON, refill, type Loadout, type WeaponInput } from './loadout';
import { createTargets, placeDrone, type PracticeTarget } from './targets';
import { rayAirframe, raySphere, segmentPointDistance } from './geometry';
import { clearLock, updateLock, type LockCandidate } from './lock';

export type Weapon = 'gun' | 'missile' | 'crash';

export interface Member {
  id: number;
  name: string;
  state: HeliState;
  loadout: Loadout;
  kills: number;
  deaths: number;
  targetKills: number;
  dead: boolean;
  respawnIn: number;
  killedBy: { id: number; weapon: Weapon } | null;
}

export interface Missile { id: number; owner: number; targetId: number | null; flareId: number | null; pos: Vector3; vel: Vector3; age: number }
export interface Flare { id: number; owner: number; pos: Vector3; vel: Vector3; age: number }

export type CombatEvent =
  | { kind: 'hit'; shooter: number; victim: number; damage: number; x: number; y: number; z: number; weapon: 'gun' | 'missile' }
  | { kind: 'kill'; killer: number | null; victim: number; weapon: Weapon }
  | { kind: 'targetDown'; shooter: number; target: number }
  | { kind: 'explosion'; x: number; y: number; z: number; size: number }
  | { kind: 'launch'; shooter: number; missile: number }
  | { kind: 'flare'; owner: number }
  | { kind: 'rearmed'; id: number };

export interface Pose { pos: Vector3; q: Quaternion }

export interface TickContext {
  /** Lag compensation: where `victim` was as `shooter` saw it. Null or absent means "now". */
  poseFor?(shooter: number, victim: number): Pose | null;
  /** Pad the aircraft is sitting on, for rearming. */
  padUnder(s: HeliState): Pad | null;
  /** Put a destroyed aircraft back at Base (Combat then revives its loadout). */
  respawn(id: number): void;
}

const _o = new Vector3(), _d = new Vector3(), _f = new Vector3(), _v = new Vector3(), _w = new Vector3(), _prev = new Vector3();
const GROUND_HIT_RADIUS = 2.4;

/**
 * Weapons and the deathmatch rules. Runs once per net tick, after the flight model, either on the
 * server (multiplayer) or in the browser (solo). Nothing here touches the DOM or rendering.
 */
export class Combat {
  time = 0;
  readonly members = new Map<number, Member>();
  readonly targets: PracticeTarget[];
  readonly missiles: Missile[] = [];
  readonly flares: Flare[] = [];
  private nextId = 1;
  private rand: () => number;
  private events: CombatEvent[] = [];
  private hits = new Map<string, Extract<CombatEvent, { kind: 'hit' }>>();

  constructor(private world: WorldQuery, layout: Layout, opts: { targets?: boolean; seed?: number } = {}) {
    this.targets = opts.targets === false ? [] : createTargets(layout);
    this.rand = rng(opts.seed ?? 1234);
  }

  add(id: number, name: string, state: HeliState): Member {
    const m: Member = { id, name, state, loadout: createLoadout(), kills: 0, deaths: 0, targetKills: 0, dead: false, respawnIn: 0, killedBy: null };
    this.members.set(id, m);
    return m;
  }

  remove(id: number): void { this.members.delete(id); }

  /** After a respawn or manual reset: alive, full loadout (keeps the selected weapon). */
  revive(id: number): void {
    const m = this.members.get(id);
    if (!m) return;
    const mode = m.loadout.mode;
    m.loadout = createLoadout();
    m.loadout.mode = mode;
    m.dead = false; m.respawnIn = 0; m.killedBy = null;
  }

  /** Whether someone is locking, or a missile is tracking, aircraft `id`. */
  warning(id: number): 'none' | 'locked' | 'missile' {
    if (this.missiles.some(ms => ms.targetId === id && ms.flareId === null)) return 'missile';
    for (const m of this.members.values()) if (m.id !== id && m.loadout.mode === 'missile' && m.loadout.lock.targetId === id) return 'locked';
    return 'none';
  }

  candidates(selfId: number): LockCandidate[] {
    const out: LockCandidate[] = [];
    for (const m of this.members.values()) if (m.id !== selfId && !m.dead && !m.state.crashed) out.push({ id: m.id, pos: m.state.pos });
    for (const t of this.targets) if (t.alive) out.push({ id: t.id, pos: t.pos });
    return out;
  }

  tick(dt: number, inputs: Map<number, WeaponInput>, ctx: TickContext): CombatEvent[] {
    this.events = [];
    this.hits.clear();
    this.time += dt;
    for (const t of this.targets) {
      if (!t.alive && (t.respawnIn -= dt) <= 0) { t.alive = true; t.hp = t.kind === 'drone' ? P.targets.droneHp : P.targets.groundHp; }
      if (t.kind === 'drone') placeDrone(t, this.time);
    }
    for (const m of this.members.values()) this.member(m, inputs.get(m.id) ?? NO_WEAPON, dt, ctx);
    this.flyMissiles(dt);
    this.flyFlares(dt);
    for (const h of this.hits.values()) this.events.push(h);
    for (const m of this.members.values()) this.lifecycle(m, dt, ctx);
    return this.events;
  }

  // ---------------------------------------------------------------- per aircraft
  private member(m: Member, input: WeaponInput, dt: number, ctx: TickContext): void {
    const l = m.loadout, s = m.state;
    l.missileCd = Math.max(0, l.missileCd - dt);
    l.flareCd = Math.max(0, l.flareCd - dt);
    if (m.dead || s.crashed) { l.firing = false; clearLock(l.lock); l.prevFire = input.fire; l.prevFlare = input.flare; return; }
    l.mode = input.mode;

    if (input.flare && !l.prevFlare && l.flares > 0 && l.flareCd <= 0) this.dropFlares(m);
    l.prevFlare = input.flare;

    l.firing = input.fire && l.mode === 'gun' && l.ammo > 0;
    if (l.firing) {
      l.gunAcc += P.gun.rate * dt;
      while (l.gunAcc >= 1 && l.ammo > 0) { l.gunAcc -= 1; l.ammo--; this.fireRound(m, ctx); }
    } else l.gunAcc = 0;

    if (l.mode === 'missile') updateLock(l.lock, s.pos, s.q, this.candidates(m.id), this.world, dt);
    else clearLock(l.lock);
    if (input.fire && !l.prevFire && l.mode === 'missile' && l.lock.locked && l.missiles > 0 && l.missileCd <= 0) this.launch(m);
    l.prevFire = input.fire;

    // rearm and repair: sit on any pad
    const settled = s.grounded && s.vel.length() < 0.5 && ctx.padUnder(s) !== null;
    l.rearm = settled ? l.rearm + dt : 0;
    if (l.rearm >= P.rearm) {
      l.rearm = 0;
      const needs = l.ammo < P.gun.ammo || l.missiles < P.missile.count || l.flares < P.flares.count || s.hull < 100;
      if (needs) { refill(l); s.hull = 100; this.events.push({ kind: 'rearmed', id: m.id }); }
    }
  }

  private fireRound(m: Member, ctx: TickContext): void {
    const g = P.gun, s = m.state, l = m.loadout;
    const mount = g.mounts[l.gunRound++ % g.mounts.length];
    _o.set(mount[0], mount[1], mount[2]).applyQuaternion(s.q).add(s.pos);
    const sx = (this.rand() * 2 - 1) * g.spread, sy = (this.rand() * 2 - 1) * g.spread;
    _d.set(sx, -Math.sin(g.boresightDown) + sy, -Math.cos(g.boresightDown)).normalize().applyQuaternion(s.q);

    let best = this.world.raycast(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, g.range) ?? g.range;
    let victim: Member | null = null, target: PracticeTarget | null = null;
    for (const o of this.members.values()) {
      if (o === m || o.dead || o.state.crashed) continue;
      const pose = ctx.poseFor?.(m.id, o.id) ?? o.state;
      const t = rayAirframe(_o, _d, pose.pos, pose.q, best);
      if (t !== null && t < best) { best = t; victim = o; target = null; }
    }
    for (const tg of this.targets) {
      if (!tg.alive) continue;
      const t = tg.kind === 'drone' ? rayAirframe(_o, _d, tg.pos, tg.q, best) : raySphere(_o, _d, tg.pos, GROUND_HIT_RADIUS, best);
      if (t !== null && t < best) { best = t; target = tg; victim = null; }
    }
    if (!victim && !target) return;
    _v.copy(_o).addScaledVector(_d, best);
    const victimId = victim ? victim.id : target!.id;
    const key = `${m.id}:${victimId}`;
    const h = this.hits.get(key);
    if (h) { h.damage += g.damage; h.x = _v.x; h.y = _v.y; h.z = _v.z; }
    else this.hits.set(key, { kind: 'hit', shooter: m.id, victim: victimId, damage: g.damage, x: _v.x, y: _v.y, z: _v.z, weapon: 'gun' });
    if (victim) this.damageMember(victim, g.damage, m.id, 'gun');
    else this.damageTarget(target!, g.damage, m.id, _v);
  }

  private launch(m: Member): void {
    const mp = P.missile, s = m.state, l = m.loadout;
    const rail = mp.rails[l.missiles % mp.rails.length];
    const pos = new Vector3(rail[0], rail[1], rail[2]).applyQuaternion(s.q).add(s.pos);
    _f.set(0, 0, -1).applyQuaternion(s.q);
    const vel = s.vel.clone().addScaledVector(_f, mp.launchSpeed);
    const ms: Missile = { id: this.nextId++, owner: m.id, targetId: l.lock.targetId, flareId: null, pos, vel, age: 0 };
    this.missiles.push(ms);
    l.missiles--; l.missileCd = mp.cooldown;
    this.events.push({ kind: 'launch', shooter: m.id, missile: ms.id });
  }

  private dropFlares(m: Member): void {
    const fp = P.flares, s = m.state, l = m.loadout;
    const n = Math.min(fp.salvo, l.flares);
    l.flares -= n; l.flareCd = fp.cooldown;
    const fresh: Flare[] = [];
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      _w.set(side * (6 + this.rand() * 6), -3 - this.rand() * 3, 4 + this.rand() * 4).applyQuaternion(s.q);
      const f: Flare = { id: this.nextId++, owner: m.id, pos: s.pos.clone().add(new Vector3(0, -0.6, 0)), vel: s.vel.clone().add(_w), age: 0 };
      this.flares.push(f); fresh.push(f);
    }
    this.events.push({ kind: 'flare', owner: m.id });
    // each missile chasing this aircraft gets one chance per new flare in its seeker to switch to it
    for (const ms of this.missiles) {
      if (ms.targetId !== m.id || ms.flareId !== null) continue;
      for (const f of fresh) {
        _v.copy(f.pos).sub(ms.pos);
        if (_v.angleTo(ms.vel) <= P.missile.seekerHalfAngle && this.rand() < fp.decoyChance) { ms.flareId = f.id; break; }
      }
    }
  }

  // ---------------------------------------------------------------- missiles & flares
  private flyMissiles(dt: number): void {
    const mp = P.missile;
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const ms = this.missiles[i];
      ms.age += dt;
      let tp: Vector3 | null = null, tv: Vector3 | null = null;
      if (ms.flareId !== null) {
        const f = this.flares.find(x => x.id === ms.flareId);
        if (f) { tp = f.pos; tv = f.vel; }
      } else if (ms.targetId !== null) {
        const m = this.members.get(ms.targetId);
        if (m && !m.dead && !m.state.crashed) { tp = m.state.pos; tv = m.state.vel; }
        const t = this.targets.find(x => x.id === ms.targetId && x.alive);
        if (t) { tp = t.pos; tv = t.vel; }
      }
      // proportional navigation: turn with the line-of-sight rotation, g-limited
      if (tp && tv) {
        _v.copy(tp).sub(ms.pos);
        const r2 = Math.max(1, _v.lengthSq());
        _w.copy(tv).sub(ms.vel);
        const omega = _v.clone().cross(_w).divideScalar(r2);
        const acc = omega.cross(ms.vel).multiplyScalar(mp.navGain);
        acc.addScaledVector(ms.vel, -acc.dot(ms.vel) / Math.max(1, ms.vel.lengthSq()));
        const lim = mp.maxG * 9.81;
        if (acc.length() > lim) acc.setLength(lim);
        ms.vel.addScaledVector(acc, dt);
      }
      const v = ms.vel.length();
      const want = ms.age < mp.boost ? Math.min(mp.speed, v + (mp.speed / mp.boost) * dt) : mp.speed;
      ms.vel.setLength(Math.max(want, 1));
      _prev.copy(ms.pos);
      ms.pos.addScaledVector(ms.vel, dt);

      // fuse: anything passing within the fuse radius this tick (not the shooter for the first second)
      let hit: Member | PracticeTarget | null = null;
      for (const m of this.members.values()) {
        if (m.dead || m.state.crashed || (m.id === ms.owner && ms.age < 1)) continue;
        if (segmentPointDistance(_prev, ms.pos, m.state.pos) < mp.fuse) { hit = m; break; }
      }
      if (!hit) for (const t of this.targets) if (t.alive && segmentPointDistance(_prev, ms.pos, t.pos) < mp.fuse) { hit = t; break; }
      const step = _prev.distanceTo(ms.pos);
      _d.copy(ms.pos).sub(_prev).divideScalar(Math.max(step, 1e-6));
      const ground = hit ? null : this.world.raycast(_prev.x, _prev.y, _prev.z, _d.x, _d.y, _d.z, step);
      if (hit || ground !== null || ms.age > mp.life) {
        if (ground !== null) ms.pos.copy(_prev).addScaledVector(_d, ground);
        this.detonate(ms, hit);
        this.missiles.splice(i, 1);
      }
    }
  }

  private detonate(ms: Missile, direct: Member | PracticeTarget | null): void {
    const mp = P.missile;
    this.events.push({ kind: 'explosion', x: ms.pos.x, y: ms.pos.y, z: ms.pos.z, size: 7 });
    const apply = (e: Member | PracticeTarget, dmg: number) => {
      if (dmg <= 0) return;
      this.events.push({ kind: 'hit', shooter: ms.owner, victim: e.id, damage: dmg, x: ms.pos.x, y: ms.pos.y, z: ms.pos.z, weapon: 'missile' });
      if ('loadout' in e) this.damageMember(e, dmg, ms.owner, 'missile');
      else this.damageTarget(e, dmg, ms.owner, ms.pos);
    };
    if (direct) apply(direct, mp.damage);
    for (const m of this.members.values()) {
      if (m === direct || m.dead || m.state.crashed) continue;
      const d = m.state.pos.distanceTo(ms.pos);
      if (d < mp.splash) apply(m, mp.splashDamage * (1 - d / mp.splash));
    }
    for (const t of this.targets) {
      if (t === direct || !t.alive) continue;
      const d = t.pos.distanceTo(ms.pos);
      if (d < mp.splash) apply(t, mp.splashDamage * (1 - d / mp.splash));
    }
  }

  private flyFlares(dt: number): void {
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.age += dt;
      f.vel.multiplyScalar(Math.pow(0.4, dt));
      f.vel.y -= 4 * dt;
      f.pos.addScaledVector(f.vel, dt);
      if (f.age > P.flares.life) this.flares.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- damage & deathmatch rules
  private damageMember(v: Member, amount: number, by: number, weapon: 'gun' | 'missile'): void {
    const s = v.state;
    if (v.dead || s.crashed) return;
    s.hull = Math.max(0, s.hull - amount);
    if (by !== v.id) { v.loadout.lastHitBy = by; v.loadout.lastHitAt = this.time; }
    if (s.hull > 0) return;
    s.crashed = true;
    s.hit = by === v.id ? 'Hit by your own missile' : `Shot down by ${this.members.get(by)?.name ?? 'someone'}`;
    s.hdgHold = s.altHold = s.attHold = null;
    v.killedBy = { id: by, weapon };
    this.events.push({ kind: 'explosion', x: s.pos.x, y: s.pos.y, z: s.pos.z, size: 9 });
  }

  private damageTarget(t: PracticeTarget, amount: number, by: number, at: Vector3): void {
    if (!t.alive) return;
    t.hp -= amount;
    if (t.hp > 0) return;
    t.alive = false;
    t.respawnIn = P.targets.respawn;
    const m = this.members.get(by);
    if (m) m.targetKills++;
    this.events.push({ kind: 'targetDown', shooter: by, target: t.id });
    this.events.push({ kind: 'explosion', x: at.x, y: t.pos.y, z: at.z, size: t.kind === 'drone' ? 7 : 9 });
  }

  /** Turns any crash (shot down or flown into something) into a death, credits the kill, and respawns. */
  private lifecycle(m: Member, dt: number, ctx: TickContext): void {
    if (!m.dead && m.state.crashed) {
      m.dead = true;
      m.deaths++;
      m.respawnIn = P.respawn;
      const l = m.loadout;
      const credited = m.killedBy?.id ?? (l.lastHitBy !== null && this.time - l.lastHitAt <= P.killCredit ? l.lastHitBy : null);
      const killer = credited !== null && credited !== m.id ? credited : null;
      if (killer !== null) { const k = this.members.get(killer); if (k) k.kills++; }
      this.events.push({ kind: 'kill', killer, victim: m.id, weapon: m.killedBy?.weapon ?? 'crash' });
      m.killedBy = null;
      l.firing = false;
      return;
    }
    if (m.dead && (m.respawnIn -= dt) <= 0) { ctx.respawn(m.id); this.revive(m.id); }
  }
}
