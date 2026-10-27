// The career, on screen: the intro, the saved games, the hub between rides, the moments (joining
// the club, the choice of flat-top or Top), the races with their Tower results sheets, and the end.

import { JUNCTION_S } from '../track/cresta';
import { RIDERS, TOBOGGANS } from '../sim/rider';
import { LOOKS } from '../render/riderLooks';
import { flagUrl } from '../ui/flags';
import {
  dateOf,
  goal,
  handicap,
  newCareer,
  nextDay,
  nextPractice,
  noteBest,
  recordPractice,
  RIDES_PER_DAY,
  startConversion,
  type Career,
  type Setup,
} from '../career/career';
import { cannotEnter, fallCode, fastestOfDay, npcField, playerEntrant, raceOn, standings, upcoming, type Entrant, type Race } from '../career/races';
import { deleteCareer, loadSaves, newId, nextGameName, storeCareer } from '../career/saves';
import { Coach, fallAdvice } from './coach';
import type { RideMode, RideResult, RideSetup } from './rideMode';
import type { SelectMode } from './selectMode';
import type { Selection } from './selection';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const NATIONS: Record<string, string> = { maximilian: 'D', adelaide: 'GB', remo: 'CH' };

export type Screen = 'intro' | 'saves' | 'hub' | 'select' | 'ride';

export class CareerMode {
  private career: Career | null = null;

  constructor(
    private readonly ride: RideMode,
    private readonly select: SelectMode,
    private readonly show: (screen: Screen) => void,
    private readonly onRider: (sel: Selection) => void,
  ) {
    $('intro').addEventListener('click', () => this.saves());
    $('new-game').addEventListener('click', () => this.newGame());
    $('hub-practice').addEventListener('click', () => this.practice());
    $('hub-next-day').addEventListener('click', () => {
      if (!this.career) return;
      if (this.career.race) this.abandonRace();
      nextDay(this.career);
      this.save();
      this.hub();
    });
    $('hub-games').addEventListener('click', () => this.saves());
    $('sheet-close').addEventListener('click', () => {
      $('sheet').hidden = true;
      this.afterSheet?.();
    });
  }

  private afterSheet: (() => void) | null = null;

  intro() {
    this.show('intro');
  }

  // ---------- Saved games ----------

  saves() {
    this.career = null;
    const list = $('save-list');
    list.replaceChildren();
    const saves = loadSaves();
    for (const c of saves) {
      const item = document.createElement('div');
      item.className = 'save';
      const best = Math.min(...Object.values(c.best).filter((t): t is number => t !== undefined));
      const played = new Date(c.lastPlayed).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      item.innerHTML = `
        <button class="save-open">
          <span class="save-name">${c.name}</span>
          <span class="save-rider"><img class="flag" src="${flagUrl(LOOKS[c.rider].flag)}" alt="" />${RIDERS[c.rider].name}${c.member ? '' : ' · SL'}</span>
          <span class="save-best">${Number.isFinite(best) ? `Best ${best.toFixed(2)} s` : 'No time yet'}</span>
          <span class="save-date">Last played ${played}</span>
        </button>
        <button class="save-delete" aria-label="Delete ${c.name}">✕</button>`;
      item.querySelector('.save-open')!.addEventListener('click', () => this.open(c));
      item.querySelector('.save-delete')!.addEventListener('click', () =>
        this.modal(`Delete ${c.name}?`, `${RIDERS[c.rider].name}'s career will be gone for good.`, [
          { label: 'Delete', primary: true, run: () => (deleteCareer(c.id), this.saves()) },
          { label: 'Keep it', run: () => this.saves() },
        ]),
      );
      list.append(item);
    }
    $('saves-empty').hidden = saves.length > 0;
    this.show('saves');
  }

  private open(c: Career) {
    this.career = c;
    this.onRider({ rider: c.rider, toboggan: c.toboggan });
    this.hub();
  }

  private newGame() {
    this.select.onDone = (sel) => {
      const c = newCareer(newId(), nextGameName(), sel.rider);
      this.career = c;
      this.save();
      this.onRider({ rider: c.rider, toboggan: 'traditional' });
      this.modal(
        'Beginner Day',
        `Welcome to the Cresta, ${RIDERS[c.rider].name}. Your first ride is a <b>lying start from Junction</b> on a traditional toboggan. We'll show you everything on the way down.`,
        [{ label: 'To Junction', primary: true, run: () => this.practice() }],
      );
    };
    this.show('select');
    this.select.open({ career: true });
  }

  private save() {
    if (this.career) storeCareer(this.career);
  }

  // ---------- The hub ----------

