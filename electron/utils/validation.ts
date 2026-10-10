export function validateUuid(id: string, fieldName: string = 'ID'): void {
  if (!id) {
    throw new Error(`${fieldName}不能为空`);
  }
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    throw new Error(`无效的${fieldName}格式`);
  }
}

export function validateNotEmpty(value: string | undefined | null, fieldName: string): void {
  if (!value || value.trim() === '') {
    throw new Error(`${fieldName}不能为空`);
  }
}

export function sanitizeInput(input: string, maxLength: number = 1000): string {
  return input?.trim().slice(0, maxLength) || '';
}

export function validateComplianceStatus(status: string): void {
  // 支持两种格式：
  // - 旧格式：'conform', 'nonconform', 'notapplicable'（数据库存储）
  // - 新格式：'compliant', 'non_compliant', 'not_applicable'（前端传递）
  const validStatuses = [
    'untested',
    'conform', 'compliant',
    'partial',
    'nonconform', 'non_compliant',
    'notapplicable', 'not_applicable',
  ];
  if (!validStatuses.includes(status)) {
    throw new Error('无效的合规状态值');
  }
}