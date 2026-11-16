/**
 * Word filter for usernames (SPEC 9.3). Entries are written in the NORMALIZED form
 * (lower case, letters only, leetspeak resolved): a name is blocked if one entry occurs
 * as a substring of its normalized form. Keep entries long enough to avoid false positives
 * (no "ass", "arsch", "sex": "Assassine", "Marsch" must stay allowed).
 */
export const BLOCKED_NAMES: readonly string[] = [
  // English insults
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'nigger',
  'nigga',
  'faggot',
  'whore',
  'slut',
  'bastard',
  'asshole',
  'dickhead',
  'wanker',
  'retard',
  'pussy',
  'cocksucker',
  'motherfucker',
  // German insults
  'arschloch',
  'wichser',
  'hurensohn',
  'fotze',
  'scheisse',
  'schlampe',
  'missgeburt',
  'spast',
  'ficker',
  'ficken',
  'neger',
  'kanake',
  'schwuchtel',
  'behindert',
  // Sexual, violent, political
  'porn',
  'penis',
  'vagina',
  'dildo',
  'rapist',
  'nazi',
  'hitler',
  // Roles and operator names
  'admin',
  'moderator',
  'support',
  'rumblerealms',
];
