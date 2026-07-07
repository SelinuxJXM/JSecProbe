<template>
  <el-menu
    :default-active="activeMenu"
    class="sidebar-menu"
    @select="handleMenuSelect"
  >
    <template v-for="item in menuItems" :key="item.path">
      <el-menu-item v-if="!item.children || item.children.length === 0" :index="item.path">
        <el-icon><component :is="item.icon || 'Menu'" /></el-icon>
        <span>{{ item.title }}</span>
      </el-menu-item>
      <el-sub-menu v-else :index="item.path">
        <template #title>
          <el-icon><component :is="item.icon || 'Menu'" /></el-icon>
          <span>{{ item.title }}</span>
        </template>
        <el-menu-item v-for="child in item.children" :key="child.path" :index="child.path">
          <span>{{ child.title }}</span>
        </el-menu-item>
      </el-sub-menu>
    </template>
  </el-menu>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

interface MenuItem {
  path: string;
  title: string;
  icon?: string;
  children?: MenuItem[];
}

defineProps<{
  menuItems: MenuItem[];
}>();

const emit = defineEmits<{
  select: [path: string];
}>();

const route = useRoute();
const router = useRouter();

const activeMenu = computed(() => route.path);

function handleMenuSelect(path: string) {
  router.push(path);
  emit('select', path);
}
</script>

<style scoped>
.sidebar-menu {
  height: 100%;
  border-right: none;
  background-color: var(--color-sidebar-bg);
}

.sidebar-menu .el-menu-item,
.sidebar-menu .el-sub-menu__title {
  height: 50px;
  line-height: 50px;
  color: var(--color-sidebar-text);
}

.sidebar-menu .el-menu-item:hover,
.sidebar-menu .el-sub-menu__title:hover {
  background-color: var(--color-sidebar-bg-hover);
  color: var(--color-sidebar-text-hover);
}

.sidebar-menu .el-menu-item.is-active {
  color: var(--color-sidebar-text-active);
}
</style>