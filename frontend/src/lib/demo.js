// @ts-check
// Where the GitHub Pages demo (src/demo/, loaded only when VITE_DEMO=true) plugs its banner and sign-in buttons into
// the app. The app never imports src/demo/ itself, so a normal build contains none of it.

/**
 * @typedef {object} DemoUi
 * @property {import('react').ComponentType | null} Banner Shown above every page.
 * @property {import('react').ComponentType | null} SignIn Shown on the sign-in page.
 */

/** @type {DemoUi} */
let ui = { Banner: null, SignIn: null }

/** @param {DemoUi} next */
export function registerDemoUi(next) {
  ui = next
}

/** @returns {DemoUi} */
export function demoUi() {
  return ui
}
