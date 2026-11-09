import { isDbResult } from '../../shared/assessment-result';

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
  // 合法值由 shared/assessment-result.ts 统一声明（旧格式 conform/nonconform/notapplicable
  // 与新格式 compliant/non_compliant/not_applicable 都在内），避免此处与统计口径各抄一份。
  if (!isDbResult(status)) {
    throw new Error('无效的合规状态值');
  }
}