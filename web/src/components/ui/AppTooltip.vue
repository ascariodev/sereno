<script setup lang="ts">
import {
  injectTooltipProviderContext,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from 'reka-ui'
import type { FunctionalComponent } from 'vue'

withDefaults(defineProps<{ text: string; side?: 'top' | 'right' | 'bottom' | 'left'; delay?: number }>(), {
  side: 'top',
  delay: 400,
})

const hasProvider = injectTooltipProviderContext(null) !== null
const Passthrough: FunctionalComponent = (_, { slots }) => slots.default?.()
</script>

<template>
  <component :is="hasProvider ? Passthrough : TooltipProvider">
    <TooltipRoot :delay-duration="delay">
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent class="app-tooltip" :side="side" :side-offset="6" :collision-padding="8">
          {{ text }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </component>
</template>

<style>
.app-tooltip {
  max-width: 260px;
  padding: 5px 9px;
  background: var(--ink);
  color: var(--surface);
  border-radius: var(--radius-chip);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  transform-origin: var(--reka-tooltip-content-transform-origin);
  z-index: 60;
}
.app-tooltip[data-state='delayed-open'],
.app-tooltip[data-state='instant-open'] {
  animation: app-tooltip-in 100ms ease-out;
}
.app-tooltip[data-state='closed'] {
  animation: app-tooltip-out 80ms ease-in;
}
@keyframes app-tooltip-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: none; }
}
@keyframes app-tooltip-out {
  from { opacity: 1; transform: none; }
  to { opacity: 0; transform: scale(0.96); }
}
@media (prefers-reduced-motion: reduce) {
  .app-tooltip[data-state] { animation: none; }
}
</style>
