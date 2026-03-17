export function isRuntimeDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.CODEOWL_VERBOSE ?? env.CODEOWL_DEBUG_RUNTIME;
  return typeof value === 'string' && /^(1|true|yes|on)$/i.test(value);
}

export function logRuntimeDebug(message: string): void {
  if (isRuntimeDebugEnabled()) {
    console.error(message);
  }
}
