/**
 * Phase 1 - authentication pages.
 *
 * Ports the four standalone PHP auth pages, whose logic lives in classes/:
 *   register.php      -> classes/registerpage.php
 *   changepwd.php     -> classes/changepwdpage.php
 *   remind.php        -> classes/remindpwdpage.php
 *   securitycode.php  -> captcha generator
 *
 * Login itself stays in server.js, matching the original split.
 */
import { Router } from 'express';
import bcrypt from 'bcrypt';
import {
  checkPassword, passwordErrors, randString, POLICY,
  issueAuthToken, authTokenKind, isAuthTokenExpired,
} from '../src/auth/policy.js';
import { hashPassword } from '../src/auth/password-guard.js';

/** classes/registerpage.php uses the Benutzer login table. */
const USER_FIELD = 'Benutzername';
const PASS_FIELD = 'Passwort';
const MAIL_FIELD = 'Email';

/** classes/registerpage.php:253 */
export const ADMIN_NOTIFY_EMAIL = 'support@intex-publishing.de';

/** Password comparison with an explicit legacy migration switch. */
export async function verifyPassword(plain, stored) {
  if (stored == null) return false;
  if (String(stored).startsWith('$2')) {
    try { return await bcrypt.compare(String(plain), String(stored)); } catch { return false; }
  }
  return (process.env.NODE_ENV !== 'production' || process.env.ALLOW_PLAINTEXT_PASSWORDS === 'true')
    && String(stored) === String(plain);
}


/**
 * @param deps.prisma   Prisma client
 * @param deps.sendMail optional async ({to, template, data}) => {mailed:boolean}
 *                      Injected so the routes stay testable offline; the PHP
 *                      equivalent is RunnerPage::sendEmailByTemplate().
 */
