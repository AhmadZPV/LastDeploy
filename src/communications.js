import nodemailer from 'nodemailer';

export async function smtpTransport(prisma, team) {
  const settings = await prisma.einstellungen.findFirst({ where: { Team: team } });
  if (!settings?.SMTPServer) throw new Error('SMTP ist nicht konfiguriert');
  return {
    settings,
    transport: nodemailer.createTransport({
      host: settings.SMTPServer, port: settings.SMTPPort || 587,
      secure: String(settings.SMTPSicherheit || '').toLowerCase() === 'ssl',
      auth: settings.SMTPUser ? { user: settings.SMTPUser, pass: settings.SMTPPasswort || '' } : undefined,
    }),
  };
}

export async function sendRecordMail({ prisma, record, req }) {
  const team = req?.session?.user?.Team || record?.Team || 'Team';
  const { settings, transport } = await smtpTransport(prisma, team);
  const info = await transport.sendMail({
    from: record.Eigeneemail || settings.Email || settings.SMTPUser,
    to: record.Email, cc: record.Kopie || undefined,
    subject: record.Betreff || '', html: record.Text || '',
  });
  return { sent: true, messageId: info.messageId };
}

export async function importMailMessages({ prisma, target, messages = [], req }) {
  const team = req?.session?.user?.Team || 'Team';
  const user = req?.session?.user?.Benutzername || '';
  const delegate = target === 'kontaktaufnahme' ? prisma.kontaktaufnahme : prisma.korrespondenz;
  if (!delegate) throw new Error('Mail-Importziel ist nicht verfügbar');
  let created = 0;
  for (const message of messages) {
    const data = target === 'kontaktaufnahme'
      ? { Betreff: message.subject || '', Text: message.html || message.text || '', Email: message.from || '', Team: team }
      : { Betreff: message.subject || '', Text: message.html || message.text || '', Absendermail: message.from || '', Benutzer: user, Datum: message.date ? new Date(message.date) : new Date(), Team: team };
    await delegate.create({ data }); created += 1;
  }
  return { created };
}
