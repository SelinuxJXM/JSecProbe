/**
 * Validator Utilities
 * 数据校验函数
 */

/**
 * 校验邮箱格式
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * 校验手机号格式（中国大陆）
 */
export function isValidPhone(phone: string): boolean {
  const phoneRegex = /^1[3-9]\d{9}$/;
  return phoneRegex.test(phone);
}

/**
 * 校验IP地址格式
 */
export function isValidIP(ip: string): boolean {
  const ipRegex = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  return ipRegex.test(ip);
}

/**
 * 校验CIDR格式
 */
export function isValidCIDR(cidr: string): boolean {
  const cidrRegex = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)\/(3[0-2]|[12]?\d)$/;
  return cidrRegex.test(cidr);
}

/**
 * 校验URL格式
 */
export function isValidURL(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * 校验UUID格式
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
  return uuidRegex.test(uuid);
}

/**
 * 校验密码强度
 * 返回 { valid: boolean, errors: string[] }
 */
export function validatePasswordStrength(password: string, minLength = 8): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (password.length < minLength) {
    errors.push(`密码长度至少${minLength}位`);
  }
  if (!/[a-z]/.test(password)) {
    errors.push('密码必须包含小写字母');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('密码必须包含大写字母');
  }
  if (!/\d/.test(password)) {
    errors.push('密码必须包含数字');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('密码必须包含特殊字符');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 校验用户名格式
 */
export function isValidUsername(username: string): boolean {
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  return usernameRegex.test(username);
}

/**
 * 校验数字范围
 */
export function isValidNumberRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/**
 * 校验非空字符串
 */
export function isNonEmptyString(value: any): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 校验对象是否包含指定字段
 */
export function hasRequiredFields(obj: Record<string, any>, fields: string[]): { valid: boolean; missing: string[] } {
  const missing = fields.filter(field => !obj[field] || (typeof obj[field] === 'string' && !obj[field].trim()));
  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * 校验项目数据
 */
export function validateProjectData(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.name || !data.name.trim()) {
    errors.push('项目名称不能为空');
  }
  if (!data.systemName || !data.systemName.trim()) {
    errors.push('系统名称不能为空');
  }
  if (!data.level || data.level < 1 || data.level > 5) {
    errors.push('保护等级必须在1-5之间');
  }
  if (data.startDate && data.endDate && new Date(data.startDate) > new Date(data.endDate)) {
    errors.push('开始日期不能晚于结束日期');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 校验资产数据
 */
export function validateAssetData(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.name || !data.name.trim()) {
    errors.push('资产名称不能为空');
  }
  if (data.ip && !isValidIP(data.ip)) {
    errors.push('IP地址格式不正确');
  }
  if (data.quantity && (data.quantity < 1 || data.quantity > 1000)) {
    errors.push('数量必须在1-1000之间');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}