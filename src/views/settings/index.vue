<template>
  <div class="page-container">
    <div class="page-header">
      <div class="page-header-title">系统设置</div>
      <div class="page-header-desc">配置系统参数与偏好设置</div>
    </div>

    <div class="settings-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 常规设置 -->
    <template v-if="activeTab === 'settings'">
      <el-row :gutter="16">
        <el-col :span="12">
          <div class="card p-md">
            <div class="settings-section-title">外观设置</div>
            
            <div class="settings-item">
              <div class="settings-item-info">
                <div class="settings-item-name">主题模式</div>
                <div class="settings-item-desc">选择浅色或深色主题</div>
              </div>
              <el-radio-group v-model="themeMode" @change="handleThemeChange">
                <el-radio-button value="light">浅色</el-radio-button>
                <el-radio-button value="dark">深色</el-radio-button>
                <el-radio-button value="auto">跟随系统</el-radio-button>
              </el-radio-group>
            </div>

            <div class="settings-item">
              <div class="settings-item-info">
                <div class="settings-item-name">主题色</div>
                <div class="settings-item-desc">设置主色调</div>
              </div>
              <el-color-picker v-model="primaryColor" @change="handlePrimaryColorChange" show-alpha />
            </div>
          </div>

          <div class="card p-md mt-md">
            <div class="settings-section-title">数据管理</div>
            
            <div class="settings-item">
              <div class="settings-item-info">
                <div class="settings-item-name">数据备份</div>
                <div class="settings-item-desc">将所有数据导出为备份文件</div>
              </div>
              <el-button type="primary" :icon="Download" @click="handleBackup">
                立即备份
              </el-button>
            </div>

            <div class="settings-item">
              <div class="settings-item-info">
                <div class="settings-item-name">数据恢复</div>
                <div class="settings-item-desc">从备份文件恢复数据（将覆盖现有数据）</div>
              </div>
              <el-button type="warning" :icon="Upload" @click="handleRestore">
                恢复数据
              </el-button>
            </div>

            <div class="settings-item">
              <div class="settings-item-info">
                <div class="settings-item-name">数据存储位置</div>
                <div class="settings-item-desc">数据库文件所在目录</div>
              </div>
              <div class="data-path-actions">
                <el-button text type="primary" @click="handleOpenDataFolder" class="path-display-btn">
                  {{ dataPath || '加载中...' }}
                </el-button>
                <el-button size="small" type="warning" @click="handleChangeDataPath">
                  更改
                </el-button>
              </div>
            </div>
          </div>
        </el-col>

        <el-col :span="12">
          <div class="card p-md">
            <div class="settings-section-title">系统信息</div>
            
            <div class="info-list">
              <div class="info-item">
                <span class="info-label">应用版本</span>
                <span class="info-value">
                  {{ systemInfo.appVersion || '-' }}
                  <el-button
                    text
                    type="primary"
                    size="small"
                    :loading="updateStatus.status === 'checking'"
                    @click="handleCheckUpdate"
                    style="margin-left: 8px"
                  >
                    检查更新
                  </el-button>
                </span>
              </div>
              <div class="info-item">
                <span class="info-label">更新状态</span>
                <span class="info-value">
                  <template v-if="updateStatus.status === 'idle'">未检查</template>
                  <template v-else-if="updateStatus.status === 'checking'">正在检查...</template>
                  <template v-else-if="updateStatus.status === 'notavailable'">
                    <el-tag type="success" size="small">已是最新版本</el-tag>
                  </template>
                  <template v-else-if="updateStatus.status === 'available'">
                    <el-tag type="warning" size="small">
                      发现新版本 v{{ updateStatus.version }}
                    </el-tag>
                    <el-button
                      type="primary"
                      size="small"
                      @click="handleDownloadUpdate"
                      style="margin-left: 8px"
                    >
                      立即更新
                    </el-button>
                  </template>
                  <template v-else-if="updateStatus.status === 'downloading'">
                    <el-progress
                      :percentage="updateStatus.downloadProgress || 0"
                      :stroke-width="6"
                      style="width: 120px"
                    />
                  </template>
                  <template v-else-if="updateStatus.status === 'downloaded'">
                    <el-tag type="success" size="small">下载完成</el-tag>
                    <el-button
                      type="primary"
                      size="small"
                      @click="handleInstallUpdate"
                      style="margin-left: 8px"
                    >
                      立即安装
                    </el-button>
                  </template>
                  <template v-else-if="updateStatus.status === 'error'">
                    <el-tag type="danger" size="small">{{ updateStatus.error }}</el-tag>
                  </template>
                </span>
              </div>
              <div class="info-item">
                <span class="info-label">Electron 版本</span>
                <span class="info-value">{{ systemInfo.electronVersion || '-' }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Node.js 版本</span>
                <span class="info-value">{{ systemInfo.nodeVersion || '-' }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">运行平台</span>
                <span class="info-value">{{ systemInfo.platform || '-' }}</span>
              </div>
            </div>
          </div>

          <div class="card p-md mt-md">
            <div class="settings-section-title">关于</div>
            <div class="about-content">
              <p>
                <strong>JSecProbe</strong>
              </p>
              <p>
                本系统以《GB/T 22239-2019 信息安全技术 网络安全等级保护基本要求》等国家标准为基础，
                支持电力/金融等行业扩展标准的动态接入，用于辅助测评人员完成等级保护现场测评工作。
              </p>
              <p class="about-tip">
                <el-icon><InfoFilled /></el-icon>
                测评过程中请严格遵守相关法律法规和保密规定。
              </p>
            </div>
          </div>
        </el-col>
      </el-row>
    </template>

    <!-- 用户管理 -->
    <template v-if="activeTab === 'users'">
      <div class="card p-md">
        <div class="toolbar">
          <div class="toolbar-left">
            <div class="settings-section-title" style="margin-bottom: 0">用户列表</div>
          </div>
          <div class="toolbar-right">
            <el-button type="primary" :icon="Plus" @click="handleNewUser">
              新增用户
            </el-button>
          </div>
        </div>

        <el-table :data="userList" v-loading="userLoading" stripe>
          <el-table-column prop="username" label="用户名" width="140" />
          <el-table-column prop="realName" label="姓名" width="120" />
          <el-table-column prop="email" label="邮箱" min-width="180" />
          <el-table-column prop="phone" label="电话" width="140" />
          <el-table-column prop="role" label="角色" width="100">
            <template #default="{ row }">
              <el-tag :type="row.role === 'admin' ? 'danger' : 'primary'" size="small">
                {{ row.role === 'admin' ? '管理员' : '测评师' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="isActive" label="状态" width="80">
            <template #default="{ row }">
              <el-tag :type="row.isActive ? 'success' : 'info'" size="small">
                {{ row.isActive ? '启用' : '禁用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="lastLoginAt" label="最后登录" width="160">
            <template #default="{ row }">
              {{ row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString('zh-CN') : '-' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button type="primary" link size="small" @click="handleEditUser(row)">
                编辑
              </el-button>
              <el-button
                :type="row.isActive ? 'warning' : 'success'"
                link
                size="small"
                @click="handleToggleUser(row)"
              >
                {{ row.isActive ? '禁用' : '启用' }}
              </el-button>
              <el-button
                v-if="row.role !== 'admin'"
                type="danger"
                link
                size="small"
                @click="handleDeleteUser(row)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <el-dialog v-model="showUserDialog" :title="editingUser ? '编辑用户' : '新增用户'" width="460px" destroy-on-close>
        <el-form :model="userForm" label-width="90px">
          <el-form-item label="用户名" required>
            <el-input v-model="userForm.username" placeholder="请输入用户名" :disabled="!!editingUser" />
          </el-form-item>
          <el-form-item label="密码" :required="!editingUser">
            <el-input v-model="userForm.password" type="password" show-password :placeholder="editingUser ? '留空则不修改' : '请输入密码'" />
          </el-form-item>
          <el-form-item label="姓名" required>
            <el-input v-model="userForm.realName" placeholder="请输入真实姓名" />
          </el-form-item>
          <el-form-item label="邮箱">
            <el-input v-model="userForm.email" placeholder="请输入邮箱" />
          </el-form-item>
          <el-form-item label="电话">
            <el-input v-model="userForm.phone" placeholder="请输入电话" />
          </el-form-item>
          <el-form-item label="角色">
            <el-select v-model="userForm.role" style="width: 100%">
              <el-option label="管理员" value="admin" />
              <el-option label="测评师" value="assessor" />
            </el-select>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showUserDialog = false">取消</el-button>
          <el-button type="primary" @click="handleSaveUser" :loading="userSaving">保存</el-button>
        </template>
      </el-dialog>
    </template>

    <!-- 操作日志 -->
    <template v-if="activeTab === 'logs'">
      <div class="card p-md">
        <div class="toolbar">
          <div class="toolbar-left">
            <div class="settings-section-title" style="margin-bottom: 0">操作日志</div>
          </div>
          <div class="toolbar-right">
            <el-select v-model="logModule" style="width: 140px" placeholder="模块筛选" clearable @change="loadLogs">
              <el-option v-for="m in logModules" :key="m.value" :label="m.label" :value="m.value" />
            </el-select>
            <el-select v-model="logAction" style="width: 120px" placeholder="操作筛选" clearable @change="loadLogs">
              <el-option v-for="a in logActions" :key="a.value" :label="a.label" :value="a.value" />
            </el-select>
            <el-button :icon="Refresh" @click="loadLogs">刷新</el-button>
          </div>
        </div>

        <el-table :data="logList" v-loading="logLoading" stripe>
          <el-table-column prop="createdAt" label="时间" width="160">
            <template #default="{ row }">
              {{ new Date(row.createdAt).toLocaleString('zh-CN') }}
            </template>
          </el-table-column>
          <el-table-column prop="username" label="用户" width="100" />
          <el-table-column prop="module" label="模块" width="100" />
          <el-table-column prop="action" label="操作" width="100" />
          <el-table-column prop="targetName" label="目标" width="150" />
          <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        </el-table>

        <div class="pagination-wrapper">
          <span class="total-text">共 {{ logTotal }} 条</span>
          <el-pagination
            v-model:current-page="logPage"
            :total="logTotal"
            size="small"
            :page-size="30"
            layout="prev, pager, next"
            @current-change="loadLogs"
          />
        </div>
      </div>
    </template>

    <!-- 标准库管理 -->
    <template v-if="activeTab === 'standards'">
      <el-tabs v-model="standardsSubTab" type="border-card" style="margin-bottom: 16px">
        <el-tab-pane label="标准库列表" name="list" />
        <el-tab-pane name="compare">
          <template #label>
            <span style="display: inline-flex; align-items: center; gap: 6px">
              对照视图
            </span>
          </template>
        </el-tab-pane>
      </el-tabs>

      <!-- 列表 Tab -->
      <template v-if="standardsSubTab === 'list'">
        <div class="card p-md">
          <div class="toolbar">
            <div class="toolbar-left">
              <div class="settings-section-title" style="margin-bottom: 0">标准库列表</div>
            </div>
            <div class="toolbar-right">
              <el-input
                v-model="standardKeyword"
                placeholder="搜索标准库名称/代号..."
                clearable
                style="width: 220px"
                @input="filterStandards"
              >
                <template #prefix>
                  <el-icon><Search /></el-icon>
                </template>
              </el-input>
              <!-- 1) 导入标准 -->
              <el-button :icon="Upload" @click="handleImportStandard">导入标准</el-button>
              <!-- 2) 导出标准（拆分按钮）：主按钮→按勾选导出 JSON；下拉菜单：JSON × 4 粒度 + Excel × 4 粒度 + 行级导出 -->
              <el-dropdown
                trigger="click"
                type="primary"
                :icon="Download"
                split-button
                @click="handleExportStandards(undefined, 'json')"
                @command="onExportDropdownCommand"
                :disabled="standardList.length === 0"
              >
                <span style="display: inline-flex; align-items: center; gap: 6px">
                  <el-icon><Download /></el-icon>
                  {{ selectedStandards.length > 0 ? `导出已选（${selectedStandards.length}，JSON）` : '导出标准（JSON）' }}
                </span>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item :class="['is-disabled','is-group-title']">📄 导出 JSON（可直接「导入标准」回灌）</el-dropdown-item>
                    <el-dropdown-item :command="{ format:'json', mode:'export-all' }">&nbsp;&nbsp;· 导出全部标准 JSON（{{ standardList.length }}）</el-dropdown-item>
                    <el-dropdown-item
                      :command="{ format:'json', mode:'export-selected' }"
                      :class="{ 'is-disabled': selectedStandards.length === 0 }"
                    >&nbsp;&nbsp;· 导出勾选的标准 JSON（{{ selectedStandards.length }}）</el-dropdown-item>
                    <el-dropdown-item
                      :command="{ format:'json', mode:'export-default' }"
                      :class="{ 'is-disabled': !standardList.some((s: any) => Number(s.isDefault) === 1) }"
                    >&nbsp;&nbsp;· 仅导出默认标准 JSON</el-dropdown-item>
                    <el-dropdown-item
                      :command="{ format:'json', mode:'export-industry' }"
                      :class="{ 'is-disabled': !standardList.some((s: any) => s.standardType === 'industry') }"
                    >&nbsp;&nbsp;· 仅导出行业标准 JSON</el-dropdown-item>
                    <el-dropdown-item divided :class="['is-disabled','is-group-title']">📘 导出 Excel（可手工修改/打印/分发）</el-dropdown-item>
                    <el-dropdown-item :command="{ format:'excel', mode:'export-all' }">&nbsp;&nbsp;· 导出全部标准 Excel（{{ standardList.length }}→zip）</el-dropdown-item>
                    <el-dropdown-item
                      :command="{ format:'excel', mode:'export-selected' }"
                      :class="{ 'is-disabled': selectedStandards.length === 0 }"
                    >&nbsp;&nbsp;· 导出勾选的标准 Excel（{{ selectedStandards.length }}）</el-dropdown-item>
                    <el-dropdown-item
                      :command="{ format:'excel', mode:'export-default' }"
                      :class="{ 'is-disabled': !standardList.some((s: any) => Number(s.isDefault) === 1) }"
                    >&nbsp;&nbsp;· 仅导出默认标准 Excel（xlsx）</el-dropdown-item>
                    <el-dropdown-item
                      :command="{ format:'excel', mode:'export-industry' }"
                      :class="{ 'is-disabled': !standardList.some((s: any) => s.standardType === 'industry') }"
                    >&nbsp;&nbsp;· 仅导出行业标准 Excel</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <!-- 3) 下载导入模板（拆分按钮）+ 尾部 新建标准 -->
              <el-dropdown split-button @click="handleDownloadTemplate('excel', 'national')" @command="onTemplateDropdownCommand">
                <span style="display: inline-flex; align-items: center; gap: 6px">
                  <el-icon><MoreFilled /></el-icon>
                  下载导入模板
                </span>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item :command="{ action: 'template', kind: 'excel', preset: 'national' }">📘 Excel 模板（GB/T 22239 三级 · 含十大安全域）</el-dropdown-item>
                    <el-dropdown-item :command="{ action: 'template', kind: 'json', preset: 'national' }">📄 JSON 示例（GB/T 22239 三级 · 含十大安全域）</el-dropdown-item>
                    <el-dropdown-item divided :command="{ action: 'create' }">
                      <span style="display: inline-flex; align-items: center; gap: 6px">
                        <el-icon><Plus /></el-icon>
                        手动新建空标准（不填 Excel/JSON）
                      </span>
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <el-button :icon="Refresh" @click="loadStandards">刷新</el-button>
            </div>
          </div>

          <el-table :data="filteredStandardList" v-loading="standardLoading" stripe @selection-change="handleStandardSelection">
            <el-table-column type="selection" width="48" align="center" />
            <el-table-column prop="name" label="名称" min-width="200" show-overflow-tooltip />
            <el-table-column prop="code" label="代号" width="160" show-overflow-tooltip />
            <el-table-column prop="version" label="版本" width="80" align="center" />
            <el-table-column label="类型" width="90" align="center">
              <template #default="{ row }">
                <el-tag
                  :type="row.standardType === 'industry' ? 'warning' : 'success'"
                  size="small"
                >
                  {{ row.standardType === 'industry' ? '行标' : '国标' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="industry" label="行业" width="90" align="center">
              <template #default="{ row }">
                <span>{{ row.industry || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="等级" width="84" align="center">
              <template #default="{ row }">
                <span>{{ row.levelCombo || ('S' + row.grade + 'A' + row.grade + 'G' + row.grade) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="itemCount" label="控制点" width="80" align="center" />
            <el-table-column label="来源" width="90" align="center">
              <template #default="{ row }">
                <el-tag :type="row.source === 'builtin' ? 'info' : (row.source === 'imported' ? 'warning' : 'success')" size="small">
                  {{ row.source === 'builtin' ? '内置' : row.source === 'imported' ? '导入' : '手动' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90" align="center">
              <template #default="{ row }">
                <el-tag :type="row.isDefault ? 'success' : 'info'" size="small">
                  {{ row.isDefault ? '默认' : '可用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="240" fixed="right" align="center">
              <template #default="{ row }">
                <el-tooltip content="设为默认标准库" placement="top">
                  <el-icon
                    v-if="!row.isDefault"
                    class="star-icon"
                    :size="16"
                    @click="handleSetDefault(row)"
                  ><Star /></el-icon>
                </el-tooltip>
                <el-tooltip content="编辑标准信息" placement="top">
                  <el-icon class="edit-icon" :size="16" @click="handleEditStandard(row)"><Edit /></el-icon>
                </el-tooltip>
                <el-tooltip content="导出标准 JSON" placement="top">
                  <el-icon class="export-icon" :size="16" @click="handleExportStandard(row, 'json')"><Download /></el-icon>
                </el-tooltip>
                <el-tooltip content="导出标准 Excel（含全部测评项，可回灌）" placement="top">
                  <el-icon class="export-icon" :size="16" @click="handleExportStandard(row, 'excel')" :style="{ color: '#23c08a' }"><MoreFilled /></el-icon>
                </el-tooltip>
                <el-tooltip
                  :content="row.source === 'builtin' ? '系统预置标准库，不可删除' : '删除标准库'"
                  placement="top"
                >
                  <el-icon
                    :class="row.source === 'builtin' ? 'lock-icon' : 'delete-icon'"
                    :size="16"
                    @click="row.source === 'builtin' ? null : handleDeleteStandard(row)"
                  >
                    <component :is="row.source === 'builtin' ? Lock : Delete" />
                  </el-icon>
                </el-tooltip>
              </template>
            </el-table-column>
          </el-table>

          <div v-if="selectedStandards.length > 0" style="margin-top: 10px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
            <el-tag type="info" size="small">已选 {{ selectedStandards.length }} 项</el-tag>
            <el-button
              type="warning"
              size="small"
              :disabled="selectedStandards.length !== 2"
              @click="openCompareWithSelected"
            >
              {{ selectedStandards.length === 2 ? '打开对照视图（已选 2 个）' : `请恰好选择 2 个标准（当前 ${selectedStandards.length}）` }}
            </el-button>
            <el-button
              size="small"
              :icon="Download"
              type="primary"
              plain
              :disabled="selectedStandards.length === 0"
              @click="handleExportStandards('export-selected', 'json')"
            >
              批量导出勾选（JSON，{{ selectedStandards.length }}）
            </el-button>
            <el-button
              size="small"
              :icon="MoreFilled"
              type="success"
              plain
              :disabled="selectedStandards.length === 0"
              @click="handleExportStandards('export-selected', 'excel')"
            >
              批量导出勾选（Excel，{{ selectedStandards.length }}）
            </el-button>
          </div>
        </div>
      </template>

      <!-- 对照 Tab -->
      <template v-else-if="standardsSubTab === 'compare'">
        <div class="card p-md">
          <div class="toolbar">
            <div class="toolbar-left">
              <div class="settings-section-title" style="margin-bottom: 0">行标-国标对照关系表</div>
            </div>
            <div class="toolbar-right">
              <!-- 优化 1：下拉改用 filteredStandardList，支持搜索联动；标准不足 2 个时 disabled + 提示 -->
              <el-select
                v-model="compareLeftId"
                :placeholder="standardList.length < 2 ? '需至少 2 个标准才能对照' : '基准标准（左）'"
                :disabled="standardList.length < 2"
                clearable
                style="width: 280px"
              >
                <el-option
                  v-for="s in (standardKeyword.trim() ? filteredStandardList : standardList)"
                  :key="s.id"
                  :label="`${s.name}（${s.code}${s.industry ? ' · ' + s.industry : ''}${s.isDefault ? ' · 默认' : ''}）`"
                  :value="s.id"
                />
              </el-select>
              <span style="color: #909399; padding: 0 4px">VS</span>
              <el-select
                v-model="compareRightId"
                :placeholder="standardList.length < 2 ? '请先导入/新建至少 2 个标准' : '对照标准（右）'"
                :disabled="standardList.length < 2"
                clearable
                style="width: 280px"
              >
                <el-option
                  v-for="s in (standardKeyword.trim() ? filteredStandardList : standardList)"
                  :key="s.id"
                  :label="`${s.name}（${s.code}${s.industry ? ' · ' + s.industry : ''}${s.isDefault ? ' · 默认' : ''}）`"
                  :value="s.id"
                />
              </el-select>
              <el-button type="primary" :disabled="!compareLeftId || !compareRightId || compareLeftId === compareRightId || standardList.length < 2" :loading="compareLoading" @click="runCompare">
                执行对照
              </el-button>
              <el-button
                :icon="Download"
                :disabled="!compareResult"
                @click="exportCompareMarkdown"
              >
                导出 Markdown
              </el-button>
              <el-button :icon="Refresh" @click="resetCompare">重置</el-button>
            </div>
          </div>

          <!-- 优化 2：空库/不足引导（切到对照 Tab 先显示这个，再显示 el-empty） -->
          <el-alert
            v-if="standardList.length < 2"
            type="info"
            show-icon
            :closable="false"
            style="margin-bottom: 16px"
          >
            <template #title>
              当前标准库共 <b>{{ standardList.length }}</b> 个标准，对照功能需要至少 2 个（国标 + 行标）。可在「标准库列表」Tab 点击「导入标准」导入行业 JSON，或点击「新建标准」手动创建。
            </template>
          </el-alert>

          <div
            v-else-if="!compareLoading && !compareResult && standardList.length >= 2 && (!compareLeftId || !compareRightId)"
            class="compare-quick-hint"
            style="margin: 12px 0 18px 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center"
          >
            <el-tag type="success" effect="plain" size="small">💡 快捷填充</el-tag>
            <el-button size="small" @click="quickPick('default-vs-first-industry')">默认标准 vs 首个行标</el-button>
            <el-button size="small" @click="quickPick('newest-two')">最近两个标准</el-button>
            <el-button size="small" @click="quickPick('national-highest-vs-industry')">最高等级国标 vs 任意行标</el-button>
            <span class="muted" style="margin-left: auto">也可在「标准库列表」选中 2 行后，点击下方「打开对照视图」按钮自动跳转。</span>
          </div>

          <el-empty v-if="standardList.length >= 2 && !compareLoading && !compareResult" description="请在上方选择两个标准，点击「执行对照」开始比较" style="padding: 60px 0" />
          <div v-else-if="compareLoading || compareResult">
            <!-- 概览 -->
            <div v-if="compareResult" class="compare-overview" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0">
              <el-card shadow="hover">
                <div class="overview-label">控制点总数</div>
                <div class="overview-value">{{ compareResult.stats.totalControlPoints }}</div>
              </el-card>
              <el-card shadow="hover">
                <div class="overview-label">等级差异</div>
                <div class="overview-value" style="color: #e6a23c">{{ compareResult.stats.levelDiffCount }}</div>
              </el-card>
              <el-card shadow="hover">
                <div class="overview-label">要求文差异</div>
                <div class="overview-value" style="color: #e6a23c">{{ compareResult.stats.requirementDiffCount }}</div>
              </el-card>
              <el-card shadow="hover">
                <div class="overview-label">行业扩展</div>
                <div class="overview-value" style="color: #409eff">{{ compareResult.stats.extensionOnlyCount }}</div>
              </el-card>
            </div>

            <el-table v-loading="compareLoading" :data="compareRows" stripe size="small" style="width: 100%" max-height="70vh">
              <el-table-column label="对照域" width="90" align="center">
                <template #default="{ row }">
                  <el-tag :type="row.tag === 'LEVEL_DIFF' ? 'warning' : row.tag === 'REQ_DIFF' ? 'danger' : row.tag === 'LEFT_ONLY' ? 'primary' : row.tag === 'RIGHT_ONLY' ? 'success' : 'info'" size="small">
                    {{ row.tagLabel }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="controlPoint" label="控制点" min-width="180" show-overflow-tooltip />
              <el-table-column label="基准：{{ compareLabels.left }}" min-width="240">
                <template #default="{ row }">
                  <div v-if="row.left" style="font-size: 13px; line-height: 1.5">
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px">
                      <span class="muted">{{ row.left.domain }} / {{ row.left.itemType }}</span>
                      <el-tag size="small" effect="plain">L{{ row.left.level }}</el-tag>
                    </div>
                    <div v-if="row.levelDiff" style="color: #e6a23c; margin-bottom: 4px">
                      ● 等级：L{{ row.left.level }} → L{{ row.right?.level }}
                    </div>
                    <div class="muted" v-if="row.reqDiff" style="color: #f56c6c; margin-bottom: 4px">
                      ● 要求文本不同
                    </div>
                    <div style="white-space: pre-wrap">{{ row.left.requirement }}</div>
                  </div>
                  <span v-else class="muted">— 无此控制点</span>
                </template>
              </el-table-column>
              <el-table-column label="对照：{{ compareLabels.right }}" min-width="240">
                <template #default="{ row }">
                  <div v-if="row.right" style="font-size: 13px; line-height: 1.5">
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px">
                      <span class="muted">{{ row.right.domain }} / {{ row.right.itemType }}</span>
                      <el-tag size="small" effect="plain">L{{ row.right.level }}</el-tag>
                    </div>
                    <div style="white-space: pre-wrap">{{ row.right.requirement }}</div>
                  </div>
                  <span v-else class="muted">— 无此控制点</span>
                </template>
              </el-table-column>
              <el-table-column label="扩展说明" min-width="200">
                <template #default="{ row }">
                  <span v-if="row.tag === 'RIGHT_ONLY' || row.tag === 'LEFT_ONLY'">
                    {{ row.tag === 'RIGHT_ONLY' ? compareLabels.right : compareLabels.left }} 独有的控制点
                  </span>
                  <span v-else-if="row.tag === 'IDENTICAL'">完全一致</span>
                  <span v-else class="muted">—</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </template>

      <!-- 新建/编辑标准对话框 -->
      <el-dialog
        v-model="showStandardDialog"
        :title="editingStandardId ? '编辑标准' : '新建标准'"
        width="560px"
        @close="resetStandardForm"
      >
        <el-form :model="standardForm" label-width="90px" class="standard-form">
          <el-form-item label="标准名称" required>
            <el-input v-model="standardForm.name" placeholder="如：信息安全技术 网络安全等级保护基本要求" />
          </el-form-item>
          <el-form-item label="标准代号" required>
            <el-input v-model="standardForm.code" placeholder="如：GB/T 22239-2019-L3" :disabled="!!editingStandardId" />
            <div class="form-tip" v-if="editingStandardId">代号不可修改（作为唯一标识）</div>
          </el-form-item>
          <el-form-item label="版本号" required>
            <el-input v-model="standardForm.version" placeholder="如：2019" style="width: 200px" />
          </el-form-item>
          <el-form-item label="适用等级" required>
            <el-select
              v-model="standardForm.levelCombo"
              style="width: 260px"
              placeholder="选择 S/A/G 等级组合"
              @change="onLevelComboChange"
            >
              <el-option
                v-for="c in LEVEL_COMBOS"
                :key="c.value"
                :value="c.value"
                :label="`${c.label}（第 ${c.grade} 级）`"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="标准类型" required>
            <el-radio-group v-model="standardForm.standardType">
              <el-radio value="national">国标</el-radio>
              <el-radio value="industry">行标</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="所属行业">
            <el-input v-model="standardForm.industry" placeholder="如：电力、金融、医疗、电信、政务" style="width: 200px" />
          </el-form-item>
          <el-form-item label="标准描述">
            <el-input
              v-model="standardForm.description"
              type="textarea"
              :rows="3"
              placeholder="标准简介、适用范围等"
            />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showStandardDialog = false">取消</el-button>
          <el-button type="primary" :loading="standardSaving" @click="handleSaveStandard">
            {{ editingStandardId ? '保存' : '创建' }}
          </el-button>
        </template>
      </el-dialog>
    </template>

    <!-- 系统维护（方案 §九.496 可选：孤儿截图清理 + 其它） -->
    <template v-if="activeTab === 'maintenance'">
      <div class="card p-md" style="margin-bottom: 16px">
        <div class="toolbar" style="margin-bottom: 16px">
          <div class="toolbar-left">
            <div class="settings-section-title" style="margin-bottom: 0">孤儿截图 & 证据清理</div>
          </div>
          <div class="toolbar-right">
            <el-button :icon="Refresh" @click="runScreenshotCleanup(true)" :loading="screenshotCleanup.loading">
              扫描预览（dryRun）
            </el-button>
            <el-button
              type="danger"
              :disabled="!screenshotCleanup.result || !screenshotCleanup.result.orphanCount"
              :loading="screenshotCleanup.deleting"
              @click="confirmRunScreenshotDelete"
            >
              执行清理（永久删除，不可恢复）
            </el-button>
          </div>
        </div>
        <p class="muted" style="margin: 0 0 16px 0">
          扫描数据目录下 <code>screenshots/</code> 与 <code>evidence/</code> 目录，识别<strong>不被任何测评记录 screenshotPaths 引用</strong>的孤儿文件（含 screenshots/temp 下超过 24 小时的过期临时文件），可预览后再执行删除，确保不丢数据。
        </p>
        <div v-if="screenshotCleanup.loading" class="muted">正在扫描并计算引用，请稍候...</div>
        <el-row v-else-if="screenshotCleanup.result" :gutter="12" style="margin-bottom: 12px">
          <el-col :span="6">
            <el-card shadow="hover">
              <div class="overview-label">扫描文件总数</div>
              <div class="overview-value">{{ screenshotCleanup.result.totalScanned }}</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="hover">
              <div class="overview-label">已被引用</div>
              <div class="overview-value" style="color:#67c23a">{{ screenshotCleanup.result.totalReferenced }}</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="hover">
              <div class="overview-label">孤儿文件数量</div>
              <div class="overview-value" style="color:#e6a23c">{{ screenshotCleanup.result.orphanCount }}</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="hover">
              <div class="overview-label">可释放空间</div>
              <div class="overview-value" style="color:#f56c6c">{{ formatBytes(screenshotCleanup.result.orphanSizeBytes) }}</div>
            </el-card>
          </el-col>
        </el-row>
        <div v-if="screenshotCleanup.result" style="color:#606266;font-size:13px;margin-bottom:12px">
          扫描目录：<code style="margin-right:8px">{{ screenshotCleanup.result.scannedDirs.join('；') }}</code>
          <span v-if="screenshotCleanup.result.tempCleanupCount"> · 过期 temp 文件 <b>{{ screenshotCleanup.result.tempCleanupCount }}</b> 个</span>
          <span v-if="screenshotCleanup.result.emptyDirsRemoved"> · 已清空目录 <b>{{ screenshotCleanup.result.emptyDirsRemoved }}</b> 个</span>
          <span v-if="screenshotCleanup.result.deleted && screenshotCleanup.result.deleted.length"> · 已删除 <b>{{ screenshotCleanup.result.deleted.length }}</b>，失败 <b>{{ screenshotCleanup.result.failed?.length || 0 }}</b></span>
        </div>
        <el-table
          v-if="screenshotCleanup.result && screenshotCleanup.result.orphans && screenshotCleanup.result.orphans.length"
          :data="screenshotCleanup.result.orphans"
          stripe
          size="small"
          max-height="50vh"
        >
          <el-table-column label="序号" type="index" width="60" align="center" />
          <el-table-column label="文件路径" min-width="420" show-overflow-tooltip>
            <template #default="{ row }">{{ row.absPath }}</template>
          </el-table-column>
          <el-table-column label="大小" width="110" align="right">
            <template #default="{ row }">{{ formatBytes(row.size) }}</template>
          </el-table-column>
          <el-table-column label="修改时间" width="180" align="center">
            <template #default="{ row }">{{ formatDate(row.mtime) }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-else-if="screenshotCleanup.result && !screenshotCleanup.result.orphanCount" description="没有发现任何孤儿截图，您的数据目录很干净 ✅" style="padding: 40px 0" />
      </div>
    </template>

    <el-dialog
      v-model="showRestoreDialog"
      title="数据恢复"
      width="420px"
      :close-on-click-modal="false"
      @close="clearAllProjects"
    >
      <div class="restore-dialog-content">
        <div v-if="backupPreview" class="backup-preview-section">
          <div class="preview-time">备份时间: {{ formatBackupTime(backupPreview.manifest?.timestamp) }}</div>
          <div class="preview-summary">
            包含 {{ backupPreview.projects?.length || 0 }} 个项目，{{ backupPreview.totalRecords || 0 }} 条测评记录
          </div>
        </div>

        <div class="restore-mode-section">
          <el-radio-group v-model="restoreMode">
            <el-radio value="incremental">
              <span class="mode-name">增量恢复</span>
              <span class="mode-tag recommended">推荐</span>
            </el-radio>
            <el-radio value="full">
              <span class="mode-name">完全恢复</span>
              <span class="mode-tag dangerous">危险</span>
            </el-radio>
          </el-radio-group>
        </div>

        <div v-if="backupPreview?.projects?.length" class="project-selection">
          <div class="selection-title">选择项目:</div>
          <el-checkbox-group v-model="selectedProjectIds" class="project-checkboxes">
            <el-checkbox
              v-for="project in backupPreview.projects"
              :key="project.id"
              :label="project.id"
              :disabled="restoreMode === 'full'"
            >
              <span class="project-name">{{ project.name }}</span>
              <span class="project-level">({{ project.level }}级)</span>
              <span class="project-count">{{ project.recordCount }}条记录</span>
            </el-checkbox>
          </el-checkbox-group>
        </div>
      </div>

      <template #footer>
        <el-button @click="showRestoreDialog = false; clearAllProjects()">取消</el-button>
        <el-button
          type="primary"
          :disabled="restoreMode === 'incremental' && selectedProjectIds.length === 0"
          @click="confirmRestore"
        >
          确认恢复
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, watch } from 'vue';
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus';
import DOMPurify from 'dompurify';
import { Download, Upload, InfoFilled, Plus, Refresh, Search, Lock, Star, Edit, Delete, MoreFilled } from '@element-plus/icons-vue';
import { applyPrimaryColor, getSavedPrimaryColor, clearPrimaryColor, DEFAULT_PRIMARY_COLOR } from '@/utils/theme';
import type { UpdateStatus } from '../../../shared/types';

const tabs = [
  { key: 'settings', label: '常规设置' },
  { key: 'users', label: '用户管理' },
  { key: 'logs', label: '操作日志' },
  { key: 'standards', label: '标准库管理' },
  { key: 'maintenance', label: '系统维护' },
];
const activeTab = ref('settings');

const themeMode = ref('light');
const primaryColor = ref(DEFAULT_PRIMARY_COLOR);
const dataPath = ref('');
const systemInfo = reactive({
  appVersion: '',
  electronVersion: '',
  nodeVersion: '',
  platform: '',
  dataPath: '',
});

// User management
const userList = ref<any[]>([]);
const userLoading = ref(false);
const userSaving = ref(false);
const showUserDialog = ref(false);
const editingUser = ref<any>(null);
const userForm = reactive({
  username: '',
  password: '',
  realName: '',
  email: '',
  phone: '',
  role: 'assessor',
});

// Log management
const logList = ref<any[]>([]);
const logLoading = ref(false);
const logTotal = ref(0);
const logPage = ref(1);
const logModule = ref('');
const logAction = ref('');
const logModules = [
  { value: 'project', label: '项目管理' },
  { value: 'asset', label: '资产管理' },
  { value: 'assessment', label: '现场核查' },
  { value: 'issue', label: '问题管理' },
  { value: 'knowledge', label: '知识库' },
  { value: 'auth', label: '认证管理' },
  { value: 'system', label: '系统管理' },
];
const logActions = [
  { value: 'create', label: '创建' },
  { value: 'update', label: '更新' },
  { value: 'delete', label: '删除' },
  { value: 'login', label: '登录' },
  { value: 'logout', label: '登出' },
  { value: 'export', label: '导出' },
  { value: 'import', label: '导入' },
  { value: 'backup', label: '备份' },
  { value: 'restore', label: '恢复' },
];

function handleThemeChange(val: string) {
  localStorage.setItem('themeMode', val);
  applyTheme(val);
  ElMessage.success('主题设置已保存');
}

function handlePrimaryColorChange(val: string | null) {
  if (val) {
    const applied = applyPrimaryColor(val);
    if (!applied) {
      ElMessage.error('无法识别的颜色值');
      return;
    }
    localStorage.setItem('primaryColor', val);
    ElMessage.success('主题色已更新');
  } else {
    clearPrimaryColor();
    primaryColor.value = DEFAULT_PRIMARY_COLOR;
    ElMessage.success('主题色已恢复默认');
  }
}

function applyTheme(mode: string) {
  const html = document.documentElement;
  if (mode === 'dark') {
    html.classList.add('dark');
    html.setAttribute('data-theme', 'dark');
  } else if (mode === 'light') {
    html.classList.remove('dark');
    html.setAttribute('data-theme', 'light');
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      html.classList.add('dark');
      html.setAttribute('data-theme', 'dark');
    } else {
      html.classList.remove('dark');
      html.setAttribute('data-theme', 'light');
    }
  }
}

const backupPreview = ref<any>(null);
const showRestoreDialog = ref(false);
const selectedBackupPath = ref('');
const restoreMode = ref<'full' | 'incremental'>('full');
const selectedProjectIds = ref<string[]>([]);

async function handleBackup() {
  try {
    const now = new Date();
    const defaultFileName = `JSecProbe_backup_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.zip`;
    
    const saveRes = await window.api.system.saveFile(defaultFileName, [
      { name: '备份文件', extensions: ['zip'] },
    ]);
    
    if (!saveRes.success || !saveRes.data) {
      return;
    }
    
    const backupRes = await window.api.system.backupData(saveRes.data);
    if (backupRes.success && backupRes.data) {
      ElMessage.success(`备份成功，文件已保存至: ${backupRes.data}`);
    } else {
      ElMessage.error(backupRes.error?.message || '备份失败');
    }
  } catch (err: any) {
    ElMessage.error(err.message || '备份失败');
  }
}

async function handleRestore() {
  try {
    const fileRes = await window.api.system.selectFile([
      { name: '备份文件', extensions: ['zip', 'db', 'sqlite', 'sqlite3'] },
    ]);
    
    if (!fileRes.success || !fileRes.data) {
      return;
    }
    
    const filePath = String(fileRes.data);
    selectedBackupPath.value = filePath;
    backupPreview.value = null;
    selectedProjectIds.value = [];
    restoreMode.value = 'full';
    
    if (filePath.endsWith('.zip')) {
      const previewRes = await window.api.system.previewBackup(filePath);
      if (previewRes.success && previewRes.data) {
        backupPreview.value = previewRes.data;
      }
    }
    
    showRestoreDialog.value = true;
  } catch {
    // User cancelled
  }
}

function formatBackupTime(timestamp?: string): string {
  if (!timestamp) return '未知';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

watch(restoreMode, (newMode) => {
  if (!backupPreview.value?.projects) return;
  
  if (newMode === 'full') {
    selectedProjectIds.value = backupPreview.value.projects.map((p: any) => p.id);
  } else if (newMode === 'incremental' && selectedProjectIds.value.length === 0) {
    selectedProjectIds.value = backupPreview.value.projects.length > 0 
      ? [backupPreview.value.projects[0].id] 
      : [];
  }
});

async function confirmRestore() {
  try {
    const confirmMessage = restoreMode.value === 'full' 
      ? '完整恢复将覆盖当前所有数据，此操作不可撤销，确定继续吗？'
      : '增量恢复将合并备份中的项目数据，确定继续吗？';
    
    await ElMessageBox.confirm(confirmMessage, '确认恢复', {
      type: 'warning',
      confirmButtonText: '确定恢复',
      cancelButtonText: '取消',
    });
    
    let options: { incremental: boolean; projectIds?: string[] } | undefined;
    if (restoreMode.value === 'incremental') {
      options = {
        incremental: true,
        projectIds: selectedProjectIds.value.length > 0 
          ? JSON.parse(JSON.stringify(selectedProjectIds.value)) 
          : undefined,
      };
    }
    
    const backupPath = String(selectedBackupPath.value);
    
    const restoreRes = await window.api.system.restoreData(backupPath, options);
    if (restoreRes.success) {
      showRestoreDialog.value = false;
      ElMessage.success('恢复成功，应用即将重启...');
    } else {
      ElMessage.error(restoreRes.error?.message || '恢复失败');
    }
  } catch (err: any) {
    if (err !== 'cancel' && err?.message !== 'cancel') {
      console.error('Restore error:', err);
      ElMessage.error(err?.message || '恢复失败');
    }
  }
}

function clearAllProjects() {
  selectedProjectIds.value = [];
}

async function handleOpenDataFolder() {
  await window.api.system.openDataFolder();
}

async function handleChangeDataPath() {
  try {
    const dialogRes = await window.api.dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择数据存储目录',
    });

    if (!dialogRes.success) {
      ElMessage.error(dialogRes.error?.message || '打开选择对话框失败');
      return;
    }

    if (dialogRes.data?.canceled || !dialogRes.data?.filePaths?.length) {
      return;
    }

    const newPath = dialogRes.data.filePaths[0];

    await ElMessageBox.confirm(
      `确定将数据存储位置更改为:\n${newPath}\n\n系统将自动复制数据库文件并重启应用。`,
      '确认更改',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    );

    const changeRes = await window.api.system.changeDataPath(newPath);
    if (changeRes.success) {
      ElMessage.success('数据存储位置已更改，应用即将重启...');
    } else {
      ElMessage.error(changeRes.error?.message || '更改失败');
    }
  } catch (err: any) {
    ElMessage.error(err.message || '更改数据存储位置时发生错误');
  }
}

async function loadSystemInfo() {
  if (!window.api) return;
  const res = await window.api.system.getInfo();
  if (res.success && res.data) {
    Object.assign(systemInfo, res.data);
    dataPath.value = res.data.dataPath;
  }
}

const updateStatus = reactive<UpdateStatus>({
  status: 'idle',
});

let removeStatusListener: (() => void) | null = null;

async function handleCheckUpdate() {
  if (!window.api?.update) return;
  try {
    await window.api.update.check();
  } catch (err: any) {
    ElMessage.error(err.message || '检查更新失败');
  }
}

async function handleDownloadUpdate() {
  if (!window.api?.update) return;
  try {
    await ElMessageBox.confirm(
      `发现新版本 v${updateStatus.version}，是否立即下载更新？`,
      '发现新版本',
      {
        type: 'info',
        confirmButtonText: '立即下载',
        cancelButtonText: '稍后再说',
      }
    );
    await window.api.update.download();
  } catch {
    // User cancelled
  }
}

async function handleInstallUpdate() {
  if (!window.api?.update) return;
  try {
    await ElMessageBox.confirm(
      '更新包已下载完成，是否立即安装并重启应用？',
      '安装更新',
      {
        type: 'success',
        confirmButtonText: '立即安装',
        cancelButtonText: '稍后安装',
      }
    );
    await window.api.update.install();
  } catch {
    // User cancelled
  }
}

function initUpdateListener() {
  if (!window.api?.update) return;
  removeStatusListener = window.api.update.onStatusChange((status: UpdateStatus) => {
    Object.assign(updateStatus, status);
    if (status.status === 'error') {
      ElMessage.error(status.error || '更新出错');
    } else if (status.status === 'notavailable') {
      ElMessage.success('当前已是最新版本');
    } else if (status.status === 'downloaded') {
      ElMessage.success('更新包下载完成');
    } else if (status.status === 'available') {
      const releaseNotesHtml = status.releaseNotes ? `<br/><br/>更新内容：<br/>${DOMPurify.sanitize(status.releaseNotes)}` : '';
      ElNotification({
        title: '发现新版本',
        message: `新版本 v${status.version} 已发布${releaseNotesHtml}`,
        type: 'info',
        duration: 10000,
        position: 'bottom-right',
        dangerouslyUseHTMLString: true,
      });
    }
  });
}

// User management
async function loadUsers() {
  if (!window.api) return;
  userLoading.value = true;
  try {
    const res = await window.api.user.list();
    if (res.success && res.data) {
      userList.value = res.data;
    }
  } finally {
    userLoading.value = false;
  }
}

function handleNewUser() {
  editingUser.value = null;
  userForm.username = '';
  userForm.password = '';
  userForm.realName = '';
  userForm.email = '';
  userForm.phone = '';
  userForm.role = 'assessor';
  showUserDialog.value = true;
}

function handleEditUser(user: any) {
  editingUser.value = user;
  Object.assign(userForm, {
    username: user.username,
    password: '',
    realName: user.realName,
    email: user.email || '',
    phone: user.phone || '',
    role: user.role,
  });
  showUserDialog.value = true;
}

async function handleSaveUser() {
  if (!userForm.username || !userForm.realName) {
    ElMessage.warning('请填写用户名和姓名');
    return;
  }
  if (!editingUser.value && !userForm.password) {
    ElMessage.warning('请填写密码');
    return;
  }
  userSaving.value = true;
  try {
    if (editingUser.value) {
      const updateData: any = {
        realName: userForm.realName,
        email: userForm.email || undefined,
        phone: userForm.phone || undefined,
        role: userForm.role,
      };
      if (userForm.password) updateData.password = userForm.password;
      const res = await window.api.user.update(editingUser.value.id, updateData);
      if (res.success) {
        ElMessage.success('更新成功');
        showUserDialog.value = false;
        loadUsers();
      } else {
        ElMessage.error(res.error?.message || '更新失败');
      }
    } else {
      const res = await window.api.user.create({
        username: userForm.username,
        password: userForm.password,
        realName: userForm.realName,
        email: userForm.email || undefined,
        phone: userForm.phone || undefined,
        role: userForm.role,
      });
      if (res.success) {
        ElMessage.success('创建成功');
        showUserDialog.value = false;
        loadUsers();
      } else {
        ElMessage.error(res.error?.message || '创建失败');
      }
    }
  } finally {
    userSaving.value = false;
  }
}

async function handleToggleUser(user: any) {
  const res = await window.api.user.update(user.id, { isActive: !user.isActive });
  if (res.success) {
    ElMessage.success(user.isActive ? '已禁用' : '已启用');
    loadUsers();
  } else {
    ElMessage.error(res.error?.message || '操作失败');
  }
}

async function handleDeleteUser(user: any) {
  try {
    await ElMessageBox.confirm(`确定要删除用户「${user.realName}」吗？`, '确认删除', {
      type: 'warning',
    });
  } catch {
    return;
  }
  const res = await window.api.user.delete(user.id);
  if (res.success) {
    ElMessage.success('删除成功');
    loadUsers();
  } else {
    ElMessage.error(res.error?.message || '删除失败');
  }
}

// Log management
async function loadLogs() {
  if (!window.api) return;
  logLoading.value = true;
  try {
    const params: any = { page: logPage.value, pageSize: 30 };
    if (logModule.value) params.module = logModule.value;
    if (logAction.value) params.action = logAction.value;
    const res = await window.api.log.list(params);
    if (res.success && res.data) {
      logList.value = res.data.list;
      logTotal.value = res.data.total;
    }
  } finally {
    logLoading.value = false;
  }
}

function loadSettings() {
  const savedTheme = localStorage.getItem('themeMode');
  if (savedTheme) {
    themeMode.value = savedTheme;
    applyTheme(savedTheme);
  }
  
  const savedColor = getSavedPrimaryColor();
  if (savedColor) {
    primaryColor.value = savedColor;
    applyPrimaryColor(savedColor);
  }
}

// Standard library management
const standardList = ref<any[]>([]);
const filteredStandardList = ref<any[]>([]);
const standardLoading = ref(false);
const standardKeyword = ref('');
const selectedStandards = ref<any[]>([]);
const standardsSubTab = ref<'list' | 'compare'>('list');
const compareLeftId = ref<string>('');
const compareRightId = ref<string>('');
const compareLoading = ref(false);
const compareResult = ref<any>(null);
const compareRows = ref<any[]>([]);
const compareLabels = reactive({ left: '左', right: '右' });

// === 系统维护：孤儿截图清理（方案 §九.496）===
const screenshotCleanup = reactive<{
  loading: boolean;
  deleting: boolean;
  result: null | {
    dryRun: boolean;
    scannedDirs: string[];
    totalScanned: number;
    totalReferenced: number;
    orphanCount: number;
    orphanSizeBytes: number;
    orphans: Array<{ absPath: string; size: number; mtime: number }>;
    deleted?: Array<{ absPath: string; size: number }>;
    failed?: Array<{ absPath: string; error: string }>;
    emptyDirsRemoved: number;
    tempCleanupCount: number;
  };
}>({ loading: false, deleting: false, result: null });

function formatBytes(bytes: number): string {
  if (bytes === 0 || !Number.isFinite(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 2)} ${sizes[i]}`;
}
function formatDate(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 渲染进程把 base64 文本解码为 Uint8Array（二进制字节）。
 * - 不使用 Node Buffer（Electron 渲染进程默认不注入、Vite 打包无 polyfill）
 * - 处理带 padding/不带 padding 的标准 base64（Excel 模板常见 ≥3KB 也无性能问题）
 */
function base64ToBytes(base64: string): Uint8Array {
  const clean = String(base64 || '').replace(/\s+/g, '');
  const binary = typeof atob === 'function' ? atob(clean) : BufferFromBase64BrowserFallback(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
// 兜底（极端环境无 atob 时的简易 base64→binary 纯 Web 解码，性能稍差但可工作）
function BufferFromBase64BrowserFallback(b64: string): string {
  // 手动解 base64 映射表（与 atob 输出一致：每个字符 code 即为字节值）
  const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = String(b64 || '').replace(/\s+/g, '').replace(/=+$/g, '');
  // 移除 base64url 差异（URL-safe："-" → "+"、"_" → "/"）
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c1 = ABC.indexOf(s.charAt(i++));
    const c2 = i < s.length ? ABC.indexOf(s.charAt(i++)) : -1;
    const c3 = i < s.length ? ABC.indexOf(s.charAt(i++)) : -1;
    const c4 = i < s.length ? ABC.indexOf(s.charAt(i++)) : -1;
    if (c1 < 0 || c2 < 0) break;
    const triple = (c1 << 18) | (c2 << 12) | ((c3 < 0 ? 0 : c3) << 6) | (c4 < 0 ? 0 : c4);
    out += String.fromCharCode((triple >> 16) & 0xff);
    if (c3 >= 0) out += String.fromCharCode((triple >> 8) & 0xff);
    if (c4 >= 0) out += String.fromCharCode(triple & 0xff);
  }
  return out;
}
async function runScreenshotCleanup(dryRun: boolean) {
  if (!window.api) return;
  screenshotCleanup.loading = true;
  screenshotCleanup.deleting = !dryRun;
  try {
    const res = await window.api.file.cleanupScreenshots({ dryRun });
    if (res.success && res.data) {
      screenshotCleanup.result = res.data as any;
      if (dryRun) {
        ElMessage.success(`扫描完成：发现 ${res.data.orphanCount} 个孤儿文件（${formatBytes(res.data.orphanSizeBytes)}）`);
      } else {
        ElMessage.success(`清理完成：已删除 ${res.data.deleted?.length || 0} 个文件，失败 ${res.data.failed?.length || 0} 个，已清空空目录 ${res.data.emptyDirsRemoved} 个`);
      }
    } else {
      ElMessage.error(res.error?.message || '扫描/清理失败');
    }
  } catch (e: any) {
    ElMessage.error(e?.message || String(e));
  } finally {
    screenshotCleanup.loading = false;
    screenshotCleanup.deleting = false;
  }
}
async function confirmRunScreenshotDelete() {
  if (!screenshotCleanup.result || !screenshotCleanup.result.orphanCount) return;
  try {
    await ElMessageBox.confirm(
      `确认永久删除 ${screenshotCleanup.result.orphanCount} 个孤儿文件（共 ${formatBytes(screenshotCleanup.result.orphanSizeBytes)}）？此操作不可撤销，删除前请确认当前没有正在进行的现场核查/截图保存。`,
      '请再次确认永久删除',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消', dangerouslyUseHTMLString: false }
    );
    await runScreenshotCleanup(false);
  } catch {
    // 用户取消
  }
}

function handleStandardSelection(val: any[]) {
  selectedStandards.value = val;
}

function openCompareWithSelected() {
  if (selectedStandards.value.length !== 2) {
    ElMessage.warning('请恰好选择 2 个标准（支持按住 Ctrl 多选）');
    return;
  }
  compareLeftId.value = selectedStandards.value[0].id;
  compareRightId.value = selectedStandards.value[1].id;
  standardsSubTab.value = 'compare';
  runCompare().catch(() => {});
}

function resetCompare() {
  compareLeftId.value = '';
  compareRightId.value = '';
  compareResult.value = null;
  compareRows.value = [];
  compareLabels.left = '左';
  compareLabels.right = '右';
}

/**
 * 对照视图快捷填充（避免空状态下用户不知该怎么选）
 * 策略：只填 compareLeftId / compareRightId，不自动执行，用户再确认后自己点「执行对照」
 */
function quickPick(mode: 'default-vs-first-industry' | 'newest-two' | 'national-highest-vs-industry') {
  const list = standardList.value || [];
  if (list.length < 2) {
    ElMessage.warning('至少需要 2 个标准才能快捷填充');
    return;
  }
  let left: any = null;
  let right: any = null;

  if (mode === 'default-vs-first-industry') {
    left = list.find((s: any) => Number(s.isDefault) === 1) || list[0];
    const industries = list.filter((s: any) => s.standardType === 'industry' && s.id !== left.id);
    right = industries[0] || list.find((s: any) => s.id !== left.id);
  } else if (mode === 'newest-two') {
    // 按 createdAt 降序，取前 2 条；没有 createdAt 则直接用末尾 2 条
    const sorted = [...list].sort((a: any, b: any) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
    left = sorted[0];
    right = sorted[1] || list[list.length - 1];
  } else if (mode === 'national-highest-vs-industry') {
    const nationals = list.filter((s: any) => s.standardType === 'national').sort((a: any, b: any) => Number(b.grade || 0) - Number(a.grade || 0));
    left = nationals[0] || list.find((s: any) => Number(s.isDefault) === 1) || list[0];
    const industries = list.filter((s: any) => s.standardType === 'industry' && s.id !== left.id);
    right = industries[0] || list.find((s: any) => s.id !== left.id);
  }

  if (!left || !right || left.id === right.id) {
    ElMessage.warning('当前标准数量/类型不足，无法按该策略填充，请手动选择');
    return;
  }
  compareLeftId.value = left.id;
  compareRightId.value = right.id;
  // 清空上一次结果，避免看的是新组合+旧结果的混淆
  compareResult.value = null;
  compareRows.value = [];
}

function computeCompareRows(result: any) {
  return (result?.rows || []).map((r: any) => {
    const tag = r.tag || 'IDENTICAL';
    const map: Record<string, string> = {
      LEVEL_DIFF: '等级差异',
      REQ_DIFF: '要求差异',
      LEFT_ONLY: '仅左存在',
      RIGHT_ONLY: '仅右存在',
      EXTEND_INFO_DIFF: '扩展信息差异',
      IDENTICAL: '完全一致',
    };
    return {
      ...r,
      tagLabel: map[tag] || tag,
      levelDiff: tag === 'LEVEL_DIFF',
      reqDiff: tag === 'REQ_DIFF' || tag === 'EXTEND_INFO_DIFF',
    };
  });
}

async function runCompare() {
  if (!window.api) return;
  if (!compareLeftId.value || !compareRightId.value || compareLeftId.value === compareRightId.value) {
    ElMessage.warning('请选择两个不同的标准');
    return;
  }
  const left = standardList.value.find(s => s.id === compareLeftId.value);
  const right = standardList.value.find(s => s.id === compareRightId.value);
  compareLabels.left = left ? `${left.code || ''} ${left.name || ''}`.trim() : '左';
  compareLabels.right = right ? `${right.code || ''} ${right.name || ''}`.trim() : '右';
  compareLoading.value = true;
  compareResult.value = null;
  compareRows.value = [];
  try {
    const res = await window.api.standard.compare(compareLeftId.value, compareRightId.value);
    if (!res.success || !res.data) throw new Error(res.error?.message || '对照失败');
    compareResult.value = res.data;
    compareRows.value = computeCompareRows(res.data);
    ElMessage.success('对照完成');
  } catch (err: any) {
    ElMessage.error(err.message || '对照失败');
  } finally {
    compareLoading.value = false;
  }
}

async function exportCompareMarkdown() {
  if (!window.api || !compareResult.value?.markdown) {
    ElMessage.warning('当前没有可导出的对照结果');
    return;
  }
  try {
    const safeName = (s: string) => (s || 'standard').replace(/[\\/:*?"<>|\s]+/g, '_');
    const leftCode = compareResult.value.left?.code || 'LEFT';
    const rightCode = compareResult.value.right?.code || 'RIGHT';
    const dialogRes = await window.api.dialog.showSaveDialog({
      title: '导出标准对照 Markdown',
      defaultPath: `标准对照_${safeName(leftCode)}_vs_${safeName(rightCode)}.md`,
      filters: [{ name: 'Markdown 文件', extensions: ['md'] }],
    });
    if (!dialogRes.success || !dialogRes.data || dialogRes.data.canceled || !dialogRes.data.filePath) return;
    await window.api.fs.writeTextFile(dialogRes.data.filePath, compareResult.value.markdown);
    ElMessage.success(`已导出到 ${dialogRes.data.filePath}`);
  } catch (err: any) {
    ElMessage.error(err.message || '导出失败');
  }
}

async function loadStandards() {
  if (!window.api) return;
  standardLoading.value = true;
  try {
    const res = await window.api.standard.list();
    if (res.success && res.data) {
      standardList.value = res.data;
      filterStandards();
    }
  } finally {
    standardLoading.value = false;
  }
}

function filterStandards() {
  const kw = standardKeyword.value.toLowerCase().trim();
  if (!kw) {
    filteredStandardList.value = [...standardList.value];
  } else {
    filteredStandardList.value = standardList.value.filter(
      (s: any) => s.name.toLowerCase().includes(kw) || s.code?.toLowerCase().includes(kw)
    );
  }
}

async function handleSetDefault(row: any) {
  try {
    await ElMessageBox.confirm(
      `确定将「${row.name}」设为默认标准库吗？`,
      '确认设置',
      { type: 'info' }
    );
    const res = await window.api.standard.setDefault(row.id);
    if (res.success) {
      ElMessage.success('已设为默认标准库');
      loadStandards();
    } else {
      ElMessage.error(res.error?.message || '操作失败');
    }
  } catch {
    // User cancelled
  }
}

// === 标准库 CRUD：导入/新建/编辑/导出/删除 ===
const showStandardDialog = ref(false);
const editingStandardId = ref<string>('');
const standardSaving = ref(false);
// 等保适用等级组合（S/A/G 三级，G=max(S,A)），共 16 种合法组合
const LEVEL_COMBOS = [
  { value: 'S1A2G2', label: 'S1A2G2', grade: 2 },
  { value: 'S2A1G2', label: 'S2A1G2', grade: 2 },
  { value: 'S2A2G2', label: 'S2A2G2', grade: 2 },
  { value: 'S1A3G3', label: 'S1A3G3', grade: 3 },
  { value: 'S2A3G3', label: 'S2A3G3', grade: 3 },
  { value: 'S3A1G3', label: 'S3A1G3', grade: 3 },
  { value: 'S3A2G3', label: 'S3A2G3', grade: 3 },
  { value: 'S3A3G3', label: 'S3A3G3', grade: 3 },
  { value: 'S1A4G4', label: 'S1A4G4', grade: 4 },
  { value: 'S2A4G4', label: 'S2A4G4', grade: 4 },
  { value: 'S3A4G4', label: 'S3A4G4', grade: 4 },
  { value: 'S4A1G4', label: 'S4A1G4', grade: 4 },
  { value: 'S4A2G4', label: 'S4A2G4', grade: 4 },
  { value: 'S4A3G4', label: 'S4A3G4', grade: 4 },
  { value: 'S4A4G4', label: 'S4A4G4', grade: 4 },
];

function onLevelComboChange(combo: string) {
  const found = LEVEL_COMBOS.find(c => c.value === combo);
  if (found) standardForm.grade = found.grade;
}

const standardForm = reactive({
  name: '',
  code: '',
  version: '',
  grade: 3,
  levelCombo: '',
  standardType: 'national' as 'national' | 'industry',
  industry: '',
  description: '',
});

function resetStandardForm() {
  editingStandardId.value = '';
  standardForm.name = '';
  standardForm.code = '';
  standardForm.version = '';
  standardForm.grade = 3;
  standardForm.levelCombo = '';
  standardForm.standardType = 'national';
  standardForm.industry = '';
  standardForm.description = '';
}

// 导入标准（选择 JSON 或 Excel 文件 → 文件大小校验 → 读取 → 解析 → 传 JSON 对象给 standard:import）
// 方案 8.20：standardId 命名格式校验 + code 唯一性校验放在后端 validateStandardImportData 执行
async function handleImportStandard() {
  if (!window.api) return;
  try {
    // 0. 新手上路提示
    const firstHint = await window.api.dialog.showMessageBox({
      type: 'info',
      title: '导入标准',
      message: '请选择已准备好的标准文件导入。\n\n支持两种格式：\n· JSON 文件：完整无损的迁移/备份格式\n· Excel 文件：从导出标准或导入模板生成的 xlsx，可直接回灌导入',
      detail: '下载入口：工具栏「下载导入模板」按钮。',
      buttons: ['先去下载模板', '继续选择文件'],
      defaultId: 1,
    });
    if (!firstHint?.success || firstHint.data?.response === 0) {
      await handleDownloadTemplate('excel', 'national');
      return;
    }

    // 1. 选择文件（JSON 或 Excel）
    const dialogRes = await window.api.dialog.showOpenDialog({
      title: '选择标准文件',
      filters: [
        { name: '标准文件', extensions: ['json', 'xlsx', 'xls'] },
        { name: 'JSON 文件', extensions: ['json'] },
        { name: 'Excel 文件', extensions: ['xlsx', 'xls'] },
      ],
      properties: ['openFile'],
    });
    if (!dialogRes.success || !dialogRes.data || dialogRes.data.canceled || !dialogRes.data.filePaths?.length) return;
    const filePath = dialogRes.data.filePaths[0];

    // 1.5 方案 8.16：文件大小限制（IMPORT_MAX_FILE_BYTES=50MB 对应后端常量；前端更保守 10MB 先行拦截提示，超阈值再放行到后端 50MB 二次校验）
    const FRONT_MAX_MB = 10;
    try {
      // 走 fs:stat 获取文件大小（Node fs.statSync 通过 IPC）——若环境不支持 stat，仅跳过本检查（后端仍有 50MB 兜底）
      const stat: any = window.api.fs && typeof (window.api.fs as any).stat === 'function'
        ? await (window.api.fs as any).stat(filePath)
        : null;
      const size: number | undefined = stat?.size;
      if (typeof size === 'number' && size > FRONT_MAX_MB * 1024 * 1024) {
        const ok = await window.api.dialog.showMessageBox({
          type: 'warning',
          title: '文件较大',
          message: `标准 JSON 文件 ${(size / 1024 / 1024).toFixed(1)}MB，超过建议阈值 ${FRONT_MAX_MB}MB。`,
          detail: '超大标准会占用较长导入时间与内存。是否仍继续导入？',
          buttons: ['取消导入', '继续导入'],
          defaultId: 0,
        });
        if (!ok?.success || ok.data?.response !== 1) return;
      }
    } catch (_e) { /* stat 接口未注册时跳过本步 */ }

    // 2. 读取文件内容
    const isExcel = /\.(xlsx|xls)$/i.test(filePath);
    ElMessage.info('正在读取标准文件...');
    let fileContent: string;
    if (isExcel) {
      // Excel 二进制文件：读取为 base64
      const b64Res = await (window.api.fs as any).readFileBase64(filePath);
      if (!b64Res.success || !b64Res.data) throw new Error('读取文件失败');
      fileContent = b64Res.data;
    } else {
      const fileRes = await window.api.fs.readFile(filePath);
      if (!fileRes.success || !fileRes.data) throw new Error('读取文件失败');
      fileContent = fileRes.data;
    }

    // 3. 根据文件后缀解析：JSON 直接 parse，Excel 走 standard:parseExcel
    let stdData: any;
    if (isExcel) {
      ElMessage.info('正在解析 Excel 文件...');
      const parseRes = await window.api.standard.parseExcel(fileContent);
      if (!parseRes.success || !parseRes.data) {
        throw new Error(parseRes.error?.message || 'Excel 文件解析失败');
      }
      stdData = parseRes.data;
    } else {
      try {
        stdData = JSON.parse(fileContent);
      } catch (e) {
        throw new Error('文件不是有效的 JSON 格式，请检查文件内容');
      }
    }

    // 4. 先 dryRun 校验预览（显示将导入的域数/项数），再真正入库
    ElMessage.info('正在校验标准结构...');
    const dry = await window.api.standard.import(stdData, { dryRun: true });
    let doImport = true;
    if (dry.success && dry.data?.dryRun === true) {
      const msg = dry.data.message || '';
      const warnCount = Array.isArray(dry.data.warnings) ? dry.data.warnings.length : 0;
      const ok = await window.api.dialog.showMessageBox({
        type: warnCount > 0 ? 'warning' : 'info',
        title: '导入校验预览',
        message: msg,
        detail: warnCount > 0 ? `警告：${dry.data!.warnings!.slice(0, 10).join('\n')}` : '校验通过，点击确定开始写入数据库。',
        buttons: ['取消导入', '确认导入'],
        defaultId: 1,
      });
      doImport = !!ok?.success && ok.data?.response === 1;
      if (!doImport) return;
    } else if (!dry.success) {
      ElMessage.warning(`预校验发现问题：${dry.error?.message || '未知'}，仍将尝试正式导入（后端会再校验）。`);
    }

    // 5. 正式导入 standard:import overwrite=false
    ElMessage.info('正在导入标准...');
    const res = await window.api.standard.import(stdData, { overwrite: false });
    if (res.success) {
      ElMessage.success(`标准导入成功（共 ${res.data?.itemCount || 0} 项测评项）`);
      loadStandards();
    } else {
      // 覆盖场景：已存在 → 给用户一次确认后再 overwrite
      const msg = res.error?.message || '';
      const isExist = /已存在/.test(msg) && /overwrite|覆盖/.test(msg);
      if (isExist) {
        const conf = await window.api.dialog.showMessageBox({
          type: 'warning',
          title: '标准已存在',
          message: msg,
          detail: '选择「覆盖」将删除原标准原有测评项/记录后重新导入（不会删除项目本身）。是否覆盖？',
          buttons: ['取消', '覆盖导入'],
          defaultId: 0,
        });
        if (conf?.success && conf.data?.response === 1) {
          const overwriteRes = await window.api.standard.import(stdData, { overwrite: true });
          if (overwriteRes.success) {
            ElMessage.success(`标准覆盖导入成功（共 ${overwriteRes.data?.itemCount || 0} 项测评项）`);
            loadStandards();
          } else {
            ElMessage.error(overwriteRes.error?.message || '覆盖导入失败');
          }
        }
      } else {
        ElMessage.error(res.error?.message || '导入失败');
      }
    }
  } catch (err: any) {
    ElMessage.error(err.message || '导入失败');
  }
}

function handleCreateStandard() {
  resetStandardForm();
  showStandardDialog.value = true;
}

function handleEditStandard(row: any) {
  editingStandardId.value = row.id;
  standardForm.name = row.name || '';
  standardForm.code = row.code || '';
  standardForm.version = row.version || '';
  standardForm.grade = row.grade || 3;
  standardForm.levelCombo = row.levelCombo || `S${row.grade || 3}A${row.grade || 3}G${row.grade || 3}`;
  standardForm.standardType = (row.standardType as 'national' | 'industry') || 'national';
  standardForm.industry = row.industry || '';
  standardForm.description = row.description || '';
  showStandardDialog.value = true;
}

async function handleSaveStandard() {
  if (!window.api) return;
  // 基础校验
  if (!standardForm.name.trim()) {
    ElMessage.warning('请填写标准名称');
    return;
  }
  if (!standardForm.code.trim()) {
    ElMessage.warning('请填写标准代号');
    return;
  }
  if (!standardForm.version.trim()) {
    ElMessage.warning('请填写版本号');
    return;
  }

  standardSaving.value = true;
  try {
    // 适用等级组合决定最终保护等级（G=max(S,A)）；组合存在时以组合推导，否则回退表单 grade
    const comboGrade = standardForm.levelCombo
      ? (LEVEL_COMBOS.find(c => c.value === standardForm.levelCombo)?.grade ?? standardForm.grade)
      : standardForm.grade;
    if (editingStandardId.value) {
      // 编辑：调用 update（两个参数：standardId + fields，仅改元信息不动测评项）
      const fields = {
        name: standardForm.name.trim(),
        version: standardForm.version.trim(),
        grade: comboGrade,
        levelCombo: standardForm.levelCombo || '',
        standardType: standardForm.standardType,
        industry: standardForm.industry.trim(),
        description: standardForm.description.trim(),
      };
      const res = await window.api.standard.update(editingStandardId.value, fields);
      if (res.success) {
        ElMessage.success('标准更新成功');
        showStandardDialog.value = false;
        loadStandards();
      } else {
        ElMessage.error(res.error?.message || '更新失败');
      }
    } else {
      // 新建：调用 create
      const payload = {
        name: standardForm.name.trim(),
        code: standardForm.code.trim(),
        version: standardForm.version.trim(),
        grade: comboGrade,
        levelCombo: standardForm.levelCombo || '',
        standardType: standardForm.standardType,
        industry: standardForm.industry.trim(),
        description: standardForm.description.trim(),
      };
      const res = await window.api.standard.create(payload);
      if (res.success) {
        ElMessage.success('标准创建成功（空标准，可通过导入 JSON 添加测评项）');
        showStandardDialog.value = false;
        loadStandards();
      } else {
        ElMessage.error(res.error?.message || '创建失败');
      }
    }
  } catch (err: any) {
    ElMessage.error(err.message || '操作失败');
  } finally {
    standardSaving.value = false;
  }
}

/**
 * 导出单个标准
 * @param row any（必含 id/code/name）
 * @param format 'json' | 'excel'
 */
async function handleExportStandard(row: any, format: 'json' | 'excel' = 'json') {
  if (!window.api) return;
  try {
    if (format === 'json') {
      // 1. 选择保存路径
      const dialogRes = await window.api.dialog.showSaveDialog({
        title: '导出标准 JSON',
        defaultPath: `${row.code || row.name}.json`,
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      });
      if (!dialogRes.success || !dialogRes.data || dialogRes.data.canceled || !dialogRes.data.filePath) return;
      const savePath = dialogRes.data.filePath;

      // 2. 调用 standard:export 获取 JSON 数据（传 standardId，不是对象）
      ElMessage.info('正在导出标准 JSON...');
      const res = await window.api.standard.export(row.id);
      if (!res.success || !res.data) {
        ElMessage.error(res.error?.message || '导出失败');
        return;
      }

      // 3. 写入文件 + 显式检查返回 success（preload 返回 IpcResponse，不校验就静默了）
      const jsonStr = JSON.stringify(res.data, null, 2);
      const writeRes = await window.api.fs.writeTextFile(savePath, jsonStr) as any;
      if (writeRes && writeRes.success === false) {
        throw new Error(writeRes.error?.message || '写入失败（权限/路径错误）');
      }
      ElMessage.success(`已导出 JSON：${savePath}`);
      return;
    }

    // Excel：单标准走 exportExcel([id]) → 返回 kind=xlsx base64 → 保存
    ElMessage.info('正在导出标准 Excel（包含测评项，可能需要几秒）...');
    const res = await window.api.standard.exportExcel([row.id]);
    if (!res.success || !res.data) {
      ElMessage.error(res.error?.message || '导出失败');
      return;
    }
    const { fileName, content, kind } = res.data;
    if (kind !== 'xlsx') {
      throw new Error(`单标准导出类型异常：期望 xlsx，实际 ${kind}`);
    }
    const dialogRes = await window.api.dialog.showSaveDialog({
      title: '导出标准 Excel',
      defaultPath: fileName,
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
    });
    if (!dialogRes.success || !dialogRes.data || dialogRes.data.canceled || !dialogRes.data.filePath) return;
    const savePath = dialogRes.data.filePath;
    const bytes = base64ToBytes(content);
    const writeRes = await window.api.fs.writeFile(savePath, bytes as any) as any;
    if (writeRes && writeRes.success === false) {
      throw new Error(writeRes.error?.message || '写入失败（权限/路径错误）');
    }
    ElMessage.success(`已导出 Excel：${savePath}`);
    if (res.data.warnings && res.data.warnings.length > 0) {
      ElNotification({
        type: 'warning',
        title: `导出成功，但有 ${res.data.warnings.length} 条提示`,
        message: res.data.warnings.slice(0, 20).join('\r\n'),
        duration: 8000,
      });
    }
  } catch (err: any) {
    ElMessage.error(err?.message || '导出失败');
  }
}

type ExportMode = 'export-all' | 'export-selected' | 'export-default' | 'export-industry';

/**
 * 导出标准（批量/全部/勾选/默认/行业；单个拆分按钮 click 默认走「勾选优先」）
 */
async function handleExportStandards(mode?: ExportMode | string, format: 'json' | 'excel' = 'json') {
  if (!window.api) return;
  const list: any[] = standardList.value || [];
  let ids: string[] = [];
  let desc = '';
  const m: string = (mode as ExportMode) || (selectedStandards.value.length > 0 ? 'export-selected' : 'export-all');

  switch (m) {
    case 'export-all':
      ids = list.map((s: any) => s.id);
      desc = '全部标准';
      break;
    case 'export-selected':
      ids = (selectedStandards.value || []).map((s: any) => s.id);
      desc = `勾选的 ${ids.length} 个标准`;
      break;
    case 'export-default':
      ids = list.filter((s: any) => Number(s.isDefault) === 1).map((s: any) => s.id);
      desc = '默认标准';
      break;
    case 'export-industry':
      ids = list.filter((s: any) => s.standardType === 'industry').map((s: any) => s.id);
      desc = '行业标准';
      break;
    default:
      ids = list.map((s: any) => s.id);
      desc = '全部标准';
  }
  if (ids.length === 0) {
    ElMessage.warning(`${desc}为空，没有可导出的标准`);
    return;
  }

  try {
    // 单个：直接走单文件（JSON 或 Excel）带保存对话框
    if (ids.length === 1) {
      const single = list.find((s: any) => s.id === ids[0]) || { id: ids[0], code: ids[0] };
      await handleExportStandard(single, format);
      return;
    }

    // Excel 批量：统一生成 ZIP（多个 xlsx + 说明文件），saveDialog 直接存 .zip
    if (format === 'excel') {
      ElMessage.info(`正在导出 ${ids.length} 个标准 Excel（打包为 ZIP）...`);
      const res = await window.api.standard.exportExcel(ids);
      if (!res.success || !res.data) {
        ElMessage.error(res.error?.message || '批量导出 Excel 失败');
        return;
      }
      if (res.data.kind !== 'zip') {
        throw new Error(`批量导出 Excel 类型异常：期望 zip，实际 ${res.data.kind}`);
      }
      const dialogRes = await window.api.dialog.showSaveDialog({
        title: `批量导出 ${desc} Excel（ZIP）`,
        defaultPath: res.data.fileName,
        filters: [{ name: '压缩包 ZIP', extensions: ['zip'] }],
      });
      if (!dialogRes.success || !dialogRes.data || dialogRes.data.canceled || !dialogRes.data.filePath) return;
      const savePath = dialogRes.data.filePath;
      const bytes = base64ToBytes(res.data.content);
      const writeRes = await window.api.fs.writeFile(savePath, bytes as any) as any;
      if (writeRes && writeRes.success === false) {
        throw new Error(writeRes.error?.message || 'ZIP 写入失败');
      }
      ElMessage.success(`已导出 ZIP（${res.data.fileCount} 个 xlsx）：${savePath}`);
      if (res.data.warnings && res.data.warnings.length) {
        ElNotification({
          type: 'warning',
          title: `导出提示（${res.data.warnings.length}）`,
          message: res.data.warnings.slice(0, 20).join('\r\n'),
          duration: 8000,
        });
      }
      return;
    }

    // JSON 批量：openDirectory 选目录 → 逐文件 writeTextFile + 严格校验 IpcResponse.success
    const dirRes = await window.api.dialog.showOpenDialog({
      title: `选择目录以批量导出 ${desc}（${ids.length} 个 JSON）`,
      properties: ['openDirectory'],
    });
    if (!dirRes.success || !dirRes.data || dirRes.data.canceled || !dirRes.data.filePaths?.length) return;
    const outDir = dirRes.data.filePaths[0];

    // 确保目录存在且可写（先调一次 ensureDir，让 validatePath 路径校验失败时提前抛，不会静默）
    const ensureRes = await window.api.fs.ensureDir(outDir) as any;
    if (ensureRes && ensureRes.success === false) {
      throw new Error(`导出目录不可写：${ensureRes.error?.message || outDir}`);
    }

    ElMessage.info(`正在导出 ${ids.length} 个标准 JSON 到 ${outDir}...`);
    const batchRes = await window.api.standard.exportBatch(ids);
    if (!batchRes.success || !Array.isArray(batchRes.data) || batchRes.data.length === 0) {
      ElMessage.error(batchRes.error?.message || '批量导出失败');
      return;
    }

    const sanitize = (s: string, idx: number, ext: string = '.json') => {
      const base = (s || '').toString().trim();
      const cleaned = base ? base.replace(/[\\/:*?"<>|\s]+/g, '_') : `standard_${idx + 1}`;
      return `${cleaned}${ext}`;
    };
    let okCount = 0;
    const failed: Array<{ name: string; err: string }> = [];
    const finalNames = new Set<string>();
    for (let i = 0; i < batchRes.data.length; i++) {
      const payload = batchRes.data[i];
      const original = sanitize(payload.code || payload.id || '', i);
      let finalName = original;
      let n = 2;
      while (finalNames.has(finalName)) { finalName = `${original.replace(/\.json$/, '')}-${n}.json`; n++; }
      finalNames.add(finalName);
      const sep = (outDir.endsWith('\\') || outDir.endsWith('/')) ? '' : '/';
      const savePath = `${outDir}${sep}${finalName}`;
      try {
        const { _exportWarnings, ...clean } = payload;
        const jsonStr = JSON.stringify(clean, null, 2);
        // writeTextFile 返回 IpcResponse，必须判定 success（否则文件未落盘但 okCount++，导致用户看不到任何文件也不报错）
        const writeRes = await window.api.fs.writeTextFile(savePath, jsonStr) as any;
        if (writeRes && writeRes.success === false) {
          throw new Error(writeRes.error?.message || '写入失败（权限/路径错误）');
        }
        okCount++;
      } catch (e: any) {
        failed.push({ name: finalName, err: e?.message || String(e) });
      }
    }

    if (failed.length === 0) {
      ElMessage.success(`批量导出 JSON 完成（${okCount} / ${ids.length}）→ ${outDir}`);
    } else {
      ElNotification({
        type: 'warning',
        title: `批量导出 ${okCount} 成功，${failed.length} 失败`,
        message: `目录：${outDir}\n失败项：${failed.slice(0, 8).map(f => `${f.name}（${f.err}）`).join('；')}${failed.length > 8 ? `… 共 ${failed.length}` : ''}`,
        duration: 9000,
      });
    }
  } catch (err: any) {
    ElMessage.error(err?.message || '批量导出失败');
  }
}

/**
 * 导出下拉命令分发器
 *  - JSON/Excel 各自 4 种粒度
 *  - 分组标题：没有 format 字段，直接 return，避免误触发
 *  - 灰显条件再次二次校验（Element Plus dropdown-item 没有 disabled prop，样式灰仍会触发 command）
 */
function onExportDropdownCommand(cmd: any) {
  if (!cmd) return;
  const format: 'json' | 'excel' | undefined = cmd.format;
  const mode: ExportMode | undefined = cmd.mode;
  if (!format || !mode) return;

  if (mode === 'export-selected' && selectedStandards.value.length === 0) return;
  if (mode === 'export-default' && !standardList.value.some((s: any) => Number(s.isDefault) === 1)) return;
  if (mode === 'export-industry' && !standardList.value.some((s: any) => s.standardType === 'industry')) return;

  handleExportStandards(mode, format).catch(err => ElMessage.error(err?.message || '批量导出失败'));
}

/**
 * 「下载导入模板」下拉分发器：
 *   - action='template' → kind='excel'|'json'（后端统一使用单一模板，preset 仅保留为兼容字段）
 *   - action='create' → 打开"新建空标准"弹窗（原有 handleCreateStandard）
 */
function onTemplateDropdownCommand(cmd: any) {
  if (!cmd) return;
  if (cmd.action === 'create') {
    handleCreateStandard();
    return;
  }
  if (cmd.action === 'template') {
    handleDownloadTemplate(cmd.kind || 'excel', cmd.preset || 'national').catch(err => ElMessage.error(err?.message || '模板下载失败'));
  }
  // 其余：分组标题（object 非 template/create 结构）视为无效命令，直接忽略（样式已灰，避免误触发）
}

/**
 * 下载导入模板（每种导出方式仅一个统一模板：等保通用 GB/T 22239 三级，含十大安全域）
 * @param kind 'json' | 'excel'
 * @param preset 兼容字段，后端已忽略（默认 national）
 */
async function handleDownloadTemplate(
  kind: 'json' | 'excel',
  preset: 'national' | 'power' | 'finance' | 'custom' = 'national'
) {
  if (!window.api) return;
  try {
    ElMessage.info(`正在生成${kind === 'excel' ? 'Excel' : 'JSON'}导入模板（等保通用 GB/T 22239 三级）...`);
    const res = await window.api.standard.downloadTemplate({ kind, preset });
    if (!res.success || !res.data) {
      ElMessage.error(res.error?.message || '模板生成失败');
      return;
    }
    const { fileName, content } = res.data;

    // 弹出保存对话框；默认文件名=后端建议，若重名用户可改
    const dialogRes = await window.api.dialog.showSaveDialog({
      title: `保存标准导入模板（${kind === 'excel' ? 'Excel' : 'JSON 示例'}）`,
      defaultPath: fileName,
      filters: [{
        name: kind === 'excel' ? 'Excel 工作簿' : 'JSON 文件',
        extensions: [kind === 'excel' ? 'xlsx' : 'json'],
      }],
    });
    if (!dialogRes.success || !dialogRes.data || dialogRes.data.canceled || !dialogRes.data.filePath) return;
    const savePath = dialogRes.data.filePath;

    if (kind === 'excel') {
      // Excel：主进程返回 base64 文本 → 用纯 Web API（atob + Uint8Array）解码成二进制字节，
      // 再通过 electron fs.writeFile(ArrayBuffer/bytes) 写盘。避免使用 Node Buffer（渲染进程不注入）。
      const bytes = base64ToBytes(content);
      await window.api.fs.writeFile(savePath, bytes as any);
    } else {
      // JSON 走 writeTextFile（UTF-8 文本）
      await window.api.fs.writeTextFile(savePath, content);
    }
    ElMessage.success(`模板已保存：${savePath}`);
  } catch (err: any) {
    ElMessage.error(err.message || '模板下载失败');
  }
}

async function handleDeleteStandard(row: any) {
  if (!window.api) return;
  if (row.source === 'builtin') {
    ElMessage.warning('系统预置标准库不可删除');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确定删除标准「${row.name}」吗？\n\n将级联删除：\n- 标准记录（1 条）\n- 测评项（${row.itemCount || 0} 条）\n- 关联项目的测评记录\n\n此操作不可撤销！`,
      '确认删除',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    );
    const res = await window.api.standard.remove(row.id);
    if (res.success) {
      ElMessage.success(`已删除标准「${row.name}」`);
      loadStandards();
    } else {
      ElMessage.error(res.error?.message || '删除失败');
    }
  } catch {
    // User cancelled
  }
}

onMounted(() => {
  loadSystemInfo();
  loadUsers();
  loadLogs();
  loadSettings();
  loadStandards();
  initUpdateListener();
});

onUnmounted(() => {
  if (removeStatusListener) {
    removeStatusListener();
  }
});
</script>

<style scoped lang="scss">
.settings-tabs {
  display: flex;
  align-items: center;
  gap: 0;
  margin-bottom: var(--spacing-md);
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  padding: 4px 16px;

  .tab-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: var(--text-base, 13px);
    font-weight: 500;
    color: var(--color-text-tertiary);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    white-space: nowrap;
    font-family: var(--font-family);

    &.active {
      color: var(--color-primary);
      border-bottom-color: var(--color-primary);
    }
  }
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-md);
  gap: 12px;

  &-left, &-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

/* 下拉菜单：分组标题（is-group-title）+ 禁用样式（is-disabled）；Element Plus 默认 dropdown-item 不带 disabled prop，走样式兜底 */
:deep(.el-dropdown-menu__item.is-disabled) {
  color: var(--el-text-color-placeholder);
  cursor: not-allowed;
  pointer-events: none;
  background: transparent !important;
}
:deep(.el-dropdown-menu__item.is-group-title) {
  font-weight: 600;
  color: var(--el-text-color-primary);
  cursor: default;
  font-size: 13px;
  padding-top: 6px;
  padding-bottom: 2px;
}

.pagination-wrapper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  margin-top: 12px;
  border-top: 1px solid var(--color-border-light);

  .total-text {
    font-size: var(--text-sm, 12px);
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }
}

.settings-section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.settings-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 0;
  border-bottom: 1px solid var(--bg-hover);
  
  &:last-child {
    border-bottom: none;
  }
}

.settings-item-info {
  flex: 1;
}

.settings-item-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.settings-item-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

.data-path-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.path-display-btn {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mt-md {
  margin-top: 16px;
}

.info-list {
  .info-item {
    display: flex;
    justify-content: space-between;
    padding: 12px 0;
    border-bottom: 1px solid var(--bg-hover);
    
    &:last-child {
      border-bottom: none;
    }
  }
  
  .info-label {
    font-size: 14px;
    color: var(--text-secondary);
  }
  
  .info-value {
    font-size: 14px;
    color: var(--text-primary);
    font-family: 'Consolas', monospace;
  }
}

.about-content {
  font-size: 14px;
  line-height: 1.8;
  color: var(--text-primary);
  
  p {
    margin-bottom: 12px;
  }
  
  .about-tip {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    font-size: 13px;
    margin-top: 16px;
    padding: 12px;
    background: var(--bg-hover);
    border-radius: 6px;
  }
}

.restore-dialog-content {
  padding: 8px 0;
}

.backup-preview-section {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);

  .preview-time {
    font-size: 14px;
    color: var(--text-primary);
    margin-bottom: 4px;
  }

  .preview-summary {
    font-size: 13px;
    color: var(--text-secondary);
  }
}

.restore-mode-section {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);

  :deep(.el-radio) {
    display: block;
    margin-bottom: 10px;

    .mode-name {
      font-size: 14px;
      color: var(--text-primary);
      margin-right: 8px;
    }

    .mode-tag {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;

      &.recommended {
        background: #f0f9ff;
        color: #3b82f6;
      }

      &.dangerous {
        background: #fef2f2;
        color: #ef4444;
      }
    }
  }
}

.project-selection {
  .selection-title {
    font-size: 13px;
    color: var(--text-primary);
    margin-bottom: 10px;
  }

  .project-checkboxes {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 200px;
    overflow-y: auto;

    :deep(.el-checkbox) {
      .project-name {
        font-size: 14px;
        color: var(--text-primary);
        margin-right: 6px;
      }

      .project-level {
        font-size: 12px;
        color: var(--color-primary);
        margin-right: 8px;
      }

      .project-count {
        font-size: 12px;
        color: var(--text-secondary);
      }
    }
  }
}

.star-icon {
  color: #C0C4CC;
  cursor: pointer;
  vertical-align: middle;
  transition: color 0.15s;
  margin-right: 12px;

  &:hover {
    color: #E6A23C;
  }
}

.lock-icon {
  color: #C0C4CC;
  cursor: default;
  vertical-align: middle;
  margin-left: 12px;
}

.edit-icon {
  color: #C0C4CC;
  cursor: pointer;
  vertical-align: middle;
  transition: color 0.15s;
  margin-right: 12px;

  &:hover {
    color: var(--primary-color, #409EFF);
  }
}

.export-icon {
  color: #C0C4CC;
  cursor: pointer;
  vertical-align: middle;
  transition: color 0.15s;
  margin-right: 12px;

  &:hover {
    color: #67C23A;
  }
}

.delete-icon {
  color: #C0C4CC;
  cursor: pointer;
  vertical-align: middle;
  transition: color 0.15s;
  margin-left: 12px;

  &:hover {
    color: #F56C6C;
  }
}

.standard-form .form-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.4;
  margin-top: 4px;
}

/* Phase 4 · 任务 27：标准对照视图样式 */
.overview-label {
  font-size: 12px;
  color: #909399;
  margin-bottom: 4px;
}
.overview-value {
  font-size: 22px;
  font-weight: 600;
  color: #111827;
  line-height: 1.2;
}
.muted {
  color: #909399;
  font-size: 12px;
}
</style>
