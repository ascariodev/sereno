<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { splitMentions, type MentionPart } from '../mentionToken'

const props = defineProps<{
  body: string | null
  mentions?: { id: number; name: string }[]
  ownUserId?: number
}>()

const { t } = useI18n()

const parts = computed<MentionPart[]>(() =>
  splitMentions(props.body ?? '', props.mentions ?? [], t('channel.unknownMention'), props.ownUserId),
)
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
