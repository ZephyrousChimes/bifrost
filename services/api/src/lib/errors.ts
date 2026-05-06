export class ResourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceNotFoundError";
  }
}

export class IllegalTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalTransitionError";
  }
}

export class InvalidRequestError extends Error {
  param?: string;
  constructor(message: string, param?: string) {
    super(message);
    this.name = "InvalidRequestError";
    this.param = param;
  }
}

export class AcquirerTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcquirerTimeoutError";
  }
}
