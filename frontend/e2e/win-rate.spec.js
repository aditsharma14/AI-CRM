// @ts-check
// The core sales loop through the real UI and API: register an org, create a lead, convert it, win the deal, see the win rate move.
import { expect, test } from '@playwright/test'

test('register → create lead → convert → move deal to Won → dashboard win rate updates', async ({ page }) => {
  // Unique per run; the API's database is fresh each run anyway, this just keeps reruns honest.
  const stamp = Date.now()
  const leadName = `Acme renewal ${stamp}`

  await test.step('register an org and land on the dashboard as its owner', async () => {
    await page.goto('/register')
    await page.getByLabel('Organization name').fill(`E2E Org ${stamp}`)
    await page.getByLabel('Your name').fill('Erin Owner')
    await page.getByLabel('Email').fill(`owner.${stamp}@e2e.test`)
    await page.getByLabel('Password').fill('correct-horse-battery')
    await page.getByRole('button', { name: /create/i }).click()
    await expect(page).toHaveURL('/')
  })

  const nav = page.getByRole('navigation').first()
  const winRate = page.getByRole('group', { name: 'Win rate' })

  await test.step('no closed deals yet: win rate is empty', async () => {
    await page.getByRole('button', { name: 'Reports' }).click()
    await expect(winRate).toContainText('—')
  })

  await test.step('create a lead', async () => {
    await nav.getByRole('link', { name: 'Leads' }).click()
    await page.getByRole('button', { name: 'New lead' }).click()
    const dialog = page.getByRole('dialog', { name: 'New lead' })
    await dialog.getByLabel('Name').fill(leadName)
    await dialog.getByRole('button', { name: 'Create' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('cell', { name: leadName })).toBeVisible()
  })

  await test.step('convert it to a deal', async () => {
    await page.getByRole('cell', { name: leadName }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit lead' })
    await dialog.getByRole('button', { name: 'Convert to deal' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('row', { name: new RegExp(leadName) })).toContainText('converted')
  })

  await test.step('move the deal to Closed Won', async () => {
    await nav.getByRole('link', { name: 'Pipeline' }).click()
    await page.getByRole('cell', { name: leadName }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit deal' })
    await dialog.getByLabel('Stage').selectOption({ label: 'Closed Won' })
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('row', { name: new RegExp(leadName) })).toContainText('Closed Won')
  })

  await test.step('the dashboard counts the win', async () => {
    await nav.getByRole('link', { name: 'Dashboard' }).click()
    await page.getByRole('button', { name: 'Reports' }).click()
    await expect(winRate).toContainText('100%')
    await expect(page.getByRole('group', { name: 'Deals won' })).toContainText('1')
  })
})
