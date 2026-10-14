export interface User {
  id: number
  name: string
  email: string
  locale: string | null
}

export interface LoginResponse {
  token: string
  user: User
}
