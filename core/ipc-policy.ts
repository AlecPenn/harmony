// Exact top-frame identity and exact local document URL; never hostname-only checks.
export function trustedSender(senderId: number, ownerId: number, isMainFrame: boolean, url: string, expectedUrl: string): boolean {
  return senderId === ownerId && isMainFrame && url === expectedUrl;
}
export function validateNoArguments(args: unknown[]): void {
  if (args.length !== 0) throw new Error('This operation accepts no arguments');
}
