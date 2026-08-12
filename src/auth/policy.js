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

/**
 * Messages from classes/changepwdpage.php:248-268.
 * `lang` selects the wording; the rules themselves are unchanged.
 */
const PWD_MSG = {
  de: {
    len: (n) => 'das Passwort mu\u00df mindestens ' + n + ' Zeichen lang sein',
    uniq: (n) => 'das Passwort mu\u00df ' + n + ' eindeutige Zeichen enthalten',
    digits: (n) => 'Passwort mu\u00df ' + n + ' Ziffern oder Sonderzeichen enthalten',
    case: () => 'Passwort mu\u00df Buchstaben in Gro\u00df- und Kleinschrift enthalten',
  },
  en: {
    len: (n) => 'The password must be at least ' + n + ' characters long',
    uniq: (n) => 'The password must contain ' + n + ' unique characters',
    digits: (n) => 'The password must contain ' + n + ' digits or special characters',
    case: () => 'The password must contain both upper and lower case letters',
  },
};

export function passwordErrors(pwd, policy = POLICY, lang = 'de') {
  const m = PWD_MSG[lang === 'en' ? 'en' : 'de'];
  const s = String(pwd == null ? '' : pwd);
  const out = [];
  if (s.length < policy.pwdMinLength)
    out.push(m.len(policy.pwdMinLength));
  if (policy.pwdUnique && new Set(s).size < policy.pwdUnique)
    out.push(m.uniq(policy.pwdUnique));
  let lower = 0, upper = 0, digit = 0;
  for (const c of s) {
    if (c >= 'a' && c <= 'z') lower++;
    else if (c >= 'A' && c <= 'Z') upper++;
    else digit++;
  }
  if (policy.pwdDigits && digit < policy.pwdDigits)
    out.push(m.digits(policy.pwdDigits));
  if (!lower || !upper)
    out.push(m.case());
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

/** Prefixes so /activate and /changepwd cannot consume each other's tokens. */
export const ACTIVATE_PREFIX = 'act_';
export const RESET_PREFIX = 'pwd_';
export const AUTH_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function issueAuthToken(kind, rnd = Math.random) {
  const prefix = kind === 'activate' ? ACTIVATE_PREFIX : RESET_PREFIX;
  return prefix + generateToken(20, rnd);
}

export function authTokenKind(token) {
  const s = String(token || '');
  if (s.startsWith(ACTIVATE_PREFIX)) return 'activate';
  if (s.startsWith(RESET_PREFIX)) return 'reset';
  return null;
}

/** Missing date is treated as not expired so legacy rows still work. */
export function isAuthTokenExpired(resetDate, now = Date.now(), ttl = AUTH_TOKEN_TTL_MS) {
  if (resetDate == null || resetDate === '') return false;
  const t = resetDate instanceof Date ? resetDate.getTime() : new Date(resetDate).getTime();
  if (Number.isNaN(t)) return true;
  return now - t > ttl;
}

export default {
  POLICY, checkPassword, passwordErrors, randString, generateToken,
  ACTIVATE_PREFIX, RESET_PREFIX, AUTH_TOKEN_TTL_MS,
  issueAuthToken, authTokenKind, isAuthTokenExpired,
};
