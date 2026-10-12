<template>
  <p class="app-form-error" role="alert"><slot /></p>
</template>

<style scoped>
.app-form-error {
  margin: 0;
  color: var(--level-error-fg);
  font-size: 13px;
}
</style>
