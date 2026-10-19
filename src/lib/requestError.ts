export function httpMessage(status: number): string {
  if (status === 401) return "Your session needs recovery. You can continue as a guest without signing in.";
  if (status === 403) return "This account is not allowed to perform that operation.";
  if (status === 400 || status === 422) return "Check your input and try again.";
  if (status === 413) return "Cloud storage is full. Delete or shorten cloud content, or use local storage.";
  if (status === 429) return "A request limit was reached. Wait before trying again.";
  if (status === 408 || status === 504) return "The request timed out. Please retry.";
  if (status >= 500) return "The Alfred server is unavailable. Please retry.";
  return `Request failed (${status}). Please retry.`;
}
