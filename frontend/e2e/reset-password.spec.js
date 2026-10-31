// @ts-check
// Password reset through the real UI and API: ask for a link, use it, and every old session is signed out.
import { expect, test } from '@playwright/test'

// backend/scripts/e2e-server.js's loopback control port: plants a reset token as the backend tests do (hash stored,
// raw token returned), so the spec never reads the dev-only reset-link log.
const CONTROL = 'http://127.0.0.1:5056'

test('forgot password → reset with the emailed link → old sessions signed out → new password works', async ({
  page,
  browser,
  request,
}) => {
  const stamp = Date.now()
  const email = `reset.${stamp}@e2e.test`
  const oldPassword = 'old-horse-battery'
  const newPassword = 'new-horse-battery'

  await test.step('register: this tab holds a session from the old password', async () => {
    await page.goto('/register')
    await page.getByLabel('Organization name').fill(`Reset Org ${stamp}`)
    await page.getByLabel('Your name').fill('Riley Reset')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(oldPassword)
    await page.getByRole('button', { name: /create/i }).click()
    await expect(page).toHaveURL('/')
  })

  // A second browser context: another device, with no cookies from the first.
  const otherDevice = await browser.newContext()
  const other = await otherDevice.newPage()

  await test.step('ask for a reset link from the sign-in page', async () => {
    await other.goto('/login')
    await other.getByRole('link', { name: 'Forgot password?' }).click()
    await other.getByLabel('Email').fill(email)
    await other.getByRole('button', { name: 'Send reset link' }).click()
    await expect(other.getByRole('status')).toContainText(`If an account exists for ${email}`)
  })

  const res = await request.post(`${CONTROL}/reset-token`, { data: { email } })
  expect(res.ok()).toBe(true)
  const { token } = await res.json()

  await test.step('open the link: the token leaves the address bar; set a new password', async () => {
    await other.goto(`/reset-password?token=${token}`)
    await expect(other.getByLabel('New password', { exact: true })).toBeVisible()
    expect(new URL(other.url()).search).toBe('')

    await other.getByLabel('New password', { exact: true }).fill(newPassword)
    await other.getByLabel('Confirm new password').fill(newPassword)
    await other.getByRole('button', { name: 'Set new password' }).click()

    await expect(other).toHaveURL('/login')
    await expect(other.getByRole('status')).toHaveText('Password changed. Sign in with your new password.')
  })

  await test.step('the old password no longer signs in', async () => {
    await other.getByLabel('Email').fill(email)
    await other.getByLabel('Password').fill(oldPassword)
    await other.getByRole('button', { name: 'Sign in' }).click()
    await expect(other.getByRole('alert')).toHaveText('Invalid email or password.')
  })

  await test.step('the new password does', async () => {
    await other.getByLabel('Password').fill(newPassword)
    await other.getByRole('button', { name: 'Sign in' }).click()
    await expect(other).toHaveURL('/')
  })

  await test.step('the first tab was signed out: its refresh token was revoked by the reset', async () => {
    const refresh = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/refresh'))
    await page.reload()
    expect((await refresh).status()).toBe(401)
    await expect(page.getByText(/browsing Clarion without an account/)).toBeVisible()
  })

  await test.step('the same link cannot be used twice', async () => {
    await other.goto(`/reset-password?token=${token}`)
    await other.getByLabel('New password', { exact: true }).fill('third-horse-battery')
    await other.getByLabel('Confirm new password').fill('third-horse-battery')
    await other.getByRole('button', { name: 'Set new password' }).click()
    await expect(other.getByRole('heading', { name: 'This reset link has expired' })).toBeVisible()
  })

  await otherDevice.close()
})
