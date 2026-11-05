// @ts-check
// The GitHub Pages demo as a visitor meets it: no backend, the API in a service worker, served like Pages
// (a copy of index.html per route, 404.html for a route with a parameter). pages.yml deploys only if this passes.
import { expect, test } from '@playwright/test'

const DEAL = 'Tapti Logistics: label printers'
const DEAL_VALUE = 125000
/** "₹54,32,000" or "₹5,432,000" -> 5432000, whatever the browser's grouping. */
const amount = (text) => Number(text.replace(/[^\d]/g, ''))

test('sign in as the Sales Manager, close a deal as Won from the Pipeline, the Dashboard follows', async ({ page }) => {
  const openPipeline = () => page.getByRole('group', { name: 'Open pipeline value' })
  let before = 0

  await test.step('sign in with the demo button; the banner is on every page', async () => {
    await page.goto('login')
    await expect(page.getByRole('note', { name: 'Demo mode' })).toContainText('data stays in your browser')
    await page.getByRole('button', { name: 'Try as Sales Manager' }).click()
    await expect(page).toHaveURL(/\/AI-CRM\/?$/)
    await expect(openPipeline()).toContainText('₹')
    before = amount(await openPipeline().innerText())
  })

  await test.step('Reports: 4 deals won', async () => {
    await page.getByRole('button', { name: 'Reports' }).click()
    await expect(page.getByRole('group', { name: 'Deals won' })).toContainText('4')
  })

  await test.step('Pipeline: move a deal to Closed Won', async () => {
    await page.getByRole('link', { name: 'Pipeline' }).click()
    await expect(page).toHaveURL(/\/AI-CRM\/deals$/)
    // The URL changes before the lazy Pipeline chunk renders; wait for the page itself.
    await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible()
    await page.getByText(DEAL).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Stage').selectOption('won')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('row', { name: new RegExp(DEAL) })).toContainText('Closed Won')
  })

  await test.step('Dashboard: one more win, and the open pipeline is smaller by its value', async () => {
    await page.getByRole('link', { name: 'Dashboard' }).click()
    await expect.poll(async () => amount(await openPipeline().innerText())).toBe(before - DEAL_VALUE)
    await page.getByRole('button', { name: 'Reports' }).click()
    await expect(page.getByRole('group', { name: 'Deals won' })).toContainText('5')
  })
})

for (const path of ['pipeline', 'deals']) {
  test(`a hard reload of /AI-CRM/${path} loads the app with status 200`, async ({ page }) => {
    // First visit straight to the deep link: Pages answers with the route's copy of index.html.
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible()
    await expect(page).toHaveURL(/\/AI-CRM\/deals$/)

    // Shift+reload: the browser bypasses the service worker; MSW re-registers and the app still talks to it.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Page.reload', { ignoreCache: true })
    await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible()
    await expect(page.getByRole('note', { name: 'Demo mode' })).toBeVisible()

    // And the API is answered: sign in from here and the deals load.
    await page.getByRole('link', { name: 'Log in' }).first().click()
    await page.getByRole('button', { name: 'Try as Member' }).click()
    await page.getByRole('link', { name: 'Pipeline' }).click()
    await expect(page.getByText(DEAL)).toBeVisible()
  })
}

test('a hard reload of a route with a parameter still loads the app, through 404.html', async ({ page }) => {
  // /leads/:id can't have a file of its own, so Pages answers 404 with the app (scripts/pages-routes.mjs).
  const response = await page.goto(`leads/${'0'.repeat(24)}`)
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('note', { name: 'Demo mode' })).toBeVisible()
})
