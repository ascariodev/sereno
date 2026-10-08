<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppToast from './components/ui/AppToast.vue'

const { t } = useI18n()
</script>

<template>
  <RouterView />
  <AppToast :label="t('toast.region')" :close-label="t('toast.close')" />
</template>
