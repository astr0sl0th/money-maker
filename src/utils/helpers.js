/**
 * Ensures a value is a valid number, returning a default if not
 * @param {any} value - The value to check
 * @param {number} defaultValue - The default value to return if invalid
 * @returns {number} - A valid number
 */
function ensureValidNumber(value, defaultValue = 0) {
  if (value === undefined || value === null || isNaN(parseFloat(value))) {
    return defaultValue;
  }
  return parseFloat(value);
}

module.exports = {
  ensureValidNumber
}; 