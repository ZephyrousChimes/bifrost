export function errorEnvelope(type: string, code: string, message: string, param?: string) {
  return {
    error: {
      type,
      code,
      message,
      ...(param !== undefined ? { param } : {}),
    },
  };
}
