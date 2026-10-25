// Same call shape as the original OV Pulse feedback server function, but sent to the TPulso worker.
// The original stored feedback in a Lovable Cloud table; TPulso has no database in the MVP, so the
// worker answers 503 "feedback_not_configured" until a destination is chosen (see the report).

export interface FeedbackInput {
  feedbackType: 'issue' | 'idea' | 'other';
  message: string;
  contactEmail: string;
  appContext: { path: string; userAgent: string };
}

export async function submitFeedback({ data }: { data: FeedbackInput }): Promise<void> {
  const res = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Feedback not sent (${res.status})`);
}
