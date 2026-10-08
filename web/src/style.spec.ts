/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/style.css'), 'utf8')

function blockAfter(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `selector ${selector}`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  const end = css.indexOf('}', open)
  return css.slice(open + 1, end)
}

function variables(block: string): string[] {
  return [...block.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]).sort()
}

describe('style.css tokens', () => {
  const light = variables(blockAfter(':root'))
  const media = variables(blockAfter(":root:not([data-theme='light'])"))
  const dark = variables(blockAfter(":root[data-theme='dark']"))

  it('defines tokens in the light block', () => {
    expect(light.length).toBeGreaterThan(0)
  })

  it('dark blocks define exactly the same variables as light', () => {
    expect(media).toEqual(light)
    expect(dark).toEqual(light)
  })
})
