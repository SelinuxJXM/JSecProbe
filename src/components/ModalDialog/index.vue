<template>
  <el-dialog
    v-model="dialogVisible"
    :title="title"
    :width="width"
    :close-on-click-modal="closeOnClickModal"
    :close-on-press-escape="closeOnPressEscape"
    :show-close="showClose"
    :destroy-on-close="destroyOnClose"
    @close="handleClose"
  >
    <slot />
    <template #footer v-if="$slots.footer">
      <slot name="footer" />
    </template>
    <template #footer v-else>
      <span class="dialog-footer">
        <el-button @click="handleCancel">取消</el-button>
        <el-button type="primary" @click="handleConfirm" :loading="confirmLoading">
          确定
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: boolean;
  title?: string;
  width?: string;
  closeOnClickModal?: boolean;
  closeOnPressEscape?: boolean;
  showClose?: boolean;
  destroyOnClose?: boolean;
  confirmLoading?: boolean;
}>(), {
  title: '',
  width: '50%',
  closeOnClickModal: false,
  closeOnPressEscape: true,
  showClose: true,
  destroyOnClose: false,
  confirmLoading: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  confirm: [];
  cancel: [];
  close: [];
}>();

const dialogVisible = ref(props.modelValue);

watch(() => props.modelValue, (newVal) => {
  dialogVisible.value = newVal;
});

watch(dialogVisible, (newVal) => {
  emit('update:modelValue', newVal);
});

function handleConfirm() {
  emit('confirm');
}

function handleCancel() {
  emit('cancel');
  dialogVisible.value = false;
}

function handleClose() {
  emit('close');
}
</script>

<style scoped>
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>