export default function createAuthRouter({ prisma, sendMail } = {}) {
  const router = Router();
  const mailer = sendMail || (async () => ({ mailed: false, reason: 'no mailer configured' }));
  const users = () => prisma.Benutzer || prisma.benutzer;

  const baseUrl = (req) => req.protocol + '://' + req.get('host');

  // -------------------------------------------------------------- captcha
  // securitycode.php: alphanum, 6 chars, stored in $_SESSION["captcha_<id>"]
  router.get('/captcha/:id', (req, res) => {
    const code = randString('alphanum', 6);
    req.session.captcha = req.session.captcha || {};
    req.session.captcha[req.params.id] = code;
    res.type('text/plain').send('&securitycode=' + code + '&');
  });

  function captchaOk(req, id, answer) {
    const want = req.session?.captcha?.[id];
    if (!want) return false;
    const ok = String(answer || '').trim().toLowerCase() === String(want).toLowerCase();
    if (ok) delete req.session.captcha[id];
    return ok;
  }

  // ------------------------------------------------------------- register
  router.get('/register', (req, res) => {
    res.render('auth/register', { errors: [], values: {}, captchaId: randString('alphanum', 8) });
  });

  router.post('/register', async (req, res) => {
    const v = req.body || {};
    const captchaId = v.captchaId || '';
    const errors = [];

    // classes/registerpage.php:321 checkRegisterData()
    if (!String(v[USER_FIELD] || '').trim()) errors.push('Bitte geben Sie einen Benutzernamen ein.');
    if (!String(v[MAIL_FIELD] || '').trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v[MAIL_FIELD] || '')) {
      errors.push('Bitte geben Sie eine g\u00fcltige Email-Adresse ein.');
    }
    if (v[PASS_FIELD] !== v.confirm) errors.push('Die Passw\u00f6rter stimmen nicht \u00fcberein.');
    if (POLICY.pwdStrong && !checkPassword(v[PASS_FIELD])) {
      errors.push(...passwordErrors(v[PASS_FIELD], POLICY, res.locals?.lang));
    }
    // classes/registerpage.php:165 captcha
    if (captchaId && !captchaOk(req, captchaId, v.securitycode)) {
      errors.push('Der Sicherheitscode ist nicht korrekt.');
    }

    if (!errors.length) {
      const dup = await users().findFirst({
        where: { OR: [{ [USER_FIELD]: v[USER_FIELD] }, { [MAIL_FIELD]: v[MAIL_FIELD] }] },
      }).catch(() => null);
      if (dup) errors.push('Dieser Benutzername oder diese Email-Adresse ist bereits vergeben.');
    }

    if (errors.length) {
      return res.status(400).render('auth/register', {
        errors, values: v, captchaId: randString('alphanum', 8),
      });
    }

    // classes/registerpage.php:285 -> $values["active"] = 0
    const token = issueAuthToken('activate');
    const max = await users().aggregate({ _max: { ID: true } }).catch(() => ({ _max: { ID: 0 } }));
    await users().create({
      data: {
        ID: (max?._max?.ID || 0) + 1,
        [USER_FIELD]: v[USER_FIELD],
        [PASS_FIELD]: await hashPassword(v[PASS_FIELD]),
        Name: v.Name || '',
        [MAIL_FIELD]: v[MAIL_FIELD],
        active: 0,
        reset_token: token,
        reset_date: new Date(),
        Team: v.Team || 'Team',
      },
    });

    const activateUrl = baseUrl(req) + '/activate?token=' + encodeURIComponent(token);
    // classes/registerpage.php:204 sends to the user AND to the admin address
    await mailer({ to: v[MAIL_FIELD], template: 'userregister',
      data: { username: v[USER_FIELD], Email_value: v[MAIL_FIELD], activateUrl } });
    await mailer({ to: ADMIN_NOTIFY_EMAIL, template: 'adminregister',
      data: { username: v[USER_FIELD], Email_value: v[MAIL_FIELD] } });

    res.render('auth/message', {
      title: 'Registrierung',
      message: res.locals?.t ? res.locals.t('registration_saved') : 'Ihre Registrierung wurde gespeichert.',
    });
  });

  // ------------------------------------------------------------- activate
  // classes/registerpage.php:110 -> set active=1
  router.get('/activate', async (req, res) => {
    const token = String(req.query.token || '');
    const user = token
      ? await users().findFirst({ where: { reset_token: token } }).catch(() => null)
      : null;
    const invalid = !user
      || authTokenKind(token) !== 'activate'
      || isAuthTokenExpired(user.reset_date);
    if (invalid) {
      return res.status(400).render('auth/message', {
        title: 'Aktivierung', message: 'Der Aktivierungslink ist ung\u00fcltig oder abgelaufen.',
      });
    }
    await users().update({ where: { ID: user.ID }, data: { active: 1, reset_token: null, reset_date: null } });
    res.render('auth/message', {
      title: 'Aktivierung', message: 'Ihr Konto wurde aktiviert. Sie k\u00f6nnen sich jetzt anmelden.',
    });
  });

  // --------------------------------------------------------------- remind
  router.get('/remind', (req, res) => res.render('auth/remind', { message: null, sent: false }));

  router.post('/remind', async (req, res) => {
    const who = String(req.body?.username_email || '').trim();
    // classes/remindpwdpage.php:230 -> username = ? OR email = ?
    const user = who
      ? await users().findFirst({
          where: { OR: [{ [USER_FIELD]: who }, { [MAIL_FIELD]: who }] },
        }).catch(() => null)
      : null;

    if (!user) {
      // classes/remindpwdpage.php:125 exact German wording
      return res.status(404).render('auth/remind', {
        message: 'Benutzer ' + who + ' ist nicht registriert.', sent: false,
      });
    }

    const token = issueAuthToken('reset');
    await users().update({
      where: { ID: user.ID }, data: { reset_token: token, reset_date: new Date() },
    });

    // classes/remindpwdpage.php:191 -> /remind replaced by /changepwd
    const resetUrl = baseUrl(req) + '/changepwd?token=' + encodeURIComponent(token);
    const sent = await mailer({
      to: user[MAIL_FIELD], template: 'remindpwd',
      data: { username: user[USER_FIELD], reseturl: resetUrl },
    });

    res.render('auth/remind', {
      sent: true,
      message: sent?.mailed
        ? 'Eine Email mit weiteren Anweisungen wurde versendet.'
        : 'Die Email konnte nicht versendet werden. Bitte wenden Sie sich an den Administrator.',
    });
  });

  // ------------------------------------------------------------ changepwd
  // changepwd.php:9 -> a token OR an authenticated session is required
  router.get('/changepwd', (req, res) => {
    const token = String(req.query.token || '');
    if (!token && !req.session?.user) return res.redirect('/login?message=expired');
    res.render('auth/changepwd', { errors: [], token, withToken: !!token });
  });

  router.post('/changepwd', async (req, res) => {
    const token = String(req.body?.token || '');
    if (!token && !req.session?.user) return res.redirect('/login?message=expired');

    const { oldpass, newpass, confirm } = req.body || {};
    const errors = [];
    const render = (status) => res.status(status).render('auth/changepwd', {
      errors, token, withToken: !!token,
    });

    let user = null;
    if (token) {
      user = await users().findFirst({ where: { reset_token: token } }).catch(() => null);
      if (!user || authTokenKind(token) !== 'reset' || isAuthTokenExpired(user.reset_date)) {
        errors.push('Der Link ist ung\u00fcltig oder abgelaufen.');
        return render(400);
      }
    } else {
      user = await users().findFirst({
        where: { [USER_FIELD]: req.session.user[USER_FIELD] },
      }).catch(() => null);
      if (!user) {
        errors.push(res.locals?.t ? res.locals.t('user_not_found') : 'Benutzer nicht gefunden.');
        return render(400);
      }
      // classes/changepwdpage.php:184/207 -> verify the old password first
      if (!(await verifyPassword(oldpass, user[PASS_FIELD]))) {
        errors.push(res.locals?.t ? res.locals.t('invalid_password') : 'Ung\u00fcltiges Passwort');
        return render(400);
      }
    }

    if (newpass !== confirm) errors.push(res.locals?.t ? res.locals.t('passwords_mismatch') : 'Die Passw\u00f6rter stimmen nicht \u00fcberein.');
    if (POLICY.pwdStrong && !checkPassword(newpass)) errors.push(...passwordErrors(newpass, POLICY, res.locals?.lang));
    if (errors.length) return render(400);

    await users().update({
      where: { ID: user.ID },
      data: { [PASS_FIELD]: await hashPassword(newpass), reset_token: null, reset_date: null },
    });

    res.render('auth/message', {
      title: res.locals?.t ? res.locals.t('password_changed') : 'Passwort ge\u00e4ndert',
      message: res.locals?.t ? res.locals.t('password_changed_msg') : 'Ihr Passwort wurde ge\u00e4ndert.',
    });
  });

  return router;
}
