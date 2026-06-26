// ============================================
// Email Reply Utility
// Sends transactional notifications via Resend API:
//   - Error replies (unknown supplier, no PDF)
//   - Receipt confirmations (invoice received)
//   - Rejection notifications (invoice rejected by team)
// ============================================

const RESEND_API = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'SubmitStream <noreply@submitstream.com>';

interface ReplyOptions {
  /** Resend API key */
  apiKey: string;
  /** Original sender's email (the reply recipient) */
  to: string;
  /** Subject line for the reply */
  subject: string;
  /** Plain-text body */
  text: string;
  /** Optional HTML body */
  html?: string;
}

/**
 * Send an auto-reply email via Resend.
 * Best-effort — failures are logged but don't throw.
 */
export async function sendErrorReply(options: ReplyOptions): Promise<boolean> {
  try {
    const payload: Record<string, unknown> = {
      from: FROM_ADDRESS,
      to: [options.to],
      subject: options.subject,
      text: options.text,
    };
    if (options.html) payload.html = options.html;

    const response = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const result = await response.json() as { id?: string };
      console.log(`[Email Reply] Sent to ${options.to}: ${options.subject} (id: ${result.id})`);
      return true;
    }

    const errorText = await response.text();
    console.warn(`[Email Reply] Resend returned ${response.status}: ${errorText}`);
    return false;
  } catch (err) {
    console.error('[Email Reply] Failed to send:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Pre-built reply: unknown supplier / unrecognized address
 */
export function replyUnknownSupplier(apiKey: string, to: string, recipientAddress: string): Promise<boolean> {
  return sendErrorReply({
    apiKey,
    to,
    subject: 'Invoice Not Processed — Unrecognized Address',
    text: [
      `Your email to ${recipientAddress} could not be processed.`,
      '',
      `The address "${recipientAddress}" is not associated with any configured supplier.`,
      '',
      'Please verify the email address and try again, or contact your administrator for the correct supplier email address.',
      '',
      '— SubmitStream',
    ].join('\n'),
  });
}

/**
 * Pre-built reply: no PDF attachment found
 */
export function replyNoPdfAttachment(apiKey: string, to: string, supplierName: string): Promise<boolean> {
  return sendErrorReply({
    apiKey,
    to,
    subject: 'Invoice Not Processed — No PDF Attachment Found',
    text: [
      `Your email to ${supplierName} was received but could not be processed.`,
      '',
      'No PDF attachment was found in your email. Please ensure your invoice is attached as a PDF file and resend.',
      '',
      'Accepted format: .pdf',
      '',
      '— SubmitStream',
    ].join('\n'),
  });
}

/**
 * Receipt confirmation: invoice received and being processed
 */
export function replyInvoiceReceived(
  apiKey: string,
  to: string,
  details: { fileName: string; supplierName: string; invoiceNumber?: string },
): Promise<boolean> {
  const invoiceRef = details.invoiceNumber
    ? `invoice #${details.invoiceNumber} (${details.fileName})`
    : details.fileName;

  return sendErrorReply({
    apiKey,
    to,
    subject: `Invoice Received — ${invoiceRef}`,
    text: [
      `Thank you — we have received your invoice.`,
      '',
      `  Supplier: ${details.supplierName}`,
      `  File: ${details.fileName}`,
      ...(details.invoiceNumber ? [`  Invoice #: ${details.invoiceNumber}`] : []),
      '',
      'Your invoice is now being processed. You can check its current status at:',
      'https://submitstream.com',
      '',
      '— SubmitStream',
    ].join('\n'),
  });
}

/**
 * Rejection notification: invoice rejected by a team member
 */
export function replyInvoiceRejected(
  apiKey: string,
  to: string,
  details: { invoiceNumber: string; supplierName: string; feedback?: string },
): Promise<boolean> {
  return sendErrorReply({
    apiKey,
    to,
    subject: `Action Required — Invoice #${details.invoiceNumber} Rejected`,
    text: [
      `Dear ${details.supplierName},`,
      '',
      `Invoice #${details.invoiceNumber} has been reviewed and was not approved.`,
      ...(details.feedback ? ['', `Reason: ${details.feedback}`] : []),
      '',
      'Please review the details and resubmit a corrected invoice. You can check the status at:',
      'https://submitstream.com',
      '',
      'If you have any questions, please contact your account representative.',
      '',
      '— SubmitStream',
    ].join('\n'),
  });
}
