import { describe, it, expect } from 'vitest'
import { valueOrEmptyString, wrapValueWithComma } from './utils.js'

describe('utils', () => {
  describe('valueOrEmptyString', () => {
    it('should return empty string for null', () => {
      expect(valueOrEmptyString(null)).toBe('')
    })

    it('should return empty string for undefined', () => {
      expect(valueOrEmptyString(undefined)).toBe('')
    })

    it('should return the value if it is not null or undefined', () => {
      expect(valueOrEmptyString('hello')).toBe('hello')
      expect(valueOrEmptyString(123)).toBe(123)
      expect(valueOrEmptyString(true)).toBe(true)
      expect(valueOrEmptyString(false)).toBe(false)
      expect(valueOrEmptyString(0)).toBe(0)
    })
  })

  describe('wrapValueWithComma', () => {
    it('should return empty string for null or undefined', () => {
      expect(wrapValueWithComma(null)).toBe('')
      expect(wrapValueWithComma(undefined)).toBe('')
    })

    it('should return the string if it does not contain a comma', () => {
      expect(wrapValueWithComma('hello')).toBe('hello')
    })

    it('should wrap the string in double quotes if it contains a comma', () => {
      expect(wrapValueWithComma('hello, world')).toBe('"hello, world"')
    })

    it('should return the boolean value as a string (failing case before fix)', () => {
      expect(wrapValueWithComma(true)).toBe('true')
      expect(wrapValueWithComma(false)).toBe('false')
    })

    it('should return other types as they are (e.g. numbers)', () => {
      expect(wrapValueWithComma(123)).toBe(123)
    })
  })
})
