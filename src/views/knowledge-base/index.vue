<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <div class="page-header-title">知识库</div>
        <div class="page-header-desc">查阅测评标准、作业指导书与核查命令库</div>
      </div>
    </div>

    <div class="kb-card">
      <div class="kb-toolbar">
        <div class="kb-tabs">
          <button class="kb-tab" :class="{ active: activeTab === 'documents' }" @click="switchTab('documents')">
            作业指导书
            <span class="kb-tab-badge">{{ totalDocuments }}</span>
          </button>
          <button class="kb-tab" :class="{ active: activeTab === 'commands' }" @click="switchTab('commands')">
            核查命令库
            <span class="kb-tab-badge">{{ commandTotal }}</span>
          </button>
        </div>
        <div class="kb-toolbar-actions">
          <button v-if="activeTab === 'documents'" class="kb-btn" @click="handleImportGuideBook">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="9" y1="14" x2="15" y2="14"/><line x1="9" y1="18" x2="13" y2="18"/></svg>
            导入指导书
          </button>
          <button v-if="activeTab === 'documents'" class="kb-btn kb-btn-primary" @click="showUploadDialog = true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            上传文档
          </button>
          <button v-if="activeTab === 'documents'" class="kb-btn kb-btn-primary" @click="showCategoryDialog = true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            新增分类
          </button>
          <button v-if="activeTab === 'commands'" class="kb-btn kb-btn-primary" @click="addEmptyCommand()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            新增命令
          </button>
          <button v-if="activeTab === 'commands' && commandVersion > 0" class="kb-btn" @click="saveCommandChanges" :disabled="saving">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            保存修改
          </button>
          <div v-if="activeTab === 'documents'" class="kb-search-box">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="kb-search-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input v-model="searchKeyword" type="text" placeholder="搜索文档..." class="kb-search-input" @keyup.enter="handleSearch" @input="debounceSearch">
          </div>
          <select v-if="activeTab === 'documents'" v-model="docTypeFilter" class="kb-select" @change="handleSearch">
            <option value="">全部类型</option>
            <option value="standard">PDF</option>
            <option value="guide">Word</option>
            <option value="tool">Excel</option>
            <option value="other">其他</option>
          </select>
          <button v-if="activeTab === 'documents'" class="kb-btn" @click="toggleSort" title="排序">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="11" y2="6"/><line x1="4" y1="12" x2="11" y2="12"/><line x1="4" y1="18" x2="11" y2="18"/><polyline points="15 15 18 18 21 15"/><line x1="18" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <!-- 作业指导书标签页 -->
      <div v-show="activeTab === 'documents'" class="kb-content-area">
        <div class="kb-sidebar">
          <div class="kb-sidebar-header">
            <span>文档分类</span>
            <button class="kb-sidebar-toggle" @click="expandAll = !expandAll" title="展开/收起全部">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            </button>
          </div>
          <div class="kb-tree">
            <div class="kb-tree-item" :class="{ active: !selectedCategoryId }" @click="selectCategory('')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              <span>全部文档</span>
              <span class="kb-tree-count">{{ allDocCount }}</span>
            </div>
            <div v-for="cat in rootCategories" :key="cat.id" class="kb-tree-node">
              <div
                class="kb-tree-item kb-tree-parent"
                :class="{ open: expandedNodes[cat.id], active: selectedCategoryId === cat.id }"
                @click="selectCategory(cat.id)"
                @contextmenu.prevent="showCategoryMenu($event, cat)"
              >
                <svg
                  class="kb-tree-arrow"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  :style="{ transform: expandedNodes[cat.id] ? 'rotate(90deg)' : 'rotate(0deg)' }"
                  @click.stop="toggleNode(cat.id)"
                >
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" :stroke="cat.color || '#409EFF'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-if="cat.icon !== 'Folder'"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" :stroke="cat.color || '#409EFF'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-else><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                <span>{{ cat.name }}</span>
                <span class="kb-tree-count">{{ getCategoryDocumentCount(cat.id) }}</span>
              </div>
              <div v-if="expandedNodes[cat.id]" class="kb-tree-children">
                <div
                  v-for="child in getChildren(cat.id)"
                  :key="child.id"
                  class="kb-tree-item kb-tree-child"
                  :class="{ active: selectedCategoryId === child.id }"
                  @click="selectCategory(child.id)"
                  @contextmenu.prevent="showCategoryMenu($event, child)"
                >
                  <span>{{ child.name }}</span>
                  <span class="kb-tree-count">{{ getCategoryDocumentCount(child.id) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="kb-main">
          <div class="kb-breadcrumb" v-if="selectedCategoryId">
            <span class="kb-breadcrumb-item" @click="selectCategory('')">全部文档</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            <span class="kb-breadcrumb-item kb-breadcrumb-current">{{ selectedCategoryName }}</span>
          </div>

          <div class="kb-doc-list" v-loading="loading">
            <div v-if="documentList.length === 0 && !loading" class="kb-empty">
              <el-empty description="暂无文档" />
            </div>
            <div
              v-for="doc in documentList"
              :key="doc.id"
              class="kb-doc-card"
            >
              <div class="kb-doc-icon" :class="'type-' + doc.type">
                <svg v-if="doc.type === 'standard'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <svg v-else-if="doc.type === 'guide'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                <svg v-else-if="doc.type === 'tool'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><rect x="8" y="12" width="8" height="6" rx="1"/><line x1="10" y1="15" x2="14" y2="15"/></svg>
                <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <div class="kb-doc-body">
                <div class="kb-doc-title-row">
                  <span class="kb-doc-title" @click="viewDocument(doc)">{{ doc.title }}</span>
                  <span class="kb-doc-tag" :class="'type-' + doc.type">{{ typeLabel(doc.type) }}</span>
                </div>
                <p class="kb-doc-desc">{{ doc.description }}</p>
                <div class="kb-doc-meta">
                  <span>版本: {{ doc.version || '1.0' }}</span>
                  <span>上传: {{ formatDate(doc.uploadDate) }}</span>
                  <span class="kb-doc-refs">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    引用 {{ doc.referenceCount }} 次
                  </span>
                </div>
              </div>
              <div class="kb-doc-actions" @click.stop>
                <button class="kb-btn-sm" @click="viewDocument(doc)">查看</button>
                <button class="kb-btn-sm" @click="downloadDocument(doc)">下载</button>
                <button class="kb-btn-sm kb-btn-sm-primary" @click="showReferenceDialog(doc)">引用</button>
                <button class="kb-btn-sm kb-btn-sm-danger" @click="deleteDocument(doc)" title="删除">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
          </div>

          <div class="kb-pagination-bar">
            <span class="kb-pagination-info">共 {{ pagination.total }} 条</span>
            <div class="kb-pagination-controls">
              <button class="kb-page-btn" :disabled="pagination.page <= 1" @click="changePage(pagination.page - 1)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <button
                v-for="p in pageNumbers"
                :key="p"
                class="kb-page-btn"
                :class="{ active: p === pagination.page }"
                @click="changePage(p)"
              >{{ p }}</button>
              <button class="kb-page-btn" :disabled="pagination.page >= totalPages" @click="changePage(pagination.page + 1)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 核查命令库标签页 -->
      <div v-show="activeTab === 'commands'" class="kb-commands-area">
        <div class="kb-commands-filter">
          <select v-model="commandFilterDeviceType" class="kb-select" @change="loadCommands">
            <option value="">全部类型</option>
            <option value="交换机">交换机</option>
            <option value="防火墙">防火墙</option>
            <option value="路由器">路由器</option>
            <option value="服务器">服务器</option>
            <option value="数据库">数据库</option>
            <option value="中间件">中间件</option>
          </select>
          <select v-model="commandFilterBrand" class="kb-select" @change="loadCommands">
            <option value="">全部品牌</option>
            <option value="华为">华为</option>
            <option value="H3C">H3C</option>
            <option value="思科">思科</option>
            <option value="深信服">深信服</option>
            <option value="天融信">天融信</option>
            <option value="微软">微软</option>
            <option value="Oracle">Oracle</option>
            <option value="PostgreSQL">PostgreSQL</option>
            <option value="Nginx">Nginx</option>
            <option value="Apache">Apache</option>
            <option value="通用">通用</option>
          </select>
          <select v-model="commandFilterOs" class="kb-select" @change="loadCommands">
            <option value="">全部OS</option>
            <option value="Linux">Linux</option>
            <option value="Windows">Windows</option>
            <option value="VRP">华为VRP</option>
            <option value="Comware">H3C Comware</option>
            <option value="IOS">思科IOS</option>
            <option value="SANGFOR">深信服</option>
            <option value="TOPSEC">天融信</option>
            <option value="MySQL">MySQL</option>
            <option value="Oracle">Oracle</option>
            <option value="SQL Server">SQL Server</option>
            <option value="PostgreSQL">PostgreSQL</option>
          </select>
          <select v-model="commandFilterCategory" class="kb-select" @change="loadCommands">
            <option value="">全部类别</option>
            <option value="身份鉴别">身份鉴别</option>
            <option value="访问控制">访问控制</option>
            <option value="安全审计">安全审计</option>
            <option value="通信传输">通信传输</option>
            <option value="入侵防范">入侵防范</option>
            <option value="网络架构">网络架构</option>
            <option value="安全配置">安全配置</option>
          </select>
          <div class="kb-search-box">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="kb-search-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input v-model="commandKeyword" type="text" placeholder="搜索命令..." class="kb-search-input" @input="debounceCommandSearch">
          </div>
        </div>

        <div class="kb-commands-table" v-loading="commandLoading">
          <table v-if="commandList.length > 0">
            <thead>
              <tr>
                <th style="width:40px">序号</th>
                <th style="width:100px">命令名称</th>
                <th style="width:90px">适用对象</th>
                <th>命令内容</th>
                <th style="width:160px">用途说明</th>
                <th style="width:80px">适用OS</th>
                <th style="width:50px;text-align:center">收藏</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(cmd, idx) in commandList" :key="cmd.id" :class="{ 'row-new': String(cmd.id).startsWith('temp-') || editingCommandId === cmd.id }">
                <td>{{ (commandPagination.page - 1) * commandPagination.pageSize + idx + 1 }}</td>
                <td class="cmd-name">
                  <input v-if="String(cmd.id).startsWith('temp-') || editingCommandId === cmd.id" v-model="cmd.name" class="cmd-input" placeholder="命令名称" @input="markCommandModified(cmd)" />
                  <span v-else @click="startEditCommand(cmd)" style="cursor:pointer;">{{ cmd.name }}</span>
                </td>
                <td>
                  <input v-if="String(cmd.id).startsWith('temp-') || editingCommandId === cmd.id" v-model="cmd.target" class="cmd-input" placeholder="适用对象" @input="markCommandModified(cmd)" />
                  <span v-else @click="startEditCommand(cmd)" style="cursor:pointer;">{{ cmd.target }}</span>
                </td>
                <td>
                  <textarea v-if="String(cmd.id).startsWith('temp-') || editingCommandId === cmd.id" v-model="cmd.command" class="cmd-textarea" placeholder="命令内容" @input="markCommandModified(cmd)"></textarea>
                  <code v-else class="cmd-code" @click="startEditCommand(cmd)" style="cursor:pointer;">{{ cmd.command }}</code>
                </td>
                <td class="cmd-desc">
                  <textarea v-if="String(cmd.id).startsWith('temp-') || editingCommandId === cmd.id" v-model="cmd.description" class="cmd-textarea" placeholder="用途说明" @input="markCommandModified(cmd)"></textarea>
                  <span v-else @click="startEditCommand(cmd)" style="cursor:pointer;">{{ cmd.description }}</span>
                </td>
                <td>
                  <input v-if="String(cmd.id).startsWith('temp-') || editingCommandId === cmd.id" v-model="cmd.os" class="cmd-input" placeholder="OS" @input="markCommandModified(cmd)" />
                  <div v-else class="cmd-os-tags">
                    <span v-for="os in cmd.os.split('/')" :key="os" class="cmd-os-tag" :class="'os-' + os.trim().toLowerCase()">{{ os.trim() }}</span>
                  </div>
                </td>
                <td class="cmd-fav" @click="toggleFavorite(cmd)">
                  <span v-if="cmd.isFavorite" class="fav-active">&#9733;</span>
                  <span v-else class="fav-inactive">&#9734;</span>
                </td>
                <td style="width:80px; text-align:center;">
                  <button v-if="String(cmd.id).startsWith('temp-')" class="cmd-action-btn" @click="deleteCommand(cmd)" title="删除">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                  <button v-else-if="editingCommandId === cmd.id" class="cmd-action-btn" @click="cancelEditCommand" title="取消编辑">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                  <template v-else>
                    <button class="cmd-action-btn" @click="startEditCommand(cmd)" title="编辑">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="cmd-action-btn" @click="deleteCommand(cmd)" title="删除">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
          <el-empty v-else-if="!commandLoading" description="暂无命令" />
        </div>

        <div class="kb-pagination-bar">
          <span class="kb-pagination-info">共 {{ commandPagination.total }} 条</span>
          <div class="kb-pagination-controls">
            <button class="kb-page-btn" :disabled="commandPagination.page <= 1" @click="commandChangePage(commandPagination.page - 1)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button
              v-for="p in commandPageNumbers"
              :key="p"
              class="kb-page-btn"
              :class="{ active: p === commandPagination.page }"
              @click="commandChangePage(p)"
            >{{ p }}</button>
            <button class="kb-page-btn" :disabled="commandPagination.page >= commandTotalPages" @click="commandChangePage(commandPagination.page + 1)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 文档查看弹窗 -->
    <el-dialog v-model="docViewerVisible" title="文档预览" width="800px" top="5vh" destroy-on-close>
      <div v-loading="docLoading" class="kb-doc-viewer">
        <h1 class="kb-viewer-title">{{ viewingDoc?.title }}</h1>
        <div class="kb-viewer-meta">
          <span class="kb-doc-tag" :class="'type-' + (viewingDoc?.type || '')">{{ typeLabel(viewingDoc?.type) }}</span>
          <span>版本: {{ viewingDoc?.version || '1.0' }}</span>
          <span>上传: {{ formatDate(viewingDoc?.uploadDate) }}</span>
          <span>引用 {{ viewingDoc?.referenceCount || 0 }} 次</span>
        </div>
        <div v-if="viewingDoc?.tags" class="kb-viewer-tags">
          <span v-for="tag in (viewingDoc?.tags || '').split(',')" :key="tag" class="kb-viewer-tag">{{ tag.trim() }}</span>
        </div>
        <div class="kb-viewer-content" v-html="renderedContent"></div>
      </div>
      <template #footer>
        <el-button @click="docViewerVisible = false">关闭</el-button>
        <el-button type="primary">引用到核查</el-button>
      </template>
    </el-dialog>

    <!-- 新增分类对话框 -->
    <el-dialog v-model="showCategoryDialog" title="新增分类" width="400px" destroy-on-close>
      <el-form :model="categoryForm" label-width="80px">
        <el-form-item label="分类名称">
          <el-input v-model="categoryForm.name" placeholder="请输入分类名称" />
        </el-form-item>
        <el-form-item label="上级分类">
          <el-select v-model="categoryForm.parentId" clearable style="width:100%">
            <el-option label="无（顶级分类）" value="" />
            <el-option v-for="cat in allCategories" :key="cat.id" :label="cat.name" :value="cat.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="颜色">
          <el-color-picker v-model="categoryForm.color" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCategoryDialog = false">取消</el-button>
        <el-button type="primary" @click="handleCreateCategory">确定</el-button>
      </template>
    </el-dialog>

    <!-- 编辑分类对话框 -->
    <el-dialog v-model="showEditCategoryDialog" title="编辑分类" width="400px" destroy-on-close>
      <el-form :model="editCategoryForm" label-width="80px">
        <el-form-item label="分类名称">
          <el-input v-model="editCategoryForm.name" placeholder="请输入分类名称" />
        </el-form-item>
        <el-form-item label="颜色">
          <el-color-picker v-model="editCategoryForm.color" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditCategoryDialog = false">取消</el-button>
        <el-button type="primary" @click="handleUpdateCategory">确定</el-button>
      </template>
    </el-dialog>

    <!-- 导入命令对话框 -->
    <el-dialog v-model="showImportCommandDialog" title="导入核查命令" width="560px" destroy-on-close>
      <el-form :model="importCommandForm" label-width="90px">
        <el-form-item label="设备类型" required>
          <el-select v-model="importCommandForm.deviceType" style="width:100%">
            <option value="交换机">交换机</option>
            <option value="防火墙">防火墙</option>
            <option value="路由器">路由器</option>
            <option value="服务器">服务器</option>
            <option value="数据库">数据库</option>
            <option value="中间件">中间件</option>
          </el-select>
        </el-form-item>
        <el-form-item label="品牌" required>
          <el-input v-model="importCommandForm.brand" placeholder="如: 华为、H3C、思科、通用" />
        </el-form-item>
        <el-form-item label="操作系统" required>
          <el-input v-model="importCommandForm.os" placeholder="如: Linux、Windows、VRP、Comware" />
        </el-form-item>
        <el-form-item label="核查类别" required>
          <el-select v-model="importCommandForm.category" style="width:100%">
            <option value="身份鉴别">身份鉴别</option>
            <option value="访问控制">访问控制</option>
            <option value="安全审计">安全审计</option>
            <option value="通信传输">通信传输</option>
            <option value="入侵防范">入侵防范</option>
            <option value="网络架构">网络架构</option>
            <option value="安全配置">安全配置</option>
          </el-select>
        </el-form-item>
        <el-form-item label="子类别">
          <el-input v-model="importCommandForm.subCategory" placeholder="如: 用户管理、密码策略" />
        </el-form-item>
        <el-form-item label="命令文件" required>
          <div style="display:flex; gap:8px;">
            <el-input v-model="commandFile" placeholder="请选择JSON格式的命令文件" readonly style="flex:1" />
            <el-button @click="selectCommandFile">选择文件</el-button>
          </div>
          <div style="font-size:12px; color:var(--color-text-tertiary); margin-top:4px;">
            文件格式: JSON数组，每项包含 name, target, command, description 字段
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showImportCommandDialog = false">取消</el-button>
        <el-button type="primary" @click="handleImportCommandFile" :disabled="!commandFile || !importCommandForm.deviceType || !importCommandForm.brand || !importCommandForm.os || !importCommandForm.category">导入</el-button>
      </template>
    </el-dialog>

    <!-- 上传文档对话框 -->
    <el-dialog v-model="showUploadDialog" title="上传文档" width="500px" destroy-on-close>
      <el-form :model="uploadForm" label-width="80px">
        <el-form-item label="文档标题">
          <el-input v-model="uploadForm.title" placeholder="请输入文档标题" />
        </el-form-item>
        <el-form-item label="文档分类">
          <el-select v-model="uploadForm.categoryId" style="width:100%">
            <el-option v-for="cat in allCategories" :key="cat.id" :label="cat.name" :value="cat.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="文档类型">
          <el-select v-model="uploadForm.type" style="width:100%">
            <el-option label="PDF" value="standard" />
            <el-option label="Word" value="guide" />
            <el-option label="Excel" value="tool" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item label="版本">
          <el-input v-model="uploadForm.version" placeholder="如: 1.0" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="uploadForm.description" type="textarea" :rows="3" placeholder="请输入文档描述" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="uploadForm.tags" placeholder="多个标签用逗号分隔" />
        </el-form-item>
        <el-form-item label="文件路径">
          <div style="display:flex; gap:8px;">
            <el-input v-model="uploadForm.filePath" placeholder="请选择文件" readonly style="flex:1" />
            <el-button @click="selectDocumentFile">选择文件</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showUploadDialog = false">取消</el-button>
        <el-button type="primary" @click="handleUploadDocument">上传</el-button>
      </template>
    </el-dialog>

    <!-- 引用文档对话框 -->
    <el-dialog v-model="showReferenceDialogVisible" title="引用文档" width="450px" destroy-on-close>
      <p style="margin-bottom:16px; color:var(--color-text-secondary); font-size:var(--text-sm);">
        将文档 "{{ referenceDoc?.title }}" 引用到以下目标：
      </p>
      <el-form :model="referenceForm" label-width="80px">
        <el-form-item label="引用类型">
          <el-radio-group v-model="referenceForm.targetType">
            <el-radio value="asset">引用到资产</el-radio>
            <el-radio value="assessment">引用到核查项</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="选择目标">
          <el-select v-model="referenceForm.targetId" placeholder="请选择具体目标" style="width:100%">
            <el-option v-if="referenceForm.targetType === 'asset'" v-for="asset in assetList" :key="asset.id" :label="asset.name" :value="asset.id" />
            <el-option v-else v-for="item in assessmentList" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showReferenceDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleReferenceDocument" :disabled="!referenceForm.targetId">确认引用</el-button>
      </template>
    </el-dialog>

    <!-- 导入指导书对话框 -->
    <el-dialog v-model="showImportGuideDialog" title="导入测评指导书" width="700px" destroy-on-close>
      <el-form :model="importGuideForm" label-width="100px">
        <el-form-item label="选择目录">
          <div style="display:flex; gap:8px;">
            <el-input v-model="importGuideForm.dirPath" placeholder="请选择指导书目录" readonly style="flex:1" />
            <el-button @click="selectGuideDirectory">选择目录</el-button>
          </div>
        </el-form-item>
        <el-form-item label="目标分类">
          <el-select v-model="importGuideForm.categoryId" style="width:100%">
            <el-option v-for="cat in allCategories" :key="cat.id" :label="cat.name" :value="cat.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="文档类型">
          <el-select v-model="importGuideForm.type" style="width:100%">
            <el-option label="Excel" value="tool" />
            <el-option label="Word" value="guide" />
            <el-option label="PDF" value="standard" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item label="版本">
          <el-input v-model="importGuideForm.version" placeholder="如: V2.0" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="importGuideForm.tags" placeholder="多个标签用逗号分隔" />
        </el-form-item>
      </el-form>

      <div v-if="guideFileList.length > 0" style="margin-top:16px; border:1px solid var(--color-border-default); border-radius:8px; padding:16px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
          <span style="font-weight:600; color:var(--color-text-primary);">待导入文件 ({{ guideFileList.length }})</span>
          <el-button size="small" @click="selectAllFiles" :disabled="selectedFiles.length === guideFileList.length">全选</el-button>
        </div>
        <div style="max-height:300px; overflow-y:auto;">
          <div v-for="file in guideFileList" :key="file.path" style="display:flex; align-items:center; padding:8px; border-bottom:1px solid var(--color-border-light);">
            <el-checkbox v-model="selectedFiles" :value="file.path" />
            <div style="margin-left:12px; flex:1; min-width:0;">
              <div style="font-size:13px; font-weight:500; color:var(--color-text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{{ file.name }}</div>
              <div style="font-size:11px; color:var(--color-text-tertiary);">{{ formatFileSize(file.size) }}</div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="showImportGuideDialog = false">取消</el-button>
        <el-button type="primary" @click="handleBatchImportGuide" :disabled="selectedFiles.length === 0 || !importGuideForm.categoryId">导入 {{ selectedFiles.length }} 个文件</el-button>
      </template>
    </el-dialog>

    <!-- 分类右键菜单 -->
    <div v-if="contextMenuVisible" class="kb-context-menu" :style="{ left: contextMenuX + 'px', top: contextMenuY + 'px' }" @click.stop>
      <div class="kb-context-menu-item" @click="editCategory(contextMenuCategory)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        编辑分类
      </div>
      <div class="kb-context-menu-item kb-context-menu-danger" @click="deleteCategory(contextMenuCategory)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        删除分类
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { KnowledgeCategory, KnowledgeDocument, KnowledgeCommand } from '../../../shared/types';

const activeTab = ref('documents');
const loading = ref(false);
const docLoading = ref(false);
const commandLoading = ref(false);
const searchKeyword = ref('');
const docTypeFilter = ref('');
const expandAll = ref(false);

const selectedCategoryId = ref('');
const allCategories = ref<KnowledgeCategory[]>([]);
const documentList = ref<KnowledgeDocument[]>([]);
const commandList = ref<KnowledgeCommand[]>([]);

const docViewerVisible = ref(false);
const viewingDoc = ref<KnowledgeDocument | null>(null);

const showCategoryDialog = ref(false);
const showUploadDialog = ref(false);
const showReferenceDialogVisible = ref(false);
const showImportGuideDialog = ref(false);
const showImportCommandDialog = ref(false);
const importCommandForm = reactive({
  os: '',
  brand: '',
  deviceType: '',
  category: '',
  subCategory: '',
});
const commandFile = ref('');
const referenceDoc = ref<KnowledgeDocument | null>(null);
const referenceForm = reactive({
  targetType: 'asset',
  targetId: '',
});
const assetList = ref<{ id: string; name: string }[]>([]);
const assessmentList = ref<{ id: string; name: string }[]>([]);
const guideFileList = ref<{ name: string; path: string; size: number }[]>([]);
const selectedFiles = ref<string[]>([]);

const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuCategory = ref<KnowledgeCategory | null>(null);

const categoryForm = reactive({
  name: '',
  parentId: '',
  color: '#409EFF',
});

const showEditCategoryDialog = ref(false);
const editingCategoryId = ref('');
const editCategoryForm = reactive({
  name: '',
  color: '#409EFF',
});

const uploadForm = reactive({
  categoryId: '',
  title: '',
  type: 'standard',
  version: '1.0',
  description: '',
  tags: '',
  filePath: '',
});

const importGuideForm = reactive({
  dirPath: '',
  categoryId: '',
  type: 'tool',
  version: 'V2.0',
  tags: '测评指导书,等级保护',
});

const sortField = ref('uploadDate');
const sortOrder = ref('desc');

const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0,
});

const commandPagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0,
});

const saving = ref(false);

const commandFilterOs = ref('');
const commandFilterBrand = ref('');
const commandFilterDeviceType = ref('');
const commandFilterCategory = ref('');
const commandFilterSubCategory = ref('');
const commandKeyword = ref('');

const tempCommandIdCounter = ref(-1);
const modifiedCommandIds = reactive<Set<string>>(new Set());
const commandVersion = ref(0);
const editingCommandId = ref<string | null>(null);

const expandedNodes = reactive<Record<string, boolean>>({});

const rootCategories = computed(() => {
  return allCategories.value.filter(c => !c.parentId);
});

const totalDocuments = computed(() => pagination.total);

const allDocCount = computed(() => pagination.total);

const selectedCategoryName = computed(() => {
  if (!selectedCategoryId.value) return '全部文档';
  const cat = allCategories.value.find(c => c.id === selectedCategoryId.value);
  return cat?.name || '全部文档';
});

const commandTotal = computed(() => commandPagination.total);

const totalPages = computed(() => Math.max(1, Math.ceil(pagination.total / pagination.pageSize)));

const commandTotalPages = computed(() => Math.max(1, Math.ceil(commandPagination.total / commandPagination.pageSize)));

const pageNumbers = computed(() => {
  const pages: number[] = [];
  const total = totalPages.value;
  const current = pagination.page;
  let start = Math.max(1, current - 2);
  let end = Math.min(total, start + 4);
  if (end - start < 4) {
    start = Math.max(1, end - 4);
  }
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }
  return pages;
});

