/**
 * Every tunable of the flight model. MD 500 / MH-6 class numbers where they exist.
 * Mutable on purpose: the dev tuning panel edits this object live.
 */
export const params = {
  g: 9.81,
  mass: 1300,                                       // kg
  gyration: { pitch: 1.8, yaw: 2.4, roll: 1.1 },    // radii of gyration², m² (inertia per unit mass)

  rotor: {
    radius: 4.15,            // m
    blades: 6,
    chord: 0.17,             // m
    liftSlope: 5.7,          // per rad
    cd0: 0.011,              // blade profile drag
    rho: 1.225,              // kg/m³
    omegaNominal: 50,        // rad/s ≈ 477 rpm, tip speed ≈ 207 m/s
    inertia: 600,            // polar moment, kg·m²
    inflowFloor: 0.03,       // keeps momentum theory finite in steep descents
    ctSigmaMax: 0.12,        // blade loading limit (stall); caps flare load near 2 g
    stallDrag: 3,           // profile drag growth per unit of stall overload
    groundEffectMax: 1.2,
    // collective blade pitch, rad
    thetaFlat: 0.02,
    thetaDown: 0.05,
    thetaNeutral: 0.127,     // just under hover out of ground effect
    thetaUp: 0.2,
    thetaRate: 0.6,          // how fast blade pitch follows the lever, rad/s
  },

  engine: {
    spoolTime: 2.5,          // s from start to governed rpm
    govKp: 3000,             // N·m per rad/s
    govKi: 2500,
    lag: 0.2,                // s, turbine response
    integrateBand: 2.5,      // rad/s; governor integrates only this close to the setpoint
    maxTorque: 9700,         // N·m at the rotor shaft (≈ 485 kW, 650 shp at governed rpm)
    friction: 6,             // N·m per rad/s
    crashBrake: 400,
    overspeedStart: 1.05,    // rotor drag rises steeply above this rpm fraction
    overspeedDrag: 4000,     // N·m per rad/s above it
  },

  torque: {
    trim: 3800,              // rotor torque the neutral tail rotor balances (hover), N·m
    yawAccel: 0.6,           // rad/s² per trim-torque of imbalance
  },

  control: {
    rawAuthority: 2.0,       // rad/s² at full stick, assists off
    rawYaw: 2.2,
    pitchRate: 1.1,          // rad/s at full stick, stability on
    rollRate: 1.5,
    yawRate: 1.3,
    rateGain: 6,
    yawGain: 4,
    attitudeHoldGain: 2.2,
    flatPitchAuthority: 0.25,
    yawSpeedFade: 32,        // m/s, tail rotor authority halves around here
  },

  aero: {
    damping: { pitch: 0.8, yaw: 0.5, roll: 0.8 },
    flapback: 0.006,
    weathervaneLin: 0.025,
    weathervaneQuad: 0.0025,
    dragQuad: 0.00082,
    dragLin: 0.012,
    vertDragQuad: 0.0015,
    vertDragLin: 0.02,
    turbulence: 0.12,
  },

  assists: {
    hoverKp: 0.03,           // blade pitch per m/s of climb-rate error
    hoverKi: 0.025,
    altitudeGain: 1.0,
    maxHoldClimb: 3,
    brakeGain: 0.45,
    brakeMaxG: 0.3,
    envelopePitch: 0.61,     // 35°
    envelopeRoll: 0.87,      // 50°
    headingGain: 2,
  },

  contact: { stiffness: 90, damping: 14, friction: 0.7, viscous: 30 },

  damage: { safeVertical: 3.5, destroyVertical: 8, perVertical: 5, safeHorizontal: 14, perHorizontal: 2 },
};

export type Params = typeof params;
