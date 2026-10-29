// Riders to unlock, and what unlocks each: wins in any career on this device. Once earned they
// stay, even if that career is deleted.

import { STARTERS, type RiderId } from '../sim/rider';
import type { Career } from './career';
import { loadSaves } from './saves';

const won = (c: Career, raceId: string) => c.results.some((r) => r.raceId === raceId && r.position === 1);

export const UNLOCKS: Partial<Record<RiderId, { how: string; test: (c: Career) => boolean }>> = {
  kletus: {
    how: 'winning three races in one season',
    test: (c) => {
      const bySeason = new Map<number, number>();
      for (const r of c.results) if (r.position === 1) bySeason.set(r.season, (bySeason.get(r.season) ?? 0) + 1);
      return [...bySeason.values()].some((n) => n >= 3);
    },
  },
  mario: { how: "winning the Coppa d'Italia", test: (c) => won(c, 'coppa-italia') },
  darklord: {
    how: 'winning the Curzon Cup, the Morgan Cup, the Brabazon Trophy and the Grand National',
    test: (c) => ['curzon', 'morgan', 'brabazon', 'grand-national'].every((id) => won(c, id)),
  },
};

const KEY = 'vlc-unlocked';

function stored(): RiderId[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function store(ids: RiderId[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable: unlocked for this session only */
  }
}

/** Everyone who can be chosen: the starters and every rider unlocked so far. */
export function unlockedRiders(careers: Career[] = loadSaves()): Set<RiderId> {
  const out = new Set<RiderId>([...STARTERS, ...stored()]);
  for (const [id, u] of Object.entries(UNLOCKS) as [RiderId, NonNullable<(typeof UNLOCKS)[RiderId]>][]) {
    if (careers.some(u.test)) out.add(id);
  }
  return out;
}

/** After a race: the riders this career has just unlocked (kept from now on). */
export function noteUnlocks(c: Career): RiderId[] {
  const before = unlockedRiders(loadSaves().filter((x) => x.id !== c.id));
  const fresh = (Object.entries(UNLOCKS) as [RiderId, NonNullable<(typeof UNLOCKS)[RiderId]>][]).filter(([id, u]) => !before.has(id) && u.test(c)).map(([id]) => id);
  if (fresh.length) store([...new Set([...stored(), ...fresh])]);
  return fresh;
}
