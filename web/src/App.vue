<script setup lang="ts">
import { TooltipProvider } from 'reka-ui'
import { useI18n } from 'vue-i18n'
import AppToast from './components/ui/AppToast.vue'
import { TOOLTIP_DELAY_MS, TOOLTIP_SKIP_DELAY_MS } from './components/ui/tooltipDelay'

const { t } = useI18n()
</script>

<template>
  <TooltipProvider :delay-duration="TOOLTIP_DELAY_MS" :skip-delay-duration="TOOLTIP_SKIP_DELAY_MS">
    <RouterView />
  </TooltipProvider>
  <AppToast :label="t('toast.region')" :close-label="t('toast.close')" />
</template>
