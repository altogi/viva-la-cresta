// A ride's line through Shuttlecock, kept with each ride for the "My times" view: where across the
// run the rider was (u, metres from the centre along the ice) and how fast they were going, every
// couple of metres from the end of Battledore to the start of Stream.

export const LINE = { from: 530, to: 668, step: 2 };

/** Samples in a full line (u and speed for each). */
export const LINE_SAMPLES = Math.floor((LINE.to - LINE.from) / LINE.step) + 1;

/** The distance down the run of the i-th sample. */
export const lineS = (i: number) => LINE.from + i * LINE.step;
