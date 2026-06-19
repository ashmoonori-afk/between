import { describe, it, expect } from 'vitest'
import { stripAnsi, makeRing } from '../../src/adapters/agent-host'

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

describe('stripAnsi', () => {
  it('removes cursor/erase CSI sequences but keeps the text', () => {
    expect(stripAnsi(`${ESC}[2J${ESC}[Hhello`)).toBe('hello')
  })

  it('removes SGR color sequences', () => {
    expect(stripAnsi(`${ESC}[31mred${ESC}[0m`)).toBe('red')
  })

  it('removes OSC title sequences', () => {
    expect(stripAnsi(`${ESC}]0;a title${BEL}text`)).toBe('text')
  })

  it('preserves newlines and tabs', () => {
    expect(stripAnsi('a\nb\tc')).toBe('a\nb\tc')
  })
})

describe('makeRing', () => {
  it('splits complete lines and keeps the pending partial', () => {
    const r = makeRing(100)
    r.push('a\nb\nc')
    expect(r.get()).toEqual(['a', 'b', 'c'])
  })

  it('collapses carriage-return progress overwrites', () => {
    const r = makeRing(100)
    r.push('loading 10%\rloading 100%\rdone\n')
    expect(r.get()).toEqual(['done'])
  })

  it('handles CRLF line endings', () => {
    const r = makeRing(100)
    r.push('one\r\ntwo\r\n')
    expect(r.get()).toEqual(['one', 'two'])
  })

  it('bounds the retained tail to capacity', () => {
    const r = makeRing(3)
    for (let i = 0; i < 10; i++) r.push(`line${i}\n`)
    expect(r.get()).toEqual(['line7', 'line8', 'line9'])
  })

  it('flush pushes the trailing partial line', () => {
    const r = makeRing(100)
    r.push('partial')
    r.flush()
    expect(r.get()).toEqual(['partial'])
  })
})
