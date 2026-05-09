export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiError {
  success: false;
  message: string;
  errors?: Record<string, string[]>;
  statusCode: number;
}

export type JwtPayload = {
  sub: string;
  role: string;
  jti: string;
  iat?: number;
  exp?: number;
};
