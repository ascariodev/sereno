import { enableAutoUnmount, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import type { Task } from '../api/types'
import { i18n } from '../i18n'
import { createAppRouter } from '../router'
import TaskCard from './TaskCard.vue'

enableAutoUnmount(afterEach)

const task: Task = {
  id: 9, project_id: 5, key: 'P-1', number: 1, title: 'Fix it', description: null, status: 'todo', position: 1,
  created_by: 1, assignee: null, log_group: null, created_at: '2026-01-01T00:00:00.000000Z', updated_at: '2026-01-01T00:00:00.000000Z',
}

function mountCard(readOnly = false) {
  return mount(TaskCard, {
    props: { task, readOnly },
    global: { plugins: [createPinia(), i18n, createAppRouter(createMemoryHistory())] },
  })
}

describe('TaskCard', () => {
  it('labels the move button with the task key', () => {
    expect(mountCard().get('button[name=move-task]').attributes('aria-label')).toBe('Move P-1')
  })

  it('is draggable and has the move menu when editable', () => {
    const wrapper = mountCard()
    expect(wrapper.get('.task-card-wrap').attributes('draggable')).toBe('true')
    expect(wrapper.find('button[name=move-task]').exists()).toBe(true)
  })

  it('is not draggable and has no move menu when read only', () => {
    const wrapper = mountCard(true)
    expect(wrapper.get('.task-card-wrap').attributes('draggable')).toBeUndefined()
    expect(wrapper.find('button[name=move-task]').exists()).toBe(false)
  })
})