  hub() {
    const c = this.career!;
    // A race left unfinished (a fall, or a day that has gone by) is over.
    if (c.race && (c.race.dq || raceOn(c.day)?.race.id !== c.race.raceId)) {
      this.abandonRace();
      this.save();
    }
    const date = dateOf(c.day);
    $('hub-rider').innerHTML = `<img class="flag" src="${flagUrl(LOOKS[c.rider].flag)}" alt="" />${RIDERS[c.rider].name} <small>${c.member ? 'Member' : 'SL'}</small>`;
    $('hub-date').textContent = `${date.label} · Season ${c.season}`;
    $('hub-goal').textContent = goal(c);

    // Today: a race, or practice.
    const today = raceOn(c.day);
    const todayEl = $('hub-today');
    todayEl.replaceChildren();
    if (today) {
      const { race, raceDay } = today;
      const entered = c.race?.raceId === race.id;
      const card = document.createElement('div');
      card.className = 'race-card';
      const why = cannotEnter(c, race);
      const format = `${race.start === 'top' ? 'Top' : 'Junction'} · ${race.kind === 'major' ? 'scratch' : 'handicap'} · ${race.days > 1 ? `day ${raceDay + 1} of ${race.days}` : 'one day'}`;
      card.innerHTML = `<div class="race-today">Today</div><div class="race-name">${race.name}</div><div class="race-format">${format}</div>`;
      if (entered || (raceDay === 0 && !why)) {
        const b = document.createElement('button');
        b.className = 'primary';
        b.textContent = entered ? 'Ride today’s courses' : 'Enter the race';
        b.addEventListener('click', () => this.raceDay(race));
        card.append(b);
      } else {
        const note = document.createElement('div');
        note.className = 'race-note';
        note.textContent = why ?? 'Under way: you are not entered.';
        card.append(note);
      }
      todayEl.append(card);
    }

    // Practice: the next ride, with a choice of start and toboggan once they're open.
    const racing = c.race !== null && today?.race.id === c.race.raceId;
    const next = nextPractice(c);
    const closed = c.ridesToday >= RIDES_PER_DAY;
    $('hub-practice').hidden = racing;
    $('hub-practice').textContent = closed ? 'The run is closed for today' : `Practice · ${describe(next)}`;
    ($('hub-practice') as HTMLButtonElement).disabled = closed;
    $('hub-practice-note').textContent = racing ? '' : closed ? 'Come back tomorrow.' : `Ride ${c.ridesToday + 1} of ${RIDES_PER_DAY} today.`;
    this.choices(c);

    // Recent rides, bests and what's coming up.
    const rides = c.rides.slice(-5).reverse();
    $('hub-rides').innerHTML = rides.length
      ? rides.map((r) => `<div><span>${r.race ? 'Race' : r.start === 'top' ? 'Top' : 'Junction'} · ${TOBOGGANS[r.toboggan].name}${r.style === 'lying' ? ' · lying' : ''}</span><b>${r.time !== null ? r.time.toFixed(2) : r.fall === 'Retired' ? 'Retired' : `Fall (${fallCode(r.fall ?? '')})`}</b></div>`).join('')
      : '<div class="muted">No rides yet.</div>';
    const bests = Object.entries(c.best).filter(([, t]) => t !== undefined);
    $('hub-bests').innerHTML = bests.length
      ? bests.map(([k, t]) => { const [start, tob] = k.split('-'); return `<div><span>${start === 'top' ? 'Top' : 'Junction'} · ${TOBOGGANS[tob as 'traditional'].name}</span><b>${t!.toFixed(2)}</b></div>`; }).join('')
      : '<div class="muted">—</div>';
    $('hub-races').innerHTML = upcoming(c.day)
      .map((r) => `<div><span>${dateOf(r.day).short} · ${r.name}</span><b>${r.start === 'top' ? 'Top' : 'Jct'} · ${r.kind === 'major' ? 'Scr' : 'H’cap'}</b></div>`)
      .join('') || '<div class="muted">The season is over: next season starts on 26 December.</div>';
    const won = c.results.filter((r) => r.position === 1).length;
    $('hub-record').textContent = c.results.length ? `${c.results.length} race${c.results.length > 1 ? 's' : ''}, ${won} won${c.gnWon ? ' · Grand National winner' : ''}` : '';
    this.show('hub');
  }

