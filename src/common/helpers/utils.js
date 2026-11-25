export const valueOrEmptyString = (value) => {
  return value ?? ''
}

export const wrapValueWithComma = (value) => {
  const valueOrBlank = valueOrEmptyString(value)
  if(!(valueOrBlank instanceof String)) {
    return valueOrBlank
  } else {
    return valueOrBlank.includes(',') ? `"${valueOrBlank}"` : valueOrBlank
  }
}
