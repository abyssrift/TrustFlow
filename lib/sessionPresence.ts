export { idleLabel } from './time/idle';

export const IDLE_MS = 90 * 1000;

export const idleMsOf = (lastHeartbeatAt?: string | null, now = Date.now()) =>
  lastHeartbeatAt ? Math.max(0, now - new Date(lastHeartbeatAt).getTime()) : 0;

export const isIdle = (lastHeartbeatAt?: string | null, now = Date.now()) =>
  idleMsOf(lastHeartbeatAt, now) > IDLE_MS;
