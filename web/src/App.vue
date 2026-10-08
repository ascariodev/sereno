<script setup lang="ts">
import { TooltipProvider } from 'reka-ui'
import { useI18n } from 'vue-i18n'
import AppToast from './components/ui/AppToast.vue'

const { t } = useI18n()
</script>

<template>
  <TooltipProvider :delay-duration="400" :skip-delay-duration="300">
    <RouterView />
  </TooltipProvider>
  <AppToast :label="t('toast.region')" :close-label="t('toast.close')" />
</template>
