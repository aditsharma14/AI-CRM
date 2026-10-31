// The one password rule (validators.js `password`): at least 8 characters, not only whitespace, at most 72 UTF-8 bytes
// (bcrypt ignores the rest), applied by every endpoint that sets a password. Login and existing passwords are unaffected.
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'

import app from '../src/app.js'
import User from '../src/models/User.js'
import { acceptInvite, registerOrg, resetPassword } from '../src/schemas/auth.js'
import { passwordChange } from '../src/schemas/org.js'
import { password as passwordRule } from '../src/utils/validators.js'
import { createUserWithPassword, issueInvite, issueResetToken, login } from './factories.js'
import { bearer, seedOrg } from './helpers.js'

const api = '/api/v1'
const bytes = (s) => Buffer.byteLength(s, 'utf8')

// [description, password, accepted, issue message when refused]. The frontend mirrors this table (lib/password.test.js).
// Spelled out: a literal one is invisible, and tooling may turn the escape into one.
const NBSP = String.fromCodePoint(0xa0)

const CASES = [
  ['7 characters', 'a'.repeat(7), false, 'must be at least 8 characters'],
  ['8 characters', 'a'.repeat(8), true],
  ['8 spaces', ' '.repeat(8), false, 'must not be only whitespace'],
  ['tabs, newlines and a no-break space', `\t\n ${NBSP}\t\n ${NBSP}`, false, 'must not be only whitespace'],
  ['spaces around a real password (kept, not trimmed)', '  pass word  ', true],
  ['72 ASCII bytes', 'a'.repeat(72), true],
  ['73 ASCII bytes', 'a'.repeat(73), false, 'must be at most 72 bytes'],
  ['68 ASCII + one 4-byte emoji = 72 bytes', `${'a'.repeat(68)}😀`, true],
  [
    '69 ASCII + one 4-byte emoji = 73 bytes (only 70 characters)',
    `${'a'.repeat(69)}😀`,
    false,
    'must be at most 72 bytes',
  ],
  ['36 × é = 72 bytes', 'é'.repeat(36), true],
  ['37 × é = 74 bytes (only 37 characters)', 'é'.repeat(37), false, 'must be at most 72 bytes'],
  ['4 emoji: 8 UTF-16 units but 4 characters', '😀'.repeat(4), false, 'must be at least 8 characters'],
  ['8 emoji = 32 bytes', '😀'.repeat(8), true],
]

describe('the byte arithmetic the cases rely on', () => {
  it('measures what the case names say', () => {
    expect(bytes(`${'a'.repeat(68)}😀`)).toBe(72)
    expect(bytes(`${'a'.repeat(69)}😀`)).toBe(73)
    expect(bytes('é'.repeat(36))).toBe(72)
    expect('😀'.repeat(4)).toHaveLength(8)
  })
})

describe('every schema that sets a password uses the shared rule', () => {
  it.each([
    ['register-org', registerOrg.shape.password],
    ['accept-invite', acceptInvite.shape.password],
    ['reset-password', resetPassword.shape.password],
    ['change password', passwordChange.shape.newPassword],
  ])('%s', (_, field) => expect(field).toBe(passwordRule))
})

let A
beforeEach(async () => {
  A = await seedOrg('A')
})

// Each endpoint sets a password from scratch; `field` is the body key the issue is reported under.
const ENDPOINTS = [
  {
    name: 'POST /auth/register-org',
    field: 'password',
    send: (pw) =>
      request(app)
        .post(`${api}/auth/register-org`)
        .send({ orgName: 'Pw Org', name: 'Pat', email: `pat.${Math.random()}@pw.test`, password: pw }),
  },
  {
    name: 'POST /auth/accept-invite',
    field: 'password',
    send: async (pw) => {
      const email = `ivy.${Math.random()}@pw.test`
      const token = await issueInvite(A.org._id, { email, role: 'member' })
      return request(app).post(`${api}/auth/accept-invite`).send({ token, name: 'Ivy', password: pw })
    },
  },
  {
    name: 'POST /auth/reset-password',
    field: 'password',
    send: async (pw) => {
      const { user } = await createUserWithPassword(A.org)
      const token = await issueResetToken(user._id)
      return request(app).post(`${api}/auth/reset-password`).send({ token, password: pw })
    },
  },
  {
    name: 'PATCH /org/me/password',
    field: 'newPassword',
    send: async (pw) => {
      const { email, password } = await createUserWithPassword(A.org)
      const { accessToken } = await login(email, password)
      return request(app)
        .patch(`${api}/org/me/password`)
        .set(bearer(accessToken))
        .send({ currentPassword: password, newPassword: pw })
    },
  },
]

describe.each(ENDPOINTS)('$name', ({ field, send }) => {
  it.each(CASES)('%s', async (_, pw, accepted, message) => {
    const res = await send(pw)
    if (accepted) {
      expect(res.status).toBeLessThan(300)
    } else {
      expect(res.status).toBe(400)
      expect(res.body.error).toEqual({ code: 'VALIDATION_ERROR', message: `${field}: ${message}` })
    }
  })
})

describe('the stored password is exactly what was sent', () => {
  it('surrounding spaces are kept: the exact value logs in, the trimmed one does not', async () => {
    const { user } = await createUserWithPassword(A.org)
    const token = await issueResetToken(user._id)
    await request(app).post(`${api}/auth/reset-password`).send({ token, password: '  pass word  ' }).expect(200)

    await expect(login(user.email, '  pass word  ')).resolves.toBeTruthy()
    await expect(login(user.email, 'pass word')).rejects.toThrow('401')
  })
})

describe('existing users are unaffected (the rule applies only when setting a password)', () => {
  it.each([
    ['8 spaces', ' '.repeat(8)],
    ['73 bytes', 'a'.repeat(73)],
  ])('a stored %s password still logs in', async (_, old) => {
    // Written straight to the model, as an account created before the rule would be.
    const { email } = await createUserWithPassword(A.org, { password: old })
    await expect(login(email, old)).resolves.toBeTruthy()
    expect(await User.countDocuments({ email })).toBe(1)
  })
})
