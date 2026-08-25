/*
 * BRAND PALETTE — Naturals logos (cream / white / black).
 *
 * The three values below were sampled from the company's Naturals logo files.
 * The app's previous blue/black/white scheme matched none of the logos.
 *
 *   ink    #1A091B   the logo "black" — a very dark purple-black
 *   cream  #E6DBB9
 *   white  #FFFFFF
 *
 * `blue` and `indigo` are OVERRIDDEN on purpose. There are ~1,800 blue-family
 * utility classes across ~65 files; re-pointing the two palettes recolours all
 * of the decorative ones at once instead of touching every file. Sites where
 * blue/indigo carried MEANING inside a set of contrasting sibling colours were
 * migrated first onto sky / cyan / teal / violet, which are deliberately NOT
 * overridden — see the status pills, category ladders, and the user-chosen
 * colour maps in Schedule.js / KnowledgeBase.js / PublicBookingPage.js.
 *
 * indigo is the Work/staff portal's accent mirroring blue in the athlete
 * portal. The owner asked for one accent family, so both get the same ramp; the
 * one place that distinction was load-bearing (NotificationBell's portal tag)
 * now separates the two by fill/text inversion instead of by hue.
 *
 * Anything still referencing `slate-*` is intentionally untouched: slate reads
 * as a neutral grayed blue and must stay neutral (the "Paused" labels).
 */

const BRAND_RAMP = {
  50:  '#F8F3E7',
  100: '#EFE5CE',
  200: '#E6DBB9', // cream
  300: '#CFC29E',
  400: '#9A8C86',
  500: '#4E3C50',
  600: '#2C1B2E',
  700: '#221424',
  800: '#1A091B', // ink
  900: '#120612',
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        blue: BRAND_RAMP,
        indigo: BRAND_RAMP,
        brand: {
          ink: '#1A091B',
          cream: '#E6DBB9',
          white: '#FFFFFF',
          ...BRAND_RAMP,
        },
      },
    },
  },
  plugins: [],
}
