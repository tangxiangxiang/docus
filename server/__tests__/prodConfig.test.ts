import { describe, expect, it } from 'vitest'
import { DEFAULT_HOST, resolveServerHost } from '../prodConfig'

describe('resolveServerHost', () => {
  it('defaults bare-metal servers to localhost', () => {
    expect(resolveServerHost({})).toBe(DEFAULT_HOST)
  })

  it('honors an explicit LAN or public binding', () => {
    expect(resolveServerHost({ HOST: '0.0.0.0' })).toBe('0.0.0.0')
    expect(resolveServerHost({ HOST: '192.168.1.20' })).toBe('192.168.1.20')
  })

  it('treats a blank HOST as unset', () => {
    expect(resolveServerHost({ HOST: '  ' })).toBe(DEFAULT_HOST)
  })
})
