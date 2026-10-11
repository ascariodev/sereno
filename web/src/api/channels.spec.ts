import { afterEach, describe, expect, it, vi } from 'vitest'
import { listAllChannels } from './channels'
import { api } from './client'

const channel = (id: number) => ({ id, project_id: id, name: `c${id}` })

describe('listAllChannels', () => {
  afterEach(() => vi.restoreAllMocks())

  it('follows the cursor until the last page', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce({ data: [channel(1)], meta: { next_cursor: 'c1' } } as never)
      .mockResolvedValueOnce({ data: [channel(2)], meta: { next_cursor: null } } as never)

    const all = await listAllChannels({ includeArchived: true })

    expect(all.map((item) => item.id)).toEqual([1, 2])
    expect(get).toHaveBeenNthCalledWith(1, '/api/channels', { query: { include_archived: 1 } })
    expect(get).toHaveBeenNthCalledWith(2, '/api/channels', { query: { include_archived: 1, cursor: 'c1' } })
  })

  it('sends no options on a plain first page', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: [], meta: { next_cursor: null } } as never)
    await listAllChannels()
    expect(get).toHaveBeenCalledWith('/api/channels', undefined)
  })
})
