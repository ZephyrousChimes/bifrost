declare global {
  namespace Express {
    interface Request {
      merchantId?: number;
    }
  }
}

export {};
