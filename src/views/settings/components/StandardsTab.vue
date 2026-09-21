<template>
  <div>
    <el-tabs v-model="standardsSubTab" type="border-card" style="margin-bottom: 16px">
      <el-tab-pane label="标准库列表" name="list" />
      <el-tab-pane name="compare">
        <template #label>
          <span style="display: inline-flex; align-items: center; gap: 6px">
            对照视图
          </span>
        </template>
      </el-tab-pane>
      <el-tab-pane name="compliance">
        <template #label>
          <span style="display: inline-flex; align-items: center; gap: 6px">
            合规差距
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
            <el-button
              type="warning"
              :disabled="!compareResult || aiDiffLoading"
              :loading="aiDiffLoading"
              @click="runAiDiffExplain"
            >
              AI 解读差异
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

          <!-- AI 差异解读卡片 -->
          <div ref="aiDiffCardRef" v-if="aiDiffData || aiDiffLoading || aiDiffError" style="margin-top: 20px; border-top: 1px solid var(--el-border-color-lighter); padding-top: 16px">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px">
              <el-tag type="warning" size="small">AI 解读</el-tag>
              <span style="font-weight: 600; font-size: 14px">差异分析</span>
            </div>

            <div v-if="aiDiffLoading" style="padding: 12px 0">
              <el-skeleton :rows="3" animated />
            </div>

            <div v-else-if="aiDiffError" style="margin-bottom: 12px">
              <el-alert :title="aiDiffError" type="error" :closable="false" show-icon />
            </div>

            <div v-else-if="aiDiffData">
              <div style="font-size: 13px; line-height: 1.7; color: var(--el-text-color-primary); white-space: pre-wrap; margin-bottom: 12px">
                {{ aiDiffData.summary }}
              </div>

              <div v-if="aiDiffData.keyDiffs && aiDiffData.keyDiffs.length > 0" style="margin-bottom: 12px">
                <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px; color: var(--el-text-color-secondary)">关键差异（{{ aiDiffData.keyDiffs.length }} 项）</div>
                <el-table :data="aiDiffData.keyDiffs" size="small" stripe style="width: 100%">
                  <el-table-column prop="domain" label="域" width="100" />
                  <el-table-column prop="point" label="差异要点" min-width="220" show-overflow-tooltip />
                  <el-table-column prop="impact" label="影响说明" min-width="220" show-overflow-tooltip />
                </el-table>
              </div>

              <div v-if="aiDiffData.advice" style="padding: 10px 12px; background: var(--el-color-primary-light-9); border-radius: var(--radius-base); font-size: 13px; line-height: 1.7; color: var(--el-text-color-primary)">
                <span style="font-weight: 600; color: var(--el-color-primary)">AI 建议：</span>{{ aiDiffData.advice }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 合规差距子 Tab -->
    <template v-else-if="standardsSubTab === 'compliance'">
      <div class="card p-md">
        <div class="toolbar" style="margin-bottom: 12px">
          <div class="toolbar-left">
            <div class="settings-section-title" style="margin-bottom: 0">合规差距分析</div>
          </div>
          <div class="toolbar-right">
            <el-select
              v-model="complianceProjectId"
              placeholder="选择项目"
              clearable
              style="width: 220px"
            >
              <el-option
                v-for="p in projectListForCompliance"
                :key="p.id"
                :label="p.name"
                :value="p.id"
              />
            </el-select>
            <span style="color: #909399; padding: 0 4px">×</span>
            <el-select
              v-model="complianceStandardId"
              placeholder="选择标准"
              clearable
              style="width: 260px"
            >
              <el-option
                v-for="s in standardList"
                :key="s.id"
                :label="`${s.name}（${s.code}）`"
                :value="s.id"
              />
            </el-select>
            <el-button
              type="primary"
              :disabled="!complianceProjectId || !complianceStandardId"
              :loading="complianceStatsLoading"
              @click="runComplianceStats"
            >
              统计
            </el-button>
            <el-button
              type="warning"
              :disabled="!complianceStatsData || aiComplianceLoading || complianceStatsLoading"
              :loading="aiComplianceLoading"
              @click="runAiComplianceGap"
            >
              AI 分析差距
            </el-button>
            <el-button :icon="Refresh" @click="resetCompliance">重置</el-button>
          </div>
        </div>

        <el-empty
          v-if="!complianceStatsData && !complianceStatsLoading"
          :description="complianceProjectId && complianceStandardId ? '已选择项目与标准，点击「统计」查看合规数据' : '请先选择项目与标准，再点击「统计」查看合规数据'"
          style="padding: 40px 0"
        />

        <div v-else-if="complianceStatsLoading" style="padding: 20px 0">
          <el-skeleton :rows="4" animated />
        </div>

        <div v-else-if="complianceStatsData">
          <!-- 汇总概览 -->
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px">
            <el-card shadow="hover">
              <div class="overview-label">适用条目</div>
              <div class="overview-value">{{ complianceStatsData.summary?.totalItems ?? 0 }}</div>
            </el-card>
            <el-card shadow="hover">
              <div class="overview-label">已判定</div>
              <div class="overview-value">{{ complianceStatsData.summary?.tested ?? 0 }}</div>
            </el-card>
            <el-card shadow="hover">
              <div class="overview-label">合规率</div>
              <div class="overview-value" :style="{ color: (complianceStatsData.summary?.complianceRate ?? 0) >= 80 ? '#18A957' : (complianceStatsData.summary?.complianceRate ?? 0) >= 50 ? '#D48806' : '#F56C6C' }">
                {{ (complianceStatsData.summary?.complianceRate ?? 0).toFixed(1) }}%
              </div>
            </el-card>
            <el-card shadow="hover">
              <div class="overview-label">覆盖率</div>
              <div class="overview-value">{{ (complianceStatsData.summary?.coverageRate ?? 0).toFixed(1) }}%</div>
            </el-card>
          </div>

          <!-- 按域统计 -->
          <div v-if="complianceStatsData.domains && complianceStatsData.domains.length > 0" style="margin-bottom: 16px">
            <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px">按域统计</div>
            <el-table :data="complianceStatsData.domains" size="small" stripe style="width: 100%">
              <el-table-column prop="name" label="域" width="160" show-overflow-tooltip />
              <el-table-column prop="total" label="适用" width="80" align="center" />
              <el-table-column prop="tested" label="已判定" width="80" align="center" />
              <el-table-column label="合规率" min-width="140">
                <template #default="{ row }">
                  <div style="display: flex; align-items: center; gap: 8px">
                    <div style="flex: 1; height: 6px; background: var(--el-border-color-lighter); border-radius: var(--radius-sm); overflow: hidden">
                      <div
                        :style="{ width: (row.complianceRate ?? 0) + '%', height: '100%', borderRadius: '3px', background: (row.complianceRate ?? 0) >= 80 ? '#18A957' : (row.complianceRate ?? 0) >= 50 ? '#D48806' : '#F56C6C' }"
                      />
                    </div>
                    <span style="font-size: 12px; white-space: nowrap">{{ (row.complianceRate ?? 0).toFixed(0) }}%</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="不合规" width="80" align="center">
                <template #default="{ row }">
                  <span :style="{ color: (row.nonCompliant ?? 0) > 0 ? '#F56C6C' : 'inherit' }">{{ row.nonCompliant ?? 0 }}</span>
                </template>
              </el-table-column>
              <el-table-column label="部分合规" width="80" align="center">
                <template #default="{ row }">
                  <span :style="{ color: (row.partial ?? 0) > 0 ? '#D48806' : 'inherit' }">{{ row.partial ?? 0 }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <!-- AI 合规差距卡片 -->
          <div ref="aiComplianceCardRef" v-if="aiComplianceData || aiComplianceLoading || aiComplianceError" style="margin-top: 16px; border-top: 1px solid var(--el-border-color-lighter); padding-top: 16px">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px">
              <el-tag type="warning" size="small">AI 分析</el-tag>
              <span style="font-weight: 600; font-size: 14px">合规差距</span>
            </div>

            <div v-if="aiComplianceLoading" style="padding: 12px 0">
              <el-skeleton :rows="3" animated />
            </div>

            <div v-else-if="aiComplianceError" style="margin-bottom: 12px">
              <el-alert :title="aiComplianceError" type="error" :closable="false" show-icon />
            </div>

            <div v-else-if="aiComplianceData">
              <div style="font-size: 13px; line-height: 1.7; color: var(--el-text-color-primary); white-space: pre-wrap; margin-bottom: 12px">
                {{ aiComplianceData.summary }}
              </div>

              <div v-if="aiComplianceData.gaps && aiComplianceData.gaps.length > 0" style="margin-bottom: 12px">
                <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px; color: var(--el-text-color-secondary)">主要差距（{{ aiComplianceData.gaps.length }} 项）</div>
                <div v-for="gap in aiComplianceData.gaps" :key="gap.domain + gap.gap" style="padding: 10px 12px; background: var(--el-bg-color); border-radius: var(--radius-base); margin-bottom: 8px; border: 1px solid var(--el-border-color-lighter)">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px">
                    <el-tag :type="gap.priority === 'high' ? 'danger' : gap.priority === 'medium' ? 'warning' : 'info'" size="small">{{ gap.priority === 'high' ? '高' : gap.priority === 'medium' ? '中' : '低' }}</el-tag>
                    <span style="font-weight: 600; font-size: 13px">{{ gap.domain }}</span>
                  </div>
                  <div style="font-size: 13px; line-height: 1.6; margin-bottom: 4px">{{ gap.gap }}</div>
                  <div style="font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 4px">风险：{{ gap.risk }}</div>
                  <div style="font-size: 12px; color: var(--el-color-primary); line-height: 1.5">{{ gap.suggestion }}</div>
                </div>
              </div>
            </div>
          </div>
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, nextTick } from 'vue';
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus';
import { Download, Upload, Plus, Refresh, Search, Lock, Star, Edit, Delete, MoreFilled } from '@element-plus/icons-vue';

// Standard library management
const standardList = ref<any[]>([]);
const filteredStandardList = ref<any[]>([]);
const standardLoading = ref(false);
const standardKeyword = ref('');
const selectedStandards = ref<any[]>([]);
const standardsSubTab = ref<'list' | 'compare' | 'compliance'>('list');
const compareLeftId = ref<string>('');
const compareRightId = ref<string>('');
const compareLoading = ref(false);
const compareResult = ref<any>(null);
const compareRows = ref<any[]>([]);
const compareLabels = reactive({ left: '左', right: '右' });

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
  aiDiffData.value = null;
  aiDiffError.value = '';
}

