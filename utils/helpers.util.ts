/**
 * Checks if the given error is a connection error. This method is a bit naive,
 * as it only checks if the error message contains certain keywords.
 * @param error The error to check
 * @returns true if the error is a connection error
 */
export function isConnectionError(error: any): boolean {
  if (!error?.message) return false;

  const errorMsg = error.message.toLowerCase();
  return (
    errorMsg.includes('econnrefused') ||
    errorMsg.includes('etimedout') ||
    errorMsg.includes('enotfound') ||
    errorMsg.includes('connection closed') ||
    errorMsg.includes('readonly') ||
    errorMsg.includes('connection error')
  );
}
