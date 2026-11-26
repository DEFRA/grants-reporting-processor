export const valueOrEmptyString = (value) => {
  return value ?? ''
}

export const wrapValueWithComma = (value) => {
  if (typeof value === 'boolean') {
    return String(value)
  }
  const valueOrBlank = valueOrEmptyString(value)
  if (typeof valueOrBlank === 'string') {
    return valueOrBlank.includes(',') ? `"${valueOrBlank}"` : valueOrBlank
  } else {
    return valueOrBlank
  }
}
