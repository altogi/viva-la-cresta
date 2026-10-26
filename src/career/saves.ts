// Saved games, kept in the browser's storage. Each save is one career.

import type { Career } from './career';

const KEY = 'vlc-careers';

export function loadSaves(): Career[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Career[];
    // Saves from before a field existed get its starting value.
    return Array.isArray(list) ? list.map((c) => ({ ...c, tutorialStep: c.tutorialStep ?? 0 })).sort((a, b) => b.lastPlayed - a.lastPlayed) : [];
  } catch {
    return [];
  }
}

export function storeCareer(career: Career) {
  const list = loadSaves().filter((c) => c.id !== career.id);
  list.push(career);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: the career lasts this session only */
  }
}

export function deleteCareer(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadSaves().filter((c) => c.id !== id)));
  } catch {
    /* nothing to delete */
  }
}

/** The next free "Game N" name. */
export function nextGameName(): string {
  const used = new Set(loadSaves().map((c) => c.name));
  let n = 1;
  while (used.has(`Game ${n}`)) n++;
  return `Game ${n}`;
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
