<template>
  <div class="external-links-tab">
    <!-- 链接管理 -->
    <div class="card p-md mt-md">
      <div class="toolbar">
        <div class="toolbar-left">
          <div class="settings-section-title" style="margin-bottom: 0">
            链接列表
            <span class="count-badge">{{ links.length }}</span>
          </div>
        </div>
        <div class="toolbar-right">
          <el-input v-model="search" placeholder="搜索名称 / 网址 / 分组" clearable style="width: 220px">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-button type="primary" :icon="Plus" @click="openCreate">新增链接</el-button>
          <el-dropdown @command="(cmd: any) => startImport(cmd as ExternalLinkImportFormat)">
            <el-button :icon="Upload">
              导入<el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="sites">导入 sites.txt（导航站格式）</el-dropdown-item>
                <el-dropdown-item command="bookmarks">导入浏览器书签 HTML</el-dropdown-item>
                <el-dropdown-item command="json">导入本工具导出的 JSON</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button :icon="Download" :loading="exporting" @click="handleExport">导出</el-button>
        </div>
      </div>
      <p class="el-hint">
        内置链接随安装包提供，其中「官方导航站」是一条外链，点开即为最新内容；想把站内链接搬进应用，用「导入 sites.txt」手动完成，不做后台同步。
        网址支持上下文变量 <code>{projectName}</code>、<code>{assetIp}</code>、<code>{standardCode}</code>，
        打开时自动带入当前项目信息。卡片可拖拽排序，右上角「更多」里可上移/下移、收藏、隐藏、标记失效；内置项不会真正删除，只会隐藏。
      </p>

      <div v-if="loading" class="el-empty">正在加载链接…</div>
      <template v-else>
        <div v-for="group in grouped" :key="group.name" class="link-group">
          <div class="link-group-head">
            <span>{{ group.name }}</span>
            <span class="count-badge">{{ group.items.length }}</span>
          </div>
          <div class="link-card-grid">
            <div
              v-for="item in group.items"
              :key="item.id"
              class="link-card"
              :class="{ hidden: item.isHidden, stale: item.isStale }"
              draggable="true"
              @dragstart="onDragStart(item.id)"
              @dragover.prevent
              @drop="onDrop(item.id)"
              @click="open(item)"
            >
              <div class="link-card-top">
                <span class="link-icon">{{ item.iconText || item.title.charAt(0) }}</span>
                <div class="link-tags">
                  <span class="lnk-tag">{{ sourceLabel(item.source) }}</span>
                  <span class="lnk-tag" :class="item.networkZone">{{ item.networkZone === 'intranet' ? '内网' : '需外网' }}</span>
                </div>
              </div>
              <div class="link-title">
                {{ item.title }}
                <el-icon v-if="item.isFavorite" class="star"><Star /></el-icon>
              </div>
              <div class="link-url" :title="item.url">{{ linkHost(item.url) }}</div>
              <div class="link-desc" :title="item.description">{{ item.description || '暂无描述' }}</div>
              <div class="link-card-meta">
                <span v-if="item.hasOverride && item.source !== 'custom'" class="mini-tag">已自定义</span>
                <span v-if="item.isHidden" class="mini-tag">已隐藏</span>
                <span v-if="item.isStale" class="mini-tag warn">疑似失效</span>
              </div>
              <div class="link-card-bottom" @click.stop>
                <el-button text type="primary" size="small" @click="open(item)">访问 ↗</el-button>
                <div class="link-actions">
                  <el-tooltip content="复制链接" placement="top">
                    <el-button text :icon="CopyDocument" @click="copy(item)" />
                  </el-tooltip>
                  <el-tooltip content="编辑" placement="top">
                    <el-button text :icon="Edit" @click="openEdit(item)" />
                  </el-tooltip>
                  <el-dropdown trigger="click" @command="(cmd: any) => onCardCommand(String(cmd), item)">
                    <el-button text :icon="MoreFilled" />
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="favorite">{{ item.isFavorite ? '取消收藏' : '收藏置顶' }}</el-dropdown-item>
                        <el-dropdown-item command="hidden">{{ item.isHidden ? '显示' : '隐藏' }}</el-dropdown-item>
                        <el-dropdown-item command="stale">{{ item.isStale ? '取消失效标记' : '标记失效' }}</el-dropdown-item>
                        <el-dropdown-item command="up" divided>上移</el-dropdown-item>
                        <el-dropdown-item command="down">下移</el-dropdown-item>
                        <el-dropdown-item command="delete" divided>{{ item.source === 'custom' ? '删除' : '隐藏（内置不可删除）' }}</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="grouped.length === 0" class="el-empty">
          {{ search ? '没有匹配的链接' : '还没有链接，点击「新增链接」或导入书签开始使用' }}
        </div>
      </template>
    </div>

    <!-- 新增 / 编辑 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑链接' : '新增链接'" width="560px">
      <el-form :model="form" label-width="96px">
        <el-form-item label="名称" required>
          <el-input v-model="form.title" placeholder="例如：客户漏扫平台" maxlength="80" />
        </el-form-item>
        <el-form-item label="网址" required>
          <el-input v-model="form.url" placeholder="https://… 或 http://192.168.x.x" />
          <div class="form-hint">支持 http/https；网址中可嵌入上下文变量；内网地址同样允许。</div>
        </el-form-item>
        <el-form-item label="分组">
          <el-input v-model="form.groupName" placeholder="例如：现场系统" maxlength="40" />
        </el-form-item>
        <el-form-item label="图标文字">
          <el-input v-model="form.iconText" placeholder="一个汉字，留空自动取名称首字" maxlength="2" />
        </el-form-item>
        <el-form-item label="网络区域">
          <el-radio-group v-model="form.networkZone">
            <el-radio-button value="internet">需外网</el-radio-button>
            <el-radio-button value="intranet">内网</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" maxlength="300" />
        </el-form-item>
        <el-form-item label="选项">
          <el-checkbox v-model="form.isFavorite">收藏置顶</el-checkbox>
          <el-checkbox v-model="form.isHidden">隐藏（不在快捷面板显示）</el-checkbox>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveForm">保存</el-button>
      </template>
    </el-dialog>

    <!-- 导入 -->
    <el-dialog v-model="importVisible" title="导入链接" width="500px">
      <div class="import-file">
        <el-button :icon="FolderOpened" @click="fileInput?.click()">选择文件</el-button>
        <span>{{ importFileName || '尚未选择文件' }}</span>
      </div>
      <el-checkbox v-if="importFormat === 'sites'" v-model="onlyRelevant">
        仅导入测评相关分类（推荐；取消勾选可全量导入）
      </el-checkbox>
      <p class="el-hint">
        导入的每条 URL 都会经过与主进程一致的校验；与现有链接重复的会自动跳过。
        导入项作为自定义链接保存，可自由编辑或删除。
      </p>
      <template #footer>
        <el-button @click="importVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!importContent" :loading="importing" @click="confirmImport">
          开始导入
        </el-button>
      </template>
    </el-dialog>

    <input
      ref="fileInput"
      type="file"
      style="display: none"
      :accept="importFormat === 'bookmarks' ? '.html,.htm' : importFormat === 'json' ? '.json' : '.txt'"
      @change="onFileChange"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ArrowDown, CopyDocument, Download, Edit, FolderOpened,
  MoreFilled, Plus, Search, Star, Upload,
} from '@element-plus/icons-vue';
import type {
  ExternalLinkCreateInput,
  ExternalLinkImportFormat,
  ExternalLinkItem,
} from '../../../../shared/types';
import { RECOMMENDED_SITES_GROUPS } from '../../../../shared/types';
import { copyExternalLink, openExternalLink, sourceLabel } from '@/utils/external-link';
import { linkHost } from '@/utils/link-host';

