import bcrypt from 'bcryptjs';

const COST = 12;

// Real hash computed once, used to equalise login timing when the account does not exist.
let dummyHash;
const getDummyHash = async () => (dummyHash ??= await bcrypt.hash('timing-equaliser', COST));

export const hashPassword = (plain) => bcrypt.hash(plain, COST);

export async function verifyPassword(plain, hash) {
  if (!hash) {
    await bcrypt.compare(plain, await getDummyHash());
    return false;
  }
  return bcrypt.compare(plain, hash);
}

/** Password policy shared by registration, invites and reset. */
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.';
  if (pw.length > 128) return 'Password must be at most 128 characters.';
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and numbers.';
  return null;
}
