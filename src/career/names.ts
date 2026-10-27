// Names for the NPC riders: random initials with surnames (and their nations) after those on the
// Tower's results sheets, each one changed a little (Achenbach to Ochenbuch, Lloyd to Floyd), so the
// fields read like the real thing without naming real people.

export const SURNAMES: [string, string][] = [
  ['Ochenbuch', 'USA'], ['Ohrens', 'D'], ['Albers-Scheinburg', 'ESP'], ['Bornes', 'GB'], ['Burdwold', 'GB'], ['Corromio-Odese', 'I'],
  ['Boff', 'GB'], ['Brain-Smythe', 'GB'], ['Buelti', 'CH'], ['Puff', 'CH'], ['Corrall', 'GB'], ['Chovaux', 'IRL'],
  ['Clarte', 'GB'], ['Clove', 'GB'], ['Colcleigh', 'GB'], ['Creech-Cowan', 'GB'], ['Curtin-Dunnolly', 'GB'], ['Diethalm', 'CH'],
  ['Edmards', 'GB'], ['Evins', 'GB'], ['Forrari', 'I'], ['Figgle', 'GB'], ['Fascher', 'I'], ['Fester', 'GB'],
  ['Groom', 'GB'], ['Gollagher', 'GB'], ['Gallmonn', 'CH'], ['Giordani', 'I'], ['Guerrino-Moraldi', 'I'], ['Harmood', 'GB'],
  ['Hillery', 'GB'], ['Hutz', 'CH'], ['Hutz-Vess', 'CH'], ['Holmen-Weston', 'GB'], ['Hösch', 'CH'], ['Jacot', 'CDN'],
  ['Jonkovich', 'ZA'], ['Jowns', 'GB'], ['Kelby', 'GB'], ['Kitsome', 'GB'], ['Briemler', 'CH'], ['Küeng', 'CH'],
  ['Floyd', 'USA'], ['Luethy', 'CH'], ['Moag', 'CH'], ['MacDonnell', 'GB'], ['Mallingroth', 'GB'], ['Morenzi', 'CH'],
  ['Mastersen', 'GB'], ['McNear', 'GB'], ['Mendelsham', 'GB'], ['Morrin', 'GB'], ['Nakamaji', 'J'], ['Noni', 'CH'],
  ['Osmald', 'CH'], ['Pocke-Drewry-Lowell', 'GB'], ['Paine', 'GB'], ['Pinzo', 'I'], ['Pieter', 'CH'], ['Pirandi', 'GT'],
  ['Patsch', 'CH'], ['Pittoni', 'GB'], ['Read', 'GB'], ['Rantsch', 'CH'], ['Robison', 'GB'], ['Röhlung', 'D'],
  ['Rowling-Rose', 'GB'], ['Rasch', 'CH'], ['Schoer', 'CH'], ['Schlumbarger', 'GT'], ['Schmed', 'D'], ['Schmitt', 'CH'],
  ['Sheperton', 'GB'], ['Shippard', 'GB'], ['Smelley', 'GB'], ['Cottomenor Matosa', 'P'], ['Spoutz', 'L'], ['Spellmann', 'CH'],
  ['Stüdli', 'CH'], ['Sommers', 'GB'], ['Tampel', 'D'], ['Townsley', 'GB'], ['Villers-Smyth', 'GB'], ['Vitolini', 'CH'],
  ['Wakeman', 'GB'], ['Witherly', 'GB'], ['Wickins', 'GB'], ['Zoch', 'P'], ['Zeros', 'GR'],
];

const INITIALS = 'AABBCCDEEFGGHHIJJJKLLMMMNOPPRRSSTTVWXYZ';

/** A rider's name as the sheets print it: "A.W.F. Surname", now and then with a title. */
export function npcName(rand: () => number): { name: string; nation: string } {
  const [surname, nation] = SURNAMES[Math.floor(rand() * SURNAMES.length)];
  const n = 1 + Math.floor(rand() * 3);
  let initials = '';
  for (let i = 0; i < n; i++) initials += `${INITIALS[Math.floor(rand() * INITIALS.length)]}.`;
  const title = rand() < 0.012 ? pickTitle(rand) : '';
  return { name: `${title}${initials} ${surname}`, nation };
}

function pickTitle(rand: () => number) {
  return rand() < 0.5 ? 'Count ' : 'Baron ';
}