const commandPageNumbers = computed(() => {
  const pages: number[] = [];
  const total = commandTotalPages.value;
  const current = commandPagination.page;
  let start = Math.max(1, current - 2);
  let end = Math.min(total, start + 4);
  if (end - start < 4) {
    start = Math.max(1, end - 4);
  }
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }
  return pages;
});

const renderedContent = computed(() => {
  return renderMarkdown(viewingDoc.value?.content || '');
});

function getChildren(parentId: string) {
  return allCategories.value.filter(c => c.parentId === parentId);
}

function typeLabel(type?: string) {
  const map: Record<string, string> = {
    standard: 'PDF',
    guide: 'Word',
    tool: 'Excel',
    other: '其他',
  };
  return map[type || ''] || type || '';
}

function formatDate(date?: string) {
  if (!date) return '';
  const d = new Date(date);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function renderMarkdown(text: string): string {
  if (!text) return '';
  let html = text;
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');
  html = html.replace(/^- (.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  html = html.replace(/^(\d+)\. (.*$)/gim, '<li>$2</li>');
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  html = '<p>' + html + '</p>';
  return html;
}

function toggleNode(id: string) {
  expandedNodes[id] = !expandedNodes[id];
}

function switchTab(tab: string) {
  activeTab.value = tab;
  if (tab === 'commands') {
    loadCommands();
  }
}

function selectCategory(catId: string) {
  selectedCategoryId.value = catId;
  pagination.page = 1;
  loadDocuments();
}

function showCategoryMenu(event: MouseEvent, cat: KnowledgeCategory) {
  contextMenuCategory.value = cat;
  contextMenuX.value = event.clientX;
  contextMenuY.value = event.clientY;
  contextMenuVisible.value = true;
  // 点击其他地方关闭菜单
  setTimeout(() => {
    document.addEventListener('click', closeContextMenu);
  }, 0);
}

function closeContextMenu() {
  contextMenuVisible.value = false;
  document.removeEventListener('click', closeContextMenu);
}

function editCategory(cat: KnowledgeCategory | null) {
  if (!cat) return;
  closeContextMenu();
  editingCategoryId.value = cat.id;
  editCategoryForm.name = cat.name;
  editCategoryForm.color = cat.color || '#409EFF';
  showEditCategoryDialog.value = true;
}

async function handleUpdateCategory() {
  if (!editCategoryForm.name) {
    ElMessage.warning('请输入分类名称');
    return;
  }
  if (!window.api || !editingCategoryId.value) return;
  const res = await window.api.knowledge.updateCategory(editingCategoryId.value, {
    name: editCategoryForm.name,
    color: editCategoryForm.color,
  });
  if (res.success) {
    ElMessage.success('分类更新成功');
    showEditCategoryDialog.value = false;
    loadCategories();
  }
}

async function deleteCategory(cat: KnowledgeCategory | null) {
  if (!cat || !window.api) return;
  closeContextMenu();
  const docCount = getCategoryDocumentCount(cat.id);
  try {
    await ElMessageBox.confirm(
      `确定要删除分类「${cat.name}」吗？\n该分类及其子分类下的 ${docCount} 个文档将移至未分类。`,
      '删除确认',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      }
    );
  } catch {
    return;
  }
  try {
    const res = await window.api.knowledge.deleteCategory(cat.id);
    if (res.success) {
      ElMessage.success('分类删除成功');
      if (selectedCategoryId.value && selectedCategoryId.value === cat.id) {
        selectedCategoryId.value = '';
      }
      loadCategories();
      loadDocuments();
    }
  } catch {
    ElMessage.error('删除失败');
  }
}

function getCategoryDocumentCount(catId: string): number {
  const children = allCategories.value.filter(c => c.parentId === catId);
  let count = 0;
  // 优先使用分页总数（当选中该分类时）
  if (selectedCategoryId.value === catId && documentList.value.length > 0) {
    count += pagination.total;
  } else {
    const cat = allCategories.value.find(c => c.id === catId);
    count += cat?.documentCount || 0;
  }
  for (const child of children) {
    count += getCategoryDocumentCount(child.id);
  }
  return count;
}

function changePage(page: number) {
  if (page < 1 || page > totalPages.value) return;
  pagination.page = page;
  loadDocuments();
}

function commandChangePage(page: number) {
  if (page < 1 || page > commandTotalPages.value) return;
  commandPagination.page = page;
  loadCommands();
}

let searchTimer: any = null;
function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    pagination.page = 1;
    loadDocuments();
  }, 300);
}

