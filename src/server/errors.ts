/** A mistake in the request (unknown board, bad op...). Sent back as a 400 with this message. */
export class UserError extends Error {}
