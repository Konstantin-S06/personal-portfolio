import { useState, type FormEvent } from 'react';
import { API_BASE_URL } from '../config';

const NAME_MAX = 100;
const EMAIL_MAX = 100;
const MESSAGE_MAX = 1000;

type Phase = 'idle' | 'loading' | 'success' | 'error';
type ErrorKind = 'network' | 'validation' | 'server';

const ERROR_TEXT: Record<ErrorKind, string> = {
  network: 'Network error: the message never reached the server. Check your connection and try again.',
  validation:
    'Validation error: name and email must be 100 characters or fewer, the message 1000 or fewer, and the email must include @.',
  server: 'Server error: the message could not be saved. Please try again later.',
};

function clientError(name: string, email: string, message: string): string | null {
  if (!name || !email || !message) return ERROR_TEXT.validation;
  if (name.length > NAME_MAX || email.length > EMAIL_MAX || message.length > MESSAGE_MAX) return ERROR_TEXT.validation;
  if (!email.includes('@')) return ERROR_TEXT.validation;
  return null;
}

export function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('');

  const invalid = phase === 'error' && status === ERROR_TEXT.validation;

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const payload = { name: name.trim(), email: email.trim(), message: message.trim() };
    const problem = clientError(payload.name, payload.email, payload.message);
    if (problem) {
      setPhase('error');
      setStatus(problem);
      return;
    }

    setPhase('loading');
    setStatus('Sending your message…');
    try {
      const res = await fetch(`${API_BASE_URL}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 400) {
        setPhase('error');
        setStatus(ERROR_TEXT.validation);
        return;
      }
      if (!res.ok) {
        setPhase('error');
        setStatus(ERROR_TEXT.server);
        return;
      }
      setName('');
      setEmail('');
      setMessage('');
      setPhase('success');
      setStatus('Message sent. Thanks for getting in touch.');
    } catch {
      setPhase('error');
      setStatus(ERROR_TEXT.network);
    }
  };

  return (
    <form className="contact-form" onSubmit={onSubmit} noValidate aria-busy={phase === 'loading'}>
      <div className="form-group">
        <label htmlFor="contact-name">Name</label>
        <input
          id="contact-name"
          name="name"
          type="text"
          autoComplete="name"
          required
          maxLength={NAME_MAX}
          value={name}
          aria-invalid={invalid && !name.trim()}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label htmlFor="contact-email">Email</label>
        <input
          id="contact-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={EMAIL_MAX}
          value={email}
          aria-invalid={invalid && (!email.trim() || !email.includes('@'))}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label htmlFor="contact-message">Message</label>
        <textarea
          id="contact-message"
          name="message"
          required
          rows={5}
          maxLength={MESSAGE_MAX}
          value={message}
          aria-invalid={invalid && !message.trim()}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
      <button type="submit" className="btn-primary" disabled={phase === 'loading'}>
        {phase === 'loading' ? 'Sending…' : 'Send message'}
      </button>
      <p className={`form-status${phase === 'error' ? ' is-error' : ''}${phase === 'success' ? ' is-success' : ''}`} role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}
