import { ref, computed, type Ref } from 'vue'

// 可选列字段（支持范围选择的列）
const SELECTABLE_FIELDS = ['conclusion', 'compliance', 'evidence'] as const

type SelectableField = (typeof SELECTABLE_FIELDS)[number]

interface SelectionAnchor {
  rowIndex: number
  field: SelectableField
}

interface TableRow {
  conclusion?: string
  compliance?: string
  evidence?: string
  [key: string]: unknown
}

export interface TableCellSelectionOptions {
  tableRows: Ref<TableRow[]>
  hasUnsavedChanges: Ref<boolean>
  saveStatus: Ref<string>
  triggerSave: () => void
  /** 清空成功后的回调（替代直接在工具函数内调用 ElMessage） */
  onClearSuccess?: (count: number) => void
  /** 复制成功后的回调 */
  onCopySuccess?: (count: number) => void
  /** 批量设置符合性成功后的回调 */
  onBatchComplianceSuccess?: (count: number) => void
}

export interface TableCellSelectionInstance {
  selectedCells: Ref<Set<string>>
  selectionAnchor: Ref<SelectionAnchor | null>
  selectedCount: Readonly<Ref<number>>
  isCellSelected: (rowIndex: number, field: string) => boolean
  isSelectionAnchor: (rowIndex: number, field: string) => boolean
  handleCellMouseDown: (event: MouseEvent) => void
  handleCellClick: (event: MouseEvent, rowIndex: number, field: string) => void
  clearSelectedCells: () => void
  handleTableContainerClick: (event: MouseEvent) => void
  copySelectedCells: () => void
  batchSetCompliance: (value: string) => void
  hasComplianceSelected: () => boolean
}

function cellKey(rowIndex: number, field: string): string {
  return `${rowIndex}:${field}`
}

