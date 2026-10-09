<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { MENTION_TOKEN } from '../mentionToken'

const props = defineProps<{
  body: string | null
  mentions?: { id: number; name: string }[]
  ownUserId?: number
}>()

const { t } = useI18n()

type Part = { text: string } | { mention: string; own: boolean }

const parts = computed<Part[]>(() => {
  const body = props.body ?? ''
  const names = new Map((props.mentions ?? []).map((m) => [String(m.id), m.name]))
  const result: Part[] = []
  let last = 0
  for (const match of body.matchAll(MENTION_TOKEN)) {
    if (match.index > last) result.push({ text: body.slice(last, match.index) })
    const id = match[1]
    result.push({
      mention: names.get(id) ?? t('channel.unknownMention'),
      own: props.ownUserId !== undefined && String(props.ownUserId) === id,
    })
    last = match.index + match[0].length
  }
  if (last < body.length) result.push({ text: body.slice(last) })
  return result
})
</script>

<template>
  <template v-for="(part, i) in parts" :key="i">
    <span v-if="'mention' in part" class="mention-chip" :class="{ 'mention-chip--own': part.own }" data-mention>@{{ part.mention }}</span>
    <template v-else>{{ part.text }}</template>
  </template>
</template>

<style scoped>
.mention-chip {
  padding: 1px 4px;
  border-radius: 5px;
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-weight: 500;
}

.mention-chip--own {
  background: color-mix(in srgb, var(--accent) 25%, var(--surface));
  color: var(--accent-ink);
  font-weight: 600;
}
</style>
