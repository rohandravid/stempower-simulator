// Shared error types. Both carry 1-based line / 0-based col into the editor.

export class SketchParseError extends Error {
  constructor(
    message: string,
    public line: number,
    public col: number,
  ) {
    super(message);
    this.name = 'SketchParseError';
  }
}

export class SketchRuntimeError extends Error {
  constructor(
    message: string,
    public line: number,
  ) {
    super(message);
    this.name = 'SketchRuntimeError';
  }
}
