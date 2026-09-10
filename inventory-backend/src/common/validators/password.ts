// src/common/validators/password.ts
// Shared password policy: 8-72 chars (72 is bcrypt's max input length, which
// also prevents bcrypt DoS via oversized passwords) and must include lowercase,
// uppercase and a digit.
export const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/;

export const PASSWORD_MESSAGE =
  'Password must be 8-72 characters and include an uppercase letter, a lowercase letter and a number';
