import type { AnimationInfo } from './assets';

export interface SoundPose {
  key: string;
  /** Unwrapped frame clock; independent of the sprite's mirrored direction. */
  frame: number;
  direction: number;
  animation: AnimationInfo;
}

/** Presentation-only frame crossing detector. Visibility/viewport filtering is
 * done by the caller; leaving either forgets the voice so re-entry is silent.
 */
export class WorldSounds {
  private previous = new Map<number, SoundPose>();

  poll(poses: ReadonlyMap<number, SoundPose>): { id: number; event: number }[] {
    const result: { id: number; event: number }[] = [];
    for (const [id, pose] of poses) {
      const previous = this.previous.get(id);
      if (!previous) continue; // resume/reveal must not replay historical sounds
      const frames = Math.max(1, pose.animation.frames);
      let from = previous.key === pose.key && previous.frame <= pose.frame ? previous.frame : -1;
      // A background tab or fast-forward never emits an unbounded backlog.
      from = Math.max(from, pose.frame - frames);
      const played = new Set<number>();
      for (const cue of pose.animation.soundEvents ?? []) {
        if (cue.direction !== undefined && cue.direction !== pose.direction) continue;
        const at = Math.floor((pose.frame - cue.frame) / frames) * frames + cue.frame;
        if (at < 0 || at <= from || at > pose.frame || played.has(cue.event)) continue;
        result.push({ id, event: cue.event });
        played.add(cue.event);
      }
    }
    this.previous = new Map(poses);
    return result;
  }
}
