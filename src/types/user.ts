/**
 * User Types
 * 用户相关类型定义
 */

export interface User {
  id: string;
  username: string;
  realName: string;
  email?: string;
  phone?: string;
  role: string;
  isActive: boolean;
  mustChangePassword?: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResult {
  success: boolean;
  user?: User;
  token?: string;
  message?: string;
}

export interface LoginParams {
  username: string;
  password: string;
}

export interface ChangePasswordParams {
  userId: string;
  oldPassword: string;
  newPassword: string;
}

export interface CreateUserParams {
  username: string;
  password: string;
  realName: string;
  email?: string;
  phone?: string;
  role?: string;
}

export interface UpdateUserParams {
  realName?: string;
  email?: string;
  phone?: string;
  role?: string;
  isActive?: boolean;
  password?: string;
}