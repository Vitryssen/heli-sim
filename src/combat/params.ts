const DEG = Math.PI / 180;

/** Weapon and game-rule tunables. Mutable for the dev tuning panel, like the flight params. */
export const combatParams = {
  gun: {
    rate: 50,                      // rounds/s, both guns together (M134 pair, governed down)
    ammo: 3000,
    spread: 0.5 * DEG,             // random cone half-angle per round
    range: 1200,                   // m
    damage: 2.5,                   // hull % per hit
    boresightDown: 2 * DEG,        // guns are harmonised slightly nose-down
    muzzleSpeed: 870,              // m/s, only for tracer visuals; hits are instant
    mounts: [[-1.15, -0.38, -0.55], [1.15, -0.38, -0.55]] as [number, number, number][],
    tracerEvery: 5,
  },
  missile: {
    count: 4,
    cooldown: 1,                   // s between launches
    lockHalfAngle: 6 * DEG,
    keepHalfAngle: 10 * DEG,
    keepGrace: 0.3,                // s outside the keep cone before the lock drops
    lockRange: 2000,
    lockTime: 1.5,
    launchSpeed: 40,               // m/s off the rail, on top of the aircraft's speed
    boost: 0.4,                    // s to reach cruise speed
    speed: 300,
    navGain: 4,                    // proportional navigation constant
    maxG: 20,
    fuse: 5,                       // m proximity fuse
    damage: 75,
    splash: 10,
    splashDamage: 30,
    life: 8,
    seekerHalfAngle: 30 * DEG,     // flares inside this cone can decoy the missile
    rails: [[-1.35, -0.6, -0.3], [1.35, -0.6, -0.3]] as [number, number, number][],
  },
  flares: { count: 30, salvo: 4, cooldown: 1, life: 3, decoyChance: 0.3 },
  respawn: 5,                      // s after destruction
  rearm: 5,                        // s settled on a pad
  killCredit: 10,                  // s: a crash this soon after being hit counts as a kill for the shooter
  maxRewindTicks: 15,              // lag compensation limit (250 ms)
  targets: { droneHp: 40, groundHp: 60, respawn: 20 },
};

export type CombatParams = typeof combatParams;
