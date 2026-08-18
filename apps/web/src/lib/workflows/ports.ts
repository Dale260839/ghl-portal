import type { Effect } from './effects.ts';

/**
 * Ports — the side-effecting edge of the workflow layer.
 *
 * The planners are pure and return `Effect[]`. Something has to actually write
 * to GHL. That something is a set of handlers, one per effect type, supplied by
 * the caller. Tests supply a recording fake; the app supplies fixture handlers
 * today and GHL handlers once the token lands.
 *
 * The mapped type is the point: a handler is required for **every** effect type,
 * so adding an effect without wiring it is a compile error rather than a silent
 * no-op discovered in production.
 */
export type EffectHandlers = {
  [K in Effect['type']]: (effect: Extract<Effect, { type: K }>) => void | Promise<void>;
};

/**
 * A recording fake. Applies nothing, remembers everything — which is all a test
 * needs, and all the demo needs before there is a real GHL write path.
 */
export class RecordingPorts {
  readonly applied: Effect[] = [];

  readonly handlers: EffectHandlers = new Proxy({} as EffectHandlers, {
    get: (_target, _prop) => (effect: Effect) => {
      this.applied.push(effect);
    },
  });

  ofType<T extends Effect['type']>(type: T): Extract<Effect, { type: T }>[] {
    return this.applied.filter((e): e is Extract<Effect, { type: T }> => e.type === type);
  }

  clear(): void {
    this.applied.length = 0;
  }
}
