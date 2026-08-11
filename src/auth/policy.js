/**
 * Password + captcha policy, ported 1:1 from the PHP source.
 *   checkpassword()                  include/commonfunctions.php:4862
 *   pwdStrong/pwdUnique/pwdDigits    include/appsettings.php:523-526
 *   randString()                     securitycode.php
 */

export const POLICY = { pwdStrong: true, pwdMinLength: 8, pwdUnique: 4, pwdDigits: 2 };

/**
 * Exact port of checkpassword($pwd). The PHP counts anything that is not
 * a-z/A-Z as a "digit", so symbols count toward pwdDigits too. Keep that.
 */
export function checkPassword(pwd, policy = POLICY) {
  const s = String(pwd == null ? '' : pwd);
  if (s.length < policy.pwdMinLength) return false;
  const unique = new Set();
  let lower = 0, upper = 0, digit = 0;
  for (const c of s) {
    if (c >= 'a' && c <= 'z') lower++;
    else if (c >= 'A' && c <= 'Z') upper++;
    else digit++;
    unique.add(c);
  }
  if (unique.size < policy.pwdUnique) return false;
  if (digit < policy.pwdDigits) return false;
  if (!lower || !upper) return false;
  return true;
}

/** German messages from classes/changepwdpage.php:248-268 */
export function passwordErrors(pwd, policy = POLICY) {
  const s = String(pwd == null ? '' : pwd);
  const out = [];
  if (s.length < policy.pwdMinLength)
    out.push('das Passwort mu\u00df mindestens ' + policy.pwdMinLength + ' Zeichen lang sein');
  if (policy.pwdUnique && new Set(s).size < policy.pwdUnique)
    out.push('das Passwort mu\u00df ' + policy.pwdUnique + ' eindeutige Zeichen enthalten');
  let lower = 0, upper = 0, digit = 0;
  for (const c of s) {
    if (c >= 'a' && c <= 'z') lower++;
    else if (c >= 'A' && c <= 'Z') upper++;
    else digit++;
  }
  if (policy.pwdDigits && digit < policy.pwdDigits)
    out.push('Passwort mu\u00df ' + policy.pwdDigits + ' Ziffern oder Sonderzeichen enthalten');
  if (!lower || !upper)
    out.push('Passwort mu\u00df Buchstaben in Gro\u00df- und Kleinschrift enthalten');
  return out;
}

const ALPHA = 'ABCDEFGHIJKLMNPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('');
const SECURE = '!@$%&*-_=+?~'.split('');

/** Exact port of randString($stype,$ct) from securitycode.php */
export function randString(stype, ct, rnd = Math.random) {
  let list;
  if (stype === 'alpha') list = ALPHA;
  else if (stype === 'alphanum') list = ALPHA.concat('123456789'.split(''));
  else if (stype === 'secure') list = ALPHA.concat('0123456789'.split(''), SECURE);
  else list = '0123456789'.split('');
  let s = '';
  for (let i = 0; i < ct; i++) s += list[Math.floor(rnd() * list.length)];
  return s;
}

/** classes/remindpwdpage.php:133 -> generatePassword(20) */
export function generateToken(len = 20, rnd = Math.random) {
  return randString('alphanum', len, rnd);
}

export default { POLICY, checkPassword, passwordErrors, randString, generateToken };
