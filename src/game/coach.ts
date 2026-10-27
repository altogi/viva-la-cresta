// The guide on a rider's first ride: how to start, steer, go back on the knives and rake, then what
// is coming down the run. Each control lesson slows time until the rider has tried it.

export interface CoachView {
  stage: string;
  s: number;
  steer: number;
  knives: boolean;
  rake: number;
}

interface Step {
  text: string;
  /** Shown from this distance down the run (default: as soon as the previous step is done). */
  at?: number;
  /** Shown until this distance (for the read-only tips). */
  until?: number;
  /** For control lessons: done once this has held for a moment. Time runs slow until then. */
  done?: (v: CoachView) => boolean;
  /** For tips without a distance: shown for this many seconds. */
  seconds?: number;
}

const FIRST_RIDE: Step[] = [
  { text: 'Hold the <b>left</b> or <b>right</b> edge of the screen to <b>steer</b>. Try it now.', done: (v) => Math.abs(v.steer) > 0.3 },
  { text: 'Tap the <b>top</b> of the screen to slide back onto the <b>knives</b>. On the knives you grip and brake; forward, you fly.', done: (v) => v.knives },
  { text: 'Hold the <b>bottom</b> of the screen to <b>rake</b>: the spikes on your boots dig in and slow you down. Left, both or right.', done: (v) => v.rake > 0.3 },
  { text: 'Good. Stay back on the knives and keep your speed down: <b>Rise</b> and <b>Battledore</b> are coming.', seconds: 5 },
  { text: '<b>Shuttlecock</b> is next. <b>Rake hard now!</b> Too fast here and you fly out into the straw.', at: 535, until: 615 },
  { text: "You're through! Tap the top to go <b>forward</b> and let it run.", at: 640, until: 720 },
  { text: '<b>Scylla</b> and <b>Charybdis</b>: let the toboggan ride up each bank, and steer to stay in it.', at: 975, until: 1080 },
  { text: '<b>Cresta Leap</b>: flat out to the finish.', at: 1130, until: 1200 },
];

export class Coach {
  private index: number;
  private held = 0;
  private shown = 0;
  /** The last step shown: where the guide picks up again if the rider falls. */
  lastShown: number;
  /** Time runs at this rate (slow while a lesson waits for the rider). */
  timeScale = 1;

  constructor(
    private readonly bubble: HTMLElement,
    private readonly steps: Step[] = FIRST_RIDE,
    startAt = 0,
  ) {
    this.index = Math.min(startAt, steps.length - 1);
    this.lastShown = this.index;
  }

  /** The first ride's guide, from the start or from where a fall interrupted it. */
  static firstRide(bubble: HTMLElement, startAt = 0) {
    return new Coach(bubble, FIRST_RIDE, startAt);
  }

  /** Before the bell. */
  ready() {
    this.show(
      this.index === 0
        ? 'Your first ride on the Cresta: a <b>lying start</b> from Junction. <b>Tap</b> to let the toboggan go.'
        : 'Back on the toboggan: we carry on from where you fell. <b>Tap</b> to let go.',
    );
  }

  update(v: CoachView, dt: number) {
    this.timeScale = 1;
    if (v.stage !== 'live') {
      if (v.stage !== 'ready' && v.stage !== 'countdown') this.hide();
      return;
    }
    const step = this.steps[this.index];
    if (!step) return this.hide();
    if (step.at !== undefined && v.s < step.at) return this.hide();
    if (step.until !== undefined && v.s > step.until) return this.advance();
    this.show(step.text);
    this.lastShown = this.index;
    this.shown += dt;
    if (step.done) {
      this.timeScale = 0.25;
      if (step.done(v)) this.held += dt;
      // Held for a moment (a tap counts for the knives), then on to the next lesson.
      if (this.held > (step === this.steps[1] ? 0 : 0.35)) {
        this.timeScale = 1;
        this.advance();
      }
    } else if (step.seconds !== undefined && this.shown > step.seconds) {
      this.advance();
    }
  }

  private advance() {
    this.index++;
    this.held = 0;
    this.shown = 0;
  }

  private show(html: string) {
    if (this.bubble.innerHTML !== html) this.bubble.innerHTML = html;
    this.bubble.hidden = false;
  }

  hide() {
    this.bubble.hidden = true;
  }
}

/** What to say after a rider's first fall: what happened, and how not to do it again. */
export function fallAdvice(kind: string, zone: string): string[] {
  if (kind === 'steinbock') return ['A Steinbock on the ice! They come down from the Corviglia now and then.', 'Nothing to learn from that one, except to keep your eyes up after Shuttlecock.'];
  if (zone === 'Shuttlecock')
    return [
      'Shuttlecock throws out riders who arrive too fast: the bank is low and the straw waits beyond it.',
      'Go back on the knives before Battledore and rake hard all the way into Shuttlecock. Come in slow, leave fast.',
    ];
  if (kind === 'wall')
    return [
      `You hit the wall at ${zone} too square: the toboggan was pointing into it.`,
      'Steer gently, keep the nose pointing down the run, and let the banks turn you rather than fighting them.',
    ];
  if (kind === 'over-wall')
    return [`You went over the low wall at ${zone}.`, 'Keep to the middle on the straights and stay off the inside lip of the banks.'];
  return [
    `Too fast for ${zone}: you climbed the bank until there was no bank left.`,
    'Brake earlier with the knives and rakes, and ride the bank lower: steer down it as you climb.',
  ];
}
