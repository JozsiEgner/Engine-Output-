// UUID v4 generálás Workers-ben (crypto.randomUUID() elérhető)
export function uuid(): string {
  return crypto.randomUUID();
}

export function nowISO(): string {
  return new Date().toISOString();
}
