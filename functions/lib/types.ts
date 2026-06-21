/// <reference types="@cloudflare/workers-types" />
// Cloudflare Workers kornyezet tipusai

export interface Env {
  // D1 adatbazis binding
  DB: D1Database;

  // KV rate limiting (opcionalis — ha nincs bekotve, a rate limit ki van kapcsolva)
  RATE_LIMIT_KV?: KVNamespace;

  // App
  APP_URL: string;
  NODE_ENV: string;

  // Revolut
  REVOLUT_ENV: string;
  REVOLUT_MERCHANT_API_KEY?: string;
  REVOLUT_MERCHANT_WEBHOOK_SECRET?: string;
  REVOLUT_BUSINESS_API_KEY?: string;
  REVOLUT_PLATFORM_ACCOUNT_ID?: string;

  // SendGrid
  SENDGRID_API_KEY?: string;

  // AI
  GEMINI_API_KEY?: string;

  // Monitoring
  SENTRY_DSN?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  banned: boolean;
}

// Hono context vars
export type Variables = {
  user: AuthUser;
};