  /** Chips for the start and toboggan, once the rider has more than one of either. */
  private choices(c: Career) {
    const el = $('hub-choices');
    el.replaceChildren();
    if (!c.member || c.conversion) return;
    const chip = (label: string, on: boolean, run: () => void) => {
      const b = document.createElement('button');
      b.className = `chip${on ? ' chosen' : ''}`;
      b.textContent = label;
      b.addEventListener('click', () => {
        run();
        this.save();
        this.hub();
      });
      el.append(b);
    };
    if (c.top === 'yes') {
      chip('Junction', c.start === 'junction', () => (c.start = 'junction'));
      chip('Top', c.start === 'top', () => (c.start = 'top'));
    }
    if (c.flattop === 'yes') {
      chip('Traditional', c.toboggan === 'traditional', () => (c.toboggan = 'traditional'));
      chip('Flat-top', c.toboggan === 'flattop', () => (c.toboggan = 'flattop'));
    }
  }

  // ---------- Practice ----------

  private practice() {
    const c = this.career!;
    if (c.ridesToday >= RIDES_PER_DAY) return this.hub();
    const setup = nextPractice(c);
    const coach = setup.first ? Coach.firstRide($('coach'), c.tutorialStep) : undefined;
    this.rideWith(setup, setup.first ? 'Beginner Day · your first ride' : `Practice · ${describe(setup)}`, coach, (result) => {
      if (!result) return this.hub();
      const fallZone = result.fall?.zone ?? null;
      const outcome = recordPractice(c, setup, result.time, fallZone, result.speed);
      // A fall on the first ride: the guide picks up again at the message it had reached.
      if (setup.first && coach) c.tutorialStep = result.fall ? coach.lastShown : 0;
      if (result.fall) c.seenFallHelp = true;
      this.save();
      const moments: (() => void)[] = [];
      if (setup.first && result.time !== null)
        moments.push(() => this.modal('Your first ride!', `Down in ${result.time!.toFixed(2)} s. Two more clean lying starts, then the running start, a few steps at a time. Five rides under 50 s and the club will take you on.`, [{ label: 'Carry on', primary: true, run: next }]));
      if (setup.first && result.fall)
        moments.push(() => this.modal('Back to Junction', 'Every Cresta rider has been where you are now. Your first ride starts again, and the guide picks up where you fell.', [{ label: 'Try again', primary: true, run: next }]));
      if (outcome.joined)
        moments.push(() =>
          this.modal(
            'Welcome to the club',
            'Five rides under 50 seconds, and the President took a liking to you. You are now a member of the St Moritz Tobogganing Club: off the Supplementary List, and free to race. The Curzon Cup awaits.',
            [{ label: 'Splendid', primary: true, run: next }],
          ),
        );
      if (outcome.choice)
        moments.push(() =>
          this.modal('Tower is impressed', 'Three quick rides out of five. Choose your next step: convert to the <b>flat-top</b> (faster, and touchier), or ride from <b>Top</b>, with Church Leap and the high banks.', [
            { label: 'The flat-top', primary: true, run: () => (startConversion(c, 'flattop'), this.save(), next()) },
            { label: 'Ride from Top', run: () => (startConversion(c, 'top'), this.save(), next()) },
          ]),
        );
      if (outcome.unlocked)
        moments.push(() =>
          this.modal(outcome.unlocked === 'top' ? 'Top is open' : 'The flat-top is yours', outcome.unlocked === 'top' ? 'Your first ride from Top is a lying start. Rake hard down Church Leap.' : 'Three lying starts from Junction on the flat-top, then the running start again.', [{ label: 'Onwards', primary: true, run: next }]),
        );
      if (c.ridesToday >= RIDES_PER_DAY) moments.push(() => this.modal('The run is closed', `That's ${RIDES_PER_DAY} rides for today.`, [{ label: 'Next day', primary: true, run: () => (nextDay(c), this.save(), next()) }]));
      const next = () => (moments.length ? moments.shift()!() : this.hub());
      next();
    });
  }

  private rideWith(setup: Setup, title: string, coach: Coach | undefined, onDone: (r: RideResult | null) => void, race = false) {
    const c = this.career!;
    const rs: RideSetup = {
      startS: setup.start === 'top' ? 0 : JUNCTION_S,
      start: setup.style,
      steps: setup.steps,
      label: `${setup.start === 'top' ? 'Top' : 'Junction'} · ${setup.style === 'lying' ? 'lying start' : 'running start'}`,
      career: {
        title,
        race,
        coach,
        fallLines: c.seenFallHelp ? undefined : fallAdvice,
        onDone: (r) => onDone(r),
      },
    };
    this.ride.selection = { rider: c.rider, toboggan: setup.toboggan };
    this.show('ride');
    this.ride.begin(rs);
  }

  // ---------- Races ----------

