/**
 * Session signing secret. Production must not boot with a documented
 * placeholder — copying .env.example into a live host used to do exactly that.
 */

export const WEAK_SESSION_SECRETS = new Set([
  '',
  'ap-emlaki-secret-change-me',
  'replace-this-before-public-deployment',
  'generate-a-long-random-secret',
]);

export function sessionSecret(env = process.env) {
  const secret = env.SESSION_SECRET || '';
  if (env.NODE_ENV === 'production' && WEAK_SESSION_SECRETS.has(secret)) {
    throw new Error('SESSION_SECRET must be set to a unique value in production');
  }
  return secret || 'ap-emlaki-secret-change-me';
}

export default { WEAK_SESSION_SECRETS, sessionSecret };