const links = ref<ExternalLinkItem[]>([]);
const loading = ref(false);
const saving = ref(false);
const exporting = ref(false);
const importing = ref(false);
const search = ref('');

const dialogVisible = ref(false);
const editingId = ref<string | null>(null);
const form = reactive({
  title: '',
  url: '',
  groupName: '自定义',
  iconText: '',
  networkZone: 'internet' as 'internet' | 'intranet',
  description: '',
  isFavorite: false,
  isHidden: false,
});

const importVisible = ref(false);
const importFormat = ref<ExternalLinkImportFormat>('json');
const importFileName = ref('');
const importContent = ref('');
const onlyRelevant = ref(true);
const fileInput = ref<HTMLInputElement | null>(null);
const dragId = ref<string | null>(null);

const grouped = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  const filtered = keyword
    ? links.value.filter((l) =>
        `${l.title} ${l.url} ${l.groupName} ${l.description}`.toLowerCase().includes(keyword))
    : links.value;
  const map = new Map<string, ExternalLinkItem[]>();
  for (const item of filtered) {
    const list = map.get(item.groupName) || [];
    list.push(item);
    map.set(item.groupName, list);
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }));
});

/** 每次变更后统一重新读回列表：保存成功不等于真的落盘，读回自校验是项目约定 */
async function loadAll(): Promise<void> {
  if (!window.api?.externalLink) return;
  loading.value = true;
  try {
    const res = await window.api.externalLink.list();
    links.value = res.success && res.data ? res.data : [];
  } finally {
    loading.value = false;
  }
}

onMounted(loadAll);

function open(item: ExternalLinkItem): void {
  void openExternalLink(item);
}