  private raceDay(race: Race) {
    const c = this.career!;
    const today = raceOn(c.day)!;
    if (!c.race) {
      c.race = {
        raceId: race.id,
        raceDay: 0,
        course: 0,
        times: [[]],
        speeds: [[]],
        handicap: race.kind === 'handicap' ? handicap(c, race.start) : 0,
        dq: false,
        seed: Math.floor(Math.random() * 1e9),
      };
      this.save();
    }
    const entry = c.race;
    if (entry.raceDay !== today.raceDay) {
      entry.raceDay = today.raceDay;
      entry.course = 0;
      entry.times[entry.raceDay] = [];
      entry.speeds[entry.raceDay] = [];
    }
    const hcp = race.kind === 'handicap' ? ` Your handicap is <b>${entry.handicap === 0 ? 'Scr' : entry.handicap.toFixed(1)}</b>.` : ' Scratch: the fastest aggregate wins.';
    this.modal(
      race.name,
      `${race.note ? `${race.note}<br>` : ''}${race.start === 'top' ? 'From Top' : 'From Junction'}, three courses${race.days > 1 ? ` a day for ${race.days} days` : ''}.${hcp} A fall on any course and you are out.`,
      [{ label: entry.course ? `Course ${entry.course + 1}` : 'To the start', primary: true, run: () => this.course(race) }],
    );
  }

  private course(race: Race) {
    const c = this.career!;
    const entry = c.race!;
    const toboggan = c.flattop === 'yes' ? c.toboggan : 'traditional';
    const setup: Setup = { start: race.start, toboggan, style: 'running', steps: 7 };
    const dayText = race.days > 1 ? ` · Day ${entry.raceDay + 1}` : '';
    this.rideWith(setup, `${race.name}${dayText} · Course ${entry.course + 1} of 3`, undefined, (result) => {
      const time = result?.time ?? null;
      entry.times[entry.raceDay][entry.course] = time;
      entry.speeds[entry.raceDay][entry.course] = result?.speed ?? 0;
      c.rides.push({ day: c.day, season: c.season, start: race.start, toboggan, style: 'running', time, fall: result?.fall?.zone ?? (result ? null : 'Retired'), speed: result?.speed ?? 0, race: race.id });
      if (time !== null) noteBest(c, race.start, toboggan, time);
      if (result?.fall) c.seenFallHelp = true;
      if (time === null) {
        entry.dq = true;
        this.save();
        return this.dayDone(race, result?.fall?.zone ?? 'Retired');
      }
      entry.course++;
      this.save();
      if (entry.course < 3)
        this.modal(`Course ${entry.course}: ${time.toFixed(2)} s`, `${(result!.speed).toFixed(1)} mph at the finish.`, [{ label: `Course ${entry.course + 1}`, primary: true, run: () => this.course(race) }]);
      else this.dayDone(race, null);
    }, true);
  }

  /** The day's courses are done (or the rider fell): the Tower's sheet, then on. */
  private dayDone(race: Race, fallZone: string | null) {
    const c = this.career!;
    const entry = c.race!;
    const field: Entrant[] = [...npcField(race, entry.seed), playerEntrant(entry, RIDERS[c.rider].name, NATIONS[c.rider], fallZone)];
    const last = entry.dq || entry.raceDay + 1 >= race.days;
    this.sheet(race, field, entry.raceDay, c.day);
    this.afterSheet = () => {
      if (last) this.finishRace(race, field);
      else {
        nextDay(c);
        this.save();
        this.hub();
      }
    };
  }

  private finishRace(race: Race, field: Entrant[]) {
    const c = this.career!;
    const entry = c.race!;
    const rows = standings(race, field, entry.dq ? Math.max(1, entry.raceDay + 1) : race.days);
    const me = rows.find((r) => r.entrant.player)!;
    c.results.push({ raceId: race.id, season: c.season, position: entry.dq ? null : me.rank, of: rows.filter((r) => r.rank !== null).length, total: me.total, net: me.net });
    c.race = null;
    const wonGN = race.id === 'grand-national' && me.rank === 1 && !entry.dq;
    if (wonGN) c.gnWon = true;
    nextDay(c);
    this.save();
    if (wonGN)
      return this.modal(
        'Winner of the Grand National',
        `${RIDERS[c.rider].name} has won the Grand National, the oldest race on the Cresta, on scratch from Top. Your name goes up on the board in the clubhouse, and everyone at the Sunny Bar wants to buy you a drink.<br><br>The run is yours: ride on as long as you like.`,
        [{ label: 'Viva la Cresta!', primary: true, run: () => this.hub() }],
      );
    const text = entry.dq ? 'Disqualified after a fall. There is always the next race.' : `${ordinal(me.rank!)} of ${rows.filter((r) => r.rank !== null).length}${race.kind === 'handicap' ? ` on net time (${me.net!.toFixed(2)})` : ` in ${me.total!.toFixed(2)}`}.`;
    this.modal(race.name, text, [{ label: 'Back to the clubhouse', primary: true, run: () => this.hub() }]);
  }

