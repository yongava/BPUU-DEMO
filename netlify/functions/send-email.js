const nodemailer = require('nodemailer');

const jsonHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function response(statusCode, payload) {
  return {
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  };
}

function getTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER || 'dev.codegym@gmail.com';
  const pass = process.env.SMTP_PASS || '';

  if (!pass) {
    throw new Error('Missing SMTP_PASS environment variable');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: jsonHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return response(405, { ok: false, error: 'Method not allowed' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return response(400, { ok: false, error: 'Invalid JSON body' });
  }

  const to = String(payload.to || '').trim();
  const subject = String(payload.subject || '').trim();
  const text = String(payload.text || payload.body || '').trim();
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || 'dev.codegym@gmail.com';
  const fromName = process.env.SMTP_FROM_NAME || 'BPUU Workflow System';

  if (!to || !subject || !text) {
    return response(400, {
      ok: false,
      error: 'Missing required fields: to, subject, text'
    });
  }

  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      text,
      replyTo: fromEmail,
      headers: {
        'X-BPUU-Ticket-ID': String(payload.ticketId || ''),
        'X-BPUU-Event-Type': String(payload.eventType || ''),
        'X-BPUU-Workflow-Key': String(payload.workflowKey || ''),
        'X-BPUU-Step': String(payload.step || '')
      }
    });

    return response(200, {
      ok: true,
      messageId: info.messageId,
      accepted: info.accepted || [],
      rejected: info.rejected || []
    });
  } catch (error) {
    console.error('send-email failed', error);
    return response(500, {
      ok: false,
      error: error.message || 'Failed to send email'
    });
  }
};
