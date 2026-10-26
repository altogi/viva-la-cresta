// The chosen rider and toboggan, remembered on this device.

import { RIDERS, TOBOGGANS, type RiderId, type TobogganId } from '../sim/rider';

export interface Selection {
  rider: RiderId;
  toboggan: TobogganId;
}

const KEY = 'vlc-selection';

export function loadSelection(): Selection {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Selection> | null;
    if (saved && saved.rider && saved.rider in RIDERS && saved.toboggan && saved.toboggan in TOBOGGANS) {
      return { rider: saved.rider, toboggan: saved.toboggan };
    }
  } catch {
    /* storage unavailable or corrupt: fall back to the default */
  }
  return { rider: 'adelaide', toboggan: 'traditional' };
}

export function saveSelection(selection: Selection) {
  try {
    localStorage.setItem(KEY, JSON.stringify(selection));
  } catch {
    /* storage unavailable: the choice lasts this session only */
  }
}
