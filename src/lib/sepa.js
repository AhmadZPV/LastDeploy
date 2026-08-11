function xml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function buildSepaTransferXml({ amount, date, recipientName, recipientIban, recipientBic, senderName, senderIban, senderBic, reference, messageId = 'ap-emlaki' }) {
  const cents = Math.round(Number(amount || 0) * 100);
  if (!Number.isFinite(cents) || cents <= 0) throw new Error('Betrag muss positiv sein');
  if (!/^[A-Z]{2}[0-9A-Z]{10,32}$/i.test(String(recipientIban || ''))) throw new Error('Empfänger-IBAN ist ungültig');
  if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/i.test(String(recipientBic || ''))) throw new Error('Empfänger-BIC ist ungültig');
  const amountText = `${(cents / 100).toFixed(2)}`;
  const dateText = date instanceof Date ? date.toISOString().slice(0, 10) : String(date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"><CstmrCdtTrfInitn><GrpHdr><MsgId>${xml(messageId)}</MsgId><CreDtTm>${new Date().toISOString()}</CreDtTm><NbOfTxs>1</NbOfTxs><CtrlSum>${amountText}</CtrlSum><InitgPty><Nm>${xml(senderName)}</Nm></InitgPty></GrpHdr><PmtInf><PmtInfId>${xml(messageId)}-P</PmtInfId><PmtMtd>TRF</PmtMtd><BtchBookg>false</BtchBookg><NbOfTxs>1</NbOfTxs><CtrlSum>${amountText}</CtrlSum><ReqdExctnDt>${xml(dateText)}</ReqdExctnDt><Dbtr><Nm>${xml(senderName)}</Nm></Dbtr><DbtrAcct><Id><IBAN>${xml(senderIban)}</IBAN></Id></DbtrAcct><DbtrAgt><FinInstnId><BIC>${xml(senderBic)}</BIC></FinInstnId></DbtrAgt><CdtTrfTxInf><PmtId><EndToEndId>${xml(reference || 'NOTPROVIDED')}</EndToEndId></PmtId><Amt><InstdAmt Ccy="EUR">${amountText}</InstdAmt></Amt><CdtrAgt><FinInstnId><BIC>${xml(recipientBic)}</BIC></FinInstnId></CdtrAgt><Cdtr><Nm>${xml(recipientName)}</Nm></Cdtr><CdtrAcct><Id><IBAN>${xml(recipientIban)}</IBAN></Id></CdtrAcct><RmtInf><Ustrd>${xml(reference)}</Ustrd></RmtInf></CdtTrfTxInf></PmtInf></CstmrCdtTrfInitn></Document>`;
}