// ===== AI 差异解读 =====
interface AiDiffData {
  summary: string;
  keyDiffs: Array<{ domain: string; point: string; impact: string }>;
  advice: string;
}
const aiDiffData = ref<AiDiffData | null>(null);
const aiDiffLoading = ref(false);
const aiDiffError = ref('');
const aiDiffCardRef = ref<HTMLElement | null>(null);

/** AI 结果/错误卡渲染后滚动进视口（卡片位于 70vh 对照表下方，默认在视口外不可见） */
async function revealAiCard(cardRef: { value: HTMLElement | null }) {
  await nextTick();
  cardRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function runAiDiffExplain() {
  if (!window.api?.ai) {
    ElMessage.error('AI 通道未就绪，请重启应用后重试');
    return;
  }
  if (!compareResult.value) {
    ElMessage.warning('请先执行对照');
    return;
  }
  const left = standardList.value.find(s => s.id === compareLeftId.value);
  const right = standardList.value.find(s => s.id === compareRightId.value);
  if (!left || !right) {
    ElMessage.warning('未找到对照的基准/标准信息，请重新选择两个标准并执行对照');
    return;
  }

  aiDiffLoading.value = true;
  aiDiffError.value = '';
  try {
    // 按 standard:compare 真实行结构映射：{ controlPoint, domainA, domainB, tag, left:{requirement, controlName, ...}, right:{...} }
    const rows = (compareResult.value.rows || []).map((r: any) => ({
      controlPoint: r.controlPoint || '',
      domain: r.domainA || r.domainB || '',
      tag: r.tag || '',
      left: r.left ? {
        requirement: (r.left.requirement || '').slice(0, 150),
        controlName: (r.left.controlName || '').slice(0, 100),
      } : null,
      right: r.right ? {
        requirement: (r.right.requirement || '').slice(0, 150),
        controlName: (r.right.controlName || '').slice(0, 100),
      } : null,
    }));
    const res = await window.api.ai.explainStandardDiff({
      baseStandard: left.name,
      targetStandard: right.name,
      // IPC 参数必须脱离 Vue 响应式 Proxy（顶层引用是代理，v8 结构化克隆会直接抛 "could not be cloned"），深拷贝为纯数据
      stats: JSON.parse(JSON.stringify(compareResult.value.stats || {})),
      rows,
    });
    if (res.success && res.data) {
      aiDiffData.value = res.data;
      await revealAiCard(aiDiffCardRef);
    } else {
      aiDiffError.value = res.error?.message || 'AI 解读失败，请稍后重试';
      ElMessage.error(aiDiffError.value);
      await revealAiCard(aiDiffCardRef);
    }
  } catch (err: any) {
    aiDiffError.value = err?.message || 'AI 解读失败，请稍后重试';
    ElMessage.error(aiDiffError.value);
    await revealAiCard(aiDiffCardRef);
  } finally {
    aiDiffLoading.value = false;
  }
}

// ===== 合规差距 =====
const projectListForCompliance = ref<Array<{ id: string; name: string; level?: number; extensionType?: string }>>([]);
const complianceProjectId = ref<string>('');
const complianceStandardId = ref<string>('');
const complianceStatsLoading = ref(false);
const complianceStatsData = ref<any>(null);
const aiComplianceLoading = ref(false);
const aiComplianceData = ref<{
  summary: string;
  gaps: Array<{ domain: string; gap: string; risk: string; priority: string; suggestion: string }>;
  domains: Array<Record<string, any>>;
  stats: Record<string, any>;
} | null>(null);
const aiComplianceError = ref('');
const aiComplianceCardRef = ref<HTMLElement | null>(null);

async function loadProjectListForCompliance() {
  if (!window.api?.project) return;
  try {
    const res = await window.api.project.list({ page: 1, pageSize: 500 });
    if (res.success && res.data) {
      projectListForCompliance.value = (res.data.list || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        level: p.level,
        extensionType: p.extensionType,
      }));
    }
  } catch (err) {
    console.error('加载项目列表失败:', err);
  }
}