  private abandonRace() {
    const c = this.career!;
    if (!c.race) return;
    c.results.push({ raceId: c.race.raceId, season: c.season, position: null, of: 0, total: null, net: null });
    c.race = null;
  }

  // ---------- The Tower's results sheet ----------

  private sheet(race: Race, field: Entrant[], day: number, seasonDay: number) {
    const rows = standings(race, field, day + 1);
    const handicapRace = race.kind === 'handicap';
    const multi = race.days > 1;
    const dayName = multi ? (day === 0 ? 'FIRST DAY' : 'SECOND DAY') : '';
    const fmt = (t: number | null | undefined, fallAt?: string) => (t === null ? `Fall(${fallAt ?? 'S'})` : t === undefined ? '' : t.toFixed(2));
    const head = `<tr><th></th><th></th><th></th>${handicapRace ? '<th>H’cap</th>' : ''}<th>1st</th><th>2nd</th><th>3rd</th><th>${handicapRace ? 'Net Total' : multi && day > 0 ? 'Aggregate' : 'Total'}</th></tr>`;
    const body = rows
      .map((r) => {
        const e = r.entrant;
        const times = e.times[day] ?? [];
        const cells = [0, 1, 2].map((k) => `<td>${fmt(times[k], e.fallAt)}</td>`).join('');
        const value = r.net !== null ? r.net.toFixed(2) : '';
        return `<tr class="${e.player ? 'me' : ''}"><td>${r.rank ?? ''}</td><td class="name">${e.name}</td><td>${e.nation}</td>${handicapRace ? `<td>${e.handicap === 0 ? 'Scr' : e.handicap.toFixed(2)}</td>` : ''}${cells}<td>${value}</td></tr>`;
      })
      .join('');
    const fastest = fastestOfDay(field, day);
    const of = multi ? ` of ${day === 0 ? 'First' : 'Second'} Day` : ' of Race';
    const next = upcoming(seasonDay, 1)[0];
    const tomorrow = multi && day + 1 < race.days ? `${race.name.toUpperCase()} (Second Day)` : next ? `${next.name.toUpperCase()} on ${dateOf(next.day).label}` : 'PRACTICE';
    $('sheet-paper').innerHTML = `
      <div class="sheet-club">CRESTA RUN</div>
      <div class="sheet-race">${race.name.toUpperCase()}</div>
      ${race.note ? `<div class="sheet-note">${race.note}</div>` : ''}
      <div class="sheet-start">(${race.start === 'top' ? 'Top' : 'Junction'}${handicapRace ? ', Handicap' : ''})</div>
      <div class="sheet-date">${dateOf(seasonDay).label} 2026</div>
      ${dayName ? `<div class="sheet-day">${dayName}:</div>` : ''}
      <table>${head}${body}</table>
      <div class="sheet-foot">
        ${fastest.time ? `<div>Fastest Time${of}: ${fastest.time[0]} ${fastest.time[1].toFixed(2)}</div>` : ''}
        ${fastest.speed ? `<div>Fastest Speed${of}: ${fastest.speed[0]} ${fastest.speed[1].toFixed(2)} mph</div>` : ''}
        <div class="sheet-next">TOMORROW ${tomorrow}</div>
      </div>`;
    $('sheet').hidden = false;
    $('sheet-paper').scrollTop = 0;
  }

  // ---------- A card with buttons ----------

  private modal(title: string, html: string, buttons: { label: string; primary?: boolean; run: () => void }[]) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = html;
    const row = $('modal-buttons');
    row.replaceChildren(
      ...buttons.map((b) => {
        const el = document.createElement('button');
        el.textContent = b.label;
        if (b.primary) el.className = 'primary';
        el.addEventListener('click', () => {
          $('modal').hidden = true;
          b.run();
        });
        return el;
      }),
    );
    $('modal').hidden = false;
  }
}

function describe(s: Setup): string {
  const where = s.start === 'top' ? 'Top' : 'Junction';
  const style = s.style === 'lying' ? 'lying start' : s.steps < 7 ? `running start, ${s.steps} steps` : 'running start';
  return `${where} · ${style}${s.toboggan === 'flattop' ? ' · flat-top' : ''}`;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