let cmdSearchTimer: any = null;
function debounceCommandSearch() {
  clearTimeout(cmdSearchTimer);
  cmdSearchTimer = setTimeout(() => {
    commandPagination.page = 1;
    loadCommands();
  }, 300);
}

function handleSearch() {
  pagination.page = 1;
  loadDocuments();
}

async function loadCategories() {
  if (!window.api) return;
  const res = await window.api.knowledge.listCategories();
  if (res.success && res.data) {
    allCategories.value = res.data;
    res.data.forEach(cat => {
      if (!cat.parentId) {
        expandedNodes[cat.id] = true;
      }
    });
  }
}

watch(expandAll, (val) => {
  allCategories.value.forEach(cat => {
    if (!cat.parentId) {
      expandedNodes[cat.id] = val;
    }
  });
});

async function loadDocuments() {
  if (!window.api) return;
  loading.value = true;
  try {
    const params: any = {
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
    if (selectedCategoryId.value) params.categoryId = selectedCategoryId.value;
    if (searchKeyword.value) params.keyword = searchKeyword.value;
    if (docTypeFilter.value) params.type = docTypeFilter.value;
    params.sortField = sortField.value;
    params.sortOrder = sortOrder.value;

    const res = await window.api.knowledge.listDocuments(params);
    if (res.success && res.data) {
      documentList.value = res.data.list;
      pagination.total = res.data.total;
    }
  } finally {
    loading.value = false;
  }
}

async function loadCommands() {
  if (!window.api) return;
  commandLoading.value = true;
  try {
    const params: any = {
      page: commandPagination.page,
      pageSize: commandPagination.pageSize,
    };
    if (commandFilterOs.value) params.os = commandFilterOs.value;
    if (commandFilterBrand.value) params.brand = commandFilterBrand.value;
    if (commandFilterDeviceType.value) params.deviceType = commandFilterDeviceType.value;
    if (commandFilterCategory.value) params.category = commandFilterCategory.value;
    if (commandFilterSubCategory.value) params.subCategory = commandFilterSubCategory.value;
    if (commandKeyword.value) params.keyword = commandKeyword.value;

    const res = await window.api.knowledge.listCommands(params);
    if (res.success && res.data) {
      commandList.value = res.data.list;
      commandPagination.total = res.data.total;
    }
  } finally {
    commandLoading.value = false;
  }
}

function addEmptyCommand() {
  const newCmd: any = {
    id: `temp-${tempCommandIdCounter.value--}`,
    name: '',
    target: '',
    command: '',
    description: '',
    os: 'Linux',
    brand: '通用',
    deviceType: '服务器',
    category: '身份鉴别',
    subCategory: '',
    isFavorite: 0,
    referenceCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  modifiedCommandIds.add(newCmd.id);
  commandVersion.value++;
  commandList.value.unshift(newCmd);
}

function markCommandModified(cmd: KnowledgeCommand) {
  modifiedCommandIds.add(String(cmd.id));
  commandVersion.value++;
}

async function saveCommandChanges() {
  if (!window.api) return;
  saving.value = true;
  let created = 0;
  let updated = 0;
  try {
    for (const cmd of commandList.value) {
      if (!modifiedCommandIds.has(String(cmd.id))) continue;
      
      if (String(cmd.id).startsWith('temp-')) {
        const res = await window.api.knowledge.createCommand({
          name: cmd.name,
          target: cmd.target,
          command: cmd.command,
          description: cmd.description,
          os: cmd.os,
          brand: cmd.brand,
          deviceType: cmd.deviceType,
          category: cmd.category,
          subCategory: cmd.subCategory || '',
          createdAt: cmd.createdAt,
          updatedAt: cmd.updatedAt,
        });
        if (res.success) created++;
      } else {
        const res = await window.api.knowledge.updateCommand(cmd.id, {
          name: cmd.name,
          target: cmd.target,
          command: cmd.command,
          description: cmd.description,
          os: cmd.os,
          brand: cmd.brand,
          deviceType: cmd.deviceType,
          category: cmd.category,
          subCategory: cmd.subCategory || '',
        });
        if (res.success) updated++;
      }
    }
    
    modifiedCommandIds.clear();
    commandVersion.value = 0;
    ElMessage.success(`保存成功：新增 ${created} 条，更新 ${updated} 条`);
    loadCommands();
  } catch (error) {
    ElMessage.error('保存失败：' + (error instanceof Error ? error.message : '未知错误'));
  } finally {
    saving.value = false;
  }
}

async function viewDocument(doc: KnowledgeDocument) {
  if (!window.api) return;
  docLoading.value = true;
  docViewerVisible.value = true;
  viewingDoc.value = doc;
  try {
    const res = await window.api.knowledge.getDocument(doc.id);
    if (res.success && res.data) {
      viewingDoc.value = res.data;
    }
  } finally {
    docLoading.value = false;
  }
}

async function toggleFavorite(cmd: KnowledgeCommand) {
  if (!window.api) return;
  const newVal = cmd.isFavorite ? 0 : 1;
  const res = await window.api.knowledge.favoriteCommand(cmd.id, newVal);
  if (res.success) {
    cmd.isFavorite = newVal;
  }
}

function startEditCommand(cmd: KnowledgeCommand) {
  editingCommandId.value = cmd.id;
  markCommandModified(cmd);
}

function cancelEditCommand() {
  editingCommandId.value = null;
}

async function deleteCommand(cmd: KnowledgeCommand) {
  if (!window.api) return;
  try {
    await ElMessageBox.confirm('确定删除该命令吗？', '提示', { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' });
    const res = await window.api.knowledge.deleteCommand(cmd.id);
    if (res.success) {
      ElMessage.success('删除成功');
      commandList.value = commandList.value.filter(c => c.id !== cmd.id);
    } else {
      ElMessage.error('删除失败');
    }
  } catch {
    // 取消删除
  }
}

async function handleCreateCategory() {
  if (!categoryForm.name) {
    ElMessage.warning('请输入分类名称');
    return;
  }
  if (!window.api) return;
  const parentId = categoryForm.parentId || '';
  const res = await window.api.knowledge.createCategory({
    name: categoryForm.name,
    parentId: parentId || undefined,
    color: categoryForm.color,
    icon: parentId ? 'Document' : 'Folder',
  });
  if (res.success) {
    ElMessage.success('分类创建成功');
    showCategoryDialog.value = false;
    categoryForm.name = '';
    categoryForm.parentId = '';
    categoryForm.color = '#409EFF';
    loadCategories();
    if (parentId) {
      expandedNodes[parentId] = true;
    }
  }
}

async function downloadDocument(doc: KnowledgeDocument) {
  if (!window.api) return;
  try {
    const res = await window.api.knowledge.downloadAndSave(doc.id);
    if (res.success && res.data?.path) {
      ElMessage.success(`文件已保存到: ${res.data.path}`);
    }
  } catch {
    ElMessage.error('下载失败');
  }
}

async function selectDocumentFile() {
  if (!window.api) return;
  try {
    const res = await window.api.dialog.showOpenDialog({
      title: '选择文档文件',
      filters: [
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Word', extensions: ['doc', 'docx'] },
        { name: 'Excel', extensions: ['xlsx', 'xls'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (res.success && !res.data?.canceled && res.data?.filePaths?.[0]) {
      uploadForm.filePath = res.data.filePaths[0];
    }
  } catch {
    ElMessage.error('文件选择失败');
  }
}

async function selectCommandFile() {
  if (!window.api) return;
  try {
    const res = await window.api.dialog.showOpenDialog({
      title: '选择命令文件',
      filters: [
        { name: 'JSON文件', extensions: ['json'] },
      ],
      properties: ['openFile'],
    });
    if (res.success && !res.data?.canceled && res.data?.filePaths?.[0]) {
      commandFile.value = res.data.filePaths[0];
    }
  } catch {
    ElMessage.error('文件选择失败');
  }
}

async function handleImportCommandFile() {
  if (!window.api || !commandFile.value) return;
  try {
    const fs = await import('fs');
    const content = fs.readFileSync(commandFile.value, 'utf-8');
    const commands = JSON.parse(content);

    if (!Array.isArray(commands)) {
      ElMessage.error('文件格式错误：必须是JSON数组');
      return;
    }

    const now = new Date().toISOString();
    const validCommands = commands.filter((cmd: any) => {
      return cmd.name && cmd.command && cmd.description && cmd.target;
    });

    if (validCommands.length === 0) {
      ElMessage.error('没有找到有效的命令数据');
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const cmd of validCommands) {
      try {
        const id = `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const res = await window.api.knowledge.createCommand({
          id,
          name: cmd.name,
          target: cmd.target || `${importCommandForm.deviceType}设备`,
          command: cmd.command,
          description: cmd.description,
          os: importCommandForm.os,
          brand: importCommandForm.brand,
          deviceType: importCommandForm.deviceType,
          category: importCommandForm.category,
          subCategory: cmd.subCategory || importCommandForm.subCategory || '',
          createdAt: now,
          updatedAt: now,
        });
        if (res.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }

    if (successCount > 0) {
      ElMessage.success(`导入完成：成功 ${successCount} 条，失败 ${failCount} 条`);
      showImportCommandDialog.value = false;
      loadCommands();
    } else {
      ElMessage.error('导入失败：没有成功导入任何命令');
    }
  } catch (error) {
    ElMessage.error('文件读取失败：' + (error instanceof Error ? error.message : '未知错误'));
  }
}

async function handleUploadDocument() {
  if (!uploadForm.title || !uploadForm.categoryId || !uploadForm.filePath) {
    ElMessage.warning('请填写必填项（标题、分类、文件路径）');
    return;
  }
  if (!window.api) return;
  try {
    const res = await window.api.knowledge.uploadDocument({
      categoryId: uploadForm.categoryId,
      title: uploadForm.title,
      type: uploadForm.type,
      description: uploadForm.description,
      version: uploadForm.version,
      tags: uploadForm.tags,
      filePath: uploadForm.filePath,
    });
    if (res.success) {
      ElMessage.success('文档上传成功');
      showUploadDialog.value = false;
      Object.assign(uploadForm, {
        categoryId: '',
        title: '',
        type: 'standard',
        version: '1.0',
        description: '',
        tags: '',
        filePath: '',
      });
      loadCategories();
      loadDocuments();
    }
  } catch {
    ElMessage.error('上传失败');
  }
}

async function deleteDocument(doc: KnowledgeDocument) {
  try {
    await ElMessageBox.confirm(`确定要删除文档「${doc.title}」吗？此操作不可恢复。`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch {
    return;
  }
  if (!window.api) return;
  try {
    const res = await window.api.knowledge.deleteDocument(doc.id);
    if (res.success) {
      ElMessage.success('删除成功');
      loadCategories();
      loadDocuments();
    }
  } catch {
    ElMessage.error('删除失败');
  }
}

function showReferenceDialog(doc: KnowledgeDocument) {
  referenceDoc.value = doc;
  referenceForm.targetType = 'asset';
  referenceForm.targetId = '';
  showReferenceDialogVisible.value = true;
  loadAssets();
  loadAssessments();
}

async function loadAssets() {
  // 知识库为全局页面，缺少项目上下文，暂不加载资产列表
  assetList.value = [];
}

async function loadAssessments() {
  // 知识库为全局页面，缺少项目上下文，暂不加载测评项列表
  assessmentList.value = [];
}

async function handleReferenceDocument() {
  if (!referenceDoc.value || !referenceForm.targetId || !window.api) return;
  try {
    const res = await window.api.knowledge.referenceDocument({
      documentId: referenceDoc.value.id,
      targetId: referenceForm.targetId,
      targetType: referenceForm.targetType,
    });
    if (res.success) {
      ElMessage.success('引用成功');
      showReferenceDialogVisible.value = false;
      loadDocuments();
    }
  } catch {
    ElMessage.error('引用失败');
  }
}

function toggleSort() {
  if (sortOrder.value === 'desc') {
    sortOrder.value = 'asc';
  } else {
    sortOrder.value = 'desc';
    if (sortField.value === 'uploadDate') {
      sortField.value = 'title';
    } else {
      sortField.value = 'uploadDate';
    }
  }
  loadDocuments();
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function handleImportGuideBook() {
  showImportGuideDialog.value = true;
  importGuideForm.dirPath = '';
  importGuideForm.categoryId = '';
  importGuideForm.type = 'tool';
  importGuideForm.version = 'V2.0';
  importGuideForm.tags = '测评指导书,等级保护';
  guideFileList.value = [];
  selectedFiles.value = [];
}

async function selectGuideDirectory() {
  if (!window.api) return;
  try {
    const res = await window.api.dialog.showOpenDialog({
      title: '选择指导书目录',
      properties: ['openDirectory'],
    });
    if (res.success && !res.data?.canceled && res.data?.filePaths?.[0]) {
      importGuideForm.dirPath = res.data.filePaths[0];
      await loadGuideFiles();
    }
  } catch {
    ElMessage.error('目录选择失败');
  }
}

async function loadGuideFiles() {
  if (!importGuideForm.dirPath || !window.api) return;
  try {
    const res = await window.api.knowledge.listDirectoryFiles(importGuideForm.dirPath);
    if (res.success && res.data) {
      guideFileList.value = res.data.filter(f => f.isFile && /\.(xlsx|xls|docx|doc|pdf)$/i.test(f.name));
      selectedFiles.value = guideFileList.value.map(f => f.path);
    }
  } catch {
    ElMessage.error('读取目录失败');
  }
}

function selectAllFiles() {
  if (selectedFiles.value.length === guideFileList.value.length) {
    selectedFiles.value = [];
  } else {
    selectedFiles.value = guideFileList.value.map(f => f.path);
  }
}

async function handleBatchImportGuide() {
  if (!window.api || selectedFiles.value.length === 0) return;
  
  const files = guideFileList.value.filter(f => selectedFiles.value.includes(f.path));
  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    try {
      const title = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      const res = await window.api.knowledge.importSingleDocument({
        categoryId: importGuideForm.categoryId,
        title: title,
        type: importGuideForm.type,
        description: `网络安全等级保护测评指导书 - ${title}`,
        version: importGuideForm.version,
        tags: importGuideForm.tags,
        filePath: file.path,
      });
      if (res.success) {
        successCount++;
      } else {
        failCount++;
      }
    } catch {
      failCount++;
    }
  }

  ElMessage.success(`导入完成：成功 ${successCount} 个，失败 ${failCount} 个`);
  showImportGuideDialog.value = false;
  loadCategories();
  loadDocuments();
}

onMounted(() => {
  loadCategories();
  loadDocuments();
  loadCommands();
});
</script>

<style scoped lang="scss">
$primary: var(--color-primary);
$primary-hover: var(--color-primary-active);
$primary-light: var(--color-primary-light);
$bg-page: var(--color-bg-page);
$bg-surface: var(--color-bg-card);
$bg-hover: var(--color-bg-hover);
$border: var(--color-border-base);
$border-light: var(--color-border-light);
$text-primary: var(--color-text-primary);
$text-secondary: var(--color-text-secondary);
$text-tertiary: var(--color-text-tertiary);
$success: var(--color-success);
$success-light: var(--color-success-light);
$warning: var(--color-warning);
$warning-light: var(--color-warning-light);
$error: var(--color-danger);
$error-light: var(--color-danger-light);
$info: var(--color-info);
$info-light: var(--color-primary-light);

.kb-card {
  background: $bg-surface;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  overflow: hidden;
}

.kb-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-bottom: 1px solid $border;

  .kb-tabs {
    display: flex;
    align-items: center;
    gap: 0;
    height: 40px;
  }

  .kb-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 16px;
    height: 100%;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    color: $text-secondary;
    position: relative;
    white-space: nowrap;
    font-family: inherit;

    &.active {
      color: $primary;
      span {
        background: $primary-light;
        color: $primary;
      }
      &::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 16px;
        right: 16px;
        height: 2px;
        background: $primary;
        border-radius: 1px;
      }
    }
  }

  .kb-tab-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 18px;
    padding: 0 5px;
    background: $bg-hover;
    color: $text-tertiary;
    border-radius: 9999px;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
  }

  .kb-toolbar-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.kb-btn {
  height: 32px;
  padding: 0 14px;
  border: 1px solid $border;
  border-radius: 6px;
  background: $bg-surface;
  color: $text-secondary;
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  font-family: inherit;
  transition: all 0.15s;

  &:hover {
    border-color: $primary;
    color: $primary;
  }

  svg {
    flex-shrink: 0;
  }
}

.kb-btn-primary {
  background: $primary;
  color: #fff;
  border-color: $primary;

  &:hover {
    background: $primary-hover;
    color: #fff;
  }
}

.kb-search-box {
  position: relative;
  display: flex;
  align-items: center;

  .kb-search-icon {
    position: absolute;
    left: 8px;
    pointer-events: none;
    color: $text-tertiary;
  }

  .kb-search-input {
    width: 180px;
    height: 32px;
    padding: 0 8px 0 28px;
    border: 1px solid $border;
    border-radius: 6px;
    font-size: 12px;
    color: $text-primary;
    background: $bg-surface;
    outline: none;
    font-family: inherit;

    &:focus {
      border-color: $primary;
    }
  }
}

.kb-select {
  height: 32px;
  padding: 0 24px 0 8px;
  border: 1px solid $border;
  border-radius: 6px;
  font-size: 12px;
  color: $text-secondary;
  background: $bg-surface;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  font-family: inherit;
  background-image: url("data:image/svg+xml;utf8,<svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat: no-repeat;
  background-position: right 6px center;
}

.kb-content-area {
  display: flex;
  min-height: 500px;
}

.kb-sidebar {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid $border;
  background: $bg-surface;
  overflow-y: auto;

  .kb-sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid $border-light;

    span {
      font-size: 12px;
      font-weight: 600;
      color: $text-primary;
      white-space: nowrap;
    }
  }

  .kb-sidebar-toggle {
    border: none;
    background: transparent;
    cursor: pointer;
    color: $text-tertiary;
    padding: 2px;
    display: flex;
    align-items: center;

    &:hover {
      color: $text-secondary;
    }
  }
}

.kb-tree {
  padding: 4px 0;
}

.kb-tree-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  cursor: pointer;
  font-size: 12px;
  color: $text-primary;
  transition: all 0.15s;

  &:hover {
    background: $bg-hover;
  }

  &.active {
    background: $primary-light;
    color: $primary;
    font-weight: 500;
  }

  svg {
    flex-shrink: 0;
  }

  span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kb-tree-count {
    flex: none;
    font-size: 11px;
    color: $text-tertiary;
  }
}

.kb-tree-parent {
  font-weight: 500;

  .kb-tree-arrow {
    transition: transform 0.15s;
    flex-shrink: 0;
  }
}

.kb-tree-children {
  padding-left: 32px;
}

.kb-tree-child {
  padding: 5px 12px;
  color: $text-secondary;
}

.kb-main {
  flex: 1;
  min-width: 0;
  padding: 16px 20px;
  background: $bg-surface;
  display: flex;
  flex-direction: column;
}

.kb-breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 16px;
  font-size: 12px;

  .kb-breadcrumb-item {
    color: $text-tertiary;
    cursor: pointer;

    &:hover {
      color: $primary;
    }
  }

  .kb-breadcrumb-current {
    color: $text-primary;
    font-weight: 500;
  }

  svg {
    color: $text-tertiary;
  }
}

.kb-doc-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.kb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}

.kb-doc-card {
  border: 1px solid $border;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  gap: 14px;
  align-items: flex-start;
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s;

  &:hover {
    box-shadow: 0 4px 8px rgba(0,0,0,0.05);
    border-color: $primary;
  }

  .kb-doc-icon {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;

    &.type-standard {
      background: $error-light;
      color: $error;
    }
    &.type-guide {
      background: $info-light;
      color: $info;
    }
    &.type-tool {
      background: $success-light;
      color: $success;
    }
    &.type-other {
      background: rgba(144,147,153,0.1);
      color: #909399;
    }
  }

  .kb-doc-body {
    flex: 1;
    min-width: 0;
  }

  .kb-doc-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .kb-doc-title {
    font-size: 14px;
    font-weight: 600;
    color: $text-primary;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    cursor: pointer;
    white-space: nowrap;
  }

  .kb-doc-desc {
    font-size: 12px;
    color: $text-secondary;
    margin: 0 0 8px;
    line-height: 1.65;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .kb-doc-meta {
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: 11px;
    color: $text-tertiary;

    svg {
      vertical-align: middle;
    }
  }

  .kb-doc-tag {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 2px;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;

    &.type-standard {
      background: $error-light;
      color: $error;
    }
    &.type-guide {
      background: $info-light;
      color: $info;
    }
    &.type-tool {
      background: $success-light;
      color: $success;
    }
    &.type-other {
      background: rgba(144,147,153,0.1);
      color: #909399;
    }
  }

  .kb-doc-refs {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .kb-doc-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
}

.kb-btn-sm {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  height: 28px;
  border: 1px solid $border;
  background: $bg-surface;
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
  color: $text-secondary;
  white-space: nowrap;
  font-family: inherit;
  transition: all 0.15s;

  &:hover {
    border-color: $primary;
    color: $primary;
  }
}

.kb-btn-sm-primary {
  border-color: $primary;
  background: $primary-light;
  color: $primary;

  &:hover {
    background: $primary;
    color: #fff;
  }
}

.kb-btn-sm-danger {
  border-color: $error;
  background: $error-light;
  color: $error;

  &:hover {
    background: $error;
    color: #fff;
  }
}

.kb-pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-top: 1px solid $border;
  margin-top: 16px;

  .kb-pagination-info {
    font-size: 12px;
    color: $text-tertiary;
  }
}

.kb-pagination-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}

.kb-page-btn {
  width: 28px;
  height: 28px;
  border: 1px solid $border;
  background: $bg-surface;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: $text-secondary;
  transition: all 0.15s;

  &:hover:not(:disabled):not(.active) {
    border-color: $primary;
    color: $primary;
  }

  &.active {
    background: $primary;
    border-color: $primary;
    color: #fff;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  svg {
    width: 14px;
    height: 14px;
  }
}

// 核查命令库区域
.kb-commands-area {
  padding: 20px;
}

.kb-commands-filter {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.kb-commands-table {
  overflow-x: auto;
  border: 1px solid $border;
  border-radius: 8px;

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  thead {
    tr {
      background: var(--color-bg-hover);
      border-bottom: 1px solid $border;
    }
    th {
      padding: 0 12px;
      height: 44px;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      color: $text-secondary;
      white-space: nowrap;
      border-bottom: 1px solid $border;
    }
  }

  tbody {
    tr {
      border-bottom: 1px solid $border-light;
      transition: background 0.1s;

      &:hover {
        background: $bg-hover;
      }

      &:last-child {
        border-bottom: none;
      }
    }
    td {
      padding: 10px 12px;
      font-size: 12px;
      color: $text-secondary;
      vertical-align: middle;
    }
  }

  .cmd-name {
    color: $text-primary;
    font-weight: 500;
    white-space: nowrap;
  }

  .cmd-code {
    font-family: "SF Mono", "Fira Code", Consolas, monospace;
    font-size: 12px;
    background: var(--color-bg-base);
    color: $text-primary;
    padding: 4px 8px;
    border-radius: 4px;
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cmd-desc {
    line-height: 1.65;
  }

  .cmd-os-tags {
    display: flex;
    gap: 4px;
    flex-wrap: nowrap;
  }

  .cmd-os-tag {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 2px;
    font-size: 11px;
    white-space: nowrap;

    &.os-linux { background: $success-light; color: $success; }
    &.os-windows { background: $info-light; color: $info; }
    &.os-网络设备 { background: $primary-light; color: $primary; }
    &.os-数据库 { background: $warning-light; color: $warning; }
  }

  .cmd-fav {
    text-align: center;
    cursor: pointer;

    .fav-active { color: #D97706; }
    .fav-inactive { color: $text-tertiary; }
  }

  .row-new {
    background: var(--color-warning-light);
  }

  .cmd-input {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid #FCD34D;
    border-radius: 4px;
    font-size: 12px;
    outline: none;
    box-sizing: border-box;

    &:focus {
      border-color: #F59E0B;
      box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.1);
    }
  }

  .cmd-textarea {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid #FCD34D;
    border-radius: 4px;
    font-size: 12px;
    outline: none;
    resize: vertical;
    min-height: 32px;
    font-family: inherit;
    box-sizing: border-box;

    &:focus {
      border-color: #F59E0B;
      box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.1);
    }
  }

  .cmd-action-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    color: $text-secondary;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;

    &:hover {
      background: $bg-hover;
      color: $text-primary;
    }
  }
}

// 文档查看器
.kb-doc-viewer {
  max-height: 70vh;
  overflow-y: auto;
}

.kb-viewer-title {
  font-size: 20px;
  font-weight: 700;
  color: $text-primary;
  margin: 0 0 16px;
}

.kb-viewer-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
  color: $text-secondary;
  margin-bottom: 16px;
}

.kb-viewer-tags {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}

.kb-viewer-tag {
  display: inline-flex;
  padding: 2px 10px;
  background: $bg-hover;
  border-radius: 9999px;
  font-size: 11px;
  color: $text-secondary;
}

.kb-viewer-content {
  font-size: 14px;
  line-height: 1.8;
  color: $text-primary;

  h1, h2, h3 {
    margin-top: 24px;
    margin-bottom: 12px;
    font-weight: 600;
    color: $text-primary;
  }

  h1 { font-size: 20px; border-bottom: 2px solid $border; padding-bottom: 8px; }
  h2 { font-size: 18px; border-bottom: 1px solid $border; padding-bottom: 6px; }
  h3 { font-size: 16px; }

  p { margin-bottom: 12px; }

  ul, ol {
    margin-bottom: 12px;
    padding-left: 24px;
  }

  li { margin-bottom: 6px; }

  code {
    background: $bg-hover;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: Consolas, Monaco, monospace;
    font-size: 13px;
  }

  pre {
    background: $bg-hover;
    padding: 12px 16px;
    border-radius: 6px;
    overflow-x: auto;
    margin-bottom: 12px;

    code { padding: 0; background: transparent; }
  }

  strong { font-weight: 600; }
}

// 全局覆盖
:deep(.el-dialog__body) {
  padding: 20px;
}

// 右键菜单
.kb-context-menu {
  position: fixed;
  z-index: 2000;
  background: $bg-surface;
  border: 1px solid $border;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
  min-width: 120px;

  .kb-context-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    font-size: 12px;
    color: $text-primary;
    cursor: pointer;
    transition: background 0.15s;

    &:hover {
      background: $bg-hover;
    }

    svg {
      flex-shrink: 0;
    }
  }

  .kb-context-menu-danger {
    color: $error;

    &:hover {
      background: $error-light;
    }
  }
}
</style>
