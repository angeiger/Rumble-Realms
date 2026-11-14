/**
 * How every Pixi application of the client must be destroyed. Never pass `true`: that also
 * empties Pixi's global pools, which other live renderers (card images, the next battle)
 * still use, and their next frame would crash.
 */
export const DESTROY_RENDERER = { removeView: true } as const;
