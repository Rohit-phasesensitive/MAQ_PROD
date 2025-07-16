// src/lib/auth.js

export function getAuthHeaders() {
  const token = localStorage.getItem('access_token') || ''
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}
