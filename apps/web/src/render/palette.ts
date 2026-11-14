/** All colours of the renderer as 0xRRGGBB numbers (SPEC 11). Keep them in sync with styles.css. */
export const PALETTE = {
  outline: 0x14172e,

  /** Team colours: [main, dark, light]. */
  teamOwn: { main: 0x3b78f0, dark: 0x1d3f9c, light: 0x8fb8ff },
  teamEnemy: { main: 0xff6a2b, dark: 0xb23a0c, light: 0xffb27a },

  skin: 0xf6c58f,
  skinDark: 0xd99a62,
  cream: 0xfff6d6,
  white: 0xffffff,
  bone: 0xf1ead2,
  boneDark: 0xc9bd98,
  steel: 0xc5ccdb,
  steelDark: 0x8791aa,
  gold: 0xffc83a,
  wood: 0xa4642c,
  woodDark: 0x6e3f18,
  leather: 0x7a4a26,
  purple: 0x5a3a78,
  purpleLight: 0x8a63ad,
  hair: 0x6b3f22,
  beard: 0xe0a93a,
  grayDark: 0x3a3f58,
  red: 0xe23d3d,
  green: 0x3fc46a,
  fire: 0xff9d1c,
  fireLight: 0xffee6a,
  mushroomStalk: 0xf3deb5,

  /** Harness only. */
  fieldGreen: 0x5fae52,
  fieldGreenDark: 0x4d9a45,
} as const;

export type TeamColors = { main: number; dark: number; light: number };
