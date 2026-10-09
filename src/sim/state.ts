import { Quaternion, Vector3 } from 'three';
import { SKID_DROP } from './geometry';
import { params } from './params';

export interface PilotInput {
  pitch: number;       // -1..1, + = nose down
  roll: number;        // -1..1, + = right
  yaw: number;         // -1..1, + = nose right
  collective: number;  // -1..1, springs to 0
}

export interface AssistFlags {
  stability: boolean;
  autoHover: boolean;
  envelope: boolean;
  turnCoord: boolean;
}

export interface HeliState {
  pos: Vector3; vel: Vector3; q: Quaternion; w: Vector3;   // w = body rates, rad/s

  // rotor & engine
  engineOn: boolean;
  omega: number;          // rotor speed, rad/s
  spoolTarget: number;
  engineTorque: number;
  govI: number;
  theta: number;          // collective blade pitch, rad
  lambdaI: number;        // induced inflow ratio (warm start)
  thrust: number;         // N
  rotorTorque: number;    // N·m
  groundEffect: number;
  mu: number;             // advance ratio

  // assist memory
  attHold: { p: number; r: number } | null;
  hdgHold: number | null;
  altHold: number | null;
  colI: number;

  // indicators (for the HUD)
  coordOn: boolean;
  envOn: boolean;

  // ground & damage
  contacts: number;
  grounded: boolean;
  skidContact: boolean[];
  impact: number;         // worst touchdown sink rate since last landing (negative)
  agl: number;            // skid height above ground
  hull: number;           // %
  hurt: number;           // damage taken since last read
  hit: string | null;     // reason the airframe was destroyed
  crashed: boolean;
}

export function createState(): HeliState {
  return {
    pos: new Vector3(), vel: new Vector3(), q: new Quaternion(), w: new Vector3(),
    engineOn: false, omega: 0, spoolTarget: 0, engineTorque: 0, govI: 0,
    theta: 0, lambdaI: 0, thrust: 0, rotorTorque: 0, groundEffect: 1, mu: 0,
    attHold: null, hdgHold: null, altHold: null, colI: 0,
    coordOn: false, envOn: false,
    contacts: 4, grounded: true, skidContact: [true, true, true, true], impact: 0, agl: 0,
    hull: 100, hurt: 0, hit: null, crashed: false,
  };
}

/** Cold aircraft sitting on a surface at height `top`. */
export function placeOnGround(s: HeliState, x: number, top: number, z: number, heading = 0): void {
  Object.assign(s, createState());
  s.pos.set(x, top + SKID_DROP - 0.03, z);
  s.q.setFromAxisAngle(new Vector3(0, 1, 0), -heading);
}

/** Running aircraft in flight (tests, debugging). Velocity is along the heading. */
export function placeInFlight(s: HeliState, x: number, y: number, z: number, speed: number, heading = 0, omega = 50): void {
  Object.assign(s, createState());
  s.pos.set(x, y, z);
  s.q.setFromAxisAngle(new Vector3(0, 1, 0), -heading);
  s.vel.set(Math.sin(heading) * speed, 0, -Math.cos(heading) * speed);
  s.engineOn = true; s.omega = omega; s.spoolTarget = omega; s.theta = params.rotor.thetaNeutral;
  s.contacts = 0; s.grounded = false; s.skidContact = [false, false, false, false];
}
