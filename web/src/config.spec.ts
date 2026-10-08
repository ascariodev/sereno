import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { readConfig } from './config'

describe('readConfig', () => {
  it('uses development defaults except for the Reverb key', () => {
    expect(readConfig({})).toEqual({
      apiUrl: 'http://localhost:8003',
      reverb: { key: '', host: 'localhost', port: 8086, scheme: 'http' },
    })
  })

  it('reads values from the environment', () => {
    expect(
      readConfig({
        VITE_API_URL: 'https://api.example.com/',
        VITE_REVERB_APP_KEY: 'key',
        VITE_REVERB_HOST: 'ws.example.com',
        VITE_REVERB_PORT: '443',
        VITE_REVERB_SCHEME: 'https',
      }),
    ).toEqual({
      apiUrl: 'https://api.example.com',
      reverb: { key: 'key', host: 'ws.example.com', port: 443, scheme: 'https' },
    })
  })
})

describe('test environment', () => {
  it('mounts a component in jsdom', () => {
    const wrapper = mount(defineComponent({ render: () => h('p', 'ok') }))

    expect(wrapper.text()).toBe('ok')
  })
})
