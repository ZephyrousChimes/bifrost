import { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AcquirerTimeoutError, IllegalTransitionError, InvalidRequestError, ResourceNotFoundError } from "../lib/errors";
import { errorEnvelope } from "../lib/errorEnvelope";

interface PgError extends Error {
  code?: string;
  constraint?: string;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const param = issue?.path.join(".") || undefined;
    res
      .status(400)
      .json(errorEnvelope("invalid_request_error", "parameter_invalid", issue?.message ?? "Invalid request.", param));
    return;
  }

  if (err instanceof InvalidRequestError) {
    res.status(400).json(errorEnvelope("invalid_request_error", "parameter_invalid", err.message, err.param));
    return;
  }

  if (err instanceof ResourceNotFoundError) {
    res.status(404).json(errorEnvelope("invalid_request_error", "resource_missing", err.message, "id"));
    return;
  }

  if (err instanceof IllegalTransitionError) {
    res.status(409).json(errorEnvelope("invalid_request_error", "payment_unexpected_state", err.message));
    return;
  }

  if (err instanceof AcquirerTimeoutError) {
    res.status(504).json(errorEnvelope("api_error", "acquirer_timeout", err.message));
    return;
  }

  const pgErr = err as PgError;
  if (pgErr?.code === "23505" && pgErr.constraint === "merchants_email_key") {
    res
      .status(409)
      .json(
        errorEnvelope(
          "invalid_request_error",
          "email_already_registered",
          "A merchant is already registered with this email.",
          "email",
        ),
      );
    return;
  }

  console.error(err);
  res.status(500).json(errorEnvelope("api_error", "internal_error", "An internal error occurred."));
};
