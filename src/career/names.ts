// Names for the NPC riders: random initials with surnames (and their nations) taken from the
// Tower's results sheets, so the fields read like the real thing without being real people.

export const SURNAMES: [string, string][] = [
  ['Achenbach', 'USA'], ['Ahrens', 'D'], ['Albers-Schoenberg', 'ESP'], ['Barnes', 'GB'], ['Birdwood', 'GB'], ['Borromeo Arese', 'I'],
  ['Bott', 'GB'], ['Brayn-Smith', 'GB'], ['Buelte', 'CH'], ['Buff', 'CH'], ['Carroll', 'GB'], ['Chauveau', 'IRL'], ['Clark', 'GB'],
  ['Clive', 'GB'], ['Colclough', 'GB'], ['Creagh-Coen', 'GB'], ['Curtis-Donnelly', 'GB'], ['Diethelm', 'CH'], ['Edwards', 'GB'],
  ['Evans', 'GB'], ['Ferrari', 'I'], ['Figgis', 'GB'], ['Fischer', 'I'], ['Foster', 'GB'], ['Froom', 'GB'], ['Gallagher', 'GB'],
  ['Gallmann', 'CH'], ['Giardini', 'I'], ['Guerrini-Maraldi', 'I'], ['Harwood', 'GB'], ['Hilleary', 'GB'], ['Hitz', 'CH'],
  ['Hitz-Vass', 'CH'], ['Holman-West', 'GB'], ['Hosch', 'CH'], ['Jacob', 'CDN'], ['Jankovich', 'ZA'], ['Jones', 'GB'], ['Kelly', 'GB'],
  ['Kitson', 'GB'], ['Kriemler', 'CH'], ['Kueng', 'CH'], ['Lloyd', 'USA'], ['Luethi', 'CH'], ['Maag', 'CH'], ['MacDonald', 'GB'],
  ['Mallinckrodt', 'GB'], ['Marenzi', 'CH'], ['Masterson', 'GB'], ['McNair', 'GB'], ['Mendelsohn', 'GB'], ['Morris', 'GB'],
  ['Nakajima', 'J'], ['Nani', 'CH'], ['Oswald', 'CH'], ['Packe-Drury-Lowe', 'GB'], ['Payne', 'GB'], ['Penzo', 'I'], ['Peter', 'CH'],
  ['Pirani', 'GT'], ['Pitsch', 'CH'], ['Pitto', 'GB'], ['Reid', 'GB'], ['Rentsch', 'CH'], ['Robinson', 'GB'], ['Roehling', 'D'],
  ['Rowland-Rouse', 'GB'], ['Rusch', 'CH'], ['Schaer', 'CH'], ['Schlumberger', 'GT'], ['Schmid', 'D'], ['Schmidt', 'CH'],
  ['Shepherd', 'GB'], ['Sheppard', 'GB'], ['Smalley', 'GB'], ['Sotto Mayor Matoso', 'P'], ['Spautz', 'L'], ['Spillmann', 'CH'],
  ['Stuedi', 'CH'], ['Summers', 'GB'], ['Tempel', 'D'], ['Townley', 'GB'], ['Villiers-Smith', 'GB'], ['Vitalini', 'CH'],
  ['Wakeham', 'GB'], ['Whetherly', 'GB'], ['Wickens', 'GB'], ['Zach', 'P'], ['Ziros', 'GR'],
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
