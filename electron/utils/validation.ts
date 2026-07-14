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

export function validateStringLength(value: string, min: number, max: number, fieldName: string): void {
  if (value.length < min) {
    throw new Error(`${fieldName}长度不能小于${min}个字符`);
  }
  if (value.length > max) {
    throw new Error(`${fieldName}长度不能超过${max}个字符`);
  }
}

export function validateEmail(email: string): void {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('无效的邮箱格式');
  }
}

export function validatePhone(phone: string): void {
  const phoneRegex = /^1[3-9]\d{9}$/;
  if (!phoneRegex.test(phone)) {
    throw new Error('无效的手机号格式');
  }
}

export function sanitizeInput(input: string, maxLength: number = 1000): string {
  return input?.trim().slice(0, maxLength) || '';
}

export function validateProjectLevel(level: number): void {
  if (![1, 2, 3, 4].includes(level)) {
    throw new Error('项目等级必须为1-4级');
  }
}

export function validateComplianceStatus(status: string): void {
  const validStatuses = ['untested', 'conform', 'partial', 'nonconform', 'notapplicable'];
  if (!validStatuses.includes(status)) {
    throw new Error('无效的合规状态值');
  }
}

export function validateRiskLevel(level: string): void {
  const validLevels = ['high', 'medium', 'low'];
  if (!validLevels.includes(level)) {
    throw new Error('风险等级必须为 high、medium 或 low');
  }
}