export function createTableCellSelection(options: TableCellSelectionOptions): TableCellSelectionInstance {
  const { tableRows, hasUnsavedChanges, saveStatus, triggerSave } = options

  const selectedCells = ref<Set<string>>(new Set())
  const selectionAnchor = ref<SelectionAnchor | null>(null)
  const selectedCount = computed(() => selectedCells.value.size)

  function isCellSelected(rowIndex: number, field: string): boolean {
    return selectedCells.value.has(cellKey(rowIndex, field))
  }

  function isSelectionAnchor(rowIndex: number, field: string): boolean {
    return selectionAnchor.value?.rowIndex === rowIndex && selectionAnchor.value?.field === field
  }

  function handleCellMouseDown(event: MouseEvent) {
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault()
    }
  }

  function handleCellClick(event: MouseEvent, rowIndex: number, field: string) {
    const key = cellKey(rowIndex, field)

    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      event.preventDefault()
    }

    if (event.ctrlKey || event.metaKey) {
      if (selectedCells.value.has(key)) {
        selectedCells.value.delete(key)
      } else {
        selectedCells.value.add(key)
      }
      selectionAnchor.value = { rowIndex, field: field as SelectableField }
    } else if (event.shiftKey && selectionAnchor.value) {
      // Shift+Click: 范围选择
      const startRow = selectionAnchor.value.rowIndex
      const endRow = rowIndex
      const minRow = Math.min(startRow, endRow)
      const maxRow = Math.max(startRow, endRow)
      const anchorFieldIdx = SELECTABLE_FIELDS.indexOf(selectionAnchor.value.field)
      const currentFieldIdx = SELECTABLE_FIELDS.indexOf(field as SelectableField)

      for (let r = minRow; r <= maxRow; r++) {
        // 如果锚点和当前点在同一列，只选该列
        if (anchorFieldIdx === currentFieldIdx) {
          selectedCells.value.add(cellKey(r, field))
        } else {
          // 跨列时选所有中间列
          const minF = Math.min(anchorFieldIdx, currentFieldIdx)
          const maxF = Math.max(anchorFieldIdx, currentFieldIdx)
          for (let f = minF; f <= maxF; f++) {
            selectedCells.value.add(cellKey(r, SELECTABLE_FIELDS[f]))
          }
        }
      }
    } else {
      // 普通点击：清除其他选中，只选当前单元格
      selectedCells.value.clear()
      selectedCells.value.add(key)
      selectionAnchor.value = { rowIndex, field: field as SelectableField }
    }
  }

  function clearSelectedCells() {
    if (selectedCells.value.size === 0) return

    const fields: Record<string, (row: TableRow) => void> = {
      'conclusion': (row: TableRow) => { row.conclusion = '' },
      'compliance': (row: TableRow) => { row.compliance = '' },
      'evidence': (row: TableRow) => { row.evidence = '' },
    }

    for (const key of selectedCells.value) {
      const [rowIdxStr, field] = key.split(':')
      const rowIdx = parseInt(rowIdxStr)
      if (rowIdx >= 0 && rowIdx < tableRows.value.length && fields[field]) {
        fields[field](tableRows.value[rowIdx])
      }
    }

    hasUnsavedChanges.value = true
    saveStatus.value = 'unsaved'
    triggerSave()

    const count = selectedCells.value.size
    selectedCells.value.clear()
    selectionAnchor.value = null
    options.onClearSuccess?.(count)
  }

  // 复制选中单元格内容（Tab分隔，兼容Excel）
  function copySelectedCells() {
    if (selectedCells.value.size === 0) return

    const cells = Array.from(selectedCells.value)
      .map(key => {
        const [rowIdxStr, field] = key.split(':')
        return { rowIndex: parseInt(rowIdxStr), field }
      })
      .sort((a, b) => {
        if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex
        return SELECTABLE_FIELDS.indexOf(a.field as SelectableField) - SELECTABLE_FIELDS.indexOf(b.field as SelectableField)
      })

    const rowMap = new Map<number, string[]>()
    for (const cell of cells) {
      if (!rowMap.has(cell.rowIndex)) {
        rowMap.set(cell.rowIndex, [])
      }
      const row = tableRows.value[cell.rowIndex]
      const value = row ? (row[cell.field] || '').toString() : ''
      rowMap.get(cell.rowIndex)!.push(value)
    }

    const lines: string[] = []
    for (const [, values] of rowMap) {
      lines.push(values.join('\t'))
    }
    const text = lines.join('\n')

    navigator.clipboard.writeText(text).then(() => {
      options.onCopySuccess?.(cells.length)
    }).catch(() => {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      options.onCopySuccess?.(cells.length)
    })
  }

  // 批量设置符合性
  function batchSetCompliance(value: string) {
    const complianceCells = Array.from(selectedCells.value).filter(key => key.endsWith(':compliance'))
    if (complianceCells.length === 0) return

    for (const key of complianceCells) {
      const [rowIdxStr] = key.split(':')
      const rowIdx = parseInt(rowIdxStr)
      if (rowIdx >= 0 && rowIdx < tableRows.value.length) {
        tableRows.value[rowIdx].compliance = value
      }
    }

    hasUnsavedChanges.value = true
    saveStatus.value = 'unsaved'
    triggerSave()
    options.onBatchComplianceSuccess?.(complianceCells.length)
  }

  // 检查选中单元格中是否有符合性列
  function hasComplianceSelected(): boolean {
    for (const key of selectedCells.value) {
      if (key.endsWith(':compliance')) return true
    }
    return false
  }

  // 点击空白处取消选中
  function handleTableContainerClick(event: MouseEvent) {
    const target = event.target as HTMLElement
    if (!target.closest('td')) {
      selectedCells.value.clear()
      selectionAnchor.value = null
    }
  }

  return {
    selectedCells,
    selectionAnchor,
    selectedCount,
    isCellSelected,
    isSelectionAnchor,
    handleCellMouseDown,
    handleCellClick,
    clearSelectedCells,
    handleTableContainerClick,
    copySelectedCells,
    batchSetCompliance,
    hasComplianceSelected,
  }
}