function copy(item: ExternalLinkItem): void {
  void copyExternalLink(item);
}

/** 卡片「更多」菜单：复用列表时代的同一套操作，避免两套实现漂移 */
function onCardCommand(cmd: string, item: ExternalLinkItem): void {
  switch (cmd) {
    case 'favorite': void toggleField(item, 'isFavorite'); break;
    case 'hidden': void toggleField(item, 'isHidden'); break;
    case 'stale': void toggleField(item, 'isStale'); break;
    case 'up': move(item.id, -1); break;
    case 'down': move(item.id, 1); break;
    case 'delete': void remove(item); break;
  }
}

async function toggleField(item: ExternalLinkItem, field: 'isFavorite' | 'isHidden' | 'isStale'): Promise<void> {
  const res = await window.api.externalLink.update(item.id, { [field]: !item[field] });
  if (!res.success) {
    ElMessage.error(res.error?.message || '更新失败');
    return;
  }
  // 读回自校验：出现过「并行编辑都成功但一处未落盘」的情况
  const check = (await window.api.externalLink.list()).data || [];
  const updated = check.find((l) => l.id === item.id);
  if (updated && updated[field] !== !item[field]) {
    ElMessage.warning('状态未能保存，请重试');
  }
  await loadAll();
}

async function remove(item: ExternalLinkItem): Promise<void> {
  const isBuiltin = item.source !== 'custom';
  try {
    await ElMessageBox.confirm(
      isBuiltin
        ? `「${item.title}」是内置链接，不会真正删除，只会隐藏。确定继续吗？`
        : `确定删除「${item.title}」吗？此操作不可撤销。`,
      isBuiltin ? '隐藏内置链接' : '删除链接',
      { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }
  const res = await window.api.externalLink.delete(item.id);
  if (!res.success) {
    ElMessage.error(res.error?.message || '操作失败');
    return;
  }
  ElMessage.success(isBuiltin ? '已隐藏' : '已删除');
  await loadAll();
}

function resetForm(): void {
  form.title = '';
  form.url = '';
  form.groupName = '自定义';
  form.iconText = '';
  form.networkZone = 'internet';
  form.description = '';
  form.isFavorite = false;
  form.isHidden = false;
}

function openCreate(): void {
  editingId.value = null;
  resetForm();
  dialogVisible.value = true;
}

function openEdit(item: ExternalLinkItem): void {
  editingId.value = item.id;
  form.title = item.title;
  form.url = item.url;
  form.groupName = item.groupName;
  form.iconText = item.iconText;
  form.networkZone = item.networkZone;
  form.description = item.description;
  form.isFavorite = item.isFavorite;
  form.isHidden = item.isHidden;
  dialogVisible.value = true;
}

async function saveForm(): Promise<void> {
  if (!form.title.trim() || !form.url.trim()) {
    ElMessage.warning('名称与网址不能为空');
    return;
  }
  saving.value = true;
  try {
    const payload: ExternalLinkCreateInput = {
      title: form.title.trim(),
      url: form.url.trim(),
      groupName: form.groupName.trim() || '自定义',
      iconText: form.iconText.trim(),
      networkZone: form.networkZone,
      description: form.description.trim(),
      isFavorite: form.isFavorite,
      isHidden: form.isHidden,
    };
    const res = editingId.value
      ? await window.api.externalLink.update(editingId.value, payload)
      : await window.api.externalLink.create(payload);
    if (!res.success) {
      ElMessage.error(res.error?.message || '保存失败');
      return;
    }
    await loadAll();
    // 落盘自校验：按名称 + URL 找回来，确认值一致
    const saved = links.value.find((l) => l.title === payload.title && l.url === payload.url);
    if (!saved) {
      ElMessage.warning('保存后未能在列表中读回该链接，请检查');
      return;
    }
    dialogVisible.value = false;
    ElMessage.success('已保存');
  } finally {
    saving.value = false;
  }
}

/** 把当前可见顺序写回 sort_order；拖拽与上移/下移共用 */
async function persistOrder(): Promise<void> {
  const res = await window.api.externalLink.reorder(links.value.map((l) => l.id));
  if (!res.success) {
    ElMessage.error(res.error?.message || '排序保存失败');
    return;
  }
  await loadAll();
}

function move(id: string, delta: number): void {
  const index = links.value.findIndex((l) => l.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= links.value.length) return;
  const next = [...links.value];
  [next[index], next[target]] = [next[target], next[index]];
  links.value = next;
  void persistOrder();
}

function onDragStart(id: string): void {
  dragId.value = id;
}

function onDrop(targetId: string): void {
  const from = dragId.value;
  dragId.value = null;
  if (!from || from === targetId) return;
  const next = [...links.value];
  const fromIndex = next.findIndex((l) => l.id === from);
  const toIndex = next.findIndex((l) => l.id === targetId);
  if (fromIndex < 0 || toIndex < 0) return;
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  links.value = next;
  void persistOrder();
}

function startImport(format: ExternalLinkImportFormat): void {
  importFormat.value = format;
  importFileName.value = '';
  importContent.value = '';
  onlyRelevant.value = true;
  importVisible.value = true;
  setTimeout(() => fileInput.value?.click(), 0);
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    importContent.value = await file.text();
    importFileName.value = file.name;
  } catch (e: any) {
    ElMessage.error(`读取文件失败：${e?.message || '未知错误'}`);
  }
  input.value = '';
}

async function confirmImport(): Promise<void> {
  importing.value = true;
  try {
    const groups = importFormat.value === 'sites' && onlyRelevant.value
      ? RECOMMENDED_SITES_GROUPS
      : undefined;
    const res = await window.api.externalLink.import({
      format: importFormat.value,
      content: importContent.value,
      groups,
    });
    if (!res.success) {
      ElMessage.error(res.error?.message || '导入失败');
      return;
    }
    const data = res.data;
    if (data?.errors?.length) {
      ElMessage.warning(`导入 ${data.imported} 条，跳过重复 ${data.skipped} 条；${data.errors.length} 条不合法 URL 已忽略`);
    } else {
      ElMessage.success(`导入 ${data?.imported || 0} 条，跳过重复 ${data?.skipped || 0} 条`);
    }
    importVisible.value = false;
    await loadAll();
  } finally {
    importing.value = false;
  }
}

async function handleExport(): Promise<void> {
  exporting.value = true;
  try {
    const res = await window.api.externalLink.export();
    if (!res.success || !res.data) {
      ElMessage.error(res.error?.message || '导出失败');
      return;
    }
    const saveRes = await window.api.system.saveFile('jsecprobe-links.json', [
      { name: 'JSON 文件', extensions: ['json'] },
    ]);
    if (!saveRes.success || !saveRes.data) return;
    const writeRes = await window.api.fs.writeTextFile(saveRes.data, res.data);
    if (!writeRes.success) {
      ElMessage.error(writeRes.error?.message || '文件写入失败');
      return;
    }
    ElMessage.success('已导出自定义链接（内置项随版本自带，无需导出）');
  } finally {
    exporting.value = false;
  }
}
</script>

<style scoped lang="scss">
.external-links-tab {
  display: flex;
  flex-direction: column;
}

.el-hint {
  margin: 8px 0 12px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-text-tertiary);
}

