import type { BrowserSessionState, OpaqueSessionDescriptor } from '../../../packages/contracts/src/index.js';

const queriedRoot = document.querySelector<HTMLElement>('#app');
if (!queriedRoot) throw new Error('HULK SA Web Player root element is missing.');
const root: HTMLElement = queriedRoot;

type ViewState =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'signed-out'; error: string | null }>
  | Readonly<{ kind: 'signed-in'; session: OpaqueSessionDescriptor; busy: boolean }>;

let viewState: ViewState = Object.freeze({ kind: 'loading' });

function button(label: string, type: 'button' | 'submit' = 'button'): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = type;
  element.textContent = label;
  return element;
}

function renderLoading(): void {
  const card = document.createElement('section');
  card.className = 'foundation-card';
  card.setAttribute('aria-busy', 'true');
  const title = document.createElement('h1');
  title.textContent = 'HULK SA Web Player';
  const status = document.createElement('p');
  status.textContent = 'جارٍ التحقق من الجلسة…';
  card.append(title, status);
  root.replaceChildren(card);
}

function createField(labelText: string, input: HTMLInputElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'login-field';
  const text = document.createElement('span');
  text.textContent = labelText;
  label.append(text, input);
  return label;
}

function renderSignedOut(error: string | null): void {
  const card = document.createElement('section');
  card.className = 'foundation-card';
  card.setAttribute('aria-labelledby', 'login-title');
  const title = document.createElement('h1');
  title.id = 'login-title';
  title.textContent = 'HULK SA Web Player';
  const description = document.createElement('p');
  description.textContent = 'أدخل بيانات اشتراك المزود المصرّح لك باستخدامه.';

  const form = document.createElement('form');
  form.className = 'login-form';
  form.noValidate = true;

  const host = document.createElement('input');
  host.type = 'url';
  host.name = 'host';
  host.required = true;
  host.maxLength = 2048;
  host.autocomplete = 'off';
  host.inputMode = 'url';
  host.dir = 'ltr';

  const username = document.createElement('input');
  username.type = 'text';
  username.name = 'username';
  username.required = true;
  username.maxLength = 256;
  username.autocomplete = 'off';
  username.dir = 'ltr';

  const password = document.createElement('input');
  password.type = 'password';
  password.name = 'password';
  password.required = true;
  password.maxLength = 512;
  password.autocomplete = 'off';
  password.dir = 'ltr';

  const submit = button('تسجيل الدخول', 'submit');
  const feedback = document.createElement('p');
  feedback.className = 'form-feedback';
  feedback.setAttribute('role', 'status');
  if (error) feedback.textContent = error;

  form.append(
    createField('رابط المزود / البوابة', host),
    createField('اسم المستخدم', username),
    createField('كلمة المرور', password),
    submit,
    feedback,
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    feedback.textContent = 'جارٍ التحقق…';
    const payload = {
      host: host.value,
      username: username.value,
      password: password.value,
    };
    password.value = '';

    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        feedback.textContent = response.status === 429
          ? 'تم تجاوز عدد المحاولات المسموح. حاول لاحقًا.'
          : 'تعذر تسجيل الدخول. تحقق من بيانات المزود وحالة الاشتراك.';
        return;
      }
      const session = (await response.json()) as BrowserSessionState;
      if (!session.authenticated) throw new Error('Unexpected unauthenticated response.');
      host.value = '';
      username.value = '';
      viewState = Object.freeze({ kind: 'signed-in', session, busy: false });
      render();
    } catch {
      feedback.textContent = 'تعذر الاتصال بخدمة تسجيل الدخول.';
    } finally {
      submit.disabled = false;
      payload.password = '';
    }
  });

  card.append(title, description, form);
  root.replaceChildren(card);
  host.focus();
}

function renderSignedIn(session: OpaqueSessionDescriptor, busy: boolean): void {
  const card = document.createElement('section');
  card.className = 'foundation-card';
  card.setAttribute('aria-labelledby', 'session-title');
  const title = document.createElement('h1');
  title.id = 'session-title';
  title.textContent = 'تم تسجيل الدخول';
  const status = document.createElement('p');
  status.textContent = `الجلسة فعالة حتى ${new Date(session.expiresAt).toLocaleString('ar-SA')}.`;
  const logout = button(busy ? 'جارٍ تسجيل الخروج…' : 'تسجيل الخروج');
  logout.disabled = busy;
  logout.addEventListener('click', async () => {
    viewState = Object.freeze({ kind: 'signed-in', session, busy: true });
    render();
    try {
      await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' });
    } finally {
      viewState = Object.freeze({ kind: 'signed-out', error: null });
      render();
    }
  });
  card.append(title, status, logout);
  root.replaceChildren(card);
}

function render(): void {
  if (viewState.kind === 'loading') renderLoading();
  else if (viewState.kind === 'signed-out') renderSignedOut(viewState.error);
  else renderSignedIn(viewState.session, viewState.busy);
}

async function hydrateSession(): Promise<void> {
  render();
  try {
    const response = await fetch('/api/session', { method: 'GET', credentials: 'same-origin' });
    if (!response.ok) {
      viewState = Object.freeze({ kind: 'signed-out', error: null });
      render();
      return;
    }
    const session = (await response.json()) as BrowserSessionState;
    viewState = session.authenticated
      ? Object.freeze({ kind: 'signed-in', session, busy: false })
      : Object.freeze({ kind: 'signed-out', error: null });
  } catch {
    viewState = Object.freeze({ kind: 'signed-out', error: 'تعذر التحقق من الجلسة.' });
  }
  render();
}

void hydrateSession();
