<template>
  <button class="app-button"><slot /></button>
</template>

<style scoped>
.app-button {
  min-height: 46px;
  border: 0;
  border-radius: 10px;
  background: var(--ink);
  color: var(--surface);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.app-button:disabled {
  opacity: 0.6;
  cursor: default;
}
.app-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