async function runComplianceStats() {
  if (!window.api?.standard?.getComplianceStats) {
    ElMessage.warning('统计通道未就绪');
    return;
  }
  if (!complianceProjectId.value || !complianceStandardId.value) {
    ElMessage.warning('请选择项目和标准');
    return;
  }
  complianceStatsLoading.value = true;
  aiComplianceData.value = null;
  aiComplianceError.value = '';
  try {
    const res = await window.api.standard.getComplianceStats({
      projectId: complianceProjectId.value,
      standardId: complianceStandardId.value,
    });
    if (res.success && res.data) {
      complianceStatsData.value = res.data;
    } else {
      complianceStatsData.value = null;
      ElMessage.error(res.error || '统计失败');
    }
  } catch (err: any) {
    ElMessage.error(err?.message || '统计失败');
  } finally {
    complianceStatsLoading.value = false;
  }
}

async function runAiComplianceGap() {
  if (!window.api?.ai) {
    ElMessage.error('AI 通道未就绪，请重启应用后重试');
    return;
  }
  // 数据漂移防护：点击 AI 分析前强制重新统计一次，确保 precomputed 与当前库一致
  // （避免用户点统计后又改动测评记录，导致 AI 基于过期统计给出错误差距）
  await runComplianceStats();
  if (!complianceStatsData.value) {
    ElMessage.warning('统计失败，无法执行 AI 分析');
    return;
  }
  aiComplianceLoading.value = true;
  aiComplianceError.value = '';
  try {
    const res = await window.api.ai.standardComplianceGap({
      projectId: complianceProjectId.value,
      standardId: complianceStandardId.value,
      // 复用已查好的统计结果，避免 AI 通道再做一次全量查库；
      // 整体深拷贝脱离响应式 Proxy，否则 IPC 结构化克隆抛 "could not be cloned"
      precomputed: JSON.parse(JSON.stringify({
        domains: complianceStatsData.value.domains,
        summary: complianceStatsData.value.summary,
        nonCompliantSamples: complianceStatsData.value.nonCompliantSamples,
      })),
    });
    if (res.success && res.data) {
      aiComplianceData.value = res.data;
      await revealAiCard(aiComplianceCardRef);
    } else {
      aiComplianceError.value = res.error?.message || 'AI 分析失败，请稍后重试';
      ElMessage.error(aiComplianceError.value);
      await revealAiCard(aiComplianceCardRef);
    }
  } catch (err: any) {
    aiComplianceError.value = err?.message || 'AI 分析失败，请稍后重试';
    ElMessage.error(aiComplianceError.value);
    await revealAiCard(aiComplianceCardRef);
  } finally {
    aiComplianceLoading.value = false;
  }
}

function resetCompliance() {
  complianceProjectId.value = '';
  complianceStandardId.value = '';
  complianceStatsData.value = null;
  aiComplianceData.value = null;
  aiComplianceError.value = '';
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
  loadStandards();
  loadProjectListForCompliance();
});
</script>

<style scoped lang="scss">
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

.settings-section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
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