.count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 5px;
  margin-left: 6px;
  border-radius: var(--radius-full);
  background: var(--color-bg-tag);
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.link-group {
  margin-top: 18px;
}

.link-group-head {
  display: flex;
  align-items: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
  padding: 0 2px 10px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--color-border-light);
}

.link-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px;
}

.link-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--color-border-base);
  border-radius: var(--radius-lg);
  background: var(--color-bg-card);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;

  &:hover {
    border-color: var(--color-primary);
    transform: translateY(-2px);
  }

  &.hidden {
    opacity: 0.55;
  }

  &.stale .link-title {
    text-decoration: line-through;
  }
}

.link-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 2px;
}

.link-icon {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--color-info-light);
  color: var(--color-primary);
  font-size: 13px;
}

.link-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.star {
  color: var(--color-warning);
  font-size: 12px;
}

.link-url {
  font-size: 11px;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.link-desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 36px;
}

.link-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 18px;
}

.mini-tag {
  font-size: 11px;
  color: var(--color-text-tertiary);
  background: var(--color-bg-tag);
  border-radius: var(--radius-sm);
  padding: 0 4px;

  &.warn {
    color: var(--color-warning);
    background: var(--color-warning-light);
  }
}

.link-tags {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.lnk-tag {
  font-size: 11px;
  color: var(--color-text-secondary);
  background: var(--color-bg-tag);
  border-radius: var(--radius-sm);
  padding: 1px 5px;

  &.intranet {
    color: var(--color-success);
    background: var(--color-success-light);
  }
}

.link-card-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 2px;
  padding-top: 6px;
  border-top: 1px solid var(--color-border-light);
}

.link-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;

  :deep(.el-button) {
    margin-left: 0;
    padding: 6px;
  }
}

.el-empty {
  text-align: center;
  padding: 28px 12px;
  font-size: 13px;
  color: var(--color-text-tertiary);
}

.form-hint {
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-text-tertiary);
}

.import-file {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--color-text-secondary);
}

code {
  font-family: var(--font-family-mono, monospace);
  background: var(--color-bg-tag);
  border-radius: var(--radius-sm);
  padding: 0 3px;
}
</style>
