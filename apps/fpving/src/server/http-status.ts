/** Every status the server answers with, from the shell and from the routes. */
export const HttpStatus = {
  Ok: 200,
  Created: 201,
  Accepted: 202,
  NoContent: 204,
  BadRequest: 400,
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  MisdirectedRequest: 421,
  UnprocessableContent: 422,
  InternalServerError: 500,
  BadGateway: 502,
  ServiceUnavailable: 503,
} as const;
