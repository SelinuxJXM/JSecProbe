<template>
  <div class="phase-progress">
    <div
      v-for="(phase, index) in phases"
      :key="phase.key"
      class="phase-item"
      :class="{
        'phase-active': index === activePhase,
        'phase-completed': index < activePhase,
      }"
      @click="handlePhaseClick(phase.key)"
    >
      <span class="phase-number">{{ index + 1 }}</span>
      <span class="phase-label">{{ phase.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
interface Phase {
  key: string;
  label: string;
}

const props = defineProps<{
  activePhase: number;
  phases?: Phase[];
}>();

const emit = defineEmits<{
  (e: 'change', key: string): void;
}>();

const defaultPhases: Phase[] = [
  { key: 'system-composition', label: '系统构成' },
  { key: 'onsite-verification', label: '现场核查' },
  { key: 'issue-summary', label: '问题汇总' },
];

const phases = computed(() => props.phases || defaultPhases);

function handlePhaseClick(key: string) {
  emit('change', key);
}
</script>

<style scoped lang="scss">
.phase-progress {
  display: flex;
  align-items: center;
  gap: 0;
}

.phase-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 14px;
  border-radius: var(--radius-md, 6px) 0 0 var(--radius-md, 6px);
  background: var(--color-border-light, #F0F0F3);
  color: var(--color-text-secondary, #4B5563);
  font-size: var(--text-sm, 12px);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;

  &:not(:first-child) {
    border-radius: 0 var(--radius-md, 6px) var(--radius-md, 6px) 0;
  }

  &:not(:last-child) {
    margin-right: -1px;
  }

  .phase-number {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-full, 9999px);
    background: var(--color-border-default, #E5E7EB);
    font-size: var(--text-xs, 11px);
    font-weight: 600;
    color: var(--color-text-secondary, #4B5563);
  }

  &.phase-completed {
    background: var(--color-border-light, #F0F0F3);
    color: var(--color-text-secondary, #4B5563);

    .phase-number {
      background: var(--color-border-default, #E5E7EB);
      color: var(--color-text-secondary, #4B5563);
    }
  }

  &.phase-active {
    background: var(--color-primary, #1B5FD9);
    color: var(--color-text-inverse, #FFFFFF);

    .phase-number {
      background: rgba(255, 255, 255, 0.25);
      color: var(--color-text-inverse, #FFFFFF);
    }
  }

  &:hover:not(.phase-active) {
    background: var(--color-primary-light, #E8F0FE);
    color: var(--color-primary, #1B5FD9);
  }
}
</style>