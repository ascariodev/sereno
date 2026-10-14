import * as Linking from 'expo-linking'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native'

import { ApiError } from '@/api/client'
import { formatFileSize, getAttachmentUrl } from '@/messages/attachments'
import type { MessageAttachment } from '@/messages/store'

const PREVIEWABLE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

function isWebUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function MessageAttachments({ attachments }: { attachments: MessageAttachment[] }) {
  const { t, i18n } = useTranslation()
  // Keyed by id and remembering the stored url they refer to: a new url for the same id resets them.
  const [retried, setRetried] = useState<Record<number, string>>({})
  const [renewed, setRenewed] = useState<Record<number, { from: string; url: string }>>({})
  const [failed, setFailed] = useState<Record<number, string>>({})

  if (attachments.length === 0) return null

  function currentUrl(a: MessageAttachment): string | null {
    const r = renewed[a.id]
    const url = r !== undefined && r.from === a.url ? r.url : a.url
    return isWebUrl(url) ? url : null
  }

  async function onPreviewError(a: MessageAttachment) {
    if (retried[a.id] === a.url) {
      setFailed((state) => ({ ...state, [a.id]: a.url }))
      return
    }
    setRetried((state) => ({ ...state, [a.id]: a.url }))
    try {
      const { url } = await getAttachmentUrl(a.id)
      setRenewed((state) => ({ ...state, [a.id]: { from: a.url, url } }))
    } catch {
      setFailed((state) => ({ ...state, [a.id]: a.url }))
    }
  }

  async function openFresh(a: MessageAttachment) {
    let url: string
    try {
      url = (await getAttachmentUrl(a.id)).url
    } catch (caught) {
      Alert.alert(caught instanceof ApiError && caught.status === 404 ? t('attachments.openFailed') : t('attachments.openFailedRetry'))
      return
    }
    if (!isWebUrl(url)) {
      Alert.alert(t('attachments.openFailedRetry'))
      return
    }
    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert(t('attachments.openFailedRetry'))
    }
  }

  return (
    <View accessibilityLabel={t('attachments.list')} style={styles.list}>
      {attachments.map((a) => {
        const previewable = PREVIEWABLE.includes(a.mime)
        const previewUrl = previewable && failed[a.id] !== a.url ? currentUrl(a) : null
        return (
          <View key={a.id}>
            {previewUrl !== null ? (
              <Pressable accessibilityRole="imagebutton" accessibilityLabel={a.original_name} onPress={() => void openFresh(a)} style={styles.thumb}>
                <Image testID={`attachment-image-${a.id}`} source={{ uri: previewUrl }} onError={() => void onPreviewError(a)} style={styles.image} resizeMode="cover" />
              </Pressable>
            ) : (
              <>
                {previewable ? <Text style={styles.note}>{t('attachments.previewUnavailable')}</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('attachments.download')}: ${a.original_name}`}
                  onPress={() => void openFresh(a)}
                  style={styles.file}
                >
                  <Text style={styles.name} numberOfLines={2}>{a.original_name}</Text>
                  <Text style={styles.size}>{formatFileSize(a.size, i18n.language)}</Text>
                  <Text style={styles.download}>{t('attachments.download')}</Text>
                </Pressable>
              </>
            )}
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: 6, marginTop: 2, alignItems: 'flex-start' },
  thumb: { width: 240, maxWidth: '100%', aspectRatio: 3 / 2, overflow: 'hidden', borderRadius: 8, borderWidth: 1, borderColor: '#ccc' },
  image: { width: '100%', height: '100%' },
  note: { fontSize: 12, color: '#777', marginBottom: 4 },
  file: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: '#ccc' },
  name: { flexShrink: 1, fontSize: 14 },
  size: { fontSize: 12, color: '#777' },
  download: { fontSize: 13, color: '#1f2937', fontWeight: '600' },
})
