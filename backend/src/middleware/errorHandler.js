// Central error formatter -> standard response envelope + status code.
import { AppError } from '../utils/http.js'

export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    data: null,
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` },
    meta: null,
  })
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res
      .status(err.status)
      .json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null })
  }

  if (err.name === 'ValidationError' || err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: 'VALIDATION_ERROR', message: err.message },
      meta: null,
    })
  }

  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: 'DUPLICATE_KEY', message: 'A record with that value already exists.' },
      meta: null,
    })
  }

  console.error(err)
  res.status(500).json({
    success: false,
    data: null,
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
    meta: null,
  })
}
