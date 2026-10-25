function toPolicyFailure(error) {
  return {
    success: false,
    error: error?.message || String(error),
    // A DOMException's legacy numeric code (a fetch timeout's is 23) is not an
    // error code; renderers match codes as strings.
    ...(typeof error?.code === "string" && error.code ? { code: error.code } : {}),
    ...(Number.isInteger(error?.status) ? { status: error.status } : {}),
    ...(error?.minAppVersion ? { minAppVersion: error.minAppVersion } : {}),
    ...(error?.details !== undefined ? { details: error.details } : {}),
  };
}

module.exports = { toPolicyFailure };
