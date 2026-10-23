import { describe, expect, it } from 'vitest'
import { getUserDisplayName } from '../lib/errors.js'

describe('profile fallback regression', () => {
  it.each([
    ['missing-profile', {}],
    ['null-profile', { profile: null }],
    ['null-user', null],
    ['undefined-user', undefined],
  ])('%s returns Anonymous', (_caseId, user) => {
    expect(getUserDisplayName(user)).toBe('Anonymous')
  })
})
