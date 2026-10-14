import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import * as Linking from 'expo-linking'
import { Alert } from 'react-native'
import '@/i18n'

import { api } from '@/api/client'
import { MessageAttachments } from '@/components/MessageAttachments'
import { formatFileSize } from '@/messages/attachments'
import type { MessageAttachment } from '@/messages/store'

jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }))

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function attachment(id: number, extra: Partial<MessageAttachment> = {}): MessageAttachment {
  return { id, original_name: `file-${id}.png`, mime: 'image/png', size: 2048, created_at: '2026-01-01T00:00:00Z', url: `https://files.test/old-${id}`, ...extra }
}

function mockFetch(handler: (url: string) => Response) {
  const fetchMock = jest.fn(async (url: string) => handler(String(url)))
  globalThis.fetch = fetchMock as never
  return fetchMock
}

beforeEach(() => {
  api.setTokenProvider(null)
  api.setOrganizationProvider(null)
  jest.restoreAllMocks()
  jest.mocked(Linking.openURL).mockClear()
})

describe('MessageAttachments', () => {
  it('renews the url once when the stored image fails, then falls back to a file row', async () => {
    const fetchMock = mockFetch(() => json({ data: { url: 'https://files.test/new-1', expires_at: '2026-01-01T00:05:00Z' } }))
    await render(<MessageAttachments attachments={[attachment(1)]} />)

    expect(screen.getByTestId('attachment-image-1').props.source).toEqual({ uri: 'https://files.test/old-1' })
    await act(async () => {
      fireEvent(screen.getByTestId('attachment-image-1'), 'error')
    })
    await waitFor(() => expect(screen.getByTestId('attachment-image-1').props.source).toEqual({ uri: 'https://files.test/new-1' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/attachments/1/url')

    await act(async () => {
      fireEvent(screen.getByTestId('attachment-image-1'), 'error')
    })
    await screen.findByText('The preview is no longer available.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('opens a fresh url for a non-image file', async () => {
    mockFetch(() => json({ data: { url: 'https://files.test/fresh', expires_at: '2026-01-01T00:05:00Z' } }))
    await render(<MessageAttachments attachments={[attachment(2, { original_name: 'report.pdf', mime: 'application/pdf' })]} />)

    expect(screen.getByText('report.pdf')).toBeTruthy()
    expect(screen.getByText('2 KB')).toBeTruthy()
    fireEvent.press(screen.getByLabelText('Download: report.pdf'))
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('https://files.test/fresh'))
  })

  it('alerts when the file is gone', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    mockFetch(() => json({ message: 'Not found' }, 404))
    await render(<MessageAttachments attachments={[attachment(3, { original_name: 'a.zip', mime: 'application/zip' })]} />)

    fireEvent.press(screen.getByLabelText('Download: a.zip'))
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Could not open the file. It may no longer be available.'))
    expect(Linking.openURL).not.toHaveBeenCalled()
  })
})

describe('formatFileSize', () => {
  it('scales units', () => {
    expect(formatFileSize(0, 'en')).toBe('0 B')
    expect(formatFileSize(1536, 'en')).toBe('1.5 KB')
    expect(formatFileSize(1024 * 1024 * 3, 'en')).toBe('3 MB')
  })
})

describe('MessageAttachments url schemes', () => {
  it('does not open a non-http(s) url', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    mockFetch(() => json({ data: { url: 'intent://evil#Intent;end', expires_at: '2026-01-01T00:05:00Z' } }))
    await render(<MessageAttachments attachments={[attachment(4, { original_name: 'b.zip', mime: 'application/zip' })]} />)

    fireEvent.press(screen.getByLabelText('Download: b.zip'))
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Could not open the file. Check your connection and try again.'))
    expect(Linking.openURL).not.toHaveBeenCalled()
  })

  it('does not render a preview for a non-http(s) stored url', async () => {
    await render(<MessageAttachments attachments={[attachment(5, { url: 'file:///etc/passwd' })]} />)

    expect(screen.queryByTestId('attachment-image-5')).toBeNull()
    expect(screen.getByText('The preview is no longer available.')).toBeTruthy()
  })
})
